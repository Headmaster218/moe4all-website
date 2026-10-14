(() => {
  "use strict";
  const model = window.MoeReleaseModel, data = window.MOE4ALL_DATA;
  const languageKey = "moe4all-language";
  function getPreferredLanguage() {
    try {
      const saved = localStorage.getItem(languageKey);
      if (saved === "zh" || saved === "en") return saved;
    } catch {}
    const preferred = navigator.languages?.[0] || navigator.language || "en";
    return /^zh(?:-|$)/i.test(preferred) ? "zh" : "en";
  }
  function rememberLanguage(value) {
    if (value !== "zh" && value !== "en") return;
    try { localStorage.setItem(languageKey, value); } catch {}
  }
  let language = "zh", platform = model.detectPlatform(navigator);
  const labels = [...document.querySelectorAll('[data-agent-download] [data-en]')].map(element => ({ element, zh: element.textContent, en: element.dataset.en }));
  const repositories = { engine: data.site.engineRepository, enginePreview: data.site.engineRepository, newestEngine: data.site.engineRepository, agent: data.site.agentRepository };
  const cacheKey = "moe4all-releases-v2:" + data.site.engineRepository + ":" + data.site.agentRepository;
  const cacheMs = 15 * 60 * 1000;
  const sendReleases = frame => frame.contentWindow?.postMessage({ type: "moe-release-data", releases: data.releases }, "*");
  function getDownload(kind = "agent", target = platform) {
    const releases = data.releases;
    return model.downloadFor(kind === "newestEngine" ? releases.enginePreview || releases.engine : releases[kind], repositories[kind], target);
  }
  function renderReleases(nextLanguage = language) {
    language = nextLanguage;
    const releases = data.releases, english = language === "en";
    const items = { ...releases, newestEngine: releases.enginePreview || releases.engine };
    const status = item => english ? (item.prerelease ? "Preview" : "Stable") : (item.prerelease ? "测试版" : "正式版");
    document.querySelectorAll("[data-release-link], [data-agent-download]").forEach(element => {
      const kind = element.dataset.releaseLink || "agent", item = items[kind], result = getDownload(kind);
      element.hidden = kind === "enginePreview" && !item;
      element.href = result.url;
      element.dataset.downloadState = result.direct ? "direct" : "fallback";
      if (result.asset) element.dataset.downloadAsset = result.asset;
      else delete element.dataset.downloadAsset;
      element.removeAttribute("target");
    });
    labels.forEach(({ element, zh, en }) => { element.textContent = english ? en : zh; });
    document.querySelectorAll("[data-platform-label]").forEach(element => {
      const name = { windows: "Windows", linux: "Linux", macos: "macOS" }[platform.os];
      element.textContent = name ? (english ? "Download for " + name : "下载 " + name + " 版") : (english ? "Download MoE4All" : "下载 MoE4All");
    });
    document.querySelectorAll("[data-release-tag], [data-agent-version]").forEach(element => {
      const agent = element.hasAttribute("data-agent-version"), item = items[element.dataset.releaseTag || "agent"];
      element.hidden = !item && !agent;
      if (item) element.textContent = agent ? "MoE4All v" + item.version + " · " + status(item) : status(item) + " · v" + item.version;
      else if (agent) element.textContent = "MoE4All v" + (releases.engine?.version || data.site.fallbackVersion);
    });
    document.querySelectorAll("[data-release-announcement]").forEach(element => {
      const latest = items.newestEngine;
      element.textContent = english ? "Engine v" + latest.version + (latest.prerelease ? " preview" : " released") : "Engine v" + latest.version + " " + status(latest) + "已发布";
    });
    document.querySelectorAll("iframe").forEach(sendReleases);
  }
  function applyReleases(releases, fromCache = false) {
    if (releases?.schema !== 1 || !/^\d+\.\d+\.\d+$/.test(releases.engine?.version || "")) return false;
    if (model.compareVersions(releases.engine.version, data.releases.engine.version) < 0) return false;
    if (releases.agent && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(releases.agent.version || "")) return false;
    if (fromCache && data.releases.agent && (!releases.agent || model.compareVersions(releases.agent.version, data.releases.agent.version) < 0)) return false;
    data.releases = releases;
    renderReleases();
    window.dispatchEvent(new CustomEvent("moe-releases-updated"));
    return true;
  }
  async function refreshReleases() {
    if (!/^https?:$/.test(location.protocol)) return false;
    try {
      const saved = JSON.parse(localStorage.getItem(cacheKey));
      if (saved && Date.now() >= saved.time && Date.now() - saved.time < cacheMs && applyReleases(saved.releases, true)) return true;
    } catch {}
    try {
      const fetchSource = async repository => {
        const response = await fetch("https://api.github.com/repos/" + repository + "/releases?per_page=100", {
          headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(8000), credentials: "omit"
        });
        if (!response.ok) throw new Error("Release API unavailable");
        const releases = await response.json();
        if (!Array.isArray(releases)) throw new Error("Invalid releases");
        return releases;
      };
      const [engine, agent] = await Promise.all([fetchSource(data.site.engineRepository), fetchSource(data.site.agentRepository)]);
      const releases = model.selectReleases(engine, data.site.engineRepository, { agentReleases: agent, agentRepository: data.site.agentRepository });
      if (!applyReleases(releases)) return false;
      try { localStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), releases })); } catch {}
      return true;
    } catch { return false; }
  }
  window.MoeSite = { renderReleases, getDownload, getPlatform: () => ({ ...platform }), refreshReleases, getPreferredLanguage, rememberLanguage };
  addEventListener("message", event => {
    if (event.data?.type !== "moe-demo-ready") return;
    const frame = [...document.querySelectorAll("iframe")].find(element => element.contentWindow === event.source);
    if (frame) sendReleases(frame);
  });
  renderReleases();
  refreshReleases();
  if (navigator.userAgentData?.getHighEntropyValues) navigator.userAgentData.getHighEntropyValues(["architecture", "bitness"]).then(values => {
    const arch = values.architecture === "arm" ? (values.bitness === "64" ? "arm64" : "unknown") : values.architecture === "x86" ? (values.bitness === "64" ? "x86_64" : "x86") : "unknown";
    platform = { ...platform, arch };
    renderReleases();
  }).catch(() => {});
})();
