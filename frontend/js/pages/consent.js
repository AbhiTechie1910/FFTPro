import { apiClient } from "../core/api-client.js";
import { storageManager } from "../core/storage-manager.js";
import { debug } from "../utils/debug.js";

document.addEventListener("DOMContentLoaded", async () => {
  const PROFILE_KEY = "fft_therapist_profile_v1";
  const CONSENT_VERSION = "v1.0";
  const FALLBACK_STAMP = "../assets/clinic/clinic-stamp.png";

  const patientNameEl = document.getElementById("patientName");
  const patientIdEl = document.getElementById("patientId");
  const patientAgeGenderEl = document.getElementById("patientAgeGender");
  const patientNationalityEl = document.getElementById("patientNationality");
  const patientHeightWeightEl = document.getElementById("patientHeightWeight");
  const patientPainScoreEl = document.getElementById("patientPainScore");

  const therapistNameEl = document.getElementById("therapistName");
  const clinicNameEl = document.getElementById("clinicName");
  const clinicStampImg = document.getElementById("clinicStamp");

  const tsEl = document.getElementById("consentTimestamp");
  const verEl = document.getElementById("consentVersion");

  const consentCheck = document.getElementById("consentCheck");
  const startBtn = document.getElementById("startBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const downloadPdfBtn = document.getElementById("downloadPdfBtn");

  const params = new URLSearchParams(window.location.search);
  const patientIdFromUrl = params.get("patient");

  let activePatient = null;
  let consentIso = "";

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
      nationality: raw.nationality ?? "",

      height_cm: heightCm,
      heightCm,

      weight_kg: weightKg,
      weightKg,

      pain_score: painScore,
      painScore,

      consent_signed: Boolean(consentSigned),
      consentSigned: Boolean(consentSigned),

      test_date: raw.test_date ?? null,
    };
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
      debug.error("Consent page: failed to fetch patient", error);
      return null;
    }
  }

  function getStoredActivePatient() {
    try {
      const raw = storageManager.getActivePatient();
      return normalizePatient(raw);
    } catch (error) {
      debug.error("Consent page: failed to parse active patient", error);
      return null;
    }
  }

  function getTherapistProfile() {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null") || {};
    } catch (error) {
      debug.error("Consent page: failed to parse therapist profile", error);
      return {};
    }
  }

  function renderPatient(patient) {
    if (!patient) return;

    if (patientNameEl) patientNameEl.textContent = patient.fullName || "—";
    if (patientIdEl) patientIdEl.textContent = patient.patientId || "—";

    if (patientAgeGenderEl) {
      patientAgeGenderEl.textContent =
        `Age: ${patient.age ?? "—"} | Gender: ${patient.gender || "—"}`;
    }

    if (patientNationalityEl) {
      patientNationalityEl.textContent = patient.nationality
        ? `Nationality: ${patient.nationality}`
        : "Nationality: —";
    }

    if (patientHeightWeightEl) {
      patientHeightWeightEl.textContent =
        `Height: ${patient.heightCm ?? "—"} cm | Weight: ${patient.weightKg ?? "—"} kg`;
    }

    if (patientPainScoreEl) {
      patientPainScoreEl.textContent =
        `Pain Score: ${patient.painScore ?? "—"}`;
    }
  }

  function renderTherapistProfile(profile) {
    const therapistName = profile.therapistName || "—";
    const clinicName = profile.clinicName || "—";
    const stampSrc = profile.stampDataUrl || FALLBACK_STAMP;

    if (therapistNameEl) therapistNameEl.textContent = therapistName;
    if (clinicNameEl) clinicNameEl.textContent = clinicName;
    if (clinicStampImg) clinicStampImg.src = stampSrc;

    return {
      therapistName,
      clinicName,
      stampSrc,
    };
  }

  function renderConsentState(patient) {
    if (verEl) verEl.textContent = CONSENT_VERSION;

    if (patient?.consentSigned) {
      consentCheck.checked = true;
      startBtn.disabled = false;
      consentIso = new Date().toISOString();
      if (tsEl) tsEl.textContent = new Date(consentIso).toLocaleString();
    } else {
      consentCheck.checked = false;
      startBtn.disabled = true;
      consentIso = "";
      if (tsEl) tsEl.textContent = "—";
    }
  }

  function updateConsentPreview() {
    if (!consentCheck || !startBtn || !tsEl) return;

    startBtn.disabled = !consentCheck.checked;

    if (consentCheck.checked) {
      if (!consentIso) {
        consentIso = new Date().toISOString();
      }
      tsEl.textContent = new Date(consentIso).toLocaleString();
    } else {
      consentIso = "";
      tsEl.textContent = "—";
    }
  }

  async function saveConsent(patient) {
    const result = await apiClient.patch(
      `/api/patients/${encodeURIComponent(patient.patientId)}/consent`,
      { consent_signed: true }
    );

    if (!result.ok) {
      throw new Error(result.message || "Failed to save consent.");
    }

    const saved =
      result.data?.patient ??
      result.data?.data ??
      result.data ??
      {};

    const merged = normalizePatient({
      ...patient,
      ...saved,
      consent_signed: true,
    });

    storageManager.setActivePatient(merged);
    return merged;
  }

  async function loadImageAsDataURL(url) {
    const response = await fetch(url);
    const blob = await response.blob();

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function wrapText(doc, text, x, y, maxWidth, lineHeight) {
    const lines = doc.splitTextToSize(text, maxWidth);
    lines.forEach((line, index) => {
      doc.text(line, x, y + index * lineHeight);
    });
    return y + lines.length * lineHeight;
  }

  async function downloadConsentPdf(patient, therapistName, clinicName, stampSrc) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert("PDF library not loaded.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 44;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("FFTPro — Digital Informed Consent & Data Use Agreement", margin, 56);

    doc.setDrawColor(229, 231, 235);
    doc.line(margin, 70, pageW - margin, 70);

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Patient Details", margin, 98);

    doc.setFont("helvetica", "normal");
    doc.text(`Name: ${patient.fullName || "—"}`, margin, 118);
    doc.text(`Patient ID: ${patient.patientId || "—"}`, margin, 134);
    doc.text(`Age/Gender: ${patient.age ?? "—"} / ${patient.gender ?? "—"}`, margin, 150);
    doc.text(`Nationality: ${patient.nationality || "—"}`, margin, 166);
    doc.text(
      `Height/Weight: ${patient.heightCm ?? "—"} cm / ${patient.weightKg ?? "—"} kg`,
      margin,
      182
    );
    doc.text(`Pain Score: ${patient.painScore ?? "—"}`, margin, 198);

    doc.setFont("helvetica", "bold");
    doc.text("Therapist / Clinic", pageW / 2 + 10, 98);

    doc.setFont("helvetica", "normal");
    doc.text(`Therapist: ${therapistName}`, pageW / 2 + 10, 118);
    doc.text(`Clinic: ${clinicName}`, pageW / 2 + 10, 134);

    try {
      const stampDataUrl = await loadImageAsDataURL(stampSrc);
      doc.addImage(stampDataUrl, "PNG", pageW - margin - 140, 92, 140, 70);
    } catch (error) {
      debug.warn("Consent PDF: clinic stamp could not be loaded", error);
    }

    doc.setFont("helvetica", "bold");
    doc.text("Time and Date", margin, 230);

    doc.setFont("helvetica", "normal");
    const tsDisplay = consentIso
      ? new Date(consentIso).toLocaleString()
      : new Date().toLocaleString();

    doc.text(`Timestamp: ${tsDisplay}`, margin, 250);

    let y = 290;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Consent Terms (Summary)", margin, y);
    y += 18;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    const terms = [
      "1) Purpose: FFTPro assessments evaluate functional fitness parameters including strength, balance, flexibility, endurance and mobility to support clinical documentation and progress tracking.",
      "2) Data Collected: Demographics, assessment results, clinician observations, derived measurements such as angles, distances and timing, and visual or motion inputs where required for analysis.",
      "3) Video/Image Use: Video and image data is processed solely for clinical assessment, measurement and reporting within FFTPro.",
      "4) Storage & Security: Data is stored using reasonable safeguards and access controls to reduce unauthorized access or disclosure.",
      "5) Confidentiality: Data is treated as confidential healthcare information and disclosed only where legally required, explicitly authorized, or operationally necessary within permitted limits.",
      "6) Voluntary Participation: Participation is voluntary and consent may be withdrawn, though this may affect completion or retention of records as permitted.",
      "7) Limitation: FFTPro is a support tool; clinical interpretation remains with the therapist.",
    ].join("\n\n");

    y = wrapText(doc, terms, margin, y, pageW - margin * 2, 14);

    y += 10;
    doc.setFont("helvetica", "bold");
    doc.text("Patient Declaration", margin, y);
    y += 18;

    doc.setFont("helvetica", "normal");
    const declaration =
      "I confirm that I have read and understood this consent and voluntarily agree to the collection, processing and secure storage of my demographic and assessment-related data for clinical purposes as described above.";

    y = wrapText(doc, declaration, margin, y, pageW - margin * 2, 14);

    y += 26;
    doc.setDrawColor(100, 116, 139);
    doc.line(margin, y, margin + 220, y);
    doc.line(pageW / 2 + 10, y, pageW / 2 + 230, y);

    doc.setFont("helvetica", "normal");
    doc.text("Patient Signature", margin, y + 14);
    doc.text("Therapist Signature", pageW / 2 + 10, y + 14);

    doc.setDrawColor(229, 231, 235);
    doc.line(margin, pageH - 62, pageW - margin, pageH - 62);

    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Generated by FFTPro • Consent ${CONSENT_VERSION} • Patient: ${patient.patientId} • ${new Date().toLocaleString()}`,
      margin,
      pageH - 42
    );

    const safeName = (patient.fullName || "Patient").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `FFTPro_Consent_${patient.patientId}_${safeName}.pdf`;

    doc.save(filename);
  }

  if (!consentCheck || !startBtn || !cancelBtn || !downloadPdfBtn) {
    alert("Consent page is missing required elements.");
    return;
  }

  if (patientIdFromUrl) {
    activePatient = await fetchPatientById(patientIdFromUrl);
  }

  if (!activePatient) {
    activePatient = getStoredActivePatient();
  }

  if (!activePatient || !activePatient.patientId) {
    alert("No patient found. Please save a patient first.");
    window.location.href = "patient-intake.html";
    return;
  }

  storageManager.setActivePatient(activePatient);

  const profile = getTherapistProfile();
  const { therapistName, clinicName, stampSrc } = renderTherapistProfile(profile);

  renderPatient(activePatient);
  renderConsentState(activePatient);

  consentCheck.addEventListener("change", updateConsentPreview);

  cancelBtn.addEventListener("click", () => {
    window.location.href = "patient-intake.html";
  });

  startBtn.addEventListener("click", async () => {
    if (!consentCheck.checked) return;

    try {
      startBtn.disabled = true;

      activePatient = await saveConsent(activePatient);

      window.location.href =
        `assessment-select.html?patient=${encodeURIComponent(activePatient.patientId)}`;
    } catch (error) {
      debug.error("Consent save failed:", error);
      alert(`Failed to save consent: ${error.message}`);
      startBtn.disabled = false;
    }
  });

  downloadPdfBtn.addEventListener("click", async () => {
    try {
      await downloadConsentPdf(activePatient, therapistName, clinicName, stampSrc);
    } catch (error) {
      debug.error("Consent PDF generation failed:", error);
      alert("Failed to generate consent PDF.");
    }
  });
});