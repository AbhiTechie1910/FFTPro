import { PoseLandmarker, FilesetResolver } from
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

console.log("arm-curl.js loaded ✅");

/* =========================================================
   FFTPro — Standing Arm Curl Test
   Self-contained JS:
   - Forces overlay layout in JS (does not depend on CSS)
   - Camera start/stop
   - Skeleton overlay
   - Lighting check
   - Distance check
   - Rep counting
   - 30-second timer
   - Save to backend
   ========================================================= */

// ==============================
// CONFIG
// ==============================
const API_BASE = "http://127.0.0.1:5000";
const SAVE_URL = `${API_BASE}/api/tests/arm-curl/save`;

const MIRROR_VIDEO = true;
const MIRROR_OVERLAY = true;

const VIS_THRESH = 0.25;
const EXTENDED_DEG = 155;
const FLEXED_DEG = 60;
const TEST_DURATION_DEFAULT = 30;

// BlazePose indices (right side)
const R_SHOULDER = 12;
const R_ELBOW = 14;
const R_WRIST = 16;
const R_HIP = 24;

// Fallback pose connections
const POSE_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,7],
  [0,4],[4,5],[5,6],[6,8],
  [9,10],
  [11,12],
  [11,13],[13,15],[15,17],[15,19],[15,21],
  [12,14],[14,16],[16,18],[16,20],[16,22],
  [11,23],[12,24],[23,24],
  [23,25],[25,27],[27,29],[29,31],
  [24,26],[26,28],[28,30],[30,32]
];

// ==============================
// DOM
// ==============================
const videoEl = document.getElementById("cameraFeed");
const overlayCanvas = document.getElementById("overlayCanvas");
const frameCanvas = document.getElementById("frameCanvas");

const camStatus = document.getElementById("camStatus");
const stageText = document.getElementById("stageText");
const distanceText = document.getElementById("distanceText");
const lightingText = document.getElementById("lightingText");

const repText = document.getElementById("repText");
const timeText = document.getElementById("timeText");
const phaseText = document.getElementById("phaseText");
const qualityText = document.getElementById("qualityText");
const recordedText = document.getElementById("recordedText");

const startCameraBtn = document.getElementById("startCameraBtn");
const stopCameraBtn = document.getElementById("stopCameraBtn");
const startTestBtn = document.getElementById("starttestbtn");
const recordBtn = document.getElementById("recordBtn");

const resultForm = document.getElementById("resultForm");
const repsScoreInput = document.getElementById("repsScore");
const msgBox = document.getElementById("msgBox");

const testDurationInput = document.getElementById("testDurationSec");
const lastRecordedValueInput = document.getElementById("lastRecordedValue");

const patientIdInput =
  document.getElementById("patientId") ||
  document.getElementById("patientID") ||
  document.getElementById("patient_id");

const required = {
  videoEl,
  overlayCanvas,
  frameCanvas,
  camStatus,
  stageText,
  distanceText,
  lightingText,
  repText,
  timeText,
  phaseText,
  qualityText,
  recordedText,
  startCameraBtn,
  stopCameraBtn,
  startTestBtn,
  recordBtn
};

for (const [name, el] of Object.entries(required)) {
  if (!el) throw new Error(`Missing required element: ${name}`);
}

const ctx = overlayCanvas.getContext("2d", { alpha: true });
if (!ctx) throw new Error("Could not create 2D context for overlayCanvas");

// ==============================
// STATE
// ==============================
let poseLandmarker = null;
let stream = null;
let animationId = null;
let running = false;

let testActive = false;
let testStartMs = 0;
let reps = 0;
let curlPhase = "down";

// ==============================
// HELPERS
// ==============================
function setStatus(text, detail = "") {
  camStatus.textContent = text;
  stageText.textContent = detail ? `${text}: ${detail}` : text;
}

function setMsg(text, good = true) {
  if (!msgBox) return;
  msgBox.textContent = text;
  msgBox.style.color = good ? "#166534" : "#b91c1c";
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function visOk(lm) {
  return (lm?.visibility ?? 1) >= VIS_THRESH;
}

function angleDeg(a, b, c) {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;

  const dot = abx * cbx + aby * cby;
  const magAB = Math.hypot(abx, aby);
  const magCB = Math.hypot(cbx, cby);

  if (!magAB || !magCB) return 180;
  const cos = clamp(dot / (magAB * magCB), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

function getTestDurationSec() {
  return Number(testDurationInput?.value || TEST_DURATION_DEFAULT);
}

function getPatientId() {
  if (patientIdInput?.value) return patientIdInput.value;

  try {
    const activePatient = JSON.parse(localStorage.getItem("fft_active_patient_v1") || "null");
    return activePatient?.id || activePatient?.patient_id || null;
  } catch {
    return null;
  }
}

function forceOverlayLayout() {
  const shell = videoEl.parentElement;
  if (shell) {
    shell.style.position = "relative";
    shell.style.overflow = "hidden";
  }

  videoEl.style.display = "block";
  videoEl.style.width = "100%";
  videoEl.style.height = "100%";
  videoEl.style.objectFit = "cover";
  videoEl.style.position = "relative";
  videoEl.style.zIndex = "1";
  if (MIRROR_VIDEO) videoEl.style.transform = "scaleX(-1)";

  overlayCanvas.style.position = "absolute";
  overlayCanvas.style.left = "0";
  overlayCanvas.style.top = "0";
  overlayCanvas.style.width = "100%";
  overlayCanvas.style.height = "100%";
  overlayCanvas.style.pointerEvents = "none";
  overlayCanvas.style.zIndex = "5";
  overlayCanvas.style.display = "block";
}

function syncCanvasToVideo() {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) return false;

  overlayCanvas.width = w;
  overlayCanvas.height = h;
  forceOverlayLayout();
  return true;
}

function clearOverlay() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function applyOverlayTransform() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (MIRROR_OVERLAY) {
    ctx.translate(overlayCanvas.width, 0);
    ctx.scale(-1, 1);
  }
}
function drawSkeleton(landmarks) {

  clearOverlay();
  applyOverlayTransform();

  // Always use our own connections list
  const connections = POSE_CONNECTIONS;

  ctx.lineWidth = 3;
  ctx.strokeStyle = "#2563eb";
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 0.95;

  // Draw lines
  for (let i = 0; i < connections.length; i++) {

    const a = connections[i][0];
    const b = connections[i][1];

    const p1 = landmarks[a];
    const p2 = landmarks[b];

    if (!p1 || !p2) continue;

    ctx.beginPath();
    ctx.moveTo(p1.x * overlayCanvas.width, p1.y * overlayCanvas.height);
    ctx.lineTo(p2.x * overlayCanvas.width, p2.y * overlayCanvas.height);
    ctx.stroke();
  }

  // Draw points
  for (let i = 0; i < landmarks.length; i++) {

    const p = landmarks[i];
    if (!p) continue;

    ctx.beginPath();
    ctx.arc(
      p.x * overlayCanvas.width,
      p.y * overlayCanvas.height,
      5,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  ctx.setTransform(1,0,0,1,0,0);
}

function quickLightingCheck() {
  try {
    const w = 160;
    const h = 90;

    frameCanvas.width = w;
    frameCanvas.height = h;

    const fctx = frameCanvas.getContext("2d", { willReadFrequently: true });
    if (!fctx) return { ok: false, text: "Check failed" };

    fctx.drawImage(videoEl, 0, 0, w, h);
    const data = fctx.getImageData(0, 0, w, h).data;

    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }

    const mean = sum / (data.length / 4);

    if (mean < 55) return { ok: false, text: "Too dark" };
    if (mean > 220) return { ok: false, text: "Too bright" };
    return { ok: true, text: "OK" };
  } catch {
    return { ok: false, text: "Check failed" };
  }
}

function distanceCheck(landmarks) {
  try {
    const sh = landmarks?.[R_SHOULDER];
    const hip = landmarks?.[R_HIP];
    if (!sh || !hip) return { ok: false, text: "Not measured" };

    const torsoNorm = Math.abs(sh.y - hip.y);

    if (torsoNorm < 0.15) return { ok: false, text: "Too far" };
    if (torsoNorm > 0.50) return { ok: false, text: "Too close" };
    return { ok: true, text: "OK" };
  } catch {
    return { ok: false, text: "Not measured" };
  }
}

function updateQualityPanels(landmarks = null) {
  const light = quickLightingCheck();
  lightingText.textContent = light.text;

  const dist = landmarks ? distanceCheck(landmarks) : { ok: false, text: "Not measured" };
  distanceText.textContent = dist.text;

  qualityText.textContent = (light.ok && dist.ok) ? "Good" : "Adjust";
}

function updateRepLogic(landmarks) {
  const sh = landmarks[R_SHOULDER];
  const el = landmarks[R_ELBOW];
  const wr = landmarks[R_WRIST];

  if (!sh || !el || !wr || !visOk(sh) || !visOk(el) || !visOk(wr)) {
    phaseText.textContent = "Landmarks unstable";
    return;
  }

  const elbowAngle = angleDeg(sh, el, wr);

  if (elbowAngle > EXTENDED_DEG) {
    curlPhase = "down";
  }

  if (elbowAngle < FLEXED_DEG && curlPhase === "down") {
    curlPhase = "up";
    if (testActive) {
      reps += 1;
      repText.textContent = String(reps);
    }
  }

  phaseText.textContent = curlPhase === "down" ? "Extended (Down)" : "Flexed (Up)";
}

function resetTestUi() {
  repText.textContent = "0";
  timeText.textContent = "0.0";
  phaseText.textContent = "Ready";
  qualityText.textContent = "—";
  recordedText.textContent = "—";
  distanceText.textContent = "Not measured";
  lightingText.textContent = "Not checked";
}

function stopLoop() {
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;
}

// ==============================
// MEDIAPIPE
// ==============================
async function initPose() {
  setStatus("Loading model");

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"
    },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.3,
    minPosePresenceConfidence: 0.3,
    minTrackingConfidence: 0.3
  });

  setStatus("Model ready");
}

// ==============================
// LOOP
// ==============================
function renderLoop() {
  if (!running) return;

  animationId = requestAnimationFrame(renderLoop);

  try {
    if (!poseLandmarker) {
      setStatus("Model not ready");
      return;
    }

    if (!videoEl.srcObject) {
      setStatus("Camera not ready");
      return;
    }

    if (videoEl.readyState < 2) {
      setStatus("Waiting for video");
      return;
    }

    const vw = videoEl.videoWidth || 0;
    const vh = videoEl.videoHeight || 0;
    if (!vw || !vh) {
      setStatus("Video size invalid", `${vw}x${vh}`);
      return;
    }

    if (!overlayCanvas.width || !overlayCanvas.height) {
      syncCanvasToVideo();
    }

    updateQualityPanels(null);

    const nowMs = performance.now();
    let results;
    try {
      results = poseLandmarker.detectForVideo(videoEl, nowMs);
    } catch (err) {
      console.error("detectForVideo error:", err);
      setStatus("Detection error", err?.message || String(err));
      phaseText.textContent = err?.message || "detectForVideo failed";
      return;
    }

    const landmarks = results?.landmarks?.[0] || null;

    if (landmarks && landmarks.length) {
      drawSkeleton(landmarks);
      updateQualityPanels(landmarks);
      setStatus("Tracking");
      updateRepLogic(landmarks);
    } else {
      clearOverlay();
      setStatus("No pose detected");
      phaseText.textContent = "Stand upright / step back";
    }

    if (testActive) {
      const elapsed = (performance.now() - testStartMs) / 1000;
      timeText.textContent = elapsed.toFixed(1);

      if (elapsed >= getTestDurationSec()) {
        endTest();
      }
    }
  } catch (err) {
    console.error("Loop error:", err);
    setStatus("Detection error", err?.message || String(err));
    phaseText.textContent = err?.message || "Unknown error";
  }
}

// ==============================
// CAMERA
// ==============================
async function startCamera() {
  try {
    forceOverlayLayout();

    if (!poseLandmarker) {
      await initPose();
    }

    setStatus("Starting camera");

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    videoEl.srcObject = stream;

    await new Promise((resolve) => {
      videoEl.onloadedmetadata = () => resolve();
    });

    await videoEl.play();
    syncCanvasToVideo();

    running = true;
    stopLoop();
    animationId = requestAnimationFrame(renderLoop);

    startCameraBtn.disabled = true;
    stopCameraBtn.disabled = false;
    startTestBtn.disabled = false;

    setStatus("Camera on");
    setMsg("Camera started.", true);
  } catch (err) {
    console.error("Camera start failed:", err);
    setStatus("Camera failed", err?.message || String(err));
    setMsg(`Camera error: ${err?.message || err}`, false);
  }
}

function stopCamera() {
  running = false;
  testActive = false;
  stopLoop();
  clearOverlay();

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  videoEl.srcObject = null;

  startCameraBtn.disabled = false;
  stopCameraBtn.disabled = true;
  startTestBtn.disabled = true;
  recordBtn.disabled = true;

  setStatus("Ready");
  resetTestUi();
}

// ==============================
// TEST
// ==============================
function startTest() {
  reps = 0;
  curlPhase = "down";
  testActive = true;
  testStartMs = performance.now();

  repText.textContent = "0";
  timeText.textContent = "0.0";
  phaseText.textContent = "Ready";
  recordedText.textContent = "—";

  if (lastRecordedValueInput) {
    lastRecordedValueInput.value = "";
  }

  startTestBtn.disabled = true;
  recordBtn.disabled = true;

  setMsg("Test started.", true);
}

function endTest() {
  testActive = false;

  const finalReps = reps;
  repText.textContent = String(finalReps);
  timeText.textContent = String(getTestDurationSec().toFixed(1));
  phaseText.textContent = "Finished";
  recordedText.textContent = String(finalReps);

  if (repsScoreInput) repsScoreInput.value = String(finalReps);
  if (lastRecordedValueInput) lastRecordedValueInput.value = String(finalReps);

  startTestBtn.disabled = false;
  recordBtn.disabled = false;

  setMsg(`Test completed. Total reps: ${finalReps}`, true);
}

// ==============================
// DATABASE SAVE
// ==============================
async function saveResultToDatabase() {
  const patientId = getPatientId();
  const totalReps = Number(repsScoreInput?.value || lastRecordedValueInput?.value || reps || 0);
  const durationSec = getTestDurationSec();

  const payload = {
    patient_id: patientId,
    test_name: "arm_curl",
    total_reps: totalReps,
    duration_sec: durationSec,
    side: "right",
    test_date: new Date().toISOString()
  };

  try {
    setMsg("Saving result...", true);

    const res = await fetch(SAVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
    }

    recordedText.textContent = String(totalReps);
    setMsg("Test result saved successfully.", true);
  } catch (err) {
    console.error("Save failed:", err);
    setMsg(`Save failed: ${err?.message || err}`, false);
  }
}

// ==============================
// EVENTS
// ==============================
startCameraBtn.addEventListener("click", startCamera);
stopCameraBtn.addEventListener("click", stopCamera);
startTestBtn.addEventListener("click", startTest);
recordBtn.addEventListener("click", saveResultToDatabase);

if (resultForm) {
  resultForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveResultToDatabase();
  });
}

// ==============================
// INIT
// ==============================
forceOverlayLayout();
resetTestUi();
setStatus("Ready");