(() => {
  "use strict";
  const tokens = {
    "headmaster218.github.io": "018ded73fd29484c99e6b72140098d8e",
    "moe4all.com": "7948339a80cb4efc976f546a87bcbf4b"
  };
  const token = tokens[location.hostname];
  const page = location.pathname.replace(/^\/moe4all-website\//, "/");
  if (!["http:", "https:"].includes(location.protocol) || !token || window.top !== window.self || !["/", "/index.html", "/technical.html"].includes(page) || window.__moeAnalyticsLoaded) return;
  if (location.protocol === "http:") {
    location.replace?.("https://" + location.hostname + location.pathname + (location.search || "") + (location.hash || ""));
    return;
  }
  if (page === "/index.html" && window.history?.replaceState) {
    try { window.history.replaceState(window.history.state, "", location.pathname.replace(/index\.html$/, "") + (location.search || "") + (location.hash || "")); } catch {}
  }
  window.__moeAnalyticsLoaded = true;
  const script = document.createElement("script");
  script.type = "module";
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.dataset.cfBeacon = JSON.stringify({ token });
  document.body.append(script);
})();
