import { L_EL, L_SH, L_WR, R_EL, R_SH, R_WR, ok } from "./detection.mjs";

const HUD_DETAIL_MAX = 4;
const ARM_LINES = [
  [L_SH, R_SH],
  [L_SH, L_EL],
  [L_EL, L_WR],
  [R_SH, R_EL],
  [R_EL, R_WR],
];

export function createView(state) {
  const select = (selector) => document.querySelector(selector);
  const ids = [
    "video",
    "view",
    "hud",
    "recordHud",
    "queue",
    "toast",
    "placeholder",
    "stop",
    "camera",
    "mirror",
    "model",
    "method",
    "methodSetting",
    "resolution",
    "yoloSize",
    "yoloSizeLabel",
    "startCam",
    "undoLast",
    "reset",
    "confirmSeats",
    "cropControls",
    "cropGrow",
    "cropShrink",
    "cropDelete",
    "cropClear",
    "recordMode",
    "progress",
    "progressNow",
    "progressQueue",
    "progressUndo",
    "progressReset",
    "releaseSeats",
    "main",
    "share",
    "download",
    "copySummary",
    "copyCsv",
    "defaults",
    "timesFile",
    "startFile",
    "videoFile",
  ];
  const elements = Object.fromEntries(ids.map((id) => [
    id === "view" ? "canvas" : id,
    select(`#${id}`),
  ]));
  const context = elements.canvas.getContext("2d");

  function showToast(message, seconds = 3) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.style.display = message ? "block" : "none";
    if (message) {
      state.toastTimer = setTimeout(() => {
        elements.toast.style.display = "none";
      }, seconds * 1000);
    }
  }

  function queueButton(seat, order, cancel, large = false) {
    const button = document.createElement("button");
    button.className = large ? "" : "chip";
    button.innerHTML = `<small>${order + 1}番目</small>席${seat + 1}`;
    button.onclick = () => cancel(seat);
    return button;
  }

  function renderQueue(cancel) {
    elements.queue.replaceChildren();
    elements.progressQueue.replaceChildren();
    if (!state.queue.length) {
      elements.queue.innerHTML = '<span class="empty">まだ誰も挙げていない</span>';
      elements.progressNow.textContent = "挙手待ち";
      return;
    }
    state.queue.forEach((seat, order) => {
      elements.queue.append(queueButton(seat, order, cancel));
      elements.progressQueue.append(queueButton(seat, order, cancel, true));
    });
    elements.progressNow.textContent = `1番目 席${state.queue[0] + 1}`;
  }

  function setConfirmed(confirmed) {
    elements.progress.classList.toggle("active", confirmed);
    elements.main.classList.toggle("progress-layout", confirmed);
    document.querySelectorAll(".normal-screen").forEach((node) => {
      node.classList.toggle("hidden", confirmed);
    });
  }

  function updateConfirmButton() {
    const peopleCount = state.lastPeople.length;
    const isCrop = state.method === "crop";
    const count = isCrop ? state.seats.length : peopleCount;
    elements.confirmSeats.disabled = !state.running || state.seatsConfirmed || !count;
    elements.confirmSeats.textContent = isCrop
      ? `席の配置を確定(${count}席)`
      : `人数を確定(${count}人)`;
  }

  function updateRecordHud() {
    const recording = state.running && state.activeRecordMode !== "none";
    elements.recordHud.hidden = !recording;
    if (recording) {
      elements.recordHud.textContent = state.activeRecordMode === "video"
        ? `● 録画中 ${state.logRows.length}行`
        : `ログ記録中 ${state.logRows.length}行`;
    }
  }

  function draw(people) {
    const { video, canvas, hud } = elements;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const mirrorX = (value) => state.config.mirror ? width - value : value;
    context.save();
    if (state.config.mirror) {
      context.translate(width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(video, 0, 0, width, height);
    context.restore();

    const unit = Math.max(2, width / 400);
    people.forEach(({ p: points, pl: lift, seat }) => {
      const raised = state.seats[seat]?.raised;
      context.strokeStyle = raised ? "#ffc400" : "#4fc3f7";
      context.lineWidth = unit * 1.5;
      for (const [from, to] of ARM_LINES) {
        if (!ok(points[from]) || !ok(points[to])) continue;

        context.beginPath();
        context.moveTo(mirrorX(points[from].x), points[from].y);
        context.lineTo(mirrorX(points[to].x), points[to].y);
        context.stroke();
      }
      const centerX = mirrorX((points[L_SH].x + points[R_SH].x) / 2);
      const centerY = Math.max(
        Math.min(points[L_SH].y, points[R_SH].y) - lift.sw,
        15 * unit,
      );
      context.fillStyle = raised ? "#ffc400" : "rgba(0,0,0,.6)";
      context.beginPath();
      context.arc(centerX, centerY, 12 * unit, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = raised ? "#111" : "#fff";
      context.font = `bold ${12 * unit}px system-ui,sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(seat + 1), centerX, centerY);
      if (raised) {
        context.font = `bold ${10 * unit}px system-ui,sans-serif`;
        context.fillText("挙手", centerX, centerY + 26 * unit);
      }
    });

    if (state.method === "crop") {
      state.seats.forEach((seat, index) => {
        const x = seat.x * width;
        const y = seat.y * height;
        const seatWidth = seat.w * width;
        const left = Math.max(0, x - seatWidth / 2);
        const top = Math.max(0, y - seatWidth * 0.9);
        const right = Math.min(width, x + seatWidth / 2);
        const bottom = Math.min(height, y + seatWidth * 1.1);
        const raised = seat.raised;
        context.strokeStyle = raised ? "#ffc400" : seat.tracked ? "#7cf07c" : "#ff7878";
        if (state.selectedCropSeat === index) context.strokeStyle = "#4fc3f7";
        context.lineWidth = unit * (state.selectedCropSeat === index ? 3 : 1.5);
        context.strokeRect(mirrorX(right), top, -(right - left), bottom - top);
        context.fillStyle = context.strokeStyle;
        context.font = `bold ${14 * unit}px system-ui,sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(index + 1), mirrorX(x), Math.max(top - 10 * unit, 12 * unit));
      });
    }

    const marks = (conditions) => {
      return ["鼻", "腕", "肘"]
        .map((name, index) => name + (conditions[index] ? "○" : "×"))
        .join("");
    };
    // 条件の行は映像を覆うので、少人数のときだけ出す。席を映像の上で置く方式では出さない
    const showRows = state.method !== "crop" && people.length <= HUD_DETAIL_MAX;
    const rows = !showRows ? [] : people.map((person) => {
      const raised = state.seats[person.seat]?.raised;
      return `<div class="${raised ? "raised" : ""}">`
        + `席${person.seat + 1} 左 ${marks(person.c.left[1])}`
        + ` 右 ${marks(person.c.right[1])}${raised ? " 挙手" : ""}</div>`;
    });
    if (!people.length) {
      rows.push('<div class="warn">人が見つかりません(両肩が映るように)</div>');
    }
    const modelLabel = state.method === "yolo" ? `yolo11n ${state.yoloSize}` : state.config.model;
    const detected = state.method === "crop"
      ? `席 ${state.seats.length} のうち人を追えた ${people.length}`
      : `検出 ${state.detectedCount}人 / 採用 ${people.length}人`;
    hud.innerHTML = `<div>${state.resolution || `${width}x${height}`} ${state.method} `
      + `${state.delegate || ""} ${state.fps.toFixed(1)}fps ${modelLabel}</div>`
      + `<div>${detected}</div>`
      + rows.join("");
    updateConfirmButton();
    updateRecordHud();
  }

  return {
    elements,
    showToast,
    renderQueue,
    setConfirmed,
    updateConfirmButton,
    updateRecordHud,
    draw,
  };
}
