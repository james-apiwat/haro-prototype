"""
Haro (laptop prototype)

หุ่นสัตว์เลี้ยงตั้งโต๊ะเวอร์ชันทดลองบนโน้ตบุ๊ก
- ตา: กล้องของคอม หาหน้าคนด้วย OpenCV + โมเดล YuNet
- หู: ไมค์ของคอม (ถ้าติดตั้ง sounddevice)
- เสียง: ไฟล์ wav ที่สร้างจาก microduck/sounds (Apache 2.0)
- หน้า: วาดบนจอกลม ขนาดเท่ากับจอ GC9A01 ที่จะใช้จริง (ขยาย 2 เท่า)
- ตัวหุ่น: ถ้าใส่ --port COM3 จะส่งคำสั่งไป ESP32 ผ่านสาย USB (ดู README)

รัน:  python haro.py
ปุ่ม:  คลิกที่หน้า หรือ Space = ลูบหัว   I = ข้อมูล   M = ใช้เมาส์แทนหน้า   Q = ออก
"""

import argparse
import csv
import json
import math
import os
import random
import threading
import time
from datetime import datetime

import cv2
import numpy as np
import pygame

# ============================================================
# ตั้งค่า (ปรับได้)
# ============================================================
BASE = os.path.dirname(os.path.abspath(__file__))
SOUND_DIR = os.path.join(BASE, "sounds")
FACE_MODEL = os.path.join(BASE, "models", "face_detection_yunet.onnx")
DATA_DIR = os.path.join(BASE, "data")
MEMORY_FILE = os.path.join(DATA_DIR, "haro_memory.json")
LOG_FILE = os.path.join(DATA_DIR, "haro_log.csv")

WINDOW = 480                # หน้าต่างกว้างและสูง (จอกลม 240x240 ขยาย 2 เท่า)
FPS = 30

# เวลา (วินาที) ตั้งให้สั้นไว้สำหรับเดโม
LOST_FACE_GRACE = 1.5       # หน้าหายไปนานเท่านี้ ถือว่าเจ้าของเดินออกไปแล้ว
GREET_AFTER_ABSENCE = 10    # เจ้าของหายไปนานเท่านี้ กลับมาแล้วจะทักทาย
YAWN_AFTER = 40             # อยู่คนเดียวนานเท่านี้ เริ่มหาว
NAP_AFTER = 120             # อยู่คนเดียวนานเท่านี้ หลับ
CLINGY_AFTER = 30           # เจ้าของอยู่แต่ไม่สนใจนานเท่านี้ เริ่มอ้อน
SULK_AFTER = 12             # อ้อนแล้วยังไม่สนใจ งอน
TRICK_EVERY = (8, 15)       # ระหว่างเจ้าของอยู่ จะทำท่าน่ารักทุกๆ กี่วินาที (สุ่ม)
REWARD_WINDOW = 5           # ลูบหัวภายในกี่วินาทีหลังทำท่า ถือว่าเจ้าของชอบท่านั้น

PAN_RANGE_DEG = 35          # มุมหันคอสูงสุดของหุ่นจริง

# ลูบด้วยเสียง (ใช้เมื่อมีโมเดลจาก pet_audio.py train แล้ว)
PET_MODEL = os.path.join(BASE, "models", "petting_audio.joblib")
PET_ENTER = 0.75            # ความน่าจะเป็นที่ถือว่าเริ่มลูบ ยิ่งสูงยิ่งลูบหลอกน้อย แต่ต้องลูบชัดขึ้น
PET_EXIT = 0.4              # ต่ำกว่านี้ถือว่าหยุดลูบ

# สี (ตรงกับหน้า Haro เดิม)
BG = (15, 21, 22)
RIM = (44, 55, 57)
SCREEN = (24, 34, 36)
EYE = (143, 227, 234)
WHITE = (240, 250, 250)
BLUSH = (226, 120, 150)
TEXT = (190, 205, 205)

TRICKS = ["wiggle", "tilt", "chirp", "bounce", "wink"]


def ease(x):
    """ช้าตอนเริ่ม ช้าตอนจบ (จาก idle_head.rs ของ microduck)"""
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def lerp(a, b, t):
    return a + (b - a) * t


# ============================================================
# ตา: กล้อง + หาหน้า
# ============================================================
class Vision:
    def __init__(self, index):
        self.face = None
        self._stop = False
        backend = cv2.CAP_DSHOW if os.name == "nt" else cv2.CAP_ANY
        self.cap = cv2.VideoCapture(index, backend)
        self.ok = self.cap.isOpened()
        self.detector = cv2.FaceDetectorYN.create(FACE_MODEL, "", (320, 240), 0.7, 0.3, 50)
        if self.ok:
            threading.Thread(target=self._loop, daemon=True).start()
        else:
            print("[vision] camera not found, press M to use the mouse as a face")

    def _loop(self):
        while not self._stop:
            ok, frame = self.cap.read()
            if not ok:
                time.sleep(0.05)
                continue
            h, w = frame.shape[:2]
            small = cv2.resize(frame, (320, int(h * 320 / w)))
            sh, sw = small.shape[:2]
            self.detector.setInputSize((sw, sh))
            _, faces = self.detector.detect(small)
            if faces is not None and len(faces):
                x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])[:4]
                cx = (x + fw / 2) / sw * 2 - 1
                cy = (y + fh / 2) / sh * 2 - 1
                # กลับซ้ายขวา: Haro หันหน้าเข้าหาผู้ใช้
                self.face = (float(-cx), float(cy), float(fw / sw), time.time())

    def latest(self):
        f = self.face
        if f and time.time() - f[3] < 0.4:
            return f[:3]
        return None

    def close(self):
        self._stop = True
        time.sleep(0.1)
        self.cap.release()


# ============================================================
# หู: ไมค์ (ไม่บังคับ)
# ============================================================
class Ears:
    def __init__(self, enabled, device=None, pet_model=None):
        self.ok = False
        self.level = 0.0
        self.floor = 0.01
        self.score = 0.0
        self.triggered = False
        self.mute_until = 0.0
        self.cooldown_until = 0.0
        self.pet = None                     # ตัวตรวจจับการลูบด้วยเสียง (pet_audio.py)
        if not enabled:
            return
        try:
            import sounddevice as sd
            self.stream = sd.InputStream(channels=1, samplerate=16000, device=device,
                                         blocksize=800, callback=self._cb)
            self.stream.start()
            self.ok = True
        except Exception as e:
            print("[ears] microphone off:", e)
            return
        if not pet_model:
            return
        if not os.path.exists(pet_model):
            print("[ears] audio petting off: no model yet (see README, pet_audio.py)")
            return
        try:
            from pet_audio import PettingDetector
            self.pet = PettingDetector(pet_model, PET_ENTER, PET_EXIT)
            print("[ears] audio petting on:", ", ".join(self.pet.classes))
        except ImportError as e:
            print(f"[ears] audio petting off: {e} (pip install scikit-learn)")
        except Exception as e:
            print("[ears] audio petting off:", e)

    def _cb(self, indata, frames, t, status):
        rms = float(np.sqrt(np.mean(np.square(indata))))
        self.level = rms
        if rms < self.floor:
            self.floor = 0.9 * self.floor + 0.1 * rms
        else:
            self.floor = 0.999 * self.floor + 0.001 * rms
        now = time.time()
        if self.pet:
            self.pet.push(indata[:, 0].copy())
            if self.pet.recently_active(now, 1.0):   # เสียงลูบไม่นับเป็นเสียงพูด
                self.score = 0.0
                return
        if now < self.mute_until:          # ไม่ฟังเสียงตัวเอง
            self.score = 0.0
            return
        loud = rms > max(0.025, self.floor * 4)
        block = frames / 16000
        self.score = self.score + block if loud else max(0.0, self.score - block * 0.5)
        if self.score > 0.3 and now > self.cooldown_until:
            self.triggered = True
            self.score = 0.0
            self.cooldown_until = now + 3

    def heard(self):
        if self.triggered:
            self.triggered = False
            return True
        return False


# ============================================================
# เสียง
# ============================================================
class Voice:
    def __init__(self, folder):
        self.bank = {}
        self.busy_until = 0.0
        self.ok = False
        try:
            pygame.mixer.init()
            for name in sorted(os.listdir(folder)):
                if name.endswith(".wav"):
                    tag = name.split("_")[0]
                    self.bank.setdefault(tag, []).append(
                        pygame.mixer.Sound(os.path.join(folder, name)))
            self.ok = True
        except Exception as e:
            print("[voice] sound off:", e)

    def play(self, tag):
        if not self.ok or tag not in self.bank:
            return
        pygame.mixer.stop()                 # เสียงใหม่ตัดเสียงเก่า (เหมือน microduck)
        snd = random.choice(self.bank[tag])
        snd.play()
        self.busy_until = time.time() + snd.get_length()


# ============================================================
# ตัวหุ่นจริง (ESP32) ใช้เมื่อใส่ --port
# ============================================================
class BodyLink:
    def __init__(self, port):
        self.ser = None
        self.last_h = ""
        self.last_e = ""
        self.next_send = 0.0
        if not port:
            return
        try:
            import serial
            self.ser = serial.Serial(port, 115200, timeout=0)
            print("[body] connected", port)
        except Exception as e:
            print("[body] not connected:", e)

    def send(self, pan_deg, roll_deg, expr):
        if not self.ser:
            return
        now = time.time()
        if now < self.next_send:
            return
        self.next_send = now + 0.05
        h = f"H {pan_deg:.0f} {roll_deg:.0f}\n"
        if h != self.last_h:
            self.ser.write(h.encode())
            self.last_h = h
        if expr != self.last_e:
            self.ser.write(f"E {expr}\n".encode())
            self.last_e = expr

    def touched(self):
        if not self.ser:
            return False
        try:
            data = self.ser.read(64).decode(errors="ignore")
        except Exception:
            return False
        return "T" in data


# ============================================================
# ความจำ + เรียนรู้ว่าเจ้าของชอบอะไร
# ============================================================
class Memory:
    def __init__(self):
        os.makedirs(DATA_DIR, exist_ok=True)
        self.data = {
            "meets": 0,
            "pets": 0,
            "hours": [0] * 24,      # นาทีที่เจ้าของอยู่ แยกตามชั่วโมงของวัน
            "tricks": {t: {"tries": 0, "liked": 0} for t in TRICKS},
        }
        if os.path.exists(MEMORY_FILE):
            with open(MEMORY_FILE, encoding="utf-8") as f:
                saved = json.load(f)
            self.data.update(saved)
            for t in TRICKS:
                self.data["tricks"].setdefault(t, {"tries": 0, "liked": 0})
        self._last_minute = None
        new_log = not os.path.exists(LOG_FILE)
        self._log = open(LOG_FILE, "a", newline="", encoding="utf-8")
        self._csv = csv.writer(self._log)
        if new_log:
            self._csv.writerow(["time", "event", "detail"])

    def log(self, event, detail=""):
        self._csv.writerow([datetime.now().isoformat(timespec="seconds"), event, detail])
        self._log.flush()

    def save(self):
        with open(MEMORY_FILE, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)

    def count_presence(self, now):
        minute = int(now // 60)
        if minute != self._last_minute:
            self._last_minute = minute
            self.data["hours"][datetime.now().hour] += 1

    def usual_hour(self):
        """ตอนนี้เป็นช่วงที่เจ้าของมักอยู่ไหม"""
        hours = self.data["hours"]
        h = hours[datetime.now().hour]
        return h >= 5 and h >= 0.5 * max(hours)

    def score(self, trick):
        s = self.data["tricks"][trick]
        return (s["liked"] + 1) / (s["tries"] + 2)

    def choose_trick(self):
        """epsilon-greedy: ส่วนใหญ่เลือกท่าที่เจ้าของชอบ บางครั้งลองท่าอื่น"""
        untried = [t for t in TRICKS if self.data["tricks"][t]["tries"] < 2]
        if untried:
            return random.choice(untried)
        if random.random() < 0.2:
            return random.choice(TRICKS)
        return self.favorite()

    def favorite(self):
        return max(TRICKS, key=self.score)

    def tried(self, trick):
        self.data["tricks"][trick]["tries"] += 1

    def liked(self, trick):
        self.data["tricks"][trick]["liked"] += 1

    def close(self):
        self.save()
        self._log.close()


# ============================================================
# ท่าทางตอนว่าง (ดัดแปลงจาก microduck/robotd/src/idle_head.rs)
# ============================================================
class IdleLook:
    def __init__(self, now):
        self.pos = (0.0, 0.0, 0.0)          # x, y, roll
        self.start = self.pos
        self.target = self.pos
        self.move_t0 = now
        self.move_dur = 0.4
        self.hold_until = now + 1.0

    def update(self, now, idle_time):
        energy = max(0.3, math.exp(-idle_time / 60))     # ยิ่งว่างนาน ยิ่งช้าลง
        if now >= self.hold_until:
            self.start = self.pos
            if random.random() < 0.25:
                target = (0.0, 0.0, 0.0)                    # กลับมามองตรง
            else:
                for _ in range(5):
                    x = random.choice([-1, 1]) * random.uniform(0.3, 1.0) * energy
                    if abs(x - self.pos[0]) > 0.2:
                        break
                y = random.uniform(-0.3, 0.3) * energy
                roll = random.choice([-1, 1]) * random.uniform(8, 15) if random.random() < 0.25 else 0.0
                target = (x, y, roll)
            dist = abs(target[0] - self.pos[0]) + abs(target[1] - self.pos[1])
            self.target = target
            self.move_t0 = now
            self.move_dur = (0.25 + 0.35 * dist) / energy
            self.hold_until = now + self.move_dur + random.uniform(1.0, 3.0) / energy
        p = ease((now - self.move_t0) / self.move_dur)
        base = tuple(lerp(a, b, p) for a, b in zip(self.start, self.target))
        self.pos = base
        # ตาขยับนิดๆ ระหว่างค้างมอง ไม่หยุดนิ่งสนิท
        jitter = 0.04 * energy
        return (base[0] + jitter * math.sin(now * 1.7), base[1] + jitter * math.sin(now * 1.3), base[2])


# ============================================================
# สมอง: state machine
# ============================================================
class Brain:
    def __init__(self, voice, memory, now):
        self.voice = voice
        self.mem = memory
        self.state = "idle"
        self.t_state = now
        self.prev_state = "idle"
        self.present = False
        self.face = (0.0, 0.0, 0.2)
        self.last_face = 0.0
        self.left_at = now - 999            # เปิดเครื่องครั้งแรก เจอแล้วทักทาย
        self.alone_since = now
        self.last_attention = now
        self.next_trick = now + random.uniform(*TRICK_EVERY)
        self.next_yawn = now + YAWN_AFTER
        self.trick = None
        self.last_trick = None
        self.last_trick_t = -999.0
        self.trick_rewarded = True
        self.side = 1
        self.flags = set()
        self.petting_hold = False           # ยังลูบอยู่ (จากเสียง) ให้ดีใจต่อไปเรื่อยๆ
        self.idle = IdleLook(now)
        self.next_blink = now + random.uniform(2, 5)
        self.blink_t = -1.0
        # ท่าทางที่ส่งไปวาด
        self.look = [0.0, 0.0]
        self.roll = 0.0
        self.pose = {}

    # ---------- เปลี่ยน state ----------
    def go(self, state, now, detail=""):
        self.prev_state = self.state
        self.state = state
        self.t_state = now
        self.flags = set()
        self.mem.log(state, detail)

    def start_trick(self, name, now):
        self.trick = name
        self.last_trick = name
        self.last_trick_t = now
        self.trick_rewarded = False
        self.mem.tried(name)
        if name == "chirp":
            self.voice.play("chirp")

    def on_pet(self, now, source=""):
        if self.state == "petted" and now - self.t_state < 0.6:
            return
        self.last_attention = now
        self.mem.data["pets"] += 1
        if (self.last_trick and not self.trick_rewarded
                and now - self.last_trick_t <= REWARD_WINDOW):
            self.mem.liked(self.last_trick)
            self.trick_rewarded = True
            self.mem.log("trick_liked", self.last_trick)
        self.mem.save()
        self.voice.play(random.choice(["coo", "chirp"]))
        self.go("petted", now, source)

    # ---------- อัปเดตทุกเฟรม ----------
    def update(self, now, dt, face, heard, petted):
        arrived = False
        absent_for = 0.0
        if face:
            self.face = face
            self.last_face = now
            if not self.present:
                self.present = True
                arrived = True
                absent_for = now - self.left_at
                self.mem.log("owner_arrive", "first" if absent_for > 900 else f"away {absent_for:.0f}s")
        elif self.present and now - self.last_face > LOST_FACE_GRACE:
            self.present = False
            self.left_at = now
            self.alone_since = now
            self.mem.log("owner_leave")
        if self.present:
            self.mem.count_presence(now)

        # เหตุการณ์ที่ขัดจังหวะได้ทุก state
        if petted:
            self.on_pet(now, petted if isinstance(petted, str) else "")
        elif heard and self.state not in ("curious", "petted", "greet", "startle"):
            if self.state == "sleep":
                self.voice.play("alarm")
                self.go("startle", now, "heard")
            else:
                self.voice.play("inquire")
                self.side = random.choice([-1, 1])
                self.go("curious", now)
        elif arrived and self.state in ("idle", "sleep", "yawn"):
            if absent_for >= GREET_AFTER_ABSENCE:
                self.mem.data["meets"] += 1
                self.mem.save()
                self.voice.play("greet")
                self.go("greet", now, f"meet #{self.mem.data['meets']}")
            else:
                self.go("attend", now)

        target, roll, expr, bounce, mouth, extra = self._state_logic(now)

        # ค่อยๆ หันไปหาเป้าหมาย
        k = min(1.0, dt * (4 if self.state in ("sleep", "yawn") else 9))
        self.look[0] += (target[0] - self.look[0]) * k
        self.look[1] += (target[1] - self.look[1]) * k
        self.roll += (roll - self.roll) * min(1.0, dt * 10)

        # กะพริบตา
        blink = 0.0
        if now >= self.next_blink:
            self.blink_t = now
            self.next_blink = now + random.uniform(2.5, 6)
        if 0 <= now - self.blink_t < 0.16 and expr in ("normal", "surprised", "sad", "sleepy"):
            x = (now - self.blink_t) / 0.16
            blink = 1 - abs(2 * x - 1)

        breath = math.sin(now * 2 * math.pi / (5 if self.state == "sleep" else 3.5))
        self.pose = {
            "x": self.look[0], "y": self.look[1], "roll": self.roll,
            "expr": expr, "blink": blink, "bounce": bounce + breath * 3,
            "mouth": mouth, "zzz": "zzz" in extra, "blush": "blush" in extra,
        }
        return self.pose

    def _trick_motion(self, name, t):
        roll, bounce, expr = 0.0, 0.0, "normal"
        if name == "wiggle":
            roll = 10 * math.sin(t * 14) * max(0.0, 1 - t / 1.6)
            expr = "happy"
        elif name == "tilt":
            roll = 20 * self.side * (ease(t / 0.3) if t < 1.2 else ease((1.6 - t) / 0.4))
        elif name == "chirp":
            expr = "happy"
            bounce = -6 * abs(math.sin(t * 8))
        elif name == "bounce":
            bounce = -18 * abs(math.sin(t * 9))
        elif name == "wink":
            expr = "wink" if t < 0.9 else "normal"
        return roll, bounce, expr

    def _state_logic(self, now):
        s = self.state
        t = now - self.t_state
        face_xy = (self.face[0], self.face[1] * 0.6)
        target, roll, expr, bounce, mouth, extra = (0.0, 0.0), 0.0, "normal", 0.0, 0.0, set()

        if s == "idle":
            if self.present:
                self.go("attend", now)
                return self._state_logic(now)
            alone = now - self.alone_since
            x, y, roll = self.idle.update(now, alone)
            target = (x, y)
            expr = "sleepy" if alone > YAWN_AFTER else "normal"
            nap_after = NAP_AFTER * (2 if self.mem.usual_hour() else 1)   # ช่วงที่เจ้าของมักอยู่ จะรอนานขึ้น
            if alone > nap_after:
                self.go("sleep", now)
            elif alone > YAWN_AFTER and now > self.next_yawn:
                self.next_yawn = now + random.uniform(20, 40)
                self.go("yawn", now)

        elif s == "yawn":
            p = t / 2.6
            mouth = math.sin(math.pi * min(1.0, p))
            target, expr = (self.look[0] * 0.5, -0.35 * mouth), "sleepy"
            if p >= 1:
                self.go("idle", now)

        elif s == "sleep":
            target, expr, extra = (0.0, 0.25), "sleep", {"zzz"}

        elif s == "greet":
            excite = min(1.0, self.mem.data["meets"] / 10)
            target, expr, extra = face_xy, "happy", {"blush"}
            bounce = -(8 + 12 * excite) * abs(math.sin(t * 9)) * max(0.0, 1 - t / 2.5)
            if excite > 0.5 and t > 1.2 and "chirp" not in self.flags:
                self.flags.add("chirp")
                self.voice.play("chirp")
            if t > 2.5:
                self.last_attention = now
                self.go("attend", now)

        elif s == "attend":
            target = face_xy
            if not self.present:
                self.go("idle", now)
            elif now - self.last_attention > CLINGY_AFTER:
                self.go("clingy", now)
            elif now >= self.next_trick:
                self.side = 1 if self.face[0] >= 0 else -1
                self.start_trick(self.mem.choose_trick(), now)
                self.go("trick", now, self.trick)

        elif s == "trick":
            target = face_xy
            roll, bounce, expr = self._trick_motion(self.trick, t)
            if t > 1.6:
                self.next_trick = now + random.uniform(*TRICK_EVERY)
                self.go("attend" if self.present else "idle", now)

        elif s == "curious":
            target = face_xy if self.present else (0.0, 0.0)
            amount = ease(t / 0.3) if t < 1.2 else ease((1.6 - t) / 0.4)
            roll = 18 * self.side * amount
            expr = "surprised" if t < 0.4 else "normal"
            if t > 1.6:
                self.go("attend" if self.present else "idle", now)

        elif s == "startle":
            target, expr = (0.0, -0.2), "surprised"
            bounce = -14 * math.sin(math.pi * min(1.0, t / 0.4))
            if t > 1.2:
                self.alone_since = now
                self.go("attend" if self.present else "idle", now)

        elif s == "clingy":
            # อ้อนด้วยท่าที่เจ้าของคนนี้ชอบที่สุด
            if "start" not in self.flags:
                self.flags.add("start")
                self.voice.play("coo")
                self.side = 1 if self.face[0] >= 0 else -1
                self.start_trick(self.mem.favorite(), now)
            target = face_xy
            if t < 1.6:
                roll, bounce, expr = self._trick_motion(self.trick, t)
            if t > SULK_AFTER / 2 and "coo2" not in self.flags:
                self.flags.add("coo2")
                self.voice.play("coo")
            if not self.present:
                self.go("idle", now)
            elif t > SULK_AFTER:
                self.voice.play("peck")
                self.go("sulk", now)

        elif s == "sulk":
            away = (-0.95 if self.face[0] >= 0 else 0.95, 0.1)
            if t < 3.0 or 3.8 <= t:
                target, expr = away, "sad"
            else:                                   # แอบหันกลับมามอง
                target, expr = face_xy, "sleepy"
            if t > 5.5:
                self.last_attention = now - CLINGY_AFTER * 0.5
                self.go("attend" if self.present else "idle", now)

        elif s == "petted":
            target = face_xy if self.present else (0.0, 0.0)
            roll = 8 * math.sin(t * 12) * max(0.0, 1 - t / 2.2)
            expr, extra = "happy", {"blush"}
            if self.petting_hold:                   # ยังลูบอยู่ เอียงหัวพิงมือช้าๆ
                self.last_attention = now
                if t > 2.2:
                    roll = 5 * math.sin(t * 2.5)
            elif t > 2.2:
                self.alone_since = now
                self.go("attend" if self.present else "idle", now)

        return target, roll, expr, bounce, mouth, extra


# ============================================================
# วาดหน้า
# ============================================================
class Face:
    def __init__(self):
        self.small = pygame.font.SysFont(None, 22)
        self.zfont = pygame.font.SysFont(None, 44)

    def _eye(self, surf, cx, cy, kind, blink, side):
        w, h = 92, 124
        if kind in ("normal", "sleepy", "sad", "surprised"):
            s = 1.15 if kind == "surprised" else 1.0
            ew, eh = w * s, max(10.0, h * s * (1 - blink))
            rect = pygame.Rect(0, 0, ew, eh)
            rect.center = (cx, cy)
            pygame.draw.rect(surf, EYE, rect, border_radius=int(min(ew, eh) / 2))
            if eh > 36 and kind != "sad":
                pygame.draw.circle(surf, WHITE, (int(cx - ew * 0.18), int(cy - eh * 0.22)), int(ew * 0.13))
            top = cy - eh / 2
            if kind == "sleepy":
                pygame.draw.rect(surf, SCREEN, (cx - ew / 2 - 3, top - 3, ew + 6, eh * 0.5 + 3))
            elif kind == "sad":
                outer = cx + side * ew / 2
                pygame.draw.polygon(surf, SCREEN, [
                    (cx - ew / 2 - 4, top - 4), (cx + ew / 2 + 4, top - 4),
                    (outer + side * 4, top + eh * 0.45)])
                pygame.draw.circle(surf, WHITE, (int(cx - side * ew * 0.1), int(cy + eh * 0.05)), int(ew * 0.11))
        elif kind == "happy":                       # ตาปิดยิ้ม ^ ^
            self._arc(surf, cx, cy + 16, w * 0.42, h * 0.3, 0, math.pi, 9)
        elif kind == "sleep":                       # ตาปิดหลับ
            self._arc(surf, cx, cy - 10, w * 0.42, h * 0.2, math.pi, 2 * math.pi, 6)

    def _arc(self, surf, cx, cy, rx, ry, a0, a1, r):
        """เส้นโค้งหนาแบบขอบมน (วาดเป็นวงกลมเล็กๆ ต่อกัน)"""
        steps = 40
        for i in range(steps + 1):
            a = a0 + (a1 - a0) * i / steps
            pygame.draw.circle(surf, EYE, (int(cx + rx * math.cos(a)), int(cy - ry * math.sin(a))), r)

    def draw(self, screen, pose, now):
        screen.fill(BG)
        head = pygame.Surface((WINDOW, WINDOW), pygame.SRCALPHA)
        c = WINDOW // 2
        pygame.draw.circle(head, RIM, (c, c), c - 4)
        pygame.draw.circle(head, SCREEN, (c, c), c - 14)

        x, y = pose["x"], pose["y"]
        by = pose["bounce"]
        ex = c + x * 48
        ey = c - 14 + y * 34 + by
        expr = pose["expr"]
        left = "normal" if expr == "wink" else expr
        right = "happy" if expr == "wink" else expr
        self._eye(head, ex - 96, ey, left, pose["blink"], -1)
        self._eye(head, ex + 96, ey, right, pose["blink"], 1)

        if pose["blush"]:
            for sx in (-1, 1):
                pygame.draw.ellipse(head, BLUSH, (ex + sx * 118 - 28, ey + 70, 56, 22))
        if pose["mouth"] > 0.05:
            m = pose["mouth"]
            rect = pygame.Rect(0, 0, 30 + 16 * m, 8 + 44 * m)
            rect.center = (ex, ey + 112)
            pygame.draw.ellipse(head, EYE, rect, 6)
        if pose["zzz"]:
            for i in range(3):
                p = (now * 0.4 + i / 3) % 1
                img = self.zfont.render("z", True, EYE)
                img.set_alpha(int(255 * (1 - p)))
                head.blit(img, (c + 90 + i * 18 + p * 20, c - 70 - p * 90))

        rotated = pygame.transform.rotozoom(head, -pose["roll"], 1.0)
        rect = rotated.get_rect(center=(c + x * 14, c))
        screen.blit(rotated, rect)

    def overlay(self, screen, lines):
        for i, line in enumerate(lines):
            screen.blit(self.small.render(line, True, TEXT), (10, 10 + i * 18))


# ============================================================
# โปรแกรมหลัก
# ============================================================
def run(args, max_seconds=None):
    pygame.init()
    screen = pygame.display.set_mode((WINDOW, WINDOW))
    pygame.display.set_caption("Haro")
    clock = pygame.time.Clock()

    voice = Voice(SOUND_DIR)
    mem = Memory()
    vision = Vision(args.camera) if not args.no_camera else None
    ears = Ears(not args.no_mic, args.mic_device, None if args.no_audio_pet else args.pet_model)
    body = BodyLink(args.port)
    face_view = Face()
    start = time.time()
    brain = Brain(voice, mem, start)
    mem.log("start")

    mouse_face = vision is None or not vision.ok
    show_info = False
    running = True
    print("Haro is running. Click the face or press Space to pet. I = info, M = mouse as face, Q = quit")

    while running:
        dt = clock.tick(FPS) / 1000
        now = time.time()
        petted = None                       # มาจากไหน: space, click, touch, audio:<ชนิด>
        for e in pygame.event.get():
            if e.type == pygame.QUIT:
                running = False
            elif e.type == pygame.KEYDOWN:
                if e.key in (pygame.K_q, pygame.K_ESCAPE):
                    running = False
                elif e.key == pygame.K_SPACE:
                    petted = "space"
                elif e.key == pygame.K_i:
                    show_info = not show_info
                elif e.key == pygame.K_m:
                    mouse_face = not mouse_face
            elif e.type == pygame.MOUSEBUTTONDOWN:
                mx, my = e.pos
                if math.hypot(mx - WINDOW / 2, my - WINDOW / 2) < WINDOW / 2:
                    petted = "click"

        if mouse_face:
            face = None
            if pygame.mouse.get_focused():
                mx, my = pygame.mouse.get_pos()
                face = (mx / WINDOW * 2 - 1, my / WINDOW * 2 - 1, 0.3)
        else:
            face = vision.latest()

        if body.touched():
            petted = "touch"
        if ears.pet:
            for ev, kind, sec in ears.pet.poll():
                if ev == "start":
                    petted = f"audio:{kind}"
                    mem.log("pet_audio_start", kind)
                else:
                    mem.log("pet_audio_end", f"{kind} {sec:.1f}s")
            brain.petting_hold = ears.pet.active
        pose = brain.update(now, dt, face, ears.heard(), petted)
        ears.mute_until = voice.busy_until + 0.5
        if ears.pet:
            ears.pet.muted_until = ears.mute_until

        face_view.draw(screen, pose, now)
        if show_info:
            tricks = "  ".join(f"{t}:{mem.score(t):.2f}" for t in TRICKS)
            face_view.overlay(screen, [
                f"state: {brain.state}   owner: {'yes' if brain.present else 'no'}",
                f"camera: {'mouse' if mouse_face else ('on' if vision and vision.ok else 'off')}"
                f"   mic: {'on %.3f' % ears.level if ears.ok else 'off'}",
                f"meets: {mem.data['meets']}   pets: {mem.data['pets']}",
                (f"pet-audio: p={ears.pet.prob:.2f} {ears.pet.kind or '-'}"
                 f"{'  PETTING' if ears.pet.active else ''}") if ears.pet else "pet-audio: off",
                f"favorite: {mem.favorite()}",
                tricks,
            ])
        pygame.display.flip()
        body.send(pose["x"] * PAN_RANGE_DEG, pose["roll"], pose["expr"])

        if max_seconds and now - start > max_seconds:
            running = False

    mem.log("stop")
    print(f"Meets: {mem.data['meets']}  Pets: {mem.data['pets']}  Favorite trick: {mem.favorite()}")
    mem.close()
    if ears.pet:
        ears.pet.close()
    if vision:
        vision.close()
    pygame.quit()


def main():
    p = argparse.ArgumentParser(description="Haro laptop prototype")
    p.add_argument("--camera", type=int, default=0, help="camera index (default 0)")
    p.add_argument("--port", default=None, help="ESP32 serial port, e.g. COM3")
    p.add_argument("--no-mic", action="store_true", help="turn the microphone off")
    p.add_argument("--no-camera", action="store_true", help="use the mouse as the face")
    p.add_argument("--mic-device", default=None,
                   help="microphone number or name (list: python pet_audio.py devices)")
    p.add_argument("--pet-model", default=PET_MODEL, help="audio petting model")
    p.add_argument("--no-audio-pet", action="store_true", help="turn audio petting off")
    args = p.parse_args()
    if args.mic_device is not None and args.mic_device.isdigit():
        args.mic_device = int(args.mic_device)
    run(args)


if __name__ == "__main__":
    main()
