import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DETECTION_CONFIG, L_EL, L_SH, L_WR, NOSE, R_SH, Seat,
  armRaised, personLift,
} from "../detection.mjs";

const point = (x = 0, y = 0, v = 1) => ({ x, y, v });

function person() {
  const points = Array.from({ length: 33 }, () => point());
  points[NOSE] = point(50, 50);
  points[L_SH] = point(0, 100);
  points[R_SH] = point(100, 100);
  points[L_EL] = point(0, 80);
  points[L_WR] = point(0, 60);
  return points;
}

test("3条件はしきい値ちょうどを含み、どれか一つでも下回ると挙手にしない", () => {
  const config = DEFAULT_DETECTION_CONFIG;
  const features = { wrist_over_nose: config.over, forearm_up: config.forearm, elbow_lift: config.elbow };
  assert.deepEqual(armRaised(features, config), [true, [true, true, true]]);
  for (const name of Object.keys(features)) {
    const below = { ...features, [name]: features[name] - 0.001 };
    assert.equal(armRaised(below, config)[0], false, name);
  }
});

test("手首が見えないときは肘で持ち上がりを代用する", () => {
  const points = person();
  points[L_WR].v = 0.39;
  const result = personLift(points);
  assert.deepEqual(result.left, [0.2, "肘"]);
  assert.equal(result.feat.left.wrist_over_nose, null);
});

test("肩幅が小さすぎる人と異常な肩幅比の人を捨てる", () => {
  const narrow = person();
  narrow[R_SH] = point(9, 100);
  assert.equal(personLift(narrow), null);

  const impossible = person();
  impossible[L_WR] = point(0, -201);
  assert.equal(personLift(impossible), null);
});

test("Seat は継続秒数だけ挙手・解除を待つ", () => {
  const seat = new Seat();
  assert.equal(seat.update(true, 0, 0.6), null);
  assert.equal(seat.update(true, 0.599, 0.6), null);
  assert.equal(seat.update(true, 0.6, 0.6), "raise");
  assert.equal(seat.raised, true);
  assert.equal(seat.update(false, 1, 0.6), null);
  assert.equal(seat.update(false, 1.6, 0.6), "lower");
  assert.equal(seat.raised, false);
});

test("取り消した席は下ろして挙げ直すまで再び並べない", () => {
  const seat = new Seat();
  const queue = [];
  const update = (above, now) => {
    const event = seat.update(above, now, 0.6);
    if (event === "raise" && !queue.includes(0)) queue.push(0);
  };
  update(true, 0); update(true, 0.6);
  assert.deepEqual(queue, [0]);
  queue.splice(0, 1);
  update(true, 1.2);
  assert.deepEqual(queue, []);
  update(false, 1.3); update(false, 1.91);
  update(true, 2); update(true, 2.61);
  assert.deepEqual(queue, [0]);
});
