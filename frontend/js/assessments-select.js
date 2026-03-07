document.addEventListener("DOMContentLoaded", () => {

  const PATIENTS_KEY = "fft_patients_v1";
  const ACTIVE_PATIENT_KEY = "fft_active_patient_v1";
  const QUEUE_KEY = "fft_test_queue_v1";
  const RESULTS_KEY = "fft_results_v1";

  // Map each test value → actual page
  const TEST_ROUTES = {
    chair_sit_reach: "chair-sit-reach.html",
    chair_sit_to_stand: "chair-stand.html",
    single_leg_stance: "single-leg-stance.html",
    back_scratch: "back-scratch.html",
    tug_test: "tug.html"
  };

  const patientNameEl = document.getElementById("patientName");
  const patientIdEl = document.getElementById("patientId");
  const patientAgeGenderEl = document.getElementById("patientAgeGender");
  const patientHeightWeightEl = document.getElementById("patientHeightWeight");
  const patientPainScoreEl = document.getElementById("patientPainScore");
  const consentStatusEl = document.getElementById("consentStatus");
  const consentTimestampEl = document.getElementById("consentTimestamp");

  const form = document.getElementById("assessmentForm");
  const cancelBtn = document.getElementById("cancelBtn");

  const params = new URLSearchParams(window.location.search);
  const patientIdFromUrl = params.get("patient");

  const patients = JSON.parse(localStorage.getItem(PATIENTS_KEY) || "[]");
  let activePatient = null;

  // ------------------------------
  // Resolve Active Patient
  // ------------------------------
  if (patientIdFromUrl) {
    activePatient = patients.find(p => p.patientId === patientIdFromUrl) || null;
  }

  if (!activePatient) {
    activePatient = JSON.parse(localStorage.getItem(ACTIVE_PATIENT_KEY) || "null");
  }

  if (!activePatient || !activePatient.patientId) {
    alert("No patient found. Please add a patient first.");
    window.location.href = "patient-intake.html";
    return;
  }

  if (!activePatient.consentGiven) {
    window.location.href =
      `consent.html?patient=${encodeURIComponent(activePatient.patientId)}`;
    return;
  }

  localStorage.setItem(ACTIVE_PATIENT_KEY, JSON.stringify(activePatient));

  // ------------------------------
  // Populate UI
  // ------------------------------
  patientNameEl.textContent = activePatient.fullName || "—";
  patientIdEl.textContent = activePatient.patientId || "—";
  patientAgeGenderEl.textContent =
    `Age: ${activePatient.age ?? "—"} | Gender: ${activePatient.gender ?? "—"}`;
  patientHeightWeightEl.textContent =
    `Height: ${activePatient.heightCm ?? "—"} cm | Weight: ${activePatient.weightKg ?? "—"} kg`;
  patientPainScoreEl.textContent =
    `Pain Score: ${activePatient.painScore ?? "—"}`;

  consentStatusEl.textContent = "Signed";
  consentTimestampEl.textContent =
    activePatient.consentTimestamp
      ? new Date(activePatient.consentTimestamp).toLocaleString()
      : "—";

  // ------------------------------
  // Handle Start Assessments
  // ------------------------------
  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const checked = Array.from(
      document.querySelectorAll(".tests input[type='checkbox']:checked")
    ).map(cb => cb.value);

    if (checked.length === 0) {
      alert("Please select at least one assessment.");
      return;
    }

    // Remove any invalid test values
    const validTests = checked.filter(test => TEST_ROUTES[test]);

    if (validTests.length === 0) {
      alert("Selected assessments are invalid.");
      return;
    }

    // Reset old results
    localStorage.removeItem(RESULTS_KEY);

    const queue = {
      patientId: activePatient.patientId,
      tests: validTests,
      currentIndex: 0,
      startedAt: new Date().toISOString(),
      completed: false
    };

    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));

    // Navigate to first test
    const firstTestKey = validTests[0];
    const firstTestRoute = TEST_ROUTES[firstTestKey];

    window.location.href =
      `${firstTestRoute}?patient=${encodeURIComponent(activePatient.patientId)}`;
  });

  // ------------------------------
  // Cancel
  // ------------------------------
  cancelBtn.addEventListener("click", () => {
    window.location.href = "dashboard.html";
  });

});