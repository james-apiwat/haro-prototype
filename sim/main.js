// Haro Simulator: ตัวหุ่นเสมือนของ Haro บนเบราว์เซอร์
// - สมอง (brain.js) แปลงมาจาก haro.py ทำงานเหมือนกัน
// - ตัวหุ่นจำลองฮาร์ดแวร์ที่ทีมมีจริง: จอกลม GC9A01, กล้อง OV3660 บนหัว, MG996R 360° หมุนตัว, ฟอยล์ต่อ touch pin
// - หน่วยความยาวในฉาก = เซนติเมตร

import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { RoomEnvironment } from "./vendor/RoomEnvironment.js";
import { Brain, Memory, TRICKS, CONFIG } from "./brain.js";
import { drawFace, COLORS } from "./face.js";
import { Wardrobe, drawSkinTemplate } from "./outfit.js";
import { writeGLB } from "./glb.js";

// ============================================================
// ค่าฮาร์ดแวร์ (ปรับได้)
// ============================================================
const HW = {
  CAM_VFOV: 48,            // มุมมองแนวตั้งของ OV3660 (ภาพ 4:3 แนวนอนประมาณ 61°)
  CAM_TILT: 10,            // กล้องเงยขึ้นกี่องศา
  FACE_NEAR: 15,           // ใกล้กว่านี้หน้าล้นภาพ
  FACE_FAR: 150,           // ไกลกว่านี้หน้าเล็กเกินกว่า YuNet จะเจอ (ภาพ 320 px)
  FACE_WIDTH: 15,          // ความกว้างหน้าคน
  SERVO_MAX: 240,          // องศาต่อวินาทีตอนสั่งเต็ม (MG996R 360° ที่ 5V)
  SERVO_DEADBAND: 0.06,    // สั่งเบากว่านี้ เซอร์โวไม่หมุน
  SERVO_LAG: 0.08,         // วินาทีกว่าจะถึงความเร็วที่สั่ง
  YAW_LIMIT: 160,          // หมุนเกินนี้สายจากหัวลงฐานจะพัน
  PAN_RANGE: 35,           // PAN_RANGE_DEG ใน haro.py
};
const D2R = Math.PI / 180;
const HALF_HFOV = Math.atan(Math.tan((HW.CAM_VFOV / 2) * D2R) * 4 / 3);   // เรเดียน
const TRACK_STATES = new Set(["attend", "trick", "greet", "petted", "curious", "clingy"]);

const STATE_TH = {
  idle: "ว่าง มองรอบๆ", attend: "มองเจ้าของ", trick: "ทำท่าน่ารัก", petted: "ถูกลูบ ดีใจ",
  greet: "ทักทาย", curious: "สงสัย เอียงคอ", startle: "สะดุ้งตื่น", clingy: "อ้อน",
  sulk: "งอน", yawn: "หาว", sleep: "หลับ",
};
const TRICK_TH = { wiggle: "ส่ายหัว", tilt: "เอียงคอ", chirp: "ร้องดีใจ", bounce: "เด้ง", wink: "ขยิบตา" };
const SOUND_TH = { greet: "หวัดดี!", inquire: "หือ?", chirp: "จิ๊บ!", coo: "อืออ~", peck: "ฮึ่ม!", alarm: "!!" };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap180 = (d) => ((d + 540) % 360) - 180;
const $ = (id) => document.getElementById(id);

// ============================================================
// ฉาก
// ============================================================
const canvas = $("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const BG = new THREE.Color(0x121a1c);
scene.background = BG;
scene.fog = new THREE.Fog(BG, 140, 320);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1, 1000);
const OWNER_VIEW = { pos: new THREE.Vector3(0, 24, 46), target: new THREE.Vector3(0, 7, 0) };
camera.position.copy(OWNER_VIEW.pos);

scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x3a2a20, 0.55));
const key = new THREE.DirectionalLight(0xffe4c4, 2.2);
key.position.set(30, 60, 40);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 10, far: 160 });
key.shadow.bias = -0.0005;
key.shadow.radius = 3;
scene.add(key);
const rim = new THREE.DirectionalLight(0x8fe3ea, 0.7);
rim.position.set(-30, 25, -40);
scene.add(rim);

function deskTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d");
  g.fillStyle = "#6e523d";
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 260; i++) {                     // ลายไม้
    const y = Math.random() * 1024;
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? "40,26,16" : "150,112,80"},${0.05 + Math.random() * 0.12})`;
    g.lineWidth = 1 + Math.random() * 3;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 1024; x += 64) g.lineTo(x, y + Math.sin(x / 140 + i) * 6);
    g.stroke();
  }
  const fade = g.createRadialGradient(512, 512, 180, 512, 512, 512);
  fade.addColorStop(0, "rgba(18,26,28,0)");
  fade.addColorStop(1, "rgba(18,26,28,1)");
  g.fillStyle = fade;
  g.fillRect(0, 0, 1024, 1024);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const desk = new THREE.Mesh(new THREE.CircleGeometry(160, 96),
  new THREE.MeshStandardMaterial({ map: deskTexture(), roughness: 0.78 }));
desk.rotation.x = -Math.PI / 2;
desk.receiveShadow = true;
scene.add(desk);

// ============================================================
// ตัวหุ่น
// ============================================================
// เปลือกรูปไข่: ครึ่งล่างรัศมีตั้ง Rb ครึ่งบนรัศมีตั้ง Rt
const SH = { R: 3.3, Rb: 3.0, Rt: 4.6, phi0: -0.9 };
SH.yc = -SH.Rb * Math.sin(SH.phi0);
const shellR = (y) => {
  const s = (y - SH.yc) / (y >= SH.yc ? SH.Rt : SH.Rb);
  return SH.R * Math.sqrt(Math.max(0, 1 - s * s));
};
const BASE_H = 4.8;
const BODY_Y = 5.05;                       // ส่วนที่หมุนเริ่มที่ความสูงนี้
const SCREEN_Y = SH.yc + 0.6;
const SCREEN_R = 1.62;                     // จอ 1.28" พื้นที่แสดงผลกว้าง 32.4 มม.
const BEZEL_R = 2.0;
const FACE_Z = shellR(SCREEN_Y) + 0.18;
const CROWN_Y = 4.6;                       // เหนือเส้นนี้คือฟอยล์บนหัว
const SIDE_X = 1.6;                        // ห่างจากแกนกลางเกินนี้คือฟอยล์ด้านข้าง (ซ้าย ขวา)
const SIDE_PHI = [0.5, 2.14];              // มุมเริ่มและความกว้างของฟอยล์ด้านข้าง (เรเดียน วัดจากด้านหน้า)
const LENS_Y = SCREEN_Y + 2.45;
const PROFILE_STEPS = 48;
const WING = { x: 3.2, y: SH.yc + 0.15, z: -0.2, rz: 0.28, s: [0.45, 1.25, 0.95] };

function shellProfile(fromY = -Infinity, toY = Infinity) {
  const pts = [];
  for (let i = 0; i <= PROFILE_STEPS; i++) {
    const phi = SH.phi0 + (Math.PI / 2 - SH.phi0) * i / PROFILE_STEPS;
    const y = SH.yc + (phi < 0 ? SH.Rb : SH.Rt) * Math.sin(phi);
    if (y >= fromY && y <= toY) pts.push(new THREE.Vector2(SH.R * Math.cos(phi), y));
  }
  return pts;
}

const mats = {
  shell: new THREE.MeshPhysicalMaterial({ color: 0xf2ece1, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
  wing: new THREE.MeshPhysicalMaterial({ color: 0xe6dccb, roughness: 0.5, clearcoat: 0.2 }),
  base: new THREE.MeshStandardMaterial({ color: 0x2b3436, roughness: 0.6 }),
  leaves: new THREE.MeshStandardMaterial({ color: 0x7fd3db, roughness: 0.35, emissive: 0x1d4f53, emissiveIntensity: 0.4 }),
  bezel: new THREE.MeshStandardMaterial({ color: 0x121819, roughness: 0.25, metalness: 0.1 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0b0f10, roughness: 0.4 }),
};
mats.ring = mats.leaves.clone();           // แยกวัสดุไว้ ชุดจะได้เปลี่ยนสีขนบนหัวกับวงแหวนที่ฐานแยกกันได้
const XRAY_MATS = [mats.shell, mats.wing, mats.base, mats.leaves, mats.ring, mats.bezel];

const pickables = [];
function addMesh(parent, geo, mat, zone, opts = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = opts.shadow !== false;
  m.receiveShadow = true;
  if (zone) {
    m.userData.zone = zone;
    pickables.push(m);
  }
  parent.add(m);
  return m;
}

const root = new THREE.Group();
scene.add(root);
const yaw = new THREE.Group();             // ส่วนที่ MG996R หมุน
yaw.position.y = BODY_Y;
root.add(yaw);

// ฐาน (มี MG996R อยู่ข้างใน)
const baseBody = addMesh(root, new THREE.LatheGeometry([
  [0, 0], [4.1, 0], [4.25, 0.25], [4.2, 0.6], [3.85, 4.3], [3.7, 4.65], [3.4, BASE_H], [0, BASE_H],
].map(([x, y]) => new THREE.Vector2(x, y)), 64), mats.base, "base");
const ring = addMesh(root, new THREE.TorusGeometry(3.87, 0.1, 12, 96), mats.ring, "base");
ring.rotation.x = Math.PI / 2;
ring.position.y = 4.25;
const baseTop = addMesh(root, new THREE.CylinderGeometry(3.0, 3.0, 0.26, 48), mats.dark, "base");
baseTop.position.y = BASE_H + 0.13;

// เปลือก
const shellPts = [new THREE.Vector2(0, 0), ...shellProfile()];
const shell = addMesh(yaw, new THREE.LatheGeometry(shellPts, 72), mats.shell, "shell");
shell.rotation.y = Math.PI;                // รอยต่อไปอยู่ด้านหลัง

// ปีกเล็กๆ สองข้าง (ข้างในมีฟอยล์)
const wings = [1, -1].map((sx) => {
  const w = addMesh(yaw, new THREE.SphereGeometry(1, 32, 24), mats.wing, sx > 0 ? "left" : "right");
  w.scale.set(...WING.s);
  w.position.set(sx * WING.x, WING.y, WING.z);
  w.rotation.z = sx * WING.rz;
  return w;
});

// ขนบนหัว
const leaves = [[0, 7.5, 0, 1], [0.45, 7.25, -0.6, 0.8], [-0.45, 7.25, 0.6, 0.8]].map(([x, y, rz, s]) => {
  const leaf = addMesh(yaw, new THREE.CapsuleGeometry(0.26, 0.9, 6, 16), mats.leaves, "crown");
  leaf.position.set(x, y, -0.1);
  leaf.rotation.set(-0.2, 0, rz);
  leaf.scale.setScalar(s);
  return leaf;
});

// จอ
const bezel = addMesh(yaw, new THREE.CylinderGeometry(BEZEL_R, BEZEL_R, 1.3, 64), mats.bezel, "face");
bezel.rotation.x = Math.PI / 2;
bezel.position.set(0, SCREEN_Y, FACE_Z - 0.65);
const bezelRim = addMesh(yaw, new THREE.TorusGeometry(BEZEL_R - 0.12, 0.16, 16, 72), mats.bezel, "face");
bezelRim.position.set(0, SCREEN_Y, FACE_Z - 0.02);

const faceCanvas = document.createElement("canvas");
faceCanvas.width = faceCanvas.height = 480;
const faceCtx = faceCanvas.getContext("2d");
const screenTex = new THREE.CanvasTexture(faceCanvas);
screenTex.colorSpace = THREE.SRGBColorSpace;
screenTex.anisotropy = 4;
const screen = addMesh(yaw, new THREE.CircleGeometry(SCREEN_R, 64),
  new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }), "face", { shadow: false });
screen.position.set(0, SCREEN_Y, FACE_Z + 0.01);
const glass = new THREE.Mesh(new THREE.CircleGeometry(SCREEN_R + 0.05, 64), new THREE.MeshPhysicalMaterial({
  color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.03, clearcoat: 1, envMapIntensity: 2, depthWrite: false,
}));
glass.position.set(0, SCREEN_Y, FACE_Z + 0.03);
yaw.add(glass);

// กล้อง OV3660 เหนือจอ
const lensPhi = Math.asin((LENS_Y - SH.yc) / SH.Rt);
const lensTilt = Math.atan2(SH.R * Math.sin(lensPhi), SH.Rt * Math.cos(lensPhi));
const lensZ = shellR(LENS_Y);
const lens = new THREE.Group();
lens.position.set(0, LENS_Y, lensZ - 0.05);
lens.rotation.x = -lensTilt;
yaw.add(lens);
const lensBody = addMesh(lens, new THREE.CylinderGeometry(0.42, 0.42, 0.3, 32), mats.bezel, "face");
lensBody.rotation.x = Math.PI / 2;
const lensGlass = addMesh(lens, new THREE.CircleGeometry(0.26, 32), new THREE.MeshPhysicalMaterial({
  color: 0x14243a, roughness: 0.05, clearcoat: 1, metalness: 0.3,
}), "face", { shadow: false });
lensGlass.position.z = 0.16;

const haroCam = new THREE.PerspectiveCamera(HW.CAM_VFOV, 4 / 3, 0.5, 400);   // near สั้น ให้เห็นชุดที่บังเลนส์
haroCam.rotation.order = "YXZ";
haroCam.rotation.y = Math.PI;              // มองไปข้างหน้าตัวหุ่น (+Z)
haroCam.rotation.x = HW.CAM_TILT * D2R;
haroCam.position.set(0, LENS_Y, lensZ + 0.15);
haroCam.layers.enable(1);                  // layer 1 = ร่างของคุณ ให้ Haro เห็นแต่ไม่บังกล้องของคุณ
yaw.add(haroCam);

// แสงเรืองตรงที่ลูบ
function glowMat() {
  return new THREE.MeshBasicMaterial({ color: 0x8fe3ea, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending });
}
const glow = { crown: glowMat(), left: glowMat(), right: glowMat() };
const crownGlow = new THREE.Mesh(new THREE.LatheGeometry(shellProfile(CROWN_Y), 72), glow.crown);
crownGlow.scale.setScalar(1.015);
crownGlow.renderOrder = 2;
yaw.add(crownGlow);
const padMeshes = { crown: crownGlow };
for (const [start, zone] of [[SIDE_PHI[0], "left"], [Math.PI + SIDE_PHI[0], "right"]]) {
  const g = new THREE.Mesh(new THREE.LatheGeometry(shellProfile(0.3, CROWN_Y), 40, start, SIDE_PHI[1]), glow[zone]);
  g.scale.setScalar(1.015);
  g.renderOrder = 2;
  yaw.add(g);
  padMeshes[zone] = g;
}

// จุดยึดของแต่งจากไฟล์ชุด (พิกัดอธิบายใน outfits/README.md) ทุกจุดหมุนไปกับตัว ยกเว้น base
const anchors = {};
for (const [name, parent, p] of [
  ["head", yaw, [0, SH.yc + SH.Rt, 0]],      // ยอดหัว
  ["face", yaw, [0, SCREEN_Y, FACE_Z]],      // กลางจอ
  ["body", yaw, [0, 0, 0]],                  // ก้นตัว ตรงที่ตัวนั่งบนฐาน
  ["back", yaw, [0, SH.yc, -SH.R]],          // กลางหลัง
  ["left", yaw, [WING.x, WING.y, WING.z]],   // ปีกซ้ายของ Haro
  ["right", yaw, [-WING.x, WING.y, WING.z]],
  ["base", root, [0, 0, 0]],                 // พื้นโต๊ะใต้ฐาน ไม่หมุน
]) {
  const a = new THREE.Group();
  a.position.set(...p);
  parent.add(a);
  anchors[name] = a;
}
const wardrobe = new Wardrobe({
  anchors, faceColors: COLORS,
  slots: { shell: mats.shell, wings: mats.wing, leaves: mats.leaves, base: mats.base, ring: mats.ring, bezel: mats.bezel },
  hideable: { wings, leaves, ring: [ring] },
});

// ---------- ชิ้นส่วนข้างใน (เห็นตอนกด X) ----------
const inside = new THREE.Group();
inside.visible = false;
root.add(inside);
const insideYaw = new THREE.Group();
insideYaw.visible = false;
yaw.add(insideYaw);
const partMat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...extra });

// MG996R 360° ในฐาน แกนอยู่ค่อนไปทางหนึ่งของตัวเซอร์โว
addMesh(inside, new THREE.BoxGeometry(4.07, 3.7, 1.97), partMat(0x1b1d1e), null).position.set(1.0, 2.1, 0);
addMesh(inside, new THREE.BoxGeometry(5.45, 0.25, 1.97), partMat(0x1b1d1e), null).position.set(1.0, 3.05, 0);
addMesh(inside, new THREE.CylinderGeometry(0.3, 0.3, 0.7, 16), partMat(0xc9b26b, { metalness: 0.6 }), null)
  .position.set(0, 4.3, 0);
addMesh(inside, new THREE.CylinderGeometry(1.1, 1.1, 0.2, 32), partMat(0xf2f2f2), null).position.set(0, 4.75, 0);

// ESP32-S3 + กล้อง + จอ ในหัว
addMesh(insideYaw, new THREE.BoxGeometry(2.75, 4.0, 0.16), partMat(0x1f6f43), null)
  .position.set(0, SCREEN_Y + 0.4, FACE_Z - 1.75);
addMesh(insideYaw, new THREE.BoxGeometry(1.8, 1.6, 0.32), partMat(0xc5cbcf, { metalness: 0.8, roughness: 0.3 }), null)
  .position.set(0, SCREEN_Y + 0.7, FACE_Z - 1.95);
const lcdPcb = addMesh(insideYaw, new THREE.CylinderGeometry(1.95, 1.95, 0.16, 48), partMat(0x1d3557), null);
lcdPcb.rotation.x = Math.PI / 2;
lcdPcb.position.set(0, SCREEN_Y, FACE_Z - 1.05);
const ribbon = addMesh(insideYaw, new THREE.BoxGeometry(0.8, 1.9, 0.04), partMat(0xd98a2b), null);
ribbon.position.set(0, (SCREEN_Y + 2.4 + LENS_Y) / 2 - 0.4, lensZ - 0.9);
ribbon.rotation.x = -0.5;

// ฟอยล์ที่ต่อกับ touch pin
const foilMat = new THREE.MeshStandardMaterial({ color: 0xcfd6da, metalness: 1, roughness: 0.32, side: THREE.DoubleSide });
const foilCrown = addMesh(insideYaw, new THREE.LatheGeometry(shellProfile(CROWN_Y + 0.15), 72), foilMat, null);
foilCrown.scale.setScalar(0.94);
for (const start of [SIDE_PHI[0] + 0.15, Math.PI + SIDE_PHI[0] + 0.15]) {
  addMesh(insideYaw, new THREE.LatheGeometry(shellProfile(0.7, CROWN_Y - 0.25), 40, start, SIDE_PHI[1] - 0.3), foilMat, null)
    .scale.setScalar(0.94);
}

// สายไฟจากหัวลงฐาน (ผ่านแกนหมุน)
for (const [dx, color] of [[-0.12, 0xd33c3c], [0, 0x222222], [0.12, 0xe6c34a]]) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(dx, SCREEN_Y - 1.6, FACE_Z - 1.8), new THREE.Vector3(dx, 1.0, 0.8),
    new THREE.Vector3(dx * 2, 0.2, 0.1), new THREE.Vector3(dx * 2 + 0.5, -0.9, 0),
  ]);
  addMesh(insideYaw, new THREE.TubeGeometry(curve, 24, 0.06, 6), partMat(color), null);
}

// สาย USB ไปโน้ตบุ๊ก
const usb = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0.5, -4.0), new THREE.Vector3(0, 0.3, -9), new THREE.Vector3(-6, 0.3, -20),
  new THREE.Vector3(-14, 0.3, -31), new THREE.Vector3(-20.7, 0.8, -34.7),
]);
addMesh(root, new THREE.TubeGeometry(usb, 80, 0.22, 8), partMat(0x23292b), null);

// ---------- โน้ตบุ๊ก (สมองตัวจริงอยู่ในนี้) ----------
const laptopCanvas = document.createElement("canvas");
laptopCanvas.width = 640;
laptopCanvas.height = 400;
const laptopCtx = laptopCanvas.getContext("2d");
const laptopTex = new THREE.CanvasTexture(laptopCanvas);
laptopTex.colorSpace = THREE.SRGBColorSpace;
{
  const lap = new THREE.Group();
  lap.position.set(-36, 0, -30);
  lap.rotation.y = 0.3;
  scene.add(lap);
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a4245, metalness: 0.6, roughness: 0.38 });
  addMesh(lap, new THREE.BoxGeometry(32, 1.6, 22), metal, null).position.y = 0.8;
  const kb = addMesh(lap, new THREE.PlaneGeometry(28, 10), partMat(0x1c2123), null, { shadow: false });
  kb.rotation.x = -Math.PI / 2;
  kb.position.set(0, 1.61, -3);
  const lid = new THREE.Group();
  lid.position.set(0, 1.6, -11);
  lid.rotation.x = -0.28;
  lap.add(lid);
  addMesh(lid, new THREE.BoxGeometry(32, 21, 0.8), metal, null).position.y = 10.5;
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(30, 18.75),
    new THREE.MeshBasicMaterial({ map: laptopTex, toneMapped: false }));
  disp.position.set(0, 10.7, 0.41);
  lid.add(disp);
}

// ---------- คน: คุณ (ให้กล้อง Haro เห็นเท่านั้น) และเจ้าของจำลอง ----------
function buildPerson(color, onlyHaroSees) {
  const g = new THREE.Group();
  // หน้าคนหันเข้าหา Haro ซึ่งเป็นด้านที่แสงหลักส่องไม่ถึง จึงให้เรืองแสงเองนิดหน่อย (เหมือนแสงจากจอโน้ตบุ๊ก)
  const skin = partMat(0xe2b791, { emissive: 0x6b4a35, emissiveIntensity: 0.6 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(8, 32, 24), skin);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(8.4, 32, 24, 0, Math.PI * 2, 0, 1.25), partMat(0x2a2220));
  hair.rotation.x = -0.35;
  const eyes = [-2.6, 2.6].map((x) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), partMat(0x1a1a1a));
    e.position.set(x, 0.6, 7.4);
    return e;
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(9, 14, 6, 24), partMat(color, { emissive: color, emissiveIntensity: 0.25 }));
  body.position.set(0, -20, -3);
  g.add(head, hair, ...eyes, body);
  if (onlyHaroSees) g.traverse((o) => o.layers.set(1));
  scene.add(g);
  return g;
}
const you = buildPerson(0x4a6fa5, true);
const botPerson = buildPerson(0x8a5a9e, false);
const BOT_FACE = new THREE.Vector3(0, 24, 44);
botPerson.position.copy(BOT_FACE);
botPerson.visible = false;

root.updateMatrixWorld(true);

// ============================================================
// เสียง (ไฟล์เดียวกับ haro.py)
// ============================================================
class Voice {
  constructor() {
    this.pack = "";
    this.enabled = true;
    this.suppressed = false;      // เร่งเวลาเกิน 4× จะเงียบ
    this.cache = new Map();
    this.current = null;
    this.busyUntil = 0;           // เวลาจริง (วินาที) ใช้ปิดไมค์ระหว่าง Haro ส่งเสียง
    this.onPlay = null;
  }

  play(tag) {
    if (this.onPlay) this.onPlay(tag);
    if (!this.enabled || this.suppressed) return;
    const v = "abcd"[Math.floor(Math.random() * 4)];
    const url = `../sounds/${this.pack ? this.pack + "/" : ""}${tag}_${v}.wav`;
    let a = this.cache.get(url);
    if (!a) {
      a = new Audio(url);
      this.cache.set(url, a);
    }
    if (this.current) this.current.pause();          // เสียงใหม่ตัดเสียงเก่า (เหมือน haro.py)
    a.currentTime = 0;
    a.play().catch(() => {});
    this.current = a;
    const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0.8;
    this.busyUntil = performance.now() / 1000 + dur;
  }
}

// ============================================================
// ไมค์ (ไม่บังคับ) ใช้วิธีเดียวกับ Ears ใน haro.py
// ============================================================
class Mic {
  constructor() {
    this.ok = false;
    this.level = 0;
    this.floor = 0.01;
    this.score = 0;
    this.triggered = false;
    this.cooldownUntil = 0;
  }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.stream = stream;
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.buf = new Float32Array(1024);
    this.ctx.createMediaStreamSource(stream).connect(this.analyser);
    this.ok = true;
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close();
    this.ok = false;
  }

  update(dt, nowReal, muteUntil) {
    if (!this.ok) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    const rms = Math.sqrt(sum / this.buf.length);
    this.level = rms;
    this.floor = rms < this.floor ? 0.9 * this.floor + 0.1 * rms : 0.999 * this.floor + 0.001 * rms;
    if (nowReal < muteUntil) {                        // ไม่ฟังเสียงตัวเอง
      this.score = 0;
      return;
    }
    const loud = rms > Math.max(0.025, this.floor * 4);
    this.score = loud ? this.score + dt : Math.max(0, this.score - dt * 0.5);
    if (this.score > 0.3 && nowReal > this.cooldownUntil) {
      this.triggered = true;
      this.score = 0;
      this.cooldownUntil = nowReal + 3;
    }
  }

  heard() {
    const h = this.triggered;
    this.triggered = false;
    return h;
  }
}

// ============================================================
// สมอง + ความจำ (เก็บในเบราว์เซอร์)
// ============================================================
const LS_MEM = "haro-sim-memory-v1";
const LS_LOG = "haro-sim-log-v1";
let simNow = Date.now() / 1000;            // เวลาในการจำลอง (วินาที) เร่งได้
const simClock = () => new Date(simNow * 1000);

function readStore(k) {
  try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; }
}
const voice = new Voice();
const mic = new Mic();
const mem = new Memory(simClock, readStore(LS_MEM));
mem.rows = readStore(LS_LOG) || [];
function persist() {
  try {
    localStorage.setItem(LS_MEM, JSON.stringify(mem.data));
    localStorage.setItem(LS_LOG, JSON.stringify(mem.rows.slice(-5000)));
  } catch { /* ที่เก็บเต็มหรือถูกปิด */ }
}
mem.onSave = persist;
setInterval(persist, 5000);

let brain = new Brain(voice, mem, simNow);
let pose = brain.update(simNow, 0, null, false, null);

// ============================================================
// เจ้าของจำลอง: ลูบหลังท่าที่ชอบตามความน่าจะเป็น ใช้ทดสอบว่า Haro เรียนรู้ได้จริงไหม
// ============================================================
const bot = {
  enabled: false,
  p: { wiggle: 0.7, tilt: 0.2, chirp: 0.2, bounce: 0.2, wink: 0.2 },
  pClingy: 0.6,
  pending: [],
  picks: [],

  best() { return TRICKS.reduce((a, b) => (this.p[b] > this.p[a] ? b : a)); },

  onState(prev, state) {
    if (!this.enabled) return;
    if (state === "trick") {
      this.picks.push(brain.trick === this.best());
      if (this.picks.length > 20) this.picks.shift();
      if (Math.random() < this.p[brain.trick]) this.pending.push(simNow + 0.8 + Math.random() * 2.7);
    } else if (state === "clingy" && Math.random() < this.pClingy) {
      this.pending.push(simNow + 1 + Math.random() * 5);
    }
  },

  poll() {
    const i = this.pending.findIndex((t) => simNow >= t);
    if (i < 0) return null;
    this.pending.splice(i, 1);
    return "bot";
  },
};

// ============================================================
// สถานะการจำลอง
// ============================================================
let running = false;
let speed = 1;
let seated = true;                // คุณนั่งหน้า Haro (Haro มองเห็นได้)
let xray = false;
let yawDeg = 0;                   // มุมตัวหุ่น (+ = หันไปทางซ้ายของ Haro)
let servoVel = 0;
let servoCmd = 0;
let homeYaw = 0;                  // ทิศที่เห็นเจ้าของล่าสุด
let limitHit = false;
let det = null;                   // ผลหาหน้าล่าสุด
let pendingPet = null;
let pendingHeard = false;
const touch = { holding: false, zone: null, t0: 0, moved: 0, x: 0, y: 0 };
let hoverZone = null;

function facePosition() {
  if (bot.enabled) return BOT_FACE;
  return seated ? camera.position : null;
}

// หาหน้าเจ้าของจากกล้องบนหัว Haro (เหมือนผลจาก YuNet: x, y ในภาพ และขนาดหน้า)
const _p = new THREE.Vector3();
const _c = new THREE.Vector3();
function detectFace() {
  const pos = facePosition();
  if (!pos) return { seen: false, why: "ไม่มีใครนั่งอยู่" };
  haroCam.getWorldPosition(_c);
  const d = _c.distanceTo(pos);
  _p.copy(pos).applyMatrix4(haroCam.matrixWorldInverse);
  if (_p.z > 0) return { seen: false, d, why: "อยู่นอกภาพ" };
  _p.copy(pos).project(haroCam);
  if (Math.abs(_p.x) > 0.92 || Math.abs(_p.y) > 0.92) return { seen: false, d, why: "อยู่นอกภาพ" };
  if (d < HW.FACE_NEAR) return { seen: false, d, why: "ใกล้เกินไป" };
  if (d > HW.FACE_FAR) return { seen: false, d, why: "ไกลเกินไป" };
  if (wardrobe.blocks(_c, pos)) return { seen: false, d, why: "ชุดบังกล้อง" };
  // ภาพกล้องไม่กลับด้าน haro.py กลับซ้ายขวาให้ x บวก = เจ้าของอยู่ทางขวาของคนที่มอง Haro
  return { seen: true, d, x: -_p.x, y: -_p.y, ndcX: _p.x, ndcY: _p.y,
    size: HW.FACE_WIDTH / (2 * d * Math.tan(HALF_HFOV)) };
}

// ตัวจริงมีเซอร์โวหมุนต่อเนื่องตัวเดียว สั่งมุมไม่ได้ สั่งได้แค่ความเร็ว
// เห็นหน้า: หมุนจนหน้าอยู่กลางภาพ (visual servoing)  ไม่เห็นหน้า: หมุนไปตามที่สมองอยากมอง โดยนับจากทิศที่เห็นเจ้าของล่าสุด
function stepServo(h) {
  const s = brain.state;
  const t = simNow - brain.tState;
  let u;
  if (det.seen) homeYaw = yawDeg + Math.atan(det.x * Math.tan(HALF_HFOV)) / D2R;
  if (det.seen && TRACK_STATES.has(s)) {
    u = Math.abs(det.x) < 0.08 ? 0 : clamp(0.9 * det.x, -0.7, 0.7);
  } else {
    const err = wrap180(homeYaw + pose.x * HW.PAN_RANGE - yawDeg);
    u = Math.abs(err) < 2 ? 0 : clamp(err / 40, -0.6, 0.6);
  }
  const wiggling = brain.trick === "wiggle" && (s === "trick" || (s === "clingy" && t < 1.6));
  if (wiggling) u += 0.55 * Math.sin(t * 14) * Math.max(0, 1 - t / 1.6);      // ส่ายตัว
  if (s === "petted") u += 0.3 * Math.sin(t * 12) * Math.max(0, 1 - t / 2.2);
  limitHit = (yawDeg >= HW.YAW_LIMIT && u > 0) || (yawDeg <= -HW.YAW_LIMIT && u < 0);
  if (limitHit) u = 0;
  servoCmd = Math.abs(u) < HW.SERVO_DEADBAND ? 0 : u;
  servoVel += (servoCmd * HW.SERVO_MAX - servoVel) * Math.min(1, h / HW.SERVO_LAG);
  yawDeg += servoVel * h;
  yaw.rotation.y = yawDeg * D2R;
  yaw.updateMatrixWorld(true);
}

// ============================================================
// UI: ข้อความ ป้าย ลูกโป่งคำพูด
// ============================================================
function toast(text, cls = "") {
  const el = document.createElement("div");
  el.className = "toastItem " + cls;
  el.textContent = text;
  $("toast").appendChild(el);
  setTimeout(() => el.remove(), 2700);
  while ($("toast").children.length > 3) $("toast").firstChild.remove();
}

const bubbles = [];
const HEAD_TOP = new THREE.Vector3(0, 8.6, 0);
voice.onPlay = (tag) => {
  if (speed > 4 || !running) return;
  const el = document.createElement("div");
  el.className = "bubble";
  el.textContent = SOUND_TH[tag] || tag;
  $("labels").appendChild(el);
  bubbles.push({ el, until: performance.now() + 1300 });
  while (bubbles.length > 2) bubbles.shift().el.remove();
};

const LABELS = [
  [yaw, [BEZEL_R * 0.8, SCREEN_Y + 1.3, FACE_Z], "จอกลม GC9A01 · หน้า + เอียงคอแทนเซอร์โว"],
  [yaw, [0.3, LENS_Y + 0.2, lensZ], "กล้อง OV3660 · หาหน้าเจ้าของ"],
  [yaw, [1.4, SCREEN_Y + 1.2, FACE_Z - 1.75], "ESP32-S3 · คุยกับ haro.py บนโน้ตบุ๊ก"],
  [yaw, [0.8, 6.7, 0.6], "ฟอยล์ + touch pin · จุดลูบหัว"],
  [yaw, [3.3, SH.yc + 0.6, 0.3], "ฟอยล์ด้านข้าง · ลูบข้างตัว"],
  [root, [3.0, 2.6, 1.0], "MG996R 360° · หมุนตัว สั่งได้แค่ความเร็ว"],
  [yaw, [0.1, 0.4, 0.2], "สายจากหัวลงฐาน · หมุนเกิน ±160° สายพัน"],
  [root, [-2.5, 0.6, -9], "USB → โน้ตบุ๊ก · ไฟเซอร์โวใช้ power bank แยก"],
].map(([parent, p, text]) => {
  const anchor = new THREE.Object3D();
  anchor.position.set(...p);
  parent.add(anchor);
  const el = document.createElement("div");
  el.className = "label";
  el.textContent = text;
  el.style.display = "none";
  $("labels").appendChild(el);
  return { anchor, el };
});

function screenPos(world) {
  _p.copy(world).project(camera);
  return { x: (_p.x + 1) / 2 * innerWidth, y: (1 - _p.y) / 2 * innerHeight, ok: _p.z < 1 };
}

function setXray(on) {
  xray = on;
  for (const m of XRAY_MATS) {
    m.transparent = on;
    m.opacity = on ? 0.16 : 1;
    m.depthWrite = !on;
    m.needsUpdate = true;
  }
  inside.visible = insideYaw.visible = on;
  wardrobe.setVisible(!on);
  for (const l of LABELS) l.el.style.display = on ? "" : "none";
  $("xrayBtn").classList.toggle("on", on);
}

// ============================================================
// การลูบ: กดค้างบนฟอยล์ (หัว ปีกซ้าย ปีกขวา)
// ============================================================
const raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _local = new THREE.Vector3();

function pick(ev) {
  const r = canvas.getBoundingClientRect();
  _ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(_ndc, camera);
  // ของแต่งไม่อยู่ในรายการนี้ กดโดนหมวกจึงทะลุไปโดนฟอยล์ข้างใต้ เหมือนลูบผ่านผ้า  ส่วนที่ชุดซ่อนไว้กดไม่ได้
  return raycaster.intersectObjects(pickables, false).find((h) => h.object.visible) || null;
}

function zoneOf(hit) {
  if (!hit) return null;
  const z = hit.object.userData.zone;
  if (z !== "shell") return z;
  yaw.worldToLocal(_local.copy(hit.point));
  if (_local.y > CROWN_Y) return "crown";
  if (Math.abs(_local.x) > SIDE_X) return _local.x > 0 ? "left" : "right";
  return "shell";
}
const isPad = (z) => z === "crown" || z === "left" || z === "right";

const ripples = [];
function ripple(point, normal) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 40),
    new THREE.MeshBasicMaterial({ color: 0x8fe3ea, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  m.position.copy(point).addScaledVector(normal, 0.05);
  m.lookAt(_p.copy(m.position).add(normal));
  scene.add(m);
  ripples.push({ m, t0: performance.now() });
}
const rippleAtHit = (hit) => ripple(hit.point, hit.face.normal.clone().transformDirection(hit.object.matrixWorld));

function endTouch() {
  if (!touch.holding) return;
  const dur = performance.now() / 1000 - touch.t0;
  const kind = dur < 0.35 ? "pat" : touch.moved > 60 ? "stroke" : "hold";
  mem.log("pet_touch_end", `${touch.zone} ${kind} ${dur.toFixed(1)}s`);
  touch.holding = false;
  touch.zone = null;
}

// ต้องลงทะเบียนก่อนสร้าง OrbitControls เพื่อปิดการหมุนกล้องตอนกดโดนตัวหุ่น
canvas.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0 || !running) return;
  const hit = pick(ev);
  if (!hit) return;                                   // ลากที่ว่าง = เดินรอบโต๊ะ
  controls.enabled = false;                           // กดโดนตัวหุ่น กล้องไม่หมุน
  canvas.setPointerCapture(ev.pointerId);
  const zone = zoneOf(hit);
  if (isPad(zone)) {
    Object.assign(touch, { holding: true, zone, t0: performance.now() / 1000, moved: 0, x: ev.clientX, y: ev.clientY });
    pendingPet = `touch:${zone}`;
    mem.log("pet_touch_start", zone);
    rippleAtHit(hit);
    canvas.style.cursor = "grabbing";
  } else if (zone === "face") {
    toast("จอกับกล้องไม่ใช่จุดสัมผัส ลองลูบที่หัวหรือข้างตัว");
  } else {
    toast("ตรงนี้ไม่มีฟอยล์ ลองลูบที่หัวหรือข้างตัว");
  }
});
canvas.addEventListener("pointermove", (ev) => {
  if (touch.holding) {
    touch.moved += Math.hypot(ev.clientX - touch.x, ev.clientY - touch.y);
    touch.x = ev.clientX;
    touch.y = ev.clientY;
    const zone = zoneOf(pick(ev));
    if (!isPad(zone)) endTouch();                     // นิ้วหลุดจากฟอยล์
    else touch.zone = zone;
    return;
  }
  const zone = zoneOf(pick(ev));
  hoverZone = isPad(zone) ? zone : null;
  canvas.style.cursor = hoverZone ? "grab" : "";
});
function release() {
  endTouch();
  controls.enabled = true;
  canvas.style.cursor = "";
}
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(OWNER_VIEW.target);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 14;
controls.maxDistance = 170;
controls.minPolarAngle = 0.15;
controls.maxPolarAngle = 1.45;
controls.rotateSpeed = 0.6;
controls.update();

// ============================================================
// ปุ่มและคีย์บอร์ด
// ============================================================
function setSeated(on) {
  seated = on;
  const b = $("seenBtn");
  b.classList.toggle("on", on && !bot.enabled);
  b.firstChild.textContent = bot.enabled ? "คุณเป็นผู้ชม" : on ? "นั่งหน้า Haro" : "ลุกออกไปแล้ว";
}
function setSpeed(s) {
  speed = s;
  voice.suppressed = s > 4;
  document.querySelectorAll("[data-speed]").forEach((b) => b.classList.toggle("on", Number(b.dataset.speed) === s));
}
function resetView() {
  camera.position.copy(bot.enabled ? new THREE.Vector3(44, 30, 30) : OWNER_VIEW.pos);
  controls.target.copy(OWNER_VIEW.target);
  controls.update();
}
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$("petBtn").onclick = () => { pendingPet = "button"; };
$("talkBtn").onclick = () => { pendingHeard = true; };
$("seenBtn").onclick = () => { if (!bot.enabled) setSeated(!seated); };
$("xrayBtn").onclick = () => setXray(!xray);
$("camBtn").onclick = resetView;
$("soundBtn").onclick = () => {
  voice.enabled = !voice.enabled;
  $("soundBtn").classList.toggle("on", voice.enabled);
};
$("voiceSel").onchange = (e) => { voice.pack = e.target.value; voice.play("greet"); };
document.querySelectorAll("[data-speed]").forEach((b) => { b.onclick = () => setSpeed(Number(b.dataset.speed)); });
$("micBtn").onclick = async () => {
  if (mic.ok) {
    mic.stop();
  } else {
    try {
      await mic.start();
      toast("ไมค์เปิดแล้ว พูดหรือปรบมือ Haro จะหันมาสงสัย");
    } catch (e) {
      toast("เปิดไมค์ไม่ได้: " + e.message);
    }
  }
  $("micBtn").classList.toggle("on", mic.ok);
};

$("botBtn").onclick = () => {
  bot.enabled = !bot.enabled;
  bot.pending = [];
  bot.picks = [];
  botPerson.visible = bot.enabled;
  $("botBtn").textContent = bot.enabled ? "ปิด" : "เปิด";
  $("botBtn").classList.toggle("on", bot.enabled);
  setSeated(seated);
  resetView();
  if (bot.enabled) toast("ลองเร่งเวลาเป็น 16× แล้วดูคะแนนท่าที่บอตชอบค่อยๆ สูงขึ้น");
};
{
  const box = $("botSliders");
  for (const k of [...TRICKS, "clingy"]) {
    const row = document.createElement("label");
    row.className = "slider";
    const v = k === "clingy" ? bot.pClingy : bot.p[k];
    row.innerHTML = `<span>${k === "clingy" ? "ตอนอ้อน" : TRICK_TH[k]}</span>` +
      `<input type="range" min="0" max="100" value="${v * 100}"><span class="mono">${Math.round(v * 100)}%</span>`;
    const input = row.querySelector("input");
    input.oninput = () => {
      const p = input.value / 100;
      if (k === "clingy") bot.pClingy = p; else bot.p[k] = p;
      row.lastChild.textContent = `${input.value}%`;
      bot.picks = [];
    };
    box.appendChild(row);
  }
}

$("saveMem").onclick = () => download("haro_memory.json", JSON.stringify(mem.data, null, 2), "application/json");
$("saveLog").onclick = () => download("haro_log.csv", mem.toCSV(), "text/csv");
$("loadMem").onclick = () => $("memFile").click();
$("memFile").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    mem.load(JSON.parse(await f.text()));
    persist();
    toast(`โหลดความจำแล้ว: เจอกัน ${mem.data.meets} ครั้ง ท่าโปรด ${TRICK_TH[mem.favorite()]}`);
  } catch (err) {
    toast("ไฟล์นี้ใช้ไม่ได้: " + err.message);
  }
  e.target.value = "";
};
let resetArmed = 0;
$("resetMem").onclick = () => {
  if (performance.now() > resetArmed) {
    resetArmed = performance.now() + 3000;
    $("resetMem").textContent = "กดอีกครั้งเพื่อยืนยัน";
    setTimeout(() => { $("resetMem").textContent = "ล้างความจำ"; }, 3000);
    return;
  }
  resetArmed = 0;
  $("resetMem").textContent = "ล้างความจำ";
  mem.load({});
  mem.rows = [];
  $("log").innerHTML = "";
  brain = new Brain(voice, mem, simNow);
  bot.picks = [];
  persist();
  toast("ล้างความจำแล้ว Haro จะเริ่มเรียนรู้ใหม่");
};

// ============================================================
// ตู้เสื้อผ้า: ชุดอยู่ใน sim/outfits/<ชื่อชุด>/ ใส่ใน git แล้วทุกคนที่ pull ได้ชุดเดียวกัน
// ============================================================
const LS_OUTFIT = "haro-sim-outfit";
const SCREEN_RAYS = { parent: yaw, center: [0, SCREEN_Y, FACE_Z + 0.05], radius: SCREEN_R,
  toward: [0, Math.sin(20 * D2R), Math.cos(20 * D2R)] };          // มองจอจากระดับตาเจ้าของ
const SKIN_GEO = { SH, STEPS: PROFILE_STEPS, CROWN_Y, SIDE_X, SCREEN_Y, BEZEL_R, LENS_Y, WING };
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
let outfits = [];
let localOutfits = [];            // ชุดที่ลองจากเครื่อง (หายเมื่อรีเฟรชหน้า)
let outfitState = null;           // { warnings, cover } ของชุดที่ใส่อยู่

const outfitLabel = (it) => (it.def && typeof it.def.name === "string" ? it.def.name : it.folder || it.id);

// ไข่สีเล็กๆ บอกหน้าตาของชุด
function swatch(it) {
  const def = it.def || {};
  const body = def.body || {};
  const scr = def.screen || {};
  const hex = (v, d) => (typeof v === "string" && HEX.test(v) ? v : d);
  const col = (slot) => hex(body[slot] && body[slot].color, wardrobe.defaultHex(slot));
  const el = document.createElement("span");
  el.className = "sw";
  const eye = hex(scr.eye, wardrobe.faceDefaults.eye), bg = hex(scr.background, wardrobe.faceDefaults.screen);
  let layers = `radial-gradient(circle at 50% 58%, ${eye} 0 7%, ${bg} 8% 24%, ${col("bezel")} 25% 30%, transparent 31%)`;
  const tex = body.shell && body.shell.texture;
  if (it.source === "repo" && typeof tex === "string" && /^[A-Za-z0-9_\-./]+$/.test(tex) && !tex.includes("..")) {
    layers += `, url("outfits/${it.id}/${tex}") center / cover`;
  }
  el.style.background = `${layers}, ${col("shell")}`;
  const hidden = Array.isArray(def.hide) ? def.hide : [];
  if (!hidden.includes("leaves")) el.style.setProperty("--leaf", col("leaves"));
  return el;
}

function renderOutfits() {
  const cur = wardrobe.current;
  $("outfitGrid").replaceChildren(...outfits.map((it) => {
    const b = document.createElement("button");
    b.className = "outfit" + (cur && cur.id === it.id ? " on" : "") + (it.error ? " bad" : "");
    const name = document.createElement("span");
    name.textContent = outfitLabel(it);
    b.append(swatch(it), name);
    b.title = it.error ? `เปิดไม่ได้: ${it.error}` : it.source === "local" ? "ลองจากเครื่อง ยังไม่อยู่ใน git" : `sim/outfits/${it.id}/`;
    b.onclick = () => wearOutfit(it);
    return b;
  }));
  const box = $("outfitInfo");
  box.replaceChildren();
  if (!cur) return;
  const def = cur.def || {};
  const add = (cls, text) => {
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    box.appendChild(d);
  };
  add("oname", outfitLabel(cur) + (def.author ? ` · โดย ${def.author}` : ""));
  if (def.description) add("muted", String(def.description));
  add("muted mono", cur.source === "local" ? `ลองจากเครื่อง: ${cur.folder}/ (ยังไม่อยู่ใน git)` : `sim/outfits/${cur.id}/outfit.json`);
  if (outfitState) {
    const { camera: c, screen: s } = outfitState.cover;
    add(c > 0.05 || s > 0.1 ? "warn" : "muted", `ชุดบังกล้อง ${Math.round(c * 100)}% · บังจอ ${Math.round(s * 100)}%`);
    for (const w of outfitState.warnings) add("warn", "⚠ " + w);
  }
  if (def.credits) add("muted", `เครดิต: ${def.credits}`);
}

async function wearOutfit(it, announce = true) {
  if (!it) return;
  if (it.error) {
    toast(`ชุด ${outfitLabel(it)} เปิดไม่ได้: ${it.error}`);
    return;
  }
  const res = await wardrobe.apply(it);
  if (!res) return;                                   // เลือกชุดอื่นต่อระหว่างโหลด
  outfitState = { warnings: res.warnings, cover: wardrobe.coverage(haroCam, SCREEN_RAYS) };
  if (it.source === "repo") {
    localStorage.setItem(LS_OUTFIT, it.id);
    const u = new URL(location.href);
    u.searchParams.set("outfit", it.id);              // ส่งลิงก์นี้ให้เพื่อน จะเปิดมาเจอชุดเดียวกัน
    history.replaceState(null, "", u);
  }
  renderOutfits();
  if (!announce) return;
  toast(`Haro ใส่ชุด "${outfitLabel(it)}" แล้ว` + (res.warnings.length ? ` · มีคำเตือน ${res.warnings.length} ข้อ` : ""));
  if (running) mem.log("outfit", it.id);
}

async function refreshOutfits(reapply) {
  const cur = wardrobe.current;
  outfits = (await wardrobe.list()).concat(localOutfits);
  renderOutfits();
  if (reapply && cur && cur.source === "repo") await wearOutfit(outfits.find((o) => o.id === cur.id), false);
}

async function tryLocal(entries) {
  try {
    const it = await wardrobe.fromFiles(entries);
    localOutfits = localOutfits.filter((o) => o.id !== it.id).concat(it);
    outfits = outfits.filter((o) => o.source !== "local").concat(localOutfits);
    openWardrobe(true);
    renderOutfits();
    await wearOutfit(it);
  } catch (e) {
    toast("ลองชุดไม่ได้: " + e.message);
  }
}

function openWardrobe(on = !$("wardrobe").classList.contains("show")) {
  $("wardrobe").classList.toggle("show", on);
  $("outfitBtn").classList.toggle("on", on);
  if (on) $("wardrobe").style.bottom = `${innerHeight - $("bar").getBoundingClientRect().top + 8}px`;
}

$("outfitBtn").onclick = () => openWardrobe();
$("wardrobeClose").onclick = () => openWardrobe(false);
$("outfitReload").onclick = async () => {
  await refreshOutfits(true);
  toast(`เจอ ${outfits.length} ชุด`);
};
$("outfitLocal").onclick = () => $("outfitDir").click();
$("outfitDir").onchange = (e) => {
  tryLocal([...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })));
  e.target.value = "";
};
$("skinTemplate").onclick = () => {
  const c = document.createElement("canvas");
  drawSkinTemplate(c, SKIN_GEO);
  c.toBlob((b) => download("haro-skin-template.png", b, "image/png"));
};

// ตัว Haro เป็นไฟล์ .glb ไว้ปั้นของแต่งใน Blender (สีเดิม ไม่รวมชุดที่ใส่อยู่)
// 1 หน่วย = 1 ซม.  จุดกำเนิด = จุดยึด body (ก้นตัว) ปั้นของแต่งตรงตำแหน่งบนตัวนี้แล้วใส่ "at": "body" ได้เลย
function bodyGLB() {
  const yawInv = new THREE.Matrix4().copy(yaw.matrixWorld).invert();
  const baseToBody = new THREE.Matrix4().makeTranslation(0, -BODY_Y, 0);
  const frame = (o) => {
    o.updateWorldMatrix(true, false);
    let onBody = false;
    o.traverseAncestors((a) => { if (a === yaw) onBody = true; });
    return new THREE.Matrix4().multiplyMatrices(onBody ? yawInv : baseToBody, o.matrixWorld);
  };
  const lin = (c) => new THREE.Color(c).toArray();          // three.js เก็บสีแบบ linear เหมือน glTF
  const slot = (name, mesh, s, extra = {}) => {
    const d = wardrobe.defaults[s];
    return { name, geometry: mesh.geometry, matrix: frame(mesh), color: lin(d.color), roughness: d.roughness,
      metalness: d.metalness, ...extra };
  };
  const plain = (name, mesh, color, extra = {}) => ({ name, geometry: mesh.geometry, matrix: frame(mesh), color: lin(color), ...extra });

  // บริเวณที่กล้องมองเห็น ยาว 12 ซม. ของแต่งไม่ควรล้ำเข้าไป
  const L = 12, th = Math.tan((HW.CAM_VFOV / 2) * D2R) * L, tw = (th * 4) / 3;
  const view = new THREE.BufferGeometry();
  view.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, -tw, -th, -L, tw, -th, -L, tw, th, -L, -tw, th, -L], 3));
  view.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1]);

  const meshes = [
    slot("shell", shell, "shell", { uv: true }),
    slot("wing_left", wings[0], "wings"),
    slot("wing_right", wings[1], "wings"),
    ...leaves.map((l, i) => slot(`leaf_${i + 1}`, l, "leaves")),
    slot("screen_bezel", bezel, "bezel"),
    slot("screen_rim", bezelRim, "bezel"),
    plain("screen", screen, wardrobe.faceDefaults.screen, { roughness: 0.2 }),
    slot("camera_lens_body", lensBody, "bezel"),
    plain("camera_lens", lensGlass, 0x14243a, { roughness: 0.1 }),
    slot("base", baseBody, "base"),
    slot("base_ring", ring, "ring"),
    plain("base_top", baseTop, 0x0b0f10),
    ...Object.entries(padMeshes).map(([z, m]) => plain(`touch_pad_${z}`, m, 0x8fe3ea, { opacity: 0.35, doubleSided: true })),
    { name: "camera_view_keep_clear", geometry: view, matrix: frame(haroCam), color: lin(0xff5050), opacity: 0.18,
      doubleSided: true },
  ];
  const empties = Object.entries(anchors).map(([name, a]) =>
    ({ name: `anchor_${name}`, position: new THREE.Vector3().setFromMatrixPosition(frame(a)).toArray() }));
  const out = writeGLB({ meshes, empties, generator: "Haro Simulator (sim/main.js)" });
  view.dispose();
  return out;
}
$("bodyGlb").onclick = () => download("haro-body.glb", bodyGLB(), "model/gltf-binary");

// ลากโฟลเดอร์ชุดมาวางบนหน้านี้ = ลองใส่ทันที
async function readEntry(entry, out) {
  if (out.length > 300) return;
  if (entry.isFile) {
    out.push({ file: await new Promise((ok, fail) => entry.file(ok, fail)), path: entry.fullPath });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((ok, fail) => reader.readEntries(ok, fail));
      if (!batch.length) break;
      for (const e of batch) await readEntry(e, out);
    }
  }
}
addEventListener("dragover", (e) => {
  if (![...e.dataTransfer.types].includes("Files")) return;
  e.preventDefault();
  $("dropHint").classList.add("show");
});
addEventListener("dragleave", (e) => { if (!e.relatedTarget) $("dropHint").classList.remove("show"); });
addEventListener("drop", async (e) => {
  e.preventDefault();
  $("dropHint").classList.remove("show");
  const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  const loose = [...e.dataTransfer.files].map((f) => ({ file: f, path: f.name }));   // ลากมาเป็นไฟล์ ไม่ใช่โฟลเดอร์
  const out = [];
  for (const en of entries) await readEntry(en, out);
  if (out.length || loose.length) tryLocal(out.length ? out : loose);
});

refreshOutfits(false).then(() => {
  const want = new URLSearchParams(location.search).get("outfit") || localStorage.getItem(LS_OUTFIT) || "classic";
  const ok = (id) => outfits.find((o) => o.id === id && !o.error);
  return wearOutfit(ok(want) || ok("classic"), false);
});

addEventListener("keydown", (e) => {
  if (!running || e.target.closest("input, select")) return;
  const k = e.key.toLowerCase();
  if (k === " ") { pendingPet = "space"; e.preventDefault(); }
  else if (k === "t") pendingHeard = true;
  else if (k === "l") $("seenBtn").click();
  else if (k === "x") setXray(!xray);
  else if (k === "c") resetView();
  else if (k === "m") $("soundBtn").click();
  else if (k === "o") openWardrobe();
  else if (k === "escape") openWardrobe(false);
  else if (["1", "2", "3", "4"].includes(k)) setSpeed([1, 4, 16, 64][Number(k) - 1]);
});

$("startBtn").onclick = () => {
  $("intro").remove();
  running = true;
  simNow = Date.now() / 1000;
  brain = new Brain(voice, mem, simNow);
  mem.log("start");
  canvas.focus();
};

addEventListener("resize", () => {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if ($("wardrobe").classList.contains("show")) openWardrobe(true);
});

// ============================================================
// แผงข้อมูล
// ============================================================
const trickRows = {};
for (const t of TRICKS) {
  const row = document.createElement("div");
  row.className = "trick";
  row.innerHTML = `<span>${TRICK_TH[t]}</span><div class="bar"><i></i></div><span class="n"></span>`;
  $("tricks").appendChild(row);
  trickRows[t] = row;
}

mem.onLog = (row) => {
  const el = document.createElement("div");
  el.innerHTML = `<span class="t">${row[0].slice(11)}</span><span class="e"></span><span></span>`;
  el.children[1].textContent = row[1];
  el.children[2].textContent = row[2];
  $("log").prepend(el);
  while ($("log").children.length > 60) $("log").lastChild.remove();
  if (row[1] === "trick_liked" && speed <= 4) toast(`❤ Haro จำได้ว่าคุณชอบท่า${TRICK_TH[row[2]]}`, "love");
};
for (const row of mem.rows.slice(-30)) mem.onLog(row);

function meter(label, value, max, warm) {
  const pct = clamp(value / max, 0, 1) * 100;
  return `<div class="row" style="font-size:12px"><span class="muted">${label}</span>` +
    `<span class="mono">${Math.floor(value)} / ${max} วิ</span></div>` +
    `<div class="meter${warm ? " warm" : ""}"><i style="width:${pct}%"></i></div>`;
}

function stateDetail() {
  const s = brain.state;
  const t = simNow - brain.tState;
  if (s === "trick") return `ท่า: ${TRICK_TH[brain.trick]} · ลูบภายใน 5 วิ = ชอบท่านี้`;
  if (s === "attend") return `ท่าถัดไปในอีก ${Math.max(0, brain.nextTrick - simNow).toFixed(0)} วิ`;
  if (s === "clingy") return `อ้อนด้วยท่าโปรด (${TRICK_TH[brain.trick] || "-"}) ลูบเลย ไม่งั้นงอนในอีก ${Math.max(0, CONFIG.SULK_AFTER - t).toFixed(0)} วิ`;
  if (s === "sulk") return "หันหนี แล้วแอบหันกลับมามอง";
  if (s === "petted") return brain.pettingHold ? "กำลังลูบอยู่ เอียงหัวพิงมือ" : "ดีใจ แก้มแดง";
  if (s === "sleep") return "กลับมานั่งหน้า Haro หรือพูดด้วยเพื่อปลุก";
  if (s === "greet") return `เจอกันครั้งที่ ${mem.data.meets} ยิ่งเจอบ่อยยิ่งดีใจ`;
  if (s === "idle") return brain.present ? "" : "ไม่มีใครอยู่ มองไปรอบๆ";
  return "";
}

function updatePanel() {
  $("stateName").textContent = STATE_TH[brain.state] || brain.state;
  $("stateSub").textContent = stateDetail() || brain.state;

  const who = bot.enabled ? "เจ้าของจำลอง" : "คุณ";
  $("ownerTxt").textContent = brain.present ? `${who} อยู่${det.seen ? " · เห็นหน้า" : " · หน้าหลุด"}` :
    `ไม่อยู่ · ${det.why || ""}`;
  if (det.d !== undefined) {
    const pos = facePosition();
    const rel = pos ? wrap180(Math.atan2(pos.x, pos.z) / D2R - yawDeg) : 0;
    $("ownerGeo").textContent = `${det.d.toFixed(0)} ซม. · เยื้อง ${Math.abs(rel).toFixed(0)}°`;
  } else {
    $("ownerGeo").textContent = "-";
  }
  $("timers").innerHTML = brain.present
    ? meter("ไม่ได้รับความสนใจ (อ้อนที่ 30)", simNow - brain.lastAttention, CONFIG.CLINGY_AFTER, true)
    : meter("อยู่คนเดียว (หาวที่ 40)", simNow - brain.aloneSince, CONFIG.NAP_AFTER, false);
  const us = Math.round(1500 + servoCmd * 500);
  $("servoTxt").textContent = `${us} µs · ตัวหมุน ${yawDeg >= 0 ? "+" : ""}${yawDeg.toFixed(0)}°${limitHit ? " · สุดสาย" : ""}`;
  $("serial").textContent =
    `→ H ${Math.round(pose.x * HW.PAN_RANGE)} ${Math.round(pose.roll)}   (คำสั่งของ haro.py ตอนนี้)\n` +
    `→ E ${pose.expr}\n` +
    `→ servo ${us} µs                (1500 = หยุด)`;

  const fav = mem.favorite();
  for (const t of TRICKS) {
    const s = mem.data.tricks[t];
    trickRows[t].classList.toggle("fav", t === fav);
    trickRows[t].querySelector("i").style.width = `${mem.score(t) * 100}%`;
    trickRows[t].querySelector(".n").textContent = `${s.liked}/${s.tries} · ${mem.score(t).toFixed(2)}`;
  }
  $("countTxt").textContent = `${mem.data.meets} / ${mem.data.pets}`;
  $("clockTxt").textContent = simClock().toLocaleTimeString("th-TH") + (speed > 1 ? ` (${speed}×)` : "");
  const picks = bot.picks;
  $("botStat").textContent = bot.enabled && picks.length
    ? `${Math.round(100 * picks.filter(Boolean).length / picks.length)}% (${TRICK_TH[bot.best()]})` : "-";
}

function updateLaptop() {
  const g = laptopCtx;
  g.fillStyle = "#0c1213";
  g.fillRect(0, 0, 640, 400);
  g.font = "18px Consolas, monospace";
  g.fillStyle = "#6f8d90";
  g.fillText("$ python haro.py --port COM5", 18, 34);
  g.fillText("[body] connected COM5", 18, 58);
  g.fillStyle = "#8fe3ea";
  g.fillText(`state: ${brain.state.padEnd(8)} owner: ${brain.present ? "yes" : "no"}`, 18, 92);
  g.fillText(`favorite: ${mem.favorite()}   pets: ${mem.data.pets}`, 18, 116);
  g.fillStyle = "#b8c9ca";
  mem.rows.slice(-9).forEach((r, i) => g.fillText(`${r[0].slice(11)} ${r[1]} ${r[2]}`.slice(0, 52), 18, 156 + i * 26));
  laptopTex.needsUpdate = true;
}

// ภาพจากกล้อง Haro: กรอบหน้าเหมือนที่ YuNet เห็น
const pipCtx = $("pipOverlay").getContext("2d");
function drawPip(r) {
  const W = 448, H = 336, g = pipCtx, pr = renderer.getPixelRatio();
  g.drawImage(canvas, r.left * pr, r.top * pr, r.width * pr, r.height * pr, 0, 0, W, H);
  g.strokeStyle = "rgba(143,227,234,.35)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(W / 2 - 10, H / 2); g.lineTo(W / 2 + 10, H / 2);
  g.moveTo(W / 2, H / 2 - 10); g.lineTo(W / 2, H / 2 + 10);
  g.stroke();
  g.font = "600 22px 'Leelawadee UI', sans-serif";
  if (det.seen) {
    const cx = (det.ndcX + 1) / 2 * W, cy = (1 - det.ndcY) / 2 * H;
    const w = det.size * W * 1.1, h = w * 1.25;
    g.strokeStyle = "#8fe3ea";
    g.lineWidth = 3;
    g.strokeRect(cx - w / 2, cy - h / 2, w, h);
    g.fillStyle = "#8fe3ea";
    g.fillText(`face ${det.d.toFixed(0)}cm`, cx - w / 2, cy - h / 2 - 8);
  } else {
    g.fillStyle = "rgba(240,180,106,.95)";
    g.fillText(det.why || "", 14, H - 16);
  }
}

// ============================================================
// วนทุกเฟรม
// ============================================================
let lastReal = performance.now() / 1000;
let nextPanel = 0;
let nextLaptop = 0;
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const lcdCtx = $("lcd").getContext("2d");

function frame() {
  requestAnimationFrame(frame);
  const realNow = performance.now() / 1000;
  const realDt = Math.min(0.1, realNow - lastReal);
  lastReal = realNow;
  controls.update();

  if (running) {
    mic.update(realDt, realNow, voice.busyUntil + 0.5);
    const heard = pendingHeard || mic.heard();
    let petEvent = pendingPet;
    pendingPet = null;
    pendingHeard = false;
    // เร่งเวลา: แบ่งเป็นช่วงละไม่เกิน 1/30 วินาทีของเวลาจำลอง เหมือน haro.py ที่ 30 FPS
    const total = realDt * speed;
    const n = Math.max(1, Math.ceil(total / (1 / 30)));
    const h = total / n;
    for (let i = 0; i < n; i++) {
      simNow += h;
      const petted = petEvent || (bot.enabled ? bot.poll() : null);
      petEvent = null;
      det = detectFace();
      const face = det.seen
        ? [det.x + (Math.random() - 0.5) * 0.01, det.y + (Math.random() - 0.5) * 0.01, det.size] : null;
      brain.pettingHold = touch.holding;
      const prev = brain.state;
      pose = brain.update(simNow, h, face, heard && i === 0, petted);
      if (brain.state !== prev) bot.onState(prev, brain.state);
      if (petted === "bot") ripple(yaw.localToWorld(_v.set(0, 7.0, 0.3)), UP);
      stepServo(h);
    }
  } else {
    det = detectFace();
  }

  // หน้าบนจอ
  drawFace(faceCtx, pose, simNow);
  screenTex.needsUpdate = true;
  lcdCtx.drawImage(faceCanvas, 0, 0, 240, 240);

  // ร่างของคุณตามตำแหน่งกล้อง หันหน้าเข้าหา Haro
  you.visible = seated && !bot.enabled;
  you.position.copy(camera.position);
  you.lookAt(yaw.localToWorld(_v.set(0, 4, 0)));
  botPerson.lookAt(yaw.localToWorld(_v.set(0, 4, 0)));

  // แสงตรงที่ลูบ
  for (const z of ["crown", "left", "right"]) {
    const target = touch.holding && touch.zone === z ? 0.35 : hoverZone === z ? 0.12 : 0;
    glow[z].opacity += (target - glow[z].opacity) * Math.min(1, realDt * 12);
  }
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    const p = (performance.now() - r.t0) / 650;
    r.m.scale.setScalar(0.5 + p * 3);
    r.m.material.opacity = Math.max(0, 0.9 * (1 - p));
    if (p >= 1) {
      scene.remove(r.m);
      r.m.geometry.dispose();
      r.m.material.dispose();
      ripples.splice(i, 1);
    }
  }

  // ภาพหลัก แล้วภาพจากกล้อง Haro มุมล่างซ้าย
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  renderer.render(scene, camera);
  const r = $("pip").getBoundingClientRect();
  const y = innerHeight - r.bottom;
  renderer.setScissorTest(true);
  renderer.setViewport(r.left, y, r.width, r.height);
  renderer.setScissor(r.left, y, r.width, r.height);
  renderer.render(scene, haroCam);
  renderer.setScissorTest(false);
  drawPip(r);

  // ป้ายและลูกโป่งคำพูด
  if (xray) {
    for (const l of LABELS) {
      const s = screenPos(l.anchor.getWorldPosition(_v));
      l.el.style.display = s.ok ? "" : "none";
      l.el.style.left = `${s.x}px`;
      l.el.style.top = `${s.y}px`;
    }
  }
  const head = screenPos(yaw.localToWorld(_v.copy(HEAD_TOP)));
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    if (performance.now() > b.until) {
      b.el.remove();
      bubbles.splice(i, 1);
      continue;
    }
    b.el.style.left = `${head.x}px`;
    b.el.style.top = `${head.y}px`;
  }

  if (realNow > nextPanel) {
    nextPanel = realNow + 0.12;
    updatePanel();
  }
  if (realNow > nextLaptop) {
    nextLaptop = realNow + 0.25;
    updateLaptop();
  }
}
requestAnimationFrame(frame);

// สำหรับทดสอบจาก DevTools เช่น haroSim.brain.state, haroSim.setSpeed(16)
window.haroSim = {
  get brain() { return brain; },
  get det() { return det; },
  get yawDeg() { return yawDeg; },
  mem, bot, camera, controls, setSpeed, setXray, setSeated, wardrobe,
  get outfits() { return outfits; },
  bodyGLB,
  wear: (id) => wearOutfit(outfits.find((o) => o.id === id)),
  pet: (src = "devtools") => { pendingPet = src; },
  talk: () => { pendingHeard = true; },
};
