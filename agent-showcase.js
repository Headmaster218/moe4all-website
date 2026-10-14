(() => {
  "use strict";
  window.MoeAgentShowcase = {
    create({ root, dialog, getLanguage, showDialog }) {
      const views = ["workspace", "models", "memory", "remote"];
      const track = root.querySelector(".agent-gallery-track");
      const reduced = matchMedia("(prefers-reduced-motion: reduce)");
      const expanded = dialog.querySelector("iframe");
      let view = views[0], paused = reduced.matches, visible = false, timer = null;
      const frames = () => [...root.querySelectorAll("iframe"), expanded];
      function send(frame) {
        frame.contentWindow?.postMessage({ type: "moe-demo", language: getLanguage(), view: frame.closest("[data-slide]")?.dataset.slide || view }, "*");
      }
      function fit() {
        const first = track.querySelector(".agent-slide"), gap = Number.parseFloat(getComputedStyle(track).gap);
        track.style.transform = `translateX(${-views.indexOf(view) * (first.getBoundingClientRect().width + gap)}px)`;
      }
      function updateTimer() {
        if (timer !== null) clearInterval(timer);
        timer = null;
        if (!paused && visible && !document.hidden && !dialog.open) timer = setInterval(() => {
          if (!root.matches(":hover")) select(views[(views.indexOf(view) + 1) % views.length]);
        }, window.MOE4ALL_DATA.site.carouselIntervalMs);
        const button = root.querySelector("#agent-play"), icon = paused ? "play" : "pause";
        if (button.dataset.icon !== icon) {
          button.innerHTML = `<i data-lucide="${icon}"></i>`; button.dataset.icon = icon;
          window.lucide?.createIcons({ root: button });
        }
        button.title = getLanguage() === "en" ? (paused ? "Play slideshow" : "Pause slideshow") : (paused ? "播放自动轮播" : "暂停自动轮播");
        button.setAttribute("aria-label", button.title); button.setAttribute("aria-pressed", String(paused));
      }
      function select(value, manual = false) {
        view = value; if (manual) paused = true;
        root.dataset.currentView = view;
        root.querySelectorAll("[data-view]").forEach(button => {
          const selected = button.dataset.view === view;
          button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1;
        });
        root.querySelectorAll("[data-slide]").forEach(slide => {
          const selected = slide.dataset.slide === view;
          slide.classList.toggle("is-current", selected); slide.setAttribute("aria-hidden", String(!selected));
          slide.setAttribute("aria-roledescription", "slide");
        });
        root.querySelector("#agent-count").textContent = `0${views.indexOf(view) + 1} / 04`;
        fit(); send(expanded); updateTimer();
      }
      function refreshLanguage() {
        for (const [id, zh, en] of [["agent-prev", "上一页", "Previous slide"], ["agent-next", "下一页", "Next slide"], ["expand-gallery", "放大演示界面", "Expand the demo"]]) {
          const button = root.querySelector(`#${id}`); button.title = getLanguage() === "en" ? en : zh; button.setAttribute("aria-label", button.title);
        }
        dialog.setAttribute("aria-label", getLanguage() === "en" ? "Expanded demo workspace" : "演示工作区大图");
        frames().forEach(send); fit(); updateTimer();
      }
      root.querySelectorAll("[data-view]").forEach(button => {
        button.addEventListener("click", () => select(button.dataset.view, true));
        button.addEventListener("keydown", event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : (views.indexOf(view) + (event.key === "ArrowRight" ? 1 : -1) + views.length) % views.length;
          select(views[index], true); root.querySelector(`[data-view="${view}"]`).focus();
        });
      });
      root.querySelector("#agent-prev").addEventListener("click", () => select(views[(views.indexOf(view) + views.length - 1) % views.length], true));
      root.querySelector("#agent-next").addEventListener("click", () => select(views[(views.indexOf(view) + 1) % views.length], true));
      root.querySelector("#agent-play").addEventListener("click", () => { paused = !paused; updateTimer(); });
      root.querySelector("#expand-gallery").addEventListener("click", () => { showDialog(dialog); send(expanded); updateTimer(); });
      root.addEventListener("mouseenter", updateTimer); root.addEventListener("mouseleave", updateTimer);
      root.addEventListener("focusin", event => { if (event.target.id !== "agent-play") { paused = true; updateTimer(); } });
      dialog.addEventListener("close", updateTimer); document.addEventListener("visibilitychange", updateTimer);
      reduced.addEventListener("change", () => { if (reduced.matches) { paused = true; updateTimer(); } });
      addEventListener("message", event => {
        if (event.data?.type !== "moe-demo-ready") return;
        const frame = frames().find(item => item.contentWindow === event.source); if (frame) send(frame);
      });
      frames().forEach(frame => frame.addEventListener("load", () => send(frame)));
      new ResizeObserver(fit).observe(root.querySelector(".agent-gallery-window"));
      if ("IntersectionObserver" in window) new IntersectionObserver(entries => { visible = entries[0].isIntersecting; updateTimer(); }, { threshold: .1 }).observe(root);
      else visible = true;
      select(view); refreshLanguage();
      return { refreshLanguage };
    }
  };
})();
