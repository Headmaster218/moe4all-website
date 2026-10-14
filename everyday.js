(() => {
  "use strict";
  const { site, demo } = window.MOE4ALL_DATA;
  let language = "zh", scenario = "past", view = "workspace";
  const views = ["workspace", "models", "memory", "remote"];
  const scenarios = {
    past: { zh: [`“${demo.past.question.zh}”`, "从留下的记忆里找回约定。不必记得关键词，也能接上之前的话题。", "过去的对话", "相关记忆", "找回约定"], en: [`“${demo.past.question.en}”`, "Find a plan in the memories you kept, and pick up the conversation without remembering the exact wording.", "A conversation", "Memory", "The plan"] },
    future: { zh: [`“${demo.future.question.zh}”`, "说出你想做的事，安排成工作台里的定时任务。到了时间，接着往下做。", "一句话", "定时任务", "准时开始"], en: [`“${demo.future.question.en}”`, "Turn a request into a scheduled task in your workspace, ready to continue at the right time.", "A request", "A schedule", "Time to start"] },
    remote: { zh: ["“我在手机上，接着看看和小丽讨论的读书会安排。”", "电脑上的对话与记忆，在手机上接着看。模型依然运行在自己的电脑里。", "电脑工作台", "手机配对", "接着聊"], en: ["“I'm on my phone. Let's continue the reading-club plan with Xiaoli.”", "Pick up your computer's conversations and memory on your phone. The model still runs on your computer.", "Your workspace", "Your phone", "Continue"] },
    private: { zh: [`“${demo.private.question.zh}”`, "让模型在本机处理，让资料留在本机。自己的计划和工作材料，不必交给云端模型。", "私人资料", "本地模型", "本地处理"], en: [`“${demo.private.question.en}”`, "Work through personal plans and documents with a local model, without handing them to a cloud model.", "Private material", "Local AI", "Local work"] }
  };
  const translations = [...document.querySelectorAll("[data-en]")].map(element => ({ element, zh: element.innerHTML, en: element.dataset.en }));
  const carousel = document.querySelector(".product-carousel"), track = document.querySelector(".carousel-track");
  const hero = document.querySelector("#hero-screen"), expanded = document.querySelector("#expanded-product");
  const dialog = document.querySelector("#product-dialog");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let paused = reduced.matches, heroVisible = false, carouselVisible = false, timer = null;
  const frames = () => [...document.querySelectorAll("iframe")];
  function send(frame) {
    const ownView = frame.closest("[data-slide]")?.dataset.slide || view;
    frame.contentWindow?.postMessage({ type: "moe-demo", language, view: ownView }, "*");
  }
  function fitCarousel() {
    const first = track.querySelector(".demo-slide"), gap = Number.parseFloat(getComputedStyle(track).gap);
    track.style.transform = `translateX(${-views.indexOf(view) * (first.getBoundingClientRect().width + gap)}px)`;
  }
  function fitHero() {
    const layer = document.querySelector(".hero-scene-layer"), image = layer.querySelector("img");
    const w = layer.clientWidth, h = layer.clientHeight, config = site.heroScreen;
    const scale = Math.max(w / config.imageWidth, h / config.imageHeight);
    const position = getComputedStyle(image).objectPosition.split(" ").map(value => Number.parseFloat(value) / 100);
    const ox = (w - config.imageWidth * scale) * position[0], oy = (h - config.imageHeight * scale) * position[1];
    const [a,b,c,d] = config.corners.map(([x,y]) => ({ x: x * scale + ox, y: y * scale + oy }));
    // Project the shared rectangular HTML view onto the photo's four screen corners.
    const dx1=b.x-c.x, dx2=d.x-c.x, dy1=b.y-c.y, dy2=d.y-c.y;
    const sx=a.x-b.x+c.x-d.x, sy=a.y-b.y+c.y-d.y, denominator=dx1*dy2-dx2*dy1;
    const g=(sx*dy2-dx2*sy)/denominator, k=(dx1*sy-sx*dy1)/denominator;
    const matrix=[(b.x-a.x+g*b.x)/config.width,(b.y-a.y+g*b.y)/config.width,0,g/config.width,(d.x-a.x+k*d.x)/config.height,(d.y-a.y+k*d.y)/config.height,0,k/config.height,0,0,1,0,a.x,a.y,0,1];
    hero.style.transform=`matrix3d(${matrix.join(",")})`;
  }
  function updateTimer() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (!paused && !document.hidden && !dialog.open && (heroVisible || carouselVisible)) timer = setInterval(() => {
      if (!carousel.matches(':hover')) selectView(views[(views.indexOf(view)+1)%views.length]);
    }, site.carouselIntervalMs);
    for (const toggle of [document.querySelector("#carousel-play"),document.querySelector("#hero-play")]) {
    const icon=paused ? "play" : "pause";
    if(toggle.dataset.icon!==icon) {
      toggle.innerHTML=`<i data-lucide="${icon}"></i>`;
      toggle.dataset.icon=icon;
      window.lucide?.createIcons({root:toggle});
    }
    toggle.setAttribute("aria-pressed", String(paused));
    toggle.title=language === "en" ? (paused ? "Play slideshow" : "Pause slideshow") : (paused ? "播放自动轮播" : "暂停自动轮播");
    toggle.setAttribute("aria-label",toggle.title);
    }
  }
  function selectView(value, manual=false) {
    view=value;
    if(manual) paused=true;
    carousel.dataset.currentView=view;
    document.querySelectorAll("[data-view]").forEach(button => {
      const selected=button.dataset.view===view;
      button.setAttribute("aria-selected",String(selected)); button.tabIndex=selected?0:-1;
      button.setAttribute("aria-controls",`${button.dataset.view}-panel`);
    });
    document.querySelectorAll(".demo-slide").forEach(slide => {
      const selected=slide.dataset.slide===view;
      slide.classList.toggle("is-current",selected);
      slide.id=`${slide.dataset.slide}-panel`; slide.setAttribute("aria-hidden",String(!selected));
      slide.setAttribute("aria-roledescription","slide");
    });
    document.querySelector("#carousel-count").textContent=`0${views.indexOf(view)+1} / 04`;
    fitCarousel(); send(hero); if(dialog.open)send(expanded); updateTimer();
  }
  function render() {
    window.MoeSite.renderReleases(language);
    document.querySelectorAll("[data-scenario]").forEach(button => {
      const selected=button.dataset.scenario===scenario;
      button.setAttribute("aria-selected",String(selected)); button.tabIndex=selected?0:-1;
    });
    const panel=document.querySelector("#scenario-panel");
    panel.setAttribute("aria-labelledby",`${scenario}-tab`); panel.dataset.scene=scenario;
    ["scenario-prompt","scenario-description","process-first","process-middle","process-last"].forEach((id,index) => {document.getElementById(id).textContent=scenarios[scenario][language][index];});
    frames().forEach(send); selectView(view); fitHero();
    for(const [id,zh,en] of [["scenario-next","下一场景","Next scenario"],["carousel-prev","上一页","Previous slide"],["carousel-next","下一页","Next slide"],["expand-product","放大界面","Expand the demo"],["close-product","关闭大图","Close the demo"]]) {
      const button=document.getElementById(id);button.title=language==="en"?en:zh;button.setAttribute("aria-label",button.title);
    }
  }
  function bindTabs(selector,getValue,setValue) {
    const buttons=[...document.querySelectorAll(selector)], key=button=>button.dataset.scenario||button.dataset.view;
    buttons.forEach(button=>{
      button.addEventListener("click",()=>{setValue(key(button));render();});
      button.addEventListener("keydown",event=>{
        if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(event.key))return;
        event.preventDefault();
        const current=buttons.findIndex(item=>key(item)===getValue());
        const index=event.key==="Home"?0:event.key==="End"?buttons.length-1:(current+(["ArrowRight","ArrowDown"].includes(event.key)?1:-1)+buttons.length)%buttons.length;
        setValue(key(buttons[index]));render();buttons[index].focus();
      });
    });
  }
  bindTabs("[data-scenario]",()=>scenario,value=>{scenario=value;});
  const scenarioOrder=Object.keys(scenarios);
  document.querySelector("#scenario-next").addEventListener("click",()=>{
    scenario=scenarioOrder[(scenarioOrder.indexOf(scenario)+1)%scenarioOrder.length];
    render();
  });
  bindTabs("[data-view]",()=>view,value=>{selectView(value,true);});
  document.querySelector("#carousel-prev").addEventListener("click",()=>selectView(views[(views.indexOf(view)+3)%4],true));
  document.querySelector("#carousel-next").addEventListener("click",()=>selectView(views[(views.indexOf(view)+1)%4],true));
  document.querySelector("#carousel-play").addEventListener("click",()=>{paused=!paused;updateTimer();});
  document.querySelector("#hero-play").addEventListener("click",()=>{paused=!paused;updateTimer();});
  carousel.addEventListener("mouseenter",updateTimer);
  carousel.addEventListener("mouseleave",updateTimer);
  carousel.addEventListener("focusin",event=>{if(event.target.id!=="carousel-play"){paused=true;updateTimer();}});
  document.addEventListener("visibilitychange",updateTimer);
  reduced.addEventListener("change",()=>{if(reduced.matches){paused=true;updateTimer();}});
  if("IntersectionObserver" in window) {
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries)if(entry.target===carousel)carouselVisible=entry.isIntersecting;else {
        heroVisible=entry.isIntersecting;
        if(heroVisible)requestAnimationFrame(()=>{fitHero();send(hero);});
      }
      updateTimer();
    },{threshold:.1});observer.observe(carousel);observer.observe(document.querySelector(".hero-stage"));
  }else{heroVisible=true;}
  const menu=document.querySelector("#main-nav"),menuToggle=document.querySelector("#menu-toggle");
  const closeMenu=()=>{menu.classList.remove("open");menuToggle.setAttribute("aria-expanded","false");};
  menuToggle.addEventListener("click",()=>menuToggle.setAttribute("aria-expanded",String(menu.classList.toggle("open"))));
  menu.querySelectorAll("a").forEach(link=>link.addEventListener("click",closeMenu));
  document.addEventListener("keydown",event=>{if(event.key==="Escape")closeMenu();});
  document.querySelector("#expand-product").addEventListener("click",()=>{dialog.showModal();document.body.classList.add("modal-open");send(expanded);updateTimer();});
  document.querySelector("#close-product").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("close",()=>{document.body.classList.remove("modal-open");updateTimer();});
  dialog.addEventListener("click",event=>{
    const r=dialog.getBoundingClientRect();
    if(event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))dialog.close();
  });
  addEventListener("message",event=>{if(event.data?.type!=="moe-demo-ready")return;const frame=frames().find(item=>item.contentWindow===event.source);if(frame)send(frame);});
  frames().forEach(frame=>frame.addEventListener("load",()=>send(frame)));
  const resize=new ResizeObserver(()=>{fitHero();fitCarousel();});resize.observe(document.querySelector(".hero-scene-layer"));resize.observe(document.querySelector(".carousel-window"));
  const wave=document.querySelector("#audio-ribbon");
  for(let i=0;i<64;i++) {
    const bar=document.createElement("span"),height=12+Math.abs(Math.sin(i*.58)*Math.cos(i*.17))*83;
    bar.style.setProperty("--height",`${height}%`);bar.style.setProperty("--opacity",String(.35+height/155));bar.style.setProperty("--delay",`${-i*.1}s`);wave.append(bar);
  }
  function setLanguage(value) {
    language=value;document.documentElement.lang=language==="zh"?"zh-CN":"en";
    translations.forEach(({element,zh,en})=>{element.innerHTML=language==="zh"?zh:en;});
    const toggle=document.querySelector("#language-toggle");toggle.querySelector("span").textContent=language==="zh"?"EN":"中";
    toggle.title=language==="zh"?"Switch to English":"切换到中文";toggle.setAttribute("aria-label",toggle.title);
    document.title=language==="zh"?"MoE4All · 记得昨天，安排明天":"MoE4All · Remember yesterday. Plan tomorrow.";
    render();
  }
  document.querySelector("#language-toggle").addEventListener("click",()=>{
    setLanguage(language==="zh"?"en":"zh");
    window.MoeSite.rememberLanguage(language);
  });
  setLanguage(window.MoeSite.getPreferredLanguage());
  window.lucide?.createIcons();
})();
