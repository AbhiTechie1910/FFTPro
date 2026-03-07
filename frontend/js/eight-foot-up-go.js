import { PoseLandmarker, FilesetResolver } from
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

console.log("eight-foot-up-go.js loaded ✅");

/* =========================================================
   8-Foot Up & Go — Side view (Web) — Production version

   Key requirements implemented:
   - Floor-only selectable reference points (A..Z)
   - Uniform point style (same shape/size)
   - After selecting START + TURN, points are tracked if camera shifts
   - Strict start: must be sitting at START
   - Strict end: must be sitting back down at START
   - Compensations: snapshot + logged, do NOT pause timer
========================================================= */

const CFG = {
  // MediaPipe
  MODEL_URL:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  NUM_POSES: 2,
  VIS_THRESH: 0.25,

  // UI
  MIRROR_VIEW: false,

  // Pose smoothing / anti-flicker
  HOLD_LAST_POSE_MS: 200,
  SMOOTH_ALPHA: 0.35,
  SMOOTH_HOLD_MS: 250,

  // Floor ROI (normalized y range) — ONLY generate points here
  FLOOR_Y_MIN: 0.55,   // top of floor band
  FLOOR_Y_MAX: 0.98,   // bottom

  // Feature point extraction
  FP_SAMPLE_MS: 450,
  FP_W: 180,              // downscale for speed
  FP_MAX_POINTS: 20,      // fewer, higher-quality points
  HARRIS_K: 0.04,
  HARRIS_THRESH: 3.0e-5,
  NONMAX_RADIUS: 7,

  // Click selection
  PICK_RADIUS_PX: 18,

  // Point tracking after selection (camera shift tolerance)
  TRACK_SEARCH_PX: 18,    // search radius in downscaled frame
  TRACK_PATCH_PX: 9,      // half patch size (patch = (2r+1)^2)
  TRACK_MIN_SCORE: 0.65,  // 0..1, higher = stricter
  TRACK_REFRESH_MS: 120,  // how often to update tracking

  // Test
  COUNTDOWN_MS: 3000,
  MAX_TEST_SEC_DEFAULT: 60,

  // Distance thresholds based on AB pixel length
  AT_POINT_FRAC: 0.18,
  LEAVE_START_FRAC: 0.35,

  // Sit/stand detection (knee-only, side view)
  STAND_KNEE_MIN: 160,
  SIT_KNEE_MAX: 125,
  KNEE_EMA_ALPHA: 0.35,
  STATE_DEBOUNCE_MS: 200,

  // Compensation flags (snapshot only)
  TRUNK_LEAN_DEG: 22,
  LATERAL_SWAY_FRAC: 0.12,  // relative to AB length
  ARM_SWING_SPEED: 0.020,   // normalized/sec
  WRIST_VIS_THRESH: 0.15,
  HAND_NEAR_KNEE: 0.09,
  HAND_NEAR_HIP: 0.10,

  SNAP_COOLDOWN_MS: 900,

  // Drawing
  SKEL_LINE_W: 2,
  SKEL_DOT_R: 3,
  FP_DOT_R: 5, // uniform points
};

// BlazePose indices
const L_SHOULDER = 11, R_SHOULDER = 12;
const L_ELBOW = 13, R_ELBOW = 14;
const L_WRIST = 15, R_WRIST = 16;
const L_HIP = 23, R_HIP = 24;
const L_KNEE = 25, R_KNEE = 26;
const L_ANKLE = 27, R_ANKLE = 28;

const POSE_CONNECTIONS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32], [27, 29], [28, 30], [29, 31], [30, 32],
];

// DOM
const $ = (id) => document.getElementById(id);

const videoEl = $("cameraFeed");
const canvasEl = $("overlayCanvas");
const ctx = canvasEl.getContext("2d");

const frameCanvas = $("frameCanvas");
const fctx = frameCanvas.getContext("2d", { willReadFrequently: true });

const btnStartCam = $("startCameraBtn");
const btnStopCam = $("stopCameraBtn");
const btnStartTest = $("startTestBtn");
const btnResetPoints = $("resetPointsBtn");

const camStatusEl = $("camStatus");
const selText = $("selText");
const phaseText = $("phaseText");
const timeText = $("timeText");
const flagText = $("flagText");
const qualityText = $("qualityText");
const msgBox = $("msgBox");

const snapCountEl = $("snapCount");
const snapStrip = $("snapStrip");

const testDurationHidden = $("testDurationSec");
const lapTimeInput = $("lapTime");
const notesInput = $("notes");
const resultForm = $("resultForm");

// ---------- Helpers ----------
function vis(p) { return (p?.visibility ?? 1.0); }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function avg(a, b) { return (a + b) / 2; }
function nowMs() { return performance.now(); }
function fmtSec(ms) { return (ms / 1000).toFixed(2); }

function ui(msg) { if (msgBox) msgBox.textContent = msg; }

function setMode(m) {
  S.mode = m;
  if (camStatusEl) camStatusEl.textContent = (m === "idle") ? "Ready" : m.toUpperCase();
  btnStartTest.disabled = !(m === "ready");
}

function labelForIndex(i) { return String.fromCharCode(65 + i); } // A..Z

function applyMirrorCSS() {
  const t = CFG.MIRROR_VIEW ? "scaleX(-1)" : "none";
  videoEl.style.transform = t;
  canvasEl.style.transform = t;
  videoEl.style.transformOrigin = "center";
  canvasEl.style.transformOrigin = "center";
}

function ensureOverlayStacking() {
  const shell = videoEl.parentElement;
  shell.style.position = "relative";

  videoEl.style.display = "block";
  videoEl.style.width = "100%";
  videoEl.style.height = "auto";
  videoEl.style.objectFit = "contain";

  canvasEl.style.position = "absolute";
  canvasEl.style.left = "0";
  canvasEl.style.top = "0";
  canvasEl.style.width = "100%";
  canvasEl.style.height = "100%";
  canvasEl.style.pointerEvents = "auto";
  canvasEl.style.zIndex = "5";

  applyMirrorCSS();
}

// ---------- Canvas resize (stable) ----------
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
  }
  return { w: vw, h: vh };
}

// ---------- Pose utilities ----------
function angleDeg(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (mag < 1e-6) return NaN;
  const cos = clamp(dot / mag, -1, 1);
  return Math.acos(cos) * (180 / Math.PI);
}

function hipCenter(lms) {
  return { x: avg(lms[L_HIP].x, lms[R_HIP].x), y: avg(lms[L_HIP].y, lms[R_HIP].y) };
}

function kneeAngleAvg(lms) {
  const l = angleDeg(lms[L_HIP], lms[L_KNEE], lms[L_ANKLE]);
  const r = angleDeg(lms[R_HIP], lms[R_KNEE], lms[R_ANKLE]);
  const k = avg((l || 0), (r || 0));
  return Number.isFinite(k) ? k : NaN;
}

function ema(prev, x, a) {
  if (!Number.isFinite(x)) return prev;
  if (prev == null) return x;
  return a * x + (1 - a) * prev;
}

function postureStateFromKnee(kneeEma) {
  if (!Number.isFinite(kneeEma)) return "unknown";
  if (kneeEma >= CFG.STAND_KNEE_MIN) return "standing";
  if (kneeEma <= CFG.SIT_KNEE_MAX) return "sitting";
  return "transit";
}

function trunkLeanDeg(lms) {
  const hip = hipCenter(lms);
  const sh = { x: avg(lms[L_SHOULDER].x, lms[R_SHOULDER].x), y: avg(lms[L_SHOULDER].y, lms[R_SHOULDER].y) };
  const vx = sh.x - hip.x;
  const vy = sh.y - hip.y;
  const mag = Math.hypot(vx, vy);
  if (mag < 1e-6) return 0;
  const cos = clamp(((-vy) / mag), -1, 1);
  return Math.acos(cos) * (180 / Math.PI);
}

function normDist(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.hypot(dx, dy);
}

function wrists(lms) {
  const out = [];
  const lw = lms[L_WRIST], rw = lms[R_WRIST];
  if (lw && vis(lw) >= CFG.WRIST_VIS_THRESH) out.push(lw);
  if (rw && vis(rw) >= CFG.WRIST_VIS_THRESH) out.push(rw);
  return out;
}

function detectHandsSupport(lms) {
  const ws = wrists(lms);
  if (!ws.length) return false;
  const targets = [lms[L_KNEE], lms[R_KNEE], lms[L_HIP], lms[R_HIP]].filter(Boolean);
  for (const w of ws) {
    for (const t of targets) {
      const d = normDist(w, t);
      const isKnee = (t === lms[L_KNEE] || t === lms[R_KNEE]);
      if (isKnee && d < CFG.HAND_NEAR_KNEE) return true;
      if (!isKnee && d < CFG.HAND_NEAR_HIP) return true;
    }
  }
  return false;
}

function detectArmSwing(lms, now) {
  const check = (idx, key) => {
    const p = lms[idx];
    if (!p || vis(p) < CFG.WRIST_VIS_THRESH) return false;
    const prev = S.armPrev[key];
    if (!prev) { S.armPrev[key] = { x: p.x, y: p.y, t: now }; return false; }
    const dt = Math.max(1, now - prev.t);
    const speed = Math.hypot(p.x - prev.x, p.y - prev.y) / (dt / 1000);
    S.armPrev[key] = { x: p.x, y: p.y, t: now };
    return speed > CFG.ARM_SWING_SPEED;
  };
  return check(L_WRIST, "lw") || check(R_WRIST, "rw");
}

// Smooth landmarks (EMA + hold)
function smoothLandmarks(lms, now) {
  const out = new Array(33);
  for (let i = 0; i < 33; i++) {
    const p = lms[i];
    const prev = S.smoothPts[i];
    const lastT = S.smoothT[i];

    if (p) {
      if (!prev) {
        S.smoothPts[i] = { x: p.x, y: p.y, v: (p.visibility ?? 1) };
      } else {
        const a = CFG.SMOOTH_ALPHA;
        S.smoothPts[i] = {
          x: a * p.x + (1 - a) * prev.x,
          y: a * p.y + (1 - a) * prev.y,
          v: Math.max(prev.v * 0.85, (p.visibility ?? 1)),
        };
      }
      S.smoothT[i] = now;
      out[i] = S.smoothPts[i];
    } else if (prev && (now - lastT) <= CFG.SMOOTH_HOLD_MS) {
      out[i] = prev;
    } else {
      out[i] = null;
      S.smoothPts[i] = null;
    }
  }
  return out;
}

function poseOk(lms) {
  const idx = [L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, L_KNEE, R_KNEE, L_ANKLE, R_ANKLE];
  return idx.every(i => lms[i] && vis(lms[i]) >= CFG.VIS_THRESH);
}

function drawSkeleton(lms, w, h) {
  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = "rgba(0, 140, 255, 1)";
  ctx.lineWidth = CFG.SKEL_LINE_W;

  ctx.beginPath();
  for (const [a, b] of POSE_CONNECTIONS) {
    const p1 = lms[a], p2 = lms[b];
    if (!p1 || !p2) continue;
    ctx.moveTo(p1.x * w, p1.y * h);
    ctx.lineTo(p2.x * w, p2.y * h);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,1)";
  for (let i = 0; i < 33; i++) {
    const p = lms[i];
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, CFG.SKEL_DOT_R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------- Floor-only feature points (Harris) ----------
function toGray(imgData) {
  const { data, width, height } = imgData;
  const g = new Float32Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    g[j] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  return g;
}

function convolveSobel(gray, w, h) {
  const ix = new Float32Array(w * h);
  const iy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = gray[(y - 1) * w + (x - 1)];
      const b = gray[(y - 1) * w + x];
      const c = gray[(y - 1) * w + (x + 1)];
      const d = gray[y * w + (x - 1)];
      const f = gray[y * w + (x + 1)];
      const g = gray[(y + 1) * w + (x - 1)];
      const h1 = gray[(y + 1) * w + x];
      const i1 = gray[(y + 1) * w + (x + 1)];
      const gx = (-a + c) + (-2 * d + 2 * f) + (-g + i1);
      const gy = (-a - 2 * b - c) + (g + 2 * h1 + i1);
      ix[i] = gx;
      iy[i] = gy;
    }
  }
  return { ix, iy };
}

function harrisCorners(gray, w, h) {
  const { ix, iy } = convolveSobel(gray, w, h);
  const ixx = new Float32Array(w * h);
  const iyy = new Float32Array(w * h);
  const ixy = new Float32Array(w * h);

  for (let i = 0; i < w * h; i++) {
    const gx = ix[i], gy = iy[i];
    ixx[i] = gx * gx;
    iyy[i] = gy * gy;
    ixy[i] = gx * gy;
  }

  const blur3 = (src) => {
    const out = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let sum = 0;
        for (let yy = -1; yy <= 1; yy++) {
          for (let xx = -1; xx <= 1; xx++) sum += src[(y + yy) * w + (x + xx)];
        }
        out[y * w + x] = sum / 9;
      }
    }
    return out;
  };

  const sxx = blur3(ixx);
  const syy = blur3(iyy);
  const sxy = blur3(ixy);

  const R = new Float32Array(w * h);
  const k = CFG.HARRIS_K;

  for (let i = 0; i < w * h; i++) {
    const a = sxx[i], b = sxy[i], c = syy[i];
    const det = a * c - b * b;
    const trace = a + c;
    R[i] = det - k * trace * trace;
  }

  const pts = [];
  const yMin = Math.floor(CFG.FLOOR_Y_MIN * h);
  const yMax = Math.floor(CFG.FLOOR_Y_MAX * h);

  for (let y = Math.max(2, yMin); y < Math.min(h - 2, yMax); y++) {
    for (let x = 2; x < w - 2; x++) {
      const r = R[y * w + x];
      if (r > CFG.HARRIS_THRESH) pts.push({ x, y, r });
    }
  }

  pts.sort((p, q) => q.r - p.r);

  const kept = [];
  const rad2 = CFG.NONMAX_RADIUS * CFG.NONMAX_RADIUS;

  for (const p of pts) {
    let ok = true;
    for (const kpt of kept) {
      const dx = p.x - kpt.x;
      const dy = p.y - kpt.y;
      if (dx * dx + dy * dy < rad2) { ok = false; break; }
    }
    if (ok) kept.push(p);
    if (kept.length >= CFG.FP_MAX_POINTS) break;
  }

  return kept;
}

function refreshFeaturePoints(now, vw, vh) {
  if (now - S.fpLastSampleMs < CFG.FP_SAMPLE_MS) return;

  const tw = CFG.FP_W;
  const th = Math.round((vh / vw) * tw) || 120;

  frameCanvas.width = tw;
  frameCanvas.height = th;
  fctx.drawImage(videoEl, 0, 0, tw, th);

  const img = fctx.getImageData(0, 0, tw, th);
  S.gray = toGray(img);
  S.fpW = tw;
  S.fpH = th;

  const corners = harrisCorners(S.gray, tw, th);
  S.fp = corners.map((p, i) => ({
    id: i,
    label: labelForIndex(i),
    nx: p.x / tw,
    ny: p.y / th,
    px: p.x, // in FP space
    py: p.y,
    r: p.r,
  }));

  S.fpLastSampleMs = now;
}

function drawFeaturePoints(w, h) {
  ctx.save();
  ctx.globalAlpha = 0.95;

  // uniform style
  for (const p of S.fp) {
    const x = p.nx * w;
    const y = p.ny * h;

    ctx.fillStyle = "rgba(255, 215, 0, 0.95)";
    ctx.beginPath();
    ctx.arc(x, y, CFG.FP_DOT_R, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "14px Arial";
    ctx.fillStyle = "rgba(0,0,0,0.9)";
    ctx.fillText(p.label, x + 7, y - 7);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(p.label, x + 6, y - 8);
  }

  // highlight selections
  const hl = (sel, color) => {
    if (!sel) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sel.nx * w, sel.ny * h, 12, 0, Math.PI * 2);
    ctx.stroke();
  };
  hl(S.selA, "rgba(0,255,0,1)");
  hl(S.selB, "rgba(255,0,0,1)");

  // AB line
  if (S.selA && S.selB) {
    ctx.strokeStyle = "rgba(255,0,0,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(S.selA.nx * w, S.selA.ny * h);
    ctx.lineTo(S.selB.nx * w, S.selB.ny * h);
    ctx.stroke();
  }

  ctx.restore();
}

function nearestFeaturePoint(clickNx, clickNy) {
  if (!S.fp.length) return null;

  const rect = canvasEl.getBoundingClientRect();
  const rx = CFG.PICK_RADIUS_PX / rect.width;
  const ry = CFG.PICK_RADIUS_PX / rect.height;

  let best = null, bestD = Infinity;
  for (const p of S.fp) {
    const dx = (p.nx - clickNx) / rx;
    const dy = (p.ny - clickNy) / ry;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = p; }
  }
  return (best && bestD <= 1.0) ? best : null;
}

// ---------- Tracking selected points if camera moves ----------
function patchScore(gray, w, h, cx, cy, refPatch, r) {
  // cosine similarity-ish on mean-normalized patch
  let sum = 0, sumA = 0, sumB = 0;
  let sumAA = 0, sumBB = 0;

  let k = 0;
  for (let yy = -r; yy <= r; yy++) {
    for (let xx = -r; xx <= r; xx++) {
      const x = cx + xx, y = cy + yy;
      const idx = y * w + x;
      const a = refPatch[k++];
      const b = gray[idx];
      sumA += a; sumB += b;
    }
  }

  const n = (2 * r + 1) * (2 * r + 1);
  const meanA = sumA / n;
  const meanB = sumB / n;

  k = 0;
  for (let yy = -r; yy <= r; yy++) {
    for (let xx = -r; xx <= r; xx++) {
      const x = cx + xx, y = cy + yy;
      const idx = y * w + x;
      const a = refPatch[k++] - meanA;
      const b = gray[idx] - meanB;
      sum += a * b;
      sumAA += a * a;
      sumBB += b * b;
    }
  }

  const denom = Math.sqrt(sumAA * sumBB) + 1e-9;
  return sum / denom; // -1..1
}

function extractPatch(gray, w, h, cx, cy, r) {
  const out = new Float32Array((2 * r + 1) * (2 * r + 1));
  let k = 0;
  for (let yy = -r; yy <= r; yy++) {
    for (let xx = -r; xx <= r; xx++) {
      out[k++] = gray[(cy + yy) * w + (cx + xx)];
    }
  }
  return out;
}

function canPatch(w, h, cx, cy, r) {
  return cx - r >= 0 && cy - r >= 0 && cx + r < w && cy + r < h;
}

function trackSelectedPoint(sel, now) {
  if (!sel || !S.gray) return sel;
  if (!sel.refPatch) return sel;
  if (now - sel.lastTrackMs < CFG.TRACK_REFRESH_MS) return sel;

  const w = S.fpW, h = S.fpH;
  const r = CFG.TRACK_PATCH_PX;
  const R = CFG.TRACK_SEARCH_PX;

  const cx0 = sel.px | 0;
  const cy0 = sel.py | 0;

  let best = { s: -1, x: cx0, y: cy0 };

  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const cx = cx0 + dx;
      const cy = cy0 + dy;
      if (!canPatch(w, h, cx, cy, r)) continue;

      const s = patchScore(S.gray, w, h, cx, cy, sel.refPatch, r);
      if (s > best.s) best = { s, x: cx, y: cy };
    }
  }

  // update if match is good
  if (best.s >= CFG.TRACK_MIN_SCORE) {
    sel.px = best.x;
    sel.py = best.y;
    sel.nx = best.x / w;
    sel.ny = best.y / h;
  }

  sel.lastTrackMs = now;
  return sel;
}

function lockSelection(sel) {
  // after click, lock a reference patch for tracking
  if (!S.gray) return sel;
  const w = S.fpW, h = S.fpH;
  const r = CFG.TRACK_PATCH_PX;

  const cx = sel.px | 0;
  const cy = sel.py | 0;

  if (!canPatch(w, h, cx, cy, r)) return sel;
  sel.refPatch = extractPatch(S.gray, w, h, cx, cy, r);
  sel.lastTrackMs = -1e9;
  return sel;
}

// ---------- AB geometry ----------
function abLengthPx(vw, vh) {
  if (!S.selA || !S.selB) return 0;
  const ax = S.selA.nx * vw, ay = S.selA.ny * vh;
  const bx = S.selB.nx * vw, by = S.selB.ny * vh;
  return Math.hypot(ax - bx, ay - by);
}
function distToSelPx(ptN, sel, vw, vh) {
  const x = ptN.x * vw, y = ptN.y * vh;
  const tx = sel.nx * vw, ty = sel.ny * vh;
  return Math.hypot(x - tx, y - ty);
}

// ---------- Snapshots ----------
function addSnapshot(dataUrl) {
  S.snaps.push({ ts: Date.now(), dataUrl });
  if (snapCountEl) snapCountEl.textContent = String(S.snaps.length);

  if (snapStrip) {
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = "snapshot";
    img.style.width = "120px";
    img.style.borderRadius = "10px";
    img.style.border = "1px solid rgba(255,255,255,0.15)";
    snapStrip.prepend(img);
  }
}

function captureSnapshot(vw, vh) {
  const tw = Math.min(640, vw);
  const th = Math.round((vh / vw) * tw);

  frameCanvas.width = tw;
  frameCanvas.height = th;
  fctx.drawImage(videoEl, 0, 0, tw, th);

  addSnapshot(frameCanvas.toDataURL("image/png"));
}

// ---------- MediaPipe init ----------
async function initPose() {
  ui("Loading MediaPipe Pose…");
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  S.landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: CFG.MODEL_URL }, // delegate omitted
    runningMode: "VIDEO",
    numPoses: CFG.NUM_POSES,
  });

  ui("MediaPipe ready ✅");
}

// ---------- Camera ----------
async function startCamera() {
  try {
    ensureOverlayStacking();
    if (!S.landmarker) await initPose();

    ui("Requesting camera…");
    S.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    videoEl.srcObject = S.stream;
    videoEl.setAttribute("playsinline", "");
    videoEl.muted = true;

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Video metadata timeout")), 6000);
      videoEl.onloadedmetadata = () => { clearTimeout(t); resolve(); };
    });

    await videoEl.play();

    btnStartCam.disabled = true;
    btnStopCam.disabled = false;
    btnResetPoints.disabled = false;

    setMode("camera");
    resetRunOnly();
    setSelText();
    ui("Camera started. Click two FLOOR points A,B… (START then TURN).");
    loop();
  } catch (e) {
    console.error(e);
    ui(`❌ Camera failed: ${e?.name || ""} ${e?.message || e}`);
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
  btnResetPoints.disabled = true;

  resetAll();
  setMode("idle");
}

// ---------- Selection UI ----------
function setSelText() {
  const a = S.selA ? S.selA.label : "—";
  const b = S.selB ? S.selB.label : "—";
  if (selText) selText.textContent = `START: ${a} • TURN: ${b}`;
}

canvasEl.addEventListener("click", (e) => {
  if (S.mode === "idle") return;

  const rect = canvasEl.getBoundingClientRect();
  const nx0 = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  const nx = CFG.MIRROR_VIEW ? (1 - nx0) : nx0;

  const hit = nearestFeaturePoint(nx, ny);
  if (!hit) return;

  // Lock as selection (copy object so it doesn't depend on regenerated list)
  const sel = {
    label: hit.label,
    nx: hit.nx, ny: hit.ny,
    px: hit.px, py: hit.py,
    refPatch: null,
    lastTrackMs: -1e9
  };

  lockSelection(sel);

  if (!S.selA) S.selA = sel;
  else if (!S.selB && sel.label !== S.selA.label) S.selB = sel;
  else S.selB = sel; // replace B

  setSelText();
  ui("Selection locked. If camera moves slightly, points will track.");

  // readiness is gated by pose + both points
});

btnResetPoints.addEventListener("click", () => {
  S.selA = null;
  S.selB = null;
  setSelText();
  btnStartTest.disabled = true;
  ui("Points reset. Select START then TURN again.");
});

// ---------- Test ----------
function getMaxTestMs() {
  const s = parseInt(testDurationHidden?.value || "", 10);
  if (Number.isFinite(s) && s > 0) return s * 1000;
  return CFG.MAX_TEST_SEC_DEFAULT * 1000;
}

function startTest() {
  if (!S.selA || !S.selB) return ui("Pick START + TURN points first.");
  if (S.mode !== "ready") return;

  S.countdownStartMs = nowMs();
  setMode("countdown");
  ui("Get ready…");
}

btnStartTest.addEventListener("click", startTest);

// ---------- Finish ----------
function finishTest() {
  setMode("done");
  const tSec = Number((S.run.elapsedMs / 1000).toFixed(2));
  const flags = Array.from(S.flags).join(", ");

  if (lapTimeInput) lapTimeInput.value = String(tSec);
  if (notesInput) notesInput.value = flags;

  if (phaseText) phaseText.textContent = "DONE";
  if (timeText) timeText.textContent = String(tSec);
  if (flagText) flagText.textContent = flags || "—";

  ui(`Finished: ${tSec}s`);
}

// ---------- Main loop ----------
function loop() {
  const now = nowMs();
  const { w: vw, h: vh } = resizeCanvasToVideo();

  if (!vw || !vh || !S.landmarker || videoEl.readyState < 2) {
    S.rafId = requestAnimationFrame(loop);
    return;
  }

  ctx.clearRect(0, 0, vw, vh);

  // refresh feature points (floor-only)
  refreshFeaturePoints(now, vw, vh);

  // track selected points (camera moved)
  if (S.selA) S.selA = trackSelectedPoint(S.selA, now);
  if (S.selB) S.selB = trackSelectedPoint(S.selB, now);

  drawFeaturePoints(vw, vh);

  const res = S.landmarker.detectForVideo(videoEl, now);
  const poses = res?.landmarks ?? [];
  let lmsRaw = poses[0] ?? null;

  // hold last pose
  if (lmsRaw && lmsRaw.length === 33) { S.lastGoodLms = lmsRaw; S.lastGoodMs = now; }
  else if (S.lastGoodLms && (now - S.lastGoodMs) <= CFG.HOLD_LAST_POSE_MS) lmsRaw = S.lastGoodLms;

  if (!lmsRaw || lmsRaw.length !== 33) {
    if (qualityText) qualityText.textContent = "NO POSE";
    if (S.mode !== "idle") setMode("camera");
    btnStartTest.disabled = true;
    S.startGateOkSince = null;
    S.rafId = requestAnimationFrame(loop);
    return;
  }

  const lms = smoothLandmarks(lmsRaw, now);
  drawSkeleton(lms, vw, vh);

  const ok = poseOk(lms);
  if (qualityText) qualityText.textContent = ok ? "poseOK" : "poseLOW";

  // Ready gate: pose + both points selected
  if (S.mode === "camera") {
    if (ok && S.selA && S.selB) {
      if (S.startGateOkSince == null) S.startGateOkSince = now;
      if (now - S.startGateOkSince >= 700) {
        setMode("ready");
        ui("Ready. Press Start Test. Patient must be SITTING at START.");
      }
    } else {
      S.startGateOkSince = null;
      btnStartTest.disabled = true;
    }
  }

  // Countdown -> running
  if (S.mode === "countdown") {
    const remain = CFG.COUNTDOWN_MS - (now - S.countdownStartMs);
    if (remain > 0) {
      if (phaseText) phaseText.textContent = "COUNTDOWN";
      if (timeText) timeText.textContent = `Starts in ${Math.ceil(remain / 1000)}…`;
    } else {
      setMode("running");
      resetRunOnly();
      S.run.startedAtMs = now;
      S.run.phase = "WAIT_SIT_AT_START";
      ui("Running… Must start sitting at START.");
    }
  }

  // Running phases
  if (S.mode === "running") {
    const abPx = abLengthPx(vw, vh);
    if (!abPx) { setMode("camera"); ui("AB invalid. Pick points again."); return; }

    const hip = hipCenter(lms);
    const dStart = distToSelPx(hip, S.selA, vw, vh);
    const dTurn = distToSelPx(hip, S.selB, vw, vh);

    const atStart = dStart <= CFG.AT_POINT_FRAC * abPx;
    const atTurn = dTurn <= CFG.AT_POINT_FRAC * abPx;
    const leftStart = dStart >= CFG.LEAVE_START_FRAC * abPx;

    // knee posture
    const kneeRaw = kneeAngleAvg(lms);
    S.run.kneeEma = ema(S.run.kneeEma, kneeRaw, CFG.KNEE_EMA_ALPHA);
    const posture = postureStateFromKnee(S.run.kneeEma);

    // time
    S.run.elapsedMs = now - S.run.startedAtMs;
    if (timeText) timeText.textContent = fmtSec(S.run.elapsedMs);
    if (phaseText) phaseText.textContent = S.run.phase;

    // flags (do NOT pause)
    const flagsNow = [];
    const lean = trunkLeanDeg(lms);
    if (lean > CFG.TRUNK_LEAN_DEG) { S.flags.add("trunk_lean"); flagsNow.push("trunk lean"); }

    if (S.run.hipBaseX == null) S.run.hipBaseX = hip.x;
    const lateralPx = Math.abs((hip.x - S.run.hipBaseX) * vw);
    if (lateralPx > CFG.LATERAL_SWAY_FRAC * abPx) { S.flags.add("lateral_sway"); flagsNow.push("lateral sway"); }

    if (detectArmSwing(lms, now)) { S.flags.add("arm_swing"); flagsNow.push("arm swing"); }

    if (detectHandsSupport(lms)) { S.flags.add("hands_support"); flagsNow.push("hands support"); }

    // snapshot on any new flagged moment (cooldown)
    if (flagsNow.length && (now - S.run.lastSnapMs) > CFG.SNAP_COOLDOWN_MS) {
      S.run.lastSnapMs = now;
      captureSnapshot(vw, vh);
    }

    if (flagText) flagText.textContent = flagsNow.length ? `⚠ ${flagsNow.join(" • ")}` : "—";

    // State machine (strict sit-start, strict sit-end)
    switch (S.run.phase) {
      case "WAIT_SIT_AT_START":
        if (atStart && posture === "sitting") {
          S.run.phase = "WAIT_STAND_AND_LEAVE";
          ui("Good. Stand and move towards TURN.");
        }
        break;

      case "WAIT_STAND_AND_LEAVE":
        if (posture === "standing" && leftStart) {
          S.run.phase = "REACH_TURN";
          ui("Heading to TURN…");
        }
        break;

      case "REACH_TURN":
        if (atTurn) {
          S.run.phase = "RETURN_START";
          ui("Reached TURN. Return to START.");
        }
        break;

      case "RETURN_START":
        if (atStart) {
          S.run.phase = "WAIT_SIT_END";
          ui("Back at START. Sit down to finish.");
        }
        break;

      case "WAIT_SIT_END":
        if (atStart && posture === "sitting") {
          finishTest();
        }
        break;

      default:
        break;
    }

    // timeout
    if (S.run.elapsedMs >= getMaxTestMs()) {
      S.flags.add("timeout");
      finishTest();
    }
  }

  S.rafId = requestAnimationFrame(loop);
}

// ---------- Reset ----------
function resetRunOnly() {
  S.run = {
    startedAtMs: 0,
    elapsedMs: 0,
    phase: "—",
    kneeEma: null,
    hipBaseX: null,
    lastSnapMs: -1e9
  };
  S.flags = new Set();
  S.snaps = [];
  S.armPrev = { lw: null, rw: null };

  if (snapStrip) snapStrip.innerHTML = "";
  if (snapCountEl) snapCountEl.textContent = "0";

  if (timeText) timeText.textContent = "—";
  if (phaseText) phaseText.textContent = "—";
  if (flagText) flagText.textContent = "—";
}

function resetAll() {
  S.fp = [];
  S.fpLastSampleMs = -1e9;
  S.gray = null;
  S.fpW = 0; S.fpH = 0;

  S.selA = null; S.selB = null;
  setSelText();
  resetRunOnly();
}

btnStartCam.addEventListener("click", startCamera);
btnStopCam.addEventListener("click", stopCamera);

resultForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  ui("Submitted (frontend). Hook backend save if needed.");
});

// ---------- State ----------
const S = {
  stream: null,
  landmarker: null,
  rafId: null,
  mode: "idle",

  startGateOkSince: null,
  countdownStartMs: 0,

  lastGoodLms: null,
  lastGoodMs: 0,

  smoothPts: Array(33).fill(null),
  smoothT: Array(33).fill(0),

  fp: [],
  fpLastSampleMs: -1e9,
  gray: null,
  fpW: 0,
  fpH: 0,

  selA: null,
  selB: null,

  run: { startedAtMs: 0, elapsedMs: 0, phase: "—", kneeEma: null, hipBaseX: null, lastSnapMs: -1e9 },
  flags: new Set(),
  snaps: [],
  armPrev: { lw: null, rw: null },
};

ensureOverlayStacking();
setMode("idle");
resetAll();
ui("Loaded ✅ Start Camera.");