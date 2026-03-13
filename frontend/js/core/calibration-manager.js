import { avg } from "../utils/math.js";
import {
  POSE_INDEX,
  getPoint,
  getVisibility,
  hasCorePose,
} from "../utils/landmarks.js";

export class CalibrationManager {
  constructor(options = {}) {
    this.visibilityThreshold = options.visibilityThreshold ?? 0.25;
    this.minBodySpan = options.minBodySpan ?? 0.45;
    this.maxBodySpan = options.maxBodySpan ?? 0.92;
  }

  getDistanceStatus(landmarks) {
    if (!landmarks?.length) return "NO_POSE";

    const leftShoulder = getPoint(landmarks, POSE_INDEX.L_SHOULDER);
    const rightShoulder = getPoint(landmarks, POSE_INDEX.R_SHOULDER);
    const leftAnkle = getPoint(landmarks, POSE_INDEX.L_ANKLE);
    const rightAnkle = getPoint(landmarks, POSE_INDEX.R_ANKLE);

    if (!leftShoulder || !rightShoulder || !leftAnkle || !rightAnkle) {
      return "NO_POSE";
    }

    const shoulderY = avg(leftShoulder.y, rightShoulder.y);
    const ankleY = avg(leftAnkle.y, rightAnkle.y);
    const bodySpan = Math.abs(ankleY - shoulderY);

    if (bodySpan < this.minBodySpan) return "TOO_FAR";
    if (bodySpan > this.maxBodySpan) return "TOO_CLOSE";
    return "OK";
  }

  getVisibilityStatus(landmarks) {
    if (!landmarks?.length) return "NO_POSE";
    return hasCorePose(landmarks, this.visibilityThreshold) ? "OK" : "LOW";
  }

  getLightingStatus() {
    return "OK";
  }

  evaluateReadiness(landmarks) {
    const visibility = this.getVisibilityStatus(landmarks);
    const distance = this.getDistanceStatus(landmarks);
    const lighting = this.getLightingStatus();

    const ready = visibility === "OK" && distance === "OK" && lighting === "OK";

    return {
      ready,
      visibility,
      distance,
      lighting,
      message: ready
        ? "Ready"
        : visibility !== "OK"
        ? "Show full body clearly"
        : distance !== "OK"
        ? distance === "TOO_FAR"
          ? "Step closer"
          : "Step back"
        : "Adjust setup",
    };
  }
}