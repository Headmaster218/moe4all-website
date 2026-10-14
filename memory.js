(() => {
  "use strict";
  window.MoeMemory = {
    create({ root, getLanguage }) {
      const model = window.MoeCacheStory.create();
      const reduced = matchMedia("(prefers-reduced-motion: reduce)");
      const timings = { request: 500, promote: 950, ssd: 2600, ram: 800, gpu: 600, compute: 450, output: 950, idle: 650 };
      const selectors = { vram: "#expert-grid", ram: ".ram-grid", ssd: ".ssd-grid" };
      const nodes = { vram: new Map(), ram: new Map(), ssd: new Map() };
      const inputs = [], moves = new Map();
      const tokenSequences = { zh: ["让", "每一张", "显卡", "，", "都能", "释放", "潜力", "。"], en: ["Unlock", " your", " hardware", "."] };
      const layer = document.createElement("div"); layer.className = "expert-flight-layer"; layer.setAttribute("aria-hidden", "true");
      const paths = document.createElementNS("http://www.w3.org/2000/svg", "svg"); paths.classList.add("expert-flight-paths"); layer.append(paths); root.append(layer);
      const toggle = root.querySelector("#memory-toggle"), output = root.querySelector("#generated-phrase");
      let paused = reduced.matches, visible = false, time = 0, lastFrame = 0, repaint = 0;
      let story, started = false, storyStart = 0, cycleEnd = null, outputStarted = false, outputIndex = 0;
      let flights = [], evictions = [], rootSize = null;
      const name = id => `E${String(id).padStart(3, "0")}`;
      const key = entry => typeof entry === "number" ? String(entry) : `miss-${entry.wanted}`;
      const en = () => getLanguage() === "en";
      const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };
      const mix = (a, b, t) => `rgb(${a.map((value, i) => Math.round(value + (b[i] - value) * t)).join(",")})`;
      const ease = t => t * t * (3 - 2 * t);
      function rect(element) {
        const r = element.getBoundingClientRect(), b = root.getBoundingClientRect();
        return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
      }
      function center(element) { const r = rect(element); return { x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h }; }
      for (let i = 0; i < 4; i++) {
        const unit = document.createElement("div"); unit.className = "compute-slot"; unit.dataset.computeIndex = String(i);
        unit.innerHTML = '<strong></strong><span></span><div class="compute-meter"><b></b></div>';
        root.querySelector(".gpu-inputs").append(unit); inputs.push(unit);
      }
      function renderQueues() {
        // Preserve each tile's old position while its logical queue order changes.
        for (const tier of ["vram", "ram", "ssd"]) {
          const grid = root.querySelector(selectors[tier]), old = new Map([...nodes[tier]].map(([id, element]) => [id, element.getBoundingClientRect()]));
          const entries = model.caches[tier], retained = new Set(entries.map(key));
          for (const [id, element] of nodes[tier]) if (!retained.has(id)) { moves.delete(element); element.remove(); nodes[tier].delete(id); }
          entries.forEach((entry, rank) => {
            const id = key(entry), missing = typeof entry !== "number", expert = missing ? entry.wanted : entry;
            let element = nodes[tier].get(id);
            if (!element) { element = document.createElement("span"); nodes[tier].set(id, element); }
            const called = story.experts.some(item => item.id === expert);
            element.className = ["memory-cell", tier === "vram" ? "expert-cell" : "", missing ? "missing" : called ? "active" : rank < 24 ? "hot" : rank < 40 ? "warm" : "cold"].filter(Boolean).join(" ");
            Object.assign(element.dataset, { expert: missing ? "" : String(expert), wanted: missing ? String(expert) : "", rank: String(rank), heat: (1 - rank / (entries.length - 1)).toFixed(3) });
            text(element, missing ? "+" : name(expert));
            element.title = missing ? `${name(expert)} / ${en() ? "missing" : "待补齐"}` : `${name(expert)} / ${tier.toUpperCase()} / #${rank + 1}`;
            const colors = tier === "ssd" ? [[125, 167, 179], [40, 51, 46]] : tier === "ram" ? [[164, 189, 145], [40, 51, 43]] : [[185, 219, 184], [38, 50, 43]];
            const warmth = rank < 24 ? rank / 24 * .32 : .58 + (rank - 24) / Math.max(1, entries.length - 25) * .42;
            element.style.backgroundColor = called && !missing ? (tier === "ssd" ? "#96c2cf" : "#c0e3ce") : mix(...colors, warmth);
            element.style.color = rank < 24 || called ? "#24382c" : "#899f8e";
            element.style.transform = ""; grid.append(element);
          });
          for (const [id, element] of nodes[tier]) {
            const before = old.get(id), after = element.getBoundingClientRect();
            if (!before) continue;
            const dx = before.left - after.left, dy = before.top - after.top;
            if (Math.abs(dx) + Math.abs(dy) > 1) {
              moves.set(element, { dx, dy, at: time }); element.style.transform = `translate(${dx}px,${dy}px)`;
            } else moves.delete(element);
          }
        }
      }
      function renderOutput() {
        const tokens = tokenSequences[getLanguage()];
        if (outputIndex >= tokens.length) outputIndex = 0;
        output.replaceChildren(...tokens.map((token, i) => {
          const span = document.createElement("span"); span.textContent = token; span.dataset.token = String(i);
          span.className = i < outputIndex ? "output-token shown" : "output-token"; span.setAttribute("aria-hidden", String(i >= outputIndex)); return span;
        }));
        output.dataset.length = String(outputIndex);
      }
      function updateButton() {
        root.classList.toggle("is-paused", paused);
        const icon = paused ? "play" : "pause";
        if (toggle.dataset.icon !== icon) { toggle.innerHTML = `<i data-lucide="${icon}"></i>`; toggle.dataset.icon = icon; window.lucide?.createIcons({ root: toggle }); }
        toggle.title = en() ? (paused ? "Play cache story" : "Pause cache story") : (paused ? "播放缓存故事" : "暂停缓存故事");
        toggle.setAttribute("aria-label", toggle.title); toggle.setAttribute("aria-pressed", String(paused));
      }
      function prepare() {
        story = model.request(); story.experts.forEach(item => { item.stage = "waiting"; });
        storyStart = time; started = false; cycleEnd = null; outputStarted = false;
        root.dataset.mode = story.mode; root.dataset.batch = String(story.number); root.dataset.completed = "0";
        renderQueues(); describe();
      }
      function dust(tier, id) {
        const source = nodes[tier].get(String(id)), position = rect(source);
        const element = source.cloneNode(true); element.className = "expert-eviction";
        Object.assign(element.dataset, { tier, expert: String(id) });
        Object.assign(element.style, { left: `${position.x}px`, top: `${position.y}px`, width: `${position.w}px`, height: `${position.h}px`, transform: "" });
        layer.append(element);
        const particles = Array.from({ length: 10 }, (_, i) => {
          const bit = document.createElement("span"); bit.className = "expert-dust";
          const x = position.x + position.w * ((i % 5) + .5) / 5, y = position.y + position.h * (i < 5 ? .25 : .75);
          Object.assign(bit.style, { left: `${x}px`, top: `${y}px`, background: tier === "vram" ? "#a5b3a4" : "#9dbaac" }); layer.append(bit);
          return { element: bit, dx: -18 + (i * 13 + id) % 44, dy: -24 + (i * 11 + id) % 48 };
        });
        evictions.push({ element, particles, at: time });
      }
      function fly({ item, from, to, source, target, duration, finish, glyph, delay = 0 }) {
        const element = document.createElement("span"), path = document.createElementNS(paths.namespaceURI, "path");
        element.className = `expert-flight from-${from}` + (glyph ? " token-flight" : ""); element.textContent = glyph || name(item.id);
        Object.assign(element.dataset, { expert: item ? String(item.id) : "", from, to, progress: "0" });
        path.classList.add(`flight-path-${from}`); paths.append(path); layer.append(element);
        const flight = { element, path, from, to, start: center(source), target, at: time + delay, duration, finish, glyph };
        flights.push(flight); drawFlight(flight);
      }
      function drawFlight(flight) {
        const progress = Math.min(1, Math.max(0, (time - flight.at) / flight.duration)), t = ease(progress), u = 1 - t;
        const a = flight.start, b = center(flight.target), middle = (a.y + b.y) / 2;
        const x = u * u * u * a.x + 3 * u * u * t * a.x + 3 * u * t * t * b.x + t * t * t * b.x;
        const y = u * u * u * a.y + 3 * u * u * t * middle + 3 * u * t * t * middle + t * t * t * b.y;
        const targetFont = flight.glyph ? Number.parseFloat(getComputedStyle(flight.target).fontSize) : 0;
        const w = flight.glyph ? Math.max(28, b.w * (targetFont + 1) / targetFont + 8) : a.w + (b.w - a.w) * t, h = flight.glyph ? 28 : a.h + (Math.min(28, b.h) - a.h) * t + Math.sin(t * Math.PI) * 8;
        if (flight.glyph) flight.element.style.fontSize = `${targetFont + 1}px`;
        Object.assign(flight.element.style, { width: `${w}px`, height: `${h}px`, transform: `translate(${x - w / 2}px,${y - h / 2}px)`, backgroundColor: mix(flight.from === "ssd" ? [230, 206, 162] : [161, 199, 168], flight.to === "ram" ? [164, 189, 145] : [195, 234, 211], t) });
        flight.element.dataset.progress = progress.toFixed(3);
        flight.path.setAttribute("d", `M ${a.x} ${a.y} C ${a.x} ${middle}, ${b.x} ${middle}, ${b.x} ${b.y}`);
        return progress;
      }
      function toGpu(item, index) {
        item.stage = "gpu-transfer";
        fly({ item, from: "vram", to: "compute", source: nodes.vram.get(String(item.id)), target: inputs[index], duration: timings.gpu, finish() { item.stage = "compute"; item.computeStart = time; } });
      }
      function fromRam(item, index) {
        item.stage = "ram-transfer";
        fly({ item, from: "ram", to: "vram", source: nodes.ram.get(String(item.id)), target: nodes.vram.get(`miss-${item.id}`), duration: timings.ram, finish() {
          model.fill("vram", item.id); renderQueues(); toGpu(item, index);
        } });
      }
      function dispatch() {
        started = true;
        const evicted = model.dispatch(story);
        for (const tier of ["vram", "ram"]) evicted[tier].forEach(id => dust(tier, id));
        renderQueues();
        story.experts.forEach((item, index) => {
          if (item.source === "vram") return toGpu(item, index);
          if (item.source === "ram") return fromRam(item, index);
          item.stage = "ssd-transfer";
          fly({ item, from: "ssd", to: "ram", source: nodes.ssd.get(String(item.id)), target: nodes.ram.get(`miss-${item.id}`), duration: timings.ssd, delay: story.experts.filter(expert => expert.source === "ssd").indexOf(item) * 180, finish() {
            model.fill("ram", item.id); renderQueues(); fromRam(item, index);
          } });
        });
      }
      function emit() {
        outputStarted = true;
        const tokens = tokenSequences[getLanguage()];
        if (outputIndex >= tokens.length) { outputIndex = 0; renderOutput(); }
        const target = output.querySelector(`[data-token="${outputIndex}"]`);
        fly({ from: "compute", to: "output", source: root.querySelector(".gpu-inputs"), target, duration: timings.output, glyph: tokens[outputIndex], finish() {
          const current = output.querySelector(`[data-token="${outputIndex}"]`);
          ++outputIndex; current.classList.add("shown"); current.setAttribute("aria-hidden", "false"); output.dataset.length = String(outputIndex);
          root.dataset.cycleMs = String(Math.round(time - storyStart)); root.dataset.lastMode = story.mode; cycleEnd = time + timings.idle;
        } });
      }
      function describe() {
        output.setAttribute("aria-label", en() ? "Simulated token output" : "模拟 token 输出");
        root.querySelector(".gpu-inputs").setAttribute("aria-label", en() ? "Four expert compute units" : "四个专家运算单元");
        const done = story.experts.filter(item => item.stage === "done").length;
        const disk = story.experts.filter(item => item.source === "ssd").length, host = story.experts.filter(item => item.source === "ram").length;
        let phase = !started ? "request" : !cycleEnd && outputStarted ? "output" : cycleEnd ? "idle" : story.experts.some(item => item.stage === "ssd-transfer") ? "ssd-transfer" : story.experts.some(item => item.stage === "ram-transfer") ? "ram-transfer" : story.experts.some(item => item.stage === "gpu-transfer") ? (story.mode === "all-hit" ? "gpu-hit" : "gpu-transfer") : "compute";
        root.dataset.phase = phase; root.dataset.completed = String(done); root.dataset.replacements = String(model.replacements);
        text(root.querySelector("#memory-expert"), story.experts.map(item => name(item.id)).join(" · "));
        const route = disk ? `${4 - host - disk} VRAM HIT + ${host ? `${host} RAM HIT + ` : ""}${disk} SSD MISS` : host ? `${4 - host} VRAM HIT + ${host} RAM HIT` : "4 VRAM HITS";
        text(root.querySelector("#memory-operation"), route);
        const messages = {
          request: ["四个专家就绪检查：先命中，再补页", "Check four experts: reuse hits, then fill misses."],
          "gpu-hit": ["全命中：专家前移，直接送往 GPU", "All hits: promote experts and send them to the GPU."],
          "ssd-transfer": [`GPU 已完成 ${done}/4，等待较慢的 SSD 读取`, `GPU completed ${done}/4. Waiting for slower SSD reads.`],
          "ram-transfer": [`GPU 已完成 ${done}/4，从 RAM 补齐红色空位`, `GPU completed ${done}/4. Fill red gaps from RAM.`],
          "gpu-transfer": ["补页专家已到，送往 GPU 继续计算", "Missing experts have arrived. Send them to the GPU."],
          compute: ["四路专家独立计算，等待本轮结果齐备", "Four experts compute independently; wait for all results."],
          output: ["四个结果齐了，输出下一个模拟 token", "All four results are ready. Emit the next simulated token."],
          idle: ["留下热专家，继续拼下一段文字", "Keep the hot experts and continue the sentence."]
        };
        text(root.querySelector("#memory-status"), messages[phase][en() ? 1 : 0]);
        text(root.querySelector("#memory-route"), phase === "ssd-transfer" ? "SSD → RAM" : phase === "ram-transfer" ? "RAM → VRAM" : "VRAM → GPU");
        text(root.querySelector("#gpu-progress"), `${done} / 4 ${en() ? "DONE" : "已完成"}`);
        for (const [tier, label] of [["vram", "gpu"], ["ram", "ram"], ["ssd", "ssd"]]) text(root.querySelector(`[data-tier-activity="${label}"]`), `${en() ? "Hot" : "热"} 24 / ${model.caches[tier].length}`);
        for (const tier of ["ram", "ssd"]) {
          const count = story.experts.filter(item => item.stage === `${tier}-transfer`).length;
          root.querySelector(`#${tier}-transfer`).classList.toggle("transmitting", count > 0);
          text(root.querySelector(`#${tier}-transfer-count`), count ? `${count} ↑ / ${timings[tier] / 1000}s` : `${timings[tier] / 1000}s / ${en() ? "DEMO" : "示意"}`);
        }
        story.experts.forEach((item, index) => {
          const unit = inputs[index], stage = item.stage;
          const missing = item.source !== "vram" && ["waiting", "ssd-transfer", "ram-transfer"].includes(stage);
          unit.className = `compute-slot ${missing ? "missing" : stage}`; unit.dataset.expert = String(item.id); unit.dataset.state = stage;
          text(unit.querySelector("strong"), name(item.id));
          const labels = { waiting: [missing ? "等待补页" : "已命中", missing ? "WAIT FOR FILL" : "CACHE HIT"], "ssd-transfer": ["等 SSD", "WAIT FOR SSD"], "ram-transfer": ["等 RAM", "WAIT FOR RAM"], "gpu-transfer": ["进入 GPU", "GPU LOAD"], compute: ["计算中", "COMPUTING"], done: ["完成", "DONE"] };
          text(unit.querySelector("span"), labels[stage][en() ? 1 : 0]);
          unit.querySelector("b").style.width = `${stage === "done" ? 100 : stage === "compute" ? Math.min(100, (time - item.computeStart) / timings.compute * 100) : 0}%`;
        });
      }
      function draw() {
        for (const [element, move] of moves) {
          const progress = Math.min(1, (time - move.at) / timings.promote);
          element.style.transform = `translate(${move.dx * (1 - ease(progress))}px,${move.dy * (1 - ease(progress))}px)`;
          if (progress >= 1) { element.style.transform = ""; moves.delete(element); }
        }
        for (const flight of [...flights]) if (drawFlight(flight) >= 1) {
          flights = flights.filter(item => item !== flight); flight.element.remove(); flight.path.remove(); flight.finish();
        }
        for (const effect of [...evictions]) {
          const p = Math.min(1, (time - effect.at) / timings.promote), t = ease(p);
          effect.element.style.opacity = String(1 - t); effect.element.style.filter = `blur(${t * 3}px)`;
          effect.element.style.transform = `translate(${t * 14}px,${-t * 3}px) scale(${1 - t * .22})`;
          for (const particle of effect.particles) {
            particle.element.style.transform = `translate(${particle.dx * t}px,${particle.dy * t}px)`; particle.element.style.opacity = String(Math.sin(p * Math.PI) * (1 - p * .5));
          }
          if (p >= 1) { effect.element.remove(); effect.particles.forEach(item => item.element.remove()); evictions = evictions.filter(item => item !== effect); }
        }
        for (const item of story.experts) if (item.stage === "compute" && time - item.computeStart >= timings.compute) item.stage = "done";
        if (started && story.experts.every(item => item.stage === "done") && !outputStarted) emit();
        if (cycleEnd !== null && time >= cycleEnd) prepare();
        describe();
      }
      function frame(timestamp) {
        requestAnimationFrame(frame);
        const delta = Math.min(timestamp - lastFrame || 0, 80); lastFrame = timestamp;
        if (paused || !visible || document.hidden) return;
        time += delta; repaint += delta;
        if (!started && time - storyStart >= timings.request) dispatch();
        if (repaint >= 24) { repaint = 0; draw(); }
      }
      renderOutput(); prepare(); updateButton();
      toggle.addEventListener("click", () => { paused = !paused; updateButton(); });
      reduced.addEventListener("change", () => { if (reduced.matches) { paused = true; updateButton(); } });
      new ResizeObserver(() => {
        const size = { w: root.clientWidth, h: root.clientHeight };
        if (rootSize) flights.forEach(flight => { flight.start.x *= size.w / rootSize.w; flight.start.y *= size.h / rootSize.h; });
        rootSize = size; paths.setAttribute("viewBox", `0 0 ${size.w} ${size.h}`);
        flights.forEach(drawFlight);
      }).observe(root);
      if ("IntersectionObserver" in window) new IntersectionObserver(entries => { visible = entries[0].isIntersecting; }, { threshold: .05 }).observe(root);
      else visible = true;
      requestAnimationFrame(frame);
      return { refreshLanguage() {
        renderOutput(); flights.filter(flight => flight.glyph).forEach(flight => { flight.target = output.querySelector(`[data-token="${outputIndex}"]`); flight.glyph = tokenSequences[getLanguage()][outputIndex]; text(flight.element, flight.glyph); });
        describe(); updateButton();
      } };
    }
  };
})();
