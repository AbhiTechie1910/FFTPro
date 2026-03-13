document.addEventListener("DOMContentLoaded", () => {
  const TOKEN_KEY = "fft_token";

  const getStartedLink = document.getElementById("getStartedLink");
  const viewDemoLink = document.getElementById("viewDemoLink");
  const ctaRegisterLink = document.getElementById("ctaRegisterLink");

  const navAnchorLinks = document.querySelectorAll('.nav-links a[href^="#"]');

  function hasActiveSession() {
    const token =
      localStorage.getItem(TOKEN_KEY) ||
      sessionStorage.getItem(TOKEN_KEY);

    return Boolean(token && token.trim());
  }

  function goToAuthOrDashboard(event) {
    event.preventDefault();

    if (hasActiveSession()) {
      window.location.href = "../pages/dashboard.html";
      return;
    }

    window.location.href = "../pages/auth.html";
  }

  function handleDemoClick(event) {
    event.preventDefault();

    const featuresSection = document.getElementById("features");

    if (featuresSection) {
      featuresSection.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }

    window.location.href = "../pages/auth.html";
  }

  function handleSmoothScroll(event) {
    const href = event.currentTarget.getAttribute("href");

    if (!href || !href.startsWith("#")) return;

    const target = document.querySelector(href);

    if (!target) return;

    event.preventDefault();

    target.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  navAnchorLinks.forEach((link) => {
    link.addEventListener("click", handleSmoothScroll);
  });

  getStartedLink?.addEventListener("click", goToAuthOrDashboard);
  ctaRegisterLink?.addEventListener("click", goToAuthOrDashboard);
  viewDemoLink?.addEventListener("click", handleDemoClick);
});