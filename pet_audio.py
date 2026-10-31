"""
ลูบหัว Haro ด้วยเสียง

ไมค์ที่แนบกับตัวหุ่น (เช่น ไมค์หูฟังที่แปะไว้ด้านใน) ได้ยินเสียงลูบและเกาชัดมาก
ไฟล์นี้ตัดเสียงเป็นช่วงละ 1 วินาที แปลงเป็น log-mel 40 แบนด์ แล้วให้โมเดลบอกว่ากำลังถูกลูบไหม
แนวคิดมาจาก microduck/pet-detect (Apache 2.0)

features() ใช้ทั้งตอนเทรนและตอนใช้งานจริง ค่าที่โมเดลเห็นจึงตรงกันเสมอ
ถ้าแก้ features() ต้องเพิ่ม FEATURE_VERSION แล้วเทรนใหม่

คำสั่ง
  python pet_audio.py devices                    ดูรายชื่อไมค์
  python pet_audio.py record --label stroke      อัดเสียงลูบ 30 วินาที
  python pet_audio.py record --label normal      อัดเสียงอื่นที่ไม่ใช่การลูบ
  python pet_audio.py train                      เทรนโมเดล
  python pet_audio.py check test_sounds/*.wav    ลองโมเดลกับไฟล์เสียง
  python pet_audio.py live                       ดูผลสดระหว่างลองลูบ
"""

import argparse
import collections
import os
import sys
import threading
import time
import wave
from datetime import datetime

import numpy as np

# ============================================================
# ตั้งค่า
# ============================================================
BASE = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(BASE, "dataset", "petting")   # แยกจาก data/ เพราะ data/ ถูกลบตอนเริ่ม Haro ใหม่
MODEL_FILE = os.path.join(BASE, "models", "petting_audio.joblib")
REPORT_FILE = os.path.join(BASE, "models", "petting_audio_report.txt")

SR = 16000          # 16 kHz mono
N_FFT = 512
HOP = 160           # 10 ms
WIN = 400           # 25 ms
N_MELS = 40
WINDOW = SR         # ตัดสินทีละ 1 วินาที
TRAIN_HOP = SR // 4 # ตอนเทรน เลื่อนหน้าต่างทีละ 0.25 วินาที
FEATURE_VERSION = 1
NEGATIVE = "normal" # ชื่อโฟลเดอร์ของเสียงที่ไม่ใช่การลูบ


# ============================================================
# แปลงเสียงเป็น feature (ใช้ร่วมกันทั้งเทรนและใช้งานจริง)
# ============================================================
def _mel_filters():
    def hz_to_mel(f):
        return 2595 * np.log10(1 + f / 700)

    def mel_to_hz(m):
        return 700 * (10 ** (m / 2595) - 1)

    n_bins = N_FFT // 2 + 1
    hz = mel_to_hz(np.linspace(hz_to_mel(0), hz_to_mel(SR / 2), N_MELS + 2))
    bins = np.arange(n_bins) * SR / N_FFT
    fb = np.zeros((N_MELS, n_bins), np.float32)
    for m in range(N_MELS):
        lo, mid, hi = hz[m], hz[m + 1], hz[m + 2]
        fb[m] = np.maximum(0, np.minimum((bins - lo) / (mid - lo), (hi - bins) / (hi - mid)))
    return fb


_MEL = _mel_filters()
_HANN = np.hanning(WIN).astype(np.float32)


def log_mel(x):
    """เสียง 1 วินาที -> log-mel [เฟรม, 40]"""
    n_frames = 1 + (len(x) - WIN) // HOP
    idx = np.arange(WIN)[None, :] + HOP * np.arange(n_frames)[:, None]
    power = np.abs(np.fft.rfft(x[idx] * _HANN, n=N_FFT)) ** 2
    return np.log(power @ _MEL.T + 1e-6)


def features(x):
    """เสียง 1 วินาที -> เวกเตอร์ 125 ค่า

    - ความดังเฉลี่ย ความแกว่ง และการเปลี่ยนแปลง ของแต่ละแบนด์ (40 x 3)
    - ความดังรวม เฉลี่ยและแกว่ง (2)
    - จังหวะของความดัง: ลูบช้า 0.5-4 Hz, พยางค์คำพูด 4-8 Hz, เสียงรัวเช่นพิมพ์ 8-16 Hz (3)
    """
    m = log_mel(np.asarray(x, np.float32))
    energy = np.log(np.exp(m).sum(axis=1) + 1e-6)
    env = energy - energy.mean()
    spec = np.abs(np.fft.rfft(env)) ** 2
    freqs = np.fft.rfftfreq(len(env), d=HOP / SR)
    total = spec[1:].sum() + 1e-9
    rhythm = [spec[(freqs >= lo) & (freqs < hi)].sum() / total for lo, hi in ((0.5, 4), (4, 8), (8, 16))]
    return np.concatenate([
        m.mean(axis=0), m.std(axis=0), np.abs(np.diff(m, axis=0)).mean(axis=0),
        [energy.mean(), energy.std()], rhythm,
    ]).astype(np.float32)


def windows(x, hop=TRAIN_HOP):
    for start in range(0, len(x) - WINDOW + 1, hop):
        yield x[start:start + WINDOW]


def source_of(filename):
    """ไฟล์ที่ชื่อเหมือนกันก่อน __ มาจากเสียงต้นฉบับเดียวกัน (เช่น web584865__aug1.wav)
    ตอนทดสอบต้องอยู่ฝั่งเดียวกันทั้งหมด ไม่อย่างนั้นตัวเลขจะดีเกินจริง"""
    return os.path.splitext(filename)[0].split("__")[0]


# ============================================================
# ไฟล์เสียง
# ============================================================
def load_wav(path):
    with wave.open(path, "rb") as w:
        sr, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width != 2:
        raise ValueError(f"{path}: ต้องเป็นไฟล์ 16-bit PCM")
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    if sr != SR:   # ไฟล์จากคำสั่ง record เป็น 16 kHz อยู่แล้ว อันนี้เผื่อไฟล์จากที่อื่น
        n = int(len(x) * SR / sr)
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
    return x


def save_wav(path, x_int16):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(np.asarray(x_int16, np.int16).tobytes())


# ============================================================
# ใช้งานจริง: ฟังต่อเนื่อง แล้วบอกว่าเริ่มลูบหรือหยุดลูบ
# ============================================================
class PettingDetector:
    """ป้อนเสียงด้วย push() แล้วอ่านเหตุการณ์ด้วย poll()

    ตัดสินทุก hop_s วินาที ใช้ hysteresis กันสถานะกระพริบ:
    เริ่มลูบเมื่อความน่าจะเป็นเกิน enter สองครั้งติด หยุดลูบเมื่อต่ำกว่า exit
    ระหว่าง muted_until (Haro กำลังส่งเสียงเอง) จะไม่ตัดสิน และคงสถานะเดิมไว้
    """

    def __init__(self, model_path=MODEL_FILE, enter=0.75, exit=0.4, hop_s=0.25):
        import joblib
        bundle = joblib.load(model_path)
        if bundle.get("feature_version") != FEATURE_VERSION:
            raise ValueError("model was trained with another feature version, run: python pet_audio.py train")
        self.model = bundle["model"]
        self.classes = [str(c) for c in self.model.classes_]
        self.neg = self.classes.index(NEGATIVE)
        self.enter, self.exit, self.hop_s = enter, exit, hop_s
        self.buf = np.zeros(WINDOW, np.float32)
        self.filled = 0
        self.lock = threading.Lock()
        self.muted_until = 0.0
        self.prob = 0.0          # ความน่าจะเป็นว่ากำลังถูกลูบ (ทำให้เรียบแล้ว)
        self.kind = None         # ชนิดการลูบที่น่าจะเป็นที่สุด
        self.active = False
        self.started_at = 0.0
        self.ended_at = 0.0
        self._above = 0
        self._events = collections.deque()
        self._stop = False
        threading.Thread(target=self._loop, daemon=True).start()

    def push(self, samples):
        """เสียงใหม่จากไมค์ (float32, 16 kHz, mono) เรียกจาก callback ได้เลย"""
        samples = np.asarray(samples, np.float32)
        n = len(samples)
        with self.lock:
            if time.time() < self.muted_until:
                self.filled = 0          # เสียงของ Haro เอง ต้องรอเสียงใหม่ครบ 1 วินาทีก่อนตัดสิน
                return
            if n >= WINDOW:
                self.buf[:] = samples[-WINDOW:]
            else:
                self.buf[:-n] = self.buf[n:]
                self.buf[-n:] = samples
            self.filled = min(WINDOW, self.filled + n)

    def _loop(self):
        while not self._stop:
            time.sleep(self.hop_s)
            with self.lock:
                ready = self.filled >= WINDOW
                x = self.buf.copy() if ready else None
            if ready:
                self._judge(self.model.predict_proba(features(x)[None])[0], time.time())

    def _judge(self, p, now):
        p_pet = 1.0 - float(p[self.neg])
        pet_classes = [i for i in range(len(self.classes)) if i != self.neg]
        if pet_classes:
            self.kind = self.classes[max(pet_classes, key=lambda i: p[i])]
        self.prob = 0.5 * self.prob + 0.5 * p_pet
        if not self.active:
            self._above = self._above + 1 if self.prob >= self.enter else 0
            if self._above >= 2:
                self.active = True
                self.started_at = now
                self._events.append(("start", self.kind, 0.0))
        elif self.prob < self.exit:
            self.active = False
            self._above = 0
            self.ended_at = now
            self._events.append(("end", self.kind, now - self.started_at))

    def poll(self):
        """เหตุการณ์ที่เกิดตั้งแต่ครั้งก่อน: [("start" หรือ "end", ชนิด, วินาทีที่ลูบ)]"""
        out = []
        while self._events:
            out.append(self._events.popleft())
        return out

    def recently_active(self, now, seconds=1.0):
        return self.active or now - self.ended_at < seconds

    def close(self):
        self._stop = True


# ============================================================
# คำสั่ง
# ============================================================
def _device(value):
    if value is None:
        return None
    return int(value) if str(value).isdigit() else value


def dataset_summary():
    rows = []
    if os.path.isdir(DATASET_DIR):
        for label in sorted(os.listdir(DATASET_DIR)):
            folder = os.path.join(DATASET_DIR, label)
            wavs = [f for f in os.listdir(folder) if f.endswith(".wav")] if os.path.isdir(folder) else []
            if wavs:
                seconds = 0.0
                for f in wavs:
                    with wave.open(os.path.join(folder, f), "rb") as w:
                        seconds += w.getnframes() / w.getframerate()
                rows.append((label, len(wavs), seconds))
    return rows


def cmd_devices(args):
    import sounddevice as sd
    print(sd.query_devices())
    print("\nตัวที่มี > ข้างหน้าคือไมค์ที่ใช้อยู่ ถ้าจะใช้ตัวอื่นให้ใส่ --device <เลข> ทั้งตอน record, live และตอนรัน haro.py (--mic-device)")


def cmd_record(args):
    import sounddevice as sd
    label = args.label.strip().lower()
    folder = os.path.join(DATASET_DIR, label)
    os.makedirs(folder, exist_ok=True)
    if label == NEGATIVE:
        print("อัดเสียงที่ 'ไม่ใช่' การลูบ เช่น เงียบ พูดคุย พิมพ์คีย์บอร์ด จับหรือขยับตัวหุ่นโดยไม่ลูบ เปิดเพลง")
    else:
        print(f"ลูบแบบ '{label}' ต่อเนื่องตลอดเวลาที่อัด (ช่วงที่หยุดลูบจะกลายเป็นข้อมูลผิดประเภท)")
    print(f"อัด {args.seconds:.0f} วินาที", end="", flush=True)
    for i in (3, 2, 1):
        print(f" ... {i}", end="", flush=True)
        time.sleep(1)
    print("  เริ่ม!")
    x = sd.rec(int(args.seconds * SR), samplerate=SR, channels=1, dtype="int16", device=_device(args.device))
    sd.wait()
    x = x[:, 0]
    path = os.path.join(folder, f"{label}_{datetime.now():%Y%m%d_%H%M%S}.wav")
    save_wav(path, x)
    xf = x.astype(np.float32) / 32768
    rms, peak = float(np.sqrt(np.mean(xf ** 2))), float(np.abs(xf).max())
    print(f"บันทึกแล้ว: {os.path.relpath(path, BASE)}  (ความดังเฉลี่ย {rms:.4f}, สูงสุด {peak:.2f})")
    if peak > 0.99:
        print("! เสียงแตก ลองลดระดับไมค์ หรือลูบเบาลง")
    if rms < 0.002:
        print("! เสียงเบามาก ไมค์อาจอยู่ไกลเกินไป หรือเลือกไมค์ผิดตัว (python pet_audio.py devices)")
    print("\nข้อมูลที่มีตอนนี้:")
    for name, n, sec in dataset_summary():
        print(f"  {name:<12} {n:>3} ไฟล์  {sec:>6.0f} วินาที")


def cmd_train(args):
    import warnings
    import joblib
    import sklearn
    from sklearn.exceptions import ConvergenceWarning
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import balanced_accuracy_score, classification_report, confusion_matrix
    from sklearn.model_selection import StratifiedGroupKFold, cross_val_predict
    from sklearn.neural_network import MLPClassifier
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    warnings.filterwarnings("ignore", category=ConvergenceWarning)

    summary = dataset_summary()
    labels = [name for name, _, _ in summary]
    if NEGATIVE not in labels or len(labels) < 2:
        sys.exit(f"ต้องมีโฟลเดอร์ '{NEGATIVE}' และการลูบอย่างน้อย 1 แบบใน {os.path.relpath(DATASET_DIR, BASE)} "
                 f"(ตอนนี้มี: {labels or 'ไม่มีเลย'})")
    sources = {label: {source_of(f) for f in os.listdir(os.path.join(DATASET_DIR, label)) if f.endswith(".wav")}
               for label in labels}
    n_splits = min(5, min(len(s) for s in sources.values()))
    if n_splits < 2:
        sys.exit("ต้องมีเสียงต้นฉบับอย่างน้อย 2 ไฟล์ต่อประเภท เพื่อแยกไว้ทดสอบ")

    print("กำลังแปลงเสียงเป็น feature ...")
    X, y, groups = [], [], []
    for label in labels:
        folder = os.path.join(DATASET_DIR, label)
        for f in sorted(os.listdir(folder)):
            if f.endswith(".wav"):
                for w in windows(load_wav(os.path.join(folder, f))):
                    X.append(features(w))
                    y.append(label)
                    groups.append(f"{label}/{source_of(f)}")
    X, y, groups = np.array(X), np.array(y), np.array(groups)

    lines = [f"Haro petting model  {datetime.now():%Y-%m-%d %H:%M}", "", "ข้อมูล"]
    for name, n, sec in summary:
        lines.append(f"  {name:<12} {len(sources[name]):>3} ต้นฉบับ {n:>3} ไฟล์  {sec:>6.0f} วินาที  "
                     f"{(y == name).sum():>5} หน้าต่าง")
    lines += ["", f"ทดสอบแบบแยกต้นฉบับ {n_splits} รอบ (เสียงจากต้นฉบับเดียวกันไม่อยู่ทั้งชุดเทรนและชุดทดสอบ)", ""]

    candidates = {
        "logistic": LogisticRegression(max_iter=2000, class_weight="balanced"),
        "random_forest": RandomForestClassifier(n_estimators=200, class_weight="balanced", random_state=0),
        "mlp": MLPClassifier(hidden_layer_sizes=(64,), max_iter=800, random_state=0),
    }
    cv = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=0)
    results = {}
    for name, clf in candidates.items():
        pred = cross_val_predict(make_pipeline(StandardScaler(), clf), X, y, groups=groups, cv=cv)
        neg = y == NEGATIVE
        results[name] = {
            "pred": pred,
            "balanced_accuracy": balanced_accuracy_score(y, pred),
            "false_pet": float(np.mean(pred[neg] != NEGATIVE)),      # เสียงอื่นที่ถูกทายว่าลูบ
            "missed_pet": float(np.mean(pred[~neg] == NEGATIVE)),    # ลูบจริงแต่ทายว่าไม่ลูบ
        }
    lines.append(f"  {'โมเดล':<14} {'แม่นเฉลี่ย':>10} {'ลูบหลอก':>9} {'พลาดลูบ':>9}")
    for name, r in results.items():
        lines.append(f"  {name:<14} {r['balanced_accuracy']:>10.1%} {r['false_pet']:>9.1%} {r['missed_pet']:>9.1%}")
    best = max(results, key=lambda k: (results[k]["balanced_accuracy"], -results[k]["false_pet"]))
    r = results[best]
    lines += ["", f"เลือก: {best}", "", "confusion matrix (แถว = จริง, คอลัมน์ = ทาย)",
              "  " + " ".join(f"{c:>10}" for c in labels)]
    for c, row in zip(labels, confusion_matrix(y, r["pred"], labels=labels)):
        lines.append(f"  {' '.join(f'{v:>10}' for v in row)}   {c}")
    lines += ["", classification_report(y, r["pred"], labels=labels, zero_division=0),
              "ตัวเลขนี้นับทีละหน้าต่าง 1 วินาที ตอนใช้งานจริงมี hysteresis ช่วยกรองอีกชั้น",
              "ลูบหลอกสำคัญที่สุด เพราะทำให้ Haro ให้คะแนนท่าผิด"]

    model = make_pipeline(StandardScaler(), candidates[best]).fit(X, y)
    os.makedirs(os.path.dirname(MODEL_FILE), exist_ok=True)
    joblib.dump({
        "model": model,
        "feature_version": FEATURE_VERSION,
        "algorithm": best,
        "labels": labels,
        "cv": {k: {m: v[m] for m in ("balanced_accuracy", "false_pet", "missed_pet")} for k, v in results.items()},
        "trained": datetime.now().isoformat(timespec="seconds"),
        "sklearn": sklearn.__version__,
    }, MODEL_FILE)
    lines.append(f"บันทึกโมเดล: {os.path.relpath(MODEL_FILE, BASE)}")
    report = "\n".join(lines)
    with open(REPORT_FILE, "w", encoding="utf-8") as f:
        f.write(report + "\n")
    print(report)
    print(f"รายงาน: {os.path.relpath(REPORT_FILE, BASE)}")


def cmd_check(args):
    """ลองโมเดลกับไฟล์เสียง ไม่ต้องใช้ไมค์ ใช้การตัดสินแบบเดียวกับตอนใช้งานจริง"""
    for path in args.files:
        det = PettingDetector(args.model, enter=args.enter, exit=args.exit)
        det.close()
        x = load_wav(path)
        hop = int(det.hop_s * SR)
        print(f"\n{os.path.basename(path)}  ({len(x) / SR:.1f} วินาที)")
        timeline, active_s = [], 0.0
        for end in range(WINDOW, len(x) + 1, hop):
            t = end / SR
            det._judge(det.model.predict_proba(features(x[end - WINDOW:end])[None])[0], t)
            active_s += det.hop_s if det.active else 0
            timeline.append("#" if det.active else ("+" if det.prob >= det.exit else "."))
        for ev, kind, sec in det.poll():
            print(f"  {'เริ่มลูบ' if ev == 'start' else 'หยุดลูบ'} ({kind})" + (f" ลูบนาน {sec:.1f} วินาที" if ev == "end" else ""))
        if det.active:
            print(f"  ยังลูบอยู่ตอนไฟล์จบ ({det.kind})")
        print(f"  เวลาที่ถือว่ากำลังลูบ: {active_s:.1f} วินาที")
        print("  " + "".join(timeline) + "   (# ลูบ, + เกือบ, . ไม่ลูบ ทีละ 0.25 วินาที)")


def cmd_live(args):
    import sounddevice as sd
    det = PettingDetector(args.model, enter=args.enter, exit=args.exit)

    def callback(indata, frames, t, status):
        det.push(indata[:, 0].copy())

    with sd.InputStream(channels=1, samplerate=SR, blocksize=800, device=_device(args.device), callback=callback):
        print(f"ประเภท: {', '.join(det.classes)}   ลองลูบดู กด Ctrl+C เพื่อออก\n")
        try:
            while True:
                time.sleep(0.25)
                for ev, kind, sec in det.poll():
                    msg = f"เริ่มลูบ ({kind})" if ev == "start" else f"หยุดลูบ ({kind}, {sec:.1f} วินาที)"
                    print(f"\r>>> {msg:<60}")
                bar = "#" * int(det.prob * 30)
                state = "กำลังลูบ" if det.active else ""
                print(f"\rp(ลูบ) {det.prob:4.2f} [{bar:<30}] {det.kind or '-':<10} {state:<10}", end="", flush=True)
        except KeyboardInterrupt:
            print()


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description="Haro: ลูบหัวด้วยเสียง")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("devices", help="ดูรายชื่อไมค์")
    r = sub.add_parser("record", help="อัดเสียงหนึ่งไฟล์")
    r.add_argument("--label", required=True, help=f"ประเภท เช่น stroke, scratch, pat หรือ {NEGATIVE}")
    r.add_argument("--seconds", type=float, default=30)
    r.add_argument("--device", default=None, help="เลขหรือชื่อไมค์")
    sub.add_parser("train", help="เทรนโมเดลจากเสียงที่อัดไว้")
    ck = sub.add_parser("check", help="ลองโมเดลกับไฟล์ .wav")
    ck.add_argument("files", nargs="+")
    lv = sub.add_parser("live", help="ดูผลสด")
    lv.add_argument("--device", default=None)
    for sp in (ck, lv):
        sp.add_argument("--model", default=MODEL_FILE)
        sp.add_argument("--enter", type=float, default=0.75)
        sp.add_argument("--exit", type=float, default=0.4)
    args = p.parse_args()
    {"devices": cmd_devices, "record": cmd_record, "train": cmd_train,
     "check": cmd_check, "live": cmd_live}[args.cmd](args)


if __name__ == "__main__":
    main()
