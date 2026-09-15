/* ======================= STAYING UP TO DATE =======================
   Everybody runs the newest Settle without having to refresh.

   Every build stamps its id into this file and into version.json beside the
   page. While Settle is on screen it asks for version.json once a minute, and
   whenever it comes back into view. When the id there is not this one, a new
   release is live: the new service worker is fetched and the app reloads onto
   it - at once if nothing is happening, or as soon as the person stops typing,
   closes a sheet or answers a question. Whichever tab they were on, they are
   still on after. */
const APP_BUILD = "__SETTLE_BUILD_ID__";
const UPDATE_EVERY_MS = 60e3;
const UPDATE_KEY = "settle.updated.v1";     // sessionStorage: the reload was ours
const UPDATE_TRIED = "settle.updateTried.v1";
let UPDATE_WAITING = false, UPDATE_RELOADING = false, UPDATE_MANUAL = false;

function updateBusy(){
  // Never while changes are still on their way to the database, and never
  // with no signal. They are kept on the device either way, but a reload
  // offline could leave Settle unable to reach its data until signal returns.
  if(PENDING > 0 || ONLINE === false) return true;
  const a=document.activeElement;
  if(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
  const sheet=$("sheet");
  if(sheet && !sheet.hidden) return true;
  return !!document.querySelector(".arr:not(.arr-quiet), .paid-pop");
}

function updateNow(build){
  if(UPDATE_RELOADING) return;
  if(updateBusy()){ UPDATE_WAITING=true; return; }
  // A page the browser still holds from before the release would come back
  // just as old, and ask again, and reload again. One try per build every
  // ten minutes stops that ever becoming a loop.
  try{
    const t=JSON.parse(sessionStorage.getItem(UPDATE_TRIED)||"null");
    if(build && t && t.build===build && Date.now()-t.at < 10*60e3) return;
    if(build) sessionStorage.setItem(UPDATE_TRIED, JSON.stringify({build, at:Date.now()}));
    sessionStorage.setItem(UPDATE_KEY, JSON.stringify({tab:TAB, at:Date.now(), manual:UPDATE_MANUAL}));
  }catch(e){}
  UPDATE_RELOADING=true;
  location.reload();
}

async function updateCheck(){
  if(window.__NO_SW || document.hidden || UPDATE_RELOADING) return;
  if(UPDATE_WAITING){ UPDATE_WAITING=false; return updateNow(); }
  try{
    const r=await fetch("version.json?t="+Date.now(), {cache:"no-store"});
    if(!r.ok) return;
    const v=await r.json();
    if(!v || typeof v.build!=="string" || !v.build || v.build===APP_BUILD) return;
    if("serviceWorker" in navigator){
      const reg=await navigator.serviceWorker.getRegistration();
      if(reg){ try{ await reg.update(); }catch(e){} }
    }
    updateNow(v.build);
  }catch(e){ /* offline, or the site is mid-deploy: try again next time */ }
}

if(!window.__NO_SW){
  // A new service worker taking over is a release arriving by the other road.
  if("serviceWorker" in navigator){
    const hadController=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", ()=>{ if(hadController) updateNow(); });
  }
  document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) updateCheck(); });
  window.addEventListener("pageshow", e=>{ if(e.persisted) updateCheck(); });   // iPhone returning from the background
  window.addEventListener("online", updateCheck);
  setInterval(updateCheck, UPDATE_EVERY_MS);
  // Waiting for somebody to finish: look again every few seconds.
  setInterval(()=>{ if(UPDATE_WAITING && !updateBusy()){ UPDATE_WAITING=false; updateNow(); } }, 4000);
  setTimeout(updateCheck, 8000);
}

/* The refresh button in the top bar. An app on the iPhone Home Screen has no
   address bar and no pull-to-refresh, so this is the only way to reload it
   short of closing it. It fetches the newest service worker first, so the
   reload lands on the latest release, and comes back to the same tab. */
async function manualRefresh(btn){
  if(UPDATE_RELOADING) return;
  const stop=()=>{ if(btn){ btn.classList.remove("spin"); btn.disabled=false; } };
  const later=()=>{
    // Refreshes by itself once the signal is back and everything has synced.
    UPDATE_WAITING=true; UPDATE_MANUAL=true; stop();
    toast(PENDING
      ? "You’re offline. Your changes are saved on this device — Settle refreshes once they sync."
      : "You’re offline. Settle will refresh when you’re back online.");
  };
  if(ONLINE===false) return later();
  if(btn){ btn.classList.add("spin"); btn.disabled=true; }
  // Changes still on their way go first. They would survive a reload - they
  // are written down on the device - but finishing them now is quicker.
  if(PENDING>0){
    toast("Saving your changes first…");
    const t0=Date.now();
    while(PENDING>0 && ONLINE!==false && Date.now()-t0 < 12000) await new Promise(r=> setTimeout(r, 250));
    if(ONLINE===false) return later();
  }
  try{ sessionStorage.setItem(UPDATE_KEY, JSON.stringify({tab:TAB, at:Date.now(), manual:true})); }catch(e){}
  try{
    if(!window.__NO_SW && "serviceWorker" in navigator){
      const reg=await navigator.serviceWorker.getRegistration();
      if(reg) await Promise.race([reg.update(), new Promise(r=> setTimeout(r, 2500))]);
    }
  }catch(e){}
  UPDATE_RELOADING=true;
  setTimeout(()=> location.reload(), 300);
}
// Every refresh button: the top bar on a phone, the sidebar on a computer.
document.querySelectorAll("[data-refresh]").forEach(b=> b.addEventListener("click", ()=> manualRefresh(b)));

// Straight after an update or a refresh: back on the same tab, and say so.
function updateRestore(){
  try{
    const u=JSON.parse(sessionStorage.getItem(UPDATE_KEY)||"null");
    sessionStorage.removeItem(UPDATE_KEY);
    if(!u || Date.now()-Number(u.at) > 60e3) return;
    if(["home","groups","activity","account","interac","insights"].indexOf(u.tab)>-1) TAB=u.tab;
    setTimeout(()=> toast(u.manual ? "Refreshed" : "Settle is up to date"), 1400);
  }catch(e){}
}

// "Version 14 Sep, 18:30" - so anyone can see they have the latest.
function buildLabel(){
  const m=/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(APP_BUILD);
  if(!m) return "Development copy";
  const d=new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5]));
  return d.toLocaleDateString(undefined, {day:"numeric", month:"short"})+", "+
         d.toLocaleTimeString(undefined, {hour:"2-digit", minute:"2-digit"});
}
