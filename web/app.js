import {
  DEFAULT_DETECTION_CONFIG,
  L_SH,
  R_SH,
  Seat,
  armRaised,
  personLift,
} from "./detection.mjs";
import { createLogger, sessionFileName } from "./logging.js";
import { allocateSeats, registerSeatPositions } from "./seats.mjs";
import { createSources, parseTimes } from "./sources.js";
import { createState, saveSettings } from "./state.js";
import { createView } from "./view.js";
import { createVision } from "./vision.js";

const state = createState();
const view = createView(state);
const vision = createVision(state, view);
const logger = createLogger(state);
const { elements } = view;

window.kyoshuEvents = state.events;
window.kyoshuLog = () => state.logRows;
window.kyoshuCounts = () => ({ detected: state.detectedHist, kept: state.keptHist });

function addEvent(event, write = true) {
  const complete = { t: state.now ?? 0, ...event };
  state.events.push(complete);

  if (write) {
    logger.addAction(complete.ev, complete.seat ? complete.seat - 1 : "", complete.t);
  }
}

function displayOrder(people) {
  const centerX = (person) => (person.p[L_SH].x + person.p[R_SH].x) / 2;

  return people.sort((left, right) => {
    return state.config.mirror
      ? centerX(right) - centerX(left)
      : centerX(left) - centerX(right);
  });
}

function processFrame(now) {
  state.now = now;
  state.frameNo++;

  const width = elements.video.videoWidth;
  const height = elements.video.videoHeight;
  const result = vision.detect(elements.video);
  const found = [];

  for (const landmarks of result.landmarks) {
    const points = landmarks.map((landmark) => ({
      x: landmark.x * width,
      y: landmark.y * height,
      v: landmark.visibility ?? 1,
    }));
    const lift = personLift(points);

    if (lift) {
      found.push({ p: points, pl: lift });
    }
  }

  let people;
  if (state.seatsConfirmed) {
    const allocation = allocateSeats(state.seats, found);
    state.seats.forEach((seat, index) => {
      Object.assign(seat, allocation.seats[index]);
    });
    people = found.filter((_, index) => allocation.assignment[index] !== null);
    people.forEach((person) => {
      person.seat = allocation.assignment[found.indexOf(person)];
    });
  } else {
    people = displayOrder(found);
    people.forEach((person, seatNumber) => {
      state.seats[seatNumber] ??= new Seat();
      person.seat = seatNumber;
    });
  }

  // 骨格推定が見つけた人数と、両肩が見えない・値が異常などで捨てた後の人数を分けて数える
  state.detectedCount = result.landmarks.length;
  state.detectedHist[state.detectedCount] = (state.detectedHist[state.detectedCount] ?? 0) + 1;
  state.keptHist[people.length] = (state.keptHist[people.length] ?? 0) + 1;
  state.lastPeople = people;
  people.forEach((person) => {
    const seat = state.seats[person.seat];
    person.c = {
      left: armRaised(person.pl.feat.left, state.config),
      right: armRaised(person.pl.feat.right, state.config),
    };

    const event = seat.update(
      person.c.left[0] || person.c.right[0],
      now,
      state.config.hold,
    );
    if (event) {
      addEvent({ seat: person.seat + 1, ev: event }, false);
    }
    if (event === "raise" && !state.queue.includes(person.seat)) {
      state.queue.push(person.seat);
      view.renderQueue(cancel);
    }
    logger.addFrame(now, person, seat, person.c, event);
  });

  const frameAt = performance.now();
  if (state.lastFrameAt) {
    state.fps = state.fps * 0.9 + (1000 / (frameAt - state.lastFrameAt)) * 0.1;
  }
  state.lastFrameAt = frameAt;
  view.draw(people);
}

function beginSession() {
  state.running = true;
  state.seats = [];
  state.seatsConfirmed = false;
  state.lastPeople = [];
  state.queue = [];
  state.logRows = [];
  state.events = [];
  state.frameNo = -1;
  state.detectedCount = 0;
  state.detectedHist = {};
  state.keptHist = {};
  state.fps = 0;
  state.lastFrameAt = 0;
  state.now = 0;
  state.activeRecordMode = state.source === "file" && state.recordMode === "video"
    ? "log"
    : state.recordMode;
  state.recordingChunks = [];
  state.recordingBlob = null;
  state.recordingMime = "";
  state.recordingDone = Promise.resolve();
  state.startedAt = new Date();
  state.sessionName = sessionFileName(state.startedAt);
  state.hasUnexported = false;

  const track = state.stream?.getVideoTracks()[0];
  state.cameraName = track?.label ?? (state.source === "file" ? "読み込んだ映像" : "");
  const settings = track?.getSettings();
  state.resolution = settings
    ? `${settings.width}x${settings.height}`
    : `${elements.video.videoWidth}x${elements.video.videoHeight}`;

  window.kyoshuEvents = state.events;
  view.renderQueue(cancel);
  view.setConfirmed(false);
  elements.placeholder.hidden = true;
  elements.canvas.hidden = false;
  elements.hud.hidden = false;
  elements.stop.disabled = false;
  view.updateConfirmButton();
  view.updateRecordHud();
  addEvent({ ev: `開始(${state.activeRecordMode})` });
  navigator.wakeLock?.request("screen")
    .then((lock) => state.wakeLock = lock)
    .catch(() => {});
}

const sources = createSources(state, view, vision, {
  begin: beginSession,
  processFrame,
});

function cancel(seat) {
  if (!state.queue.includes(seat)) return;

  state.queue = state.queue.filter((entry) => entry !== seat);
  addEvent({ seat: seat + 1, ev: "cancel" });
  view.renderQueue(cancel);
  view.showToast(`席${seat + 1}を取り消しました`);
}

function reset() {
  state.queue = [];
  state.seats.forEach((seat) => {
    seat.raised = false;
    seat.since = null;
  });
  addEvent({ ev: "reset" });
  view.renderQueue(cancel);
}

function confirmSeats() {
  if (!state.running || state.seatsConfirmed || !state.lastPeople.length) return;

  const people = displayOrder([...state.lastPeople]);
  state.seats = registerSeatPositions(people).map((position, index) => {
    return Object.assign(new Seat(), position, {
      registeredX: position.x,
      registeredY: position.y,
      registeredSw: position.sw,
      raised: state.seats[index]?.raised ?? false,
      since: state.seats[index]?.since ?? null,
    });
  });
  state.seatsConfirmed = true;
  addEvent({ ev: `人数確定(${state.seats.length}人)` });
  view.setConfirmed(true);
  view.renderQueue(cancel);
  view.showToast(`${state.seats.length}人を登録しました`);
}

function releaseSeats() {
  if (!state.seatsConfirmed) return;

  state.seatsConfirmed = false;
  state.seats = [];
  state.queue = [];
  addEvent({ ev: "人数確定解除" });
  view.setConfirmed(false);
  view.renderQueue(cancel);
  view.updateConfirmButton();
}

window.kyoshuConfirmSeats = confirmSeats;
window.kyoshuReleaseSeats = releaseSeats;

for (const name of ["over", "forearm", "elbow", "hold"]) {
  const input = document.querySelector(`#${name}`);
  const output = document.querySelector(`#${name}V`);
  const sync = (event = false) => {
    state.config[name] = +input.value;
    output.textContent = (+input.value).toFixed(2).replace(/0$/, "");
    saveSettings(state);

    if (event) {
      addEvent({ ev: `基準変更(${name}=${input.value})` });
    }
  };

  input.value = state.config[name];
  input.oninput = () => sync(true);
  sync();
}

elements.model.value = state.config.model;
elements.mirror.checked = state.config.mirror;
elements.recordMode.value = state.recordMode;
elements.mirror.onchange = (event) => {
  state.config.mirror = event.target.checked;
  saveSettings(state);
  addEvent({ ev: `鏡像変更(${state.config.mirror})` });
};
elements.model.onchange = (event) => {
  state.config.model = event.target.value;
  saveSettings(state);
  addEvent({ ev: `モデル変更(${state.config.model})` });
};
elements.recordMode.onchange = (event) => {
  state.recordMode = event.target.value;
  saveSettings(state);
};
elements.defaults.onclick = () => {
  for (const name of ["over", "forearm", "elbow", "hold"]) {
    document.querySelector(`#${name}`).value = DEFAULT_DETECTION_CONFIG[name];
  }
  document.querySelectorAll("#over,#forearm,#elbow,#hold").forEach((input) => {
    input.dispatchEvent(new Event("input"));
  });
  view.showToast("判定基準を初期値に戻しました");
};
elements.startCam.onclick = sources.startCamera;
elements.camera.onchange = () => {
  if (state.source === "camera" && state.running) {
    sources.startCamera();
  }
};
elements.stop.onclick = sources.stop;
elements.undoLast.onclick = () => state.queue.length && cancel(state.queue.at(-1));
elements.reset.onclick = reset;
elements.progressUndo.onclick = () => state.queue.length && cancel(state.queue.at(-1));
elements.progressReset.onclick = reset;
elements.confirmSeats.onclick = confirmSeats;
elements.releaseSeats.onclick = releaseSeats;
elements.share.onclick = async () => {
  try {
    await logger.share();
    view.showToast("共有しました");
  } catch (error) {
    view.showToast(error.message, 5);
  }
};
elements.download.onclick = async () => {
  await logger.downloadAll();
  view.showToast("ダウンロードを開始しました");
};
elements.copySummary.onclick = async () => {
  try {
    await logger.copySummary();
    view.showToast("要約をコピーしました");
  } catch {
    view.showToast("コピーできませんでした");
  }
};
elements.copyCsv.onclick = async () => {
  if (
    state.logRows.length > 5000
    && !confirm(`ログは${state.logRows.length}行あります。コピーしますか？`)
  ) return;

  try {
    await logger.copyCsv();
    view.showToast("CSVをコピーしました");
  } catch {
    view.showToast("コピーできませんでした");
  }
};
elements.timesFile.onchange = async (event) => {
  state.timesText = event.target.files[0]
    ? await event.target.files[0].text()
    : null;
};
elements.startFile.onclick = () => {
  const file = elements.videoFile.files[0];
  if (!file) return view.showToast("先に映像ファイルを選んでください");

  sources.startFile(URL.createObjectURL(file), parseTimes(state.timesText));
};
document.addEventListener("visibilitychange", () => {
  if (state.running && document.visibilityState === "visible") {
    navigator.wakeLock?.request("screen")
      .then((lock) => state.wakeLock = lock)
      .catch(() => {});
  }
});
document.addEventListener("keydown", (event) => {
  if (event.target.matches("input,select")) return;

  if (event.key >= "1" && event.key <= "9") {
    cancel(+event.key - 1);
  } else if (event.key === "x") {
    state.queue.length && cancel(state.queue.at(-1));
  } else if (event.key === "r") {
    reset();
  }
});
window.addEventListener("beforeunload", (event) => {
  if (state.hasUnexported) {
    event.preventDefault();
    event.returnValue = "";
  }
});

const params = new URLSearchParams(location.search);
if (params.get("model")) {
  state.config.model = params.get("model");
  elements.model.value = state.config.model;
}
if (params.has("mirror")) {
  state.config.mirror = params.get("mirror") !== "0";
  state.hasMirrorOverride = true;
  elements.mirror.checked = state.config.mirror;
}
if (params.get("video")) {
  const timesPath = params.get("times");
  const times = timesPath
    ? parseTimes(await (await fetch(timesPath)).text())
    : [];
  const blob = await (await fetch(params.get("video"))).blob();
  sources.startFile(URL.createObjectURL(blob), times)
    .catch((error) => view.showToast(error.message, 8));
}
