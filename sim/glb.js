// เขียนไฟล์ .glb (glTF 2.0 แบบไฟล์เดียว) จาก geometry ของ three.js
// ใช้ทำไฟล์ตัว Haro ไว้ปั้นของแต่งใน Blender  ไม่ต้องใช้ไฟล์อื่นของ three.js และรันใน Node ได้
// ตำแหน่งจุดยอดถูกแปลงด้วย matrix ของแต่ละชิ้นก่อนเขียน (bake) ทุกชิ้นจึงมีจุดกำเนิดร่วมกัน

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;

// meshes:  [{ name, geometry, matrix?, color: [r, g, b] (linear), opacity?, roughness?, metalness?, doubleSided?, uv? }]
// empties: [{ name, position: [x, y, z] }]  จุดที่ไม่มีรูปทรง (ใน Blender เป็น Empty) ใช้บอกจุดยึด
export function writeGLB({ meshes, empties = [], generator = "Haro Simulator" }) {
  const chunks = [];
  let offset = 0;
  const gltf = {
    asset: { version: "2.0", generator },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [],
    buffers: [{ byteLength: 0 }],
  };

  const view = (typed, target) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (bytes.byteLength % 4)) % 4;
    chunks.push(bytes, new Uint8Array(pad));
    gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    offset += bytes.byteLength + pad;
    return gltf.bufferViews.length - 1;
  };
  const accessor = (typed, type, componentType, target, extra = {}) => {
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
    gltf.accessors.push({ bufferView: view(typed, target), componentType, count: typed.length / size, type, ...extra });
    return gltf.accessors.length - 1;
  };

  for (const m of meshes) {
    const g = m.geometry.index ? m.geometry.clone() : m.geometry.clone().setIndex([...Array(m.geometry.attributes.position.count).keys()]);
    if (m.matrix) g.applyMatrix4(m.matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = Float32Array.from(g.attributes.position.array);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i++) {
      min[i % 3] = Math.min(min[i % 3], pos[i]);
      max[i % 3] = Math.max(max[i % 3], pos[i]);
    }
    const attributes = {
      POSITION: accessor(pos, "VEC3", FLOAT, ARRAY_BUFFER, { min, max }),
      NORMAL: accessor(Float32Array.from(g.attributes.normal.array), "VEC3", FLOAT, ARRAY_BUFFER),
    };
    if (m.uv && g.attributes.uv) {
      const uv = Float32Array.from(g.attributes.uv.array);
      for (let i = 1; i < uv.length; i += 2) uv[i] = 1 - uv[i];        // glTF นับ v จากขอบบนของรูป
      attributes.TEXCOORD_0 = accessor(uv, "VEC2", FLOAT, ARRAY_BUFFER);
    }
    const count = g.attributes.position.count;
    const idx = count > 65535 ? Uint32Array.from(g.index.array) : Uint16Array.from(g.index.array);
    const indices = accessor(idx, "SCALAR", count > 65535 ? UNSIGNED_INT : UNSIGNED_SHORT, ELEMENT_ARRAY_BUFFER);

    const opacity = m.opacity ?? 1;
    gltf.materials.push({
      name: m.name,
      pbrMetallicRoughness: {
        baseColorFactor: [...m.color, opacity],
        metallicFactor: m.metalness ?? 0,
        roughnessFactor: m.roughness ?? 0.5,
      },
      ...(opacity < 1 ? { alphaMode: "BLEND" } : {}),
      ...(m.doubleSided ? { doubleSided: true } : {}),
    });
    gltf.meshes.push({ name: m.name, primitives: [{ attributes, indices, material: gltf.materials.length - 1 }] });
    gltf.nodes.push({ name: m.name, mesh: gltf.meshes.length - 1 });
    gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
    g.dispose();
  }
  for (const e of empties) {
    gltf.nodes.push({ name: e.name, translation: e.position });
    gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
  }
  gltf.buffers[0].byteLength = offset;

  // ไฟล์ .glb = หัวไฟล์ 12 ไบต์ + ก้อน JSON + ก้อนข้อมูล (ทุกก้อนยาวหาร 4 ลงตัว)
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (json.byteLength % 4)) % 4;
  const total = 12 + 8 + json.byteLength + jsonPad + 8 + offset;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);                // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, json.byteLength + jsonPad, true);
  dv.setUint32(16, 0x4e4f534a, true);               // "JSON"
  out.set(json, 20);
  out.fill(0x20, 20 + json.byteLength, 20 + json.byteLength + jsonPad);
  let p = 20 + json.byteLength + jsonPad;
  dv.setUint32(p, offset, true);
  dv.setUint32(p + 4, 0x004e4942, true);            // "BIN"
  p += 8;
  for (const c of chunks) {
    out.set(c, p);
    p += c.byteLength;
  }
  return out.buffer;
}
