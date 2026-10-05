import { FEATURE_NAMES } from "./detection.mjs";

const csvHeader = [
  "t",
  "frame",
  "person",
  "lift_left",
  "src_left",
  "lift_right",
  "src_right",
  "cond_left",
  "cond_right",
  "raised",
  "event",
  ...["left", "right"].flatMap((side) => {
    return FEATURE_NAMES.map((name) => `${side}_${name}`);
  }),
];
const pad = (value) => String(value).padStart(2, "0");
const histogramText = (histogram) => {
  return Object.entries(histogram)
    .map(([people, frames]) => `${people}人=${frames}`)
    .join(", ") || "なし";
};
const EVENT_LABELS = { raise: "挙手", lower: "解除", cancel: "取り消し", reset: "リセット" };

export function sessionFileName(date = new Date()) {
  return `kyoshu-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function createLogger(state) {
  const number = (value) => (value === null ? "" : value.toFixed(3));
  const flags = (conditions) => {
    return conditions.map((condition) => (condition ? "1" : "0")).join("");
  };
  const recording = () => state.activeRecordMode !== "none";
  const add = (row) => {
    if (recording()) {
      state.logRows.push(row);
      state.hasUnexported = true;
    }
  };

  function addFrame(now, person, seat, conditions, event) {
    const [[leftValue, leftSource], [rightValue, rightSource]] = [
      person.pl.left,
      person.pl.right,
    ];
    add([
      now.toFixed(3),
      state.frameNo,
      person.seat,
      number(leftValue),
      leftSource,
      number(rightValue),
      rightSource,
      flags(conditions.left[1]),
      flags(conditions.right[1]),
      seat.raised ? 1 : 0,
      event ?? "",
      ...["left", "right"].flatMap((side) => {
        return FEATURE_NAMES.map((name) => number(person.pl.feat[side][name]));
      }),
    ]);
  }

  function addAction(event, seat = "", time = state.now ?? "") {
    add([
      typeof time === "number" ? time.toFixed(3) : "",
      state.frameNo,
      seat,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      event,
    ]);
  }

  function csvText() {
    const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    return [csvHeader, ...state.logRows]
      .map((row) => row.map(escape).join(","))
      .join("\n");
  }

  function summaryText() {
    const events = state.events
      .slice(0, 120)
      .map((event) => {
        const time = Number(event.t ?? 0).toFixed(1);
        const label = EVENT_LABELS[event.ev] ?? event.ev;
        return `${time}秒 ${label}${event.seat ? ` 席${event.seat}` : ""}`;
      })
      .join("\n");
    const seats = state.seatsConfirmed
      ? state.seats.map((seat, index) => {
        const xCoordinate = (seat.registeredX ?? seat.x).toFixed(0);
        const yCoordinate = (seat.registeredY ?? seat.y).toFixed(0);
        const shoulderWidth = (seat.registeredSw ?? seat.sw).toFixed(0);
        return `席${index + 1}: x=${xCoordinate}, y=${yCoordinate}, 肩幅=${shoulderWidth}`;
      }).join("; ")
      : "未確定";

    const modelLabel = state.method === "yolo" ? `yolo11n 入力${state.yoloSize}` : state.config.model;
    return [
      "挙手カメラ 記録要約",
      `日時: ${state.startedAt?.toLocaleString("ja-JP") ?? "未開始"}`,
      `ブラウザ: ${navigator.userAgent}`,
      `カメラ: ${state.cameraName || "不明"} / ${state.resolution || "不明"}`,
      `方式: ${state.method} / モデル: ${modelLabel} / ${state.delegate || "不明"}`,
      `YOLO入力: ${state.yoloSize ?? "-"} / 希望解像度: ${state.resolutionChoice ?? "-"}`,
      `基準: 鼻=${state.config.over}, 腕=${state.config.forearm}, 肘=${state.config.elbow}, 継続=${state.config.hold}秒`,
      `平均fps: ${state.fps.toFixed(1)} / 記録モード: ${state.activeRecordMode}`,
      `${state.method === "crop" ? "席数" : "検出した人数"}ごとのコマ数: ${histogramText(state.detectedHist)}`,
      `${state.method === "crop" ? "追えた人数" : "採用した人数"}ごとのコマ数: ${histogramText(state.keptHist)}`,
      `人数確定: ${seats}`,
      `イベント(${state.events.length}件):${events ? `\n${events}` : " なし"}`
        + `${state.events.length > 120 ? "\n…以降省略" : ""}`,
    ].join("\n");
  }

  function file(name, text, type) {
    return new File([text], name, { type });
  }

  async function exportFiles() {
    if (!state.running) {
      await state.recordingDone;
    }
    const base = state.sessionName || sessionFileName();
    const files = [
      file(`${base}.csv`, "\ufeff" + csvText(), "text/csv;charset=utf-8"),
      file(`${base}-summary.txt`, summaryText(), "text/plain;charset=utf-8"),
    ];
    if (state.recordingBlob) {
      const extension = state.recordingMime.includes("mp4") ? "mp4" : "webm";
      files.push(
        new File([state.recordingBlob], `${base}.${extension}`, {
          type: state.recordingMime,
        }),
      );
    }
    return files;
  }

  function download(fileToSave) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(fileToSave);
    link.download = fileToSave.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function downloadAll() {
    (await exportFiles()).forEach(download);
    state.hasUnexported = false;
  }

  async function share() {
    const files = await exportFiles();
    if (!navigator.canShare?.({ files })) {
      throw new Error("このブラウザではファイル共有に対応していません");
    }
    await navigator.share({ title: "挙手カメラの記録", files });
    state.hasUnexported = false;
  }

  async function copySummary() {
    await navigator.clipboard.writeText(summaryText());
  }

  async function copyCsv() {
    await navigator.clipboard.writeText(csvText());
  }

  return {
    addFrame,
    addAction,
    csvText,
    summaryText,
    exportFiles,
    downloadAll,
    share,
    copySummary,
    copyCsv,
  };
}
