// ไม่ใช่ไฟล์ของ three.js: ตัวแทนแบบสั้นของ three/addons/utils/SkeletonUtils.js
// GLTFLoader.js ใช้ clone() ตอนไฟล์ .glb เดียวมีหลาย scene ที่ใช้ node ร่วมกันเท่านั้น
// ของแต่งของ Haro ไม่มีกระดูก (skinned mesh) จึงใช้ clone ธรรมดาของ three.js ได้
// ถ้าวันหนึ่งต้องใช้โมเดลที่มีกระดูกและหลาย scene ให้เอาไฟล์จริงจาก npm three@0.187.0 มาแทน

export function clone(source) {
  return source.clone(true);
}
