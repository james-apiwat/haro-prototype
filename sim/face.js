// วาดหน้า Haro บนจอกลม GC9A01 แปลงมาจาก Face.draw() ใน haro.py
// วาดบน canvas 480x480 (จอจริง 240x240 ขยาย 2 เท่า) ตัวเลขทุกตัวตรงกับ pygame

export const COLORS = {
  screen: "rgb(24,34,36)",
  eye: "rgb(143,227,234)",
  white: "rgb(240,250,250)",
  blush: "rgb(226,120,150)",
};

function arc(ctx, cx, cy, rx, ry, a0, a1, r) {
  // เส้นโค้งหนาแบบขอบมน
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = a0 + (a1 - a0) * i / 40;
    const x = cx + rx * Math.cos(a), y = cy - ry * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = COLORS.eye;
  ctx.lineWidth = r * 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function eye(ctx, cx, cy, kind, blink, side) {
  const w = 92, h = 124;
  if (["normal", "sleepy", "sad", "surprised"].includes(kind)) {
    const s = kind === "surprised" ? 1.15 : 1.0;
    const ew = w * s, eh = Math.max(10, h * s * (1 - blink));
    ctx.fillStyle = COLORS.eye;
    roundRect(ctx, cx - ew / 2, cy - eh / 2, ew, eh, Math.min(ew, eh) / 2);
    if (eh > 36 && kind !== "sad") {
      ctx.fillStyle = COLORS.white;
      ctx.beginPath();
      ctx.arc(cx - ew * 0.18, cy - eh * 0.22, ew * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
    const top = cy - eh / 2;
    ctx.fillStyle = COLORS.screen;
    if (kind === "sleepy") {
      ctx.fillRect(cx - ew / 2 - 3, top - 3, ew + 6, eh * 0.5 + 3);
    } else if (kind === "sad") {
      const outer = cx + side * ew / 2;
      ctx.beginPath();
      ctx.moveTo(cx - ew / 2 - 4, top - 4);
      ctx.lineTo(cx + ew / 2 + 4, top - 4);
      ctx.lineTo(outer + side * 4, top + eh * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = COLORS.white;
      ctx.beginPath();
      ctx.arc(cx - side * ew * 0.1, cy + eh * 0.05, ew * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "happy") {                 // ตาปิดยิ้ม ^ ^
    arc(ctx, cx, cy + 16, w * 0.42, h * 0.3, 0, Math.PI, 9);
  } else if (kind === "sleep") {                 // ตาปิดหลับ
    arc(ctx, cx, cy - 10, w * 0.42, h * 0.2, Math.PI, 2 * Math.PI, 6);
  }
}

// pose มาจาก Brain.update(), now = วินาที (ใช้กับ zzz)
export function drawFace(ctx, pose, now) {
  const S = 480, c = S / 2;
  ctx.save();
  ctx.fillStyle = COLORS.screen;
  ctx.fillRect(0, 0, S, S);

  // จอจริงมีแกนหมุนตัวแค่แกนเดียว การเอียงคอ (roll) จึงหมุนภาพบนจอแทน
  ctx.translate(c + pose.x * 14, c);
  ctx.rotate((pose.roll * Math.PI) / 180);
  ctx.translate(-c, -c);

  const ex = c + pose.x * 48;
  const ey = c - 14 + pose.y * 34 + pose.bounce;
  const expr = pose.expr;
  const left = expr === "wink" ? "normal" : expr;
  const right = expr === "wink" ? "happy" : expr;
  eye(ctx, ex - 96, ey, left, pose.blink, -1);
  eye(ctx, ex + 96, ey, right, pose.blink, 1);

  if (pose.blush) {
    ctx.fillStyle = COLORS.blush;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(ex + sx * 118, ey + 81, 28, 11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (pose.mouth > 0.05) {
    const m = pose.mouth;
    ctx.strokeStyle = COLORS.eye;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(ex, ey + 112, (30 + 16 * m) / 2 - 3, (8 + 44 * m) / 2 - 3, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (pose.zzz) {
    ctx.fillStyle = COLORS.eye;
    ctx.font = "bold 30px sans-serif";
    ctx.textBaseline = "top";
    for (let i = 0; i < 3; i++) {
      const p = (now * 0.4 + i / 3) % 1;
      ctx.globalAlpha = 1 - p;
      ctx.fillText("z", c + 90 + i * 18 + p * 20, c - 70 - p * 90);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
