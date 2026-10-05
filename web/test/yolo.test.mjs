import assert from "node:assert/strict";
import test from "node:test";
import { yoloInputSize, yoloRowsToPeople } from "../yolo.mjs";

test("YOLO の入力は長辺を合わせて右下を32の倍数まで広げる", () => {
  assert.deepEqual(yoloInputSize(1280, 720, 960), {
    scale: 0.75, resizedWidth: 960, resizedHeight: 540, width: 960, height: 544,
  });
});

test("YOLO のCOCO点をMediaPipe互換の33点へ変換する", () => {
  const row = new Float32Array(57);
  row[4] = 0.9;
  row[6] = 150;
  row[7] = 75;
  row[8] = 0.75;
  row[6 + 9 * 3] = 300;
  row[6 + 9 * 3 + 1] = 150;
  row[6 + 9 * 3 + 2] = 0.5;
  const [points] = yoloRowsToPeople(row, 1.5);
  assert.deepEqual(points[0], { x: 100, y: 50, v: 0.75 });
  assert.deepEqual(points[15], { x: 200, y: 100, v: 0.5 });
  assert.equal(points[1].v, 0);
});
