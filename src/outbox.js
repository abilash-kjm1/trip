/* ======================= NOTHING LOST OFFLINE =======================
   The database library queues changes made with no signal - but only in
   memory. Close the app, or let it reload for an update, before the signal
   comes back, and those changes are gone.

   So every write is also written down on this device, and crossed off only
   when the database confirms it. Whatever is still written down the next
   time Settle opens is sent again, in the order it was made. Payments and
   expenses are saved under keys made on this device, so sending one twice
   writes the same place twice rather than making a second copy.

   While anything is still on its way, or there is no signal, Settle will not
   reload itself for an update; it waits until everything has synced.

   The last copy of each group is kept on the device too, with whether this
   account has been let in, so Settle opens with no signal and can be used. */
const OUTBOX_KEY = "settle.outbox.v1";
const DATA_KEY   = "settle.data.v1";
const ACCESS_KEY = "settle.access.v1";
let OUTBOX = [];         // this account's writes the database has not confirmed
let OUTBOX_OTHER = [];   // left on this device by another account: kept, never sent as this one
let PENDING = 0;         // writes still waiting on the database, this session
let ONLINE = null;       // .info/connected: null until it first answers
let SYNC_T = null, SYNC_MINE = false;

function outboxRead(){
  const v=lsGet(OUTBOX_KEY, []);
  return Array.isArray(v) ? v.filter(x=> x && typeof x.path==="string" && typeof x.uid==="string") : [];
}
function outboxWrite(){
  try{ localStorage.setItem(OUTBOX_KEY, JSON.stringify(OUTBOX_OTHER.concat(OUTBOX))); }
  catch(e){ /* storage full or refused: the database library still holds it for this session */ }
}
function forgetOutbox(){ OUTBOX=[]; outboxWrite(); }

// "https://project.firebaseio.com/trips/g1/expenses/e1" -> "trips/g1/expenses/e1"
function refPath(r){
  try{ return new URL(String(r)).pathname.split("/").filter(Boolean).map(decodeURIComponent).join("/"); }
  catch(e){ return null; }
}

/* The database handle the app uses, with every write written down first. */
function durableRemote(dbMod, db){
  function track(op, r, value, run){
    const path=refPath(r);
    let item=null;
    if(USER && path){
      let copy=null;
      try{ copy = value==null ? null : JSON.parse(JSON.stringify(value)); }catch(e){}
      item={id:Date.now().toString(36)+Math.random().toString(36).slice(2,8),
            uid:USER.uid, op, path, value:copy, at:Date.now()};
      OUTBOX.push(item);
      if(OUTBOX.length>800) OUTBOX.splice(0, OUTBOX.length-800);
      outboxWrite();
    }
    PENDING++; syncShow();
    let p;
    try{ p=run(); }catch(err){ p=Promise.reject(err); }
    // Confirmed, or refused for good (a rule said no): either way it is
    // finished, and the caller already says so if it failed.
    const done=()=>{
      PENDING=Math.max(0, PENDING-1);
      if(item){ OUTBOX=OUTBOX.filter(x=>x.id!==item.id); outboxWrite(); }
      syncShow();
    };
    Promise.resolve(p).then(done, done);
    return p;
  }
  return {
    db, ref:dbMod.ref, onValue:dbMod.onValue, off:dbMod.off, get:dbMod.get,
    set:    (r, v)=> track("set", r, v, ()=> dbMod.set(r, v)),
    update: (r, v)=> track("update", r, v, ()=> dbMod.update(r, v)),
    remove: (r)=>    track("remove", r, null, ()=> dbMod.remove(r)),
    // The key is made here, on the device, before anything is sent - so the
    // same note sent again lands on the same key.
    push:   (r, v)=>{
      const child=dbMod.push(r);
      if(v===undefined) return child;
      const p=track("set", child, v, ()=> dbMod.set(child, v));
      p.key=child.key; p.ref=child;
      return p;
    }
  };
}

/* On opening: send again whatever a previous session left unconfirmed. */
function outboxReplay(){
  if(!remote || !USER) return;
  const all=outboxRead();
  OUTBOX_OTHER=all.filter(x=> x.uid!==USER.uid);
  const mine=all.filter(x=> x.uid===USER.uid && /^(set|update|remove)$/.test(x.op))
                .sort((a,b)=> (a.at||0)-(b.at||0));
  OUTBOX=[];                 // each is written down again as it goes
  outboxWrite();
  if(!mine.length) return;
  const writes=mine.map(x=>{
    const r=remote.ref(remote.db, x.path);
    const w = x.op==="set" ? remote.set(r, x.value)
            : x.op==="update" ? remote.update(r, x.value||{})
            : remote.remove(r);
    return Promise.resolve(w).then(()=>true, ()=>false);
  });
  const all2=Promise.all(writes);
  all2.then(res=>{
    const ok=res.filter(Boolean).length, lost=res.length-ok;
    if(ok) toast(ok===1 ? "A change you made offline is now saved" : ok+" changes you made offline are now saved");
    if(lost) setTimeout(()=> toast(lost===1
      ? "One change made offline could not be saved — you may no longer be in that group"
      : lost+" changes made offline could not be saved"), 2800);
  });
  // Notes for phones that never went out: ask for them now.
  if(mine.some(x=> x.path.indexOf("mail/queue/")===0) && typeof pushNow==="function") pushNow(all2);
}

/* The bar under the header: offline, syncing, or nothing at all. Short
   blips while connecting are not worth a banner, so both wait a moment. */
function syncShow(){
  if(typeof setSync!=="function" || !USER) return;
  clearTimeout(SYNC_T);
  const say=(state, msg)=>{ setSync(state, msg); SYNC_MINE=true; };
  const many=(n)=> n===1 ? "1 change" : n+" changes";
  if(ONLINE===false){
    SYNC_T=setTimeout(()=>{
      if(ONLINE!==false) return;
      say("warn", PENDING
        ? "Offline · "+many(PENDING)+" saved on this device — "+(PENDING===1?"it syncs":"they sync")+" when you’re back online"
        : "Offline — anything you add is kept and syncs when you’re back online");
    }, PENDING ? 0 : 1500);
  } else if(PENDING>0){
    SYNC_T=setTimeout(()=>{
      if(PENDING>0 && ONLINE!==false){ say("", "Syncing "+many(PENDING)+"…"); NET_SLOW=true; netShow(); }
    }, 1500);
  } else if(SYNC_MINE){
    setSync(null); SYNC_MINE=false;
  }
  if(!PENDING) NET_SLOW=false;
  netShow();
}
// Connected or not, from the database itself.
function syncConnected(on){
  ONLINE=!!on;
  netShow();
  if(!USER) return;
  if(ONLINE){ setSync(null); SYNC_MINE=false; }
  syncShow();
}

/* The little light beside the refresh button: green online, red offline,
   amber while changes take a moment to save, grey while connecting. A tap
   says what it means. "Syncing" only shows when saving is slow, so an
   ordinary save does not make it flicker. */
let NET_SLOW=false;
function netState(){
  if(ONLINE===false) return "off";
  if(ONLINE===true) return PENDING>0 && NET_SLOW ? "sync" : "on";
  return "wait";
}
function netWords(){
  const n=PENDING, many = n===1 ? "1 change" : n+" changes";
  switch(netState()){
    case "off":  return n ? "Offline · "+many+" saved on this device, "+(n===1?"it syncs":"they sync")+" when you’re back online"
                          : "Offline · anything you add is kept and syncs when you’re back online";
    case "sync": return "Syncing "+many+"…";
    case "on":   return "Online · everything is saved";
    default:     return "Connecting to Settle…";
  }
}
// Every light on the page: the top bar on a phone, the sidebar on a computer.
const netLights=()=> typeof document==="undefined" ? [] : [].slice.call(document.querySelectorAll("[data-net]"));
function netShow(){
  const lights=netLights();
  if(!lights.length) return;
  const s=netState(), words=netWords();
  const label = s==="off" ? (PENDING ? "Offline · "+PENDING : "Offline")
              : s==="sync" ? "Syncing" : s==="on" ? "Online" : "Connecting";
  lights.forEach(b=>{
    if(b.dataset.state!==s) b.dataset.state=s;
    const l=b.querySelector(".net-l");
    if(l && l.textContent!==label) l.textContent=label;
    b.setAttribute("aria-label", words);
    b.title=words;
  });
}
netLights().forEach(b=> b.addEventListener("click", ()=> toast(netWords())));

/* ---- the last copy of each group, and whether this account is let in ---- */
let DATA_SAVE_T=null;
function cacheGroups(){
  if(!USER) return;
  clearTimeout(DATA_SAVE_T);
  DATA_SAVE_T=setTimeout(()=>{
    if(!USER) return;
    const groups={};
    JOINED.forEach(g=>{ if(DATA[g.id] && typeof DATA[g.id]==="object" && Object.keys(DATA[g.id]).length) groups[g.id]=DATA[g.id]; });
    try{ localStorage.setItem(DATA_KEY, JSON.stringify({uid:USER.uid, at:Date.now(), groups})); }
    catch(e){ try{ localStorage.removeItem(DATA_KEY); }catch(_){} }
  }, 800);
}
function hydrateGroups(){
  if(!USER) return false;
  const c=lsGet(DATA_KEY, null);
  if(!c || c.uid!==USER.uid || !c.groups || typeof c.groups!=="object") return false;
  let any=false;
  Object.keys(c.groups).forEach(gid=>{
    const v=c.groups[gid];
    if(!DATA[gid] && v && typeof v==="object"){ DATA[gid]=v; any=true; }
  });
  return any;
}
function cacheAccess(){ if(USER) lsSet(ACCESS_KEY, {uid:USER.uid, status:(ACCESS && ACCESS.status) || null}); }
function hydrateAccess(){
  if(!USER || ACCESS!==undefined) return;
  const a=lsGet(ACCESS_KEY, null);
  if(a && a.uid===USER.uid && typeof a.status==="string") ACCESS={status:a.status};
}
function forgetCachedGroups(){
  try{ localStorage.removeItem(DATA_KEY); localStorage.removeItem(ACCESS_KEY); }catch(e){}
}
