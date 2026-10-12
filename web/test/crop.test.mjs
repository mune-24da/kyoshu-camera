import assert from "node:assert/strict";
import test from "node:test";
import {
  clampRect,
  cropRect,
  defaultRectAt,
  hitTest,
  mapCropPoint,
  moveRect,
  parseSeats,
  rectFromDrag,
  resizeRect,
  scaleRect,
  seatsFromPeople,
} from "../crop.mjs";

test("切り出し範囲は映像外を切り詰める", () => {
  const rect = cropRect({ x: 0.05, y: 0.1, w: 0.2 }, 1000, 500);
  const rounded = Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Math.round(value)]));
  assert.deepEqual(rounded, { x: 0, y: 0, width: 150, height: 270 });
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

const near = (actual, expected) => {
  for (const key of Object.keys(expected)) {
    assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${key}: ${actual[key]} != ${expected[key]}`);
  }
};

test("枠の形式の席はそのまま切り出し範囲になる", () => {
  near(cropRect({ left: 0.1, top: 0.2, width: 0.5, height: 0.6 }, 1000, 500), {
    x: 100, y: 100, width: 500, height: 300,
  });
});

test("URL の席指定は4つの値なら枠の形式として読む", () => {
  assert.deepEqual(parseSeats(".1,.2,.3,.4"), [{ left: 0.1, top: 0.2, width: 0.3, height: 0.4 }]);
  assert.equal(parseSeats("1,2"), null);
});

test("枠は映像の全体まで広げられ、外にはみ出さない", () => {
  near(scaleRect({ left: 0.4, top: 0.4, width: 0.2, height: 0.2 }, 100), {
    left: 0, top: 0, width: 1, height: 1,
  });
  near(moveRect({ left: 0.8, top: 0.8, width: 0.3, height: 0.3 }, 0.5, 0.5), {
    left: 0.7, top: 0.7, width: 0.3, height: 0.3,
  });
  near(clampRect({ left: -1, top: 2, width: 0.001, height: 5 }), {
    left: 0, top: 0, width: 0.03, height: 1,
  });
});

test("なぞった2点から枠を作る(向きは問わない)", () => {
  near(rectFromDrag({ x: 0.6, y: 0.7 }, { x: 0.2, y: 0.3 }), {
    left: 0.2, top: 0.3, width: 0.4, height: 0.4,
  });
});

test("角を動かすと反対側の角は動かない", () => {
  const rect = { left: 0.2, top: 0.2, width: 0.2, height: 0.2 };
  near(resizeRect(rect, "se", { x: 0.9, y: 0.8 }), { left: 0.2, top: 0.2, width: 0.7, height: 0.6 });
  near(resizeRect(rect, "nw", { x: 0.1, y: 0.05 }), { left: 0.1, top: 0.05, width: 0.3, height: 0.35 });
  near(resizeRect(rect, "nw", { x: 0.9, y: 0.9 }), { left: 0.37, top: 0.37, width: 0.03, height: 0.03 });
});

test("押した位置は、選択中の席の角、次に面積の小さい席の中の順で当たる", () => {
  const seats = [
    { left: 0.1, top: 0.1, width: 0.8, height: 0.8 },
    { left: 0.4, top: 0.4, width: 0.1, height: 0.1 },
  ];
  assert.deepEqual(hitTest(seats, 0, { x: 0.11, y: 0.11 }, 0.03, 0.03), { index: 0, part: "nw" });
  assert.deepEqual(hitTest(seats, null, { x: 0.45, y: 0.45 }, 0.03, 0.03), { index: 1, part: "body" });
  assert.deepEqual(hitTest(seats, null, { x: 0.2, y: 0.2 }, 0.03, 0.03), { index: 0, part: "body" });
  assert.equal(hitTest(seats, null, { x: 0.95, y: 0.95 }, 0.03, 0.03), null);
});

test("1回押しただけの席は、直前の席と同じ大きさで頭の位置に置く", () => {
  const first = defaultRectAt({ x: 0.5, y: 0.5 }, undefined, 1280, 720);
  near(first, { left: 0.44, top: 0.5 - first.height * 0.45, width: 0.12 });
  const next = defaultRectAt({ x: 0.3, y: 0.6 }, { width: 0.2, height: 0.5 }, 1280, 720);
  near(next, { left: 0.2, top: 0.6 - 0.5 * 0.45, width: 0.2, height: 0.5 });
});

test("見つけた人から席の候補を作り、表示上の左から並べる", () => {
  const person = (x) => {
    const points = Array.from({ length: 17 }, () => ({ x: 0, y: 0, v: 0 }));
    points[0] = { x, y: 300, v: 1 };
    points[1] = { x: x + 30, y: 340, v: 1 };
    points[2] = { x: x - 30, y: 340, v: 1 };
    return { box: [x - 50, 280, x + 50, 480], points };
  };
  const indexes = { nose: 0, leftShoulder: 1, rightShoulder: 2 };
  const seats = seatsFromPeople([person(900), person(300)], 1280, 720, indexes);
  assert.equal(seats.length, 2);
  assert.ok(seats[0].left < seats[1].left);
  const first = seats[0];
  // 箱の高さ200から見積もった大きさ(62.5)のほうが肩幅60より大きいので、枠の幅は 62.5 × 2.9
  assert.ok(Math.abs(first.width * 1280 - 62.5 * 2.9) < 1e-6);
  assert.ok(first.top * 720 < 300 && (first.top + first.height) * 720 > 480);
  const mirrored = seatsFromPeople([person(900), person(300)], 1280, 720, indexes, true);
  assert.ok(mirrored[0].left > mirrored[1].left);
});
