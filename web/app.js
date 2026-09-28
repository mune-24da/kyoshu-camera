// 挙手カメラのブラウザ版。判定は kyoshu.py と同じ3条件で、骨格推定だけ MediaPipe Pose Landmarker に置き換えている。
import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const modelUrl = (n) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${n}/float16/latest/pose_landmarker_${n}.task`;

// MediaPipe 33点の番号(COCO とは番号が違う)
const NOSE = 0, L_SH = 11, R_SH = 12, L_EL = 13, R_EL = 14, L_WR = 15, R_WR = 16;
const KP_CONF = 0.4;
const MAX_PEOPLE = 12;
const FILE_STEP = 0.1;
const FEATURE_NAMES = ["wrist_side", "wrist_over_nose", "forearm_up", "elbow_lift"];
const ARM_LINES = [[L_SH, R_SH], [L_SH, L_EL], [L_EL, L_WR], [R_SH, R_EL], [R_EL, R_WR]];

const $ = (s) => document.querySelector(s);
const video = $("#video"), canvas = $("#view"), ctx = canvas.getContext("2d");
const hud = $("#hud"), queueEl = $("#queue"), toast = $("#toast");

const cfg = { over: 0.10, forearm: 0.15, elbow: 0.02, hold: 0.6, model: "full", mirror: true };

let landmarker = null, landmarkerModel = null;
let running = false, stream = null, source = null;
let seats = [], queue = [], logRows = [], frameNo = -1, lastTs = 0;
let fps = 0, lastFrameAt = 0, wakeLock = null, timesText = null;
window.kyoshuEvents = [];
window.kyoshuLog = () => logRows;

// ---------- 判定(kyoshu.py と同じ) ----------

const ok = (q) => q.v >= KP_CONF;

function liftOf(p, sh, el, wr, sw) {
  if (!ok(p[sh])) return [null, ""];
  if (ok(p[wr])) return [(p[sh].y - p[wr].y) / sw, "手首"];
  if (ok(p[el])) return [(p[sh].y - p[el].y) / sw, "肘"];
  return [null, ""];
}

function armFeatures(p, sh, el, wr, sw) {
  const f = Object.fromEntries(FEATURE_NAMES.map((n) => [n, null]));
  if (ok(p[wr]) && ok(p[NOSE])) {
    f.wrist_side = Math.abs(p[wr].x - p[NOSE].x) / sw;
    f.wrist_over_nose = (p[NOSE].y - p[wr].y) / sw;
  }
  if (ok(p[wr]) && ok(p[el])) f.forearm_up = (p[el].y - p[wr].y) / sw;
  if (ok(p[el]) && ok(p[sh])) f.elbow_lift = (p[sh].y - p[el].y) / sw;
  return f;
}

function personLift(p) {
  if (!ok(p[L_SH]) || !ok(p[R_SH])) return null;
  const sw = Math.hypot(p[L_SH].x - p[R_SH].x, p[L_SH].y - p[R_SH].y);
  if (sw < 10) return null;
  const left = liftOf(p, L_SH, L_EL, L_WR, sw), right = liftOf(p, R_SH, R_EL, R_WR, sw);
  // 体の一部が隠れて肩幅を小さく誤測すると、ありえない値が出る
  if ([left, right].some(([v]) => v !== null && Math.abs(v) > 3)) return null;
  return { sw, left, right,
           feat: { left: armFeatures(p, L_SH, L_EL, L_WR, sw), right: armFeatures(p, R_SH, R_EL, R_WR, sw) } };
}

function armRaised(f) {
  const vals = [f.wrist_over_nose, f.forearm_up, f.elbow_lift];
  const ths = [cfg.over, cfg.forearm, cfg.elbow];
  const conds = vals.map((v, i) => v !== null && v >= ths[i]);
  return [conds.every(Boolean), conds];
}

class Seat {
  constructor() { this.raised = false; this.since = null; }
  update(above, now) {
    if (above !== this.raised) {
      if (this.since === null) this.since = now;
      else if (now - this.since >= cfg.hold) {
        this.raised = above;
        this.since = null;
        return above ? "raise" : "lower";
      }
    } else this.since = null;
    return null;
  }
}

// ---------- 骨格推定 ----------

async function ensureLandmarker() {
  if (landmarker && landmarkerModel === cfg.model) return;
  showToast("骨格推定モデルを読み込んでいます…", 60);
  landmarker?.close();
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: modelUrl(cfg.model), delegate },
    runningMode: "VIDEO", numPoses: MAX_PEOPLE,
  });
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, opts("GPU"));
  } catch (e) {
    console.warn("GPU で動かせないので CPU に切り替える", e);
    landmarker = await PoseLandmarker.createFromOptions(fileset, opts("CPU"));
  }
  landmarkerModel = cfg.model;
  lastTs = 0;
  showToast("", 0);
}

function detect() {
  // VIDEO モードは時刻が単調に増えないと例外になる
  const ts = Math.max(performance.now(), lastTs + 1);
  lastTs = ts;
  return landmarker.detectForVideo(video, ts);
}

// ---------- 1コマの処理 ----------

function processFrame(now) {
  frameNo++;
  const W = video.videoWidth, H = video.videoHeight;
  const res = detect();
  const people = [];
  for (const lm of res.landmarks) {
    const p = lm.map((q) => ({ x: q.x * W, y: q.y * H, v: q.visibility ?? 1 }));
    const pl = personLift(p);
    if (pl) people.push({ p, pl });
  }
  // 席番号は表示上の左から順に振る(試験用。本番は席の位置を登録する)
  const cx = (o) => (o.p[L_SH].x + o.p[R_SH].x) / 2;
  people.sort((a, b) => (cfg.mirror ? cx(b) - cx(a) : cx(a) - cx(b)));

  people.forEach((o, i) => {
    const seat = (seats[i] ??= new Seat());
    o.c = { left: armRaised(o.pl.feat.left), right: armRaised(o.pl.feat.right) };
    const ev = seat.update(o.c.left[0] || o.c.right[0], now);
    if (ev) window.kyoshuEvents.push({ t: +now.toFixed(3), seat: i + 1, ev });
    if (ev === "raise" && !queue.includes(i)) { queue.push(i); renderQueue(); }
    const num = (v) => (v === null ? "" : v.toFixed(3));
    const flags = (c) => c.map((x) => (x ? "1" : "0")).join("");
    const [[lv, ls], [rv, rs]] = [o.pl.left, o.pl.right];
    logRows.push([now.toFixed(3), frameNo, i, num(lv), ls, num(rv), rs, flags(o.c.left[1]), flags(o.c.right[1]),
                  seat.raised ? 1 : 0, ev ?? "",
                  ...["left", "right"].flatMap((s) => FEATURE_NAMES.map((n) => num(o.pl.feat[s][n])))]);
  });

  const t = performance.now();
  if (lastFrameAt) fps = fps * 0.9 + (1000 / (t - lastFrameAt)) * 0.1;
  lastFrameAt = t;
  draw(people);
}

// ---------- 表示 ----------

function draw(people) {
  const W = video.videoWidth, H = video.videoHeight;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const X = (x) => (cfg.mirror ? W - x : x);
  ctx.save();
  if (cfg.mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, W, H);
  ctx.restore();

  const unit = Math.max(2, W / 400);
  people.forEach(({ p, pl }, i) => {
    const raised = seats[i].raised;
    ctx.strokeStyle = raised ? "#ffc400" : "#4fc3f7";
    ctx.lineWidth = unit * 1.5;
    for (const [a, b] of ARM_LINES) {
      if (!ok(p[a]) || !ok(p[b])) continue;
      ctx.beginPath(); ctx.moveTo(X(p[a].x), p[a].y); ctx.lineTo(X(p[b].x), p[b].y); ctx.stroke();
    }
    const x = X((p[L_SH].x + p[R_SH].x) / 2);
    const y = Math.max(Math.min(p[L_SH].y, p[R_SH].y) - pl.sw, 30 * unit / 2);
    ctx.fillStyle = raised ? "#ffc400" : "rgba(0,0,0,.6)";
    ctx.beginPath(); ctx.arc(x, y, 12 * unit, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = raised ? "#111" : "#fff";
    ctx.font = `bold ${12 * unit}px system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), x, y);
  });

  const mark = (c) => ["鼻", "腕", "肘"].map((n, k) => n + (c[k] ? "○" : "×")).join("");
  const rows = people.map((o, i) =>
    `<div class="${seats[i].raised ? "raised" : ""}">席${i + 1} 左 ${mark(o.c.left[1])} 右 ${mark(o.c.right[1])}` +
    `${seats[i].raised ? " 挙手" : ""}</div>`);
  if (!people.length) rows.push(`<div class="warn">人が見つかりません(両肩が映るように)</div>`);
  hud.innerHTML = `<div>継続 ${cfg.hold.toFixed(1)}秒 ${fps.toFixed(1)}fps ${cfg.model}</div>` + rows.join("");
}

function renderQueue() {
  queueEl.replaceChildren();
  if (!queue.length) {
    queueEl.innerHTML = `<span class="empty">まだ誰も挙げていない</span>`;
    return;
  }
  queue.forEach((s, n) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.innerHTML = `<small>${n + 1}番目</small>席${s + 1}`;
    b.onclick = () => cancel(s);
    queueEl.append(b);
  });
}

let toastTimer = 0;
function showToast(msg, sec = 3) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.style.display = msg ? "block" : "none";
  if (msg) toastTimer = setTimeout(() => (toast.style.display = "none"), sec * 1000);
}

// ---------- 操作 ----------

// 取り消した人は、一度手を下ろして挙げ直すまで並ばない
function cancel(s) {
  if (!queue.includes(s)) return;
  queue = queue.filter((x) => x !== s);
  logRows.push(["", frameNo, s, "", "", "", "", "", "", "", "cancel"]);
  window.kyoshuEvents.push({ seat: s + 1, ev: "cancel" });
  renderQueue();
  showToast(`席${s + 1}を取り消しました`);
}

function reset() {
  queue = [];
  seats.forEach((s) => { s.raised = false; s.since = null; });
  logRows.push(["", frameNo, "", "", "", "", "", "", "", "", "reset"]);
  window.kyoshuEvents.push({ ev: "reset" });
  renderQueue();
}

function beginSession() {
  running = true;
  seats = []; queue = []; logRows = []; frameNo = -1; fps = 0; lastFrameAt = 0;
  window.kyoshuEvents = [];
  renderQueue();
  $("#placeholder").hidden = true;
  canvas.hidden = false; hud.hidden = false;
  $("#stop").disabled = false;
  navigator.wakeLock?.request("screen").then((l) => (wakeLock = l)).catch(() => {});
}

function stop() {
  running = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.pause();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  $("#stop").disabled = true;
}

async function startCamera() {
  stop();
  try {
    await ensureLandmarker();
    const deviceId = $("#camera").value;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }),
               width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (e) {
    showToast(`カメラを開けません: ${e.message}`, 8);
    return;
  }
  video.srcObject = stream;
  await video.play();
  await listCameras();
  source = "camera";
  beginSession();
  const t0 = performance.now();
  const loop = () => {
    if (!running || source !== "camera") return;
    processFrame((performance.now() - t0) / 1000);
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(loop);
    else requestAnimationFrame(loop);
  };
  loop();
}

async function listCameras() {
  const sel = $("#camera"), current = stream?.getVideoTracks()[0]?.getSettings().deviceId ?? sel.value;
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  sel.replaceChildren(...cams.map((d, i) => new Option(d.label || `カメラ${i + 1}`, d.deviceId)));
  if (current) sel.value = current;
}

async function startFile(url, times) {
  stop();
  await ensureLandmarker();
  video.srcObject = null;
  video.src = url;
  await new Promise((r, j) => { video.onloadeddata = r; video.onerror = () => j(new Error("映像を読めません")); });
  source = "file";
  beginSession();
  const n = times.length || Math.floor(video.duration / FILE_STEP);
  for (let i = 0; i < n && running && source === "file"; i++) {
    video.currentTime = Math.min((i + 0.5) * FILE_STEP, video.duration - 0.001);
    await new Promise((r) => (video.onseeked = r));
    processFrame(times[i] ?? i * FILE_STEP);
    // 画面の描き替えと操作の受け付けに一度制御を返す
    await new Promise((r) => setTimeout(r));
  }
  if (running && source === "file") { running = false; $("#stop").disabled = true; showToast("映像の最後まで判定しました", 5); }
  window.kyoshuDone = true;
}

function downloadCsv() {
  const head = ["t", "frame", "person", "lift_left", "src_left", "lift_right", "src_right", "cond_left", "cond_right",
                "raised", "event", ...["left", "right"].flatMap((s) => FEATURE_NAMES.map((n) => `${s}_${n}`))];
  const text = [head, ...logRows].map((r) => r.join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" }));
  const d = new Date(), z = (x) => String(x).padStart(2, "0");
  a.download = `kyoshu-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- 画面の配線 ----------

for (const k of ["over", "forearm", "elbow", "hold"]) {
  const el = $("#" + k), out = $(`#${k}V`);
  const sync = () => { cfg[k] = +el.value; out.textContent = (+el.value).toFixed(2).replace(/0$/, ""); };
  el.oninput = sync;
  sync();
}
$("#mirror").onchange = (e) => (cfg.mirror = e.target.checked);
$("#model").onchange = (e) => (cfg.model = e.target.value);
$("#startCam").onclick = startCamera;
$("#camera").onchange = () => { if (source === "camera" && running) startCamera(); };
$("#stop").onclick = stop;
$("#undoLast").onclick = () => queue.length && cancel(queue.at(-1));
$("#reset").onclick = reset;
$("#csv").onclick = downloadCsv;
$("#timesFile").onchange = async (e) => (timesText = e.target.files[0] ? await e.target.files[0].text() : null);
$("#startFile").onclick = () => {
  const f = $("#videoFile").files[0];
  if (!f) return showToast("先に映像ファイルを選んでください");
  startFile(URL.createObjectURL(f), parseTimes(timesText));
};
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select")) return;
  if (e.key >= "1" && e.key <= "9") cancel(+e.key - 1);
  else if (e.key === "x") queue.length && cancel(queue.at(-1));
  else if (e.key === "r") reset();
});

function parseTimes(text) {
  return text ? text.split(/\s+/).filter(Boolean).map(Number) : [];
}

// 検証用: ?video=<URL>&times=<URL> で録画を読んですぐ判定する
const params = new URLSearchParams(location.search);
if (params.get("model")) { cfg.model = params.get("model"); $("#model").value = cfg.model; }
if (params.get("mirror") === "0") { cfg.mirror = false; $("#mirror").checked = false; }
if (params.get("video")) {
  const tp = params.get("times");
  const times = tp ? parseTimes(await (await fetch(tp)).text()) : [];
  // python -m http.server は Range 要求に応えず、そのままではシークできないので丸ごと読んでおく
  const blob = await (await fetch(params.get("video"))).blob();
  startFile(URL.createObjectURL(blob), times).catch((e) => showToast(e.message, 8));
}
