import { APP_CONFIG } from "../app/constants.js";
import { debug } from "../utils/debug.js";
import { errorManager } from "./error-manager.js";

export class CameraManager {
  constructor(videoEl) {
    if (!videoEl) {
      throw new Error("CameraManager requires a valid video element.");
    }

    this.videoEl = videoEl;
    this.stream = null;
    this.isRunning = false;
    this.currentConstraints = this.buildConstraints(
      APP_CONFIG.CAMERA.DEFAULT_WIDTH,
      APP_CONFIG.CAMERA.DEFAULT_HEIGHT
    );
  }

  buildConstraints(width, height) {
    return {
      audio: false,
      video: {
        width: { ideal: width },
        height: { ideal: height },
        facingMode: APP_CONFIG.CAMERA.FACING_MODE,
      },
    };
  }

  async start(customConstraints = null) {
    if (this.isRunning && this.stream) {
      debug.warn("Camera already running.");
      return { ok: true, message: "Camera already running." };
    }

    const constraints = customConstraints || this.currentConstraints;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoEl.srcObject = this.stream;

      await this.videoEl.play();

      this.isRunning = true;
      this.currentConstraints = constraints;

      debug.log("Camera started:", constraints);

      return {
        ok: true,
        message: "Camera started successfully.",
      };
    } catch (error) {
      debug.error("Camera start failed:", error);

      let code = "CAMERA_START_FAILED";

      if (error.name === "NotAllowedError") code = "CAMERA_PERMISSION_DENIED";
      if (error.name === "NotFoundError") code = "CAMERA_NOT_FOUND";

      return {
        ok: false,
        code,
        message: errorManager.getMessage(code),
        raw: error,
      };
    }
  }

  stop() {
    try {
      if (this.stream) {
        this.stream.getTracks().forEach((track) => {
          track.stop();
        });
      }

      this.videoEl.pause();
      this.videoEl.srcObject = null;
      this.stream = null;
      this.isRunning = false;

      debug.log("Camera stopped.");

      return {
        ok: true,
        message: "Camera stopped successfully.",
      };
    } catch (error) {
      debug.error("Camera stop failed:", error);

      return {
        ok: false,
        code: "CAMERA_STOP_FAILED",
        message: errorManager.getMessage("CAMERA_STOP_FAILED"),
        raw: error,
      };
    }
  }

  async restart(customConstraints = null) {
    this.stop();
    return this.start(customConstraints);
  }

  async downgradeResolution() {
    const fallbackConstraints = this.buildConstraints(
      APP_CONFIG.CAMERA.FALLBACK_WIDTH,
      APP_CONFIG.CAMERA.FALLBACK_HEIGHT
    );

    debug.warn("Downgrading camera resolution.");

    return this.restart(fallbackConstraints);
  }

  getVideoSize() {
    return {
      width: this.videoEl.videoWidth || APP_CONFIG.CAMERA.DEFAULT_WIDTH,
      height: this.videoEl.videoHeight || APP_CONFIG.CAMERA.DEFAULT_HEIGHT,
    };
  }

  hasActiveStream() {
    return Boolean(this.stream) && this.isRunning;
  }
}