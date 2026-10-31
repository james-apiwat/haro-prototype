"""ตรวจไฟล์ชุดของ Haro ทุกชุดใน sim/outfits/ แล้วเขียน index.json ใหม่

รันก่อน commit:  python sim/outfits/check_outfits.py
ผ่าน = exit 0  มีข้อผิดพลาด = exit 1
ข้อความที่พิมพ์เป็นภาษาอังกฤษ เพราะหน้าต่าง cmd แสดงภาษาไทยเพี้ยน
กฎต้องตรงกับ sim/outfit.js ใช้แค่ไลบรารีมาตรฐานของ Python
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FORMAT = "haro-outfit/1"
ID_RE = re.compile(r"[a-z0-9][a-z0-9_-]{0,39}")
HEX_RE = re.compile(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})")
FILE_RE = re.compile(r"[A-Za-z0-9_\-./]+")
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp")
MODEL_EXT = (".glb",)
MAX_FILE_MB = 5          # ไฟล์ใหญ่กว่านี้ไม่รับ (ทุกคนต้อง clone)
WARN_FILE_MB = 2
MAX_PARTS = 64

TOP_KEYS = {"format", "name", "author", "description", "credits", "body", "screen", "hide", "parts"}
BODY_SLOTS = {"shell", "wings", "leaves", "base", "ring", "bezel"}
LOOK_KEYS = {"color", "texture", "repeat", "roughness", "metalness", "glow", "glowStrength"}
HIDEABLE = {"wings", "leaves", "ring"}
SCREEN_KEYS = {"background", "eye", "highlight", "blush"}
ANCHORS = {"head", "face", "body", "back", "left", "right", "base"}
SHAPES = {"box", "sphere", "cylinder", "cone", "torus", "capsule"}
PART_KEYS = {"name", "at", "shape", "size", "model", "pos", "rot", "scale", "mirror", "opacity"} | LOOK_KEYS


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def is_vec3(v):
    return isinstance(v, list) and len(v) == 3 and all(is_num(x) for x in v)


class Check:
    def __init__(self, folder):
        self.folder = folder
        self.errors = []
        self.warnings = []
        self.used = set()

    def file(self, name, exts, where):
        if (not isinstance(name, str) or not FILE_RE.fullmatch(name) or name.startswith("/")
                or ".." in name.split("/")):
            self.errors.append(f"{where}: bad file name {name!r} (use A-Z a-z 0-9 - _ . inside the outfit folder)")
            return
        if not name.lower().endswith(exts):
            self.errors.append(f"{where}: {name} must be one of {' '.join(exts)}")
            return
        path = self.folder / name
        if not path.is_file():
            self.errors.append(f"{where}: file not found: {name}")
            return
        # Windows ไม่สนตัวเล็กตัวใหญ่ แต่ GitHub, Mac และ Linux สน ชื่อต้องตรงทุกตัวอักษร
        real = {p.relative_to(self.folder).as_posix() for p in self.folder.rglob("*")}
        if name not in real:
            match = next((r for r in real if r.lower() == name.lower()), name)
            self.errors.append(f"{where}: {name} must match the real file name {match} exactly (upper/lower case)")
        self.used.add(path.resolve())

    def color(self, v, where):
        if not isinstance(v, str) or not HEX_RE.fullmatch(v):
            self.errors.append(f"{where}: colour must look like \"#ff8800\", got {v!r}")

    def look(self, spec, where):
        for k in ("color", "glow"):
            if k in spec:
                self.color(spec[k], f"{where}.{k}")
        for k in ("roughness", "metalness"):
            if k in spec and not (is_num(spec[k]) and 0 <= spec[k] <= 1):
                self.errors.append(f"{where}.{k}: must be a number 0 to 1")
        if "glowStrength" in spec and not (is_num(spec["glowStrength"]) and 0 <= spec["glowStrength"] <= 3):
            self.errors.append(f"{where}.glowStrength: must be a number 0 to 3")
        if "texture" in spec:
            self.file(spec["texture"], IMAGE_EXT, f"{where}.texture")
        if "repeat" in spec:
            r = spec["repeat"]
            if not (isinstance(r, list) and len(r) == 2 and all(is_num(x) and x > 0 for x in r)):
                self.errors.append(f"{where}.repeat: must be [across, down], e.g. [4, 2]")

    def unknown(self, obj, allowed, where):
        for k in sorted(set(obj) - allowed):
            self.warnings.append(f"{where}: unknown key {k!r}")

    def part(self, p, i):
        where = f"parts[{i}]" + (f" ({p['name']})" if isinstance(p, dict) and isinstance(p.get("name"), str) else "")
        if not isinstance(p, dict):
            self.errors.append(f"{where}: must be an object {{ ... }}")
            return
        self.unknown(p, PART_KEYS, where)
        if p.get("at", "body") not in ANCHORS:
            self.errors.append(f"{where}.at: {p.get('at')!r} is not one of {', '.join(sorted(ANCHORS))}")
        if "model" in p:
            if "shape" in p:
                self.errors.append(f"{where}: use either shape or model, not both")
            self.file(p["model"], MODEL_EXT, f"{where}.model")
            if any(k in p for k in LOOK_KEYS | {"opacity"}):
                self.warnings.append(f"{where}: .glb models keep their own colours, colour/texture keys are ignored")
        else:
            if p.get("shape") not in SHAPES:
                self.errors.append(f"{where}.shape: {p.get('shape')!r} is not one of {', '.join(sorted(SHAPES))}")
            s = p.get("size")
            if s is not None and not (is_num(s) or (isinstance(s, list) and 1 <= len(s) <= 3
                                                   and all(is_num(x) for x in s))):
                self.errors.append(f"{where}.size: must be a number or a list of up to 3 numbers")
            if "opacity" in p and not (is_num(p["opacity"]) and 0 <= p["opacity"] <= 1):
                self.errors.append(f"{where}.opacity: must be a number 0 to 1")
            self.look(p, where)
        for k in ("pos", "rot"):
            if k in p and not is_vec3(p[k]):
                self.errors.append(f"{where}.{k}: must be [x, y, z]")
        if "scale" in p and not (is_num(p["scale"]) or is_vec3(p["scale"])):
            self.errors.append(f"{where}.scale: must be a number or [x, y, z]")
        if "mirror" in p and not isinstance(p["mirror"], bool):
            self.errors.append(f"{where}.mirror: must be true or false")

    def run(self):
        if not ID_RE.fullmatch(self.folder.name):
            self.errors.append("folder name must be lowercase a-z 0-9 - _ (max 40 characters)")
        path = self.folder / "outfit.json"
        if not path.is_file():
            self.errors.append("missing outfit.json")
            return
        try:
            d = json.loads(path.read_text(encoding="utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            self.errors.append(f"outfit.json is not valid JSON: {e}")
            return
        if not isinstance(d, dict):
            self.errors.append("outfit.json must be an object { ... }")
            return
        if d.get("format") != FORMAT:
            self.errors.append(f"format must be \"{FORMAT}\"")
        if not isinstance(d.get("name"), str) or not d["name"].strip():
            self.errors.append("missing name")
        self.unknown(d, TOP_KEYS, "outfit.json")

        body = d.get("body", {})
        if not isinstance(body, dict):
            self.errors.append("body must be an object { ... }")
            body = {}
        for k, v in body.items():
            if k not in BODY_SLOTS:
                self.errors.append(f"body.{k}: no such part (use {', '.join(sorted(BODY_SLOTS))})")
            elif not isinstance(v, dict):
                self.errors.append(f"body.{k}: must be an object {{ ... }}")
            else:
                self.unknown(v, LOOK_KEYS, f"body.{k}")
                self.look(v, f"body.{k}")

        screen = d.get("screen", {})
        if not isinstance(screen, dict):
            self.errors.append("screen must be an object { ... }")
            screen = {}
        self.unknown(screen, SCREEN_KEYS, "screen")
        for k in SCREEN_KEYS & set(screen):
            self.color(screen[k], f"screen.{k}")

        hide = d.get("hide", [])
        if not isinstance(hide, list):
            self.errors.append("hide must be a list, e.g. [\"leaves\"]")
            hide = []
        for k in hide:
            if k not in HIDEABLE:
                self.errors.append(f"hide: cannot hide {k!r} (only {', '.join(sorted(HIDEABLE))})")

        parts = d.get("parts", [])
        if not isinstance(parts, list):
            self.errors.append("parts must be a list [ ... ]")
            parts = []
        if len(parts) > MAX_PARTS:
            self.errors.append(f"too many parts: {len(parts)} (max {MAX_PARTS})")
        for i, p in enumerate(parts):
            self.part(p, i)

        for f in sorted(self.folder.rglob("*")):
            if not f.is_file():
                continue
            mb = f.stat().st_size / 1024 / 1024
            rel = f.relative_to(self.folder).as_posix()
            if mb > MAX_FILE_MB:
                self.errors.append(f"{rel} is {mb:.1f} MB (max {MAX_FILE_MB} MB)")
            elif mb > WARN_FILE_MB:
                self.warnings.append(f"{rel} is {mb:.1f} MB, try to keep files under {WARN_FILE_MB} MB")
            if f.name not in ("outfit.json", "README.md") and f.resolve() not in self.used:
                self.warnings.append(f"{rel} is not used by outfit.json")


def main():
    sys.stdout.reconfigure(errors="replace")
    ok, bad = [], 0
    for folder in sorted(p for p in HERE.iterdir() if p.is_dir() and not p.name.startswith((".", "_"))):
        c = Check(folder)
        c.run()
        status = "FAIL" if c.errors else "WARN" if c.warnings else "OK"
        print(f"{status:4}  {folder.name}")
        for m in c.errors:
            print(f"      error: {m}")
        for m in c.warnings:
            print(f"      warning: {m}")
        if c.errors:
            bad += 1
        else:
            ok.append(folder.name)

    ok.sort(key=lambda n: (n != "classic", n))
    index = {"format": "haro-outfit-index/1", "outfits": ok}
    (HERE / "index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"\n{len(ok)} outfit(s) ok, {bad} with errors. Wrote index.json")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
