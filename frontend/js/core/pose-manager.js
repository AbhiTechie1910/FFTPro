import {
  PoseLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

import { debug } from "../utils/debug.js";

export class PoseManager {
  constructor(options = {}) {
    this.modelUrl =
      options.modelUrl ||
      "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

    this.minPoseDetectionConfidence = options.minPoseDetectionConfidence ?? 0.5;
    this.minPosePresenceConfidence = options.minPosePresenceConfidence ?? 0.5;
    this.minTrackingConfidence = options.minTrackingConfidence ?? 0.5;
    this.numPoses = options.numPoses ?? 1;
    this.smoothAlpha = options.smoothAlpha ?? 0.78;

    this.landmarker = null;
    this.lastVideoTime = -1;
    this.smoothed = null;
    this.lastDetectionAt = 0;
    this.delegate = "GPU";
    this.initialized = false;
  }

  async init() {
    if (this.initialized && this.landmarker) {
      return { ok: true, message: "PoseManager already initialized." };
    }

    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );

      try {
        this.landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: this.modelUrl,
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: this.numPoses,
          minPoseDetectionConfidence: this.minPoseDetectionConfidence,
          minPosePresenceConfidence: this.minPosePresenceConfidence,
          minTrackingConfidence: this.minTrackingConfidence,
        });

        this.delegate = "GPU";
      } catch (gpuError) {
        debug.warn("GPU delegate failed, switching to CPU:", gpuError);

        this.landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: this.modelUrl,
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numPoses: this.numPoses,
          minPoseDetectionConfidence: this.minPoseDetectionConfidence,
          minPosePresenceConfidence: this.minPosePresenceConfidence,
          minTrackingConfidence: this.minTrackingConfidence,
        });

        this.delegate = "CPU";
      }

      this.initialized = true;

      return {
        ok: true,
        message: `PoseManager initialized (${this.delegate})`,
        delegate: this.delegate,
      };
    } catch (error) {
      debug.error("PoseManager init failed:", error);
      return {
        ok: false,
        message: error.message || "Failed to initialize pose manager.",
      };
    }
  }

  smoothLandmarks(landmarks) {
    if (!landmarks || landmarks.length !== 33) return landmarks;

    if (!this.smoothed) {
      this.smoothed = landmarks.map((point) => ({ ...point }));
      return this.smoothed;
    }

    const alpha = this.smoothAlpha;

    for (let i = 0; i < 33; i += 1) {
      const point = landmarks[i];
      const prev = this.smoothed[i];

      if (!point || !prev) continue;

      const dynamicAlpha = (point.visibility ?? 1) < 0.2 ? 0.42 : alpha;

      prev.x = dynamicAlpha * prev.x + (1 - dynamicAlpha) * point.x;
      prev.y = dynamicAlpha * prev.y + (1 - dynamicAlpha) * point.y;
      prev.z =
        point.z != null
          ? dynamicAlpha * (prev.z ?? point.z) + (1 - dynamicAlpha) * point.z
          : prev.z ?? 0;
      prev.visibility = point.visibility ?? prev.visibility ?? 1;
    }

    return this.smoothed;
  }

  detect(videoEl) {
    if (!this.landmarker || !videoEl) {
      return {
        ok: false,
        message: "PoseManager not ready or video missing.",
        landmarks: null,
      };
    }

    if (videoEl.readyState < 2) {
      return {
        ok: false,
        message: "Video not ready.",
        landmarks: null,
      };
    }

    const now = performance.now();

    try {
      const result = this.landmarker.detectForVideo(videoEl, now);
      const raw = result?.landmarks?.[0] ?? null;

      this.lastDetectionAt = now;

      if (!raw || raw.length !== 33) {
        return {
          ok: true,
          message: "No pose detected.",
          landmarks: null,
          rawLandmarks: null,
          timestamp: now,
        };
      }

      const smoothed = this.smoothLandmarks(raw);

      return {
        ok: true,
        message: "Pose detected.",
        landmarks: smoothed,
        rawLandmarks: raw,
        timestamp: now,
      };
    } catch (error) {
      debug.error("Pose detection failed:", error);

      return {
        ok: false,
        message: error.message || "Pose detection failed.",
        landmarks: null,
        rawLandmarks: null,
        timestamp: now,
      };
    }
  }

  resetSmoothing() {
    this.smoothed = null;
  }

  getLastDetectionAt() {
    return this.lastDetectionAt;
  }

  destroy() {
    try {
      this.landmarker?.close?.();
    } catch (error) {
      debug.warn("PoseManager close warning:", error);
    }

    this.landmarker = null;
    this.smoothed = null;
    this.lastVideoTime = -1;
    this.lastDetectionAt = 0;
    this.initialized = false;
  }
}