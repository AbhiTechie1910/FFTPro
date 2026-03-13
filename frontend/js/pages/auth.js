document.addEventListener("DOMContentLoaded", () => {
  const API_BASE = "http://127.0.0.1:5000";

  const TOKEN_KEY = "fft_token";
  const USER_KEY = "fft_logged_user";

  const switchButtons = document.querySelectorAll(".switch-btn");
  const views = document.querySelectorAll(".view");

  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const forgotForm = document.getElementById("forgotForm");

  const loginError = document.getElementById("loginError");
  const registerError = document.getElementById("registerError");
  const forgotError = document.getElementById("forgotError");
  const forgotNotice = document.getElementById("forgotNotice");

  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");
  const rememberMe = document.getElementById("rememberMe");

  const regFullName = document.getElementById("regFullName");
  const regEmail = document.getElementById("regEmail");
  const regPhone = document.getElementById("regPhone");
  const regPassword = document.getElementById("regPassword");
  const regConfirmPassword = document.getElementById("regConfirmPassword");
  const terms = document.getElementById("terms");

  const forgotEmail = document.getElementById("forgotEmail");

  function clearMessages() {
    if (loginError) loginError.textContent = "";
    if (registerError) registerError.textContent = "";
    if (forgotError) forgotError.textContent = "";
    if (forgotNotice) forgotNotice.textContent = "";
  }

  function showView(viewName) {
    clearMessages();

    views.forEach((view) => {
      view.classList.remove("active");
    });

    switchButtons.forEach((btn) => {
      btn.classList.remove("active");
    });

    const targetView = document.getElementById(`view-${viewName}`);
    const targetBtn = document.querySelector(`.switch-btn[data-view="${viewName}"]`);

    if (targetView) targetView.classList.add("active");
    if (targetBtn) targetBtn.classList.add("active");
  }

  function setError(el, message) {
    if (el) el.textContent = message || "";
  }

  function setNotice(el, message) {
    if (el) el.textContent = message || "";
  }

  function saveAuthSession(token, user, persist = true) {
    if (!token) return;

    localStorage.setItem(TOKEN_KEY, token);

    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    }

    if (!persist) {
      sessionStorage.setItem(TOKEN_KEY, token);
      if (user) {
        sessionStorage.setItem(USER_KEY, JSON.stringify(user));
      }
    }
  }

  async function postJSON(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        data?.message ||
        data?.error ||
        (Array.isArray(data?.errors) ? data.errors.join(", ") : "") ||
        `Request failed with status ${response.status}`
      );
    }

    return data;
  }

  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function validatePassword(password) {
    if (!password || password.length < 8) {
      return "Password must be at least 8 characters.";
    }

    if (!/\d/.test(password)) {
      return "Password should include at least one number.";
    }

    return null;
  }

  function resolveLoginPayload() {
    return {
      email: loginEmail?.value.trim() || "",
      password: loginPassword?.value || "",
    };
  }

  function resolveRegisterPayload() {
    return {
      name: regFullName?.value.trim() || "",
      email: regEmail?.value.trim() || "",
      phone: regPhone?.value.trim() || "",
      password: regPassword?.value || "",
    };
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    clearMessages();

    const payload = resolveLoginPayload();

    if (!payload.email || !payload.password) {
      setError(loginError, "Please enter email and password.");
      return;
    }

    if (!validateEmail(payload.email)) {
      setError(loginError, "Enter a valid email address.");
      return;
    }

    try {
      const data = await postJSON(`${API_BASE}/api/auth/login`, payload);

      const token =
        data?.token ||
        data?.accessToken ||
        data?.data?.token ||
        null;

      const user =
        data?.user ||
        data?.data?.user ||
        null;

      if (!token) {
        throw new Error("Login succeeded, but no token was returned.");
      }

      saveAuthSession(token, user, rememberMe?.checked ?? true);

      window.location.href = "dashboard.html";
    } catch (error) {
      setError(loginError, error.message || "Login failed.");
    }
  }

  async function handleRegisterSubmit(event) {
    event.preventDefault();
    clearMessages();

    const payload = resolveRegisterPayload();
    const confirmPassword = regConfirmPassword?.value || "";
    const acceptedTerms = terms?.checked ?? false;

    if (!payload.name) {
      setError(registerError, "Full name is required.");
      return;
    }

    if (!payload.email || !validateEmail(payload.email)) {
      setError(registerError, "Enter a valid email address.");
      return;
    }

    const passwordError = validatePassword(payload.password);
    if (passwordError) {
      setError(registerError, passwordError);
      return;
    }

    if (payload.password !== confirmPassword) {
      setError(registerError, "Passwords do not match.");
      return;
    }

    if (!acceptedTerms) {
      setError(registerError, "Please accept the Terms & Privacy Policy.");
      return;
    }

    try {
      const data = await postJSON(`${API_BASE}/api/auth/register`, payload);

      const token =
        data?.token ||
        data?.accessToken ||
        data?.data?.token ||
        null;

      const user =
        data?.user ||
        data?.data?.user ||
        null;

      if (token) {
        saveAuthSession(token, user, true);
        window.location.href = "dashboard.html";
        return;
      }

      setNotice(registerError, "");
      alert("Account created successfully. Please log in.");
      registerForm?.reset();
      showView("login");

      if (loginEmail) {
        loginEmail.value = payload.email;
      }
    } catch (error) {
      setError(registerError, error.message || "Registration failed.");
    }
  }

  async function handleForgotSubmit(event) {
    event.preventDefault();
    clearMessages();

    const email = forgotEmail?.value.trim() || "";

    if (!email || !validateEmail(email)) {
      setError(forgotError, "Enter a valid email address.");
      return;
    }

    try {
      const data = await postJSON(`${API_BASE}/api/auth/forgot-password`, { email });

      setNotice(
        forgotNotice,
        data?.message || "Reset link generated successfully."
      );

      forgotForm?.reset();
    } catch (error) {
      setError(forgotError, error.message || "Could not generate reset link.");
    }
  }

  function bindViewSwitches() {
    switchButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        if (view) showView(view);
      });
    });

    document.querySelectorAll("[data-action]").forEach((el) => {
      el.addEventListener("click", (event) => {
        event.preventDefault();

        const action = el.dataset.action;

        if (action === "goto-login") showView("login");
        if (action === "goto-register") showView("register");
        if (action === "goto-forgot") showView("forgot");
      });
    });
  }

  function bootstrapAuthPage() {
    bindViewSwitches();

    loginForm?.addEventListener("submit", handleLoginSubmit);
    registerForm?.addEventListener("submit", handleRegisterSubmit);
    forgotForm?.addEventListener("submit", handleForgotSubmit);

    const existingToken =
      localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);

    if (existingToken) {
      window.location.href = "dashboard.html";
    }
  }

  bootstrapAuthPage();
});