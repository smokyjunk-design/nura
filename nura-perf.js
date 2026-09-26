function videoModel(){
  return state.quality === "low" ? "alibaba/wan-2.2-fast" : "bytedance/seedance-2.0-mini";
}
function videoUrl(prompt, stillUrl){
  const duration = Math.min(10, Math.max(4, Number(state.duration) || 5));
  const qs = new URLSearchParams({
    model: videoModel(),
    duration: String(duration),
    aspectRatio: state.ratio || "9:16",
    nologo: "true",
    audio: state.quality === "low" ? "false" : "true",
    key: state.apiKey
  });
  if(stillUrl) qs.set("image[0]", stillUrl);
  return "https://gen.pollinations.ai/video/" + encodeURIComponent(prompt) + "?" + qs.toString();
}
function waitForVideo(url, timeoutMs){
  return new Promise((resolve, reject)=>{
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto";
    const t = setTimeout(()=>{ v.removeAttribute("src"); v.load(); reject(new Error("Timed out waiting for video")); }, timeoutMs);
    const ok = ()=>{ clearTimeout(t); resolve(url); };
    v.onloadeddata = ok;
    v.oncanplay = ok;
    v.onerror = ()=>{ clearTimeout(t); reject(new Error("Video failed to load")); };
    v.src = url;
  });
}
async function runVideo(prompt, stillUrl){
  if(!state.apiKey) throw new Error("Video needs a Pollinations API key (Settings). Still generated instead.");
  const url = videoUrl(prompt, stillUrl);
  await waitForVideo(url, 180000);
  return { url, type:"video/mp4", stream:true };
}
async function generate(){
  if(state.busy){ toast("One job at a time on the free queue."); return; }
  const raw = document.getElementById("prompt").value.trim();
  if(BLOCK.test(raw)){ toast("Prompt blocked. No charge."); return; }
  if(!raw && state.mode!=="i2v"){ toast("Describe the shot."); return; }
  const cost = currentCost();
  if(state.credits < cost){ toast("Not enough credits."); go("pricing"); return; }
  const prompt = buildPrompt(raw, state.mode);
  const inf = state.influencer || demoInfluencer();
  const job = {
    id:"j"+Date.now(), status:"queued", prompt: raw || "locked identity", fullPrompt: prompt,
    mode:state.mode, ratio:state.ratio, quality:state.quality, duration:state.duration,
    src:"", remote:"", title: inf.name+" · "+state.mode, video: state.mode.includes("v"),
    created: Date.now(), cost: currentCost()
  };
  state.jobs.push(job); state.credits -= job.cost; state.busy = true;
  setCredits(); renderStudio();
  try{
    const reuse = state.mode==="i2v" && state.current && (state.current.remote || (state.current.src && !String(state.current.src).startsWith("blob:")));
    const still = reuse ? (state.current.remote || state.current.src) : await runStill(prompt, inf.seed);
    job.remote = still; job.src = still;
    job.status = job.video ? "animating" : "done";
    save(); if(state.page==="studio") renderStudio();
    if(job.video){
      try{
        const vid = await runVideo(prompt, still);
        job.src = vid.url; job.kind = vid.type; job.poster = still; job.title += " · motion";
      }catch(ve){
        job.note = String(ve.message||ve); toast(job.note);
      }
    }
    job.status = "done"; toast("Ready · "+job.title);
  }catch(err){
    job.status = "fail"; job.error = String(err.message||err);
    state.credits += job.cost; setCredits();
    toast("Failed, credits refunded. "+job.error);
  }finally{
    state.busy = false; save();
    if(state.page==="studio") renderStudio(); else updateCost();
  }
}
renderGallery = function(el, jobs){
  if(!jobs.length){
    el.innerHTML = '<div class="muted" style="padding:20px">No jobs yet. Generate a still — this hits a live image model.</div>';
    return;
  }
  el.innerHTML = jobs.map(j=>{
    if(j.status==="queued") return `<article class="card"><div class="spin">Generating · ${j.quality}<br><span class="muted">${j.mode} · ${j.ratio}<br>free queue, can take 15–60s</span></div></article>`;
    if(j.status==="animating") return `<article class="card video-frame"><span class="lbl">ANIMATING</span><img src="${j.src}" alt="" loading="eager"><div class="cap">Still ready · encoding clip…</div></article>`;
    if(j.status==="fail") return `<article class="card"><div class="spin" style="color:var(--bad)">Failed<br><span class="muted">${escapeHtml(j.error||"")}</span></div></article>`;
    const media = (j.kind||"").startsWith("video")
      ? `<video src="${j.src}" poster="${j.poster||j.remote||""}" muted autoplay loop playsinline preload="metadata"></video>`
      : `<img src="${j.src}" alt="" loading="lazy">`;
    return `<article class="card ${j.video && !(j.kind||"").startsWith("video")?"video-frame":""}" onclick='openLb(${JSON.stringify(j.id)})'><span class="lbl">${j.video?"VIDEO · "+j.duration+"s":j.ratio+" · "+j.quality.toUpperCase()}</span>${media}<div class="cap">${escapeHtml(j.prompt).slice(0,80)}</div></article>`;
  }).join("");
};
function openLb(id){
  const j = state.jobs.find(x=>x.id===id); if(!j) return;
  state.current = j;
  const img = document.getElementById("lbImg");
  const vid = document.getElementById("lbVid");
  const isVid = (j.kind||"").startsWith("video");
  if(vid){
    img.classList.toggle("hide", isVid);
    vid.classList.toggle("hide", !isVid);
    if(isVid){ vid.poster = j.poster || j.remote || ""; vid.src = j.src; vid.play().catch(()=>{}); }
    else { vid.pause(); vid.removeAttribute("src"); vid.load(); img.src = j.src; }
  }else img.src = j.src;
  document.getElementById("lbCap").textContent = `${j.title} · ${j.mode} · ${j.ratio} · ${j.cost} cr${j.note?" · "+j.note:""}`;
  document.getElementById("lb").classList.add("on");
}
function closeLb(){
  const vid = document.getElementById("lbVid");
  if(vid) vid.pause();
  document.getElementById("lb").classList.remove("on");
}
