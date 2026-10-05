import assert from "node:assert/strict";
import test from "node:test";

import { createSources } from "../sources.js";

function setup() {
  const callbacks = [];
  const video = {
    srcObject: null,
    play: async () => {},
    pause: () => {},
    requestVideoFrameCallback: (callback) => callbacks.push(callback),
  };
  const state = {
    running: false,
    source: null,
    stream: null,
    recorder: null,
    wakeLock: null,
    hasMirrorOverride: true,
    activeRecordMode: "none",
  };
  const view = {
    elements: {
      video,
      stop: {},
      camera: { value: "", replaceChildren: () => {} },
      mirror: {},
    },
    showToast: () => {},
    updateRecordHud: () => {},
  };
  const frames = [];
  const sources = createSources(state, view, { ensureLandmarker: async () => {} }, {
    begin: () => { state.running = true; },
    processFrame: (now) => frames.push(now),
  });
  // 映像の1コマ: 登録済みのコールバックを全部呼ぶ(止めた回の分も残っている)
  const presentFrame = () => callbacks.splice(0).forEach((callback) => callback());
  return { sources, frames, presentFrame };
}

test("カメラを開始し直しても、1コマにつき判定は1回だけ走る", async () => {
  // Node の navigator は読み取り専用なので、代入ではなく定義し直す
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => {} }],
          getVideoTracks: () => [{ getSettings: () => ({}), label: "" }],
        }),
        enumerateDevices: async () => [],
      },
    },
  });
  const { sources, frames, presentFrame } = setup();

  await sources.startCamera();
  await sources.startCamera();
  await sources.startCamera();
  frames.length = 0;

  presentFrame();
  await new Promise(queueMicrotask);
  presentFrame();
  await new Promise(queueMicrotask);
  assert.equal(frames.length, 2);
});
