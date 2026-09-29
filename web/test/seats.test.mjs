import test from "node:test";
import assert from "node:assert/strict";
import { allocateSeats, registerSeatPositions } from "../seats.mjs";

const person = (x, y = 100, sw = 40) => ({
  p: Object.assign(Array.from({ length: 13 }, () => ({ x: 0, y: 0 })), { 11: { x: x - sw / 2, y }, 12: { x: x + sw / 2, y } }),
  pl: { sw },
});

test("席は近い組から一対一に割り当て、登録位置を追従する", () => {
  const seats = registerSeatPositions([person(100), person(200)]);
  const result = allocateSeats(seats, [person(205), person(105)]);
  assert.deepEqual(result.assignment, [1, 0]);
  assert.equal(result.seats[0].x, 100.5);
  assert.equal(result.seats[1].x, 200.5);
});

test("肩幅の1.5倍より離れた人はどの席にも割り当てない", () => {
  const result = allocateSeats(registerSeatPositions([person(100)]), [person(161)]);
  assert.deepEqual(result.assignment, [null]);
  assert.equal(result.seats[0].x, 100);
});
