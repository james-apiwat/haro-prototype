# Third-party components

## microduck (Pollen Robotics), Apache License 2.0

https://github.com/pollen-robotics/microduck

- `sounds/*.wav` were rendered with the `sounds` crate from microduck
  (`sounds render-all --seed 7`), 4 variants each of greet, inquire, chirp, coo, peck and alarm.
- The idle behaviour in `haro.py` (`IdleLook`: glance, hold, small gaze shifts, occasional tilt,
  calming down over time, yawning) is adapted from `robotd/src/idle_head.rs`.
- The state list (nap, look around, startle, petted, greeting that warms with familiarity) is
  inspired by `docs/ideas/autonomous_behavior.md`.
- Audio petting in `pet_audio.py` (40-band log-mel over a 1 s window at 16 kHz, one feature function
  shared by training and runtime, enter/exit hysteresis, ignoring the robot's own sounds) follows
  `pet-detect/`. It is a new Python implementation with its own features and classifier.

Full licence text: `third_party/LICENSE-microduck.txt`

## YuNet face detector (Shiqi Yu), MIT License

https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet

- `models/face_detection_yunet.onnx` is `face_detection_yunet_2026may.onnx` from OpenCV Zoo.

Full licence text: `third_party/LICENSE-yunet.txt`

## three.js (three.js authors), MIT License

https://github.com/mrdoob/three.js

- `sim/vendor/three.module.js`, `three.core.js`, `OrbitControls.js`, `RoomEnvironment.js`,
  `loaders/GLTFLoader.js` and `utils/BufferGeometryUtils.js` are unmodified files from the `three` npm package,
  version 0.187.0. They render the 3D simulator in `sim/` and load `.glb` outfit models.
- `sim/vendor/utils/SkeletonUtils.js` is not the three.js file. It is a one-function stand-in written for this
  project so that `GLTFLoader.js` can import `clone()`; it only handles models without skeletons.

Full licence text: `third_party/LICENSE-three.txt`
