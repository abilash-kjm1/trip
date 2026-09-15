/* ======================= PHONE NOTIFICATIONS =======================
   Web Push, so a phone hears about a payment without Settle being open.

   This device says yes once. Its subscription - an address at Google's,
   Apple's or Mozilla's push service and two public keys - is kept at
   users/{uid}/push/{id}, which only this account can write. The browser
   never sends a notification: it records what happened in the outbox, and
   the scheduler decides who hears, from the payment record itself, and signs
   the notification with a private key only the server holds.

   Android: works in Chrome as it is.
   iPhone: only once Settle is on the Home Screen (iOS 16.4 and later) -
   Safari offers no notifications to an ordinary tab - so the iPhone gets the
   steps to add it instead of a button that could not work. */

// The public half of the key pair. Safe to publish; it only lets a push
// service check that a notification really came from this app's server.
const VAPID_PUBLIC_KEY = "BP6vyGBCPEhg3ZO3SEtWm8lnymnaA9AlitfolLa8x9tt3igs-pRmF2Hvi97PvtXMsWjceBYqATo7dj44Qiio5Kw";
const PUSH_LATER_KEY = "settle.push.later.v1";   // when "Not now" was tapped on this device
let PUSH_STATE = "unknown";      // unknown | on | off | ios-install | denied | none

const pushStandalone = ()=>{
  try{ return matchMedia("(display-mode: standalone)").matches || navigator.standalone===true; }
  catch(e){ return false; }
};
function pushDevice(){
  const ua=navigator.userAgent||"";
  if(etxIsIOS()) return /iPad/.test(ua) ? "iPad" : "iPhone";
  if(/Android/i.test(ua)) return "phone";
  return "browser";
}
// What this device can do before asking anything of anybody.
function pushSupport(){
  if(window.__NO_SW || !("serviceWorker" in navigator)) return "none";
  if(!("PushManager" in window) || !("Notification" in window))
    return etxIsIOS() && !pushStandalone() ? "ios-install" : "none";
  if(Notification.permission==="denied") return "denied";
  return "ok";
}
function swReady(ms){
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, no)=> setTimeout(()=> no(new Error("the app is still starting — reload and try again")), ms||8000))
  ]);
}
function b64uBytes(s){
  const b=atob((s+"=".repeat((4-s.length%4)%4)).replace(/-/g,"+").replace(/_/g,"/"));
  return Uint8Array.from(b, c=>c.charCodeAt(0));
}
// One record per device, named after its push address, so turning it on
// twice updates the same record instead of adding another.
async function pushId(endpoint){
  try{
    const h=new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
    return btoa(String.fromCharCode.apply(null, h)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"").slice(0,32);
  }catch(e){
    let n=0; for(let i=0;i<endpoint.length;i++) n=(n*31+endpoint.charCodeAt(i))|0;
    return "d"+(n>>>0).toString(36);
  }
}
async function pushSave(sub){
  const j=sub && sub.toJSON ? sub.toJSON() : null;
  if(!j || !j.endpoint || !j.keys || !j.keys.p256dh || !j.keys.auth) throw new Error("the browser did not finish setting it up");
  const id=await pushId(j.endpoint);
  return updStrict("users/"+USER.uid+"/push/"+id, {
    endpoint:j.endpoint, keys:{p256dh:j.keys.p256dh, auth:j.keys.auth},
    device:pushDevice(), at:Date.now()
  });
}

// Where this device stands. Re-saves a live subscription on every open, so a
// push address the browser quietly renewed is never left stale.
async function pushRefresh(){
  let s=pushSupport();
  if(s==="ok"){
    try{
      const reg=await swReady(5000), sub=await reg.pushManager.getSubscription();
      s = sub && Notification.permission==="granted" ? "on" : "off";
      if(s==="on" && USER) pushSave(sub).catch(()=>{});
    }catch(e){ s="off"; }
  }
  if(s!==PUSH_STATE){ PUSH_STATE=s; render(); }
  return s;
}

function pushEnable(btn){
  const s=pushSupport();
  if(s!=="ok"){ PUSH_STATE = s; sheetPush(); return; }
  if(btn) btn.disabled=true;
  // Asked at once, inside the tap. Safari turns down a request that waits on
  // anything else first, and older Safari answers by callback, not promise.
  const asked=new Promise(done=>{
    try{ const p=Notification.requestPermission(done); if(p && p.then) p.then(done); }
    catch(e){ done("default"); }
  });
  return asked.then(async perm=>{
    if(perm!=="granted"){
      PUSH_STATE = perm==="denied" ? "denied" : "off";
      render();
      if(perm==="denied") sheetPush(); else toast("Notifications are still off");
      return false;
    }
    const reg=await swReady();
    let sub=await reg.pushManager.getSubscription();
    if(!sub){
      const opts={userVisibleOnly:true, applicationServerKey:b64uBytes(VAPID_PUBLIC_KEY)};
      try{ sub=await reg.pushManager.subscribe(opts); }
      catch(e){
        // Left over from a different key: start again once.
        const old=await reg.pushManager.getSubscription(); if(old) await old.unsubscribe();
        sub=await reg.pushManager.subscribe(opts);
      }
    }
    await pushSave(sub);
    PUSH_STATE="on"; lsSet(PUSH_LATER_KEY, null);
    render();
    toast("Notifications are on for this "+pushDevice());
    try{ reg.showNotification("You’re all set", {body:"Settle will tell you here when money moves.",
                                                 icon:"icon-192.png", tag:"settle-welcome"}); }catch(e){}
    return true;
  }).catch(e=>{
    toast("Could not turn them on: "+((e && e.message) || "try again"));
    pushRefresh();
    return false;
  }).finally(()=>{ if(btn) btn.disabled=false; });
}

async function pushDisable(){
  try{
    const reg=await swReady(5000), sub=await reg.pushManager.getSubscription();
    if(sub){
      const id=await pushId(sub.endpoint);
      await sub.unsubscribe();
      if(USER) await del("users/"+USER.uid+"/push/"+id);
    }
  }catch(e){}
  PUSH_STATE="off"; render();
  toast("Notifications are off on this "+pushDevice());
}

/* ---------- the sheet: every state says what to do next ---------- */
function sheetPush(){
  openSheet("Phone notifications", (b)=>{
    const s=PUSH_STATE, dev=pushDevice();
    const steps=(list)=> '<ol class="pn-steps">'+list.map((x,i)=>
      '<li><span class="pn-n">'+(i+1)+'</span><span class="ms" aria-hidden="true">'+x[0]+'</span><span>'+x[1]+'</span></li>').join("")+'</ol>';
    let h=
      '<div class="pn-hero'+(s==="on"?" on":"")+'">'+
        '<span class="pn-bell'+(s==="on"?"":" ring")+'"><span class="ms" aria-hidden="true">'+(s==="on"?"notifications_active":"notifications")+'</span></span>'+
        '<div><h3>'+(s==="on" ? "On for this "+esc(dev) : "Hear it the moment money moves")+'</h3>'+
        '<p>When someone says they paid you, your '+esc(dev)+' asks whether it arrived. '+
          'When you pay someone, you hear when they confirm.</p></div></div>';

    if(s==="on"){
      h+='<p class="pn-linked" id="pnLinked"><span class="ms" aria-hidden="true">sync</span>Checking this '+esc(dev)+' is linked to your account…</p>'+
         '<button class="btn p wide pn-btn" id="pnTest" type="button"><span class="ms" aria-hidden="true">notifications</span>Show a test notification</button>'+
         '<button class="pn-off" id="pnOff" type="button">Turn off on this '+esc(dev)+'</button>';
    } else if(s==="ios-install"){
      h+='<p class="pn-lead">On iPhone, notifications work once Settle is on your Home Screen.</p>'+
        steps([["ios_share","In Safari, tap <b>Share</b>"],
               ["add_box","Choose <b>Add to Home Screen</b>, then <b>Add</b>"],
               ["touch_app","Open <b>Settle</b> from your Home Screen"],
               ["notifications_active","Come back here and tap <b>Turn on</b>"]])+
        '<p class="fine">Needs iOS 16.4 or later. You stay signed in.</p>';
    } else if(s==="denied"){
      h+='<p class="pn-lead">Notifications are blocked for Settle on this '+esc(dev)+'.</p>'+
        (dev==="iPhone" || dev==="iPad"
          ? steps([["settings","Open <b>Settings</b>, then <b>Notifications</b>"],
                   ["apps","Find <b>Settle</b> and turn on <b>Allow Notifications</b>"],
                   ["refresh","Come back and reopen Settle"]])
          : steps([["lock","Tap the icon at the left of the address bar"],
                   ["tune","Open <b>Permissions</b> or <b>Site settings</b>"],
                   ["notifications","Set <b>Notifications</b> to <b>Allow</b>, then reload"]]));
    } else if(s==="none"){
      h+='<p class="pn-lead">This browser can’t show notifications.</p>'+
         '<p class="fine">On Android, open Settle in Chrome. On iPhone, add it to your Home Screen from Safari.</p>';
    } else {
      h+='<button class="btn p wide pn-btn" id="pnOn" type="button"><span class="ms" aria-hidden="true">notifications_active</span>Turn on notifications</button>'+
         '<p class="fine">Your '+esc(dev)+' will ask you to allow them. Turn them off here any time.</p>';
    }
    b.innerHTML=h;

    // A test notification only proves the phone can show one. Payments reach
    // it through the subscription saved on the account, so check that too.
    const linked=$("pnLinked");
    if(linked) (async ()=>{
      const say=(ok, text, fix)=>{
        if(!linked.isConnected) return;
        linked.className="pn-linked "+(ok?"ok":"bad");
        linked.innerHTML='<span class="ms" aria-hidden="true">'+(ok?"check_circle":"error")+'</span><span>'+esc(text)+'</span>'+
          (fix ? '<button type="button" id="pnRelink">Link it</button>' : '');
        const rl=$("pnRelink");
        if(rl) rl.addEventListener("click", ()=>{
          rl.disabled=true;
          swReady(5000).then(reg=> reg.pushManager.getSubscription())
            .then(sub=>{ if(!sub) throw new Error("turn notifications off and on again"); return pushSave(sub); })
            .then(()=>{ toast("Linked"); sheetPush(); })
            .catch(e=>{ rl.disabled=false; toast("Could not link: "+((e && e.message) || "try again")); });
        });
      };
      try{
        const reg=await swReady(5000), sub=await reg.pushManager.getSubscription();
        if(!sub) return say(false, "This "+dev+" has no subscription yet.", false);
        const id=await pushId(sub.endpoint);
        const snap=await remote.get(ref("users/"+USER.uid+"/push/"+id));
        if(snap && snap.exists()) say(true, "Linked to "+(USER.email||"your account")+". Payments will reach this "+dev+".", false);
        else say(false, "Not linked to your account, so payments can’t reach this "+dev+".", true);
      }catch(e){ say(false, "Could not check: "+((e && e.message) || "try again"), false); }
    })();

    const on=$("pnOn"); if(on) on.addEventListener("click", ()=>{ pushEnable(on).then(ok=>{ if(ok) closeSheet(); }); });
    const off=$("pnOff"); if(off) off.addEventListener("click", ()=>{ closeSheet(); pushDisable(); });
    const test=$("pnTest"); if(test) test.addEventListener("click", ()=>{
      swReady(4000).then(reg=> reg.showNotification("It works", {
        body:"This is how Settle will reach you.", icon:"icon-192.png", tag:"settle-test"}))
        .catch(e=> toast("Could not show one: "+((e && e.message) || "try again")));
    });
  });
}

/* ---------- Today: asked once, gently ---------- */
function pushPromptCard(main){
  if(!USER || (PUSH_STATE!=="off" && PUSH_STATE!=="ios-install")) return;
  const later=Number(lsGet(PUSH_LATER_KEY, 0))||0;
  if(later && Date.now()-later < 14*864e5) return;
  const install = PUSH_STATE==="ios-install";
  const c=el("div","pn-card");
  c.innerHTML=
    '<span class="pn-bell ring"><span class="ms" aria-hidden="true">notifications_active</span></span>'+
    '<div class="pn-body"><b>Know the moment money moves</b>'+
      '<span>'+(install ? "Add Settle to your Home Screen and your iPhone can tell you when someone pays you."
                        : "Get a notification when someone pays you, and answer with one tap.")+'</span></div>'+
    '<div class="pn-acts"><button class="pn-yes" type="button">'+(install ? "Show me how" : "Turn on")+'</button>'+
      '<button class="pn-no" type="button">Not now</button></div>';
  c.querySelector(".pn-yes").addEventListener("click", (ev)=>{ install ? sheetPush() : pushEnable(ev.currentTarget); });
  c.querySelector(".pn-no").addEventListener("click", ()=>{ lsSet(PUSH_LATER_KEY, Date.now()); c.remove(); });
  main.appendChild(c);
}

/* ---------- Account: where it stands, and the way in ---------- */
function pushAccountRow(card){
  const s=PUSH_STATE, dev=pushDevice();
  const say={on:"On for this "+dev, off:"Off on this "+dev, "ios-install":"Add Settle to your Home Screen first",
             denied:"Blocked in your "+dev+"’s settings", none:"Not available in this browser", unknown:"Checking…"}[s];
  const row=el("button","row");
  row.innerHTML='<span class="cat'+(s==="on"?" teal":"")+'"><span class="ms" aria-hidden="true">'+
      (s==="on"?"notifications_active":"phone_iphone")+'</span></span>'+
    '<span class="body"><span class="t1">Phone notifications</span><span class="t2">'+esc(say||"")+'</span></span>'+
    '<span class="right"><span class="ms" aria-hidden="true" style="color:var(--label-3)">chevron_right</span></span>';
  row.addEventListener("click", sheetPush);
  card.appendChild(row);
}

// Tapping a notification while Settle is already open brings it forward; the
// service worker then says which group to show.
if("serviceWorker" in navigator){
  navigator.serviceWorker.addEventListener("message", e=>{
    const d=e.data||{};
    if(d.type!=="settle-open" || typeof d.url!=="string") return;
    try{
      const m=new URL(d.url).hash.match(/g=([A-Za-z0-9_-]+)/);
      if(m && JOINED.some(g=>g.id===m[1])) openGroup(m[1]); else render();
    }catch(err){}
  });
}
// Coming back to the app - perhaps from turning them on in Settings.
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && USER) pushRefresh(); });
