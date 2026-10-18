(() => {
  "use strict";
  const { site } = window.MOE4ALL_DATA;
  const api = window.MoeSite;
  const icon = name => `<i data-lucide="${name}"></i>`;
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const english = () => document.documentElement.lang === "en";
  const t = (zh, en) => english() ? en : zh;
  const platforms = { windows: "Windows", linux: "Linux", macos: "macOS" };
  let target = { os: api.getPlatform().os, arch: "x86_64" }, chosen = false;
  if (!platforms[target.os]) target = { os: "windows", arch: "x86_64" };
  const dialogs = {};
  function safeURL(value) {
    try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password ? u.href : ""; } catch { return ""; }
  }
  function link(url, content, cls = "") {
    const safe = safeURL(url);
    return safe ? `<a class="${cls}" href="${escape(safe)}" target="_blank" rel="noopener noreferrer">${content}</a>` : "";
  }
  function header(id, eyebrow, title) {
    return `<div class="site-dialog-heading"><div><span class="site-dialog-eyebrow">${eyebrow}</span><h2 id="${id}-title">${title}</h2></div><button class="icon-button site-dialog-close" data-shared-close title="${t("关闭", "Close")}" aria-label="${t("关闭", "Close")}">${icon("x")}</button></div>`;
  }
  function history(repository) {
    return link(`https://github.com/${repository}/releases`, `${icon("history")}<span>${t("历史版本", "All releases")}</span>`, "site-history");
  }
  function releaseCard(kind, primary) {
    const item = window.MOE4ALL_DATA.releases[kind];
    const name = kind === "agent" ? "MoE4All Agent" : kind === "enginePreview" ? "Engine Preview" : "MoE4All Engine";
    const repo = kind === "agent" ? site.agentRepository : site.engineRepository;
    const result = api.getDownload(kind, target);
    const title = result.direct ? t(`下载 ${platforms[target.os]} 版`, `Download for ${platforms[target.os]}`) : t("查看发行页", "View releases");
    const status = item ? `v${escape(item.version)}${item.prerelease ? " · "+t("预览版", "Preview") : ""}` : t("尚无发行版", "No release yet");
    const description = kind === "agent" ? t("桌面应用、本地引擎与插件，一个整合包。", "Desktop app, local engine and plugins in one bundle.") : kind === "enginePreview" ? t("最新引擎候选版本。", "The latest Engine preview release.") : t("终端对话与 OpenAI 兼容 API。", "Chat in your terminal or connect through an OpenAI-compatible API.");
    const availability = !result.direct ? `<span class="site-availability">${t("暂无对应系统的安装包", "No package for this operating system")}</span>` : "";
    return `<article class="site-product ${primary ? "site-product-primary" : "site-product-small"}" data-product="${kind}"><div class="site-product-icon">${icon(primary ? "panels-top-left" : "cpu")}</div><div class="site-product-copy"><div class="site-product-title"><h3>${name}</h3><span>${status}</span></div><p>${description}</p>${availability}</div><div class="site-product-actions"><a class="site-download ${primary ? "site-download-primary" : ""}" data-package="${kind}" data-direct="${result.direct}" href="${escape(result.url)}">${icon(result.direct ? "download" : "arrow-up-right")}<span>${title}</span></a>${history(repo)}</div></article>`;
  }
  function pluginActions() {
    const p = site.pluginInstall;
    return `<div class="site-plugin-split">${link(p.catalog, `${icon("store")}<span>${t("市场安装", "Install via marketplace")}</span>`, "site-download")}<details class="site-install-menu"><summary title="${t("其他安装方式", "More installation options")}" aria-label="${t("其他安装方式", "More installation options")}">${icon("chevron-down")}</summary><div class="site-install-options">${link(p.community, `${icon("store")}<span>dsh.so</span>`)}${link(`https://github.com/${p.repository}`, `${icon("code-xml")}<span>${t("GitHub 安装", "Install from GitHub")}</span>`)}${link(`https://github.com/${p.repository}/releases/latest/download/dsh-llm-moe4all.tgz`, `${icon("download")}<span>${t("下载插件包", "Download plugin package")}</span>`)}</div></details></div>${history(p.repository)}`;
  }
  function renderDownload() {
    const d = dialogs.download;
    d.innerHTML = `${header("download", "DOWNLOAD", t("选择你的 MoE4All", "Choose your MoE4All"))}<div class="site-platform-row"><div class="site-platforms" role="group" aria-label="${t("操作系统", "Operating system")}">${Object.entries(platforms).map(([os,label]) => `<button data-system="${os}" aria-pressed="${target.os === os}">${icon(os === "windows" ? "monitor" : os === "linux" ? "terminal" : "laptop")}<span>${label}</span></button>`).join("")}</div></div>${releaseCard("agent", true)}<div class="site-secondary-products">${releaseCard("engine", false)}${window.MOE4ALL_DATA.releases.enginePreview ? releaseCard("enginePreview", false) : ""}<article class="site-product site-product-small"><div class="site-product-icon">${icon("puzzle")}</div><div class="site-product-copy"><div class="site-product-title"><h3>${t("已有 DSH？安装插件", "Already use DSH?")}</h3></div><p>MoE4All Provider</p></div><div class="site-product-actions">${pluginActions()}</div></article></div>`;
    window.lucide?.createIcons({ root: d });
  }
  function renderCommunity(kind) {
    const contact = kind === "contact", d = dialogs[kind], c = site.contact;
    d.innerHTML = `${header(kind, contact ? "GET IN TOUCH" : "SUPPORT US", contact ? t("联系 MoE4All", "Get in touch") : t("支持 MoE4All", "Support us"))}<div class="site-community"><div class="site-qr-column"><div class="site-qr-frame" aria-busy="true"><img width="480" height="${contact ? 685 : 519}" alt="${contact ? t("MoE4All 微信联系二维码", "MoE4All WeChat contact QR code") : t("MoE4All 微信支持二维码", "MoE4All WeChat donation QR code")}" data-qr-image><span class="site-qr-error" hidden>${t("二维码暂时无法加载", "QR code unavailable")}</span></div><a class="site-save-qr" href="${escape(contact ? c.wechatImage : c.supportImage)}" download="${contact ? "MoE4All-WeChat.webp" : "MoE4All-Support.webp"}">${icon("download")}<span>${t("保存二维码", "Save QR code")}</span></a></div><div class="site-community-copy"><h3>${contact ? t("微信联系", "WeChat") : t("微信支持", "Donate via WeChat")}</h3><p>${contact ? t("交流使用体验，也欢迎分享你的想法。", "Share your experience, questions and ideas.") : t("感谢你支持 MoE4All 继续生长。", "Thank you for helping MoE4All grow.")}</p><div class="site-social-links">${contact ? link(c.bilibili, `${icon("video")}<span><strong>${t("哔哩哔哩", "Bilibili")}</strong><small>headmaster218</small></span>${icon("arrow-up-right")}`) + link(c.douyinSearch, `${icon("music-2")}<span><strong>${t("抖音", "Douyin")}</strong><small>${escape(c.douyinHandle)} · ${t("搜索账号", "Find account")}</small></span>${icon("arrow-up-right")}`) : link(c.buyMeACoffee, `${icon("coffee")}<span><strong>Buy Me a Coffee</strong><small>headmaster218</small></span>${icon("arrow-up-right")}`, "site-coffee-link")}</div></div></div>`;
    const image = d.querySelector("[data-qr-image]"), frame = image.parentElement;
    image.onload = () => frame.setAttribute("aria-busy", "false");
    image.onerror = () => { frame.setAttribute("aria-busy", "false"); image.hidden = true; frame.querySelector(".site-qr-error").hidden = false; };
    image.src = contact ? c.wechatImage : c.supportImage;
    window.lucide?.createIcons({ root: d });
  }
  function open(kind) {
    document.querySelector("#main-nav")?.classList.remove("open");
    document.querySelector("#menu-toggle")?.setAttribute("aria-expanded", "false");
    for (const dialog of Object.values(dialogs)) if (dialog.open) dialog.close();
    if (kind === "download") renderDownload(); else renderCommunity(kind);
    dialogs[kind].showModal();
    document.body.classList.add("modal-open");
  }
  function initialize() {
    for (const kind of ["download", "contact", "support"]) {
      const d = document.createElement("dialog");
      d.id = `${kind}-dialog`; d.className = `site-dialog site-${kind}-dialog`; d.setAttribute("aria-labelledby", `${kind}-title`);
      d.addEventListener("close", () => { if (!document.querySelector("dialog[open]")) document.body.classList.remove("modal-open"); });
      d.addEventListener("click", event => {
        const r = d.getBoundingClientRect();
        if (event.target === d && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) d.close();
      });
      document.body.append(d); dialogs[kind] = d;
    }
    document.addEventListener("click", event => {
      for (const menu of document.querySelectorAll(".site-install-menu[open]")) if (!menu.contains(event.target)) menu.open = false;
      const trigger = event.target.closest('[data-agent-download], [data-download], [data-release-link="agent"], [data-release-link="engine"], [data-release-link="enginePreview"], [data-contact], [data-support], [data-shared-close]');
      if (!trigger || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (trigger.hasAttribute("data-shared-close")) trigger.closest("dialog").close();
      else open(trigger.hasAttribute("data-contact") ? "contact" : trigger.hasAttribute("data-support") ? "support" : "download");
    });
    dialogs.download.addEventListener("keydown", event => {
      const menu = dialogs.download.querySelector(".site-install-menu[open]");
      if (event.key === "Escape" && menu) { event.preventDefault(); event.stopPropagation(); menu.open = false; menu.querySelector("summary").focus(); }
    });
    dialogs.download.addEventListener("click", event => {
      const button = event.target.closest("[data-system]"); if (!button) return;
      const os = button.dataset.system;
      target = { os, arch: "x86_64" }; chosen = true; renderDownload();
      dialogs.download.querySelector(`[data-system="${os}"]`).focus();
    });
    new MutationObserver(() => {
      for (const [kind,d] of Object.entries(dialogs)) if (d.open) kind === "download" ? renderDownload() : renderCommunity(kind);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    window.addEventListener("moe-releases-updated", () => { if (dialogs.download.open) renderDownload(); });
    window.addEventListener("moe-platform-updated", () => { if (!chosen) { const detected = api.getPlatform(); if (platforms[detected.os]) target = { os: detected.os, arch: "x86_64" }; if (dialogs.download.open) renderDownload(); } });
  }
  document.addEventListener("DOMContentLoaded", initialize, { once: true });
})();
