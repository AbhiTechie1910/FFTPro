import { apiClient } from "../core/api-client.js";
import { storageManager } from "../core/storage-manager.js";
import { debug } from "../utils/debug.js";

document.addEventListener("DOMContentLoaded", async () => {
  const STORAGE_KEY_ACTIVE_PATIENT = "fft_active_patient_v1";
  const STORAGE_KEY_TOKEN = "fft_token";
  const STORAGE_KEY_USER = "fft_logged_user";

  const currentDateEl = document.getElementById("currentDate");
  const totalPatientsEl = document.getElementById("totalPatients");
  const patientsTableBody = document.querySelector("#patientsTable tbody");
  const searchInput = document.getElementById("searchPatient");

  const userNameEl = document.getElementById("userName");
  const userRoleEl = document.getElementById("userRole");
  const userBtn = document.getElementById("userBtn");
  const userMenu = document.getElementById("userMenu");
  const userDropdown = document.getElementById("userDropdown");
  const logoutBtn = document.getElementById("logoutBtn");

  let patients = [];

  const token =
    localStorage.getItem(STORAGE_KEY_TOKEN) ||
    sessionStorage.getItem(STORAGE_KEY_TOKEN);

  if (!token) {
    window.location.href = "auth.html";
    return;
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

      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(data.user));

      if (userNameEl) userNameEl.textContent = data.user.name || "User";
      if (userRoleEl) userRoleEl.textContent = data.user.role || "Staff";
    } catch (error) {
      debug.error("Dashboard auth error:", error);

      localStorage.removeItem(STORAGE_KEY_TOKEN);
      localStorage.removeItem(STORAGE_KEY_USER);
      localStorage.removeItem(STORAGE_KEY_ACTIVE_PATIENT);

      sessionStorage.removeItem(STORAGE_KEY_TOKEN);
      sessionStorage.removeItem(STORAGE_KEY_USER);
      sessionStorage.removeItem(STORAGE_KEY_ACTIVE_PATIENT);

      window.location.href = "auth.html";
    }
  }

  async function loadPatients() {
    try {
      const result = await apiClient.get("/api/patients");

      if (!result.ok) {
        throw new Error(result.message);
      }

      const data =
        result.data?.patients ||
        result.data?.data ||
        result.data ||
        [];

      patients = data.map(normalizePatient);
      renderPatientsTable();
    } catch (error) {
      debug.error("Failed loading patients:", error);

      if (patientsTableBody) {
        patientsTableBody.innerHTML = `
          <tr>
            <td colspan="6">Failed to load patients.</td>
          </tr>
        `;
      }
    }
  }

  function normalizePatient(p) {
    const patientId =
      p.patient_id ??
      p.id ??
      p.patientId ??
      "";

    const fullName =
      p.full_name ??
      p.fullName ??
      "";

    return {
      patientId,
      fullName,
      age: p.age ?? "—",
      gender: p.gender ?? p.sex ?? "—",
      nationality: p.nationality ?? "—",
      createdAt: p.created_at ?? p.test_date ?? null,
    };
  }

  function formatDatePretty(iso) {
    if (!iso) return "—";

    const d = new Date(iso);
    if (isNaN(d)) return "—";

    return d.toLocaleDateString();
  }

  function setToday() {
    if (!currentDateEl) return;

    const now = new Date();

    currentDateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function updateSummary() {
    if (totalPatientsEl) {
      totalPatientsEl.textContent = patients.length;
    }
  }

  function renderPatientsTable(filterText = "") {
    if (!patientsTableBody) return;

    updateSummary();

    const q = filterText.trim().toLowerCase();

    const filtered = !q
      ? [...patients]
      : patients.filter((p) => {
          return (
            String(p.patientId).toLowerCase().includes(q) ||
            String(p.fullName).toLowerCase().includes(q)
          );
        });

    patientsTableBody.innerHTML = "";

    if (filtered.length === 0) {
      patientsTableBody.innerHTML = `
        <tr>
          <td colspan="6">No patients found</td>
        </tr>
      `;
      return;
    }

    filtered.forEach((p) => {
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${p.patientId}</td>
        <td>${p.fullName}</td>
        <td>${p.age}</td>
        <td>${p.gender}</td>
        <td>${formatDatePretty(p.createdAt)}</td>
        <td>
          <button class="action-btn view-btn" data-id="${p.patientId}">
            View
          </button>

          <button class="action-btn assess-btn" data-id="${p.patientId}">
            Assess
          </button>

          <button class="action-btn delete-btn" data-id="${p.patientId}">
            Delete
          </button>
        </td>
      `;

      patientsTableBody.appendChild(tr);
    });
  }

  async function handleTableClick(e) {
    const btn = e.target.closest("button");
    if (!btn) return;

    const patientId = btn.dataset.id;
    if (!patientId) return;

    const patient = patients.find((p) => String(p.patientId) === String(patientId));

    if (!patient) {
      alert("Patient not found.");
      return;
    }

    if (btn.classList.contains("view-btn")) {
      const msg =
        `Patient: ${patient.fullName}\n` +
        `ID: ${patient.patientId}\n` +
        `Age: ${patient.age}\n` +
        `Gender: ${patient.gender}\n` +
        `Nationality: ${patient.nationality}\n` +
        `Created: ${formatDatePretty(patient.createdAt)}`;

      alert(msg);
      return;
    }

    if (btn.classList.contains("assess-btn")) {
      storageManager.setActivePatient(patient);
      window.location.href = "assessment-select.html";
      return;
    }

    if (btn.classList.contains("delete-btn")) {
      const ok = confirm(`Delete patient ${patientId}?`);
      if (!ok) return;

      try {
        const result = await apiClient.delete(`/api/patients/${patientId}`);

        if (!result.ok) {
          throw new Error(result.message);
        }

        patients = patients.filter((p) => String(p.patientId) !== String(patientId));
        renderPatientsTable(searchInput?.value || "");
      } catch (error) {
        debug.error("Delete patient failed:", error);
        alert("Failed to delete patient.");
      }
    }
  }

  if (userBtn && userDropdown) {
    userBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle("show");
    });

    document.addEventListener("click", (e) => {
      if (userMenu && !userMenu.contains(e.target)) {
        userDropdown.classList.remove("show");
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", (e) => {
      e.preventDefault();

      localStorage.removeItem(STORAGE_KEY_TOKEN);
      localStorage.removeItem(STORAGE_KEY_USER);
      localStorage.removeItem(STORAGE_KEY_ACTIVE_PATIENT);

      sessionStorage.removeItem(STORAGE_KEY_TOKEN);
      sessionStorage.removeItem(STORAGE_KEY_USER);
      sessionStorage.removeItem(STORAGE_KEY_ACTIVE_PATIENT);

      window.location.href = "auth.html";
    });
  }

  setToday();

  await verifySession();
  await loadPatients();

  patientsTableBody?.addEventListener("click", handleTableClick);

  searchInput?.addEventListener("input", () => {
    renderPatientsTable(searchInput.value);
  });

  window.addEventListener("focus", () => {
    renderPatientsTable(searchInput?.value || "");
  });
});