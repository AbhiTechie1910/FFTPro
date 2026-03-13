import { PoseLandmarker, FilesetResolver } from
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

console.log("chair-sit-to-stand.js loaded ✅ (python-equivalent JS)");

const CFG = {
  MODEL_URL:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",

  // ---- Test ----
  TEST_SEC: 30,
  COUNTDOWN_MS: 3000,
  START_STABLE_MS: 600,

  // ---- Visibility thresholds ----
  VIS_THRESH: 0.25,
  DRAW_VIS: 0.18,

  // ---- Arms crossed rule ----
  ELBOW_FLEX_MAX: 115,
  WRIST_VIS_THRESH: 0.10,
  HOLD_ARMS_OK_MS: 300,

  // ---- Python thresholds ----
  STAND_KNEE_MIN: 160,
  STAND_HIP_MIN: 160,
  SIT_KNEE_MAX: 120,
  SIT_HIP_MAX: 120,

  // ---- Pause behavior ----
  PAUSE_GRACE_MS: 200,

  // ---- Flicker protection ----
  HOLD_LAST_POSE_MS: 180,

  // ---- Side view: choose best side instead of avg ----
  SIDE_SCORE_VIS: 0.20,

  // ---- Mirror (side view: false) ----
  MIRROR_VIEW: false,

  // ---- Drawing ----
  LINE_W: 2,
  DOT_R: 3,

  // ---- Backend hooks (won't crash if empty) ----
  API_BASE: window.API_BASE ?? "", // set window.API_BASE = "http://127.0.0.1:5500" if needed
  ENDPOINTS: {
    start: "/api/test/start",
    status: "/api/test/status",
    stop: "/api/test/stop",
    sample: "/api/tests/chair-stand/sample", // optional custom
  },

  DEBUG: true,
};

// BlazePose landmark indices
const L_SHOULDER = 11, R_SHOULDER = 12;
const L_ELBOW = 13, R_ELBOW = 14;
const L_WRIST = 15, R_WRIST = 16;
const L_HIP = 23, R_HIP = 24;
const L_KNEE = 25, R_KNEE = 26;
const L_ANKLE = 27, R_ANKLE = 28;

// Skeleton connections (filtered by DRAW_VIS to avoid spider-web)
const POSE_CONNECTIONS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32], [27, 29], [28, 30], [29, 31], [30, 32],
];

// DOM helpers
const $ = (id) => document.getElementById(id);

const videoEl = $("cameraFeed");
const canvasEl = $("overlayCanvas");
const ctx = canvasEl?.getContext("2d");

const btnStartCam = $("startCameraBtn");
const btnStopCam = $("stopCameraBtn");
const btnStartTest = $("starttestbtn");
const btnRecord = $("recordBtn");

const camStatusEl = $("camStatus");
const stageText = $("stageText");
const distanceText = $("distanceText");
const lightingText = $("lightingText");
const repText = $("repText");
const timeText = $("timeText");
const phaseText = $("phaseText");
const hipText = $("hipText");
const kneeText = $("kneeText");
const qualityText = $("qualityText");
const recordedText = $("recordedText");

const repsScoreInput = $("repsScore");
const durationInput = $("duration");
const testDurationHidden = $("testDurationSec");
const lastRecordedHidden = $("lastRecordedValue");
const msgBox = $("msgBox");
const formEl = $("resultForm");

// Guards
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

// Utils
function ui(msg) {
  if (msgBox) msgBox.textContent = msg;
  if (CFG.DEBUG) console.log(msg);
}
function setBadge(s) { if (camStatusEl) camStatusEl.textContent = s; }
function setStage(s) { if (stageText) stageText.textContent = s; }
function vis(p) { return (p?.visibility ?? 1.0); }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function avg(a, b) { return (a + b) / 2; }
function fmtSec(ms) { return (ms / 1000).toFixed(1); }

// Angle math (same idea as your numpy arctan2-based version, but stable)
function angleDeg(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (mag < 1e-6) return NaN;
  const cos = clamp(dot / mag, -1, 1);
  return Math.acos(cos) * (180 / Math.PI);
}

// Overlay stacking + mirror
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

// Canvas resize without flicker
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

// Drawing (filtered)
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

// Distance + lighting placeholders
function updateDistancePrompt(lms) {
  const shY = avg(lms[L_SHOULDER].y, lms[R_SHOULDER].y);
  const anY = avg(lms[L_ANKLE].y, lms[R_ANKLE].y);
  const spanY = clamp(Math.abs(anY - shY), 0, 1);

  let status = "OK";
  if (spanY < 0.45) status = "Too far (step closer)";
  else if (spanY > 0.90) status = "Too close (step back)";
  distanceText && (distanceText.textContent = status);
}
function updateLightingPlaceholder() {
  lightingText && (lightingText.textContent = "OK");
}

// Pose ok (don’t gate on hips too hard; knees/ankles matter more)
function poseOk(lms) {
  const idx = [L_SHOULDER, R_SHOULDER, L_KNEE, R_KNEE, L_ANKLE, R_ANKLE, L_HIP, R_HIP];
  return idx.every(i => lms[i] && vis(lms[i]) >= CFG.VIS_THRESH);
}

// Arms crossed mandatory (elbow flexion)
function elbowsFlexedArmsOk(lms) {
  const ls = lms[L_SHOULDER], le = lms[L_ELBOW], lw = lms[L_WRIST];
  const rs = lms[R_SHOULDER], re = lms[R_ELBOW], rw = lms[R_WRIST];

  const leftAng = (ls && le && lw) ? angleDeg(ls, le, lw) : NaN;
  const rightAng = (rs && re && rw) ? angleDeg(rs, re, rw) : NaN;

  const leftOk =
    Number.isFinite(leftAng) &&
    vis(le) >= CFG.VIS_THRESH &&
    vis(lw) >= CFG.WRIST_VIS_THRESH &&
    leftAng <= CFG.ELBOW_FLEX_MAX;

  const rightOk =
    Number.isFinite(rightAng) &&
    vis(re) >= CFG.VIS_THRESH &&
    vis(rw) >= CFG.WRIST_VIS_THRESH &&
    rightAng <= CFG.ELBOW_FLEX_MAX;

  return leftOk && rightOk;
}
function armsOkWithHold(lms, now, S) {
  const okNow = elbowsFlexedArmsOk(lms);
  if (okNow) {
    S.lastArmsOk = true;
    S.lastArmsOkMs = now;
    return true;
  }
  if (S.lastArmsOk && (now - S.lastArmsOkMs) <= CFG.HOLD_ARMS_OK_MS) return true;
  S.lastArmsOk = false;
  return false;
}

/* =========================================================
   SIDE SELECTION (important):
   In side view, averaging both sides often kills accuracy.
   Pick the side with better hip/knee/ankle visibility.
========================================================= */
function sideScore(lms, side) {
  if (side === "L") {
    return (vis(lms[L_HIP]) >= CFG.SIDE_SCORE_VIS ? 1 : 0) +
           (vis(lms[L_KNEE]) >= CFG.SIDE_SCORE_VIS ? 1 : 0) +
           (vis(lms[L_ANKLE]) >= CFG.SIDE_SCORE_VIS ? 1 : 0) +
           (vis(lms[L_SHOULDER]) >= CFG.SIDE_SCORE_VIS ? 1 : 0);
  }
  return (vis(lms[R_HIP]) >= CFG.SIDE_SCORE_VIS ? 1 : 0) +
         (vis(lms[R_KNEE]) >= CFG.SIDE_SCORE_VIS ? 1 : 0) +
         (vis(lms[R_ANKLE]) >= CFG.SIDE_SCORE_VIS ? 1 : 0) +
         (vis(lms[R_SHOULDER]) >= CFG.SIDE_SCORE_VIS ? 1 : 0);
}

function computeAnglesBestSide(lms) {
  const lScore = sideScore(lms, "L");
  const rScore = sideScore(lms, "R");
  const useLeft = lScore >= rScore;

  const hip = useLeft
    ? angleDeg(lms[L_SHOULDER], lms[L_HIP], lms[L_KNEE])
    : angleDeg(lms[R_SHOULDER], lms[R_HIP], lms[R_KNEE]);

  const knee = useLeft
    ? angleDeg(lms[L_HIP], lms[L_KNEE], lms[L_ANKLE])
    : angleDeg(lms[R_HIP], lms[R_KNEE], lms[R_ANKLE]);

  return { hip, knee, side: useLeft ? "L" : "R", lScore, rScore };
}

/* =========================================================
   Python-equivalent detection + counting
========================================================= */
function detectPositionPythonStyle(S, avgKnee, avgHip) {
  if (!Number.isFinite(avgKnee) || !Number.isFinite(avgHip)) return "unknown";

  // standing: knee > 160 AND hip > 160
  if (avgKnee > CFG.STAND_KNEE_MIN && avgHip > CFG.STAND_HIP_MIN) return "standing";

  // sitting: knee < 120 OR hip < 120
  if (avgKnee < CFG.SIT_KNEE_MAX || avgHip < CFG.SIT_HIP_MAX) return "sitting";

  // transitional: keep previous
  return S.lastState;
}

function updateCycleCountPythonStyle(S, currentPosition) {
  if (currentPosition === "standing" && S.lastState === "sitting") {
    S.isStanding = true;
  } else if (currentPosition === "sitting" && S.lastState === "standing" && S.isStanding) {
    S.reps += 1;
    S.isStanding = false;
  }
  if (currentPosition !== "unknown") S.lastState = currentPosition;
}

/* =========================================================
   Backend helpers (safe)
========================================================= */
function url(path) { return `${CFG.API_BASE}${path}`; }
async function postJSON(fullUrl, body) {
  if (!CFG.API_BASE) return;
  try {
    await fetch(fullUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch (_) { /* ignore */ }
}

/* =========================================================
   App State
========================================================= */
const S = {
  landmarker: null,
  stream: null,
  rafId: null,

  mode: "idle", // idle|camera|ready|countdown|running|done
  startGateOkSince: null,
  countdownStartMs: 0,

  // paused clock
  testClockMs: 0,
  lastTickMs: 0,
  pausedSince: null,
  lastPauseReason: "",

  // python-like counter state
  reps: 0,
  isStanding: false,
  lastState: "sitting",

  // arms hold
  lastArmsOk: false,
  lastArmsOkMs: 0,

  // flicker hold
  lastGoodLms: null,
  lastGoodMs: 0,

  // warnings
  warnSecondPerson: false,
};

function setMode(next) {
  S.mode = next;
  setBadge(next === "idle" ? "Ready" : next.toUpperCase());
  setStage(next === "idle" ? "Not started" : next);

  btnStartTest.disabled = (next !== "ready");
  btnRecord.disabled = !(next === "running" || next === "done");

  if (next === "camera") ui("Camera started. Show full body + chair. Arms crossed required.");
  if (next === "ready") ui("Ready. Press Start Test.");
  if (next === "countdown") ui("Get ready…");
  if (next === "running") ui("GO!");
  if (next === "done") ui("Test complete. Auto-recorded ✅");
}

function resetRun() {
  S.startGateOkSince = null;
  S.countdownStartMs = 0;

  S.testClockMs = 0;
  S.lastTickMs = 0;
  S.pausedSince = null;
  S.lastPauseReason = "";

  S.reps = 0;
  S.isStanding = false;
  S.lastState = "sitting";

  S.lastArmsOk = false;
  S.lastArmsOkMs = 0;

  repText && (repText.textContent = "0");
  timeText && (timeText.textContent = `${CFG.TEST_SEC.toFixed(1)}s`);
  phaseText && (phaseText.textContent = "—");
  hipText && (hipText.textContent = "—");
  kneeText && (kneeText.textContent = "—");
  qualityText && (qualityText.textContent = "—");
  recordedText && (recordedText.textContent = "—");
}

function getTestMs() {
  const s1 = parseInt(durationInput?.value || "", 10);
  if (Number.isFinite(s1) && s1 > 0) return s1 * 1000;
  const s2 = parseInt(testDurationHidden?.value || "", 10);
  if (Number.isFinite(s2) && s2 > 0) return s2 * 1000;
  return CFG.TEST_SEC * 1000;
}

function recordResult() {
  const durationSec = Math.round(getTestMs() / 1000);
  recordedText && (recordedText.textContent = `${S.reps} reps • ${durationSec}s`);
  repsScoreInput && (repsScoreInput.value = String(S.reps));
  lastRecordedHidden && (lastRecordedHidden.value = String(S.reps));
}

/* =========================================================
   MediaPipe init (CPU)
========================================================= */
async function initPoseCPU() {
  ui("Loading MediaPipe (CPU)…");
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  S.landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: CFG.MODEL_URL,
      delegate: CFG.DELEGATE,
    },
    runningMode: "VIDEO",
    numPoses: 2,
  });

  ui("MediaPipe ready ✅");
}

/* =========================================================
   Camera (safe)
========================================================= */
async function startCamera() {
  try {
    ensureOverlayStacking();
    if (!S.landmarker) await initPoseCPU();

    ui("Requesting camera permission…");

    S.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    videoEl.srcObject = S.stream;
    videoEl.playsInline = true;
    videoEl.muted = true;

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Video metadata timeout")), 5000);
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

/* =========================================================
   Test controls
========================================================= */
function startTest() {
  if (S.mode !== "ready") return;
  setMode("countdown");
  S.countdownStartMs = performance.now();
}

/* =========================================================
   MAIN LOOP
========================================================= */
function loop() {
  const now = performance.now();
  const { w, h } = resizeCanvasToVideo();

  if (!w || !h || !S.landmarker || videoEl.readyState < 2) {
    S.rafId = requestAnimationFrame(loop);
    return;
  }

  ctx.clearRect(0, 0, w, h);

  const result = S.landmarker.detectForVideo(videoEl, now);
  const poses = result?.landmarks ?? [];
  let lms = poses[0] ?? null;

  S.warnSecondPerson = poses.length > 1;

  updateLightingPlaceholder();

  // Hold last good pose briefly
  if (lms && lms.length === 33) {
    S.lastGoodLms = lms;
    S.lastGoodMs = now;
  } else if (S.lastGoodLms && (now - S.lastGoodMs) <= CFG.HOLD_LAST_POSE_MS) {
    lms = S.lastGoodLms;
  }

  if (!lms || lms.length !== 33) {
    qualityText && (qualityText.textContent = "NO POSE");
    btnStartTest.disabled = true;
    setMode("camera");
    S.startGateOkSince = null;
    S.rafId = requestAnimationFrame(loop);
    return;
  }

  drawSkeleton(lms, w, h);
  updateDistancePrompt(lms);

  const okPose = poseOk(lms);
  const okArms = armsOkWithHold(lms, now, S);
  const trackingOk = okPose && okArms;

  // compute angles (best side)
  const { hip, knee, side, lScore, rScore } = computeAnglesBestSide(lms);

  hipText && (hipText.textContent = Number.isFinite(hip) ? hip.toFixed(0) : "—");
  kneeText && (kneeText.textContent = Number.isFinite(knee) ? knee.toFixed(0) : "—");

  const pos = detectPositionPythonStyle(S, knee, hip);
  phaseText && (phaseText.textContent = pos);

  if (qualityText) {
    const bits = [
      okPose ? "poseOK" : "poseLOW",
      okArms ? "armsOK" : "ARMS REQUIRED",
      `side:${side} (L${lScore}/R${rScore})`,
      S.warnSecondPerson ? "⚠ 2nd person" : "",
    ].filter(Boolean);
    qualityText.textContent = bits.join(" • ");
  }

  // START GATE -> READY (must include arms crossed)
  if (S.mode === "camera") {
    if (trackingOk && pos !== "unknown") {
      if (S.startGateOkSince == null) S.startGateOkSince = now;
      if (now - S.startGateOkSince >= CFG.START_STABLE_MS) {
        setMode("ready");
        btnStartTest.disabled = false;
      }
    } else {
      S.startGateOkSince = null;
      btnStartTest.disabled = true;
      ui(!okPose ? "Show full body + chair…" : (!okArms ? "Arms crossed required…" : "Adjust side view…"));
    }
  }

  // COUNTDOWN -> RUNNING
  if (S.mode === "countdown") {
    const remain = CFG.COUNTDOWN_MS - (now - S.countdownStartMs);
    if (remain > 0) {
      timeText && (timeText.textContent = `Starts in ${Math.ceil(remain / 1000)}…`);
    } else {
      resetRun();
      setMode("running");
      S.lastTickMs = now;

      // optional backend start
      postJSON(url(CFG.ENDPOINTS.start), { test: "chair-stand", durationSec: CFG.TEST_SEC, ts: Date.now() });
    }
  }

  // RUNNING
  if (S.mode === "running") {
    // pause if arms uncross / pose drops
    if (!trackingOk) {
      if (S.pausedSince == null) S.pausedSince = now;
      const pausedFor = now - S.pausedSince;

      if (pausedFor > CFG.PAUSE_GRACE_MS) {
        const reason = !okPose ? "Tracking unstable" : "Arms not crossed";
        ui(`${reason} (timer paused)…`);
        S.lastTickMs = now;
        S.rafId = requestAnimationFrame(loop);
        return;
      }
    } else if (S.pausedSince != null) {
      S.pausedSince = null;
      ui("Resumed ✅");
    }

    // advance timer
    const dt = Math.max(0, now - (S.lastTickMs || now));
    S.lastTickMs = now;
    S.testClockMs += dt;

    const TEST_MS = getTestMs();
    const remainingMs = Math.max(0, TEST_MS - S.testClockMs);
    timeText && (timeText.textContent = `${fmtSec(remainingMs)}s`);

    // update python cycle count
    updateCycleCountPythonStyle(S, pos);
    repText && (repText.textContent = String(S.reps));

    // end
    if (S.testClockMs >= TEST_MS) {
      setMode("done");
      timeText && (timeText.textContent = "0.0s");
      recordResult();

      // optional backend stop
      postJSON(url(CFG.ENDPOINTS.stop), { test: "chair-stand", reps: S.reps, durationSec: Math.round(TEST_MS / 1000), ts: Date.now() });
    }
  }

  S.rafId = requestAnimationFrame(loop);
}

/* =========================================================
   Events
========================================================= */
btnStartCam.addEventListener("click", startCamera);
btnStopCam.addEventListener("click", stopCamera);
btnStartTest.addEventListener("click", startTest);
btnRecord.addEventListener("click", recordResult);

formEl?.addEventListener("submit", (e) => {
  e.preventDefault();
  ui("Submitted (frontend). Backend can be connected.");
});

// init UI
ensureOverlayStacking();
setMode("idle");
resetRun();
setBadge("Ready");
setStage("Not started");

window.addEventListener("error", (e) => console.error("Global error:", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => console.error("Unhandled rejection:", e.reason));