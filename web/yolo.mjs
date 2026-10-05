import { L_EL, L_SH, L_WR, NOSE, R_EL, R_SH, R_WR } from "./detection.mjs";

export function yoloInputSize(width, height, longSide) {
  const scale = longSide / Math.max(width, height);
  const resizedWidth = Math.max(1, Math.round(width * scale));
  const resizedHeight = Math.max(1, Math.round(height * scale));
  return {
    scale,
    resizedWidth,
    resizedHeight,
    width: Math.ceil(resizedWidth / 32) * 32,
    height: Math.ceil(resizedHeight / 32) * 32,
  };
}

const COCO_TO_MEDIAPIPE = new Map([
  [0, NOSE], [5, L_SH], [6, R_SH], [7, L_EL], [8, R_EL], [9, L_WR], [10, R_WR],
]);

export function yoloRowsToPeople(data, scale, confidence = 0.25) {
  const people = [];
  for (let offset = 0; offset + 56 < data.length; offset += 57) {
    if (data[offset + 4] < confidence) continue;
    const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }));
    for (const [cocoIndex, mediaPipeIndex] of COCO_TO_MEDIAPIPE) {
      const point = offset + 6 + cocoIndex * 3;
      points[mediaPipeIndex] = {
        x: data[point] / scale,
        y: data[point + 1] / scale,
        v: data[point + 2],
      };
    }
    people.push(points);
  }
  return people;
}
