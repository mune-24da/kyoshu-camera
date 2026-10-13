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
    "fullscreen",
    "homeScreenNote",
    "zoom",
    "zoomV",
    "zoomRow",
    "zoomNote",
    "yoloSize",
    "yoloSizeLabel",
    "startCam",
    "callFirst",
    "reset",
    "confirmSeats",
    "cropControls",
    "cropConfirm",
    "cropAuto",
    "cropDelete",
    "cropClear",
    "recordMode",
    "progress",
    "progressNow",
    "progressQueue",
    "progressCall",
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
    elements.confirmSeats.hidden = isCrop;
    elements.cropConfirm.disabled = elements.confirmSeats.disabled;
    elements.cropConfirm.textContent = `席の配置を確定(${count}席)`;
    elements.canvas.classList.toggle("seat-editing", isCrop && !state.seatsConfirmed);
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
      // 四隅のつまみは、画面上でいつも同じ大きさ(約14px)に見えるようにする
      const handle = 14 * (width / (canvas.getBoundingClientRect().width || width));
      state.seats.forEach((seat, index) => {
        const left = seat.left * width;
        const top = seat.top * height;
        const right = left + seat.width * width;
        const bottom = top + seat.height * height;
        const selected = state.selectedCropSeat === index && !state.seatsConfirmed;
        context.strokeStyle = seat.raised ? "#ffc400" : seat.tracked ? "#7cf07c" : "#ff7878";
        if (selected) context.strokeStyle = "#4fc3f7";
        context.lineWidth = unit * (selected ? 3 : 1.5);
        context.strokeRect(mirrorX(right), top, -(right - left), bottom - top);
        context.fillStyle = context.strokeStyle;
        if (selected) {
          for (const [cornerX, cornerY] of [[left, top], [right, top], [left, bottom], [right, bottom]]) {
            context.fillRect(mirrorX(cornerX) - handle / 2, cornerY - handle / 2, handle, handle);
          }
        }
        context.font = `bold ${14 * unit}px system-ui,sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(
          String(index + 1),
          mirrorX((left + right) / 2),
          Math.max(top - 10 * unit, 12 * unit),
        );
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
    if (state.method === "crop" && !state.seats.length) {
      rows.push('<div class="warn">「自動で席を置く」を押すか、人の頭を押して席を置いてください</div>');
    } else if (state.method === "crop" && !people.length) {
      rows.push('<div class="warn">席の枠の中に人を追えていません(枠を体に合わせて直してください)</div>');
    } else if (!people.length) {
      rows.push('<div class="warn">人が見つかりません(両肩が映るように)</div>');
    }
    const modelLabel = state.method === "yolo" ? `yolo11n ${state.yoloSize}` : state.config.model;
    const detected = state.method === "crop"
      ? `席 ${state.seats.length} のうち人を追えた ${people.length} / 1席あたり毎秒 ${state.seatRate.toFixed(1)}回`
      : `検出 ${state.detectedCount}人 / 採用 ${people.length}人`;
    hud.innerHTML = `<div>${state.resolution || `${width}x${height}`} ${state.method} `
      + `${state.delegate || ""} ${state.fps.toFixed(1)}fps ${modelLabel}</div>`
      + `<div>${detected}</div>`
      + rows.join("");
    updateConfirmButton();
    updateRecordHud();
  }

  // 指でなぞって作っている途中の枠
  function drawDraftSeat(rect) {
    const { canvas } = elements;
    const left = rect.left * canvas.width;
    const right = left + rect.width * canvas.width;
    const drawLeft = state.config.mirror ? canvas.width - right : left;
    context.strokeStyle = "#4fc3f7";
    context.lineWidth = Math.max(2, canvas.width / 400) * 2;
    context.setLineDash([12, 8]);
    context.strokeRect(drawLeft, rect.top * canvas.height, right - left, rect.height * canvas.height);
    context.setLineDash([]);
  }

  return {
    elements,
    drawDraftSeat,
    showToast,
    renderQueue,
    setConfirmed,
    updateConfirmButton,
    updateRecordHud,
    draw,
  };
}
