const FILE_STEP = 0.1;
// 画面の描き替えに制御を返す。setTimeout は裏に回ったタブで1秒に1回へ絞られ、録画の判定が進まなくなる
const yieldToBrowser = () => new Promise((resolve) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = resolve;
  channel.port2.postMessage(null);
});
const recordingType = () => {
  return [
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ].find((type) => MediaRecorder.isTypeSupported(type));
};

export function createSources(state, view, vision, session) {
  const { elements } = view;
  // 止めた後も前回のコールバックが1つ残り、次の映像が流れ始めると動き出す。
  // 開始のたびに番号を進め、古い番号のループはそこで終わらせる
  let runId = 0;

  function stopRecorder() {
    if (state.recorder?.state === "recording") {
      state.recorder.stop();
    }
    state.recorder = null;
  }

  function stop() {
    runId++;
    state.running = false;
    stopRecorder();
    state.stream?.getTracks().forEach((track) => track.stop());
    state.stream = null;
    elements.video.pause();
    state.wakeLock?.release().catch(() => {});
    state.wakeLock = null;
    elements.stop.disabled = true;
    view.updateRecordHud();
  }

  function startRecorder(stream) {
    if (state.activeRecordMode !== "video" || !window.MediaRecorder) return;

    const mime = recordingType();
    if (!mime) {
      view.showToast("このブラウザでは録画形式を選べません。ログのみ記録します", 5);
      return;
    }

    try {
      state.recordingMime = mime;
      state.recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks = state.recordingChunks;
      const recorder = state.recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
          state.hasUnexported = true;
        }
      };
      state.recordingDone = new Promise((resolve) => {
        recorder.onstop = () => {
          if (state.recordingChunks === chunks) {
            state.recordingBlob = new Blob(chunks, { type: mime });
          }
          resolve();
        };
      });
      recorder.start(1000);
    } catch (error) {
      view.showToast(`録画を開始できません: ${error.message}`, 5);
    }
  }

  async function listCameras() {
    const current = state.stream?.getVideoTracks()[0]?.getSettings().deviceId
      ?? elements.camera.value;
    const cameras = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === "videoinput");
    elements.camera.replaceChildren(
      ...cameras.map((device, index) => {
        return new Option(device.label || `カメラ${index + 1}`, device.deviceId);
      }),
    );
    if (current) {
      elements.camera.value = current;
    }
  }

  function isFrontCamera(track) {
    const facing = track.getSettings().facingMode;
    return facing ? facing === "user" : /front|前面|facetime/i.test(track.label);
  }

  function setMirror(mirror) {
    state.config.mirror = mirror;
    elements.mirror.checked = mirror;
  }

  async function startCamera() {
    stop();
    const run = runId;
    let stream;
    try {
      await vision.ensureLandmarker();
      const deviceId = elements.camera.value;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(deviceId
            ? { deviceId: { exact: deviceId } }
            : { facingMode: "user" }),
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
    } catch (error) {
      view.showToast(`カメラを開けません: ${error.message}`, 8);
      return;
    }
    if (run !== runId) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    state.stream = stream;
    elements.video.srcObject = state.stream;
    await elements.video.play();
    await listCameras();
    if (run !== runId) return;
    if (!state.hasMirrorOverride) {
      setMirror(isFrontCamera(state.stream.getVideoTracks()[0]));
    }
    state.source = "camera";
    const startedAt = performance.now();
    session.begin();
    startRecorder(state.stream);

    const loop = () => {
      if (run !== runId || !state.running || state.source !== "camera") return;

      session.processFrame((performance.now() - startedAt) / 1000);
      if (elements.video.requestVideoFrameCallback) {
        elements.video.requestVideoFrameCallback(loop);
      } else {
        requestAnimationFrame(loop);
      }
    };
    loop();
  }

  async function startFile(url, times) {
    stop();
    const run = runId;
    await vision.ensureLandmarker();
    elements.video.srcObject = null;
    elements.video.src = url;
    await new Promise((resolve, reject) => {
      elements.video.onloadeddata = resolve;
      elements.video.onerror = () => reject(new Error("映像を読めません"));
    });
    state.source = "file";
    session.begin();

    const frames = times.length || Math.floor(elements.video.duration / FILE_STEP);
    for (
      let index = 0;
      index < frames && run === runId && state.running && state.source === "file";
      index++
    ) {
      elements.video.currentTime = Math.min(
        (index + 0.5) * FILE_STEP,
        elements.video.duration - 0.001,
      );
      await new Promise((resolve) => elements.video.onseeked = resolve);
      session.processFrame(times[index] ?? index * FILE_STEP);
      await yieldToBrowser();
    }

    if (run !== runId) return;
    if (state.running && state.source === "file") {
      state.running = false;
      elements.stop.disabled = true;
      view.updateRecordHud();
      view.showToast("映像の最後まで判定しました", 5);
    }
    window.kyoshuDone = true;
  }

  return { stop, listCameras, startCamera, startFile, setMirror };
}

export function parseTimes(text) {
  return text ? text.split(/\s+/).filter(Boolean).map(Number) : [];
}
