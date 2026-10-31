// ชุดของ Haro: อ่านไฟล์ชุด (outfits/<ชื่อชุด>/outfit.json) แล้วเปลี่ยนสี ลาย และของแต่งบนตัวหุ่น
// รูปแบบไฟล์อธิบายไว้ใน outfits/README.md  กฎที่นี่ต้องตรงกับ outfits/check_outfits.py

import * as THREE from "three";

export const FORMAT = "haro-outfit/1";
export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const FILE_RE = /^[A-Za-z0-9_\-./]+$/;
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const MODEL_RE = /\.glb$/i;
const D2R = Math.PI / 180;

const TOP_KEYS = ["format", "name", "author", "description", "credits", "body", "screen", "hide", "parts"];
export const BODY_SLOTS = ["shell", "wings", "leaves", "base", "ring", "bezel"];
const LOOK_KEYS = ["color", "texture", "repeat", "roughness", "metalness", "glow", "glowStrength"];
const HIDEABLE = ["wings", "leaves", "ring"];
const SCREEN_KEYS = { background: "screen", eye: "eye", highlight: "white", blush: "blush" };
export const ANCHORS = ["head", "face", "body", "back", "left", "right", "base"];
const MIRROR_AT = { left: "right", right: "left" };
const PART_KEYS = ["name", "at", "shape", "size", "model", "pos", "rot", "scale", "mirror", "opacity", ...LOOK_KEYS];
const MAX_PARTS = 64;

// รูปทรงพื้นฐาน size หน่วยเป็น ซม. ยกเว้นตัวที่บอกว่าเป็นองศา  ช่องที่ไม่ใส่ใช้ค่าตั้งต้น
const SHAPES = {
  box: { def: [1, 1, 1], make: ([w, h, d]) => new THREE.BoxGeometry(w, h, d) },
  sphere: { def: [1, 180], deg: [1], make: ([r, cover]) =>
    new THREE.SphereGeometry(r, 40, 24, 0, Math.PI * 2, 0, cover * D2R) },          // cover 90 = ครึ่งลูกด้านบน
  cylinder: { def: [1, 1, 1], make: ([rt, rb, h]) => new THREE.CylinderGeometry(rt, rb, h, 40) },
  cone: { def: [1, 2], make: ([r, h]) => new THREE.ConeGeometry(r, h, 40) },
  torus: { def: [1, 0.2, 360], deg: [2], make: ([R, t, arc]) => new THREE.TorusGeometry(R, t, 16, 64, arc * D2R) },
  capsule: { def: [0.5, 1], make: ([r, len]) => new THREE.CapsuleGeometry(r, len, 8, 20) },
};

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

function unknownKeys(obj, allowed, where, warn) {
  for (const k of Object.keys(obj)) {
    if (allowed.includes(k)) continue;
    const near = allowed.find((a) => editDistance(a.toLowerCase(), k.toLowerCase()) <= 2);
    warn(`${where}: ไม่รู้จัก "${k}"${near ? ` หมายถึง "${near}" ไหม` : ""}`);
  }
}

const partName = (p, i) => `ของแต่งชิ้นที่ ${i + 1}${isObj(p) && typeof p.name === "string" ? ` (${p.name})` : ""}`;

function vec3(v, def, where, warn, { uniform = false, min = -Infinity, max = Infinity } = {}) {
  if (v === undefined) return def;
  if (uniform && isNum(v)) return [v, v, v].map((x) => clamp(x, min, max));
  if (Array.isArray(v) && v.length === 3 && v.every(isNum)) return v.map((x) => clamp(x, min, max));
  warn(`${where} ต้องเป็น [x, y, z]${uniform ? " หรือตัวเลขเดียว" : ""}`);
  return def;
}

function unit(v, fallback, where, warn) {
  if (isNum(v) && v >= 0 && v <= 1) return v;
  warn(`${where} ต้องเป็นตัวเลข 0 ถึง 1`);
  return isNum(v) ? clamp(v, 0, 1) : fallback;
}

function sizeOf(shapeName, size, where, warn) {
  const shape = SHAPES[shapeName];
  let s = size === undefined ? [] : isNum(size) ? [size] : Array.isArray(size) ? size : null;
  if (!s) {
    warn(`${where}: size ต้องเป็นตัวเลขหรือ [ ... ]`);
    s = [];
  }
  if (shapeName === "cylinder" && s.length === 2) s = [s[0], s[0], s[1]];     // [รัศมี, สูง]
  return shape.def.map((d, i) => {
    let v = s[i];
    if (v === undefined) v = shapeName === "cylinder" && i === 1 && isNum(s[0]) ? s[0] : d;
    if (!isNum(v)) {
      warn(`${where}: size ช่องที่ ${i + 1} ต้องเป็นตัวเลข`);
      v = d;
    }
    return shape.deg && shape.deg.includes(i) ? clamp(v, 1, 360) : clamp(v, 0.01, 40);
  });
}

function isSolid(mesh) {
  const ms = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return ms.some((m) => !(m.transparent && m.opacity <= 0.5));     // ใสเกินครึ่ง กล้องมองทะลุได้
}

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`โหลดไม่ได้ (HTTP ${r.status})`);
  return JSON.parse(await r.text());
}

const textureLoader = new THREE.TextureLoader();
let gltfLoader = null;

export class Wardrobe {
  // anchors: จุดยึดของแต่ง (Object3D)  slots: วัสดุของแต่ละส่วนบนตัวหุ่น  hideable: mesh ที่ซ่อนได้  faceColors: สีบนจอ
  constructor({ anchors, slots, hideable, faceColors }) {
    this.anchors = anchors;
    this.slots = slots;
    this.hideable = hideable;
    this.faceColors = faceColors;
    this.faceDefaults = { ...faceColors };
    this.defaults = {};
    for (const [k, m] of Object.entries(slots)) {
      this.defaults[k] = { color: m.color.getHex(), roughness: m.roughness, metalness: m.metalness,
        emissive: m.emissive.getHex(), emissiveIntensity: m.emissiveIntensity };
    }
    this.objects = [];         // ของแต่งที่ใส่อยู่
    this.solid = [];           // mesh ทึบ ใช้ดูว่าบังกล้องหรือจอไหม
    this.textures = [];        // ลายบนตัวหุ่น
    this.urls = [];            // blob URL ของชุดที่ลองจากเครื่อง
    this.current = null;
    this.visible = true;
    this.gen = 0;
    this.raycaster = new THREE.Raycaster();
  }

  defaultHex(slot) {
    return "#" + this.defaults[slot].color.toString(16).padStart(6, "0");
  }

  // รายชื่อชุดใน outfits/: อ่านจาก index.json รวมกับรายการไฟล์ของ http.server (ใส่โฟลเดอร์ใหม่แล้วเห็นเลย)
  async list() {
    const ids = new Set();
    const idx = await getJSON("outfits/index.json").catch(() => null);
    if (idx && Array.isArray(idx.outfits)) idx.outfits.forEach((id) => ids.add(String(id)));
    try {
      const r = await fetch("outfits/", { cache: "no-store" });
      if (r.ok && (r.headers.get("content-type") || "").includes("html")) {
        for (const m of (await r.text()).matchAll(/href="([^"?#/]+)\/"/g)) ids.add(decodeURIComponent(m[1]));
      }
    } catch { /* เว็บเซิร์ฟเวอร์ไม่แสดงรายการไฟล์ ใช้ index.json อย่างเดียว */ }
    const items = await Promise.all([...ids].filter((id) => !/^[._]/.test(id)).map(async (id) => {
      if (!ID_RE.test(id)) return { id, source: "repo", error: "ชื่อโฟลเดอร์ต้องเป็น a-z ตัวเล็ก 0-9 - _ เท่านั้น" };
      try {
        return { id, source: "repo", def: await getJSON(`outfits/${id}/outfit.json`) };
      } catch (e) {
        return { id, source: "repo", error: e.message };
      }
    }));
    const key = (it) => (it.id === "classic" ? "" : (it.def && it.def.name) || it.id);
    return items.sort((a, b) => key(a).localeCompare(key(b), "th"));
  }

  // ลองชุดจากโฟลเดอร์ในเครื่อง ยังไม่ต้องอยู่ใน git  entries = [{ file, path }]
  async fromFiles(entries) {
    const list = entries.map((e) => ({ file: e.file, path: e.path.replace(/\\/g, "/").replace(/^\/+/, "") }));
    const json = list.filter((e) => /(^|\/)outfit\.json$/i.test(e.path)).sort((a, b) => a.path.length - b.path.length)[0];
    if (!json) throw new Error("ไม่เจอไฟล์ outfit.json");
    const dir = json.path.slice(0, -"outfit.json".length);
    const files = new Map(list.filter((e) => e.path.startsWith(dir)).map((e) => [e.path.slice(dir.length), e.file]));
    const folder = dir.split("/").filter(Boolean).pop() || "outfit";
    const item = { id: `local:${folder}`, source: "local", folder, files };
    try {
      item.def = JSON.parse(await json.file.text());
    } catch (e) {
      item.error = e.message;
    }
    return item;
  }

  // ใส่ชุด คืน { warnings } หรือ null ถ้ามีการเลือกชุดอื่นต่อระหว่างโหลด
  async apply(item) {
    const gen = ++this.gen;
    const warnings = [];
    const warn = (m) => { if (warnings.length < 40) warnings.push(m); };
    const def = isObj(item.def) ? item.def : {};
    const stamp = Date.now();
    const urls = [];
    const url = (name) => {
      if (item.source === "local") {
        const f = item.files.get(name);
        if (!f) return null;
        const u = URL.createObjectURL(f);
        urls.push(u);
        return u;
      }
      return `outfits/${item.id}/${name.split("/").map(encodeURIComponent).join("/")}?v=${stamp}`;
    };

    if (def.format !== FORMAT) warn(`format ต้องเป็น "${FORMAT}"`);
    if (typeof def.name !== "string" || !def.name.trim()) warn("ต้องมี name (ชื่อชุด)");
    unknownKeys(def, TOP_KEYS, "outfit.json", warn);
    if (def.body !== undefined && !isObj(def.body)) warn("body ต้องเป็น { ... }");
    if (def.parts !== undefined && !Array.isArray(def.parts)) warn("parts ต้องเป็นรายการ [ ... ]");
    const body = isObj(def.body) ? def.body : {};
    const parts = Array.isArray(def.parts) ? def.parts.slice(0, MAX_PARTS) : [];
    if (Array.isArray(def.parts) && def.parts.length > MAX_PARTS) warn(`ของแต่งใส่ได้ไม่เกิน ${MAX_PARTS} ชิ้น ส่วนที่เกินไม่แสดง`);

    // 1) โหลดรูปและโมเดลให้ครบก่อน แล้วค่อยเปลี่ยนทีเดียว ตัวหุ่นจะได้ไม่กะพริบ
    const tex = new Map();
    const models = new Map();
    const jobs = [];
    const wantTexture = (spec, where) => {
      if (spec.texture !== undefined) jobs.push(this._texture(spec, url, where, warn).then((t) => t && tex.set(spec, t)));
    };
    for (const k of BODY_SLOTS) if (isObj(body[k])) wantTexture(body[k], `body.${k}`);
    parts.forEach((p, i) => {
      if (!isObj(p)) return;
      if (p.model !== undefined) jobs.push(this._model(p, url, partName(p, i), warn).then((m) => m && models.set(p, m)));
      else wantTexture(p, partName(p, i));
    });
    await Promise.all(jobs);
    if (gen !== this.gen) {
      tex.forEach((t) => t.dispose());
      urls.forEach((u) => URL.revokeObjectURL(u));
      return null;
    }

    // 2) ถอดชุดเดิม
    this._clear();
    this.urls = urls;

    // 3) สีและลายของตัวหุ่น
    for (const [k, v] of Object.entries(body)) {
      if (!BODY_SLOTS.includes(k)) {
        warn(`body: ไม่มีส่วน "${k}" (ใช้ได้: ${BODY_SLOTS.join(", ")})`);
        continue;
      }
      if (!isObj(v)) {
        warn(`body.${k} ต้องเป็น { ... }`);
        continue;
      }
      unknownKeys(v, LOOK_KEYS, `body.${k}`, warn);
      const t = tex.get(v);
      if (t) this.textures.push(t);
      this._look(this.slots[k], v, t, `body.${k}`, warn);
    }

    // 4) ซ่อนบางส่วน
    if (def.hide !== undefined && !Array.isArray(def.hide)) warn("hide ต้องเป็นรายการ เช่น [\"leaves\"]");
    for (const k of Array.isArray(def.hide) ? def.hide : []) {
      if (HIDEABLE.includes(k)) this.hideable[k].forEach((m) => { m.visible = false; });
      else warn(`hide: ซ่อน "${k}" ไม่ได้ (ซ่อนได้: ${HIDEABLE.join(", ")})`);
    }

    // 5) สีหน้าบนจอ
    if (def.screen !== undefined) {
      if (!isObj(def.screen)) warn("screen ต้องเป็น { ... }");
      else {
        unknownKeys(def.screen, Object.keys(SCREEN_KEYS), "screen", warn);
        for (const [k, c] of Object.entries(SCREEN_KEYS)) {
          const v = def.screen[k];
          if (v === undefined) continue;
          if (typeof v === "string" && HEX_RE.test(v)) this.faceColors[c] = v;
          else warn(`screen.${k} ต้องเป็นรหัสสีแบบ "#ff8800"`);
        }
      }
    }

    // 6) ของแต่ง
    parts.forEach((p, i) => this._part(p, i, tex, models, warn));
    tex.forEach((t) => { if (!this.textures.includes(t)) this.textures.push(t); });

    this.current = item;
    this.setVisible(this.visible);
    for (const o of this.objects) o.updateWorldMatrix(true, true);   // ให้ coverage() ใช้ตำแหน่งจริงได้ทันที ไม่ต้องรอเฟรมถัดไป
    return { warnings };
  }

  setVisible(on) {
    this.visible = on;
    for (const o of this.objects) o.visible = on;
  }

  // ชุดบังกล้องกี่ % และบังจอกี่ % (ยิงเส้นตรงออกจากกล้องและจอ ดูว่าชนของแต่งไหม)
  // screen = { parent, center: [x,y,z], radius, toward: [x,y,z] } พิกัดในกรอบของ parent
  coverage(cam, screen) {
    const out = { camera: 0, screen: 0 };
    if (!this.solid.length) return out;
    const o = new THREE.Vector3(), p = new THREE.Vector3(), d = new THREE.Vector3();
    cam.updateMatrixWorld();
    cam.getWorldPosition(o);
    let hit = 0, n = 0;
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 12; j++, n++) {
        p.set(((i + 0.5) / 16) * 2 - 1, ((j + 0.5) / 12) * 2 - 1, 0.5).unproject(cam);
        if (this._hit(o, d.subVectors(p, o).normalize(), 300)) hit++;
      }
    }
    out.camera = hit / n;
    hit = 0;
    n = 0;
    d.set(...screen.toward).transformDirection(screen.parent.matrixWorld);
    for (const rr of [0, 0.3, 0.6, 0.9]) {
      const k = rr ? 12 : 1;
      for (let a = 0; a < k; a++, n++) {
        const t = (a / k) * Math.PI * 2;
        o.set(screen.center[0] + Math.cos(t) * rr * screen.radius, screen.center[1] + Math.sin(t) * rr * screen.radius,
          screen.center[2]);
        screen.parent.localToWorld(o);
        if (this._hit(o, d, 60)) hit++;
      }
    }
    out.screen = hit / n;
    return out;
  }

  // ระหว่างจุด from กับ to มีของแต่งขวางไหม (ใช้ตอนหาหน้าเจ้าของ)
  blocks(from, to) {
    if (!this.solid.length) return false;
    const d = new THREE.Vector3().subVectors(to, from);
    const len = d.length();
    return len > 0 && this._hit(from, d.divideScalar(len), len);
  }

  _hit(origin, dir, far) {
    this.raycaster.set(origin, dir);
    this.raycaster.far = far;
    return this.raycaster.intersectObjects(this.solid, false).length > 0;
  }

  _file(name, re, kind, where, warn) {
    if (typeof name !== "string" || !FILE_RE.test(name) || name.startsWith("/") || name.split("/").includes("..")) {
      warn(`${where}: ชื่อไฟล์ "${name}" ใช้ไม่ได้ ใช้ตัวอังกฤษ ตัวเลข - _ . และต้องอยู่ในโฟลเดอร์ชุด`);
      return null;
    }
    if (!re.test(name)) {
      warn(`${where}: ${name} ต้องเป็นไฟล์${kind}`);
      return null;
    }
    return name;
  }

  async _texture(spec, url, where, warn) {
    const name = this._file(spec.texture, IMAGE_RE, "รูป .png .jpg .webp", where, warn);
    if (!name) return null;
    const u = url(name);
    if (!u) {
      warn(`${where}: ไม่เจอไฟล์ ${name}`);
      return null;
    }
    try {
      const t = await textureLoader.loadAsync(u);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
      const rep = spec.repeat;
      if (rep !== undefined) {
        if (Array.isArray(rep) && rep.length === 2 && rep.every((x) => isNum(x) && x > 0)) t.repeat.set(rep[0], rep[1]);
        else warn(`${where}: repeat ต้องเป็น [รอบแนวนอน, รอบแนวตั้ง] เช่น [4, 2]`);
      }
      const { width = 0, height = 0 } = t.image || {};
      if (Math.max(width, height) > 2048) warn(`${where}: ${name} ใหญ่ ${width}×${height} px ไม่ควรเกิน 2048 px`);
      return t;
    } catch {
      warn(`${where}: โหลด ${name} ไม่ได้`);
      return null;
    }
  }

  async _model(p, url, where, warn) {
    const name = this._file(p.model, MODEL_RE, "โมเดล .glb", where, warn);
    if (!name) return null;
    const u = url(name);
    if (!u) {
      warn(`${where}: ไม่เจอไฟล์ ${name}`);
      return null;
    }
    if (!gltfLoader) {
      try {
        const { GLTFLoader } = await import("./vendor/loaders/GLTFLoader.js");
        gltfLoader = new GLTFLoader();
      } catch {
        warn(`${where}: เปิดไฟล์ .glb ไม่ได้ (ไม่เจอ sim/vendor/loaders/GLTFLoader.js)`);
        return null;
      }
    }
    try {
      return (await gltfLoader.loadAsync(u)).scene;
    } catch (e) {
      warn(`${where}: เปิด ${name} ไม่ได้ (${e.message || e})`);
      return null;
    }
  }

  // สี ลาย ความเงา ใช้ทั้งกับส่วนของตัวหุ่นและของแต่ง
  _look(mat, spec, texture, where, warn) {
    if (spec.color !== undefined) {
      if (typeof spec.color === "string" && HEX_RE.test(spec.color)) mat.color.set(spec.color);
      else warn(`${where}.color ต้องเป็นรหัสสีแบบ "#ff8800"`);
    } else if (texture) {
      mat.color.set(0xffffff);                      // มีลายแต่ไม่ใส่สี = แสดงสีของรูปตามจริง
    }
    if (texture) mat.map = texture;
    if (spec.roughness !== undefined) mat.roughness = unit(spec.roughness, mat.roughness, `${where}.roughness`, warn);
    if (spec.metalness !== undefined) mat.metalness = unit(spec.metalness, mat.metalness, `${where}.metalness`, warn);
    if (spec.glow !== undefined) {
      if (typeof spec.glow === "string" && HEX_RE.test(spec.glow)) {
        mat.emissive.set(spec.glow);
        mat.emissiveIntensity = 0.6;
      } else {
        warn(`${where}.glow ต้องเป็นรหัสสีแบบ "#ff8800"`);
      }
    }
    if (spec.glowStrength !== undefined) {
      if (!isNum(spec.glowStrength) || spec.glowStrength < 0 || spec.glowStrength > 3) {
        warn(`${where}.glowStrength ต้องเป็นตัวเลข 0 ถึง 3`);
      }
      if (isNum(spec.glowStrength)) mat.emissiveIntensity = clamp(spec.glowStrength, 0, 3);
    }
    mat.needsUpdate = true;
  }

  _part(p, i, tex, models, warn) {
    const where = partName(p, i);
    if (!isObj(p)) {
      warn(`${where} ต้องเป็น { ... }`);
      return;
    }
    unknownKeys(p, PART_KEYS, where, warn);
    const at = p.at === undefined ? "body" : p.at;
    if (!ANCHORS.includes(at)) {
      warn(`${where}: ไม่มีจุดยึด "${at}" (ใช้ได้: ${ANCHORS.join(", ")})`);
      return;
    }
    let make;
    if (p.model !== undefined) {
      const scene = models.get(p);
      if (!scene) return;
      if (LOOK_KEYS.some((k) => p[k] !== undefined) || p.opacity !== undefined) {
        warn(`${where}: โมเดล .glb ใช้สีและลายจากในไฟล์ ไม่ใช้ color texture opacity`);
      }
      make = (mirror) => (mirror ? scene.clone(true) : scene);
    } else {
      if (!SHAPES[p.shape]) {
        warn(`${where}: ต้องมี shape (${Object.keys(SHAPES).join(", ")}) หรือ model (.glb)`);
        return;
      }
      const geo = SHAPES[p.shape].make(sizeOf(p.shape, p.size, where, warn));
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
      this._look(mat, p, tex.get(p), where, warn);
      if (p.opacity !== undefined) {
        const op = unit(p.opacity, 1, `${where}.opacity`, warn);
        if (op < 1) Object.assign(mat, { transparent: true, opacity: op, depthWrite: op > 0.5 });
      }
      make = () => new THREE.Mesh(geo, mat);
    }
    const pos = vec3(p.pos, [0, 0, 0], `${where}: pos`, warn, { min: -60, max: 60 });
    const rot = vec3(p.rot, [0, 0, 0], `${where}: rot`, warn);
    const scale = vec3(p.scale, [1, 1, 1], `${where}: scale`, warn, { uniform: true, min: 0.01, max: 100 });
    if (p.mirror !== undefined && typeof p.mirror !== "boolean") warn(`${where}: mirror ต้องเป็น true หรือ false`);

    // mirror: กลับซ้ายขวาข้ามแกนกลางตัว (x = 0)
    const place = (mirror) => {
      const o = make(mirror);
      o.position.set(mirror ? -pos[0] : pos[0], pos[1], pos[2]);
      o.rotation.set(rot[0] * D2R, (mirror ? -rot[1] : rot[1]) * D2R, (mirror ? -rot[2] : rot[2]) * D2R);
      o.scale.set(scale[0] * (mirror && p.model !== undefined ? -1 : 1), scale[1], scale[2]);
      o.traverse((m) => {
        if (!m.isMesh) return;
        m.castShadow = m.receiveShadow = true;
        if (isSolid(m)) this.solid.push(m);
      });
      this.anchors[mirror ? MIRROR_AT[at] || at : at].add(o);
      this.objects.push(o);
    };
    place(false);
    if (p.mirror === true) place(true);
  }

  _clear() {
    const geos = new Set(), mats = new Set(), texs = new Set(this.textures);
    for (const o of this.objects) {
      o.removeFromParent();
      o.traverse((m) => {
        if (!m.isMesh) return;
        geos.add(m.geometry);
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          mats.add(mat);
          for (const v of Object.values(mat)) if (v && v.isTexture) texs.add(v);
        }
      });
    }
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    texs.forEach((t) => t.dispose());
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.objects = [];
    this.solid = [];
    this.textures = [];
    this.urls = [];
    for (const [k, m] of Object.entries(this.slots)) {
      const d = this.defaults[k];
      m.color.setHex(d.color);
      m.roughness = d.roughness;
      m.metalness = d.metalness;
      m.emissive.setHex(d.emissive);
      m.emissiveIntensity = d.emissiveIntensity;
      m.map = null;
      m.needsUpdate = true;
    }
    for (const k of HIDEABLE) this.hideable[k].forEach((m) => { m.visible = true; });
    Object.assign(this.faceColors, this.faceDefaults);
  }
}

// แม่แบบสำหรับวาดลายเปลือก: ภาพนี้ห่อรอบเปลือกแบบเดียวกับที่ simulator ใช้จริง (LatheGeometry)
// ด้านบนของภาพ = หัว ขอบซ้ายและขวาต่อกันตรงกลางหลัง กลางภาพ = ด้านหน้า
// g = { SH, STEPS, CROWN_Y, SIDE_X, SCREEN_Y, BEZEL_R, LENS_Y, WING }
export function drawSkinTemplate(canvas, g) {
  const W = (canvas.width = 1024), H = (canvas.height = 512);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(W, H);
  const { SH, WING } = g;
  const span = Math.PI / 2 - SH.phi0;
  const rows = g.STEPS + 1;                       // uv.y = j / rows  (j = 0 คือจุดกลางก้น)
  const pal = {
    plain: [244, 241, 234], bottom: [86, 90, 92], screen: [38, 44, 46], lens: [214, 72, 72],
    wing: [214, 204, 186], crown: [150, 224, 230], side: [198, 236, 240],
  };
  const wc = Math.cos(WING.rz), ws = Math.sin(WING.rz);
  for (let py = 0; py < H; py++) {
    const j = (1 - (py + 0.5) / H) * rows;
    let y, r;
    if (j < 1) {
      y = 0;
      r = SH.R * Math.cos(SH.phi0) * j;
    } else {
      const phi = SH.phi0 + (span * (j - 1)) / g.STEPS;
      y = SH.yc + (phi < 0 ? SH.Rb : SH.Rt) * Math.sin(phi);
      r = SH.R * Math.cos(phi);
    }
    for (let px = 0; px < W; px++) {
      const th = ((px + 0.5) / W - 0.5) * Math.PI * 2;
      const x = r * Math.sin(th), z = r * Math.cos(th);
      const sx = Math.sign(x) || 1;
      const dx = x - sx * WING.x, dy = y - WING.y, dz = z - WING.z;
      const lx = dx * wc + sx * dy * ws, ly = -sx * dx * ws + dy * wc;    // หมุนกลับตามมุมเอียงของปีก
      let c = pal.plain;
      if (j < 1) c = pal.bottom;
      else if (z > 0 && Math.hypot(x, y - g.SCREEN_Y) < g.BEZEL_R) c = pal.screen;
      else if (z > 0 && Math.hypot(x, y - g.LENS_Y) < 0.5) c = pal.lens;
      else if ((lx / WING.s[0]) ** 2 + (ly / WING.s[1]) ** 2 + (dz / WING.s[2]) ** 2 < 1) c = pal.wing;
      else if (y > g.CROWN_Y) c = pal.crown;
      else if (Math.abs(x) > g.SIDE_X) c = pal.side;
      const k = (py * W + px) * 4;
      img.data[k] = c[0];
      img.data[k + 1] = c[1];
      img.data[k + 2] = c[2];
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // ตำแหน่งในภาพของความสูง y และมุมรอบตัว (0 = หน้า, + = ไปทางซ้ายของ Haro)
  const pyOf = (y) => {
    const phi = Math.asin(clamp((y - SH.yc) / (y < SH.yc ? SH.Rb : SH.Rt), -1, 1));
    return (1 - (1 + ((phi - SH.phi0) / span) * g.STEPS) / rows) * H;
  };
  const pxOf = (deg) => (0.5 + deg / 360) * W;

  ctx.strokeStyle = "rgba(40,60,64,.28)";
  ctx.lineWidth = 1;
  for (let deg = -180; deg <= 180; deg += 30) {
    ctx.beginPath();
    ctx.moveTo(pxOf(deg), 0);
    ctx.lineTo(pxOf(deg), H);
    ctx.stroke();
  }
  ctx.font = "13px 'Leelawadee UI', sans-serif";
  ctx.fillStyle = "rgba(40,60,64,.75)";
  ctx.textBaseline = "middle";
  for (let y = 1; y <= 6; y++) {
    const py = pyOf(y);
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(W, py);
    ctx.stroke();
    ctx.fillText(`สูง ${y} ซม.`, 6, py - 9);
  }

  ctx.textAlign = "center";
  ctx.font = "bold 18px 'Leelawadee UI', sans-serif";
  ctx.fillStyle = "#24393c";
  const lowY = pyOf(1.5);
  ctx.fillText("หน้า", pxOf(0), pyOf(0.4));
  ctx.fillText("ซ้ายของ Haro", pxOf(90), lowY);
  ctx.fillText("ขวาของ Haro", pxOf(-90), lowY);
  ctx.fillText("หลัง", pxOf(-180) + 40, lowY);
  ctx.fillText("หลัง", pxOf(180) - 40, lowY);
  ctx.fillText("ฟอยล์บนหัว (จุดลูบ)", pxOf(0), pyOf(6.1));
  ctx.font = "bold 15px 'Leelawadee UI', sans-serif";
  ctx.fillText("ฟอยล์ข้าง", pxOf(60), pyOf(3.6));
  ctx.fillText("ฟอยล์ข้าง", pxOf(-60), pyOf(3.6));
  ctx.fillText("ปีก", pxOf(90), pyOf(WING.y));
  ctx.fillText("ปีก", pxOf(-90), pyOf(WING.y));
  ctx.fillStyle = "#e9f2f2";
  ctx.fillText("จอ (ลายตรงนี้ไม่โผล่)", pxOf(0), pyOf(g.SCREEN_Y));
  ctx.fillStyle = "#8a2020";
  ctx.fillText("กล้อง", pxOf(0) + 52, pyOf(g.LENS_Y));
  ctx.font = "13px 'Leelawadee UI', sans-serif";
  ctx.fillStyle = "rgba(36,57,60,.85)";
  ctx.textAlign = "left";
  [
    "แม่แบบลายเปลือก Haro 1024 × 512",
    "ด้านบนของภาพ = หัว · ขอบซ้ายและขวาต่อกันที่กลางหลัง",
    "แถบเทาล่างสุดอยู่ใต้ตัว มองไม่เห็น",
  ].forEach((t, i) => ctx.fillText(t, pxOf(-170), pyOf(4.3) + i * 18));
}
