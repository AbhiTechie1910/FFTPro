import { debug } from "../utils/debug.js";

const ERROR_MESSAGES = {
  CAMERA_PERMISSION_DENIED: "Camera permission denied. Please allow camera access and try again.",
  CAMERA_NOT_FOUND: "No camera device was found on this system.",
  CAMERA_START_FAILED: "Failed to start the camera.",
  CAMERA_STOP_FAILED: "Failed to stop the camera cleanly.",
  NETWORK_ERROR: "Network error. Please check your connection.",
  SAVE_FAILED: "Failed to save data.",
  ACTIVE_PATIENT_MISSING: "No active patient selected. Please select a patient first.",
  UNKNOWN_ERROR: "Something went wrong. Please try again.",
};

export const errorManager = {
  getMessage(code, fallback = null) {
    return ERROR_MESSAGES[code] || fallback || ERROR_MESSAGES.UNKNOWN_ERROR;
  },

  normalize(error) {
    if (!error) {
      return {
        code: "UNKNOWN_ERROR",
        message: this.getMessage("UNKNOWN_ERROR"),
      };
    }

    if (typeof error === "string") {
      return {
        code: "UNKNOWN_ERROR",
        message: error,
      };
    }

    return {
      code: error.code || "UNKNOWN_ERROR",
      message: error.message || this.getMessage(error.code || "UNKNOWN_ERROR"),
      raw: error,
    };
  },

  log(error, context = "") {
    const normalized = this.normalize(error);
    debug.error(context || "Error", normalized);
    return normalized;
  },
};