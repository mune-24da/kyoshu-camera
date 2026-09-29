import { DEFAULT_DETECTION_CONFIG } from "./detection.mjs";

export function createState() {
  const saved = safeRead();
  return {
    config: {
      ...DEFAULT_DETECTION_CONFIG,
      ...saved.config,
      model: saved.config?.model ?? "full",
      mirror: saved.config?.mirror ?? true,
    },
    hasMirrorOverride: false,
    landmarker: null,
    landmarkerModel: null,
    running: false,
    stream: null,
    source: null,
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
          model: state.config.model,
          mirror: state.config.mirror,
        },
        recordMode: state.recordMode,
      }),
    );
  } catch {}
}
