import { storageManager } from "../core/storage-manager.js";

export class AttemptManager {
  constructor(testName, patientId) {
    this.testName = testName;
    this.patientId = patientId;
    this.storageKey = `fft_attempts_${patientId}_${testName}`;
  }

  getAttemptNumber() {
    const value = storageManager.get(this.storageKey, 0);
    return Number.isFinite(value) ? value : 0;
  }

  getNextAttemptNumber() {
    const current = this.getAttemptNumber();
    const next = current + 1;
    storageManager.set(this.storageKey, next);
    return next;
  }

  setAttemptNumber(value) {
    const safeValue = Number(value) || 0;
    storageManager.set(this.storageKey, safeValue);
  }

  resetAttempts() {
    storageManager.remove(this.storageKey);
  }
}