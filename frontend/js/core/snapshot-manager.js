import { APP_CONFIG } from "../app/constants.js";
import { debug } from "../utils/debug.js";
import { nowIso } from "../utils/math.js";

export class SnapshotManager {
  constructor(videoEl, bufferCanvasEl, options = {}) {
    if (!videoEl || !bufferCanvasEl) {
      throw new Error("SnapshotManager requires video and buffer canvas.");
    }

    this.videoEl = videoEl;
    this.canvasEl = bufferCanvasEl;
    this.ctx = bufferCanvasEl.getContext("2d");
    this.maxSnapshots = options.maxSnapshots ?? APP_CONFIG.TEST.MAX_SNAPSHOTS_PER_TEST;
    this.isMirrored = Boolean(options.isMirrored);
    this.snapshots = [];
  }

  capture(reason = "event", metadata = {}) {
    try {
      const width = this.videoEl.videoWidth;
      const height = this.videoEl.videoHeight;

      if (!width || !height) {
        return null;
      }

      this.canvasEl.width = width;
      this.canvasEl.height = height;

      this.ctx.save();

      if (this.isMirrored) {
        this.ctx.translate(width, 0);
        this.ctx.scale(-1, 1);
      }

      this.ctx.drawImage(this.videoEl, 0, 0, width, height);
      this.ctx.restore();

      const dataUrl = this.canvasEl.toDataURL("image/jpeg", 0.9);

      const snapshot = {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`,
        created_at: nowIso(),
        reason,
        mime_type: "image/jpeg",
        data_url: dataUrl,
        metadata,
      };

      this.snapshots.push(snapshot);

      if (this.snapshots.length > this.maxSnapshots) {
        this.snapshots.shift();
      }

      return snapshot;
    } catch (error) {
      debug.error("Snapshot capture failed:", error);
      return null;
    }
  }

  getAll() {
    return [...this.snapshots];
  }

  getLatest() {
    return this.snapshots.length ? this.snapshots[this.snapshots.length - 1] : null;
  }

  clear() {
    this.snapshots = [];
  }

  buildUploadPayload(patientId, testName, testDate, attemptNumber) {
    return this.snapshots.map((snapshot, index) => ({
      patient_id: patientId,
      test_name: testName,
      test_date: testDate,
      attempt_number: attemptNumber,
      image_index: index + 1,
      reason: snapshot.reason,
      mime_type: snapshot.mime_type,
      image_data_url: snapshot.data_url,
      metadata: snapshot.metadata || {},
      captured_at: snapshot.created_at,
    }));
  }
}