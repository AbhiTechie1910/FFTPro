import { apiClient } from "../core/api-client.js";
import { storageManager } from "../core/storage-manager.js";
import { debug } from "../utils/debug.js";

document.addEventListener("DOMContentLoaded", () => {
  debug.log("patient-intake.js loaded (DB mode - demographics)");

  const patientForm = document.getElementById("patientForm");
  const resetBtn = document.getElementById("resetBtn");
  const ageSelect = document.getElementById("age");
  const painSelect = document.getElementById("painScore");

  if (!patientForm) {
    debug.error("Missing #patientForm in HTML. Save cannot work.");
    alert("Error: patientForm not found. Check patient-intake.html IDs.");
    return;
  }

  function populateSelectRange(selectEl, start, end) {
    if (!selectEl) return;

    const existingValues = new Set(
      [...selectEl.options].map((option) => String(option.value))
    );

    for (let i = start; i <= end; i += 1) {
      const value = String(i);
      if (existingValues.has(value)) continue;

      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      selectEl.appendChild(option);
    }
  }

  function getFormRefs() {
    return {
      fullNameEl: document.getElementById("fullName"),
      ageEl: document.getElementById("age"),
      genderEl: document.getElementById("gender"),
      heightEl: document.getElementById("heightCm"),
      weightEl: document.getElementById("weightKg"),
      painEl: document.getElementById("painScore"),
      nationalityEl: document.getElementById("nationality"),
    };
  }

  function validateRefs(refs) {
    const requiredRefs = [
      ["fullName", refs.fullNameEl],
      ["age", refs.ageEl],
      ["gender", refs.genderEl],
      ["heightCm", refs.heightEl],
      ["weightKg", refs.weightEl],
      ["painScore", refs.painEl],
    ];

    const missing = requiredRefs
      .filter(([, el]) => !el)
      .map(([name]) => name);

    if (missing.length) {
      alert(`Form inputs missing. Check IDs: ${missing.join(", ")}`);
      return false;
    }

    return true;
  }

  function buildPayload(refs) {
    const full_name = refs.fullNameEl.value.trim();
    const age = Number(refs.ageEl.value);
    const gender = refs.genderEl.value.trim();
    const height_cm = Number(refs.heightEl.value);
    const weight_kg = Number(refs.weightEl.value);
    const pain_score = Number(refs.painEl.value);
    const nationality = refs.nationalityEl ? refs.nationalityEl.value.trim() : "";

    return {
      full_name,
      age,
      gender,
      height_cm,
      weight_kg,
      pain_score,
      nationality: nationality || null,
    };
  }

  function validatePayload(payload) {
    if (!payload.full_name) return "Full name is required.";
    if (!payload.age || payload.age < 1) return "Valid age is required.";
    if (!payload.gender) return "Gender is required.";
    if (!payload.height_cm || payload.height_cm <= 0) return "Valid height is required.";
    if (!payload.weight_kg || payload.weight_kg <= 0) return "Valid weight is required.";
    if (Number.isNaN(payload.pain_score) || payload.pain_score < 0 || payload.pain_score > 10) {
      return "Pain score must be between 0 and 10.";
    }

    return null;
  }

  function normalizeSavedPatient(saved) {
    const patientId =
      saved.patient_id ??
      saved.demographic_id ??
      saved.id ??
      null;

    const fullName =
      saved.full_name ??
      saved.fullName ??
      "";

    return {
      id: patientId,
      patient_id: patientId,
      patientId: patientId,

      full_name: fullName,
      fullName: fullName,

      age: Number(saved.age ?? 0),
      gender: saved.gender ?? "",
      sex: saved.gender ?? "",

      height_cm: Number(saved.height_cm ?? 0),
      heightCm: Number(saved.height_cm ?? 0),

      weight_kg: Number(saved.weight_kg ?? 0),
      weightKg: Number(saved.weight_kg ?? 0),

      pain_score: Number(saved.pain_score ?? 0),
      painScore: Number(saved.pain_score ?? 0),

      nationality: saved.nationality ?? "",

      consent_given: false,
      consent_timestamp: null,

      created_at:
        saved.created_at ??
        saved.test_date ??
        new Date().toISOString(),
    };
  }

  async function savePatient(payload) {
    const response = await apiClient.post("/api/demographics", payload);

    if (!response.ok) {
      throw new Error(response.message || "Failed to save patient.");
    }

    const saved =
      response.data?.demographic ??
      response.data?.patient ??
      response.data?.data ??
      response.data;

    if (!saved) {
      throw new Error("Backend returned no patient data.");
    }

    const patient = normalizeSavedPatient(saved);

    if (!patient.patientId) {
      throw new Error("Backend did not return a patient ID.");
    }

    return patient;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const refs = getFormRefs();

    if (!validateRefs(refs)) return;

    const payload = buildPayload(refs);
    const validationError = validatePayload(payload);

    if (validationError) {
      alert(validationError);
      return;
    }

    try {
      const patient = await savePatient(payload);

      storageManager.setActivePatient(patient);

      debug.log("Saved patient:", patient);

      patientForm.reset();

      window.location.href = `consent.html?patient=${encodeURIComponent(patient.patientId)}`;
    } catch (error) {
      debug.error("Save patient failed:", error);
      alert(`Failed to save patient: ${error.message}`);
    }
  }

  function handleReset() {
    patientForm.reset();
  }

  patientForm.addEventListener("submit", handleSubmit);
  resetBtn?.addEventListener("click", handleReset);

  populateSelectRange(ageSelect, 1, 120);
  populateSelectRange(painSelect, 0, 10);
});