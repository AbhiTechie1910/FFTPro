import { apiClient } from "../core/api-client.js";
import { debug } from "../utils/debug.js";

document.addEventListener("DOMContentLoaded", async () => {
  const TOKEN_KEY = "fft_token";
  const USER_KEY = "fft_logged_user";

  const currentDateEl = document.getElementById("currentDate");
  const userMenuBtn = document.getElementById("userMenuBtn");
  const userDropdown = document.getElementById("userDropdown");
  const topbarUserNameEl = document.getElementById("topbarUserName");
  const topbarUserRoleEl = document.getElementById("topbarUserRole");
  const logoutLink = document.getElementById("logoutLink");

  let loggedInUser = null;

  function safeJsonParse(raw, fallback = null) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      debug.error("JSON parse failed:", error);
      return fallback;
    }
  }

  function getStoredUser() {
    const localUser = safeJsonParse(localStorage.getItem(USER_KEY), null);
    const sessionUser = safeJsonParse(sessionStorage.getItem(USER_KEY), null);
    return localUser || sessionUser || {};
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

  function updateTopbarUser(user = {}) {
    const displayName =
      user.full_name ||
      user.fullName ||
      user.name ||
      user.username ||
      user.therapistName ||
      "Therapist";

    const displayRole =
      user.role ||
      user.profession ||
      user.qualification ||
      user.user_type ||
      "Therapist";

    if (topbarUserNameEl) {
      topbarUserNameEl.textContent = displayName;
    }

    if (topbarUserRoleEl) {
      topbarUserRoleEl.textContent = displayRole;
    }
  }

  async function verifySessionAndLoadUser() {
    const token =
      localStorage.getItem(TOKEN_KEY) ||
      sessionStorage.getItem(TOKEN_KEY);

    if (!token) {
      window.location.href = "/frontend/pages/auth.html";
      return false;
    }

    try {
      const result = await apiClient.get("/api/auth/me", {
        Authorization: `Bearer ${token}`,
      });

      if (!result?.ok) {
        throw new Error(result?.message || "Session invalid");
      }

      const user =
        result.data?.user ||
        result.data?.data?.user ||
        result.data?.data ||
        result.data;

      if (user) {
        loggedInUser = user;
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        updateTopbarUser(user);
      }

      return true;
    } catch (error) {
      debug.error("Functional tests session verification failed:", error);

      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);

      window.location.href = "/frontend/pages/auth.html";
      return false;
    }
  }

  function bindDropdown() {
    if (!userMenuBtn || !userDropdown) return;

    userMenuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      userDropdown.classList.toggle("show");
    });

    document.addEventListener("click", (event) => {
      const clickedInsideButton = userMenuBtn.contains(event.target);
      const clickedInsideDropdown = userDropdown.contains(event.target);

      if (!clickedInsideButton && !clickedInsideDropdown) {
        userDropdown.classList.remove("show");
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        userDropdown.classList.remove("show");
      }
    });
  }

  function bindLogout() {
    if (!logoutLink) return;

    logoutLink.addEventListener("click", (event) => {
      event.preventDefault();

      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);

      window.location.href = "/frontend/pages/index.html";
    });
  }

  setCurrentDate();
  bindDropdown();
  bindLogout();

  const sessionOk = await verifySessionAndLoadUser();
  if (!sessionOk) return;

  if (!loggedInUser) {
    loggedInUser = getStoredUser();
    updateTopbarUser(loggedInUser);
  }
});