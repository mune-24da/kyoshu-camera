import { cropRect, mapCropPoint } from "./crop.mjs";
import { yoloInputSize, yoloRows } from "./yolo.mjs";

const MP_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const ORT_DIST = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
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

  async function ensureYolo() {
    if (yoloSession) return;
    view.showToast("YOLOモデルを読み込んでいます…", 60);
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
    return ensureMediaPipe(state.method === "crop" ? "IMAGE" : "VIDEO");
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

  function crop(video) {
    cropCanvas ??= document.createElement("canvas");
    const context = cropCanvas.getContext("2d", { willReadFrequently: true });
    const detections = [];
    state.seats.forEach((seat, index) => {
      const rect = cropRect(seat, video.videoWidth, video.videoHeight);
      if (rect.width < 2 || rect.height < 2) return;
      cropCanvas.width = 256;
      cropCanvas.height = Math.max(1, Math.round(256 * rect.height / rect.width));
      context.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, cropCanvas.width, cropCanvas.height);
      const result = state.landmarker.detect(cropCanvas);
      const landmarks = result.landmarks[0];
      if (!landmarks) return;
      detections.push({ seat: index, points: landmarks.map((point) => mapCropPoint(point, rect)) });
    });
    return { detectedCount: state.seats.length, detections };
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
    await ensureYolo();
    return runYolo(video, 1280);
  }

  async function detect(video) {
    if (state.method === "crop") return crop(video);
    if (state.method === "yolo") return yolo(video);
    return whole(video);
  }

  return { ensureLandmarker, detect, findPeopleForSeats };
}
