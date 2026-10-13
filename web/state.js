import { DEFAULT_DETECTION_CONFIG } from "./detection.mjs";

export function createState() {
  const saved = safeRead();
  // 全体から探す方式は細かいモデル、席ごとに切り出す方式は席の数だけ回すので軽いモデルが向く
  const models = { whole: "full", crop: "movenet", ...saved.models };
  // 席ごとの既定を lite から MoveNet に変えた。変える前に保存された lite は、選び直したものではないので置き換える
  if (!saved.cropDefaultIsMoveNet && models.crop === "lite") models.crop = "movenet";
  return {
    config: {
      ...DEFAULT_DETECTION_CONFIG,
      ...saved.config,
      model: models[saved.method === "crop" ? "crop" : "whole"],
      mirror: saved.config?.mirror ?? true,
    },
    models,
    hasMirrorOverride: false,
    landmarker: null,
    landmarkerModel: null,
    running: false,
    stream: null,
    source: null,
    method: saved.method ?? "whole",
    resolutionChoice: saved.resolutionChoice ?? "1280x720",
    yoloSize: saved.yoloSize ?? "960",
    cropSeats: saved.cropSeats ?? [],
    selectedCropSeat: null,
    seatPeople: [],
    seatRate: 0,
    seats: [],
    seatsConfirmed: false,
    lastPeople: [],
    queue: [],
    logRows: [],
    events: [],
    recordMode: saved.recordMode ?? "none",
    activeRecordMode: "none",
    recorder: null,
    recordingChunks: [],
    recordingBlob: null,
    recordingMime: "",
    recordingDone: Promise.resolve(),
    startedAt: null,
    sessionName: "",
    cameraName: "",
    resolution: "",
    hasUnexported: false,
    frameNo: -1,
    detectedCount: 0,
    detectedHist: {},
    keptHist: {},
    lastTs: 0,
    fps: 0,
    lastFrameAt: 0,
    wakeLock: null,
    timesText: null,
    toastTimer: 0,
  };
}

function safeRead() {
  try {
    return JSON.parse(localStorage.getItem("kyoshu-settings") || "{}") || {};
  } catch {
    return {};
  }
}

export function saveSettings(state) {
  try {
    localStorage.setItem(
      "kyoshu-settings",
      JSON.stringify({
        config: {
          over: state.config.over,
          forearm: state.config.forearm,
          elbow: state.config.elbow,
          hold: state.config.hold,
          mirror: state.config.mirror,
        },
        models: state.models,
        cropDefaultIsMoveNet: true,
        recordMode: state.recordMode,
        method: state.method,
        resolutionChoice: state.resolutionChoice,
        yoloSize: state.yoloSize,
        cropSeats: state.cropSeats,
      }),
    );
  } catch {}
}
