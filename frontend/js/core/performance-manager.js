import { APP_CONFIG } from "../app/constants.js";
import { debug } from "../utils/debug.js";

export class PerformanceManager {
  constructor() {
    this.frameTimestamps = [];
    this.currentMode = "normal";
    this.lastRecommendation = null;
  }

  markFrame() {
    const now = performance.now();
    this.frameTimestamps.push(now);

    const cutoff = now - 2000;
    while (this.frameTimestamps.length && this.frameTimestamps[0] < cutoff) {
      this.frameTimestamps.shift();
    }
  }

  getApproxFps() {
    if (this.frameTimestamps.length < 2) return 0;

    const durationMs =
      this.frameTimestamps[this.frameTimestamps.length - 1] - this.frameTimestamps[0];

    if (durationMs <= 0) return 0;

    return (this.frameTimestamps.length / durationMs) * 1000;
  }

  evaluate() {
    const fps = this.getApproxFps();

    let nextMode = "normal";
    if (fps > 0 && fps < 10) nextMode = "critical";
    else if (fps < 18) nextMode = "reduced";

    this.currentMode = nextMode;

    this.lastRecommendation = {
      fps: Number(fps.toFixed(1)),
      mode: nextMode,
      downgradeCamera: nextMode === "critical",
      reduceOverlay: nextMode === "critical" || nextMode === "reduced",
      throttleUi: nextMode !== "normal",
    };

    return this.lastRecommendation;
  }

  shouldRunDetection(lastDetectionAt, targetFps = 20) {
    const minGapMs = 1000 / targetFps;
    return performance.now() - lastDetectionAt >= minGapMs;
  }

  getMode() {
    return this.currentMode;
  }

  logStatus() {
    const info = this.evaluate();
    debug.log("Performance:", info);
    return info;
  }

  reset() {
    this.frameTimestamps = [];
    this.currentMode = "normal";
    this.lastRecommendation = null;
  }
}