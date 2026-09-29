import { L_SH, R_SH } from "./detection.mjs";

export function personPosition(person) {
  return {
    x: (person.p[L_SH].x + person.p[R_SH].x) / 2,
    y: (person.p[L_SH].y + person.p[R_SH].y) / 2,
    sw: person.pl.sw,
  };
}

export function registerSeatPositions(people) {
  return people.map(personPosition);
}

export function allocateSeats(seats, people, follow = 0.1) {
  const positions = people.map(personPosition);
  const pairs = [];
  seats.forEach((seat, seatIndex) => positions.forEach((person, personIndex) => {
    const distance = Math.hypot(seat.x - person.x, seat.y - person.y);
    if (distance <= seat.sw * 1.5) pairs.push({ seatIndex, personIndex, distance });
  }));
  pairs.sort((left, right) => left.distance - right.distance);
  const usedSeats = new Set(), usedPeople = new Set();
  const assignment = Array(people.length).fill(null);
  for (const pair of pairs) {
    if (usedSeats.has(pair.seatIndex) || usedPeople.has(pair.personIndex)) continue;
    usedSeats.add(pair.seatIndex);
    usedPeople.add(pair.personIndex);
    assignment[pair.personIndex] = pair.seatIndex;
  }
  const nextSeats = seats.map((seat, index) => {
    const personIndex = assignment.indexOf(index);
    if (personIndex === -1) return { ...seat };
    const person = positions[personIndex];
    return {
      ...seat,
      x: seat.x + (person.x - seat.x) * follow,
      y: seat.y + (person.y - seat.y) * follow,
      sw: seat.sw + (person.sw - seat.sw) * follow,
    };
  });
  return { assignment, seats: nextSeats };
}
