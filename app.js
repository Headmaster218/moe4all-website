(() => {
  "use strict";
  if (window.lucide) lucide.createIcons();

  let language = "zh";
  const { releases, benchmarks } = window.MOE4ALL_DATA;
  const memory = window.MoeMemory.create({ root: document.querySelector(".memory-visual"), getLanguage: () => language });
  const wave = document.querySelector("#audio-wave");
  for (let i = 0; i < 88; i++) {
    const bar = document.createElement("span");
    const amplitude = 10 + Math.abs(Math.sin(i * 1.71) * Math.cos(i * .16)) * 80;
    bar.style.setProperty("--height", `${amplitude}%`);
    bar.style.setProperty("--opacity", `${.45 + amplitude / 160}`);
    bar.style.setProperty("--delay", `${-(i % 12) * .23}s`);
    wave.append(bar);
  }
  function renderReleases() {
    window.MoeSite.renderReleases(language);
  }
  renderReleases();

  const menu = document.querySelector("#main-nav");
  const menuToggle = document.querySelector("#menu-toggle");
  const closeMenu = () => { menu.classList.remove("open"); menuToggle.setAttribute("aria-expanded", "false"); };
  menuToggle.addEventListener("click", () => {
    const opened = menu.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(opened));
  });
  menu.querySelectorAll("a").forEach(link => link.addEventListener("click", closeMenu));
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeMenu(); });

  let selectedContext = "4000", selectedModel = "qwen35";
  const maximumDecode = shortContext => Math.max(...benchmarks.models.flatMap(model =>
    Object.entries(model.results).filter(([context]) => (context === "4000") === shortContext).flatMap(([, result]) => result.decode)));
  const contextButtons = [...document.querySelectorAll("[data-context]")];
  function syncContextButtons() {
    const model = benchmarks.models.find(item => item.id === selectedModel);
    for (const button of contextButtons) button.hidden = !model.results[button.dataset.context];
    if (!model.results[selectedContext]) selectedContext = model.results["30000"] ? "30000" : Object.keys(model.results)[0];
    for (const button of contextButtons) {
      const active = button.dataset.context === selectedContext;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }
  function renderBenchmark() {
    const model = benchmarks.models.find(item => item.id === selectedModel);
    const result = model.results[selectedContext];
    const chartMaximum = maximumDecode(selectedContext === "4000");
    document.querySelectorAll("[data-decode-speed]").forEach(element => { element.innerHTML = `${result.decode[Number(element.dataset.decodeSpeed)].toFixed(2)} <small>tok/s</small>`; });
    document.querySelectorAll("[data-decode-bar]").forEach(element => { element.style.width = `${result.decode[Number(element.dataset.decodeBar)] / chartMaximum * 100}%`; });
    document.querySelector("#prefill-speed").textContent = Number.isFinite(result.prefill) ? result.prefill.toFixed(2) : "—";
    document.querySelector(".prefill-result>span:last-child").textContent = Number.isFinite(result.prefill) ? (language === "en" ? "Single cold request" : "单路冷请求") : (language === "en" ? "Decode only" : "仅 Decode");
    document.querySelector("[data-benchmark-label='heading']").textContent = language === "en" ? "MEASURED THROUGHPUT" : "实测吞吐量";
    document.querySelector("#benchmark-note").textContent = language === "en" ? `×N = concurrent sessions. Decode: ${benchmarks.settings.measuredDecodeRounds} measured rounds after warmup. Prefill: a cold request without cached tokens.` : `×N 为并发会话数；Decode 预热后 ${benchmarks.settings.measuredDecodeRounds} 轮平均，Prefill 为无缓存冷请求。`;
    const h = benchmarks.hardware, s = benchmarks.settings;
    const machine = document.querySelector(".benchmark-machine>div");
    machine.querySelector("strong").textContent = h.gpu.replace(/^AMD Radeon /, "");
    machine.querySelector("span").textContent = `${language === "en" ? "Budgets" : "预算"}: ${h.vramBudgetGiB} GiB VRAM · ${h.ramBudgetGiB} GiB RAM`;
    machine.querySelector("small").textContent = `${h.os} · MTP ${s.mtp ? "ON" : "OFF"} · ${s.kv}`;
    document.querySelector("#benchmark-dialog .eyebrow").textContent = "BENCHMARK";
    const protocol = document.querySelectorAll(".benchmark-protocol p");
    const settings = `${h.gpu} · ${h.os} · ${h.vramBudgetGiB} GiB VRAM / ${h.ramBudgetGiB} GiB RAM · ${s.kv} · temperature ${s.temperature} · thinking ${s.thinking ? "ON" : "OFF"} · MTP ${s.mtp ? "ON" : "OFF"} · ctx ${s.contextCapacity} · ubatch ${s.ubatch} · threads ${s.cpuThreads} · GPU resident ${s.residentGpuLayers}`;
    protocol[0].textContent = (language === "en" ? "Memory budgets: " : "内存预算：") + settings;
    protocol[1].textContent = language === "en" ? `Decode: ${s.outputTokensPerLane} tokens/session; ${s.warmupRounds} warmup and ${s.measuredDecodeRounds} measured rounds. Per round, total output tokens / slowest lane Decode duration, then averaged. Prefill: ${s.coldPrefillRequests} cold request per condition, cached tokens = ${s.prefillCachedTokens}.` : `Decode：每会话 ${s.outputTokensPerLane} tokens，预热 ${s.warmupRounds} 轮、实测 ${s.measuredDecodeRounds} 轮；每轮总输出 tokens 除以最慢会话 Decode 时间，再取平均。Prefill：每条件 ${s.coldPrefillRequests} 次冷请求，cached tokens = ${s.prefillCachedTokens}。`;
  }
  const table = document.querySelector("#benchmark-table");
  for (const model of benchmarks.models) {
    for (const context of benchmarks.contexts) {
      const result = model.results[context];
      if (!result) continue;
      const row = document.createElement("tr");
      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = `${model.name} / ${context / 1000}K`;
      row.append(name);
      for (const number of [...result.decode, result.prefill]) {
        const cell = document.createElement("td"); cell.textContent = Number.isFinite(number) ? number.toFixed(2) : "—"; row.append(cell);
      }
      table.append(row);
    }
  }
  syncContextButtons();
  renderBenchmark();
  contextButtons.forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-context]").forEach(item => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      selectedContext = button.dataset.context;
      renderBenchmark();
    });
  });
  document.querySelectorAll("[data-model]").forEach(button => {
    const model = benchmarks.models.find(item => item.id === button.dataset.model);
    button.replaceChildren();
    for (const text of [model.label, model.detail]) {
      const span = document.createElement("span"); span.textContent = text; button.append(span);
    }
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-model]").forEach(item => {
        const active = item === button; item.classList.toggle("active", active); item.setAttribute("aria-pressed", String(active));
      });
      selectedModel = button.dataset.model;
      syncContextButtons();
      renderBenchmark();
    });
  });

  document.querySelectorAll("[data-filter]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-filter]").forEach(item => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      document.querySelectorAll(".plugin").forEach(plugin => {
        plugin.hidden = button.dataset.filter !== "all" && plugin.dataset.category !== button.dataset.filter;
      });
    });
  });

  const showDialog = dialog => { closeMenu(); dialog.showModal(); document.body.classList.add("modal-open"); };
  document.querySelector("#benchmark-details").addEventListener("click", () => showDialog(document.querySelector("#benchmark-dialog")));
  document.querySelectorAll("dialog").forEach(dialog => {
    dialog.querySelector("[data-close-dialog]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => document.body.classList.remove("modal-open"));
    dialog.addEventListener("click", event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
    });
  });
  const agent = window.MoeAgentShowcase.create({ root: document.querySelector(".agent-gallery"), dialog: document.querySelector("#image-dialog"), getLanguage: () => language, showDialog });

  const translations = [...document.querySelectorAll("[data-en]")].map(element => ({ element, zh: element.innerHTML, en: element.dataset.en }));
  const languageToggle = document.querySelector("#language-toggle");
  function setLanguage(value) {
    language = value;
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    translations.forEach(({ element, zh, en }) => { element.innerHTML = language === "zh" ? zh : en; });
    languageToggle.querySelector("span").textContent = language === "zh" ? "EN" : "中";
    languageToggle.title = language === "zh" ? "Switch to English" : "切换到中文";
    languageToggle.setAttribute("aria-label", languageToggle.title);
    document.title = language === "zh" ? "MoE4All · 释放卡之潜力" : "MoE4All · Unlock your hardware";
    renderReleases();
    renderBenchmark();
    memory.refreshLanguage();
    agent.refreshLanguage();
  }
  languageToggle.addEventListener("click", () => {
    setLanguage(language === "zh" ? "en" : "zh");
    window.MoeSite.rememberLanguage(language);
  });
  setLanguage(window.MoeSite.getPreferredLanguage());
})();
