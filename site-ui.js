(() => {
  "use strict";
  const downloadLabels = [...document.querySelectorAll('[data-agent-download] [data-en]')].map(element => ({ element, zh: element.textContent, en: element.dataset.en }));
  window.MoeSite = {
    renderReleases(language) {
      const releases = window.MOE4ALL_DATA.releases;
      const sources = window.MOE4ALL_DATA.site;
      const items = { ...releases, newestEngine: releases.enginePreview || releases.engine };
      const english = language === "en";
      const status = item => english ? (item.prerelease ? "Preview" : "Stable") : (item.prerelease ? "测试版" : "正式版");
      document.querySelectorAll("[data-release-link], [data-agent-download]").forEach(element => {
        const kind = element.dataset.releaseLink || "agent", item = items[kind];
        element.hidden = element.hasAttribute("data-release-link") && !item;
        element.href = item?.url || (kind === "agent" ? `https://github.com/${sources.agentRepository}` : `https://github.com/${sources.engineRepository}/releases`);
        if (element.hasAttribute("data-agent-download")) element.dataset.downloadState = releases.agent ? "ready" : "pending";
      });
      downloadLabels.forEach(({ element, zh, en }) => { element.textContent = releases.agent ? (english ? en : zh) : (english ? 'Explore Agent' : '查看 Agent 项目'); });
      document.querySelectorAll("[data-release-tag], [data-agent-version]").forEach(element => {
        const agent = element.hasAttribute("data-agent-version");
        const item = items[element.dataset.releaseTag || "agent"];
        element.hidden = !item && !agent;
        if (item) element.textContent = agent ? `Agent v${item.version} · ${status(item)}` : `${status(item)} · v${item.version}`;
        else if (agent) element.textContent = english ? 'Agent · Project' : 'Agent · 项目主页';
      });
      document.querySelectorAll("[data-release-announcement]").forEach(element => {
        const latest = items.newestEngine;
        element.textContent = english ? `Engine v${latest.version} ${latest.prerelease ? "preview" : "released"}` : `Engine v${latest.version} ${status(latest)}已发布`;
      });
    }
  };
})();
