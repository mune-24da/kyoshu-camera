import assert from "node:assert/strict";
import test from "node:test";
import { cropRect, mapCropPoint, parseSeats } from "../crop.mjs";

test("切り出し範囲は映像外を切り詰める", () => {
  assert.deepEqual(cropRect({ x: 0.05, y: 0.1, w: 0.2 }, 1000, 500), {
    x: 0, y: 0, width: 150, height: 270,
  });
});

test("切り出し座標を映像全体の座標へ戻す", () => {
  assert.deepEqual(mapCropPoint({ x: 0.5, y: 0.25, visibility: 0.8 }, {
    x: 100, y: 50, width: 200, height: 400,
  }), { x: 200, y: 150, v: 0.8 });
});

test("URL の席指定を読み取る", () => {
  assert.deepEqual(parseSeats(".2,.3,.08;.5,.6,.1"), [
    { x: 0.2, y: 0.3, w: 0.08 }, { x: 0.5, y: 0.6, w: 0.1 },
  ]);
});
