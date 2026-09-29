import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MAX_PEOPLE = 12;
const modelUrl = (name) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${name}/float16/latest/pose_landmarker_${name}.task`;

export function createVision(state, view) {
  async function ensureLandmarker() {
    if (state.landmarker && state.landmarkerModel === state.config.model) return;
    view.showToast("骨格推定モデルを読み込んでいます…", 60);
    state.landmarker?.close();
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: modelUrl(state.config.model), delegate },
      runningMode: "VIDEO", numPoses: MAX_PEOPLE,
    });
    try {
      state.landmarker = await PoseLandmarker.createFromOptions(fileset, options("GPU"));
      state.delegate = "GPU";
    } catch (error) {
      console.warn("GPU で動かせないので CPU に切り替える", error);
      state.landmarker = await PoseLandmarker.createFromOptions(fileset, options("CPU"));
      state.delegate = "CPU";
    }
    state.landmarkerModel = state.config.model;
    state.lastTs = 0;
    view.showToast("", 0);
  }

  function detect(video) {
    // VIDEO モードは時刻が単調に増えないと例外になる
    const timestamp = Math.max(performance.now(), state.lastTs + 1);
    state.lastTs = timestamp;
    return state.landmarker.detectForVideo(video, timestamp);
  }

  return { ensureLandmarker, detect };
}
