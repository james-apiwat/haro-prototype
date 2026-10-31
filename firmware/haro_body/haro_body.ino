/*
  Haro body firmware (ESP32-S3)

  รับคำสั่งจาก haro.py บนคอมผ่านสาย USB แล้ว
    - ขยับคอด้วยเซอร์โว 2 ตัว (หันซ้ายขวา + เอียงคอ)
    - วาดตาบนจอกลม GC9A01 240x240
    - ส่ง "T" กลับไปเมื่อมีคนแตะ touch sensor

  คำสั่งที่รับ (ทีละบรรทัด, 115200 baud)
    H <pan> <roll>   มุมหัวเป็นองศา  pan -35..35  roll -20..20
    E <expr>         normal, happy, sleepy, sleep, sad, surprised, wink
    ?                ตอบกลับ "HARO" (ใช้เช็กว่าต่อถูกพอร์ต)
  คำสั่งที่ส่ง
    T                มีคนแตะ (ลูบหัว)

  วิธีต่อสาย แฟลช และทดสอบ ดู firmware/README.md
  ทดสอบเองได้ด้วย Serial Monitor (115200, line ending = Newline) เช่นพิมพ์ E happy หรือ H 20 0

  ต้องติดตั้ง library (Arduino IDE > Library Manager)
    - GFX Library for Arduino (Arduino_GFX) โดย moononournation
    - ESP32Servo โดย Kevin Harrington

  ตั้งค่าบอร์ด (Arduino IDE > Tools)
    - Board: ESP32S3 Dev Module (หรือรุ่นที่ตรงกับบอร์ด)
    - PSRAM: OPI PSRAM (ถ้าบอร์ดเป็น N16R8 / N8R8)
    - ถ้าเสียบสายที่พอร์ต USB ของชิปโดยตรง (ไม่ใช่พอร์ต UART) ให้เปิด USB CDC On Boot: Enabled
*/

#include <Arduino_GFX_Library.h>
#include <ESP32Servo.h>

// ============================================================
// ขา (ต้องเช็กกับ pinout ของบอร์ดจริงก่อน!)
// บอร์ด ESP32-S3 ที่มีกล้องใช้ขาไปกับกล้องเยอะ ห้ามใช้ขาที่กล้องใช้
// และห้ามใช้ขา 35, 36, 37 ถ้าบอร์ดมี PSRAM แบบ OPI
// ============================================================
#define TFT_SCK    47
#define TFT_MOSI   21
#define TFT_CS     14
#define TFT_DC     41
#define TFT_RST    42
#define TFT_BL     -1     // ขาไฟจอ ถ้าต่อเข้า 3.3V ตรงให้ใส่ -1

#define PIN_PAN    1      // เซอร์โวหันซ้ายขวา
#define PIN_ROLL   2      // เซอร์โวเอียงคอ
#define PIN_TOUCH  40     // TTP223 (ขา SIG)

// ============================================================
// ปรับเซอร์โว
// ============================================================
const int PAN_CENTER  = 90;   // มุมที่หัวมองตรง
const int ROLL_CENTER = 90;   // มุมที่หัวตั้งตรง
const int PAN_DIR     = 1;    // ถ้าหันกลับด้าน ให้เปลี่ยนเป็น -1
const int ROLL_DIR    = 1;
const int PAN_LIMIT   = 40;   // หันได้ไม่เกินกี่องศาจากตรงกลาง (กันชนตัวหุ่น)
const int ROLL_LIMIT  = 25;
const float MAX_STEP  = 2.5;  // องศาต่อ 20 ms ยิ่งน้อยยิ่งนุ่มและเงียบ

// ============================================================
// สี (เหมือนบนคอม)
// ============================================================
#define RGB565(r, g, b) ((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3))
const uint16_t C_BG    = RGB565(24, 34, 36);
const uint16_t C_EYE   = RGB565(143, 227, 234);
const uint16_t C_WHITE = RGB565(240, 250, 250);
const uint16_t C_BLUSH = RGB565(226, 120, 150);

// ============================================================
Arduino_DataBus *bus = new Arduino_ESP32SPI(TFT_DC, TFT_CS, TFT_SCK, TFT_MOSI, GFX_NOT_DEFINED);
Arduino_GFX *panel = new Arduino_GC9A01(bus, TFT_RST, 0, true);
Arduino_Canvas *gfx = new Arduino_Canvas(240, 240, panel);   // วาดในหน่วยความจำก่อน จอจะไม่กะพริบ

Servo panServo, rollServo;

float panTarget = 0, rollTarget = 0;   // องศาจากตรงกลาง ที่คอมสั่ง
float panNow = 0, rollNow = 0;         // องศาตอนนี้ (ค่อยๆ ขยับไปหาเป้า)
String expr = "normal";

unsigned long nextServo = 0, nextFrame = 0, nextBlink = 0, blinkStart = 0;
bool lastTouch = false;
unsigned long touchChanged = 0;
String line;

// ---------------------------------------------------------- serial
void handleLine(String s) {
  s.trim();
  if (s.length() == 0) return;
  char cmd = s.charAt(0);
  if (cmd == 'H') {
    float p = 0, r = 0;
    if (sscanf(s.c_str() + 1, "%f %f", &p, &r) == 2) {
      panTarget = constrain(p, -PAN_LIMIT, PAN_LIMIT);
      rollTarget = constrain(r, -ROLL_LIMIT, ROLL_LIMIT);
    }
  } else if (cmd == 'E') {
    String e = s.substring(1);
    e.trim();
    if (e.length()) expr = e;
  } else if (cmd == '?') {
    Serial.println("HARO");
  }
}

void readSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      handleLine(line);
      line = "";
    } else if (c != '\r' && line.length() < 64) {
      line += c;
    }
  }
}

// ---------------------------------------------------------- servo
float stepToward(float now, float target) {
  float d = target - now;
  if (d > MAX_STEP) d = MAX_STEP;
  if (d < -MAX_STEP) d = -MAX_STEP;
  return now + d;
}

void updateServos() {
  panNow = stepToward(panNow, panTarget);
  rollNow = stepToward(rollNow, rollTarget);
  panServo.write(PAN_CENTER + PAN_DIR * (int)lroundf(panNow));
  rollServo.write(ROLL_CENTER + ROLL_DIR * (int)lroundf(rollNow));
}

// ---------------------------------------------------------- touch
void checkTouch() {
  bool t = digitalRead(PIN_TOUCH) == HIGH;
  if (t != lastTouch && millis() - touchChanged > 80) {   // กันสัญญาณกระตุก
    touchChanged = millis();
    lastTouch = t;
    if (t) Serial.println("T");
  }
}

// ---------------------------------------------------------- face
void arcDots(int cx, int cy, int rx, int ry, float a0, float a1, int r) {
  for (int i = 0; i <= 24; i++) {
    float a = a0 + (a1 - a0) * i / 24.0;
    gfx->fillCircle(cx + rx * cos(a), cy - ry * sin(a), r, C_EYE);
  }
}

void drawEye(int cx, int cy, const String &kind, float blink, int side) {
  const int w = 46, h = 62;
  if (kind == "happy") {                       // ตาปิดยิ้ม
    arcDots(cx, cy + 8, 19, 19, 0, PI, 5);
    return;
  }
  if (kind == "sleep") {                       // ตาปิดหลับ
    arcDots(cx, cy - 5, 19, 12, PI, 2 * PI, 3);
    return;
  }
  float s = (kind == "surprised") ? 1.15 : 1.0;
  int ew = w * s;
  int eh = max(5, (int)(h * s * (1 - blink)));
  int top = cy - eh / 2;
  gfx->fillRoundRect(cx - ew / 2, top, ew, eh, min(ew, eh) / 2, C_EYE);
  if (kind == "sleepy") {
    gfx->fillRect(cx - ew / 2 - 2, top - 2, ew + 4, eh / 2 + 2, C_BG);
  } else if (kind == "sad") {
    int outer = cx + side * ew / 2;
    gfx->fillTriangle(cx - ew / 2 - 2, top - 2, cx + ew / 2 + 2, top - 2,
                      outer + side * 2, top + eh * 0.45, C_BG);
    gfx->fillCircle(cx - side * ew * 0.1, cy + eh * 0.05, ew * 0.11, C_WHITE);
  } else if (eh > 18) {
    gfx->fillCircle(cx - ew * 0.18, cy - eh * 0.22, ew * 0.13, C_WHITE);
  }
}

void drawFace() {
  unsigned long ms = millis();

  // กะพริบตาเองทุก 2.5 ถึง 6 วินาที
  if (ms >= nextBlink) {
    blinkStart = ms;
    nextBlink = ms + random(2500, 6000);
  }
  float blink = 0;
  unsigned long bt = ms - blinkStart;
  if (bt < 160 && (expr == "normal" || expr == "surprised" || expr == "sad" || expr == "sleepy")) {
    float x = bt / 160.0;
    blink = 1 - fabs(2 * x - 1);
  }

  float breath = sin(ms / 1000.0 * 2 * PI / (expr == "sleep" ? 5.0 : 3.5)) * 1.5;
  int ex = 120 + (int)(panNow / 35.0 * 20);   // ตามองไปทางเดียวกับที่หัวหัน
  int ey = 113 + (int)breath;

  gfx->fillScreen(C_BG);
  String left = (expr == "wink") ? "normal" : expr;
  String right = (expr == "wink") ? "happy" : expr;
  drawEye(ex - 48, ey, left, blink, -1);
  drawEye(ex + 48, ey, right, blink, 1);

  if (expr == "happy") {
    gfx->fillEllipse(ex - 59, ey + 40, 14, 5, C_BLUSH);
    gfx->fillEllipse(ex + 59, ey + 40, 14, 5, C_BLUSH);
  }
  if (expr == "sleep") {                       // z z z
    gfx->setTextColor(C_EYE);
    for (int i = 0; i < 3; i++) {
      float p = fmod(ms / 2500.0 + i / 3.0, 1.0);
      gfx->setTextSize(2);
      gfx->setCursor(165 + i * 9 + p * 10, 80 - p * 45);
      gfx->print("z");
    }
  }
  gfx->flush();
}

// ---------------------------------------------------------- setup / loop
void setup() {
  Serial.begin(115200);

  if (TFT_BL >= 0) {
    pinMode(TFT_BL, OUTPUT);
    digitalWrite(TFT_BL, HIGH);
  }
  if (!gfx->begin()) {
    Serial.println("display init failed");
  }

  pinMode(PIN_TOUCH, INPUT);

  panServo.setPeriodHertz(50);
  rollServo.setPeriodHertz(50);
  panServo.attach(PIN_PAN, 500, 2400);
  rollServo.attach(PIN_ROLL, 500, 2400);
  updateServos();

  randomSeed(esp_random());
  Serial.println("HARO READY");
}

void loop() {
  readSerial();
  checkTouch();
  unsigned long ms = millis();
  if (ms >= nextServo) {
    nextServo = ms + 20;
    updateServos();
  }
  if (ms >= nextFrame) {
    nextFrame = ms + 33;          // ประมาณ 30 ภาพต่อวินาที
    drawFace();
  }
}
