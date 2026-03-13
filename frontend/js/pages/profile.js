import { apiClient } from "../core/api-client.js";
import { storageManager } from "../core/storage-manager.js";
import { debug } from "../utils/debug.js";

document.addEventListener("DOMContentLoaded", async () => {
  const PROFILE_KEY = "fft_therapist_profile_v1";
  const TOKEN_KEY = "fft_token";
  const USER_KEY = "fft_logged_user";

  const editProfileBtn = document.getElementById("editProfileBtn");
  const cancelEditBtn = document.getElementById("cancelEditBtn");
  const saveProfileBtn = document.getElementById("saveProfileBtn");
  const changePasswordBtn = document.getElementById("changePasswordBtn");
  const logoutLink = document.getElementById("logoutLink");

  const topbarUserNameEl = document.getElementById("topbarUserName");
  const topbarUserRoleEl = document.getElementById("topbarUserRole");
  const currentDateEl = document.getElementById("currentDate");
  const userMenuBtn = document.getElementById("userMenuBtn");
  const userDropdown = document.getElementById("userDropdown");

  const therapistNameEl = document.getElementById("therapistName");
  const therapistRoleEl = document.getElementById("therapistRole");
  const licenseNoEl = document.getElementById("licenseNo");
  const experienceYearsEl = document.getElementById("experienceYears");
  const emailEl = document.getElementById("email");
  const phoneEl = document.getElementById("phone");
  const clinicNameEl = document.getElementById("clinicName");
  const clinicAddressEl = document.getElementById("clinicAddress");
  const timezoneEl = document.getElementById("timezone");
  const languageEl = document.getElementById("language");

  const logoPreviewEl = document.getElementById("logoPreview");
  const stampPreviewEl = document.getElementById("stampPreview");
  const logoInputEl = document.getElementById("logoInput");
  const stampInputEl = document.getElementById("stampInput");

  const privacyEmailEl = document.getElementById("privacyEmail");
  const defaultDisclaimerEl = document.getElementById("defaultDisclaimer");

  const planNameViewEl = document.getElementById("planNameView");
  const planStatusViewEl = document.getElementById("planStatusView");
  const planPatientLimitViewEl = document.getElementById("planPatientLimitView");
  const planAiViewEl = document.getElementById("planAiView");
  const planExportsViewEl = document.getElementById("planExportsView");
  const planSupportViewEl = document.getElementById("planSupportView");
  const lastSavedTextEl = document.getElementById("lastSavedText");

  const currentPasswordEl = document.getElementById("currentPassword");
  const newPasswordEl = document.getElementById("newPassword");
  const confirmPasswordEl = document.getElementById("confirmPassword");

  const editableFields = [
    therapistNameEl,
    therapistRoleEl,
    licenseNoEl,
    experienceYearsEl,
    emailEl,
    phoneEl,
    clinicNameEl,
    clinicAddressEl,
    timezoneEl,
    languageEl,
    logoInputEl,
    stampInputEl,
    privacyEmailEl,
    defaultDisclaimerEl,
  ];

  let isEditMode = false;
  let originalProfile = null;
  let workingLogoDataUrl = "";
  let workingStampDataUrl = "";
  let loggedInUser = null;

  function setEditMode(enabled) {
    isEditMode = enabled;

    editableFields.forEach((field) => {
      if (field) field.disabled = !enabled;
    });

    if (cancelEditBtn) cancelEditBtn.disabled = !enabled;
    if (saveProfileBtn) saveProfileBtn.disabled = !enabled;
  }

  function safeJsonParse(raw, fallback = null) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      debug.error("Failed to parse JSON:", error);
      return fallback;
    }
  }

  function getStoredProfile() {
    return safeJsonParse(localStorage.getItem(PROFILE_KEY), null) || {};
  }

  function saveStoredProfile(profile) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }

  function getStoredUser() {
    return safeJsonParse(localStorage.getItem(USER_KEY), null) || {};
  }

  function formatSavedTime(iso) {
    if (!iso) return "Not saved yet.";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "Not saved yet.";
    return `Last saved: ${date.toLocaleString()}`;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function renderImagePreview(container, dataUrl, placeholderText) {
    if (!container) return;

    if (dataUrl) {
      container.innerHTML = `<img src="${dataUrl}" alt="${placeholderText}" style="max-width:100%; max-height:140px; object-fit:contain;" />`;
      return;
    }

    container.innerHTML = `<span class="placeholder">${placeholderText}</span>`;
  }

  function updateTopbarUser(profile = {}, user = {}) {
    const displayName =
      profile.therapistName ||
      user.full_name ||
      user.fullName ||
      user.name ||
      user.username ||
      "Therapist";

    const displayRole =
      profile.therapistRole ||
      user.role ||
      user.profession ||
      "Therapist";

    if (topbarUserNameEl) topbarUserNameEl.textContent = displayName;
    if (topbarUserRoleEl) topbarUserRoleEl.textContent = displayRole;
  }

  function setCurrentDate() {
    if (!currentDateEl) return;
    currentDateEl.textContent = new Date().toLocaleDateString("en-IN", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function getProfileFromForm() {
    return {
      therapistName: therapistNameEl?.value.trim() || "",
      therapistRole: therapistRoleEl?.value.trim() || "",
      licenseNo: licenseNoEl?.value.trim() || "",
      experienceYears: Number(experienceYearsEl?.value) || 0,
      email: emailEl?.value.trim() || "",
      phone: phoneEl?.value.trim() || "",
      clinicName: clinicNameEl?.value.trim() || "",
      clinicAddress: clinicAddressEl?.value.trim() || "",
      timezone: timezoneEl?.value || "Asia/Kolkata",
      language: languageEl?.value || "English",
      privacyEmail: privacyEmailEl?.value.trim() || "",
      defaultDisclaimer: defaultDisclaimerEl?.value.trim() || "",
      logoDataUrl: workingLogoDataUrl || "",
      stampDataUrl: workingStampDataUrl || "",
      updatedAt: new Date().toISOString(),
    };
  }

  function renderProfile(profile) {
    if (therapistNameEl) therapistNameEl.value = profile.therapistName || "";
    if (therapistRoleEl) therapistRoleEl.value = profile.therapistRole || "";
    if (licenseNoEl) licenseNoEl.value = profile.licenseNo || "";
    if (experienceYearsEl) experienceYearsEl.value = profile.experienceYears ?? "";
    if (emailEl) emailEl.value = profile.email || "";
    if (phoneEl) phoneEl.value = profile.phone || "";
    if (clinicNameEl) clinicNameEl.value = profile.clinicName || "";
    if (clinicAddressEl) clinicAddressEl.value = profile.clinicAddress || "";
    if (timezoneEl) timezoneEl.value = profile.timezone || "Asia/Kolkata";
    if (languageEl) languageEl.value = profile.language || "English";
    if (privacyEmailEl) privacyEmailEl.value = profile.privacyEmail || "";
    if (defaultDisclaimerEl) defaultDisclaimerEl.value = profile.defaultDisclaimer || "";

    workingLogoDataUrl = profile.logoDataUrl || "";
    workingStampDataUrl = profile.stampDataUrl || "";

    renderImagePreview(logoPreviewEl, workingLogoDataUrl, "No logo uploaded");
    renderImagePreview(stampPreviewEl, workingStampDataUrl, "No stamp uploaded");

    if (lastSavedTextEl) {
      lastSavedTextEl.textContent = formatSavedTime(profile.updatedAt);
    }

    updateTopbarUser(profile, loggedInUser);
  }

  function renderPlan(plan = {}) {
    if (planNameViewEl) planNameViewEl.textContent = plan.name || "Starter";
    if (planStatusViewEl) planStatusViewEl.textContent = plan.status || "Active";
    if (planPatientLimitViewEl) planPatientLimitViewEl.textContent = plan.patientLimit || "250";
    if (planAiViewEl) planAiViewEl.textContent = plan.aiAnalysis || "Basic";
    if (planExportsViewEl) planExportsViewEl.textContent = plan.exports || "PDF";
    if (planSupportViewEl) planSupportViewEl.textContent = plan.support || "Email";
  }

  function validateProfile(profile) {
    if (!profile.therapistName) return "Therapist name is required.";
    if (!profile.clinicName) return "Clinic name is required.";
    if (!profile.email) return "Clinic email is required.";
    if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
      return "Enter a valid clinic email.";
    }
    if (profile.privacyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.privacyEmail)) {
      return "Enter a valid privacy email.";
    }
    if (profile.experienceYears < 0) return "Experience cannot be negative.";
    return null;
  }

  async function verifySession() {
    const token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);

    if (!token) {
      window.location.href = "auth.html";
      return false;
    }

    try {
      const result = await apiClient.get("/api/auth/me", {
        Authorization: `Bearer ${token}`,
      });

      if (!result.ok) {
        throw new Error(result.message || "Session invalid");
      }

      const user =
        result.data?.user ||
        result.data?.data?.user ||
        result.data?.data ||
        result.data;

      if (user) {
        loggedInUser = user;
        localStorage.setItem(USER_KEY, JSON.stringify(user));
      }

      return true;
    } catch (error) {
      debug.error("Profile session verification failed:", error);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
      window.location.href = "auth.html";
      return false;
    }
  }

  async function saveProfile(profile) {
    try {
      const result = await apiClient.put("/api/profile", profile);

      if (!result.ok) {
        debug.warn("Backend profile save failed, using local save only:", result.message);
      }
    } catch (error) {
      debug.warn("Profile backend save skipped:", error);
    }

    saveStoredProfile(profile);
    originalProfile = { ...profile };
    updateTopbarUser(profile, loggedInUser);
  }

  async function changePassword() {
    const currentPassword = currentPasswordEl?.value || "";
    const newPassword = newPasswordEl?.value || "";
    const confirmPassword = confirmPasswordEl?.value || "";

    if (!currentPassword || !newPassword || !confirmPassword) {
      alert("Please fill all password fields.");
      return;
    }

    if (newPassword.length < 8) {
      alert("New password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      alert("New password and confirm password do not match.");
      return;
    }

    try {
      const result = await apiClient.post("/api/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      });

      if (!result.ok) {
        throw new Error(result.message || "Failed to change password.");
      }

      alert("Password changed successfully.");

      if (currentPasswordEl) currentPasswordEl.value = "";
      if (newPasswordEl) newPasswordEl.value = "";
      if (confirmPasswordEl) confirmPasswordEl.value = "";
    } catch (error) {
      debug.error("Change password failed:", error);
      alert(`Failed to change password: ${error.message}`);
    }
  }

  function buildInitialProfile(storedProfile = {}, user = {}) {
    return {
      therapistName:
        storedProfile.therapistName ||
        user.full_name ||
        user.fullName ||
        user.name ||
        "",
      therapistRole:
        storedProfile.therapistRole ||
        user.role ||
        user.profession ||
        "Therapist",
      licenseNo:
        storedProfile.licenseNo ||
        user.licenseNo ||
        user.license_number ||
        user.registration_no ||
        "",
      experienceYears:
        storedProfile.experienceYears ??
        user.experienceYears ??
        user.experience_years ??
        "",
      email:
        storedProfile.email ||
        user.email ||
        "",
      phone:
        storedProfile.phone ||
        user.phone ||
        user.mobile ||
        "",
      clinicName:
        storedProfile.clinicName ||
        user.clinicName ||
        user.clinic_name ||
        "",
      clinicAddress:
        storedProfile.clinicAddress ||
        user.clinicAddress ||
        user.clinic_address ||
        "",
      timezone: storedProfile.timezone || "Asia/Kolkata",
      language: storedProfile.language || "English",
      privacyEmail:
        storedProfile.privacyEmail ||
        user.email ||
        "",
      defaultDisclaimer: storedProfile.defaultDisclaimer || "",
      logoDataUrl: storedProfile.logoDataUrl || "",
      stampDataUrl: storedProfile.stampDataUrl || "",
      updatedAt: storedProfile.updatedAt || "",
    };
  }

  logoInputEl?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      workingLogoDataUrl = await readFileAsDataUrl(file);
      renderImagePreview(logoPreviewEl, workingLogoDataUrl, "No logo uploaded");
    } catch (error) {
      debug.error("Logo upload failed:", error);
      alert("Failed to load logo image.");
    }
  });

  stampInputEl?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      workingStampDataUrl = await readFileAsDataUrl(file);
      renderImagePreview(stampPreviewEl, workingStampDataUrl, "No stamp uploaded");
    } catch (error) {
      debug.error("Stamp upload failed:", error);
      alert("Failed to load stamp image.");
    }
  });

  userMenuBtn?.addEventListener("click", () => {
    userDropdown?.classList.toggle("show");
  });

  document.addEventListener("click", (event) => {
    if (!userMenuBtn?.contains(event.target) && !userDropdown?.contains(event.target)) {
      userDropdown?.classList.remove("show");
    }
  });

  editProfileBtn?.addEventListener("click", () => {
    setEditMode(true);
  });

  cancelEditBtn?.addEventListener("click", () => {
    if (originalProfile) renderProfile(originalProfile);
    setEditMode(false);
  });

  saveProfileBtn?.addEventListener("click", async () => {
    const profile = getProfileFromForm();
    const validationError = validateProfile(profile);

    if (validationError) {
      alert(validationError);
      return;
    }

    try {
      saveProfileBtn.disabled = true;
      await saveProfile(profile);
      renderProfile(profile);
      setEditMode(false);
      alert("Profile saved successfully.");
    } catch (error) {
      debug.error("Save profile failed:", error);
      alert("Failed to save profile.");
    } finally {
      saveProfileBtn.disabled = false;
    }
  });

  changePasswordBtn?.addEventListener("click", changePassword);

  logoutLink?.addEventListener("click", (event) => {
    event.preventDefault();

    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);

    window.location.href = "index.html";
  });

  setCurrentDate();

  const sessionOk = await verifySession();
  if (!sessionOk) return;

  if (!loggedInUser) {
    loggedInUser = getStoredUser();
  }

  const storedProfile = getStoredProfile();
  originalProfile = buildInitialProfile(storedProfile, loggedInUser);

  renderProfile(originalProfile);

  renderPlan({
    name: "Starter",
    status: "Active",
    patientLimit: "250",
    aiAnalysis: "Basic",
    exports: "PDF",
    support: "Email",
  });

  setEditMode(false);
});