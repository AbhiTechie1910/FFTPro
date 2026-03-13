import { PoseLandmarker, FilesetResolver } from
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

console.log("chair-sit-reach.js loaded ✅ (simple scoring + compensation auto-fail)");

// =========================================================
// CONFIG
// =========================================================
const CFG = {
  MODEL_URL:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",

  START_STABLE_MS: 600,
  COUNTDOWN_MS: 1500,

  VIS_THRESH: 0.25,
  DRAW_VIS: 0.18,

  // Knee must be "straight enough" to be valid attempt
  KNEE_EXTENDED_DEG: 160,
  REQUIRE_KNEE_EXTENDED_FOR_RECORD: true,

  // If your CSS mirrors video/canvas (selfie view), keep true
  MIRROR_VIEW: true,

  // Scoring thresholds in NORMALIZED units (projection / tibia length)
  // Bigger => harder to get +1. Tune after testing.
  BEYOND_TOE_N: +0.05,  // +1 if finger projects beyond toe by > 5% tibia length
  TOUCH_ZONE_N: 0.05,   // 0 if within +/- 5% tibia length
  // else -1

  // Compensation detection thresholds (tune)
  TRUNK_LEAN_DEG_MAX: 20,      // trunk forward/side lean beyond this = compensation
  HIP_SWAY_N_MAX: 0.03,        // hip mid x sway beyond 3% frame width (in hold window)
  SHOULDER_SWAY_N_MAX: 0.04,   // shoulder mid x sway beyond 4% frame width
  KNEE_FLEX_COMP_DEG: 150,     // if knee drops below this during attempt = compensation
  HIP_LIFT_N_MAX: 0.04,        // hip mid y shift (up/down) beyond 4% height during hold window

  // Hold window used to detect sway/comp (ms)
  COMP_WINDOW_MS: 1500,

  // Auto-record after stable hold
  AUTO_RECORD_HOLD_SEC: 1.8,
  AUTO_RECORD_COOLDOWN_MS: 1200,

  // overlay draw
  LINE_W: 2,
  DOT_R: 3,

  // mild smoothing to reduce jitter
  SMOOTH_ALPHA: 0.78,

  DEBUG: true,
};

// =========================================================
// Pose indices (BlazePose)
// NOTE: BlazePose doesn’t provide middle fingertip.
// We'll use INDEX fingertip as a stable proxy.
// =========================================================
const L_SHOULDER = 11, R_SHOULDER = 12;
const L_WRIST = 15, R_WRIST = 16;
const L_INDEX = 19, R_INDEX = 20;

const L_HIP = 23, R_HIP = 24;
const L_KNEE = 25, R_KNEE = 26;
const L_ANKLE = 27, R_ANKLE = 28;
const L_HEEL = 29, R_HEEL = 30;
const L_FOOT_INDEX = 31, R_FOOT_INDEX = 32;

const POSE_CONNECTIONS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32], [27, 29], [28, 30], [29, 31], [30, 32],
];

// =========================================================
// DOM
// =========================================================
const $ = (id) => document.getElementById(id);

const videoEl = $("cameraFeed");
const canvasEl = $("overlayCanvas");
const frameCanvas = $("frameCanvas"); // exists in your HTML
const ctx = canvasEl?.getContext("2d");
const fctx = frameCanvas?.getContext("2d");

const btnStartCam = $("startCameraBtn");
const btnStopCam = $("stopCameraBtn");
const btnStartTest = $("starttestbtn");
const btnRecord = $("recordBtn");

const camStatusEl = $("camStatus");
const stageText = $("stageText");
const distanceText = $("distanceText");
const lightingText = $("lightingText");

const sideText = $("sideText");
const reachCurrentText = $("reachCurrentText");
const reachBestText = $("reachBestText");
const holdText = $("holdText");
const kneeText = $("kneeText");
const qualityText = $("qualityText");
const recordedText = $("recordedText");
const warningText = $("warningText");

const rightScore = $("rightScore");
const leftScore = $("leftScore");
const autoFillMsg = $("autoFillMsg");

const lastRecordedSide = $("lastRecordedSide");
const lastRecordedValue = $("lastRecordedValue");
const msgBox = $("msgBox");
const formEl = $("resultForm");

const controlsRow = document.querySelector(".controls");

function must(el, name) {
  if (!el) throw new Error(`Missing required element: ${name}`);
  return el;
}
must(videoEl, "#cameraFeed");
must(canvasEl, "#overlayCanvas");
must(ctx, "2D context");
must(btnStartCam, "#startCameraBtn");
must(btnStopCam, "#stopCameraBtn");
must(btnStartTest, "#starttestbtn");
must(controlsRow, ".controls");

// =========================================================
// Utils
// =========================================================
function ui(msg, { silent = false } = {}) {
  if (!silent && msgBox) msgBox.textContent = msg;
  if (CFG.DEBUG) console.log(msg);
}
function setBadge(s) { if (camStatusEl) camStatusEl.textContent = s; }
function setStage(s) { if (stageText) stageText.textContent = s; }

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function vis(p) { return (p?.visibility ?? 1.0); }
function avg(a, b) { return (a + b) / 2; }
function fmt(v, dp = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Number(v).toFixed(dp);
}

function angleDeg(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (mag < 1e-6) return NaN;
  const cos = clamp(dot / mag, -1, 1);
  return Math.acos(cos) * (180 / Math.PI);
}

// =========================================================
// Overlay stacking + mirror (visual only)
// =========================================================
function applyMirrorCSS() {
  const t = CFG.MIRROR_VIEW ? "scaleX(-1)" : "none";
  videoEl.style.transform = t;
  canvasEl.style.transform = t;
  videoEl.style.transformOrigin = "center";
  canvasEl.style.transformOrigin = "center";
}
function ensureOverlayStacking() {
  const shell = videoEl?.parentElement;
  if (!shell) return;

  shell.style.position = "relative";
  shell.style.overflow = "hidden";

  videoEl.style.display = "block";
  videoEl.style.width = "100%";
  videoEl.style.height = "auto";

  canvasEl.style.position = "absolute";
  canvasEl.style.left = "0";
  canvasEl.style.top = "0";
  canvasEl.style.width = "100%";
  canvasEl.style.height = "100%";
  canvasEl.style.pointerEvents = "none";
  canvasEl.style.zIndex = "5";

  applyMirrorCSS();
}

// Canvas resize DPR
let _vw = 0, _vh = 0, _dpr = 0;
function resizeCanvasToVideo() {
  const vw = videoEl.videoWidth || 0;
  const vh = videoEl.videoHeight || 0;
  if (!vw || !vh) return { w: 0, h: 0 };

  const dpr = window.devicePixelRatio || 1;
  if (vw !== _vw || vh !== _vh || dpr !== _dpr) {
    _vw = vw; _vh = vh; _dpr = dpr;
    canvasEl.width = Math.round(vw * dpr);
    canvasEl.height = Math.round(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (frameCanvas) {
      frameCanvas.width = vw;
      frameCanvas.height = vh;
    }
  }
  return { w: vw, h: vh };
}

// =========================================================
// Smoothing (EMA)
// =========================================================
let smoothed = null;
function smoothLandmarks(lms) {
  if (!lms || lms.length !== 33) return lms;
  if (!smoothed) {
    smoothed = lms.map(p => ({ ...p }));
    return smoothed;
  }
  const a = CFG.SMOOTH_ALPHA;
  for (let i = 0; i < 33; i++) {
    const p = lms[i];
    const s = smoothed[i];
    if (!p || !s) continue;
    const k = (vis(p) < 0.2) ? 0.42 : a;
    s.x = k * s.x + (1 - k) * p.x;
    s.y = k * s.y + (1 - k) * p.y;
    s.z = (p.z != null) ? (k * (s.z ?? p.z) + (1 - k) * p.z) : (s.z ?? 0);
    s.visibility = p.visibility ?? s.visibility ?? 1;
  }
  return smoothed;
}

// =========================================================
// Drawing
// =========================================================
function drawSkeleton(lms, w, h) {
  ctx.save();

  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = "rgba(0, 140, 255, 1)";
  ctx.lineWidth = CFG.LINE_W;

  ctx.beginPath();
  for (const [a, b] of POSE_CONNECTIONS) {
    const p1 = lms[a], p2 = lms[b];
    if (!p1 || !p2) continue;
    if (vis(p1) < CFG.DRAW_VIS || vis(p2) < CFG.DRAW_VIS) continue;
    ctx.moveTo(p1.x * w, p1.y * h);
    ctx.lineTo(p2.x * w, p2.y * h);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,1)";
  for (let i = 0; i < lms.length; i++) {
    const p = lms[i];
    if (!p || vis(p) < CFG.DRAW_VIS) continue;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, CFG.DOT_R, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// =========================================================
// Quality prompts
// =========================================================
function updateDistancePrompt(lms) {
  const shY = avg(lms[L_SHOULDER].y, lms[R_SHOULDER].y);
  const anY = avg(lms[L_ANKLE].y, lms[R_ANKLE].y);
  const spanY = clamp(Math.abs(anY - shY), 0, 1);

  let status = "OK";
  if (spanY < 0.45) status = "Too far (step closer)";
  else if (spanY > 0.92) status = "Too close (step back)";
  if (distanceText) distanceText.textContent = status;
}
function updateLightingPlaceholder() {
  if (lightingText) lightingText.textContent = "OK";
}
function poseOk(lms) {
  const idx = [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, L_KNEE, R_KNEE, L_ANKLE, R_ANKLE, L_HEEL, R_HEEL];
  return idx.every(i => lms[i] && vis(lms[i]) >= CFG.VIS_THRESH);
}

// =========================================================
// Side selector (anatomical)
// =========================================================
function injectSideControls() {
  if (document.getElementById("csrSideControls")) return;

  const wrap = document.createElement("div");
  wrap.id = "csrSideControls";
  wrap.style.display = "flex";
  wrap.style.flexWrap = "wrap";
  wrap.style.gap = "10px";
  wrap.style.alignItems = "center";
  wrap.style.marginTop = "10px";

  const label = document.createElement("span");
  label.textContent = "Test leg:";
  label.style.opacity = "0.9";
  wrap.appendChild(label);

  const mkBtn = (txt, side) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-outline";
    b.textContent = txt;
    b.addEventListener("click", () => {
      S.selectedSide = side;
      if (sideText) sideText.textContent = side.toUpperCase();
      if (autoFillMsg) autoFillMsg.textContent = `Selected: ${side.toUpperCase()} leg`;
      ui(`Selected ${side.toUpperCase()} leg.`, { silent: true });
    });
    return b;
  };

  wrap.appendChild(mkBtn("Left", "left"));
  wrap.appendChild(mkBtn("Right", "right"));
  controlsRow.appendChild(wrap);

  if (!S.selectedSide) S.selectedSide = "right";
  if (sideText) sideText.textContent = S.selectedSide.toUpperCase();
}

// =========================================================
// Measurement logic (simple scoring, no cm)
// Use normalized projection along leg axis:
// dn = projPx / tibiaPx
// =========================================================
function toeLandmark(lms, side) {
  const idx = side === "left" ? L_FOOT_INDEX : R_FOOT_INDEX;
  const heel = side === "left" ? L_HEEL : R_HEEL;
  const a = lms[idx], b = lms[heel];
  if (a && vis(a) >= 0.18) return a;
  if (b && vis(b) >= 0.18) return b;
  return null;
}

function fingerLandmark(lms) {
  // Use lowest visible of index tips; fallback wrist.
  const cands = [
    lms[L_INDEX], lms[R_INDEX],
    lms[L_WRIST], lms[R_WRIST],
  ].filter(p => p && vis(p) >= 0.18);
  if (!cands.length) return null;
  cands.sort((p, q) => q.y - p.y);
  return cands[0];
}

function kneeAngle(lms, side) {
  const hip = lms[side === "left" ? L_HIP : R_HIP];
  const knee = lms[side === "left" ? L_KNEE : R_KNEE];
  const ankle = lms[side === "left" ? L_ANKLE : R_ANKLE];
  if (!hip || !knee || !ankle) return NaN;
  return angleDeg(hip, knee, ankle);
}

function computeReachNormalized(lms, side, w, h) {
  const toe = toeLandmark(lms, side);
  const finger = fingerLandmark(lms);
  const hip = lms[side === "left" ? L_HIP : R_HIP];
  const knee = lms[side === "left" ? L_KNEE : R_KNEE];
  const ankle = lms[side === "left" ? L_ANKLE : R_ANKLE];

  if (!toe) return { dn: null, why: "toe_missing" };
  if (!finger) return { dn: null, why: "finger_missing" };
  if (!hip || !knee || !ankle) return { dn: null, why: "leg_missing" };

  const toePx = { x: toe.x * w, y: toe.y * h };
  const fingerPx = { x: finger.x * w, y: finger.y * h };
  const hipPx = { x: hip.x * w, y: hip.y * h };
  const kneePx = { x: knee.x * w, y: knee.y * h };
  const anklePx = { x: ankle.x * w, y: ankle.y * h };

  // tibia length for normalization
  const tibiaPx = Math.hypot(anklePx.x - kneePx.x, anklePx.y - kneePx.y);
  if (tibiaPx < 8) return { dn: null, why: "tibia_bad" };

  // leg axis hip->toe
  const ax = toePx.x - hipPx.x;
  const ay = toePx.y - hipPx.y;
  const amag = Math.hypot(ax, ay);
  if (amag < 1e-6) return { dn: null, why: "axis_bad" };

  const ux = ax / amag;
  const uy = ay / amag;

  // toe->finger projected on axis
  const vx = fingerPx.x - toePx.x;
  const vy = fingerPx.y - toePx.y;
  const projPx = (vx * ux + vy * uy);

  const dn = projPx / tibiaPx;
  return { dn, why: "ok" };
}

function scoreFromDn(dn) {
  if (!Number.isFinite(dn)) return null;
  if (dn > CFG.BEYOND_TOE_N) return +1;
  if (Math.abs(dn) <= CFG.TOUCH_ZONE_N) return 0;
  return -1;
}

// =========================================================
// Compensation + sway detection (allow but mark -> but you want -1 + snapshot)
// We'll flag compensation if ANY triggers during attempt window.
// =========================================================
function midPointPx(lms, aIdx, bIdx, w, h) {
  const a = lms[aIdx], b = lms[bIdx];
  if (!a || !b) return null;
  return { x: ((a.x + b.x) / 2) * w, y: ((a.y + b.y) / 2) * h };
}

function trunkLeanDeg(lms, w, h) {
  const sh = midPointPx(lms, L_SHOULDER, R_SHOULDER, w, h);
  const hp = midPointPx(lms, L_HIP, R_HIP, w, h);
  if (!sh || !hp) return NaN;

  // vector hip -> shoulders
  const vx = sh.x - hp.x;
  const vy = sh.y - hp.y;

  // compare to vertical (0, -1) in screen coords
  const mag = Math.hypot(vx, vy);
  if (mag < 1e-6) return NaN;

  const ux = vx / mag;
  const uy = vy / mag;

  // dot with vertical up (0, -1)
  const dot = (ux * 0) + (uy * -1);
  const cos = clamp(dot, -1, 1);
  return Math.acos(cos) * (180 / Math.PI);
}

function captureSnapshot(reason) {
  try {
    if (!frameCanvas || !fctx) return null;
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (!vw || !vh) return null;

    frameCanvas.width = vw;
    frameCanvas.height = vh;

    // draw what user sees (respect mirror)
    fctx.save();
    if (CFG.MIRROR_VIEW) {
      fctx.translate(vw, 0);
      fctx.scale(-1, 1);
    }
    fctx.drawImage(videoEl, 0, 0, vw, vh);
    fctx.restore();

    const dataUrl = frameCanvas.toDataURL("image/jpeg", 0.9);

    // auto download (easy proof)
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = dataUrl;
    a.download = `CSR_${S.selectedSide}_${reason}_${ts}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    return dataUrl;
  } catch (e) {
    console.warn("snapshot failed:", e);
    return null;
  }
}

function updateCompWindow(nowMs, hipMidPx, shMidPx) {
  // push samples
  S.comp.samples.push({
    t: nowMs,
    hipX: hipMidPx?.x ?? null,
    hipY: hipMidPx?.y ?? null,
    shX: shMidPx?.x ?? null,
    shY: shMidPx?.y ?? null,
  });

  // trim window
  const cutoff = nowMs - CFG.COMP_WINDOW_MS;
  while (S.comp.samples.length && S.comp.samples[0].t < cutoff) S.comp.samples.shift();
}

function computeSwayStats(w, h) {
  const xsHip = S.comp.samples.map(s => s.hipX).filter(v => Number.isFinite(v));
  const ysHip = S.comp.samples.map(s => s.hipY).filter(v => Number.isFinite(v));
  const xsSh  = S.comp.samples.map(s => s.shX).filter(v => Number.isFinite(v));

  function range(arr) {
    if (arr.length < 2) return 0;
    let mn = Infinity, mx = -Infinity;
    for (const v of arr) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    return mx - mn;
  }

  return {
    hipXR: range(xsHip) / (w || 1),
    hipYR: range(ysHip) / (h || 1),
    shXR: range(xsSh) / (w || 1),
  };
}

function checkCompensation(lms, w, h, dn, kneeDeg) {
  const reasons = [];

  // 1) Knee bending during attempt
  if (Number.isFinite(kneeDeg) && kneeDeg < CFG.KNEE_FLEX_COMP_DEG) {
    reasons.push(`knee_flex(${kneeDeg.toFixed(0)}°)`);
  }

  // 2) Trunk lean
  const lean = trunkLeanDeg(lms, w, h);
  if (Number.isFinite(lean) && lean > CFG.TRUNK_LEAN_DEG_MAX) {
    reasons.push(`trunk_lean(${lean.toFixed(0)}°)`);
  }

  // 3) Sway (using window ranges)
  const hipMid = midPointPx(lms, L_HIP, R_HIP, w, h);
  const shMid = midPointPx(lms, L_SHOULDER, R_SHOULDER, w, h);
  updateCompWindow(performance.now(), hipMid, shMid);

  const stats = computeSwayStats(w, h);
  if (stats.hipXR > CFG.HIP_SWAY_N_MAX) reasons.push(`hip_swayX(${(stats.hipXR*100).toFixed(1)}%)`);
  if (stats.shXR > CFG.SHOULDER_SWAY_N_MAX) reasons.push(`shoulder_swayX(${(stats.shXR*100).toFixed(1)}%)`);
  if (stats.hipYR > CFG.HIP_LIFT_N_MAX) reasons.push(`hip_liftY(${(stats.hipYR*100).toFixed(1)}%)`);

  // optional: if dn is huge but trunk lean also huge, it’s almost always compensatory
  if (Number.isFinite(dn) && dn > 0.20 && Number.isFinite(lean) && lean > 15) {
    reasons.push("reach_excess_with_lean");
  }

  return { isComp: reasons.length > 0, reasons, lean, stats };
}

// =========================================================
// State
// =========================================================
const S = {
  landmarker: null,
  stream: null,
  rafId: null,

  mode: "idle", // idle|camera|ready|countdown|tracking
  startGateOkSince: null,
  countdownStartMs: 0,

  selectedSide: "right",

  dn: null,
  bestDn: null,

  currentKneeDeg: NaN,

  lastDn: null,
  holdStartMs: null,

  lastAutoRecordAt: 0,
  lastRecorded: { side: null, score: null },

  comp: {
    flagged: false,
    reasons: [],
    snapshotDataUrl: null,
    samples: [],
  },
};

function setMode(next) {
  S.mode = next;
  setBadge(next === "idle" ? "Ready" : next.toUpperCase());
  setStage(next === "idle" ? "Not started" : next);

  btnStartTest.disabled = (next !== "ready");
  btnRecord.disabled = true;
}

function resetRun() {
  S.startGateOkSince = null;
  S.countdownStartMs = 0;

  S.dn = null;
  S.bestDn = null;
  S.currentKneeDeg = NaN;

  S.lastDn = null;
  S.holdStartMs = null;

  S.lastAutoRecordAt = 0;
  S.lastRecorded = { side: null, score: null };

  S.comp.flagged = false;
  S.comp.reasons = [];
  S.comp.snapshotDataUrl = null;
  S.comp.samples = [];

  smoothed = null;

  if (reachCurrentText) reachCurrentText.textContent = "—";
  if (reachBestText) reachBestText.textContent = "—";
  if (holdText) holdText.textContent = "—";
  if (kneeText) kneeText.textContent = "—";
  if (qualityText) qualityText.textContent = "—";
  if (recordedText) recordedText.textContent = "—";
  if (autoFillMsg) autoFillMsg.textContent = "";
  if (warningText) warningText.textContent = "Warnings will appear here.";
}

function updateHold(dn, nowMs) {
  if (!Number.isFinite(dn)) {
    S.holdStartMs = null;
    S.lastDn = null;
    if (holdText) holdText.textContent = "0.0";
    return 0;
  }

  if (S.lastDn == null) {
    S.lastDn = dn;
    S.holdStartMs = nowMs;
    if (holdText) holdText.textContent = "0.0";
    return 0;
  }

  const delta = Math.abs(dn - S.lastDn);
  if (delta > (CFG.TOUCH_ZONE_N * 0.5)) S.holdStartMs = nowMs;

  S.lastDn = dn;
  const held = S.holdStartMs ? (nowMs - S.holdStartMs) / 1000 : 0;
  if (holdText) holdText.textContent = held.toFixed(1);
  return held;
}

function recordResult(reason = "manual") {
  const side = S.selectedSide;

  // If compensation flagged at any point → fail
  let score;
  if (S.comp.flagged) {
    score = -1;
  } else {
    score = scoreFromDn(S.dn);
  }

  if (score === null) {
    ui("No valid measurement to record yet.");
    return;
  }

  const kneeOK = Number.isFinite(S.currentKneeDeg) && S.currentKneeDeg >= CFG.KNEE_EXTENDED_DEG;
  if (CFG.REQUIRE_KNEE_EXTENDED_FOR_RECORD && !kneeOK) {
    ui(`Knee not extended enough. Need ≥ ${CFG.KNEE_EXTENDED_DEG}°.`);
    return;
  }

  // Snapshot if compensation caused fail
  if (S.comp.flagged && !S.comp.snapshotDataUrl) {
    S.comp.snapshotDataUrl = captureSnapshot("compensation");
  }

  // Fill your form fields with score now (+1/0/-1)
  if (side === "left" && leftScore) leftScore.value = String(score);
  if (side === "right" && rightScore) rightScore.value = String(score);

  if (recordedText) recordedText.textContent =
    S.comp.flagged ? `-1 (COMP)` : `${score}`;

  if (lastRecordedSide) lastRecordedSide.value = side;
  if (lastRecordedValue) lastRecordedValue.value = String(score);

  S.lastRecorded = { side, score };

  const compMsg = S.comp.flagged ? ` | COMP: ${S.comp.reasons.join(", ")}` : "";
  const msg = `Recorded ✅ ${side.toUpperCase()} leg = ${score} (${reason})${compMsg}`;

  if (autoFillMsg) autoFillMsg.textContent = msg;
  ui(msg);
}

// =========================================================
// MediaPipe init (GPU -> CPU fallback)
// =========================================================
async function initPose() {
  ui("Loading MediaPipe…");
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  try {
    S.landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: CFG.MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    ui("MediaPipe ready ✅ (GPU)");
  } catch (e) {
    console.warn("GPU failed, using CPU:", e);
    S.landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: CFG.MODEL_URL, delegate: "CPU" },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    ui("MediaPipe ready ✅ (CPU)");
  }
}

// =========================================================
// Camera control
// =========================================================
async function startCamera() {
  try {
    ensureOverlayStacking();
    injectSideControls();

    if (!S.landmarker) await initPose();

    ui("Requesting camera permission…");
    S.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

    videoEl.srcObject = S.stream;
    videoEl.playsInline = true;
    videoEl.muted = true;

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Video metadata timeout")), 6000);
      videoEl.onloadedmetadata = () => { clearTimeout(t); resolve(); };
    });
    await videoEl.play();

    btnStartCam.disabled = true;
    btnStopCam.disabled = false;

    resetRun();
    setMode("camera");
    loop();
  } catch (err) {
    console.error("startCamera error:", err);
    setBadge("Error");
    setStage("Camera Error");
    ui(`❌ Camera failed: ${err?.name || "Error"} — ${err?.message || err}`);
    setMode("idle");
  }
}

function stopCamera() {
  if (S.rafId) cancelAnimationFrame(S.rafId);
  S.rafId = null;

  if (S.stream) {
    S.stream.getTracks().forEach(t => t.stop());
    S.stream = null;
  }
  videoEl.srcObject = null;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  btnStartCam.disabled = false;
  btnStopCam.disabled = true;
  btnStartTest.disabled = true;
  btnRecord.disabled = true;

  resetRun();
  setMode("idle");
}

// =========================================================
// Test controls
// =========================================================
function startTest() {
  if (S.mode !== "ready") {
    ui("Not ready yet. Show full body + feet + hands first.");
    return;
  }
  setMode("countdown");
  S.countdownStartMs = performance.now();
  ui("Get ready…", { silent: true });
}

// =========================================================
// MAIN LOOP
// =========================================================
function loop() {
  const now = performance.now();
  const { w, h } = resizeCanvasToVideo();

  if (!w || !h || !S.landmarker || videoEl.readyState < 2) {
    S.rafId = requestAnimationFrame(loop);
    return;
  }

  ctx.clearRect(0, 0, w, h);

  let result;
  try {
    result = S.landmarker.detectForVideo(videoEl, now);
  } catch (e) {
    console.error("detectForVideo failed:", e);
    setBadge("Error");
    setStage("Pose detect failed");
    ui(`Pose detect failed: ${e?.message || e}`);
    S.rafId = requestAnimationFrame(loop);
    return;
  }

  const raw = result?.landmarks?.[0] ?? null;
  updateLightingPlaceholder();

  if (!raw || raw.length !== 33) {
    if (qualityText) qualityText.textContent = "NO POSE";
    setMode("camera");
    S.startGateOkSince = null;
    btnStartTest.disabled = true;
    S.rafId = requestAnimationFrame(loop);
    return;
  }

  const lms = smoothLandmarks(raw);

  drawSkeleton(lms, w, h);
  updateDistancePrompt(lms);

  // UI
  if (sideText) sideText.textContent = S.selectedSide.toUpperCase();

  const okPose = poseOk(lms);

  // Ready gate
  if (S.mode === "camera") {
    if (okPose) {
      if (S.startGateOkSince == null) S.startGateOkSince = now;
      if (now - S.startGateOkSince >= CFG.START_STABLE_MS) {
        setMode("ready");
        btnStartTest.disabled = false;
        setStage("Ready (pose OK)");
      } else {
        setStage("Hold still…");
      }
    } else {
      S.startGateOkSince = null;
      btnStartTest.disabled = true;
      setStage("Show full body + feet + hands");
    }
  }

  // Countdown
  if (S.mode === "countdown") {
    const remain = CFG.COUNTDOWN_MS - (now - S.countdownStartMs);
    if (remain > 0) {
      setStage(`Starts in ${Math.ceil(remain / 1000)}…`);
    } else {
      // start attempt window fresh
      S.dn = null;
      S.bestDn = null;
      S.lastDn = null;
      S.holdStartMs = null;

      S.comp.flagged = false;
      S.comp.reasons = [];
      S.comp.snapshotDataUrl = null;
      S.comp.samples = [];

      setMode("tracking");
      setStage("Tracking");
    }
  }

  // Tracking
  if (S.mode === "tracking") {
    const side = S.selectedSide;

    const kneeDeg = kneeAngle(lms, side);
    S.currentKneeDeg = kneeDeg;
    if (kneeText) kneeText.textContent = Number.isFinite(kneeDeg) ? kneeDeg.toFixed(0) : "—";

    const { dn, why } = computeReachNormalized(lms, side, w, h);
    S.dn = Number.isFinite(dn) ? dn : null;

    // show "reach" as normalized (not cm)
    if (reachCurrentText) reachCurrentText.textContent = Number.isFinite(dn) ? fmt(dn, 2) : "—";
    if (Number.isFinite(dn)) {
      S.bestDn = (S.bestDn == null) ? dn : Math.max(S.bestDn, dn);
      if (reachBestText) reachBestText.textContent = fmt(S.bestDn, 2);
    }

    const held = updateHold(dn, now);

    // Compensation detection (flag once; fail the leg)
    const comp = checkCompensation(lms, w, h, dn, kneeDeg);
    if (comp.isComp && !S.comp.flagged) {
      S.comp.flagged = true;
      S.comp.reasons = comp.reasons;

      // capture immediately
      S.comp.snapshotDataUrl = captureSnapshot("compensation");

      ui(`⚠ Compensation detected → auto-fail: ${comp.reasons.join(", ")}`);
    }

    const kneeOK = Number.isFinite(kneeDeg) && kneeDeg >= CFG.KNEE_EXTENDED_DEG;
    const canRecord =
      (Number.isFinite(dn)) &&
      (!CFG.REQUIRE_KNEE_EXTENDED_FOR_RECORD || kneeOK);

    btnRecord.disabled = !canRecord;

    const scoreNow = S.comp.flagged ? -1 : scoreFromDn(dn);

    if (qualityText) {
      qualityText.textContent =
        `pose:${okPose ? "OK" : "LOW"} • why:${why} • score:${scoreNow ?? "—"} • knee:${Number.isFinite(kneeDeg) ? kneeDeg.toFixed(0) : "—"}`;
    }

    if (warningText) {
      if (S.comp.flagged) {
        warningText.textContent = `COMPENSATION FLAGGED → score will be -1. (${S.comp.reasons.join(", ")}) Snapshot captured.`;
      } else if (CFG.REQUIRE_KNEE_EXTENDED_FOR_RECORD && Number.isFinite(kneeDeg) && kneeDeg < CFG.KNEE_EXTENDED_DEG) {
        warningText.textContent = `Knee not extended (need ≥ ${CFG.KNEE_EXTENDED_DEG}°).`;
      } else {
        warningText.textContent =
          `Score preview: ${scoreNow}  | Hold ${CFG.AUTO_RECORD_HOLD_SEC}s for auto-record or press Record.`;
      }
    }

    // Auto record after stable hold
    const canAuto =
      canRecord &&
      held >= CFG.AUTO_RECORD_HOLD_SEC &&
      (Date.now() - S.lastAutoRecordAt) > CFG.AUTO_RECORD_COOLDOWN_MS;

    if (canAuto) {
      S.lastAutoRecordAt = Date.now();
      // avoid spamming same side repeatedly
      if (!(S.lastRecorded.side === side && S.lastRecorded.score === scoreNow)) {
        recordResult("auto");
      }
    }
  }

  S.rafId = requestAnimationFrame(loop);
}

// =========================================================
// Events
// =========================================================
btnStartCam.addEventListener("click", startCamera);
btnStopCam.addEventListener("click", stopCamera);
btnStartTest.addEventListener("click", startTest);
btnRecord.addEventListener("click", () => recordResult("manual"));

formEl?.addEventListener("submit", (e) => {
  e.preventDefault();
  ui("Submitted (frontend). Backend can be connected.");
});

// Init
ensureOverlayStacking();
injectSideControls();
setMode("idle");
resetRun();
setBadge("Ready");
setStage("Not started");