import { L_EL, L_SH, L_WR, NOSE, R_EL, R_SH, R_WR } from "./detection.mjs";

export const MOVENET_SIZE = 192;

// MoveNet は小さく映った人の点に低めの確信度を付ける。確信度 0.3 を、判定側の基準(0.4)にちょうど届く値へ引き上げる。
// 会場の録画で、これで MediaPipe とほぼ同じ人数を追えた
const SCORE_GAIN = 0.4 / 0.3;

// MoveNet の17点(COCO の並び)のうち、判定に使う点だけを MediaPipe の番号へ対応させる
const MOVENET_TO_MEDIAPIPE = [
  [0, NOSE], [5, L_SH], [6, R_SH], [7, L_EL], [8, R_EL], [9, L_WR], [10, R_WR],
];

// 切り出した範囲を、縦横比を保ったまま正方形の入力の中央に置くときの倍率と余白
export function letterbox(width, height, size = MOVENET_SIZE) {
  const scale = size / Math.max(width, height);
  return {
    scale,
    width: width * scale,
    height: height * scale,
    offsetX: (size - width * scale) / 2,
    offsetY: (size - height * scale) / 2,
  };
}

// MoveNet の出力(17点 × [y, x, 確信度]、正方形の入力に対する割合)を、映像全体のピクセル座標の点へ戻す
export function moveNetToPoints(data, box, rect, size = MOVENET_SIZE) {
  const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }));
  for (const [source, target] of MOVENET_TO_MEDIAPIPE) {
    points[target] = {
      x: rect.x + (data[source * 3 + 1] * size - box.offsetX) / box.scale,
      y: rect.y + (data[source * 3] * size - box.offsetY) / box.scale,
      v: Math.min(1, data[source * 3 + 2] * SCORE_GAIN),
    };
  }
  return points;
}
