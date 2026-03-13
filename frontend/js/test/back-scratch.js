/* =========================================================
   FFTPro — Back Scratch Test (Automated 5s, Elbow-flex gate)
   Rules:
   - Start 5s window only when:
       (1) posture is valid (BOTH elbows < 90° + side positioning)
       (2) 2 hands detected
   - If touch/overlap occurs -> finish immediately with 0/+1
   - If still gap at 5s -> finish with -1
   ========================================================= */

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function toPixel(pt, w, h) {
  return { x: pt.x * w, y: pt.y * h, z: pt.z ?? 0, v: pt.visibility ?? 1 };
}
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

// ------------------------------
// Pose skeleton connections (minimal, stable)
// ------------------------------
const POSE_CONNECTIONS = [
  [11,12],[11,23],[12,24],[23,24],
  [11,13],[13,15],
  [12,14],[14,16],
  [23,25],[25,27],
  [24,26],[26,28],
];

// ------------------------------
// Overlap heuristic (middle finger axis test)
// Hands landmarks: middle MCP=9, middle TIP=12
// ------------------------------
function vsub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) }; }
function vdot(a, b) { return a.x * b.x + a.y * b.y + (a.z ?? 0) * (b.z ?? 0); }
function vlen(a) { return Math.hypot(a.x, a.y, a.z ?? 0); }
function vscale(a, s) { return { x: a.x * s, y: a.y * s, z: (a.z ?? 0) * s }; }

function perpDistancePointToRay(point, rayOrigin, rayDirUnit) {
  const op = { x: point.x - rayOrigin.x, y: point.y - rayOrigin.y, z: 0 };
  const proj = op.x * rayDirUnit.x + op.y * rayDirUnit.y;
  const closest = { x: rayOrigin.x + proj * rayDirUnit.x, y: rayOrigin.y + proj * rayDirUnit.y };
  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

function detectOverlap(handA, handB, imgW, imgH, params) {
  const { overlapMarginNorm, overlapPerpMaxNorm } = params;

  const B_mcp = toPixel(handB[9], imgW, imgH);
  const B_tip = toPixel(handB[12], imgW, imgH);
  const A_tip = toPixel(handA[12], imgW, imgH);

  const axis = vsub(B_tip, B_mcp);
  const axisLen = vlen(axis);
  if (axisLen < 1e-6) return false;
  const axisUnit = vscale(axis, 1 / axisLen);

  // Project A_tip onto B axis (MCP -> TIP)
  const vec = vsub(A_tip, B_mcp);
  const proj = vdot(vec, axisUnit); // in pixels along axis direction

  const perp = perpDistancePointToRay(A_tip, B_mcp, axisUnit);
  const perpMaxPx = overlapPerpMaxNorm * Math.min(imgW, imgH);
  const marginPx = overlapMarginNorm * Math.min(imgW, imgH);
  const onSegment = (proj >= -marginPx) && (proj <= axisLen + marginPx);
  const closeLaterally = (perp <= perpMaxPx);

  return onSegment && closeLaterally;
}

// ------------------------------
// DOM
// ------------------------------
const video = document.getElementById("camera");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");

const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnRestart = document.getElementById("btnRestart");

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");

const scoreBadge = document.getElementById("scoreBadge");
const distPxEl = document.getElementById("distPx");
const clsEl = document.getElementById("cls");
const postureEl = document.getElementById("posture");
const toast = document.getElementById("toast");
const timeLeftEl = document.getElementById("timeLeft");

const sideSel = document.getElementById("sideSel");
const patientIdEl = document.getElementById("patientId");

const lastResultEl = document.getElementById("lastResult");
const payloadEl = document.getElementById("payload");

// ------------------------------
// UI helpers
// ------------------------------
function setStatus(kind, text) {
  statusText.textContent = text;
  statusDot.classList.remove("good", "bad");
  if (kind === "good") statusDot.classList.add("good");
  if (kind === "bad") statusDot.classList.add("bad");
}

function setScore(score, cls) {
  scoreBadge.classList.remove("good", "warn", "bad");
  if (score === 1) scoreBadge.classList.add("good");
  else if (score === 0) scoreBadge.classList.add("warn");
  else if (score === -1) scoreBadge.classList.add("bad");
  else scoreBadge.classList.add("warn");

  scoreBadge.textContent = (score == null) ? "SCORE: —" : `SCORE: ${score}`;
  clsEl.textContent = cls ?? "—";
}

function nowMs() { return performance.now(); }

// ------------------------------
// Assessor
// ------------------------------
class BackScratchAssessor {
  constructor(cfg) {
    this.video = cfg.video;

    this.params = {
      // contact detection
      touchThresholdNorm: 0.020,
      overlapMarginNorm: 0.012,
      overlapPerpMaxNorm: 0.020,

      // gating
      minPoseVis: 0.55,

      // posture constraints
      // REQUIRE BOTH elbows flexed under 90°
      maxElbowAngleDeg: 90,

      // “over-shoulder” wrist should be above shoulder by a margin
      shoulderElevMarginNorm: 0.10,

      // trial automation
      trialMs: 5000,

      ...cfg.params
    };

    this._pose = null;
    this._hands = null;
    this._latestPose = null;
    this._latestHands = null;

    this._running = false;
    this._rafId = null;

    this._trial = {
      active: false,
      startTs: null,
      done: false,
      result: null
    };

    this.onUpdate = cfg.onUpdate ?? (() => {});
    this.onResult = cfg.onResult ?? (() => {});
    this.onError = cfg.onError ?? ((e) => console.error(e));
  }

  async init() {
    const PoseCtor = (window.Pose && (window.Pose.Pose || window.Pose)) || null;
    const HandsCtor = (window.Hands && (window.Hands.Hands || window.Hands)) || null;

    if (!PoseCtor) throw new Error("MediaPipe Pose not loaded.");
    if (!HandsCtor) throw new Error("MediaPipe Hands not loaded.");

    this._pose = new PoseCtor({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}` });
    this._pose.setOptions({
      modelComplexity: 2,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.75,
      minTrackingConfidence: 0.75
    });
    this._pose.onResults((res) => { this._latestPose = res; });

    this._hands = new HandsCtor({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    this._hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    this._hands.onResults((res) => { this._latestHands = res; });

    return this;
  }

  start() {
    if (!this._pose || !this._hands) throw new Error("Call init() before start().");
    this._running = true;

    const tick = async () => {
      if (!this._running) return;

      try {
        await this._pose.send({ image: this.video });
        await this._hands.send({ image: this.video });
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
    this.resetTrial();
  }

  resetTrial() {
    this._trial.active = false;
    this._trial.startTs = null;
    this._trial.done = false;
    this._trial.result = null;
  }

  _compute() {
    const pose = this._latestPose;
    const hands = this._latestHands;

    const imgW = this.video.videoWidth || 1280;
    const imgH = this.video.videoHeight || 720;

    const pl = pose?.poseLandmarks || null;
    const hl = hands?.multiHandLandmarks || null;

    const side = sideSel.value;
    const has2Hands = !!(hl && hl.length >= 2);

    // ---- Posture validation (includes visibility + elbows < 90 + side positioning)
    let postureOk = false;
    let postureReason = "—";
    let elbowAngles = { L: null, R: null };

    if (pl && pl.length >= 33) {
      const LShould = toPixel(pl[11], imgW, imgH);
      const RShould = toPixel(pl[12], imgW, imgH);
      const LElbow = toPixel(pl[13], imgW, imgH);
      const RElbow = toPixel(pl[14], imgW, imgH);
      const LWrist = toPixel(pl[15], imgW, imgH);
      const RWrist = toPixel(pl[16], imgW, imgH);
      const LHip = toPixel(pl[23], imgW, imgH);
      const RHip = toPixel(pl[24], imgW, imgH);

      const visOk = [LShould, RShould, LElbow, RElbow, LWrist, RWrist, LHip, RHip]
        .every(p => (p.v ?? 1) >= this.params.minPoseVis);

      if (!visOk) {
        postureOk = false;
        postureReason = "Low landmark visibility (show shoulders, elbows, wrists).";
      } else {
        const LElbowAng = angleDeg(LShould, LElbow, LWrist);
        const RElbowAng = angleDeg(RShould, RElbow, RWrist);
        elbowAngles = { L: Math.round(LElbowAng), R: Math.round(RElbowAng) };

        // REQUIRE BOTH elbows < 90°
        const elbowFlexOk = (LElbowAng < this.params.maxElbowAngleDeg) && (RElbowAng < this.params.maxElbowAngleDeg);

        // side validation using wrists relative to shoulders
        const torsoH = Math.max(1, ((LHip.y + RHip.y) / 2) - ((LShould.y + RShould.y) / 2));
        const elevMargin = this.params.shoulderElevMarginNorm * torsoH;

        const overIsRight = (side === "R_over_L");
        const overWrist = overIsRight ? RWrist : LWrist;
        const overShould = overIsRight ? RShould : LShould;
        const upWrist = overIsRight ? LWrist : RWrist;

        const overAbove = (overShould.y - overWrist.y) > elevMargin;     // wrist higher than shoulder
        const upBelow = (upWrist.y - overShould.y) > elevMargin * 0.35;  // other wrist below shoulder line

        if (!elbowFlexOk) {
          postureOk = false;
          postureReason = `Bend both elbows < 90° (L:${elbowAngles.L}°, R:${elbowAngles.R}°).`;
        } else if (!overAbove) {
          postureOk = false;
          postureReason = "Over-shoulder arm not raised enough.";
        } else if (!upBelow) {
          postureOk = false;
          postureReason = "Up-the-back arm not positioned behind back.";
        } else {
          postureOk = true;
          postureReason = `Posture OK (L elbow ${elbowAngles.L}°, R elbow ${elbowAngles.R}°).`;
        }
      }
    } else {
      postureOk = false;
      postureReason = "No pose detected.";
    }

    // ---- Trial timer
    let timeLeftMs = null;
    if (this._trial.active && this._trial.startTs != null && !this._trial.done) {
      const elapsed = nowMs() - this._trial.startTs;
      timeLeftMs = Math.max(0, this.params.trialMs - elapsed);
    }

    // ---- Start trial only when posture + hands are OK
    if (!this._trial.done && !this._trial.active && postureOk && has2Hands) {
      this._trial.active = true;
      this._trial.startTs = nowMs();
      timeLeftMs = this.params.trialMs;
    }
// ---- Measurement
let cls = "—";
let score = null;
let distancePx = null;

if (has2Hands) {
  const h0 = hl[0];
  const h1 = hl[1];

  const t0 = toPixel(h0[12], imgW, imgH);
  const t1 = toPixel(h1[12], imgW, imgH);
  distancePx = Math.hypot(t0.x - t1.x, t0.y - t1.y);

  const touchThresholdPx = this.params.touchThresholdNorm * Math.min(imgW, imgH);

  const overlap01 = detectOverlap(h0, h1, imgW, imgH, this.params);
  const overlap10 = detectOverlap(h1, h0, imgW, imgH, this.params);
  const isOverlap = overlap01 || overlap10;

  if (isOverlap) {
    cls = "overlap";
    score = +1;
  } else if (distancePx <= touchThresholdPx) {
    cls = "touch";
    score = 0;
  } else {
    cls = "gap";
    score = -1; // provisional until timeout
  }
} else {
  cls = "need hands";
  score = null;
}
    // ---- Automation: complete immediately on touch/overlap, or timeout at 5s with -1
    if (this._trial.active && !this._trial.done) {
      const elapsed = nowMs() - this._trial.startTs;
      timeLeftMs = Math.max(0, this.params.trialMs - elapsed);

      if (has2Hands && (cls === "touch" || cls === "overlap")) {
        this._trial.done = true;
        this._trial.active = false;

        const payload = this._buildPayload({
          score,
          classification: cls,
          distancePx: distancePx != null ? Math.round(distancePx) : null,
          reason: "contact_detected"
        });

        this._trial.result = payload;
        this.onResult(payload);

      } else if (elapsed >= this.params.trialMs) {
        this._trial.done = true;
        this._trial.active = false;

        const payload = this._buildPayload({
          score: -1,
          classification: "gap",
          distancePx: distancePx != null ? Math.round(distancePx) : null,
          reason: "timeout_5s"
        });

        this._trial.result = payload;
        this.onResult(payload);
      }
    }

    this.onUpdate({
      poseLandmarks: pl,
      handsLandmarks: hl,

      postureOk,
      postureReason,
      elbowAngles,

      trialActive: this._trial.active,
      trialDone: this._trial.done,
      timeLeftMs,

      distancePx,
      classification: cls
    });
  }

  _buildPayload({ score, classification, distancePx, reason }) {
    const patientId = (patientIdEl.value || "").trim() || null;
    const side = sideSel.value;

    return {
      test: "BackScratch",
      patientId,
      side,
      timestamp: new Date().toISOString(),
      windowSec: 5,
      reason,
      score,
      classification,
      distancePx
    };
  }
}

// ------------------------------
// Overlay draw: skeleton + fingertip line
// ------------------------------
function drawOverlay(m) {
  const rect = video.getBoundingClientRect();
  overlay.width = Math.round(rect.width);
  overlay.height = Math.round(rect.height);
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const sx = overlay.width / vw;
  const sy = overlay.height / vh;

  // video mirrored in CSS => flip X in drawing
  const flipX = (x) => overlay.width - x;

  // skeleton
  const pl = m?.poseLandmarks;
  if (pl && pl.length >= 33) {
    const pts = pl.map(p => ({
      x: flipX((p.x * vw) * sx),
      y: (p.y * vh) * sy,
      v: p.visibility ?? 1
    }));

    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(77,163,255,.85)";
    for (const [a, b] of POSE_CONNECTIONS) {
      const pa = pts[a], pb = pts[b];
      if (!pa || !pb) continue;
      if ((pa.v ?? 1) < 0.2 || (pb.v ?? 1) < 0.2) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    // keypoints
    ctx.fillStyle = "rgba(255,255,255,.85)";
    for (const p of pts) {
      if ((p.v ?? 1) < 0.2) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // fingertips line
  const hl = m?.handsLandmarks;
  if (hl && hl.length >= 2) {
    const t0 = toPixel(hl[0][12], vw, vh);
    const t1 = toPixel(hl[1][12], vw, vh);

    const ax = flipX(t0.x * sx);
    const ay = t0.y * sy;
    const bx = flipX(t1.x * sx);
    const by = t1.y * sy;

    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(53,208,127,.9)";
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();

    const dot = (x, y, fill) => {
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
    };
    dot(ax, ay, "rgba(53,208,127,.95)");
    dot(bx, by, "rgba(255,204,102,.95)");
  }
}

// ------------------------------
// Camera wiring (robust)
// ------------------------------
let stream = null;
let assessor = null;

async function startCamera() {
  try {
    setStatus("good", "Starting...");
    toast.textContent = "Requesting camera permission...";

    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = stream;

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("onloadedmetadata timeout")), 5000);
      video.onloadedmetadata = () => { clearTimeout(t); resolve(); };
    });

    await video.play();

    assessor = new BackScratchAssessor({
      video,
      onUpdate: (m) => {
        if (!m.postureOk) {
          postureEl.textContent = "Fix posture";
          toast.textContent = m.postureReason;
          setStatus("bad", "Fix posture");
        } else {
          postureEl.textContent = "OK";
          toast.textContent = m.trialActive
            ? "Trial running… touch/overlap ends it automatically."
            : (m.trialDone ? "Done. Restart for next attempt." : "Ready. Trial will auto-start when both hands are detected + elbows < 90°.");
          setStatus("good", m.trialActive ? "Running (5s)" : (m.trialDone ? "Done" : "Arming…"));
        }

        const dist = (m.distancePx != null) ? Math.round(m.distancePx) : null;
        distPxEl.textContent = (dist == null) ? "—" : String(dist);

        timeLeftEl.textContent = (m.timeLeftMs == null) ? "—" : `${(m.timeLeftMs / 1000).toFixed(1)}s`;

        if (!m.trialDone) {
          if (m.classification === "overlap") setScore(+1, "overlap");
          else if (m.classification === "touch") setScore(0, "touch");
          else if (m.classification === "gap") setScore(null, "gap");
          else setScore(null, "—");
        }

        drawOverlay(m);

        btnStart.disabled = true;
        btnStop.disabled = false;
        btnRestart.disabled = false;
      },
      onResult: (payload) => {
        setScore(payload.score, payload.classification);
        lastResultEl.textContent = `${payload.classification.toUpperCase()} → score ${payload.score} (${payload.reason})`;
        payloadEl.textContent = JSON.stringify(payload, null, 2);
        toast.textContent = "Trial completed. Restart for another attempt.";
        setStatus("good", "Done");
      },
      onError: (e) => {
        console.error(e);
        setStatus("bad", "Error");
        toast.textContent = "MediaPipe error. Open console.";
      }
    });

    await assessor.init();
    assessor.start();

    setStatus("good", "Running");
    toast.textContent = "Bend BOTH elbows < 90°. Trial starts automatically when ready.";

  } catch (err) {
    console.error("CAMERA FAILURE:", err);
    setStatus("bad", "Blocked");
    const name = err?.name || "Error";
    const msg = err?.message || String(err);
    alert(`Camera failed:\n${name}\n${msg}\n\nUse https/localhost and allow camera permission.`);
    toast.textContent = `${name}: ${msg}`;
  }
}

function stopCamera() {
  if (assessor) assessor.stop();
  assessor = null;

  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  video.srcObject = null;
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  btnStart.disabled = false;
  btnStop.disabled = true;
  btnRestart.disabled = true;

  setScore(null, "—");
  distPxEl.textContent = "—";
  timeLeftEl.textContent = "—";
  postureEl.textContent = "—";
  clsEl.textContent = "—";
  lastResultEl.textContent = "—";
  payloadEl.textContent = "";

  setStatus("warn", "Idle");
  toast.textContent = "Stopped.";
}

function restartTrial() {
  if (!assessor) return;
  assessor.resetTrial();
  setScore(null, "—");
  lastResultEl.textContent = "—";
  payloadEl.textContent = "";
  toast.textContent = "Trial reset. Trial auto-starts when elbows < 90° + both hands detected.";
  setStatus("good", "Arming…");
}

btnStart.addEventListener("click", startCamera);
btnStop.addEventListener("click", stopCamera);
btnRestart.addEventListener("click", restartTrial);

setStatus("warn", "Idle");
setScore(null, "—");


// =====================================
// NEXT TEST NAVIGATION
// =====================================
const QUEUE_KEY = "fft_test_queue_v1";
const nextBtn = document.getElementById("nextBtn");

const TEST_ROUTE_MAP = {
  chair_sit_reach: "chair-sit-reach.html",
  chair_sit_to_stand: "chair-stand.html",
  single_leg_stance: "single-leg-stance.html",
  back_scratch: "back-scratch.html",
  tug_test: "tug-test.html"
};

nextBtn.addEventListener("click", () => {

  const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "null");

  if (!queue || !queue.tests || queue.tests.length === 0) {
    alert("No active assessment queue found.");
    window.location.href = "../dashboard.html";
    return;
  }

  // Move to next test
  queue.currentIndex++;

  // If all tests completed
  if (queue.currentIndex >= queue.tests.length) {
    localStorage.removeItem(QUEUE_KEY);
    alert("All selected assessments completed.");
    window.location.href = "../dashboard.html";
    return;
  }

  // Save updated queue
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));

  const nextTestKey = queue.tests[queue.currentIndex];
  const route = TEST_ROUTE_MAP[nextTestKey];

  if (!route) {
    alert("Test route not found for: " + nextTestKey);
    return;
  }

  // Pass patient ID in URL
  window.location.href =
    `${route}?patient=${encodeURIComponent(queue.patientId)}`;
});