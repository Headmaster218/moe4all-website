(() => {
  "use strict";
  window.MoeSite = {
    releaseRoot: `https://github.com/${window.MOE4ALL_DATA.site.productRepository}/releases`,
    renderReleases(language) {
      const releases = window.MOE4ALL_DATA.releases;
      const items = { ...releases, newestEngine: releases.enginePreview || releases.engine };
      const english = language === "en";
      const status = item => english ? (item.prerelease ? "Preview" : "Stable") : (item.prerelease ? "测试版" : "正式版");
      document.querySelectorAll("[data-release-link], [data-agent-download]").forEach(element => {
        const item = items[element.dataset.releaseLink || "agent"];
        element.hidden = element.hasAttribute("data-release-link") && !item;
        element.href = item?.url || this.releaseRoot;
      });
      document.querySelectorAll("[data-release-tag], [data-agent-version]").forEach(element => {
        const agent = element.hasAttribute("data-agent-version");
        const item = items[element.dataset.releaseTag || "agent"];
        element.hidden = !item;
        if (item) element.textContent = agent ? `Agent v${item.version} · ${status(item)}` : `${status(item)} · v${item.version}`;
      });
      document.querySelectorAll("[data-release-announcement]").forEach(element => {
        const latest = items.newestEngine;
        element.textContent = english ? `Engine v${latest.version} ${latest.prerelease ? "preview" : "released"}` : `Engine v${latest.version} ${status(latest)}已发布`;
      });
    }
  };
})();
