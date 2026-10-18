(() => {
  "use strict";
  const states = new WeakMap();
  const images = [...document.querySelectorAll("img[data-full-src]")];
  const afterPaint = callback => requestAnimationFrame(() => requestAnimationFrame(callback));
  function schedule(image) {
    const state = states.get(image);
    if (!state.near || state.pending || state.done || !image.complete || !image.naturalWidth) return;
    state.pending = true;
    afterPaint(() => {
      const start = async () => {
        if (!state.near || document.hidden) { state.pending = false; return; }
        const full = new Image();
        full.decoding = "async";
        full.fetchPriority = "low";
        full.src = image.dataset.fullSrc;
        try {
          await full.decode();
          image.src = full.src;
          image.dataset.quality = "full";
          state.done = true;
        } catch {
          image.dataset.quality = "preview";
        }
        state.pending = false;
      };
      if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 1200 });
      else setTimeout(start, 100);
    });
  }
  const observer = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      states.get(entry.target).near = entry.isIntersecting;
      schedule(entry.target);
    }
  }, { rootMargin: "200px 0px" }) : null;
  for (const image of images) {
    states.set(image, { near: !observer, pending: false, done: false });
    image.dataset.quality = "preview";
    image.addEventListener("load", () => schedule(image));
    if (observer) observer.observe(image);
    else schedule(image);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) images.forEach(schedule); });
})();
