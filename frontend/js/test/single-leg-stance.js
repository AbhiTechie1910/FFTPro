/* =========================================================
   FFTPro — Single Leg Stance (SLS)
   FULL UPDATED FILE (your HTML IDs)
   ✅ Auto-save on FOOT DOWN (no Record button)
   ✅ Stop + CAPTURE IMAGE when:
      - foot down (both feet on ground)
      - hands leave hips AND appear to grab support (wall/chair) OR touch thighs
      - major compensatory arm movement (hands not on hips during holding)
   ✅ Track sway:
      - capture + warn on sway spike
      - optional stop on severe sustained sway
   ========================================================= */

// ------------------------------
// Utilities
// ------------------------------
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function toPx(pt, w, h) { return { x: pt.x * w, y: pt.y * h, z: pt.z ?? 0, v: pt.visibility ?? 1 }; }

function angleDeg(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const lab = Math.hypot(ab.x, ab.y);
  const lcb = Math.hypot(cb.x, cb.y);
  if (lab < 1e-6 || lcb < 1e-6) return 180;
  const cos = clamp(dot / (lab * lcb), -1, 1);
  return Math.acos(cos) * 180 / Math.PI;
}

function scoreFromTime(sec) {
  if (sec >= 30) return +1;
  if (sec >= 20) return 0;
  return -1;
}

function nowMs() { return performance.now(); }

// ------------------------------
// Pose connections
// ------------------------------
const POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

// ------------------------------
// DOM (matches your HTML)
// ------------------------------
const videoEl = document.getElementById("cameraFeed");
const overlayEl = document.getElementById("overlayCanvas");
const ctx = overlayEl.getContext("2d");

const frameCanvas = document.getElementById("frameCanvas");
const frameCtx = frameCanvas ? frameCanvas.getContext("2d") : null;

const btnStartCamera = document.getElementById("startCameraBtn");
const btnStopCamera = document.getElementById("stopCameraBtn");
const btnStartTest = document.getElementById("startTestBtn") || document.getElementById("starttestbtn");
const btnRecord = document.getElementById("recordBtn"); // will stay disabled (optional)

const camStatus = document.getElementById("camStatus");
const stageText = document.getElementById("stageText");
const distanceText = document.getElementById("distanceText");
const lightingText = document.getElementById("lightingText");
const landmarkText = document.getElementById("landmarkText");

const sideText = document.getElementById("sideText");
const holdText = document.getElementById("holdText");
const bestHoldText = document.getElementById("bestHoldText");
const footDownText = document.getElementById("footDownText");
const swayText = document.getElementById("swayText");
const qualityText = document.getElementById("qualityText");
const recordedText = document.getElementById("recordedText");
const warningText = document.getElementById("warningText");

const rightScore = document.getElementById("rightScore");
const leftScore = document.getElementById("leftScore");
const autoFillMsg = document.getElementById("autoFillMsg");

const maxTimeEl = document.getElementById("maxTime");
const eyesEl = document.getElementById("eyes");

const lastRecordedSideEl = document.getElementById("lastRecordedSide");
const lastRecordedValueEl = document.getElementById("lastRecordedValue");

// ------------------------------
// Status helpers
// ------------------------------
function setBadge(text, kind = "ghost") {
  if (!camStatus) return;
  camStatus.textContent = text;
  camStatus.className = "badge";
  if (kind === "good") camStatus.classList.add("good");
  if (kind === "bad") camStatus.classList.add("bad");
  if (kind === "warn") camStatus.classList.add("warn");
}
function setStage(text) { if (stageText) stageText.textContent = text; }
function setWarn(text) { if (warningText) warningText.textContent = text; }

// ------------------------------
// Capture image helper
// ------------------------------
let capturePreviewEl = null;

function ensureCapturePreview() {
  // Create a preview image under warnings (once)
  if (capturePreviewEl) return capturePreviewEl;
  if (!warningText) return null;

  const parent = warningText.parentElement || warningText;
  const img = document.createElement("img");
  img.style.display = "none";
  img.style.marginTop = "10px";
  img.style.width = "100%";
  img.style.maxWidth = "360px";
  img.style.borderRadius = "12px";
  img.style.border = "1px solid rgba(255,255,255,0.15)";
  img.alt = "Captured compensation frame";
  parent.appendChild(img);
  capturePreviewEl = img;
  return img;
}

function captureFrameDataURL() {
  try {
    if (!frameCanvas || !frameCtx) return null;
    const w = videoEl.videoWidth || 0;
    const h = videoEl.videoHeight || 0;
    if (!w || !h) return null;

    frameCanvas.width = w;
    frameCanvas.height = h;

    // Draw current video frame
    frameCtx.drawImage(videoEl, 0, 0, w, h);

    // Also draw overlay on it (optional): we can re-draw pose overlay if needed,
    // but simplest: just capture raw frame.
    return frameCanvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}

function showCapturePreview(dataUrl) {
  const img = ensureCapturePreview();
  if (!img || !dataUrl) return;
  img.src = dataUrl;
  img.style.display = "block";
}

// ------------------------------
// Simple checks (light/distance proxies)
// ------------------------------
function checkLighting() {
  try {
    const w = videoEl.videoWidth || 0, h = videoEl.videoHeight || 0;
    if (!w || !h) return { ok: false, label: "Not checked" };

    const tmp = document.createElement("canvas");
    tmp.width = 160; tmp.height = 90;
    const tctx = tmp.getContext("2d", { willReadFrequently: true });
    tctx.drawImage(videoEl, 0, 0, tmp.width, tmp.height);
    const img = tctx.getImageData(0, 0, tmp.width, tmp.height).data;

    let sum = 0;
    const step = 16;
    for (let i = 0; i < img.length; i += 4 * step) sum += (img[i] + img[i + 1] + img[i + 2]) / 3;
    const samples = Math.floor(img.length / (4 * step));
    const avg = sum / Math.max(1, samples);

    if (avg < 55) return { ok: false, label: "Too dark" };
    if (avg > 210) return { ok: true, label: "Very bright" };
    return { ok: true, label: "OK" };
  } catch {
    return { ok: false, label: "Not checked" };
  }
}

function checkDistance(pl) {
  try {
    const ls = pl?.[11], rs = pl?.[12];
    if (!ls || !rs) return { ok: false, label: "Not measured" };
    const span = Math.abs(ls.x - rs.x);
    if (span < 0.18) return { ok: false, label: "Too far" };
    if (span > 0.55) return { ok: false, label: "Too close" };
    return { ok: true, label: "OK" };
  } catch {
    return { ok: false, label: "Not measured" };
  }
}

// ------------------------------
// Overlay drawing
// ------------------------------
function resizeOverlayToVideo() {
  const rect = videoEl.getBoundingClientRect();
  overlayEl.width = Math.round(rect.width);
  overlayEl.height = Math.round(rect.height);
}

function drawOverlay(pl) {
  resizeOverlayToVideo();
  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);
  if (!pl || pl.length < 33) return;

  const vw = videoEl.videoWidth || 1280;
  const vh = videoEl.videoHeight || 720;
  const sx = overlayEl.width / vw;
  const sy = overlayEl.height / vh;

  // Keep TRUE if your CSS mirrors video feed
  const MIRROR = true;

  const pts = pl.map(p => {
    const x0 = (p.x * vw) * sx;
    const y0 = (p.y * vh) * sy;
    const x = MIRROR ? (overlayEl.width - x0) : x0;
    return { x, y: y0, v: p.visibility ?? 1 };
  });

  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,255,0,0.8)";

  for (const [a, b] of POSE_CONNECTIONS) {
    const pa = pts[a], pb = pts[b];
    if (!pa || !pb) continue;
    if ((pa.v ?? 1) < 0.15 || (pb.v ?? 1) < 0.15) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  for (const p of pts) {
    if ((p.v ?? 1) < 0.15) continue;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ------------------------------
// Compensation detection helpers (pose-only heuristics)
// ------------------------------
function normPt(plIdx, pl) {
  const p = pl?.[plIdx];
  if (!p) return null;
  return { x: p.x, y: p.y, v: p.visibility ?? 1 };
}
function nDist(a, b) {
  // normalized distance (0..~1)
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function detectHandSupport(pl) {
  // Returns {stop:boolean, reason:string, detail:string}
  // Heuristics:
  // 1) Hands on hips expected. If wrists move away from hips for sustained frames -> compensation.
  // 2) Wrist close to knee/thigh region -> "hand_on_thigh"
  // 3) Wrist near frame edge + arm extended -> "grab_support_wall_chair"
  const LW = normPt(15, pl), RW = normPt(16, pl);
  const LE = normPt(13, pl), RE = normPt(14, pl);
  const LS = normPt(11, pl), RS = normPt(12, pl);
  const LH = normPt(23, pl), RH = normPt(24, pl);
  const LK = normPt(25, pl), RK = normPt(26, pl);

  const minV = 0.45;
  const ok =
    LW && RW && LH && RH && LS && RS && LE && RE &&
    [LW, RW, LH, RH, LS, RS, LE, RE].every(p => (p.v ?? 1) >= minV);

  if (!ok) return { stop: false, reason: "", detail: "" };

  // torso scale: shoulder width
  const shoulderW = Math.max(1e-6, Math.abs(LS.x - RS.x));
  const hipW = Math.max(1e-6, Math.abs(LH.x - RH.x));
  const scale = Math.max(shoulderW, hipW);

  // Hands on hips proxy: wrist near ipsilateral hip
  const lWristHip = nDist(LW, LH) / scale;
  const rWristHip = nDist(RW, RH) / scale;

  const handsOnHips = (lWristHip < 0.75) && (rWristHip < 0.75); // lenient

  // Hand on thigh: wrist near knee OR near midpoint hip-knee
  const lWristKnee = LK ? (nDist(LW, LK) / scale) : 999;
  const rWristKnee = RK ? (nDist(RW, RK) / scale) : 999;

  const handOnThigh = (lWristKnee < 0.9) || (rWristKnee < 0.9);

  // Grab wall/chair proxy: wrist near edge + arm extended
  const lNearEdge = (LW.x < 0.05) || (LW.x > 0.95);
  const rNearEdge = (RW.x < 0.05) || (RW.x > 0.95);

  // Elbow extension (normalized angle) using pixelless norm points
  // angle at elbow: shoulder-elbow-wrist
  const lElbowAng = angleDeg(LS, LE, LW);
  const rElbowAng = angleDeg(RS, RE, RW);

  const lArmExtended = lElbowAng > 150;
  const rArmExtended = rElbowAng > 150;

  const grabSupport = (lNearEdge && lArmExtended) || (rNearEdge && rArmExtended);

  // Arms compensation: hands not on hips during hold
  const armsOffHips = !handsOnHips;

  if (grabSupport) return { stop: true, reason: "grab_support", detail: "Hand reached edge with extended arm (wall/chair support likely)." };
  if (handOnThigh) return { stop: true, reason: "hand_on_thigh", detail: "Hand moved to thigh/knee region for support." };
  if (armsOffHips) return { stop: true, reason: "arms_compensation", detail: "Hands left hips (arm compensation)." };

  return { stop: false, reason: "", detail: "" };
}

// ------------------------------
// Assessor
// ------------------------------
class SingleLegStanceAssessor {
  constructor(cfg) {
    this.video = cfg.video;
    this.isActive = cfg.isActive ?? (() => false);
    this.onUpdate = cfg.onUpdate ?? (() => {});
    this.onTrial = cfg.onTrial ?? (() => {});
    this.onEvent = cfg.onEvent ?? (() => {}); // non-terminating warnings/captures
    this.onError = cfg.onError ?? ((e) => console.error(e));

    this.params = {
      minVis: 0.55,
      liftMarginNorm: 0.18,
      kneeFlexMaxDeg: 150,
      stableFramesNeeded: 10,

      // Foot-down detection threshold: abs ankle y diff < groundThresh * legLen
      groundThreshNorm: 0.08, // tweak 0.06–0.10

      // Sway thresholds (hip-mid drift proxy)
      swayWarnNorm: 0.020,  // capture+warn if above
      swayFailNorm: 0.035,  // stop if sustained above
      swayFailFrames: 8,    // sustained frames

      // fallback posture break if neither foot-down nor support triggers
      breakGraceMs: 150,

      ...cfg.params
    };

    this._pose = null;
    this._latest = null;

    this._running = false;
    this._rafId = null;

    this._state = "IDLE";
    this._validStreak = 0;

    this._attemptStartTs = null;
    this._holdSec = 0;
    this._bestHoldSec = 0;
    this._breakSinceTs = null;

    this._supportLeg = null; // "L" / "R"
    this._liftLeg = null;

    this._footDownCount = 0;
    this._lastValid = false;

    this._swayProxy = 0;
    this._lastHipMid = null;

    // anti-spam captures
    this._swayCaptured = false;
    this._swayFailStreak = 0;
  }

  async init() {
    const PoseCtor = (window.Pose && (window.Pose.Pose || window.Pose)) || null;
    if (!PoseCtor) throw new Error("MediaPipe Pose not loaded.");

    this._pose = new PoseCtor({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
    });

    this._pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    this._pose.onResults((res) => { this._latest = res; });
    return this;
  }

  start() {
    if (!this._pose) throw new Error("Call init() before start().");
    this._running = true;

    const tick = async () => {
      if (!this._running) return;
      try {
        await this._pose.send({ image: this.video });
        this._compute();
      } catch (e) {
        this.onError(e);
      }
      this._rafId = requestAnimationFrame(tick);
    };

    this._rafId = requestAnimationFrame(tick);
  }

  stop() {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this._resetAttempt(true);
  }

  _resetAttempt(hard = false) {
    this._state = "IDLE";
    this._validStreak = 0;

    this._attemptStartTs = null;
    this._holdSec = 0;
    this._bestHoldSec = 0;
    this._breakSinceTs = null;

    this._footDownCount = 0;
    this._lastValid = false;

    this._swayProxy = 0;
    this._lastHipMid = null;

    this._swayCaptured = false;
    this._swayFailStreak = 0;

    if (hard) {
      this._supportLeg = null;
      this._liftLeg = null;
    }
  }

  _compute() {
    const pl = this._latest?.poseLandmarks;

    if (!pl || pl.length < 33) {
      this._resetAttempt();
      this.onUpdate({ ok: false, reason: "No pose detected.", state: this._state, poseLandmarks: null });
      return;
    }

    // checks always
    const light = checkLighting();
    const distc = checkDistance(pl);
    if (lightingText) lightingText.textContent = light.label;
    if (distanceText) distanceText.textContent = distc.label;

    // if not active: overlay only
    if (!this.isActive()) {
      this._resetAttempt(false);
      this.onUpdate({
        ok: true,
        state: "IDLE",
        valid: false,
        stable: false,
        holdSec: 0,
        bestHoldSec: 0,
        footDownCount: 0,
        swayProxy: 0,
        score: null,
        reason: "Test not started. Click Start Test.",
        poseLandmarks: pl
      });
      return;
    }

    const w = this.video.videoWidth || 1280;
    const h = this.video.videoHeight || 720;

    const LHip = toPx(pl[23], w, h);
    const RHip = toPx(pl[24], w, h);
    const LKnee = toPx(pl[25], w, h);
    const RKnee = toPx(pl[26], w, h);
    const LAnk = toPx(pl[27], w, h);
    const RAnk = toPx(pl[28], w, h);

    const minVis = this.params.minVis;
    const visible = [LHip, RHip, LKnee, RKnee, LAnk, RAnk].every(p => (p.v ?? 1) >= minVis);
    if (landmarkText) landmarkText.textContent = visible ? "OK" : "Low";

    if (!visible) {
      this._resetAttempt();
      this.onUpdate({ ok: false, reason: "Low visibility. Keep full body in frame.", state: this._state, poseLandmarks: pl });
      return;
    }

    // stance selection
    const stance = (LAnk.y > RAnk.y) ? "L" : "R";
    const lift = (stance === "L") ? "R" : "L";

    const stanceHip = stance === "L" ? LHip : RHip;
    const stanceAnk = stance === "L" ? LAnk : RAnk;

    const liftHip = lift === "L" ? LHip : RHip;
    const liftKnee = lift === "L" ? LKnee : RKnee;
    const liftAnk = lift === "L" ? LAnk : RAnk;

    const legLen = Math.max(1, dist(stanceHip, stanceAnk));
    const liftMarginPx = this.params.liftMarginNorm * legLen;

    const ankleLifted = (stanceAnk.y - liftAnk.y) > liftMarginPx;
    const kneeAngle = angleDeg(liftHip, liftKnee, liftAnk);
    const kneeFlexed = kneeAngle <= this.params.kneeFlexMaxDeg;

    const valid = ankleLifted && kneeFlexed;

    // sway proxy from hip-mid drift (pixel space)
    const hipMid = { x: (LHip.x + RHip.x) / 2, y: (LHip.y + RHip.y) / 2 };
    if (this._lastHipMid) {
      const d = dist(hipMid, this._lastHipMid);
      this._swayProxy = 0.9 * this._swayProxy + 0.1 * d;
    }
    this._lastHipMid = hipMid;

    // foot down count transitions
    if (this._state === "HOLDING") {
      if (this._lastValid && !valid) this._footDownCount++;
    }
    this._lastValid = valid;

    if (valid) this._validStreak++;
    else this._validStreak = 0;

    const stable = this._validStreak >= this.params.stableFramesNeeded;
    const t = nowMs();

    // ---- STATE: IDLE -> HOLDING
    if (this._state === "IDLE") {
      if (stable) {
        this._state = "HOLDING";
        this._attemptStartTs = t;
        this._holdSec = 0;
        this._bestHoldSec = 0;
        this._breakSinceTs = null;

        // lock leg for this attempt
        this._supportLeg = stance;
        this._liftLeg = lift;

        this._swayCaptured = false;
        this._swayFailStreak = 0;
      }
    }

    // ---- STATE: HOLDING
    if (this._state === "HOLDING") {
      this._holdSec = (t - this._attemptStartTs) / 1000;
      this._bestHoldSec = Math.max(this._bestHoldSec, this._holdSec);

      // ✅ 1) FOOT DOWN detector (hard stop)
      const groundThreshPx = this.params.groundThreshNorm * legLen;
      const bothFeetDown = Math.abs(LAnk.y - RAnk.y) < groundThreshPx;
      if (bothFeetDown) {
        const img = captureFrameDataURL();
        this._completeAttempt("foot_down", img, "Foot placed down (both feet on ground).");
        return;
      }

      // ✅ 2) HAND SUPPORT / ARM COMPENSATION detector (stop + capture)
      const hs = detectHandSupport(pl);
      if (hs.stop) {
        const img = captureFrameDataURL();
        this._completeAttempt(hs.reason, img, hs.detail);
        return;
      }

      // ✅ 3) Severe sway (stop if sustained), mild sway (capture+warn once)
      const swayNorm = this._swayProxy / Math.max(1, legLen); // normalize by leg length
      if (swayNorm > this.params.swayWarnNorm && !this._swayCaptured) {
        this._swayCaptured = true;
        const img = captureFrameDataURL();
        this.onEvent({
          type: "sway_warning",
          message: "Postural sway detected (warning).",
          capture: img || null
        });
      }

      if (swayNorm > this.params.swayFailNorm) this._swayFailStreak++;
      else this._swayFailStreak = 0;

      if (this._swayFailStreak >= this.params.swayFailFrames) {
        const img = captureFrameDataURL();
        this._completeAttempt("severe_sway", img, "Severe postural sway (sustained) detected.");
        return;
      }

      // ✅ 4) Max cap
      const cap = Number(maxTimeEl?.value || 30);
      if (this._holdSec >= cap) {
        const img = captureFrameDataURL();
        this._completeAttempt("max_cap", img, "Reached max time cap.");
        return;
      }

      // ✅ 5) Fallback posture break (if invalid posture sustained)
      if (!valid) {
        if (this._breakSinceTs == null) this._breakSinceTs = t;
        if ((t - this._breakSinceTs) >= this.params.breakGraceMs) {
          const img = captureFrameDataURL();
          this._completeAttempt("posture_break", img, "Posture invalid (lift + knee criteria not met).");
          return;
        }
      } else {
        this._breakSinceTs = null;
      }
    }

    // UI update every frame
    this.onUpdate({
      ok: true,
      state: this._state,
      stable,
      valid,
      holdSec: this._holdSec,
      bestHoldSec: this._bestHoldSec,
      supportLeg: (this._supportLeg || stance) === "L" ? "Left" : "Right",
      liftedLeg: (this._liftLeg || lift) === "L" ? "Left" : "Right",
      kneeAngleDeg: Math.round(kneeAngle),
      footDownCount: this._footDownCount,
      swayProxy: this._swayProxy,
      score: (this._state === "HOLDING") ? scoreFromTime(this._bestHoldSec) : null,
      poseLandmarks: pl,
      reason: valid ? (stable ? "Stable hold" : "Stabilizing...") : "Invalid posture (lift ankle + flex knee)."
    });
  }

  _completeAttempt(reason, captureDataUrl, detailMsg) {
    const best = this._bestHoldSec;
    const score = scoreFromTime(best);

    const payload = {
      test: "SingleLegStance",
      timestamp: new Date().toISOString(),
      reason,
      reasonDetail: detailMsg || "",
      eyes: eyesEl?.value || "eyes_open",
      supportLeg: this._supportLeg === "L" ? "Left" : "Right",
      liftedLeg: this._liftLeg === "L" ? "Left" : "Right",
      bestHoldSec: Number(best.toFixed(2)),
      footDownCount: this._footDownCount,
      swayProxy: Number(this._swayProxy.toFixed(2)),
      score,
      capture: captureDataUrl || null // ✅ image snapshot
    };

    this.onTrial(payload);
    this._resetAttempt(false);
  }
}

async function createSingleLegStanceAssessor(cfg) {
  const a = new SingleLegStanceAssessor(cfg);
  await a.init();
  return a;
}

// ------------------------------
// App state
// ------------------------------
let stream = null;
let assessor = null;
let testActive = false;

// ------------------------------
// UI update
// ------------------------------
function uiUpdate(m) {
  drawOverlay(m?.poseLandmarks);

  if (!m?.ok) {
    setBadge("Blocked", "bad");
    setStage("Not started");
    setWarn(m?.reason ?? "—");
    if (sideText) sideText.textContent = "—";
    if (holdText) holdText.textContent = "—";
    if (bestHoldText) bestHoldText.textContent = "—";
    if (footDownText) footDownText.textContent = "—";
    if (swayText) swayText.textContent = "—";
    if (qualityText) qualityText.textContent = "—";
    return;
  }

  if (!testActive) {
    setBadge("Ready", "warn");
    setStage("Camera running (test not started)");
    setWarn("Click Start Test.");
  } else {
    setBadge(m.state === "HOLDING" ? "Running" : "Waiting", m.state === "HOLDING" ? "good" : "warn");
    setStage(m.state === "HOLDING" ? "Holding" : "Waiting for stable posture...");
    setWarn(m.reason ?? "");
  }

  if (sideText) sideText.textContent = m.supportLeg ?? "—";
  if (holdText) holdText.textContent = (m.holdSec ?? 0).toFixed(1);
  if (bestHoldText) bestHoldText.textContent = (m.bestHoldSec ?? 0).toFixed(1);
  if (footDownText) footDownText.textContent = String(m.footDownCount ?? 0);

  // sway text: show normalized-ish small value
  if (swayText) swayText.textContent = (m.swayProxy ?? 0).toFixed(1);

  const q = (m.valid ? "OK" : "Invalid") + (m.stable ? " • Stable" : " • Stabilizing");
  if (qualityText) qualityText.textContent = q;
}

// ------------------------------
// Non-terminating events (sway warning capture)
// ------------------------------
function onEvent(ev) {
  if (!ev) return;
  if (ev.type === "sway_warning") {
    setWarn(ev.message || "Postural sway warning.");
    if (ev.capture) showCapturePreview(ev.capture);
  }
}

// ------------------------------
// ✅ AUTO-SAVE on end (foot down OR support OR severe sway)
// ------------------------------
function onTrial(payload) {
  const secStr = payload.bestHoldSec.toFixed(1);

  // Auto-fill fields
  if (payload.supportLeg === "Right") {
    rightScore.value = secStr;
    autoFillMsg.textContent = `Auto-saved ${secStr}s to Right Leg.`;
    lastRecordedSideEl.value = "Right";
  } else {
    leftScore.value = secStr;
    autoFillMsg.textContent = `Auto-saved ${secStr}s to Left Leg.`;
    lastRecordedSideEl.value = "Left";
  }

  if (recordedText) recordedText.textContent = secStr;
  lastRecordedValueEl.value = secStr;

  // Flag warning + show capture if present
  const label = payload.reasonDetail ? `${payload.reason}: ${payload.reasonDetail}` : payload.reason;
  setWarn(`Stopped & saved — ${label}`);

  if (payload.capture) showCapturePreview(payload.capture);
}

// ------------------------------
// Camera controls
// ------------------------------
async function startCamera() {
  try {
    setBadge("Starting...", "warn");
    setStage("Starting camera...");

    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false
    });

    videoEl.srcObject = stream;

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("metadata timeout")), 6000);
      videoEl.onloadedmetadata = () => { clearTimeout(t); resolve(); };
    });

    await videoEl.play();

    assessor = await createSingleLegStanceAssessor({
      video: videoEl,
      isActive: () => testActive,
      onUpdate: uiUpdate,
      onTrial: onTrial,
      onEvent: onEvent,
      onError: (e) => {
        console.error(e);
        setBadge("Error", "bad");
        setWarn("Pose error. Check console.");
      }
    });

    assessor.start();

    btnStartCamera.disabled = true;
    btnStopCamera.disabled = false;

    if (btnStartTest) btnStartTest.disabled = false;

    // Record button not needed now
    if (btnRecord) btnRecord.disabled = true;

    setBadge("Ready", "good");
    setStage("Camera running (test not started)");
    setWarn("Click Start Test. Stops on foot-down or support use; captures the moment.");

  } catch (err) {
    console.error(err);
    setBadge("Blocked", "bad");
    setStage("Camera blocked");
    alert(`Camera failed: ${err?.name || "Error"}\n${err?.message || err}`);
  }
}

function stopCamera() {
  testActive = false;

  if (assessor) assessor.stop();
  assessor = null;

  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  videoEl.srcObject = null;

  btnStartCamera.disabled = false;
  btnStopCamera.disabled = true;

  if (btnStartTest) btnStartTest.disabled = true;
  if (btnRecord) btnRecord.disabled = true;

  setBadge("Stopped", "warn");
  setStage("Not started");
  setWarn("Stopped.");

  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);

  if (capturePreviewEl) capturePreviewEl.style.display = "none";
}

// ------------------------------
// Test controls
// ------------------------------
function startTest() {
  if (!assessor) { alert("Start camera first."); return; }
  testActive = true;

  if (holdText) holdText.textContent = "0.0";
  if (bestHoldText) bestHoldText.textContent = "0.0";
  if (footDownText) footDownText.textContent = "0";
  if (recordedText) recordedText.textContent = "—";
  if (autoFillMsg) autoFillMsg.textContent = "";
  if (capturePreviewEl) capturePreviewEl.style.display = "none";

  setBadge("Running", "good");
  setStage("Waiting for stable posture...");
  setWarn("Lift one leg. Timing starts automatically. Stops & captures on foot-down/support.");
}

// ------------------------------
// Hook events
// ------------------------------
btnStartCamera.addEventListener("click", startCamera);
btnStopCamera.addEventListener("click", stopCamera);
if (btnStartTest) btnStartTest.addEventListener("click", startTest);

// Initial UI state
btnStopCamera.disabled = true;
if (btnStartTest) btnStartTest.disabled = true;
if (btnRecord) btnRecord.disabled = true;

setBadge("Ready", "warn");
setStage("Not started");
setWarn("Click Start Camera.");