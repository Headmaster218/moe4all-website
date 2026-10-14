(() => {
  "use strict";
  function create() {
    const caches = { vram: Array.from({ length: 48 }, (_, id) => id), ram: Array.from({ length: 96 }, (_, id) => id), ssd: Array.from({ length: 192 }, (_, id) => id) };
    const modes = ["all-hit", "ram-miss", "ssd-miss", "mixed-miss"];
    let turn = 0, seed = 23, replacements = 0;
    const isExpert = entry => typeof entry === "number";
    function sample(list, count) {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i--) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const j = seed % (i + 1); [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy.slice(0, count);
    }
    function request() {
      if (Object.values(caches).some(cache => cache.some(entry => !isExpert(entry)))) throw new Error("A request cannot start before its missing experts arrive.");
      const mode = modes[turn++ % modes.length];
      const hits = sample(caches.vram.slice(5, 40), mode === "all-hit" ? 4 : 2);
      const host = sample(caches.ram.filter(id => !caches.vram.includes(id)), mode === "ram-miss" ? 2 : mode === "mixed-miss" ? 1 : 0);
      const disk = sample(caches.ssd.filter(id => !caches.ram.includes(id)), mode === "ssd-miss" ? 2 : mode === "mixed-miss" ? 1 : 0);
      const experts = [...hits.map(id => ({ id, source: "vram" })), ...host.map(id => ({ id, source: "ram" })), ...disk.map(id => ({ id, source: "ssd" }))];
      return { mode, number: turn, experts };
    }
    function promote(tier, ids, protectedIds = []) {
      const cache = caches[tier], present = ids.filter(id => cache.includes(id));
      const missing = ids.filter(id => !cache.includes(id));
      const rest = cache.filter(id => !present.includes(id)), victims = [];
      for (let i = rest.length - 1; victims.length < missing.length && i >= 0; i--) {
        if (!protectedIds.includes(rest[i])) victims.push(...rest.splice(i, 1));
      }
      if (victims.length !== missing.length) throw new Error("Not enough cold cache entries to replace.");
      caches[tier] = [...ids.map(id => cache.includes(id) ? id : { wanted: id }), ...rest];
      return victims;
    }
    function dispatch(story) {
      const ids = story.experts.map(expert => expert.id);
      // Keep host copies of the experts still referenced by this illustrative VRAM cache.
      const evicted = { vram: promote("vram", ids), ram: promote("ram", ids, caches.vram.filter(isExpert)) };
      promote("ssd", ids);
      return evicted;
    }
    function fill(tier, id) {
      const slot = caches[tier].findIndex(entry => !isExpert(entry) && entry.wanted === id);
      if (slot < 0) throw new Error(`No ${tier} miss slot for expert ${id}.`);
      caches[tier][slot] = id; if (tier === "vram") ++replacements;
    }
    return { caches, request, dispatch, fill, get replacements() { return replacements; } };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { create };
  else window.MoeCacheStory = { create };
})();
