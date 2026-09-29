export const NOSE = 0;
export const L_SH = 11;
export const R_SH = 12;
export const L_EL = 13;
export const R_EL = 14;
export const L_WR = 15;
export const R_WR = 16;

export const KP_CONF = 0.4;
export const FEATURE_NAMES = ["wrist_side", "wrist_over_nose", "forearm_up", "elbow_lift"];

export const DEFAULT_DETECTION_CONFIG = Object.freeze({
  over: 0.10,
  forearm: 0.15,
  elbow: 0.02,
  hold: 0.6,
});

export function ok(point) {
  return point.v >= KP_CONF;
}

export function liftOf(points, shoulder, elbow, wrist, shoulderWidth) {
  if (!ok(points[shoulder])) return [null, ""];
  if (ok(points[wrist])) return [(points[shoulder].y - points[wrist].y) / shoulderWidth, "手首"];
  if (ok(points[elbow])) return [(points[shoulder].y - points[elbow].y) / shoulderWidth, "肘"];
  return [null, ""];
}

export function armFeatures(points, shoulder, elbow, wrist, shoulderWidth) {
  const features = Object.fromEntries(FEATURE_NAMES.map((name) => [name, null]));
  if (ok(points[wrist]) && ok(points[NOSE])) {
    features.wrist_side = Math.abs(points[wrist].x - points[NOSE].x) / shoulderWidth;
    features.wrist_over_nose = (points[NOSE].y - points[wrist].y) / shoulderWidth;
  }
  if (ok(points[wrist]) && ok(points[elbow])) features.forearm_up = (points[elbow].y - points[wrist].y) / shoulderWidth;
  if (ok(points[elbow]) && ok(points[shoulder])) features.elbow_lift = (points[shoulder].y - points[elbow].y) / shoulderWidth;
  return features;
}

export function personLift(points) {
  if (!ok(points[L_SH]) || !ok(points[R_SH])) return null;
  const shoulderWidth = Math.hypot(points[L_SH].x - points[R_SH].x, points[L_SH].y - points[R_SH].y);
  if (shoulderWidth < 10) return null;
  const left = liftOf(points, L_SH, L_EL, L_WR, shoulderWidth);
  const right = liftOf(points, R_SH, R_EL, R_WR, shoulderWidth);
  // 体の一部が隠れて肩幅を小さく誤測すると、ありえない値が出る
  if ([left, right].some(([value]) => value !== null && Math.abs(value) > 3)) return null;
  return {
    sw: shoulderWidth,
    left,
    right,
    feat: {
      left: armFeatures(points, L_SH, L_EL, L_WR, shoulderWidth),
      right: armFeatures(points, R_SH, R_EL, R_WR, shoulderWidth),
    },
  };
}

export function armRaised(features, config) {
  const values = [features.wrist_over_nose, features.forearm_up, features.elbow_lift];
  const thresholds = [config.over, config.forearm, config.elbow];
  const conditions = values.map((value, index) => value !== null && value >= thresholds[index]);
  return [conditions.every(Boolean), conditions];
}

export class Seat {
  constructor() {
    this.raised = false;
    this.since = null;
  }

  update(above, now, hold) {
    if (above !== this.raised) {
      if (this.since === null) this.since = now;
      else if (now - this.since >= hold) {
        this.raised = above;
        this.since = null;
        return above ? "raise" : "lower";
      }
    } else this.since = null;
    return null;
  }
}
