import { APP_CONFIG } from "../app/constants.js";

export class TestRunner {
  constructor(options = {}) {
    this.countdownSeconds =
      options.countdownSeconds ?? APP_CONFIG.TEST.DEFAULT_COUNTDOWN_SECONDS;

    this.state = "idle";
    this.startedAt = null;
    this.endedAt = null;
    this.countdownTimer = null;
    this.lastTransitionAt = 0;
  }

  setState(nextState) {
    this.state = nextState;
    this.lastTransitionAt = performance.now();
  }

  getState() {
    return this.state;
  }

  canTransition(minHoldMs = APP_CONFIG.TEST.MIN_STATE_HOLD_MS) {
    return performance.now() - this.lastTransitionAt >= minHoldMs;
  }

  async startCountdown(onTick = null, onComplete = null) {
    if (this.state === "running" || this.state === "countdown") {
      return false;
    }

    this.setState("countdown");

    let count = this.countdownSeconds;

    return new Promise((resolve) => {
      if (onTick) onTick(count);

      this.countdownTimer = setInterval(() => {
        count -= 1;

        if (onTick) onTick(count);

        if (count <= 0) {
          clearInterval(this.countdownTimer);
          this.countdownTimer = null;
          this.start();

          if (typeof onComplete === "function") {
            onComplete();
          }

          resolve(true);
        }
      }, 1000);
    });
  }

  start() {
    this.startedAt = performance.now();
    this.endedAt = null;
    this.setState("running");
  }

  stop() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    this.endedAt = performance.now();
    this.setState("ended");
  }

  reset() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    this.startedAt = null;
    this.endedAt = null;
    this.setState("idle");
  }

  getElapsedMs() {
    if (!this.startedAt) return 0;

    const endPoint = this.endedAt || performance.now();
    return Math.max(0, endPoint - this.startedAt);
  }

  isRunning() {
    return this.state === "running";
  }

  isCountdown() {
    return this.state === "countdown";
  }

  isEnded() {
    return this.state === "ended";
  }
}