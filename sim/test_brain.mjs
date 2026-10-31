// ทดสอบสมองแบบไม่ต้องเปิดเบราว์เซอร์:  node sim/test_brain.mjs
// จำลองเจ้าของนั่งหน้า Haro 20 นาที ลูบเฉพาะตอน Haro ส่ายหัว (wiggle)
// ผลที่ควรได้: ท่าโปรดคือ wiggle และผ่านครบทุก state หลัก

import { Brain, Memory, TRICKS } from "./brain.js";

const voice = { play() {} };
let now = 1_800_000_000;
const mem = new Memory(() => new Date(now * 1000));
const brain = new Brain(voice, mem, now);
const seen = new Set();
const dt = 1 / 30;
let pendingPet = null;

for (let i = 0; i < 20 * 60 * 30; i++) {
  now += dt;
  const minute = Math.floor(i / 1800);
  // นาทีที่ 3 และ 12 เจ้าของลุกไป 3 นาที (ทดสอบ หาว หลับ ทักทาย)
  const away = (minute >= 3 && minute < 6) || (minute >= 12 && minute < 15);
  const face = away ? null : [0.1, -0.2, 0.25];
  const prev = brain.state;
  let petted = null;
  if (pendingPet !== null && now >= pendingPet) {
    petted = "test";
    pendingPet = null;
  }
  brain.update(now, dt, face, false, petted);
  seen.add(brain.state);
  if (brain.state === "trick" && prev !== "trick" && brain.trick === "wiggle") pendingPet = now + 1.5;
}

const scores = TRICKS.map((t) => `${t}:${mem.score(t).toFixed(2)}`).join("  ");
console.log("states:", [...seen].sort().join(", "));
console.log("scores:", scores);
console.log("favorite:", mem.favorite(), " meets:", mem.data.meets, " pets:", mem.data.pets);
console.log("log rows:", mem.rows.length);

const need = ["idle", "attend", "trick", "petted", "greet", "yawn", "sleep", "clingy", "sulk"];
const missing = need.filter((s) => !seen.has(s));
if (mem.favorite() !== "wiggle" || missing.length) {
  console.error("FAIL", missing.length ? `missing states: ${missing}` : "favorite is not wiggle");
  process.exit(1);
}
console.log("PASS");
