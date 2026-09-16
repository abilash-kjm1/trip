/* =========================== PRINT =========================== */
function doPrint(){
  const gid=CURRENT; if(!gid) return;
  const old=document.getElementById("printArea"); if(old) old.remove();
  const area=el("div"); area.id="printArea";
  const b=balances(gid), st=transferPlan(gid), ppl=everyoneIn(gid);
  const total=totalOf(gid);

  let h='<h1>'+esc(groupName(gid))+'</h1>'+
    '<p class="pmeta">Statement printed '+esc(fmtWhen(Date.now()))+' · '+ppl.length+
    ' member'+(ppl.length===1?"":"s")+' · '+expensesOf(gid).length+' expense'+
    (expensesOf(gid).length===1?"":"s")+' · '+money(total)+' in total</p>';

  h+='<h2>Balances</h2><table><thead><tr><th>Person</th><th class="r">Paid</th>'+
     '<th class="r">Share</th><th class="r">Balance</th></tr></thead><tbody>';
  ppl.forEach(n=>{
    let paid=0, share=0;
    expensesOf(gid).forEach(e=>{ if(e.payer===n) paid+=Number(e.amount)||0;
      const sh=sharesOf(e); if(sh[n]) share+=sh[n]; });
    const v=b[n]||0;
    h+='<tr><td>'+esc(n)+'</td><td class="r">'+money(paid)+'</td><td class="r">'+money(share)+
       '</td><td class="r"><strong>'+(Math.abs(v)<0.005?"settled":money(v))+'</strong></td></tr>';
  });
  h+='</tbody></table>';

  if(st.length){
    h+='<h2>Who owes whom — the fewest payments that clear everyone</h2><ul>';
    st.forEach(t=> h+='<li><strong>'+esc(t.from)+'</strong> pays <strong>'+esc(t.to)+
      '</strong> '+money(t.amt)+'</li>' );
    h+='</ul>';
  } else {
    h+='<h2>Who owes whom</h2><p>All square - nobody owes anybody.</p>';
  }

  h+='<h2>Every expense</h2><table><thead><tr><th>Date</th><th>What</th><th>Paid by</th>'+
     '<th>Split between</th><th class="r">Amount</th></tr></thead><tbody>';
  expensesOf(gid).slice().sort((a,c)=>(a.at||0)-(c.at||0)).forEach(e=>{
    const sh=sharesOf(e);
    const who=Object.keys(sh).map(n=>esc(n)+" "+money(sh[n])).join(", ");
    h+='<tr><td>'+esc(fmtDate(e.at))+'</td><td>'+esc(e.desc)+
       (e.note?'<br><span class="note">'+esc(e.note)+'</span>':'')+
       '</td><td>'+esc(e.payer)+'</td><td class="who">'+who+'</td><td class="r">'+money(e.amount)+'</td></tr>';
  });
  h+='</tbody></table>';

  const pays=paymentsOf(gid);
  if(pays.length){
    h+='<h2>Payments already made</h2><table><thead><tr><th>Date</th><th>From</th><th>To</th>'+
       '<th>Note</th><th class="r">Amount</th></tr></thead><tbody>';
    pays.slice().sort((a,c)=>(a.at||0)-(c.at||0)).forEach(p=>{
      h+='<tr><td>'+esc(fmtDate(p.at))+'</td><td>'+esc(p.from)+'</td><td>'+esc(p.to)+
         '</td><td>'+esc(p.note||"")+'</td><td class="r">'+money(p.amount)+'</td></tr>';
    });
    h+='</tbody></table>';
  }

  area.innerHTML=h;
  document.body.appendChild(area);
  document.body.classList.add("printing");
  setTimeout(()=>{
    window.print();
    setTimeout(()=>{ document.body.classList.remove("printing"); area.remove(); }, 400);
  }, 120);
}

/* =========================== WIRING =========================== */
$("backBtn").addEventListener("click", ()=>{
  if((ADMIN_VIEW || ADMIN_PEOPLE) && !CURRENT){
    ADMIN_VIEW=false; ADMIN_PEOPLE=false; TAB="account"; window.scrollTo(0,0); render(); return;
  }
  closeGroup();
});
$("gmenuBtn").addEventListener("click", sheetGroupMenu);
$("sheetClose").addEventListener("click", closeSheet);
$("scrim").addEventListener("click", closeSheet);
$("fab").addEventListener("click", ()=>{ CURRENT ? sheetExpense(null) : sheetGroupNew(); });
// The raised + is the quick way to add an expense from anywhere. Groups and
// people can be made from inside it, so it no longer changes meaning by screen.
$("navAdd").addEventListener("click", sheetQuickAdd);
$("meBtn").addEventListener("click", ()=>{
  ADMIN_VIEW=false; ADMIN_PEOPLE=false; CURRENT=null; TAB="account"; window.scrollTo(0,0); render();
});
// Only the buttons that name a tab. The add button lives in the same bar and
// names none, so it was setting the tab to undefined and leaving a blank
// screen behind the sheet it opened.
document.querySelectorAll(".nav button[data-tab], .side button[data-tab]").forEach(b=>{
  b.addEventListener("click", ()=>{
    ADMIN_VIEW=false; ADMIN_PEOPLE=false;
    if(CURRENT){ CURRENT=null; lsSet(LS.cur,null); if(location.hash) location.hash=""; }
    TAB=b.dataset.tab; window.scrollTo(0,0); render();
  });
});
document.addEventListener("keydown", e=>{
  if(e.key==="Escape" && !$("sheet").hidden) closeSheet();
});

// The bar only materialises once the large title has scrolled under it.
let barSolid=false;
function syncBar(){
  const on = window.scrollY > 26;
  if(on!==barSolid){ barSolid=on; $("bar").classList.toggle("scrolled", on); }
}
window.addEventListener("scroll", syncBar, {passive:true});
window.addEventListener("hashchange", ()=>{
  const m=location.hash.match(/g=([A-Za-z0-9_-]+)/);
  if(m){ if(m[1]!==CURRENT) openGroup(m[1]); }
  else if(CURRENT){ CURRENT=null; lsSet(LS.cur,null); render(); }
});

/* =========================== SYNC =========================== */
function setSync(state, msg){
  const s=$("syncBar");
  if(!msg){ s.hidden=true; return; }
  s.hidden=false; s.className="sync"+(state?" "+state:""); s.textContent=msg;
}
function watchGroup(gid){
  if(!remote || subs[gid]) return;
  const r=ref("trips/"+gid);
  const cb=remote.onValue(r, snap=>{
    const v=snap.val();
    if(v===null){
      // Gone. It comes off the list whether or not it had loaded - otherwise
      // a group deleted before this device saw it sits there forever, empty.
      const had = DATA[gid] && Object.keys(DATA[gid]).length, nm = groupName(gid);
      forgetGroup(gid); if(CURRENT===gid) closeGroup();
      delete DATA[gid]; cacheGroups();
      if(had) toast("“"+nm+"” was deleted");
      render(); return;
    }
    DATA[gid]=v;
    cacheGroups();
    if(v.meta && v.meta.name){
      const j=JOINED.find(x=>x.id===gid);
      if(j && j.name!==v.meta.name){ j.name=v.meta.name; lsSet(LS.grp, JOINED); }
    }
    render();
  }, err=>{
    // The rules refuse it: the group was deleted, or this account is not in
    // it. Either way there is nothing here to open, so it stops being listed
    // instead of showing as a group with nobody in it. If they are added back,
    // the group returns to their list on its own.
    const why = String((err && (err.code || err.message)) || "");
    if(/permission/i.test(why)){
      // Not readable - not yet, or not any more. Off the list for now, but the
      // invitation that brought it stays: the moment they are given a seat,
      // straight away or by the scheduler within one pass, the group comes back
      // on its own. Deleting the invitation here is how somebody added a
      // moment too early never saw the group at all.
      JOINED = JOINED.filter(x=>x.id!==gid); lsSet(LS.grp, JOINED);
      if(subs[gid]){ subs[gid](); delete subs[gid]; }
      delete DATA[gid]; cacheGroups();
      if(USER) del("users/"+USER.uid+"/groups/"+gid);
      if(CURRENT===gid) closeGroup();
      render(); return;
    }
    setSync("bad","Cannot read this group — "+(err&&err.message?err.message:"check the database rules"));
  });
  subs[gid]=()=>{ try{ remote.off(r,"value",cb); }catch(e){} };
}
function watchAll(){ JOINED.slice().forEach(g=>watchGroup(g.id)); }

const DEFAULT_GROUP = window.DEFAULT_TRIP || "stlawrence-sep2026";
let ADMIN_GROUPS = null;   // admin only: every group in the database
let LEGACY_OK    = false;  // the original shared sheet is there to be joined

/* =========================== AUTH =========================== */
let fb = null;             // {app, auth, authMod, dbMod}
let signingIn = false;

// Ask Google whether this project actually offers Google sign-in. Doing this
// first means a project with the provider switched off says so plainly,
// instead of failing silently behind a blocked popup.
function providerReady(){
  const key=(window.FIREBASE_CONFIG||{}).apiKey;
  if(!key) return Promise.resolve(true);
  return fetch("https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key="+key, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({providerId:"google.com", continueUri: location.origin+location.pathname})
  }).then(r=>r.json()).then(j=>{
    const m=(j && j.error && j.error.message) || "";
    if(m.indexOf("OPERATION_NOT_ALLOWED")>-1) return "auth/operation-not-allowed";
    if(m.indexOf("UNAUTHORIZED_DOMAIN")>-1 || m.indexOf("INVALID_CONTINUE")>-1) return "auth/unauthorized-domain";
    return true;
  }).catch(()=>true);   // offline or blocked: let the SDK have its go anyway
}

function signIn(){
  if(!fb){ toast("Still starting up — try again in a second"); return; }
  if(signingIn) return;
  signingIn = true;
  const btn=$("gIn"); if(btn){ btn.disabled=true; btn.classList.add("busy"); }
  const done=()=>{ signingIn=false; const b=$("gIn"); if(b){ b.disabled=false; b.classList.remove("busy"); } };

  providerReady().then(ready=>{
    if(ready!==true){ authFailed({code:ready}); done(); return; }
    const provider = new fb.authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return fb.authMod.signInWithPopup(fb.auth, provider).catch(err=>{
      const code = (err && err.code) || "";
      // Popups are blocked in plenty of in-app and mobile browsers; fall back.
      if(code.indexOf("popup")>-1 || code.indexOf("operation-not-supported")>-1){
        if(code==="auth/popup-closed-by-user" || code==="auth/cancelled-popup-request"){ authFailed(err); return; }
        return fb.authMod.signInWithRedirect(fb.auth, provider).catch(authFailed);
      }
      authFailed(err);
    }).finally(done);
  });
}
function authFailed(err){
  const code=(err&&err.code)||"", msg=(err&&err.message)||"Sign-in failed";
  if(code==="auth/popup-closed-by-user" || code==="auth/cancelled-popup-request"){
    toast("Sign-in cancelled"); return;
  }
  if(code==="auth/operation-not-allowed")
    setSync("bad","Google sign-in is switched off for this Firebase project. Turn it on under Authentication → Sign-in method.");
  else if(code==="auth/unauthorized-domain")
    setSync("bad","“"+location.hostname+"” is not in the Firebase authorised domains list.");
  else if(code==="auth/network-request-failed")
    setSync("bad","No connection — sign-in needs to reach Google.");
  else
    setSync("bad", msg);
  toast("Could not sign in");
}
function signOutNow(){
  if(!fb) return;
  // Signing out forgets what this device is holding - including changes that
  // have not reached the database. Say so first.
  const waiting=Math.max(PENDING, OUTBOX.length);
  if(!confirm(waiting
      ? (waiting===1 ? "1 change you made has not synced yet" : waiting+" changes you made have not synced yet")+
        ". Signing out now will lose "+(waiting===1?"it":"them")+". Sign out anyway?"
      : "Sign out of Settle on this device?")) return;
  Object.keys(subs).forEach(k=>{ subs[k](); delete subs[k]; });
  presenceGoOffline();
  fb.authMod.signOut(fb.auth).then(()=>{
    try{ localStorage.removeItem(LS.grp); localStorage.removeItem(LS.cur);
         localStorage.removeItem(LS.who); }catch(e){}
    forgetCachedGroups(); forgetOutbox();
    location.hash=""; location.reload();
  });
}

function onSignedIn(u){
  // Two people share a phone, or one person has two accounts. Everything held
  // locally - the group list, the group last open, the group named in the
  // address bar - belongs to whoever was signed in before, and none of it is
  // this person's to see. Signing out clears it, but signing straight in as
  // somebody else does not, and that is exactly how one account ended up
  // looking at another's group.
  // Switching to a different account on this device without signing all
  // the way out first: the account being left is not using Settle any more
  // either, even though nothing here formally signed it out.
  if(USER && USER.uid!==u.uid) presenceGoOffline();
  forgetPreviousAccount(u.uid);

  USER = { uid:u.uid, name:u.displayName || (u.email||"").split("@")[0] || "You",
           email:u.email || "", photo:u.photoURL || null };
  setSync(null);

  // What this device was holding when it last closed: the groups as they
  // were, whether this account is let in, and any change not yet confirmed -
  // sent again now, in order. With no signal, Settle still opens and works.
  hydrateAccess();
  hydrateGroups();
  outboxReplay();
  syncShow();

  // Keep a profile record so the admin can see who is who.
  set("users/"+USER.uid+"/profile", {name:USER.name, email:USER.email, photo:USER.photo||null, at:Date.now()});

  // Everybody who has Settle open right now, or when they last did.
  remote.onValue(ref("presence"), snap=>{ PRESENCE = snap.val() || {}; render(); },
    ()=>{ PRESENCE = {}; });
  presenceGoOnline();

  // Messages from the administrator: broadcasts everyone approved can list
  // directly, and my own inbox for anything addressed only to me. Each is
  // a real, separately-readable path - a listener on "announcements" itself
  // would be refused outright, since nothing grants read access there.
  remote.onValue(ref("announcements/all"), snap=>{ ANNOUNCE_ALL = snap.val() || {}; render(); },
    ()=>{ ANNOUNCE_ALL = {}; });
  remote.onValue(ref("announcements/inbox/"+USER.uid), snap=>{ ANNOUNCE_INBOX = snap.val() || {}; render(); },
    ()=>{ ANNOUNCE_INBOX = {}; });
  if(isAdmin()) remote.onValue(ref("announcements/sent"), snap=>{ ANNOUNCE_SENT = snap.val() || {}; render(); },
    ()=>{ ANNOUNCE_SENT = {}; });

  // My entry in the directory, so other people can add me to a group by
  // picking my name instead of typing it and hoping they spell it the same.
  // Name and picture only beyond the address - never preferences or balances.
  // Updated, not replaced: the entry also carries Interac details the person
  // saved, and replacing it on every sign-in would throw them away.
  upd("directory/"+USER.uid, {name:USER.name, email:(USER.email||"").toLowerCase(),
                              photo:USER.photo||null, at:Date.now()});

  // Everybody else's. Readable only once you have been approved, so it is a
  // list of people who are already in this Settle together.
  remote.onValue(ref("directory"), snap=>{ DIRECTORY = snap.val() || {}; render(); },
    ()=>{ DIRECTORY = {}; });

  // Am I allowed in? Watched rather than read once, so somebody sitting on the
  // waiting screen is let through the moment they are approved, without
  // reloading and without being told to.
  remote.onValue(ref("access/"+USER.uid), snap=>{ ACCESS = snap.val() || null; cacheAccess(); render(); },
    ()=>{ ACCESS = null; render(); });

  // Everybody's request, for the administrator's list.
  if(isAdmin()){
    remote.onValue(ref("access"), snap=>{ REQUESTS = snap.val() || {}; render(); },
      ()=>{ REQUESTS = {}; });
    // Everybody who has ever signed in. People who were using Settle before
    // there was anything to approve have no access record at all, and would
    // otherwise be invisible on the requests screen right up until the gate
    // shut them out.
    remote.onValue(ref("users"), snap=>{ ALLUSERS = snap.val() || {}; render(); },
      ()=>{ ALLUSERS = {}; });
  }

  // My groups live in the database, so they follow me to any device.
  remote.onValue(ref("users/"+USER.uid+"/groups"), snap=>{
    const v=snap.val()||{};
    const ids=Object.keys(v);
    JOINED = ids.map(id=>({id, name:(v[id]&&v[id].name)||id}));
    lsSet(LS.grp, JOINED);
    Object.keys(subs).forEach(gid=>{ if(ids.indexOf(gid)<0 && gid!==CURRENT){ subs[gid](); delete subs[gid]; delete DATA[gid]; } });
    watchAll();
    render();
  }, err=>{
    setSync("bad","Cannot read your groups — "+(err&&err.message?err.message:"check the database rules"));
    render();
  });

  // Notification settings, and the timezone the weekly reminder is worked out
  // against. Recorded once so the cron has something to read even if this
  // account never opens the settings sheet.
  remote.onValue(ref("users/"+USER.uid+"/prefs"), snap=>{
    PREFS = snap.val() || {};
    // The look follows the account. Only redraw when it actually differs,
    // or every preference write would repaint the whole app.
    if(typeof PREFS.theme === "string" && PREFS.theme !== THEME){ applyTheme(PREFS.theme); render(); }
    if(PREFS.tz === undefined){
      let tz="America/Toronto";
      try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; }catch(e){}
      PREFS.tz = tz;
      set("users/"+USER.uid+"/prefs/tz", tz);
    }
  }, ()=>{});

  // The reminder schedule. Readable by anyone signed in, so the settings sheet
  // can say when the next one is due; only the administrator may change it.
  remote.onValue(ref("config/reminders"), snap=>{ SCHED = snap.val() || {}; render(); }, ()=>{});

  // Groups somebody has added me to by email turn up on their own.
  if(USER.email){
    remote.onValue(ref("invites/"+emailKey(USER.email)), snap=>{
      const v=snap.val()||{};
      Object.keys(v).forEach(gid=>{
        if(!JOINED.some(g=>g.id===gid)) rememberGroup(gid, (v[gid]&&v[gid].name)||gid);
        watchGroup(gid);
      });
      render();
    }, ()=>{});   // no invites index, or rules not updated yet: carry on
  }

  if(isAdmin()){
    remote.onValue(ref("trips"), snap=>{ ADMIN_GROUPS = snap.val() || {}; if(ADMIN_VIEW) render(); },
      ()=>{ ADMIN_GROUPS = {}; if(ADMIN_VIEW) render(); });
  }

  // Whether this device can hear about payments, and keep its record fresh.
  pushRefresh();

  openFromURL();
  render();
}

function openFromURL(){
  const m = location.hash.match(/g=([A-Za-z0-9_-]+)/) || location.search.match(/[?&]g=([A-Za-z0-9_-]+)/);
  if(m){
    const gid=m[1], known=JOINED.some(g=>g.id===gid);
    remote.get(ref("trips/"+gid+"/meta")).then(snap=>{
      if(!snap.exists() && !known){ toast("That group link no longer works"); location.hash=""; return; }
      const meta=snap.val()||{};
      // Following a link used to join you on the spot, with nothing but a
      // toast to say so. It no longer joins anybody. Reading a group needs a
      // place on its membership list, and only somebody already in it can
      // put you there - which is the whole point. Say so plainly rather
      // than opening a group that will fail to load.
      if(!known){
        toast("Ask someone in that group to add you");
        location.hash=""; render(); return;
      }
      rememberGroup(gid, meta.name||"Group");
      watchGroup(gid);
      openGroup(gid);
    }).catch(()=>{ if(known) openGroup(gid); });
    return;
  }
  const last=lsGet(LS.cur,null);
  if(last && JOINED.some(g=>g.id===last)) openGroup(last);
}

// The original single-sheet app wrote people + expenses under this same path
// with no meta node. It only needs a name, added once.
function adoptLegacy(){
  return remote.get(ref("trips/"+DEFAULT_GROUP)).then(s=>{
    if(!s.exists()) return false;
    const v=s.val()||{};
    if(!v.people && !v.expenses) return false;
    if(v.meta && v.meta.name) return true;
    return set("trips/"+DEFAULT_GROUP+"/meta",
      {name:"St Lawrence trip", type:"trip", at:Date.now(), by:"the original sheet"}).then(()=>true);
  }).catch(()=>false);
}

/* =========================== BOOT =========================== */
(function boot(){
  updateRestore();          // just updated: back on the tab they were on
  render();
  const cfg=window.FIREBASE_CONFIG;
  const ok = cfg && cfg.apiKey && cfg.apiKey.indexOf("PASTE_")!==0 && cfg.databaseURL;
  if(!ok){ setSync("bad","Firebase is not configured — sign-in and syncing are unavailable."); return; }
  setSync("","Starting…");
  (async function(){
    try{
      const appMod  = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
      const authMod = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js");
      const dbMod   = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js");
      const app=appMod.initializeApp(cfg);
      const auth=authMod.getAuth(app);
      const db=dbMod.getDatabase(app);
      fb = {app, auth, authMod, dbMod};
      // Every write is written down on the device until the database confirms
      // it, so nothing made offline is lost to a reload or a closed app.
      remote=durableRemote(dbMod, db);

      // If we came back from a redirect sign-in, surface any failure.
      // With no signal there is nothing to finish, and "could not sign in" to
      // somebody who is signed in would only alarm them.
      authMod.getRedirectResult(auth).catch(err=>{
        if(err && err.code==="auth/network-request-failed") return;
        authFailed(err);
      });

      authMod.onAuthStateChanged(auth, u=>{
        // Earlier versions of this app signed people in anonymously. Those
        // sessions are not a Google identity, so clear them out.
        if(u && u.isAnonymous){ authMod.signOut(auth); return; }
        if(u){
          if(!USER || USER.uid!==u.uid){
            onSignedIn(u);
            adoptLegacy().then(exists=>{ LEGACY_OK = exists; render(); });
          }
        } else {
          USER=null; CURRENT=null; JOINED=[]; DATA={};
          Object.keys(subs).forEach(k=>{ subs[k](); delete subs[k]; });
          setSync(null); render();
        }
      });

      dbMod.onValue(dbMod.ref(db,".info/connected"), s=>{
        const on=s.val()===true;
        syncConnected(on);
        // onDisconnect only lasts until the connection that set it drops, so
        // it is registered again every time one comes back, not only once.
        if(on && USER) presenceGoOnline();
      });
    }catch(err){
      setSync("bad","Could not start — "+((err&&err.message)?err.message:"check your connection"));
    }
  })();
})();

if(!window.__NO_SW && "serviceWorker" in navigator){
  window.addEventListener("load", ()=>{ navigator.serviceWorker.register("sw.js", {updateViaCache:"none"}).catch(()=>{}); });
}
