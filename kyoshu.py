"""ウェブカメラで挙手を検出し、挙げた順に並べる試験用スクリプト。

挙手の判定: 左右どちらかの腕で、手首が鼻より上・前腕が立っている・肘が肩より上、
の3条件がそろった状態が --hold 秒続いたら挙手とする。

キー操作:
  1〜9 … その席を順番から取り消す(誤検出を司会が消す)
  x  … 最後に並んだ人を取り消す
  r  … 挙手の順番をリセット
  q / Esc … 終了
"""

import argparse
import csv
import sys
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from ultralytics import YOLO

# COCO 17点の番号
NOSE, L_SH, R_SH, L_EL, R_EL, L_WR, R_WR = 0, 5, 6, 7, 8, 9, 10
KP_CONF = 0.4

FONT_PATHS = [r"C:\Windows\Fonts\meiryo.ttc", r"C:\Windows\Fonts\YuGothM.ttc",
              "/System/Library/Fonts/ヒラギノ角ゴシック W4.ttc"]


def load_font(size):
    for p in FONT_PATHS:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def lift_of(kp, conf, sh, el, wr, sw):
    """肩からの持ち上がりを肩幅で割った値。正なら肩より上。手首が見えなければ肘で代用する。"""
    if conf[sh] < KP_CONF:
        return None, ""
    if conf[wr] >= KP_CONF:
        return (kp[sh][1] - kp[wr][1]) / sw, "手首"
    if conf[el] >= KP_CONF:
        return (kp[sh][1] - kp[el][1]) / sw, "肘"
    return None, ""


def person_lift(kp, conf):
    if conf[L_SH] < KP_CONF or conf[R_SH] < KP_CONF:
        return None
    sw = float(np.linalg.norm(kp[L_SH] - kp[R_SH]))
    if sw < 10:
        return None
    left = lift_of(kp, conf, L_SH, L_EL, L_WR, sw)
    right = lift_of(kp, conf, R_SH, R_EL, R_WR, sw)
    # 体の一部が隠れて肩幅を小さく誤測すると、ありえない値が出る
    if any(v is not None and abs(v) > 3 for v, _ in (left, right)):
        return None
    return {"sw": sw, "left": left, "right": right,
            "best": max([v for v, _ in (left, right) if v is not None], default=None),
            "feat": {"left": arm_features(kp, conf, L_SH, L_EL, L_WR, sw),
                     "right": arm_features(kp, conf, R_SH, R_EL, R_WR, sw)}}


FEATURE_NAMES = ["wrist_side", "wrist_over_nose", "forearm_up", "elbow_lift"]


def arm_features(kp, conf, sh, el, wr, sw):
    """挙手と頭をかく・顔に触る動きを見分ける候補の値(いずれも肩幅比)。

    wrist_side      … 手首が鼻から横にどれだけ離れているか(顔の前なら小さい)
    wrist_over_nose … 手首が鼻よりどれだけ上か
    forearm_up      … 手首が肘よりどれだけ上か(前腕が立っているか)
    elbow_lift      … 肘が肩からどれだけ上がっているか
    """
    ok = lambda i: conf[i] >= KP_CONF
    f = dict.fromkeys(FEATURE_NAMES)
    if ok(wr) and ok(NOSE):
        f["wrist_side"] = abs(kp[wr][0] - kp[NOSE][0]) / sw
        f["wrist_over_nose"] = (kp[NOSE][1] - kp[wr][1]) / sw
    if ok(wr) and ok(el):
        f["forearm_up"] = (kp[el][1] - kp[wr][1]) / sw
    if ok(el) and ok(sh):
        f["elbow_lift"] = (kp[sh][1] - kp[el][1]) / sw
    return f


def arm_raised(f, over, forearm, elbow):
    """3条件の成否。顔に手を当てる・飲む動きは手首が鼻より下、頭をかく動きの一部は肘が肩より下になる。"""
    conds = [f["wrist_over_nose"], f["forearm_up"], f["elbow_lift"]]
    ok = [v is not None and v >= th for v, th in zip(conds, (over, forearm, elbow))]
    return all(ok), ok


class Seat:
    """1人分の挙手状態。基準を超えた状態が hold 秒続いたら挙手、下回りが hold 秒続いたら解除。"""

    def __init__(self):
        self.raised = False
        self.since = None
        self.raised_at = None

    def update(self, above, now, hold):
        if above != self.raised:
            if self.since is None:
                self.since = now
            elif now - self.since >= hold:
                self.raised = above
                self.since = None
                if above:
                    self.raised_at = now
                    return "raise"
                return "lower"
        else:
            self.since = None
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--model", default="yolo11n-pose.pt")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default="cpu")
    # 3条件の基準はいずれも肩幅を1とした値
    ap.add_argument("--over", type=float, default=0.10, help="手首が鼻よりどれだけ上にあればよいか")
    ap.add_argument("--forearm", type=float, default=0.15, help="手首が肘よりどれだけ上にあればよいか")
    ap.add_argument("--elbow", type=float, default=0.02, help="肘が肩よりどれだけ上にあればよいか")
    ap.add_argument("--hold", type=float, default=0.6, help="挙手とみなすまでの継続秒数")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--record", action="store_true",
                    help="検証用にカメラの映像を logs/ に保存する")
    ap.add_argument("--video", help="カメラの代わりに保存済みの映像を読む")
    args = ap.parse_args()

    model = YOLO(args.model)
    if args.video:
        cap = cv2.VideoCapture(args.video)
        video_fps = cap.get(cv2.CAP_PROP_FPS) or 10
        times_path = Path(args.video).with_suffix(".times.txt")
        frame_times = ([float(x) for x in times_path.read_text(encoding="utf-8").split()]
                       if times_path.exists() else [])
    else:
        cap = cv2.VideoCapture(args.camera, cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
    if not cap.isOpened():
        raise SystemExit(f"{args.video or 'カメラ ' + str(args.camera)} を開けません")

    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    log_file = open(log_dir / f"{stamp}.csv", "w", newline="", encoding="utf-8", buffering=1)
    log = csv.writer(log_file)
    log.writerow(["t", "frame", "person", "lift_left", "src_left", "lift_right", "src_right",
                  "cond_left", "cond_right", "raised", "event"]
                 + [f"{side}_{n}" for side in ("left", "right") for n in FEATURE_NAMES])
    writer = None
    frame_no = -1

    font = load_font(22)
    hold = args.hold
    seats = {}
    queue = []
    message, message_until = "", 0.0
    t0 = time.perf_counter()
    fps, last = 0.0, t0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame_no += 1
        if args.video:
            # 録画時の各コマの時刻で再生する。処理速度に左右されないように
            now = frame_times[frame_no] if frame_no < len(frame_times) else frame_no / video_fps
        else:
            now = time.perf_counter() - t0
        if args.record:
            if writer is None:
                # コマ間隔は処理速度で変わるので、各コマの実時刻を別ファイルに残す
                writer = cv2.VideoWriter(str(log_dir / f"{stamp}.mp4"), cv2.VideoWriter_fourcc(*"mp4v"),
                                         10, (frame.shape[1], frame.shape[0]))
                times_file = open(log_dir / f"{stamp}.times.txt", "w", encoding="utf-8", buffering=1)
            writer.write(frame)
            times_file.write(f"{now:.3f}\n")

        res = model(frame, imgsz=args.imgsz, device=args.device, verbose=False)[0]
        people = []
        if res.keypoints is not None and len(res.keypoints):
            kps = res.keypoints.xy.cpu().numpy()
            confs = res.keypoints.conf.cpu().numpy() if res.keypoints.conf is not None else None
            for kp, cf in zip(kps, confs if confs is not None else [None] * len(kps)):
                if cf is None:
                    continue
                pl = person_lift(kp, cf)
                if pl is not None:
                    people.append((kp, cf, pl))
        # 席番号は鏡像表示の左から順に振る(試験用。本番は席の位置を登録する)
        people.sort(key=lambda p: -(p[0][L_SH][0] + p[0][R_SH][0]) / 2)

        conds = []
        for i, (kp, cf, pl) in enumerate(people):
            seat = seats.setdefault(i, Seat())
            c = {side: arm_raised(pl["feat"][side], args.over, args.forearm, args.elbow)
                 for side in ("left", "right")}
            conds.append(c)
            ev = seat.update(c["left"][0] or c["right"][0], now, hold)
            if ev == "raise" and i not in queue:
                queue.append(i)
            (lv, ls), (rv, rs) = pl["left"], pl["right"]
            num = lambda v: "" if v is None else f"{v:.3f}"
            flags = lambda ok: "".join("1" if x else "0" for x in ok)
            log.writerow([f"{now:.3f}", frame_no, i, num(lv), ls, num(rv), rs,
                          flags(c["left"][1]), flags(c["right"][1]), int(seat.raised), ev or ""]
                         + [num(pl["feat"][side][n]) for side in ("left", "right") for n in FEATURE_NAMES])

        # 推定は反転前の映像で行う(反転してから推定すると左右の手を取り違える)。表示だけ鏡像にする
        vis = cv2.flip(res.plot(boxes=False) if len(people) else frame.copy(), 1)
        for i, (kp, cf, pl) in enumerate(people):
            seat = seats[i]
            if seat.raised:
                x = vis.shape[1] - 1 - int((kp[L_SH][0] + kp[R_SH][0]) / 2)
                y = int(min(kp[L_SH][1], kp[R_SH][1]) - pl["sw"])
                cv2.circle(vis, (x, max(y, 30)), 24, (0, 200, 255), -1)

        img = Image.fromarray(cv2.cvtColor(vis, cv2.COLOR_BGR2RGB))
        d = ImageDraw.Draw(img)
        h = img.height
        d.rectangle([0, 0, 470, 40 + 30 * max(3, len(people) + 2)], fill=(0, 0, 0))
        dt = time.perf_counter() - last
        last = time.perf_counter()
        fps = fps * 0.9 + (1 / dt if dt > 0 else 0) * 0.1
        d.text((10, 8), f"継続 {hold:.1f}秒  {fps:.1f}fps", font=font, fill=(255, 255, 255))
        if args.record:
            d.text((img.width - 110, 8), "● 録画中", font=font, fill=(255, 60, 60))
        for i, c in enumerate(conds):
            marks = lambda ok: "".join(f"{n}{'○' if x else '×'}" for n, x in zip(("鼻", "腕", "肘"), ok))
            state = "挙手" if seats[i].raised else ""
            color = (255, 200, 0) if seats[i].raised else (220, 220, 220)
            d.text((10, 40 + 30 * i), f"席{i + 1}  左 {marks(c['left'][1])}  右 {marks(c['right'][1])}  {state}",
                   font=font, fill=color)
        if not people:
            d.text((10, 40), "人が見つかりません(両肩が映るように)", font=font, fill=(255, 120, 120))
        order = "  ".join(f"{n + 1}番目: 席{s + 1}" for n, s in enumerate(queue)) or "まだ誰も挙げていない"
        d.rectangle([0, h - 44, img.width, h], fill=(0, 0, 0))
        d.text((10, h - 38), "順番  " + order, font=font, fill=(255, 220, 120))
        if now < message_until:
            d.text((10, h - 80), message, font=font, fill=(120, 255, 120))

        cv2.imshow("kyoshu", cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2BGR))
        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):
            break
        if key == ord("r"):
            log.writerow([f"{now:.3f}", frame_no, "", "", "", "", "", "", "", "", "reset"])
            queue.clear()
            for s in seats.values():
                s.raised, s.since = False, None
        # 取り消した人は、一度手を下ろして挙げ直すまで並ばない
        cancel = None
        if ord("1") <= key <= ord("9") and key - ord("1") in queue:
            cancel = key - ord("1")
        if key == ord("x") and queue:
            cancel = queue[-1]
        if cancel is not None:
            queue.remove(cancel)
            log.writerow([f"{now:.3f}", frame_no, cancel, "", "", "", "", "", "", "", "cancel"])
            message, message_until = f"席{cancel + 1}を取り消しました", now + 3
        if cv2.getWindowProperty("kyoshu", cv2.WND_PROP_VISIBLE) < 1:
            break

    cap.release()
    log_file.close()
    if writer is not None:
        writer.release()
        times_file.close()
        print(f"映像: {log_dir / (stamp + '.mp4')}")
    cv2.destroyAllWindows()
    print(f"記録: {log_dir / (stamp + '.csv')}")


if __name__ == "__main__":
    main()
