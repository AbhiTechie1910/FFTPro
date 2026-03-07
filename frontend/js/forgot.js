document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_USERS = "fft_users_v1";

  const form = document.getElementById("forgotForm");
  const errorBox = document.getElementById("errorBox");
  const noticeBox = document.getElementById("noticeBox");

  function loadUsers(){
    return JSON.parse(localStorage.getItem(STORAGE_USERS) || "[]");
  }
  function saveUsers(users){
    localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
  }

  function token(){
    return Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    errorBox.textContent = "";
    noticeBox.style.display = "none";
    noticeBox.textContent = "";

    const email = document.getElementById("email").value.trim().toLowerCase();
    const users = loadUsers();
    const user = users.find(u => (u.email || "").toLowerCase() === email);

    if (!user){
      errorBox.textContent = "No account found for this email.";
      return;
    }

    // Demo reset token
    user.resetToken = token();
    user.resetTokenCreatedAt = new Date().toISOString();
    saveUsers(users);

    // In real backend: email a reset link.
    // Here: display it for demo/testing.
    noticeBox.style.display = "block";
    noticeBox.innerHTML =
      `Reset link generated (demo):<br><br>
       <code>reset-password.html?token=${user.resetToken}&email=${encodeURIComponent(email)}</code><br><br>
       Next step: we’ll create the Reset Password page.`;
  });
});
