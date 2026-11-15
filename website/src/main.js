const panel = document.querySelector("[data-panel]");
if (panel && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  panel.addEventListener("pointermove", (event) => {
    const rect = panel.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    panel.style.transform = `perspective(900px) rotateY(${x * 4}deg) rotateX(${-y * 4}deg)`;
  });
  panel.addEventListener("pointerleave", () => {
    panel.style.transform = "";
  });
}
