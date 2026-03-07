document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEY_AUTH = "fft_auth_users_v1";
  const STORAGE_KEY_SESSION = "fft_auth_session_v1";

  // Views
  const viewLogin = document.getElementById("view-login");
  const viewRegister = document.getElementById("view-register");
  const viewForgot = document.getElementById("view-forgot");

  // Switch buttons
  const switchBtns = Array.from(document.querySelectorAll(".switch-btn"));

  // Forms
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const forgotForm = document.getElementById("forgotForm");

  // Login inputs
  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");
  const rememberMe = document.getElementById("rememberMe");
  const loginError = document.getElementById("loginError");

  // Register inputs
  const regFullName = document.getElementById("regFullName");
  const regEmail = document.getElementById("regEmail");
  const regPhone = document.getElementById("regPhone");
  const regPassword = document.getElementById("regPassword");
  const regConfirmPassword = document.getElementById("regConfirmPassword");
  const terms = document.getElementById("terms");
  const registerError = document.getElementById("registerError");

  // Forgot inputs
  const forgotEmail = document.getElementById("forgotEmail");
  const forgotNotice = document.getElementById("forgotNotice");
  const forgotError = document.getElementById("forgotError");

  function loadUsers() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_AUTH) || "[]");
  }

  function saveUsers(users) {
    localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(users));
  }

  function setSession(email, remember) {
    const session = { email, createdAt: new Date().toISOString(), remember: !!remember };
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
  }

  function clearMessages() {
    loginError.textContent = "";
    registerError.textContent = "";
    forgotError.textContent = "";
    forgotNotice.textContent = "";
  }

  function showView(which) {
    clearMessages();

    // toggle sections
    viewLogin.classList.toggle("active", which === "login");
    viewRegister.classList.toggle("active", which === "register");
    viewForgot.classList.toggle("active", which === "forgot");

    // toggle top switch active only for login/register
    switchBtns.forEach(btn => {
      const isLogin = btn.dataset.view === "login";
      const isRegister = btn.dataset.view === "register";
      if (which === "forgot") {
        btn.classList.remove("active");
      } else {
        btn.classList.toggle("active", btn.dataset.view === which);
      }
      // keep them visible anyway
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.style.pointerEvents = "auto";
    });
  }

  // Top switch buttons
  switchBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      showView(btn.dataset.view);
    });
  });

  // Inline links (forgot/register/login)
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-action]");
    if (!a) return;
    e.preventDefault();

    const action = a.dataset.action;
    if (action === "goto-forgot") showView("forgot");
    if (action === "goto-register") showView("register");
    if (action === "goto-login") showView("login");
  });

  // REGISTER
  registerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    clearMessages();

    const fullName = regFullName.value.trim();
    const email = regEmail.value.trim().toLowerCase();
    const phone = regPhone.value.trim();
    const pass = regPassword.value;
    const confirm = regConfirmPassword.value;

    if (!fullName || !email || !pass || !confirm) {
      registerError.textContent = "Please fill all required fields.";
      return;
    }

    if (pass.length < 8) {
      registerError.textContent = "Password must be at least 8 characters.";
      return;
    }

    if (!/\d/.test(pass)) {
      registerError.textContent = "Password should include at least one number.";
      return;
    }

    if (pass !== confirm) {
      registerError.textContent = "Passwords do not match.";
      return;
    }

    if (!terms.checked) {
      registerError.textContent = "You must accept Terms & Privacy Policy.";
      return;
    }

    const users = loadUsers();
    const exists = users.some(u => (u.email || "").toLowerCase() === email);
    if (exists) {
      registerError.textContent = "Account already exists. Please login instead.";
      return;
    }

    users.push({
      fullName,
      email,
      phone,
      password: pass, // NOTE: for real apps, never store plain text passwords (backend hashing)
      createdAt: new Date().toISOString()
    });

    saveUsers(users);

    // Auto-login after register -> Dashboard
    setSession(email, true);
    window.location.href = "dashboard.html";
  });

  // LOGIN
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    clearMessages();

    const email = loginEmail.value.trim().toLowerCase();
    const pass = loginPassword.value;

    const users = loadUsers();
    const user = users.find(u => (u.email || "").toLowerCase() === email);

    if (!user) {
      loginError.textContent = "Account not found. Please register.";
      return;
    }

    if (user.password !== pass) {
      loginError.textContent = "Incorrect password.";
      return;
    }

    setSession(email, rememberMe.checked);
    window.location.href = "dashboard.html";
  });

  // FORGOT (Frontend demo)
  forgotForm.addEventListener("submit", (e) => {
    e.preventDefault();
    clearMessages();

    const email = forgotEmail.value.trim().toLowerCase();
    const users = loadUsers();
    const user = users.find(u => (u.email || "").toLowerCase() === email);

    if (!user) {
      forgotError.textContent = "No account found for this email.";
      return;
    }

    // For frontend-only: show a message (real app would email a token link)
    const fakeToken = Math.random().toString(36).slice(2, 10).toUpperCase();
    forgotNotice.textContent = `Reset link generated (demo): Token ${fakeToken}. In production, this would be emailed securely.`;
  });

  // Default view
  showView("login");
});
