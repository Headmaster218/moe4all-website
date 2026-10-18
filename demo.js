(() => {
  "use strict";
  const { demo, releases } = window.MOE4ALL_DATA;
  const query = new URLSearchParams(location.search);
  let language = query.get("lang") === "en" ? "en" : "zh";
  const views = ["workspace", "models", "memory", "remote"];
  let view = views.includes(query.get("view")) ? query.get("view") : "workspace";
  const t = value => value[language];
  const words = (zh, en) => language === "en" ? en : zh;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const icon = name => `<i data-lucide="${name}"></i>`;
  const badge = (label, cls = "") => `<span class="demo-badge ${cls}">${escape(label)}</span>`;
  const text = value => escape(t(value));
  const pageTitle = () => ({workspace:words("和小丽的讨论", "Planning with Xiaoli"),models:words("模型与引擎", "Models & engine"),memory:words("记忆管理", "Memory management"),remote:words("手机远程访问", "Phone connection")})[view];
  function sidebar() {
    return `<aside class="demo-sidebar"><div class="demo-brand"><span class="app-mark">M</span> MoE4All</div><div class="new-session">${icon("plus")}${words("新会话", "New conversation")}</div><div class="side-memory ${view === "memory" ? "selected" : ""}">${icon("brain")}${words("记忆", "Memory")}${badge("4")}</div><div class="side-label">${words("工作区", "Workspace")}</div><div class="workspace-name">${icon("folder-open")}${words("小李的工作台", "Li's workspace")}</div><div class="session-list">${demo.conversations.map((item, index) => `<div class="${index === 0 ? "selected" : ""}">${icon("message-square")}${text(item)}</div>`).join("")}</div><div class="side-task-title">${icon("clock-3")}${words("定时任务", "Scheduled tasks")}</div><div class="side-tasks">${demo.tasks.map(task => `<div><span class="task-dot"></span><span>${text(task.text)}<small>${text(task.time)}</small></span></div>`).join("")}</div><div class="sidebar-bottom"><span>${icon("smartphone")}${words("手机连接", "Phone connection")}</span><span>${icon("settings-2")}${words("设置", "Settings")}</span></div></aside>`;
  }
  function chat() {
    return `<section class="chat-content"><div class="chat-date">${words("今天 · 接着上次的对话", "Today · Picking up our conversation")}</div><div class="chat-message user"><span class="avatar">${words("李", "L")}</span><div><strong>${text(demo.person)}</strong><p>${text(demo.past.question)}</p></div></div><div class="chat-message assistant"><span class="avatar ai">M</span><div><strong>MoE4All</strong><div class="tool-line">${icon("brain")}${words("找到一条相关记忆", "Found a relevant memory")}</div><p>${text(demo.past.answer)}</p><div class="memory-citation">${icon("notebook-tabs")}${text(demo.past.source)}</div></div></div><div class="chat-message user"><span class="avatar">${words("李", "L")}</span><div><strong>${text(demo.person)}</strong><p>${text(demo.future.question)}</p></div></div><div class="chat-message assistant"><span class="avatar ai">M</span><div><strong>MoE4All</strong><p>${text(demo.future.answer)}</p><div class="task-receipt">${icon("circle-check")}<span>${words("定时提醒已创建", "Reminder scheduled")}<small>${text(demo.tasks[0].time)}</small></span></div></div></div></section><div class="composer"><span>${words("接着聊，或者开始一个新想法…", "Continue the conversation, or start a new thought…")}</span><div>${icon("plus")}<small>FlashNext-176B · ${words("本地", "Local")}</small>${icon("arrow-up")}</div></div>`;
  }
  function models() {
    const engine = releases.enginePreview || releases.engine;
    return `<section class="settings-content"><div class="panel-heading"><div><h1>${words("你的模型，在自己电脑上", "Your models, on your computer")}</h1><p>${words("本地推理、对话与记忆检索，放在一起。", "Local inference, conversations and memory retrieval, together.")}</p>${badge(words("演示配置", "Demo configuration"))}</div>${icon("cpu")}</div><div class="engine-row"><span class="engine-indicator"></span><div><strong>MoE4All Engine</strong><small>v${escape(engine.version)} · ${words("本地引擎", "Local engine")}</small></div>${badge(words("就绪", "Ready"), "green")}</div><h2>${words("已安装的模型", "Installed models")}</h2><div class="models-list">${demo.models.map((model,index) => `<div>${icon(index === 2 ? "brain" : "cpu")}<span><strong>${escape(model.name)}</strong><small>${escape(model.detail)} · ${text(model.type)}</small></span>${badge(index === 0 ? words("当前使用", "Selected") : words("已安装", "Installed"), index === 0 ? "green" : "")}</div>`).join("")}</div><div class="config-row"><span>${words("资源策略", "Resource policy")}<b>${words("自动", "Automatic")}</b></span><span>${words("并发会话", "Concurrent sessions")}<b>2 slots</b></span><span>${words("记忆检索", "Memory retrieval")}<b>${words("本地 Embedding", "Local embedding")}</b></span></div><div class="local-notice">${icon("hard-drive")}${words("模型与记忆检索都在这台电脑上运行", "Models and memory retrieval run on this computer")}</div></section>`;
  }
  function memory() {
    return `<section class="settings-content memory-content"><div class="panel-heading"><div><h1>${words("有用的背景，留给下一次", "Useful context for next time")}</h1><p>${words("关于你、项目，以及曾经说好的事情。", "About you, your projects, and the plans you made.")}</p></div>${icon("brain")}</div><div class="memory-summary"><span><strong>4</strong>${words("条记忆", "memories")}</span><span>${icon("hard-drive")}${words("保存在本地", "Stored locally")}</span>${badge(words("已整理", "Consolidated"), "green")}</div><div class="memory-search">${icon("search")}${words("搜索记忆、人物、项目…", "Search memories, people, projects…")}</div><div class="memory-list">${demo.memories.map((item,index) => `<article><div>${badge(t(item.category))}<span>${words("上周更新", "Updated last week")}</span></div><p>${text(item.text)}</p><footer>${words("来源：", "Source: ")}${index < 2 ? words("认识一下自己", "Getting to know you") : text(demo.past.source)}${icon("ellipsis")}</footer></article>`).join("")}</div></section>`;
  }
  function remote() {
    return `<section class="settings-content remote-content"><div class="panel-heading"><div><h1>${words("换个屏幕，还是同一个工作台", "Another screen. The same workspace.")}</h1><p>${words("手机连到你的电脑，模型与记忆依然留在电脑上。", "Your phone connects to the computer. Models and memories stay there.")}</p></div>${icon("smartphone")}</div><div class="remote-layout"><div><div class="connection-card"><span class="connected-dot"></span><strong>${words("我的手机", "My phone")}</strong>${badge(words("已连接", "Connected"), "green")}<p>${words("本地网络 · 已授权设备", "Local network · Authorized device")}</p></div><div class="device-route"><div>${icon("monitor")}<span>${words("这台电脑", "This computer")}</span></div>${icon("arrow-left-right")}<div>${icon("smartphone")}<span>${words("我的手机", "My phone")}</span></div></div><div class="remote-benefits"><span>${icon("message-square")}${words("同一份对话", "Same conversations")}</span><span>${icon("brain")}${words("同一份记忆", "Same memories")}</span><span>${icon("shield-check")}${words("配对后访问", "Access after pairing")}</span></div></div><div class="phone"><div class="phone-bar"><span>09:41</span><span>•••</span></div><div class="phone-heading">MoE4All <span>${words("已连接", "Connected")}</span></div><div class="phone-thread">${text(demo.conversations[0])}</div><div class="phone-question">${text(demo.past.question)}</div><div class="phone-answer"><strong>M · MoE4All</strong><p>${text(demo.past.answer)}</p><small>${icon("brain")}${words("来自你的本地记忆", "From your local memory")}</small></div><div class="phone-input">${words("继续对话…", "Continue…")}${icon("arrow-up")}</div></div></div></section>`;
  }
  const stage = document.querySelector("#demo-stage");
  function fit() {
    stage.style.transform = `scale(${Math.min(innerWidth / 960, innerHeight / 620)})`;
  }
  function render() {
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    document.body.dataset.view = view;
    stage.innerHTML = `<div class="demo-app">${sidebar()}<main class="demo-main"><header class="demo-top"><span>${escape(pageTitle())}</span><span class="demo-label">${words("演示工作区", "Demo workspace")}</span>${icon("panel-right")}</header>${({workspace:chat,models,memory,remote})[view]()}</main></div>`;
    window.lucide?.createIcons(); fit();
  }
  addEventListener("resize", fit);
  addEventListener("message", event => {
    if (event.source !== parent) return;
    if (event.data?.type === "moe-release-data") {
      Object.assign(releases, event.data.releases);
      render();
      return;
    }
    if (event.data?.type !== "moe-demo") return;
    if (["zh", "en"].includes(event.data.language)) language = event.data.language;
    if (views.includes(event.data.view)) view = event.data.view;
    render();
  });
  render();
  if (parent !== window) parent.postMessage({ type: "moe-demo-ready" }, "*");
})();
