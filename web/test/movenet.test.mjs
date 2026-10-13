import assert from "node:assert/strict";
import test from "node:test";
import { letterbox, moveNetToPoints } from "../movenet.mjs";

test("縦長の切り出しは、正方形の入力の中央に左右の余白をつけて置く", () => {
  assert.deepEqual(letterbox(100, 200, 192), {
    scale: 0.96, width: 96, height: 192, offsetX: 48, offsetY: 0,
  });
});

test("MoveNet の点を映像全体の座標へ戻し、確信度0.3を判定の基準0.4に合わせる", () => {
  const data = new Float32Array(17 * 3);
  // 鼻: 入力の中央(y=0.5, x=0.5)、確信度0.3
  data.set([0.5, 0.5, 0.3], 0);
  // 左手首(9番): 入力の左上の角から、余白の分だけ右
  data.set([0, 0.25, 0.9], 9 * 3);
  const rect = { x: 1000, y: 400, width: 100, height: 200 };
  const points = moveNetToPoints(data, letterbox(rect.width, rect.height, 192), rect, 192);
  assert.ok(Math.abs(points[0].x - 1050) < 1e-3 && Math.abs(points[0].y - 500) < 1e-3);
  assert.ok(Math.abs(points[0].v - 0.4) < 1e-6);
  assert.ok(Math.abs(points[15].x - 1000) < 1e-3 && Math.abs(points[15].y - 400) < 1e-3);
  assert.equal(points[15].v, 1);
  assert.equal(points[1].v, 0);
});
