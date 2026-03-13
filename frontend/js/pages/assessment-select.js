import { storageManager } from "../core/storage-manager.js";
import { apiClient } from "../core/api-client.js";
import { debug } from "../utils/debug.js";

document.addEventListener("DOMContentLoaded", async () => {
  const ACTIVE_PATIENT_KEY = "fft_active_patient_v1";
  const QUEUE_KEY = "fft_test_queue_v1";
  const TOKEN_KEY = "fft_token";
  const USER_KEY = "fft_logged_user";

  const TEST_ROUTES = {
    chair_sit_reach: "test/chair-sit-reach.html",
    chair_sit_to_stand: "test/chair-stand.html",
    single_leg_stance: "test/single-leg-stance.html",
    back_scratch: "test/back-scratch.html",
    tug_test: "test/eight-foot-up-go.html",
    arm_curl: "test/arm-curl.html",
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

  const token =
    localStorage.getItem(TOKEN_KEY) ||
    sessionStorage.getItem(TOKEN_KEY);

  if (!token) {
    window.location.href = "auth.html";
    return;
  }

  if (!form) {
    alert("Assessment form not found.");
    return;
  }

  function normalizePatient(raw) {
    if (!raw) return null;

    const patientId =
      raw.patient_id ??
      raw.demographic_id ??
      raw.id ??
      raw.patientId ??
      null;

    const fullName =
      raw.full_name ??
      raw.fullName ??
      "";

    const gender =
      raw.gender ??
      raw.sex ??
      "";

    const heightCm =
      raw.height_cm ??
      raw.heightCm ??
      null;

    const weightKg =
      raw.weight_kg ??
      raw.weightKg ??
      null;

    const painScore =
      raw.pain_score ??
      raw.painScore ??
      null;

    const consentSigned =
      raw.consent_signed ??
      raw.consentSigned ??
      raw.consent_given ??
      raw.consentGiven ??
      false;

    return {
      id: patientId,
      patient_id: patientId,
      patientId: patientId,

      full_name: fullName,
      fullName: fullName,

      age: raw.age ?? null,

      gender,
      sex: gender,

      height_cm: heightCm,
      heightCm,

      weight_kg: weightKg,
      weightKg,

      pain_score: painScore,
      painScore,

      nationality: raw.nationality ?? "",

      consent_signed: Boolean(consentSigned),
      consentSigned: Boolean(consentSigned),

      test_date: raw.test_date ?? null,
      created_at: raw.created_at ?? raw.test_date ?? null,
    };
  }

  async function verifySession() {
    try {
      const response = await fetch("http://127.0.0.1:5000/api/auth/me", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error("Session invalid");
      }

      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      return true;
    } catch (error) {
      debug.error("Assessment select auth error:", error);

      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(ACTIVE_PATIENT_KEY);

      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(ACTIVE_PATIENT_KEY);

      window.location.href = "auth.html";
      return false;
    }
  }

  async function fetchPatientById(patientId) {
    try {
      const result = await apiClient.get(`/api/patients/${encodeURIComponent(patientId)}`);

      if (!result.ok) {
        throw new Error(result.message || "Failed to load patient");
      }

      const patient =
        result.data?.patient ??
        result.data?.data ??
        result.data;

      return normalizePatient(patient);
    } catch (error) {
      debug.error("Fetch patient failed:", error);
      return null;
    }
  }

  function getStoredActivePatient() {
    try {
      const raw =
        storageManager.getActivePatient?.() ??
        storageManager.get?.(ACTIVE_PATIENT_KEY, null) ??
        null;

      return normalizePatient(raw);
    } catch (error) {
      debug.error("Failed to parse active patient:", error);
      return null;
    }
  }

  function setActivePatient(patient) {
    storageManager.setActivePatient(patient);
  }

  function renderPatient(patient) {
    if (!patient) return;

    if (patientNameEl) {
      patientNameEl.textContent = patient.fullName || "—";
    }

    if (patientIdEl) {
      patientIdEl.textContent = patient.patientId || "—";
    }

    if (patientAgeGenderEl) {
      patientAgeGenderEl.textContent =
        `Age: ${patient.age ?? "—"} | Gender: ${patient.gender || "—"}`;
    }

    if (patientHeightWeightEl) {
      patientHeightWeightEl.textContent =
        `Height: ${patient.heightCm ?? "—"} cm | Weight: ${patient.weightKg ?? "—"} kg`;
    }

    if (patientPainScoreEl) {
      patientPainScoreEl.textContent =
        `Pain Score: ${patient.painScore ?? "—"}`;
    }

    if (consentStatusEl) {
      consentStatusEl.textContent = patient.consentSigned ? "Signed" : "Pending";
    }

    if (consentTimestampEl) {
      consentTimestampEl.textContent = patient.test_date
        ? new Date(patient.test_date).toLocaleDateString()
        : "—";
    }
  }

  function getSelectedTests() {
    return Array.from(
      document.querySelectorAll(".tests input[type='checkbox']:checked")
    ).map((checkbox) => checkbox.value);
  }

  function buildQueue(patient, tests) {
    return {
      patientId: patient.patientId,
      tests,
      currentIndex: 0,
      startedAt: new Date().toISOString(),
      completed: false,
    };
  }

  function startAssessmentQueue(patient, validTests) {
    const queue = buildQueue(patient, validTests);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));

    const firstTestKey = validTests[0];
    const firstTestRoute = TEST_ROUTES[firstTestKey];

    window.location.href =
      `${firstTestRoute}?patient=${encodeURIComponent(patient.patientId)}&test=${encodeURIComponent(firstTestKey)}`;
  }

  const sessionOk = await verifySession();
  if (!sessionOk) return;

  let activePatient = null;

  if (patientIdFromUrl) {
    activePatient = await fetchPatientById(patientIdFromUrl);
  }

  if (!activePatient) {
    activePatient = getStoredActivePatient();
  }

  if (!activePatient || !activePatient.patientId) {
    alert("No patient found. Please select a patient first.");
    window.location.href = "dashboard.html";
    return;
  }

  setActivePatient(activePatient);
  renderPatient(activePatient);

  if (!activePatient.consentSigned) {
    window.location.href =
      `consent.html?patient=${encodeURIComponent(activePatient.patientId)}`;
    return;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const checkedTests = getSelectedTests();

    if (checkedTests.length === 0) {
      alert("Please select at least one assessment.");
      return;
    }

    const validTests = checkedTests.filter((test) => TEST_ROUTES[test]);

    if (validTests.length === 0) {
      alert("Selected assessments are invalid.");
      return;
    }

    startAssessmentQueue(activePatient, validTests);
  });

  cancelBtn?.addEventListener("click", () => {
    window.location.href = "dashboard.html";
  });
});