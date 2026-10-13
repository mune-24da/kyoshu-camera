import { cropRect, mapCropPoint } from "./crop.mjs";
import { MOVENET_SIZE, letterbox, moveNetToPoints } from "./movenet.mjs";
import { yoloInputSize, yoloRows } from "./yolo.mjs";

const MP_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const ORT_DIST = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
const TFJS = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/+esm";
const MOVENET_URL = "https://tfhub.dev/google/tfjs-model/movenet/singlepose/lightning/4";
// 席が多いと全部の席を1コマで見きれない。1コマで使う時間をここまでにし、残りの席は次のコマへ回す
const CROP_BUDGET_MS = 30;
const modelUrl = (name) => "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
  + `pose_landmarker_${name}/float16/latest/pose_landmarker_${name}.task`;

export function createVision(state, view) {
  let pose = null;
  let fileset = null;
  let cropCanvas = null;
  let yoloCanvas = null;
  let yoloSession = null;
  let ort = null;
  let yoloDelegate = "";
  let tf = null;
  let moveNet = null;
  let moveNetCanvas = null;
  let cropCursor = 0;

  async function loadPose() {
    if (pose) return pose;
    const module = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs");
    fileset = await module.FilesetResolver.forVisionTasks(MP_WASM);
    pose = module.PoseLandmarker;
    return pose;
  }

  async function ensureMediaPipe(mode) {
    const key = `${state.config.model}:${mode}`;
    if (state.landmarker && state.landmarkerModel === key) return;
    view.showToast("骨格推定モデルを読み込んでいます…", 60);
    state.landmarker?.close();
    const PoseLandmarker = await loadPose();
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: modelUrl(state.config.model), delegate },
      runningMode: mode,
      numPoses: mode === "VIDEO" ? 12 : 1,
    });
    try {
      state.landmarker = await PoseLandmarker.createFromOptions(fileset, options("GPU"));
      state.delegate = "GPU";
    } catch (error) {
      console.warn("GPU で動かせないので CPU に切り替える", error);
      state.landmarker = await PoseLandmarker.createFromOptions(fileset, options("CPU"));
      state.delegate = "CPU";
    }
    state.landmarkerModel = key;
    state.lastTs = 0;
    view.showToast("", 0);
  }

  async function ensureYolo(message = "YOLOモデルを読み込んでいます…") {
    if (yoloSession) return;
    view.showToast(message, 60);
    ort = await import("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.min.mjs");
    ort.env.wasm.wasmPaths = ORT_DIST;
    try {
      yoloSession = await ort.InferenceSession.create("models/yolo11n-pose.onnx", {
        executionProviders: ["webgpu"],
      });
      yoloDelegate = "GPU";
    } catch (error) {
      console.warn("WebGPU で動かせないので WASM に切り替える", error);
      yoloSession = await ort.InferenceSession.create("models/yolo11n-pose.onnx", {
        executionProviders: ["wasm"],
      });
      yoloDelegate = "CPU";
    }
    view.showToast("", 0);
  }

  async function ensureLandmarker() {
    if (state.method === "yolo") {
      await ensureYolo();
      state.delegate = yoloDelegate;
      return;
    }
    if (usesMoveNet()) return ensureMoveNet();
    return ensureMediaPipe(state.method === "crop" ? "IMAGE" : "VIDEO");
  }

  function usesMoveNet() {
    return state.method === "crop" && state.config.model === "movenet";
  }

  async function ensureMoveNet() {
    if (!moveNet) {
      view.showToast("骨格推定モデルを読み込んでいます…", 60);
      tf = await import(TFJS);
      await tf.ready();
      moveNet = await tf.loadGraphModel(MOVENET_URL, { fromTFHub: true });
      view.showToast("", 0);
    }
    state.delegate = tf.getBackend() === "cpu" ? "CPU" : "GPU";
  }

  async function moveNetPose(video, rect) {
    moveNetCanvas ??= document.createElement("canvas");
    moveNetCanvas.width = MOVENET_SIZE;
    moveNetCanvas.height = MOVENET_SIZE;
    const context = moveNetCanvas.getContext("2d", { willReadFrequently: true });
    const box = letterbox(rect.width, rect.height);
    context.fillStyle = "#000";
    context.fillRect(0, 0, MOVENET_SIZE, MOVENET_SIZE);
    context.drawImage(
      video,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      box.offsetX,
      box.offsetY,
      box.width,
      box.height,
    );
    const output = tf.tidy(() => {
      return moveNet.execute(tf.cast(tf.expandDims(tf.browser.fromPixels(moveNetCanvas)), "int32"));
    });
    const data = await output.data();
    output.dispose();
    return moveNetToPoints(data, box, rect);
  }

  function mediaPipePose(video, rect) {
    cropCanvas ??= document.createElement("canvas");
    const context = cropCanvas.getContext("2d", { willReadFrequently: true });
    cropCanvas.width = 256;
    cropCanvas.height = Math.max(1, Math.round(256 * rect.height / rect.width));
    context.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, cropCanvas.width, cropCanvas.height);
    const landmarks = state.landmarker.detect(cropCanvas).landmarks[0];
    return landmarks ? landmarks.map((point) => mapCropPoint(point, rect)) : null;
  }

  function whole(video) {
    const timestamp = Math.max(performance.now(), state.lastTs + 1);
    state.lastTs = timestamp;
    const result = state.landmarker.detectForVideo(video, timestamp);
    return {
      detectedCount: result.landmarks.length,
      detections: result.landmarks.map((landmarks) => landmarks.map((point) => ({
        x: point.x * video.videoWidth,
        y: point.y * video.videoHeight,
        v: point.visibility ?? 1,
      }))),
    };
  }

  // checked は、このコマで見た席の番号。カメラのときは時間の上限で打ち切り、続きは次のコマで見る。
  // 録画の判定は、機械の速さで結果が変わらないよう、毎コマ全部の席を見る
  async function crop(video) {
    const count = state.seats.length;
    const everySeat = state.source === "file";
    const moveNetInUse = usesMoveNet();
    const detections = [];
    const checked = [];
    const startedAt = performance.now();
    for (let step = 0; step < count; step++) {
      const index = (cropCursor + step) % count;
      // 推定を待っている間に席が消されることがある
      const seat = state.seats[index];
      if (!seat) break;
      checked.push(index);
      const rect = cropRect(seat, video.videoWidth, video.videoHeight);
      if (rect.width >= 2 && rect.height >= 2) {
        const points = moveNetInUse ? await moveNetPose(video, rect) : mediaPipePose(video, rect);
        if (points) detections.push({ seat: index, points });
      }
      if (!everySeat && performance.now() - startedAt > CROP_BUDGET_MS) break;
    }
    cropCursor = checked.length ? (checked.at(-1) + 1) % count : 0;
    return { detectedCount: count, detections, checked };
  }

  async function runYolo(video, longSide) {
    yoloCanvas ??= document.createElement("canvas");
    const size = yoloInputSize(video.videoWidth, video.videoHeight, longSide);
    yoloCanvas.width = size.width;
    yoloCanvas.height = size.height;
    const context = yoloCanvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "rgb(114,114,114)";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(video, 0, 0, size.resizedWidth, size.resizedHeight);
    const image = context.getImageData(0, 0, size.width, size.height).data;
    const area = size.width * size.height;
    const input = new Float32Array(area * 3);
    for (let index = 0; index < area; index++) {
      input[index] = image[index * 4] / 255;
      input[area + index] = image[index * 4 + 1] / 255;
      input[area * 2 + index] = image[index * 4 + 2] / 255;
    }
    const tensor = new ort.Tensor("float32", input, [1, 3, size.height, size.width]);
    const output = await yoloSession.run({ images: tensor });
    return yoloRows(output.output0.data, size.scale);
  }

  async function yolo(video) {
    const rows = await runYolo(video, +state.yoloSize);
    return { detectedCount: rows.length, detections: rows.map((row) => row.points) };
  }

  // 席の候補を出すための1回きりの検出。小さく映った人も拾えるよう、いちばん大きい入力で回す
  async function findPeopleForSeats(video) {
    await ensureYolo("映っている人を探す準備をしています…(初回だけ少し待ちます)");
    return runYolo(video, 1280);
  }

  async function detect(video) {
    if (state.method === "crop") return crop(video);
    if (state.method === "yolo") return yolo(video);
    return whole(video);
  }

  return { ensureLandmarker, detect, findPeopleForSeats };
}
