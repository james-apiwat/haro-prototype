// สมองของ Haro แปลงมาจาก haro.py (Memory, IdleLook, Brain) ให้ทำงานเหมือนกันทุกอย่าง
// ไฟล์นี้ไม่ใช้ DOM จึงรันใน Node ได้ (ดู test_brain.mjs)
// ถ้าแก้ state machine ใน haro.py ต้องแก้ที่นี่ด้วย

// เวลา (วินาที) ตรงกับ haro.py
export const CONFIG = {
  LOST_FACE_GRACE: 1.5,       // หน้าหายไปนานเท่านี้ ถือว่าเจ้าของเดินออกไปแล้ว
  GREET_AFTER_ABSENCE: 10,    // เจ้าของหายไปนานเท่านี้ กลับมาแล้วจะทักทาย
  YAWN_AFTER: 40,             // อยู่คนเดียวนานเท่านี้ เริ่มหาว
  NAP_AFTER: 120,             // อยู่คนเดียวนานเท่านี้ หลับ
  CLINGY_AFTER: 30,           // เจ้าของอยู่แต่ไม่สนใจนานเท่านี้ เริ่มอ้อน
  SULK_AFTER: 12,             // อ้อนแล้วยังไม่สนใจ งอน
  TRICK_EVERY: [8, 15],       // ระหว่างเจ้าของอยู่ จะทำท่าน่ารักทุกๆ กี่วินาที (สุ่ม)
  REWARD_WINDOW: 5,           // ลูบหัวภายในกี่วินาทีหลังทำท่า ถือว่าเจ้าของชอบท่านั้น
};

export const TRICKS = ["wiggle", "tilt", "chirp", "bounce", "wink"];

const uniform = (a, b) => a + Math.random() * (b - a);
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
const lerp = (a, b, t) => a + (b - a) * t;

export function ease(x) {
  // ช้าตอนเริ่ม ช้าตอนจบ (จาก idle_head.rs ของ microduck)
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
}

// เวลาแบบเดียวกับ datetime.isoformat(timespec="seconds") ของ Python
export function isoSeconds(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function newMemoryData() {
  return {
    meets: 0,
    pets: 0,
    hours: new Array(24).fill(0),     // นาทีที่เจ้าของอยู่ แยกตามชั่วโมงของวัน
    tricks: Object.fromEntries(TRICKS.map((t) => [t, { tries: 0, liked: 0 }])),
  };
}

// ============================================================
// ความจำ + เรียนรู้ว่าเจ้าของชอบอะไร
// รูปแบบข้อมูลเหมือน data/haro_memory.json และ data/haro_log.csv ของ haro.py
// ============================================================
export class Memory {
  constructor(clock, saved = null) {
    this.clock = clock;               // () => Date ของเวลาในการจำลอง
    this.data = newMemoryData();
    this.rows = [];                   // [time, event, detail]
    this.onLog = null;
    this.onSave = null;
    this._lastMinute = null;
    if (saved) this.load(saved);
  }

  load(saved) {
    this.data = newMemoryData();
    Object.assign(this.data, saved);
    this.data.tricks = { ...this.data.tricks };
    for (const t of TRICKS) {
      if (!this.data.tricks[t]) this.data.tricks[t] = { tries: 0, liked: 0 };
    }
    if (!Array.isArray(this.data.hours) || this.data.hours.length !== 24) {
      this.data.hours = new Array(24).fill(0);
    }
  }

  log(event, detail = "") {
    const row = [isoSeconds(this.clock()), event, String(detail)];
    this.rows.push(row);
    if (this.rows.length > 50000) this.rows.shift();
    if (this.onLog) this.onLog(row);
  }

  save() {
    if (this.onSave) this.onSave(this.data);
  }

  countPresence(now) {
    const minute = Math.floor(now / 60);
    if (minute !== this._lastMinute) {
      this._lastMinute = minute;
      this.data.hours[this.clock().getHours()] += 1;
    }
  }

  usualHour() {
    // ตอนนี้เป็นช่วงที่เจ้าของมักอยู่ไหม
    const hours = this.data.hours;
    const h = hours[this.clock().getHours()];
    return h >= 5 && h >= 0.5 * Math.max(...hours);
  }

  score(trick) {
    const s = this.data.tricks[trick];
    return (s.liked + 1) / (s.tries + 2);
  }

  chooseTrick() {
    // epsilon-greedy: ส่วนใหญ่เลือกท่าที่เจ้าของชอบ บางครั้งลองท่าอื่น
    const untried = TRICKS.filter((t) => this.data.tricks[t].tries < 2);
    if (untried.length) return choice(untried);
    if (Math.random() < 0.2) return choice(TRICKS);
    return this.favorite();
  }

  favorite() {
    // เหมือน max() ของ Python: ถ้าคะแนนเท่ากัน เลือกตัวแรก
    let best = TRICKS[0];
    for (const t of TRICKS) if (this.score(t) > this.score(best)) best = t;
    return best;
  }

  tried(trick) { this.data.tricks[trick].tries += 1; }

  liked(trick) { this.data.tricks[trick].liked += 1; }

  toCSV() {
    const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    return ["time,event,detail", ...this.rows.map((r) => r.map(esc).join(","))].join("\r\n") + "\r\n";
  }
}

// ============================================================
// ท่าทางตอนว่าง (ดัดแปลงจาก microduck/robotd/src/idle_head.rs)
// ============================================================
export class IdleLook {
  constructor(now) {
    this.pos = [0, 0, 0];             // x, y, roll
    this.start = this.pos;
    this.target = this.pos;
    this.moveT0 = now;
    this.moveDur = 0.4;
    this.holdUntil = now + 1.0;
  }

  update(now, idleTime) {
    const energy = Math.max(0.3, Math.exp(-idleTime / 60));     // ยิ่งว่างนาน ยิ่งช้าลง
    if (now >= this.holdUntil) {
      this.start = this.pos;
      let target;
      if (Math.random() < 0.25) {
        target = [0, 0, 0];                                    // กลับมามองตรง
      } else {
        let x = 0;
        for (let i = 0; i < 5; i++) {
          x = choice([-1, 1]) * uniform(0.3, 1.0) * energy;
          if (Math.abs(x - this.pos[0]) > 0.2) break;
        }
        const y = uniform(-0.3, 0.3) * energy;
        const roll = Math.random() < 0.25 ? choice([-1, 1]) * uniform(8, 15) : 0;
        target = [x, y, roll];
      }
      const dist = Math.abs(target[0] - this.pos[0]) + Math.abs(target[1] - this.pos[1]);
      this.target = target;
      this.moveT0 = now;
      this.moveDur = (0.25 + 0.35 * dist) / energy;
      this.holdUntil = now + this.moveDur + uniform(1.0, 3.0) / energy;
    }
    const p = ease((now - this.moveT0) / this.moveDur);
    const base = this.start.map((a, i) => lerp(a, this.target[i], p));
    this.pos = base;
    // ตาขยับนิดๆ ระหว่างค้างมอง ไม่หยุดนิ่งสนิท
    const jitter = 0.04 * energy;
    return [base[0] + jitter * Math.sin(now * 1.7), base[1] + jitter * Math.sin(now * 1.3), base[2]];
  }
}

// ============================================================
// สมอง: state machine
// ============================================================
export class Brain {
  constructor(voice, memory, now) {
    this.voice = voice;
    this.mem = memory;
    this.state = "idle";
    this.tState = now;
    this.prevState = "idle";
    this.present = false;
    this.face = [0, 0, 0.2];
    this.lastFace = 0;
    this.leftAt = now - 999;            // เปิดเครื่องครั้งแรก เจอแล้วทักทาย
    this.aloneSince = now;
    this.lastAttention = now;
    this.nextTrick = now + uniform(...CONFIG.TRICK_EVERY);
    this.nextYawn = now + CONFIG.YAWN_AFTER;
    this.trick = null;
    this.lastTrick = null;
    this.lastTrickT = -999;
    this.trickRewarded = true;
    this.side = 1;
    this.flags = new Set();
    this.pettingHold = false;           // ยังลูบอยู่ ให้ดีใจต่อไปเรื่อยๆ
    this.idle = new IdleLook(now);
    this.nextBlink = now + uniform(2, 5);
    this.blinkT = -1;
    // ท่าทางที่ส่งไปวาด
    this.look = [0, 0];
    this.roll = 0;
    this.pose = {};
  }

  // ---------- เปลี่ยน state ----------
  go(state, now, detail = "") {
    this.prevState = this.state;
    this.state = state;
    this.tState = now;
    this.flags = new Set();
    this.mem.log(state, detail);
  }

  startTrick(name, now) {
    this.trick = name;
    this.lastTrick = name;
    this.lastTrickT = now;
    this.trickRewarded = false;
    this.mem.tried(name);
    if (name === "chirp") this.voice.play("chirp");
  }

  onPet(now, source = "") {
    if (this.state === "petted" && now - this.tState < 0.6) return;
    this.lastAttention = now;
    this.mem.data.pets += 1;
    if (this.lastTrick && !this.trickRewarded && now - this.lastTrickT <= CONFIG.REWARD_WINDOW) {
      this.mem.liked(this.lastTrick);
      this.trickRewarded = true;
      this.mem.log("trick_liked", this.lastTrick);
    }
    this.mem.save();
    this.voice.play(choice(["coo", "chirp"]));
    this.go("petted", now, source);
  }

  // ---------- อัปเดตทุกเฟรม ----------
  // face = [x, y, size] หรือ null, petted = ที่มาของการลูบ (string) หรือ null
  update(now, dt, face, heard, petted) {
    let arrived = false;
    let absentFor = 0;
    if (face) {
      this.face = face;
      this.lastFace = now;
      if (!this.present) {
        this.present = true;
        arrived = true;
        absentFor = now - this.leftAt;
        this.mem.log("owner_arrive", absentFor > 900 ? "first" : `away ${absentFor.toFixed(0)}s`);
      }
    } else if (this.present && now - this.lastFace > CONFIG.LOST_FACE_GRACE) {
      this.present = false;
      this.leftAt = now;
      this.aloneSince = now;
      this.mem.log("owner_leave");
    }
    if (this.present) this.mem.countPresence(now);

    // เหตุการณ์ที่ขัดจังหวะได้ทุก state
    if (petted) {
      this.onPet(now, typeof petted === "string" ? petted : "");
    } else if (heard && !["curious", "petted", "greet", "startle"].includes(this.state)) {
      if (this.state === "sleep") {
        this.voice.play("alarm");
        this.go("startle", now, "heard");
      } else {
        this.voice.play("inquire");
        this.side = choice([-1, 1]);
        this.go("curious", now);
      }
    } else if (arrived && ["idle", "sleep", "yawn"].includes(this.state)) {
      if (absentFor >= CONFIG.GREET_AFTER_ABSENCE) {
        this.mem.data.meets += 1;
        this.mem.save();
        this.voice.play("greet");
        this.go("greet", now, `meet #${this.mem.data.meets}`);
      } else {
        this.go("attend", now);
      }
    }

    const [target, roll, expr, bounce, mouth, extra] = this._stateLogic(now);

    // ค่อยๆ หันไปหาเป้าหมาย
    const k = Math.min(1, dt * (["sleep", "yawn"].includes(this.state) ? 4 : 9));
    this.look[0] += (target[0] - this.look[0]) * k;
    this.look[1] += (target[1] - this.look[1]) * k;
    this.roll += (roll - this.roll) * Math.min(1, dt * 10);

    // กะพริบตา
    let blink = 0;
    if (now >= this.nextBlink) {
      this.blinkT = now;
      this.nextBlink = now + uniform(2.5, 6);
    }
    if (now - this.blinkT >= 0 && now - this.blinkT < 0.16 &&
        ["normal", "surprised", "sad", "sleepy"].includes(expr)) {
      const x = (now - this.blinkT) / 0.16;
      blink = 1 - Math.abs(2 * x - 1);
    }

    const breath = Math.sin(now * 2 * Math.PI / (this.state === "sleep" ? 5 : 3.5));
    this.pose = {
      x: this.look[0], y: this.look[1], roll: this.roll,
      expr, blink, bounce: bounce + breath * 3,
      mouth, zzz: extra.has("zzz"), blush: extra.has("blush"),
    };
    return this.pose;
  }

  _trickMotion(name, t) {
    let roll = 0, bounce = 0, expr = "normal";
    if (name === "wiggle") {
      roll = 10 * Math.sin(t * 14) * Math.max(0, 1 - t / 1.6);
      expr = "happy";
    } else if (name === "tilt") {
      roll = 20 * this.side * (t < 1.2 ? ease(t / 0.3) : ease((1.6 - t) / 0.4));
    } else if (name === "chirp") {
      expr = "happy";
      bounce = -6 * Math.abs(Math.sin(t * 8));
    } else if (name === "bounce") {
      bounce = -18 * Math.abs(Math.sin(t * 9));
    } else if (name === "wink") {
      expr = t < 0.9 ? "wink" : "normal";
    }
    return [roll, bounce, expr];
  }

  _stateLogic(now) {
    const C = CONFIG;
    const s = this.state;
    const t = now - this.tState;
    const faceXY = [this.face[0], this.face[1] * 0.6];
    let target = [0, 0], roll = 0, expr = "normal", bounce = 0, mouth = 0, extra = new Set();

    if (s === "idle") {
      if (this.present) {
        this.go("attend", now);
        return this._stateLogic(now);
      }
      const alone = now - this.aloneSince;
      const [x, y, r] = this.idle.update(now, alone);
      target = [x, y];
      roll = r;
      expr = alone > C.YAWN_AFTER ? "sleepy" : "normal";
      const napAfter = C.NAP_AFTER * (this.mem.usualHour() ? 2 : 1);   // ช่วงที่เจ้าของมักอยู่ จะรอนานขึ้น
      if (alone > napAfter) {
        this.go("sleep", now);
      } else if (alone > C.YAWN_AFTER && now > this.nextYawn) {
        this.nextYawn = now + uniform(20, 40);
        this.go("yawn", now);
      }
    } else if (s === "yawn") {
      const p = t / 2.6;
      mouth = Math.sin(Math.PI * Math.min(1, p));
      target = [this.look[0] * 0.5, -0.35 * mouth];
      expr = "sleepy";
      if (p >= 1) this.go("idle", now);
    } else if (s === "sleep") {
      target = [0, 0.25];
      expr = "sleep";
      extra = new Set(["zzz"]);
    } else if (s === "greet") {
      const excite = Math.min(1, this.mem.data.meets / 10);
      target = faceXY;
      expr = "happy";
      extra = new Set(["blush"]);
      bounce = -(8 + 12 * excite) * Math.abs(Math.sin(t * 9)) * Math.max(0, 1 - t / 2.5);
      if (excite > 0.5 && t > 1.2 && !this.flags.has("chirp")) {
        this.flags.add("chirp");
        this.voice.play("chirp");
      }
      if (t > 2.5) {
        this.lastAttention = now;
        this.go("attend", now);
      }
    } else if (s === "attend") {
      target = faceXY;
      if (!this.present) {
        this.go("idle", now);
      } else if (now - this.lastAttention > C.CLINGY_AFTER) {
        this.go("clingy", now);
      } else if (now >= this.nextTrick) {
        this.side = this.face[0] >= 0 ? 1 : -1;
        this.startTrick(this.mem.chooseTrick(), now);
        this.go("trick", now, this.trick);
      }
    } else if (s === "trick") {
      target = faceXY;
      [roll, bounce, expr] = this._trickMotion(this.trick, t);
      if (t > 1.6) {
        this.nextTrick = now + uniform(...C.TRICK_EVERY);
        this.go(this.present ? "attend" : "idle", now);
      }
    } else if (s === "curious") {
      target = this.present ? faceXY : [0, 0];
      const amount = t < 1.2 ? ease(t / 0.3) : ease((1.6 - t) / 0.4);
      roll = 18 * this.side * amount;
      expr = t < 0.4 ? "surprised" : "normal";
      if (t > 1.6) this.go(this.present ? "attend" : "idle", now);
    } else if (s === "startle") {
      target = [0, -0.2];
      expr = "surprised";
      bounce = -14 * Math.sin(Math.PI * Math.min(1, t / 0.4));
      if (t > 1.2) {
        this.aloneSince = now;
        this.go(this.present ? "attend" : "idle", now);
      }
    } else if (s === "clingy") {
      // อ้อนด้วยท่าที่เจ้าของคนนี้ชอบที่สุด
      if (!this.flags.has("start")) {
        this.flags.add("start");
        this.voice.play("coo");
        this.side = this.face[0] >= 0 ? 1 : -1;
        this.startTrick(this.mem.favorite(), now);
      }
      target = faceXY;
      if (t < 1.6) [roll, bounce, expr] = this._trickMotion(this.trick, t);
      if (t > C.SULK_AFTER / 2 && !this.flags.has("coo2")) {
        this.flags.add("coo2");
        this.voice.play("coo");
      }
      if (!this.present) {
        this.go("idle", now);
      } else if (t > C.SULK_AFTER) {
        this.voice.play("peck");
        this.go("sulk", now);
      }
    } else if (s === "sulk") {
      const away = [this.face[0] >= 0 ? -0.95 : 0.95, 0.1];
      if (t < 3.0 || t >= 3.8) {
        target = away;
        expr = "sad";
      } else {                                  // แอบหันกลับมามอง
        target = faceXY;
        expr = "sleepy";
      }
      if (t > 5.5) {
        this.lastAttention = now - C.CLINGY_AFTER * 0.5;
        this.go(this.present ? "attend" : "idle", now);
      }
    } else if (s === "petted") {
      target = this.present ? faceXY : [0, 0];
      roll = 8 * Math.sin(t * 12) * Math.max(0, 1 - t / 2.2);
      expr = "happy";
      extra = new Set(["blush"]);
      if (this.pettingHold) {                   // ยังลูบอยู่ เอียงหัวพิงมือช้าๆ
        this.lastAttention = now;
        if (t > 2.2) roll = 5 * Math.sin(t * 2.5);
      } else if (t > 2.2) {
        this.aloneSince = now;
        this.go(this.present ? "attend" : "idle", now);
      }
    }

    return [target, roll, expr, bounce, mouth, extra];
  }
}
