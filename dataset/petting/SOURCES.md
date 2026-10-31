# ที่มาของเสียงในชุดข้อมูลการลูบ

ชุดข้อมูลตอนนี้ **ยังไม่ใช่เสียงลูบตัวหุ่นจริง** ใช้เพื่อให้ Haro ฟังการลูบได้ก่อนที่ตัวหุ่นจะพร้อม

- เสียงจาก [Freesound](https://freesound.org) ทั้งหมดเป็น **CC0** (สาธารณสมบัติ ใช้ได้โดยไม่ต้องให้เครดิต แต่บันทึกที่มาไว้ให้ตรวจสอบได้) ได้ตรวจ license จากหน้าเสียงแต่ละหน้าแล้ว และใช้ไฟล์ preview คุณภาพสูง (mp3)
- `harosounds*` คือเสียงของ Haro เองจาก `sounds/` ทุกชุด ใส่ไว้ในกลุ่ม `normal` เพื่อไม่ให้ Haro คิดว่าเสียงตัวเองคือการลูบ
- แต่ละเสียงต้นฉบับมี 3 ไฟล์ `__clean` (ปรับระดับเสียงแล้ว ตัดไม่เกิน 40 วินาที) และ `__aug1`, `__aug2` คือเสียงที่จำลองว่าเปิดผ่านลำโพงเล็กเข้าไมค์โน้ตบุ๊ก (สุ่มความดัง ตัดเสียงทุ้มและแหลม ใส่เสียงก้องสั้นๆ และเสียงห้อง) `pet_audio.py train` นับไฟล์ที่ชื่อเหมือนกันก่อน `__` เป็นต้นฉบับเดียวกัน จึงไม่ถูกแยกไปอยู่ทั้งชุดเทรนและชุดทดสอบ
- 4 เสียงที่ไม่ได้ใช้เทรนเลยอยู่ใน `test_sounds/` ไว้เปิดทดสอบ

**เมื่อตัวหุ่นพร้อม** อัดเสียงลูบจริงด้วย `python pet_audio.py record` แล้วลบไฟล์ `web*` ออก (หรือเก็บเสียง `normal` จากเว็บไว้เป็นตัวอย่างเสียงอื่นก็ได้) แล้วเทรนใหม่

| ประเภท | เสียง | ผู้อัด | อยู่ที่ |
|---|---|---|---|
| stroke | [Hair Petting](https://freesound.org/people/nyxlitten/sounds/824379/) | nyxlitten | dataset/petting/stroke/web824379__*.wav |
| stroke | [Petting Long, Coarse Fur.wav](https://freesound.org/people/Kawgrim/sounds/584865/) | Kawgrim | test_sounds/stroke_fur.wav |
| stroke | [bunny head petted](https://freesound.org/people/lucyve/sounds/205575/) | lucyve | dataset/petting/stroke/web205575__*.wav |
| stroke | [Brushing cat - MS RAW](https://freesound.org/people/Sadiquecat/sounds/807199/) | Sadiquecat | dataset/petting/stroke/web807199__*.wav |
| stroke | [Fabric petting - slow](https://freesound.org/people/conk0018/sounds/713009/) | conk0018 | dataset/petting/stroke/web713009__*.wav |
| stroke | [Fabric touched by hand](https://freesound.org/people/Sadiquecat/sounds/716374/) | Sadiquecat | dataset/petting/stroke/web716374__*.wav |
| stroke | [Contact mic against fabric](https://freesound.org/people/jacksongoode/sounds/488519/) | jacksongoode | dataset/petting/stroke/web488519__*.wav |
| stroke | [Friction with a Contact Mic.wav](https://freesound.org/people/TheSupremeMuffinPooter/sounds/525267/) | TheSupremeMuffinPooter | dataset/petting/stroke/web525267__*.wav |
| stroke | [Slow friction on fabric with a contact mic.wav](https://freesound.org/people/TheSupremeMuffinPooter/sounds/525275/) | TheSupremeMuffinPooter | dataset/petting/stroke/web525275__*.wav |
| scratch | [Petting-scratching a cat](https://freesound.org/people/Sadiquecat/sounds/695629/) | Sadiquecat | dataset/petting/scratch/web695629__*.wav |
| scratch | [Scratching blanket](https://freesound.org/people/PanFlutist/sounds/724908/) | PanFlutist | test_sounds/scratch_blanket.wav |
| scratch | [Scratching Couch](https://freesound.org/people/HogantheLogan/sounds/466790/) | HogantheLogan | dataset/petting/scratch/web466790__*.wav |
| scratch | [sofa scratch_long.wav](https://freesound.org/people/bsumusictech/sounds/62472/) | bsumusictech | dataset/petting/scratch/web62472__*.wav |
| scratch | [sofa scratch_short.wav](https://freesound.org/people/bsumusictech/sounds/62473/) | bsumusictech | dataset/petting/scratch/web62473__*.wav |
| normal | [Typing on a keyboard](https://freesound.org/people/SamsterBirdies/sounds/489424/) | SamsterBirdies | dataset/petting/normal/web489424__*.wav |
| normal | [Keyboard typing.](https://freesound.org/people/InAlisVictoriae/sounds/837349/) | InAlisVictoriae | dataset/petting/normal/web837349__*.wav |
| normal | [Keyboard Typing](https://freesound.org/people/bwarpus99/sounds/442689/) | bwarpus99 | dataset/petting/normal/web442689__*.wav |
| normal | [Typing on a Keyboard](https://freesound.org/people/Ultra-Edward/sounds/788026/) | Ultra-Edward | test_sounds/normal_typing.wav |
| normal | [Typing on a iMac keyboard](https://freesound.org/people/Guran89/sounds/459370/) | Guran89 | dataset/petting/normal/web459370__*.wav |
| normal | [Room Full Of Talking People.mp3](https://freesound.org/people/Yin_Yang_Jake007/sounds/411888/) | Yin_Yang_Jake007 | dataset/petting/normal/web411888__*.wav |
| normal | [SFX-Party,PeopleTalking,English](https://freesound.org/people/soundandmelodies/sounds/776193/) | soundandmelodies | dataset/petting/normal/web776193__*.wav |
| normal | [talking people 3.mp3](https://freesound.org/people/szalonegacie/sounds/467475/) | szalonegacie | test_sounds/normal_talking.wav |
| normal | [House Room Tone](https://freesound.org/people/aleclubin/sounds/641306/) | aleclubin | dataset/petting/normal/web641306__*.wav |
| normal | [Soft Room Tone](https://freesound.org/people/callmethefoo/sounds/744447/) | callmethefoo | dataset/petting/normal/web744447__*.wav |
| normal | [Paper Rustling 2](https://freesound.org/people/Macif/sounds/367506/) | Macif | dataset/petting/normal/web367506__*.wav |
