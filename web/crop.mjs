// 席の枠は { left, top, width, height }(映像の幅・高さに対する割合)で持つ。
// 頭の位置で指定する旧形式 { x, y, w }(頭の中心と幅)は URL と古い保存値にだけ残っている。

const MIN_SIZE = 0.03;
// 頭の位置から枠を作るときの比率。枠の高さは幅の2倍(ピクセル)で、頭は上から45%の位置に来る
const HEAD_ABOVE = 0.9;
const HEAD_BELOW = 1.1;
// 自動で席を置くときの、体の大きさの単位(肩幅相当)に対する枠の幅
const AUTO_WIDTH = 2.9;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function isHeadSeat(seat) {
  return seat.left === undefined;
}

export function headSeatToRect(seat, videoWidth, videoHeight) {
  const widthPx = seat.w * videoWidth;
  const left = clamp(seat.x - seat.w / 2, 0, 1);
  const top = clamp(seat.y - (widthPx * HEAD_ABOVE) / videoHeight, 0, 1);
  const right = clamp(seat.x + seat.w / 2, 0, 1);
  const bottom = clamp(seat.y + (widthPx * HEAD_BELOW) / videoHeight, 0, 1);
  return { left, top, width: right - left, height: bottom - top };
}

export function toRectSeat(seat, videoWidth, videoHeight) {
  if (isHeadSeat(seat)) return headSeatToRect(seat, videoWidth, videoHeight);
  return { left: seat.left, top: seat.top, width: seat.width, height: seat.height };
}

export function cropRect(seat, width, height) {
  const rect = toRectSeat(seat, width, height);
  return {
    x: rect.left * width,
    y: rect.top * height,
    width: rect.width * width,
    height: rect.height * height,
  };
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
    const values = entry.split(",").map(Number);
    if (!values.every(Number.isFinite)) return null;
    if (values.length === 3) return { x: values[0], y: values[1], w: values[2] };
    if (values.length === 4) {
      return { left: values[0], top: values[1], width: values[2], height: values[3] };
    }
    return null;
  });
  return seats.every(Boolean) ? seats : null;
}

export function clampRect(rect) {
  const width = clamp(rect.width, MIN_SIZE, 1);
  const height = clamp(rect.height, MIN_SIZE, 1);
  return {
    left: clamp(rect.left, 0, 1 - width),
    top: clamp(rect.top, 0, 1 - height),
    width,
    height,
  };
}

export function rectFromDrag(start, end) {
  return clampRect({
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  });
}

// 映像を1回押しただけのときに置く枠。大きさは直前の席に合わせる
export function defaultRectAt(point, previous, videoWidth, videoHeight) {
  const width = previous?.width ?? 0.12;
  const height = previous?.height ?? Math.min(1, (width * videoWidth * 2) / videoHeight);
  const headAt = HEAD_ABOVE / (HEAD_ABOVE + HEAD_BELOW);
  return clampRect({
    left: point.x - width / 2,
    top: point.y - height * headAt,
    width,
    height,
  });
}

export function moveRect(rect, dx, dy) {
  return clampRect({ ...rect, left: rect.left + dx, top: rect.top + dy });
}

// 角を持って動かす。part は "nw" "ne" "sw" "se" で、反対側の角は動かさない
export function resizeRect(rect, part, point) {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const x = clamp(point.x, 0, 1);
  const y = clamp(point.y, 0, 1);
  const left = part.includes("w") ? Math.min(x, right - MIN_SIZE) : rect.left;
  const top = part.includes("n") ? Math.min(y, bottom - MIN_SIZE) : rect.top;
  const newRight = part.includes("e") ? Math.max(x, left + MIN_SIZE) : right;
  const newBottom = part.includes("s") ? Math.max(y, top + MIN_SIZE) : bottom;
  return { left, top, width: newRight - left, height: newBottom - top };
}

export function scaleRect(rect, factor) {
  const width = clamp(rect.width * factor, MIN_SIZE, 1);
  const height = clamp(rect.height * factor, MIN_SIZE, 1);
  return clampRect({
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  });
}

// 押した位置が、どの席のどこに当たるか。角は選択中の席だけ、枠の中は面積の小さい席を優先する
// (大きい枠の中に小さい枠が入っていても選べるように)
export function hitTest(seats, selected, point, radiusX, radiusY) {
  const seat = seats[selected];
  if (seat) {
    const corners = {
      nw: [seat.left, seat.top],
      ne: [seat.left + seat.width, seat.top],
      sw: [seat.left, seat.top + seat.height],
      se: [seat.left + seat.width, seat.top + seat.height],
    };
    for (const [part, [x, y]] of Object.entries(corners)) {
      if (Math.abs(point.x - x) <= radiusX && Math.abs(point.y - y) <= radiusY) {
        return { index: selected, part };
      }
    }
  }
  let best = null;
  seats.forEach((candidate, index) => {
    const inside = point.x >= candidate.left && point.x <= candidate.left + candidate.width
      && point.y >= candidate.top && point.y <= candidate.top + candidate.height;
    if (!inside) return;
    const area = candidate.width * candidate.height;
    if (!best || area < best.area) best = { index, area };
  });
  return best ? { index: best.index, part: "body" } : null;
}

// 全体から探した人(箱と点)から、席の枠の候補を作る。表示上の左から順に並べる
export function seatsFromPeople(people, videoWidth, videoHeight, indexes, mirror = false) {
  const seats = people.map(({ box, points }) => {
    const nose = points[indexes.nose];
    const leftShoulder = points[indexes.leftShoulder];
    const rightShoulder = points[indexes.rightShoulder];
    const shoulders = leftShoulder.v > 0 && rightShoulder.v > 0;
    const shoulderWidth = shoulders
      ? Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y)
      : 0;
    // 横を向いた人は肩幅が小さく出るので、箱の高さからも大きさを見積もる
    const unit = Math.max(shoulderWidth, (box[3] - box[1]) / 3.2);
    const headX = shoulders ? (leftShoulder.x + rightShoulder.x) / 2 : (box[0] + box[2]) / 2;
    const headY = nose.v > 0 ? nose.y : box[1] + unit * 0.4;
    return headSeatToRect({
      x: headX / videoWidth,
      y: headY / videoHeight,
      w: (unit * AUTO_WIDTH) / videoWidth,
    }, videoWidth, videoHeight);
  });
  const center = (seat) => seat.left + seat.width / 2;
  return seats.sort((a, b) => (mirror ? center(b) - center(a) : center(a) - center(b)));
}
