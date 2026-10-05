export function cropRect(seat, width, height) {
  const seatWidth = seat.w * width;
  const x = seat.x * width;
  const y = seat.y * height;
  const left = Math.max(0, x - seatWidth / 2);
  const top = Math.max(0, y - seatWidth * 0.9);
  const right = Math.min(width, x + seatWidth / 2);
  const bottom = Math.min(height, y + seatWidth * 1.1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function mapCropPoint(point, rect) {
  return {
    x: rect.x + point.x * rect.width,
    y: rect.y + point.y * rect.height,
    v: point.visibility ?? point.v ?? 1,
  };
}

export function parseSeats(text) {
  if (!text) return null;
  const seats = text.split(";").filter(Boolean).map((entry) => {
    const [x, y, w] = entry.split(",").map(Number);
    return { x, y, w };
  });
  return seats.every((seat) => [seat.x, seat.y, seat.w].every(Number.isFinite)) ? seats : null;
}
