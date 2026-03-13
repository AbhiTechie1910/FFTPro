export function formatMsToClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatPatientName(patient) {
  if (!patient) return "No active patient";
  const first = patient.first_name || patient.firstName || "";
  const last = patient.last_name || patient.lastName || "";
  const fullName = `${first} ${last}`.trim();

  if (!fullName) return "Unnamed patient";
  return fullName;
}

export function formatPatientSubtitle(patient) {
  if (!patient) return "No active patient selected";

  const age = patient.age ?? "N/A";
  const sex = patient.sex || patient.gender || "N/A";
  const id = patient.id || patient.patient_id || "N/A";

  return `ID: ${id} • Age: ${age} • Sex: ${sex}`;
}

export function safeText(value, fallback = "-") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}