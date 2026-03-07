// =========================
// 0) CONFIG
// =========================
const BACKEND_BASE_URL = "http://localhost:8000"; // change if needed
const CSR_WS_URL = "ws://localhost:8000/ws/csr";
const DEFAULT_FPS = 3; // start low to avoid lag; increase to 5-10 later

// =========================
// 1) Get the test from URL
// =========================
const params = new URLSearchParams(window.location.search);
const testNameParam = params.get("test"); // e.g., "chair_sit_reach"
const fallbackTestId = document.body?.dataset?.testId || null;
const activeTestId = testNameParam || fallbackTestId;

// =========================
// 2) Define your test data
// =========================
const tests = {
  chair_sit_reach: {
    name: "Chair Sit and Reach Test",
    image: "chair_sit_reach.png",
    instructions: [
      "Have the participant sit on the edge of a chair with one leg extended straight, heel on the floor.",
      "Place the hands on top of the extended leg, fingers reaching toward or beyond the toes.",
      "Maintain proper posture with back straight.",
      "Reach slowly, hold for 2 seconds, then return to starting position.",
      "Measure distance between fingertips and toes (positive if beyond toes, negative if not reaching toes).",
      "Repeat for the other leg."
    ],
    inputs: [
      { label: "Left Leg Reach (cm)", id: "leftLeg", type: "number", placeholder: "e.g., 5" },
      { label: "Right Leg Reach (cm)", id: "rightLeg", type: "number", placeholder: "e.g., 6" }
    ]
  },

  tug_test: {
    name: "Timed Up and Go (TUG) Test",
    image: "tug_test.png",
    instructions: [
      "Have the participant sit in a standard chair.",
      "On 'Go', the participant stands up, walks 3 meters, turns around, walks back, and sits down.",
      "Measure the total time to complete the task."
    ],
    inputs: [
      { label: "Time Taken (seconds)", id: "timeTaken", type: "number", placeholder: "e.g., 12.5" }
    ]
  }

  // Add all other tests here...
};

// =========================
// 3) Populate the page dynamically
// =========================
const testData = tests[testNameParam];

if (!testData) {
  if (testNameParam) {
    alert("Test not found! Check the URL parameter ?test=...");
  }
} else {
  // Title & Image
  const testNameEl = document.getElementById("testName");
  const testImageEl = document.getElementById("testImage");
  if (testNameEl) testNameEl.textContent = testData.name;

  // If your images are stored inside /tests folder, use: `tests/${testData.image}`
  // If they are in the SAME folder as test-template.html, keep as below:
  if (testImageEl) testImageEl.src = testData.image;

  // Instructions
  const instructionList = document.getElementById("instructionList");
  if (instructionList) {
    instructionList.innerHTML = "";
    testData.instructions.forEach(step => {
      const li = document.createElement("li");
      li.textContent = step;
      instructionList.appendChild(li);
    });
  }

  // Dynamic input fields
  const inputFields = document.getElementById("inputFields");
  if (inputFields) {
    inputFields.innerHTML = "";
    (testData.inputs || []).forEach(field => {
      const label = document.createElement("label");
      label.setAttribute("for", field.id);
      label.textContent = field.label;

      const input = document.createElement("input");
      input.type = field.type;
      input.id = field.id;
      input.placeholder = field.placeholder;
      input.required = true;

      inputFields.appendChild(label);
      inputFields.appendChild(input);
    });
  }
}

// =========================
// 4) Camera Feed Setup
// =========================
const cameraFeed = document.getElementById("cameraFeed");
const frameCanvas = document.getElementById("frameCanvas");
const liveOutput = document.getElementById("liveOutput");

async function startCamera() {
  if (!cameraFeed) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user", // or "environment" for back camera
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    cameraFeed.srcObject = stream;
  } catch (err) {
    alert("Camera access denied or not available: " + err);
  }
}

startCamera();

// =========================
// 5) Send frame to backend
// =========================
async function captureFrameBlob() {
  if (!cameraFeed || !frameCanvas) throw new Error("Missing video/canvas elements.");

  // Wait until video has metadata (videoWidth/videoHeight are available)
  if (cameraFeed.videoWidth === 0 || cameraFeed.videoHeight === 0) {
    throw new Error("Video not ready yet. Try again in a second.");
  }

  const ctx = frameCanvas.getContext("2d");
  frameCanvas.width = cameraFeed.videoWidth;
  frameCanvas.height = cameraFeed.videoHeight;

  ctx.drawImage(cameraFeed, 0, 0, frameCanvas.width, frameCanvas.height);

  const blob = await new Promise((resolve) =>
    frameCanvas.toBlob(resolve, "image/jpeg", 0.85)
  );

  if (!blob) throw new Error("Failed to create image blob from canvas.");
  return blob;
}

async function captureFrameBase64Jpeg(quality = 0.7) {
  if (!cameraFeed || !frameCanvas) throw new Error("Missing video/canvas elements.");

  if (cameraFeed.videoWidth === 0 || cameraFeed.videoHeight === 0) {
    throw new Error("Video not ready yet. Try again in a second.");
  }

  const ctx = frameCanvas.getContext("2d");
  frameCanvas.width = cameraFeed.videoWidth;
  frameCanvas.height = cameraFeed.videoHeight;
  ctx.drawImage(cameraFeed, 0, 0, frameCanvas.width, frameCanvas.height);

  const dataUrl = frameCanvas.toDataURL("image/jpeg", quality);
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) throw new Error("Failed to encode image data.");
  return dataUrl.slice(commaIndex + 1);
}

async function sendFrameToBackend(testId) {
  const blob = await captureFrameBlob();

  const form = new FormData();
  form.append("frame", blob, "frame.jpg");

  // Optional: add metadata if you want
  // form.append("patient_id", "P001");

  const res = await fetch(`${BACKEND_BASE_URL}/api/tests/${testId}/analyze-frame`, {
    method: "POST",
    body: form
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Backend error ${res.status}. ${text}`);
  }

  return await res.json();
}

// =========================
// 6) Live analysis loop (Start/Stop)
// =========================
let analysisIntervalId = null;
let isSending = false;

function renderLiveOutput(data) {
  if (!liveOutput) return;
  liveOutput.textContent = JSON.stringify(data, null, 2);
}

function shouldUseCsrSocket(testId) {
  return testId === "chair_sit_reach";
}

let csrSocket = null;
let csrIntervalId = null;
let csrIsSending = false;

function sendCsrConfig(ws) {
  const patientHeightCm = 170;
  const config = {
    type: "config",
    patient_height_cm: patientHeightCm,
    preferred_distance_band_m: [2.2, 2.8],
    camera_vertical_fov_deg: 60
  };
  ws.send(JSON.stringify(config));
}

function handleCsrMessage(raw) {
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    if (liveOutput) liveOutput.textContent = String(raw);
    return;
  }

  renderLiveOutput(data);

  if (data.type === "csr_final") {
    const reach = data.reach_cm_best;
    const side = data.test_side;
    const targetId = side === "left" ? "leftLeg" : side === "right" ? "rightLeg" : null;
    if (targetId && reach !== null && reach !== undefined) {
      const input = document.getElementById(targetId);
      if (input) input.value = Number(reach).toFixed(2);
    }
  }
}

function startCsrSocketLoop(fps = DEFAULT_FPS) {
  if (csrSocket && csrSocket.readyState === WebSocket.OPEN) return;

  const intervalMs = Math.max(100, Math.floor(1000 / fps));

  csrSocket = new WebSocket(CSR_WS_URL);
  csrSocket.onopen = () => {
    sendCsrConfig(csrSocket);
    if (liveOutput) liveOutput.textContent = "Connected. Streaming frames...";

    csrIntervalId = setInterval(async () => {
      if (csrIsSending || csrSocket.readyState !== WebSocket.OPEN) return;
      csrIsSending = true;
      try {
        const b64 = await captureFrameBase64Jpeg(0.7);
        const payload = {
          type: "frame",
          format: "jpg_base64",
          data: b64
        };
        csrSocket.send(JSON.stringify(payload));
      } catch (err) {
        if (liveOutput) liveOutput.textContent = String(err.message || err);
      } finally {
        csrIsSending = false;
      }
    }, intervalMs);
  };

  csrSocket.onmessage = (event) => handleCsrMessage(event.data);
  csrSocket.onerror = () => {
    if (liveOutput) liveOutput.textContent = "WebSocket error. Check backend.";
  };
  csrSocket.onclose = () => {
    if (csrIntervalId) clearInterval(csrIntervalId);
    csrIntervalId = null;
  };
}

function stopCsrSocketLoop() {
  if (csrIntervalId) clearInterval(csrIntervalId);
  csrIntervalId = null;

  if (csrSocket && csrSocket.readyState === WebSocket.OPEN) {
    csrSocket.send(JSON.stringify({ type: "end" }));
    csrSocket.close();
  }
  csrSocket = null;
}

function startAnalysisLoop(testId, fps = DEFAULT_FPS) {
  if (!testId) {
    alert("Missing test id in URL (?test=...)");
    return;
  }
  if (shouldUseCsrSocket(testId)) {
    cameraFeed?.addEventListener(
      "loadedmetadata",
      () => startCsrSocketLoop(fps),
      { once: true }
    );
    if (cameraFeed && cameraFeed.videoWidth > 0) startCsrSocketLoop(fps);
    return;
  }
  if (analysisIntervalId) return; // already running

  const intervalMs = Math.max(100, Math.floor(1000 / fps));

  analysisIntervalId = setInterval(async () => {
    // Prevent overlapping requests if backend is slow
    if (isSending) return;
    isSending = true;

    try {
      const data = await sendFrameToBackend(testId);
      renderLiveOutput(data);
    } catch (err) {
      if (liveOutput) liveOutput.textContent = String(err.message || err);
      console.error(err);
    } finally {
      isSending = false;
    }
  }, intervalMs);
}

function stopAnalysisLoop() {
  if (csrSocket) {
    stopCsrSocketLoop();
    return;
  }
  if (analysisIntervalId) clearInterval(analysisIntervalId);
  analysisIntervalId = null;
}

// Optional buttons (if present)
const startBtn = document.getElementById("startAnalysisBtn");
const stopBtn = document.getElementById("stopAnalysisBtn");

if (startBtn) {
  startBtn.addEventListener("click", () => {
    // ensure camera is ready
    cameraFeed?.addEventListener(
      "loadedmetadata",
      () => startAnalysisLoop(activeTestId),
      { once: true }
    );
    // If metadata already loaded, start immediately
    if (cameraFeed && cameraFeed.videoWidth > 0) startAnalysisLoop(activeTestId);
  });
}

if (stopBtn) {
  stopBtn.addEventListener("click", () => stopAnalysisLoop());
}

// If you want AUTO-START once video is ready, uncomment this:
/*
cameraFeed?.addEventListener("loadedmetadata", () => {
  startAnalysisLoop(testNameParam);
});
*/

// =========================
// 7) Handle manual form submission (existing behavior)
// =========================
const testForm = document.getElementById("testForm");
if (testForm) {
  testForm.addEventListener("submit", function (e) {
    e.preventDefault();

    let results = {};
    (testData?.inputs || []).forEach(field => {
      const el = document.getElementById(field.id);
      results[field.id] = el ? el.value : null;
    });

    const notes = document.getElementById("notes")?.value || "";

    alert(
      `Results Submitted for ${testData?.name || testNameParam}:\n` +
      `${JSON.stringify(results, null, 2)}\n\nNotes: ${notes}`
    );

    this.reset();
  });
}
const nextBtn = document.getElementById("nextTestBtn");

if (nextBtn) {
  nextBtn.addEventListener("click", () => {
    const queue = JSON.parse(localStorage.getItem("fft_test_queue_v1") || "null");
    if (!queue || !queue.tests || queue.tests.length === 0) {
      alert("No test queue found. Go back and select tests.");
      return;
    }

    queue.currentIndex += 1;
    localStorage.setItem("fft_test_queue_v1", JSON.stringify(queue));

    if (queue.currentIndex >= queue.tests.length) {
      alert("All selected tests completed. Returning to dashboard.");
      window.location.href = "../dashboard.html";
      return;
    }

    const nextTest = queue.tests[queue.currentIndex];
    window.location.href = `test-template.html?test=${encodeURIComponent(nextTest)}&patient=${encodeURIComponent(queue.patientId)}`;
  });
}


// =========================
// 8) Cleanup camera when leaving page
// =========================
window.addEventListener("beforeunload", () => {
  stopAnalysisLoop();
  const stream = cameraFeed?.srcObject;
  if (stream && typeof stream.getTracks === "function") {
    stream.getTracks().forEach(t => t.stop());
  }
});
