import { APP_CONFIG } from "../app/constants.js";

export class UIManager {
  constructor(refs = {}) {
    this.refs = refs;
    this.lastUiUpdateAt = 0;
    this.updateInterval = APP_CONFIG.TEST.UI_UPDATE_INTERVAL_MS;
  }

  setText(refName, value) {
    const el = this.refs[refName];
    if (!el) return;
    el.textContent = value;
  }

  setHTML(refName, value) {
    const el = this.refs[refName];
    if (!el) return;
    el.innerHTML = value;
  }

  setDisabled(refName, disabled = true) {
    const el = this.refs[refName];
    if (!el) return;
    el.disabled = disabled;
  }

  show(refName) {
    const el = this.refs[refName];
    if (!el) return;
    el.style.display = "";
  }

  hide(refName) {
    const el = this.refs[refName];
    if (!el) return;
    el.style.display = "none";
  }

  updateStatus(message) {
    this.setText("statusEl", message);
  }

  updateTimer(message) {
    this.setText("timeEl", message);
  }

  updateRepCount(count) {
    this.setText("repEl", String(count));
  }

  updateWarning(message) {
    this.setText("warningEl", message);
  }

  updatePatientLine(message) {
    this.setText("patientLineEl", message);
  }

  updateSaveState(message) {
    this.setText("saveStateEl", message);
  }

  throttledUpdate(callback) {
    const now = performance.now();
    if (now - this.lastUiUpdateAt < this.updateInterval) return;

    this.lastUiUpdateAt = now;
    callback();
  }
}