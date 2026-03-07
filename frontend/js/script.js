// Simple interaction logic (expandable later)

document.addEventListener("DOMContentLoaded", () => {
  const primaryButtons = document.querySelectorAll(".btn-primary");

  primaryButtons.forEach(button => {
    button.addEventListener("click", () => {
      alert("Thank you for your interest! Early access coming soon.");
    });
  });
});
