/* =========================== VIEWS =========================== */
// iOS puts the screen name in the content as a large title and collapses it
// into the bar as you scroll. setTitle does both halves.
function setTitle(main, text){
  const b=$("barBrand"); if(b) b.hidden = true;
  $("barTitle").hidden = false;
  $("barTitle").textContent = text;
  if(main) main.appendChild(el("h1","ltitle", esc(text)));
}
let ADMIN_VIEW = false;      // admin browsing every group in the database
let ADMIN_PEOPLE = false;    // admin's presence dashboard
let FILT = {q:"", payer:"", ways:0};   // expense filters, reset per group
const claimAsked = {};       // gid -> we have already offered the claim sheet
const autoLinked = {};       // gid -> the silent link has been attempted

// An account pinned to a name in PEOPLE_LINKS takes that name without being
// asked, as long as it is on the list and nobody else has it.
function autoLink(gid){
  if(!USER || !remote || autoLinked[gid] || meIn(gid)) return false;
  const mine=(USER.email||"").toLowerCase();
  // Somebody added them by email, so the seat is already theirs.
  let m = membersOf(gid).find(x=> !x.uid && x.invite && x.invite===mine );
  if(!m){
    const want = linkedName(USER.email);
    if(!want) return false;
    m = membersOf(gid).find(x=> !x.uid && x.name.toLowerCase()===want.toLowerCase() );
  }
  if(!m) return false;
  autoLinked[gid]=true; claimAsked[gid]=true;
  linkPerson(gid, m.k);
  return true;
}

function render(){
  const main=$("main"); main.innerHTML="";
  $("fab").hidden=true; $("backBtn").hidden=true; $("gmenuBtn").hidden=true;
  $("nav").hidden = !USER;
  // Canada or India - and a count on the other flag for what is new there.
  if(USER) sideSync();
  sideShow();

  // The avatar in the corner is both a signpost and the way to your account.
  const mb = $("meBtn");
  if(mb){
    mb.hidden = !USER || !mayUse();
    if(USER) mb.innerHTML = USER.photo
      ? '<img src="'+esc(USER.photo)+'" alt="" referrerpolicy="no-referrer">'
      : esc(initials(USER.name));
  }
  const nAdd = $("navAdd");
  if(nAdd) nAdd.hidden = !USER || !mayUse();
  // Online, offline or syncing - only once somebody is signed in.
  document.querySelectorAll("[data-net]").forEach(np=>{ np.hidden = !USER; });
  if(USER && typeof netShow==="function") netShow();
  ME = CURRENT ? meIn(CURRENT) : null;
  document.querySelectorAll(".nav button[data-tab], .side button[data-tab]").forEach(b=>{
    if(b.dataset.tab===TAB && !CURRENT && !ADMIN_VIEW && !ADMIN_PEOPLE) b.setAttribute("aria-current","page");
    else b.removeAttribute("aria-current");
  });

  const y=window.scrollY;
  if(!USER)                 viewSignIn(main);
  else if(!mayUse())      { $("nav").hidden=true; viewAccess(main); }
  else if(CURRENT)          viewGroup(main);
  else if(ADMIN_VIEW)       viewAdmin(main);
  else if(ADMIN_PEOPLE)     viewAdminPeople(main);
  else if(TAB==="home")     viewHome(main);
  else if(TAB==="groups")   viewGroups(main);
  else if(TAB==="activity") viewActivity(main);
  else if(TAB==="account")  viewAccount(main);
  else if(TAB==="interac")  viewInterac(main);
  else if(TAB==="insights") viewInsights(main);
  if(y) window.scrollTo(0, Math.min(y, document.body.scrollHeight));
  if(typeof syncBar==="function") syncBar();
  // The top bar: which screen this is - for its name, the label above it on
  // a computer, and how much room the name needs.
  const bar=$("bar");
  if(bar){
    bar.classList.toggle("in-group", !!CURRENT);
    bar.classList.toggle("is-home", !CURRENT && !ADMIN_VIEW && !ADMIN_PEOPLE && TAB==="home" && !!USER && mayUse());
    const eb=$("barEyebrow");
    if(eb) eb.textContent = CURRENT ? "Group" : (ADMIN_VIEW || ADMIN_PEOPLE) ? "Administrator"
      : TAB==="home" && USER ? SIDES[SIDE].name+" · "+new Date().toLocaleDateString(undefined, {weekday:"long", month:"long", day:"numeric"})
      : USER ? SIDES[SIDE].name : "Settle";
  }
  // Payments waiting on me to say they arrived, and answers to mine.
  if(typeof arrivals==="function") arrivals();
  // What just changed - added, edited, deleted, or being added to a group.
  if(typeof notifCheck==="function") notifCheck();
  // A message from the administrator, waiting to be acknowledged.
  if(typeof announceCheck==="function") announceCheck();

  // Someone opened a group they have not yet identified themselves in.
  if(USER && CURRENT && loaded(CURRENT) && !ME && autoLink(CURRENT)) return;
  if(USER && CURRENT && loaded(CURRENT) && !ME && !claimAsked[CURRENT] && $("sheet").hidden){
    claimAsked[CURRENT]=true;
    setTimeout(()=>{ if(CURRENT && !meIn(CURRENT)) sheetClaim(CURRENT); }, 400);
  }
}

/* The flag switch. The whole app turns over to the other side: any open
   group closes, and the screen flips in. */
function flipSide(){
  const to=otherSide();
  if(!setSide(to)) return;
  if(CURRENT){ CURRENT=null; lsSet(LS.cur, null); if(location.hash) location.hash=""; }
  ADMIN_VIEW=false; ADMIN_PEOPLE=false; HERO_I=0; VZ_GROUP=null;
  IX_SEEN=false; GROUPS_SEEN=false; TH_SEEN=false; IX_EDIT=false; UPI_EDIT=false;
  window.scrollTo(0,0);
  const main=$("main");
  main.classList.remove("side-in-in", "side-in-ca"); void main.offsetWidth;
  main.classList.add(to==="INR" ? "side-in-in" : "side-in-ca");
  render();
  toast(to==="INR" ? "India · rupee groups, paid by UPI" : "Canada · dollar groups, paid by Interac");
}
document.addEventListener("click", (e)=>{
  const b=e.target && e.target.closest && e.target.closest("#sideBtn");
  if(b) flipSide();
});

/* ---------- sign in ---------- */
function viewSignIn(main){
  setTitle(main, "Settle");
  const c=el("div","card pad signin");
  c.innerHTML=
    '<div class="mark" aria-hidden="true"><span class="ms">account_balance_wallet</span></div>'+
    '<h2>Split what you spend together</h2>'+
    '<p>Sign in with Google and you will see every group you are part of, on any '+
    'device, with your own balance worked out for you.</p>'+
    '<button class="btn g wide" id="gIn">'+
      '<span class="glogo" aria-hidden="true">'+
        '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1z"/><path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.3v5.7C7.9 41.1 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.6 28.1c-.4-1.3-.7-2.7-.7-4.1s.2-2.8.7-4.1v-5.7H4.3C2.8 17.1 2 20.4 2 24s.8 6.9 2.3 9.8l7.3-5.7z"/><path fill="#EA4335" d="M24 10.8c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4.1 30 2 24 2 15.4 2 7.9 6.9 4.3 14.2l7.3 5.7c1.7-5.2 6.6-9.1 12.4-9.1z"/></svg>'+
      '</span>Continue with Google</button>'+
    '<p class="fine">We only ever read your name, email and picture — so the group '+
    'knows who added what. Nothing is posted anywhere.</p>';
  main.appendChild(c);
  $("gIn").addEventListener("click", signIn);
}

/* ---------- signed in, but not yet let in ----------
   Four states, each with a different thing to say and a different thing to
   do. Showing one screen with a spinner for all of them would leave somebody
   who has been declined waiting forever for an answer that has arrived. */
function viewAccess(main){
  const state = accessState();
  setTitle(main, "Settle");
  const c=el("div","card pad signin");

  if(state==="loading"){
    c.innerHTML='<div class="mark quiet" aria-hidden="true"><span class="ms">hourglass_empty</span></div>'+
      '<h2>One moment</h2><p>Checking your access.</p>';
    main.appendChild(c);
    return;
  }

  if(state==="none"){
    c.innerHTML=
      '<div class="mark" aria-hidden="true"><span class="ms">how_to_reg</span></div>'+
      '<h2>Ask to join</h2>'+
      '<p>You are signed in as <strong>'+esc(USER.email)+'</strong>. Settle is not open '+
      'to everyone, so the person who runs it has to let you in first.</p>'+
      '<button class="btn primary wide" id="askBtn">Send my request</button>'+
      '<p class="fine">They get an email with your name and address, and press approve '+
      'or decline. You will hear back at this address.</p>';
    main.appendChild(c);
    $("askBtn").addEventListener("click", ()=>{
      $("askBtn").disabled=true; $("askBtn").textContent="Sending…";
      requestAccess().then(()=> toast("Request sent") )
        .catch(e=>{ $("askBtn").disabled=false; $("askBtn").textContent="Send my request";
                    toast("Could not send it — "+(e&&e.message?e.message:"try again")); });
    });
  }
  else if(state==="pending"){
    c.innerHTML=
      '<div class="mark quiet" aria-hidden="true"><span class="ms">schedule</span></div>'+
      '<h2>Waiting to be let in</h2>'+
      '<p>Your request has gone to the person who runs this Settle. You will get an '+
      'email at <strong>'+esc(USER.email)+'</strong> as soon as they decide.</p>'+
      '<p class="fine">This page updates by itself — there is nothing to refresh. '+
      'The request reaches them '+esc(callGap())+'.</p>';
    main.appendChild(c);
  }
  else {
    c.innerHTML=
      '<div class="mark quiet" aria-hidden="true"><span class="ms">block</span></div>'+
      '<h2>Not approved</h2>'+
      '<p>This account has not been given access. If you think that is a mistake, '+
      'speak to whoever runs this Settle.</p>';
    main.appendChild(c);
  }

  const out=el("div","card");
  const r=el("button","row");
  r.innerHTML='<span class="cat"><span class="ms" aria-hidden="true">logout</span></span>'+
    '<span class="body"><span class="t1">Sign out</span>'+
    '<span class="t2">'+esc(USER.email)+'</span></span>';
  r.addEventListener("click", signOutNow);
  out.appendChild(r);
  main.appendChild(out);
}

/* ---------- groups list ----------
   A balance meter across every group, then a tile per group in that group's
   own colour: its icon, where you stand, what has been spent, when it last
   moved and who is in it. Most recently active first. The tiles rise in the
   first time the tab is opened, not on every redraw the database causes. */
let GROUPS_SEEN = false;
function viewGroups(main){
  setTitle(main, "Groups");
  // The floating button used to carry this and the new skin hides it, which
  // left no way at all to start a group once you already had one. A plain
  // button on the screen is harder to lose.
  $("fab").hidden=true;
  const act=el("div","actline");
  const nb=el("button","btn p","+  New group");
  nb.addEventListener("click", sheetGroupNew);
  act.appendChild(nb);
  main.appendChild(act);

  if(!joinedHere().length){
    const e=el("div","empty");
    e.innerHTML=sideEmptyHTML("groups");
    const b=el("button","btn p","Create a group"); b.addEventListener("click", sheetGroupNew);
    e.appendChild(b);
    main.appendChild(e);
    if(LEGACY_OK && SIDE==="CAD"){
      main.appendChild(el("div","sechead","Were you on this trip?"));
      const c=el("div","card");
      const r=el("button","row");
      r.innerHTML='<span class="cat"><span class="ms" aria-hidden="true">luggage</span></span>'+
        '<span class="body"><span class="t1">St Lawrence trip</span>'+
        '<span class="t2">The sheet this app started out as — tap to join it</span></span>'+
        '<span class="right"><span class="ms" aria-hidden="true" style="color:var(--label-3)">chevron_right</span></span>';
      r.addEventListener("click", ()=>{
        rememberGroup(DEFAULT_GROUP, "St Lawrence trip");
        watchGroup(DEFAULT_GROUP); openGroup(DEFAULT_GROUP);
      });
      c.appendChild(r); main.appendChild(c);
    }
    return;
  }

  const enter = !GROUPS_SEEN; GROUPS_SEEN = true;

  // ---- where you stand, across every group ----
  // Each currency on its own - rupees and dollars are never added together.
  const owedB={}, oweB={};
  joinedHere().forEach(g=>{ const v=myBalance(g.id); if(v>0.004) curAdd(owedB, g.id, v); else if(v<-0.004) curAdd(oweB, g.id, -v); });
  const netB=bagNet(owedB, oweB), netTone=bagTone(netB);
  const moving=Object.keys(CURRENCIES).filter(c=> (owedB[c]||0)+(oweB[c]||0) > 0.004);
  // How much of what is moving comes to me, averaged over the currencies.
  const pct = moving.length ? Math.round(moving.reduce((s,c)=> s+(owedB[c]||0)/((owedB[c]||0)+(oweB[c]||0)), 0)/moving.length*100) : 0;
  const bal=el("div","gx-bal"+(enter?" enter":""));
  bal.innerHTML=
    '<div class="gx-bal-top"><span class="gx-bal-lab">Across '+joinedHere().length+' group'+(joinedHere().length===1?'':'s')+'</span>'+
      '<span class="gx-net '+(netTone==="mix" ? "zero" : netTone)+(curKeys(netB).length>1 ? " multi" : "")+'">'+
        (netTone==="zero" ? "All square" : esc(moneySigned(netB)))+'</span></div>'+
    '<div class="gx-meter'+(moving.length?'':' empty')+'" role="img" aria-label="'+
      esc("Owed "+moneyMulti(owedB)+", owing "+moneyMulti(oweB))+'"><span class="gx-in" style="--w:'+pct+'%"></span></div>'+
    '<div class="gx-bal-foot"><span><i class="dot in"></i>You’re owed <b>'+esc(moneyMulti(owedB))+'</b></span>'+
      '<span><i class="dot out"></i>You owe <b>'+esc(moneyMulti(oweB))+'</b></span></div>';
  main.appendChild(bal);

  // ---- a tile per group ----
  const lastAt=(gid)=>{
    let t=Number((DATA[gid]&&DATA[gid].meta&&DATA[gid].meta.at)||0);
    expensesOf(gid).forEach(e=>{ const a=Number(e.at)||0; if(a>t) t=a; });
    paymentsOf(gid).forEach(x=>{ const a=Number(x.at)||0; if(a>t) t=a; });
    return t;
  };
  // A group keeps the colour it has everywhere else, which is picked by name.
  const byName=joinedHere().slice().sort((a,b)=>groupName(a.id).localeCompare(groupName(b.id))).map(g=>g.id);
  const order=joinedHere().slice().sort((a,b)=> lastAt(b.id)-lastAt(a.id) || groupName(a.id).localeCompare(groupName(b.id)));
  const grid=el("div","gx-grid"+(enter?" enter":""));
  order.forEach((g,i)=>{
    const gid=g.id, v=myBalance(gid), mem=membersOf(gid), tot=totalOf(gid), at=lastAt(gid);
    const tone = v>0.004 ? "pos" : v<-0.004 ? "neg" : "zero";
    // Sign and colour say which way it goes, so it fits half a phone's width.
    const chip = tone==="pos" ? "+"+money(v, gid) : tone==="neg" ? "−"+money(-v, gid) : "Settled";
    const faces = mem.slice(0,4).map(m=>
      '<span class="gx-face" style="background:'+esc(m.color||"")+'">'+
        (m.photo ? '<img src="'+esc(m.photo)+'" alt="" referrerpolicy="no-referrer">' : esc(initials(m.name)))+'</span>').join("")+
      (mem.length>4 ? '<span class="gx-face more">+'+(mem.length-4)+'</span>' : '');
    const when = at ? new Date(at).toLocaleDateString(undefined,{month:"short", day:"numeric"}) : "";
    const t=el("button","gx-tile gc"+(Math.max(0, byName.indexOf(gid))%6)); t.type="button";
    t.style.setProperty("--i", i);
    t.innerHTML=
      '<span class="gx-mark ms" aria-hidden="true">'+groupIcon(gid)+'</span>'+
      '<span class="gx-top"><span class="gx-ic"><span class="ms" aria-hidden="true">'+groupIcon(gid)+'</span></span>'+
        '<span class="gx-chip '+tone+'">'+chip+'</span></span>'+
      '<span class="gx-name">'+esc(groupName(gid))+'</span>'+
      '<span class="gx-meta">'+money(tot, gid)+' spent'+(when ? ' · '+esc(when) : '')+'</span>'+
      '<span class="gx-foot"><span class="gx-faces">'+faces+'</span>'+
        '<span class="gx-count">'+mem.length+' '+(mem.length===1?'person':'people')+'</span></span>';
    t.addEventListener("click", ()=>openGroup(gid));
    // A soft light follows the pointer across the tile.
    t.addEventListener("pointermove", e=>{
      const r=t.getBoundingClientRect();
      t.style.setProperty("--mx", (e.clientX-r.left)+"px");
      t.style.setProperty("--my", (e.clientY-r.top)+"px");
    });
    grid.appendChild(t);
  });
  const nt=el("button","gx-tile gx-new"); nt.type="button";
  nt.style.setProperty("--i", order.length);
  nt.innerHTML='<span class="gx-plus"><span class="ms" aria-hidden="true">add</span></span>'+
    '<span class="gx-name">New group</span><span class="gx-meta">A trip, a flat, a dinner</span>';
  nt.addEventListener("click", sheetGroupNew);
  grid.appendChild(nt);
  main.appendChild(grid);
}
function groupIcon(gid){
  const t=(DATA[gid]&&DATA[gid].meta&&DATA[gid].meta.type)||"";
  return t==="home"?"home" : t==="couple"?"favorite" : t==="other"?"group" : "luggage";
}

/* ---------- one group ---------- */
function openGroup(id){
  if(CURRENT!==id) FILT={q:"", payer:"", ways:0};
  CURRENT=id; lsSet(LS.cur, id);
  if(location.hash!=="#g="+id) location.hash="g="+id;
  watchGroup(id);
  window.scrollTo(0,0); render();
}
function closeGroup(){
  CURRENT=null; lsSet(LS.cur,null);
  if(location.hash) location.hash="";
  window.scrollTo(0,0); render();
}

function viewGroup(main){
  const gid=CURRENT;
  setTitle(main, groupName(gid));
  $("backBtn").hidden=false; $("gmenuBtn").hidden=false;
  $("fab").hidden=true;                      // the add form is on the page itself

  // Back and the group menu live in the bar at the top of a phone, and that
  // bar is not on a wide screen - which took People, Settle up, Rename and
  // everything else in the menu with it. They come back as part of the page.
  const pagehead = el("div","pagehead");
  const back = el("button","btn s","Back to groups");
  back.addEventListener("click", closeGroup);
  const menu = el("button","btn s","Group settings");
  menu.addEventListener("click", sheetGroupMenu);
  pagehead.appendChild(back); pagehead.appendChild(menu);
  main.appendChild(pagehead);

  if(FULLVIEW){                              // the standalone full list
    $("nav").hidden=true; $("backBtn").hidden=true; $("gmenuBtn").hidden=true;
    sectionHead(main, "list_alt", "Expenses", "Every expense in this group.");
    groupExpenses(main, gid);
    return;
  }

  sectionTotal(main, gid);
  if(!ME) sectionClaim(main, gid);
  sectionAdd(main, gid);
  sectionHead(main, "list_alt", "Expenses", "Search, or filter by who paid.");
  groupExpenses(main, gid);
  sectionHead(main, "account_balance_wallet", "Balances",
              "What each person paid against their share.");
  groupBalances(main, gid);
  sectionHead(main, "swap_horiz", "Who owes whom",
              simplifyOn(gid) ? "Squashed down to as few payments as possible."
                              : "Exactly what you owe the people you actually split with.");
  if(simplifyOn(gid) && pairSettlements(gid).length){
    const h=el("button","btn s howbtn");
    h.type="button";
    h.innerHTML='<span class="ms" aria-hidden="true">help</span>Why does it say I owe them?';
    h.addEventListener("click", ()=>sheetSimplifyDiagram(gid));
    main.appendChild(h);
  }
  sectionWhoOwes(main, gid);
  sectionPayments(main, gid);
}

function sectionHead(main, icon, title, sub){
  const h=el("div","sect");
  h.innerHTML='<h2><span class="ms" aria-hidden="true">'+icon+'</span>'+esc(title)+'</h2>'+
    (sub?'<p>'+esc(sub)+'</p>':'');
  main.appendChild(h);
}

/* The top of a group: what has been spent, and where I stand in it. "Each if
   split evenly" is gone - splits are not all even, and it counted names that
   are no longer on the list. What I paid, my share, and the one line that
   matters: do I get money back or owe it. That line jumps to Who owes whom. */
function sectionTotal(main, gid){
  const tot=totalOf(gid), exps=expensesOf(gid), people=names(gid).length;
  const s=el("div","gtop");
  let html=
    '<div class="gt-row"><span class="gt-lab">Total spent'+
      '</span>'+
      '<span class="gt-meta">'+exps.length+' expense'+(exps.length===1?'':'s')+' &middot; '+
        people+' '+(people===1?'person':'people')+'</span></div>'+
    '<div class="gt-big">'+money(tot)+'</div>';
  if(ME && exps.length){
    let paid=0, share=0;
    exps.forEach(e=>{
      if(e.payer===ME) paid+=Number(e.amount)||0;
      share+=sharesOf(e)[ME]||0;
    });
    const net=Math.round(((balances(gid)[ME])||0)*100)/100;
    const tone = net>0.004 ? "pos" : net<-0.004 ? "neg" : "zero";
    const say = tone==="pos" ? 'You get back <b>+'+money(net)+'</b>'
              : tone==="neg" ? 'You owe <b>'+money(-net)+'</b>'
              : "You\u2019re all settled";
    html+=
      '<div class="gt-me">'+
        '<span class="st"><span class="k">You paid</span><span class="v">'+money(paid)+'</span></span>'+
        '<span class="st"><span class="k">Your share</span><span class="v">'+money(share)+'</span></span>'+
        '<button class="gt-pill '+tone+'" type="button">'+say+
          (tone!=="zero" ? '<span class="ms" aria-hidden="true">arrow_downward</span>' : '')+'</button>'+
      '</div>';
  } else if(!people){
    html+='<div class="gt-note">Add people to start splitting.</div>';
  }
  s.innerHTML=html;
  const pill=s.querySelector(".gt-pill");
  if(pill) pill.addEventListener("click", ()=>{
    const head=[].find.call(document.querySelectorAll(".sect"), h=> /Who owes whom/.test(h.textContent));
    if(head) head.scrollIntoView({behavior:"smooth", block:"start"});
  });
  main.appendChild(s);
}

function sectionClaim(main, gid){
  const w=el("div","notice");
  w.innerHTML='<span class="ms" aria-hidden="true">how_to_reg</span>'+
    '<div><strong>You are not on this list yet</strong><br>'+
    'Tell the group which name is yours.</div>';
  const b=el("button","btn p","That is me"); b.addEventListener("click", ()=>sheetClaim(gid));
  w.appendChild(b);
  main.appendChild(w);
}

/* ---------- the add form lives on the page, as it used to ----------
   It is cached, because a sync from anyone else re-renders the screen and
   would otherwise wipe out whatever is half-typed into it. */
let FORM=null;
function sectionAdd(main, gid){
  const ppl=names(gid);
  // The form is kept between redraws; who may be picked as the payer changes
  // when somebody claims their name, so that belongs in what identifies it.
  const sig=gid+"|"+ppl.join("|")+"|"+(ME||"")+"|"+(isAdmin()?"admin":"");
  if(FORM && FORM.sig===sig){ main.appendChild(FORM.node); FORM.refresh(); return; }

  /* Amount first, then what it was for, then one line saying who paid and who
     it is split between. The usual case - I paid, split with everyone - needs
     two fields and one tap. Changing either choice opens a small panel under
     that line, and only then. */
  const allowed = payersAllowed(gid, ppl);   // only whoever paid adds it; the admin may add for anyone
  let payer = allowed.indexOf(ME)>-1 ? ME : (allowed[0] || "");
  const sel={}; ppl.forEach(n=> sel[n]=true );
  let open = null;                            // "payer" | "split" | null

  const card=el("div","card addform qa2");
  card.innerHTML=
    '<div class="af-head"><h2 class="ah">Add an expense</h2>'+
      '<button class="af-more" id="afMore" type="button">More options</button></div>'+
    '<div class="af-main">'+
      '<label class="af-amt"><span class="af-cur" aria-hidden="true">'+esc(curSym(gid))+'</span>'+
        '<input id="afAmt" type="number" inputmode="decimal" step="0.01" min="0" '+
        'placeholder="0.00" aria-label="Amount in '+curOf(gid)+'"></label>'+
      '<input id="afDesc" class="af-desc" type="text" autocomplete="off" '+
        'placeholder="What was it for?" aria-label="What was it for?">'+
    '</div>'+
    '<div class="af-sum" id="afSum"></div>'+
    '<div class="af-panel" id="afPanel" hidden></div>'+
    '<div class="af-foot"><span class="af-each" id="afEach"></span>'+
      '<button class="btn p" id="afAdd" type="button">Add expense</button></div>';
  main.appendChild(card);
  const q=(id)=> card.querySelector("#"+id);

  const nameOf=(n)=> n===ME ? "you" : n;
  function splitLabel(){
    const k=ppl.filter(n=>sel[n]).length;
    if(!k) return "nobody yet";
    if(k===ppl.length) return ppl.length>1 ? "everyone" : nameOf(ppl[0]);
    if(k===1){ const only=ppl.filter(n=>sel[n])[0]; return "just "+nameOf(only); }
    return k+" of "+ppl.length;
  }

  function draw(){
    // The line of choices.
    const sum=q("afSum"); sum.innerHTML="";
    if(!allowed.length){
      const b=el("button","af-pill"); b.type="button";
      b.innerHTML=(ppl.length ? "Say which name is <b>yours</b>" : "Add <b>people</b> first");
      b.addEventListener("click", ()=> ppl.length ? sheetClaim(gid) : sheetMembers() );
      sum.appendChild(b);
    } else if(allowed.length===1){
      sum.appendChild(el("span","af-pill", "Paid by <b>"+esc(nameOf(payer))+"</b>"));
    } else {
      const b=el("button","af-pill"); b.type="button";
      b.innerHTML='Paid by <b>'+esc(nameOf(payer))+'</b><span class="ms" aria-hidden="true">expand_more</span>';
      b.setAttribute("aria-expanded", open==="payer" ? "true" : "false");
      b.addEventListener("click", ()=>{ open = open==="payer" ? null : "payer"; draw(); });
      sum.appendChild(b);
    }
    if(ppl.length){
      const b=el("button","af-pill"); b.type="button";
      b.innerHTML='Split between <b>'+esc(splitLabel())+'</b><span class="ms" aria-hidden="true">expand_more</span>';
      b.setAttribute("aria-expanded", open==="split" ? "true" : "false");
      b.addEventListener("click", ()=>{ open = open==="split" ? null : "split"; draw(); });
      sum.appendChild(b);
    }

    // The panel for whichever choice is open.
    const panel=q("afPanel"); panel.innerHTML=""; panel.hidden = !open;
    if(open==="payer"){
      panel.appendChild(el("p","af-hint","Who paid?"));
      const chips=el("div","chips");
      allowed.forEach(n=>{
        const c=el("button","chip"); c.type="button";
        c.innerHTML='<span class="dot" style="background:'+colorOf(n,gid)+'"></span>'+esc(n)+(n===ME?" (you)":"");
        c.setAttribute("aria-pressed", n===payer ? "true" : "false");
        c.addEventListener("click", ()=>{ payer=n; open=null; draw(); });
        chips.appendChild(c);
      });
      panel.appendChild(chips);
    } else if(open==="split"){
      const all = ppl.every(n=>sel[n]);
      const hint=el("p","af-hint");
      hint.innerHTML='Who was it for? <button class="af-link" type="button">'+(all ? "Clear" : "Everyone")+'</button>';
      hint.querySelector("button").addEventListener("click", ()=>{ ppl.forEach(n=> sel[n]=!all ); draw(); });
      panel.appendChild(hint);
      const chips=el("div","chips");
      ppl.forEach(n=>{
        const c=el("button","chip"); c.type="button";
        c.innerHTML='<span class="dot" style="background:'+colorOf(n,gid)+'"></span>'+esc(n)+(n===ME?" (you)":"");
        c.setAttribute("aria-pressed", sel[n] ? "true" : "false");
        c.addEventListener("click", ()=>{ sel[n]=!sel[n]; draw(); });
        chips.appendChild(c);
      });
      panel.appendChild(chips);
    }
    each();
  }

  // What each person's share comes to, as the amount is typed.
  function each(){
    const a=Number(q("afAmt").value)||0, k=ppl.filter(n=>sel[n]).length;
    q("afEach").textContent = a>0 && k ? money(Math.round(a/k*100)/100)+" each · "+k+(k===1?" person":" people") : "";
  }

  function add(){
    const d=q("afDesc").value.trim();
    const a=Math.round((Number(q("afAmt").value)||0)*100)/100;
    const between=ppl.filter(n=>sel[n]);
    if(!ppl.length) return toast("Add people to the group first");
    if(!payer || allowed.indexOf(payer)<0){
      toast("Say which name in this group is yours first");
      return sheetClaim(gid);
    }
    if(!(a>0)){ q("afAmt").focus(); return toast("Enter an amount"); }
    if(!d){ q("afDesc").focus(); return toast("Say what it was for"); }
    if(!between.length){ open="split"; draw(); return toast("Pick at least one person to split between"); }
    q("afAdd").disabled=true;
    const key="e"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    set("trips/"+gid+"/expenses/"+key, {desc:d, amount:a, payer:payer, mode:"equal",
      between:between, vals:{}, cat:"general", note:"", at:Date.now(),
      by:ME||USER.name, byUid:USER.uid})
      .then(()=>{
        notify("expense.add", gid, {desc:d, amount:a, ref:key});
        q("afDesc").value=""; q("afAmt").value="";
        ppl.forEach(n=> sel[n]=true ); open=null; draw();
        toast("Expense added");
      })
      .finally(()=>{ q("afAdd").disabled=false; });
  }

  q("afAmt").addEventListener("input", each);
  [q("afAmt"), q("afDesc")].forEach(i=> i.addEventListener("keydown", e=>{
    if(e.key==="Enter"){ e.preventDefault(); add(); }
  }));
  q("afAdd").addEventListener("click", add);
  q("afMore").addEventListener("click", ()=> sheetExpense(null) );
  draw();

  FORM={sig:sig, node:card, refresh:draw};
}

/* ---------- expenses, with the filters the tracker had ---------- */
const EXP_ALL = {};     // gid -> the whole list is showing, not just the latest
let EXP_TUNE = false;   // the split-size filters are open

/* One search box, one row of "who paid", and calm rows: what it was, who
   paid and when on one line, the amount and my share on the right. Who it
   was split between is one tap away on the expense itself, rather than a
   chip for every person on every row. The latest few show; the rest are a
   button away instead of a box that scrolls inside the page. */
function groupExpenses(main, gid){
  const all=expensesOf(gid), ppl=names(gid);

  const bar=el("div","exbar");
  bar.innerHTML=
    '<label class="exsearch"><span class="ms" aria-hidden="true">search</span>'+
      '<input id="fq" type="search" placeholder="Search expenses" aria-label="Search expenses" autocomplete="off"></label>'+
    '<button class="extune" id="fTune" type="button" aria-label="Filter by how it was split">'+
      '<span class="ms" aria-hidden="true">tune</span></button>';
  main.appendChild(bar);
  const rowsWrap=el("div","exfilters");
  rowsWrap.innerHTML=
    '<div class="frow" id="fPayer" role="group" aria-label="Who paid"></div>'+
    '<div class="frow" id="fWays" role="group" aria-label="How many ways it was split"></div>';
  main.appendChild(rowsWrap);

  const q=$("fq"); q.value=FILT.q;
  let t;
  q.addEventListener("input", ()=>{ clearTimeout(t); t=setTimeout(()=>{ FILT.q=q.value; draw(); }, 140); });

  const payers=[""].concat(ppl);
  payers.forEach(n=>{
    const c=el("button","chip"); c.type="button";
    c.textContent = !n ? "Everyone" : n===ME ? "You" : n;
    c.addEventListener("click", ()=>{ FILT.payer=(FILT.payer===n && n)?"":n; refreshChips(); draw(); });
    $("fPayer").appendChild(c);
  });
  const maxWays=Math.max(2, ppl.length);
  const ways=[0]; for(let i=2;i<=maxWays;i++) ways.push(i);
  ways.forEach(w=>{
    const c=el("button","chip"); c.type="button";
    c.textContent = w ? ("Split "+w+" ways") : "Any split";
    c.addEventListener("click", ()=>{ FILT.ways=(FILT.ways===w && w)?0:w; refreshChips(); draw(); });
    $("fWays").appendChild(c);
  });
  $("fTune").addEventListener("click", ()=>{ EXP_TUNE=!EXP_TUNE; refreshChips(); });
  function refreshChips(){
    [].forEach.call($("fPayer").children,(c,i)=> c.setAttribute("aria-pressed", FILT.payer===payers[i]?"true":"false"));
    [].forEach.call($("fWays").children,(c,i)=> c.setAttribute("aria-pressed", FILT.ways===ways[i]?"true":"false"));
    const open = EXP_TUNE || !!FILT.ways;
    $("fWays").hidden = !open;
    $("fTune").setAttribute("aria-pressed", open ? "true" : "false");
  }
  refreshChips();

  const host=el("div"); host.id="expList"; main.appendChild(host);
  draw();

  function matches(e){
    if(FILT.payer && e.payer!==FILT.payer) return false;
    const b=(e.between&&e.between.length)?e.between:[e.payer];
    if(FILT.ways && b.length!==FILT.ways) return false;
    const needle=FILT.q.trim().toLowerCase();
    if(needle){
      const hay=(e.desc+" "+e.payer+" "+(e.note||"")+" "+b.join(" ")).toLowerCase();
      if(hay.indexOf(needle)<0) return false;
    }
    return true;
  }

  function draw(){
    const list=all.filter(matches);
    host.innerHTML="";
    const filtering = !!(FILT.q.trim() || FILT.payer || FILT.ways);
    if(filtering){
      let sum=0; list.forEach(e=> sum+=Number(e.amount)||0 );
      const line=el("div","fcount");
      line.innerHTML='<span><b>'+list.length+'</b> of '+all.length+' &middot; '+money(sum)+'</span>';
      const clr=el("button",null,"Clear"); clr.type="button";
      clr.addEventListener("click", ()=>{
        FILT.q=""; FILT.payer=""; FILT.ways=0; $("fq").value=""; refreshChips(); draw();
      });
      line.appendChild(clr); host.appendChild(line);
    }
    if(!all.length){
      host.appendChild(el("div","empty",
        '<span class="ms" aria-hidden="true">receipt</span><h3>Nothing logged yet.</h3>'));
      return;
    }
    if(!list.length){
      host.appendChild(el("div","empty",
        '<span class="ms" aria-hidden="true">search_off</span><h3>Nothing matches</h3>'+
        '<p>Try a different search, or clear the filters.</p>'));
      return;
    }
    const CAP=6;
    const showAll = FULLVIEW || EXP_ALL[gid] || filtering;
    const shown = showAll ? list : list.slice(0, CAP);
    const card=el("div","card exlist");
    shown.forEach(e=>{
      const between=(e.between&&e.between.length)?e.between:[e.payer];
      const n=between.length, c=catOf(e.cat), amt=Number(e.amount)||0;
      const who = e.payer===ME ? "You" : e.payer;
      const day = e.at ? new Date(e.at).toLocaleDateString(undefined,{day:"numeric", month:"short"}) : "";
      const sh = sharesOf(e);
      const mine = ME ? (sh[ME]||0) : 0;
      const equal = !e.mode || e.mode==="equal";
      const cap = mine>0.004 && n>1 ? "your share "+money(mine)
                : (equal && n>1) ? money(amt/n)+" each" : "";
      // A per-person line for everyone actually in it - what each one owes,
      // with whoever paid picked out from the rest - so nobody has to open
      // the expense just to see who was involved and for how much. The
      // payer's own row still shows their SHARE, not the total - the line
      // above already said they paid the total, so repeating it here would
      // just read as a second, bigger number for no reason.
      const personRow=(name, isPayer, share)=>{
        const m=memberOf(name,gid);
        return '<span class="prow'+(isPayer?" paid":"")+'">'+
          avatarHTML("xs", name, m&&m.color, m&&m.photo)+
          '<span class="nm">'+esc(name===ME?"you":name)+(isPayer?' <span class="ptag">paid</span>':'')+'</span>'+
          '<span class="sh">'+money(share)+'</span></span>';
      };
      // Only whoever the expense is actually split between goes in this list -
      // a payer who covered it entirely for other people, and isn't part of
      // the split themselves, is already named in the line above and doesn't
      // get a row of their own down here.
      const plist = between.map(name=> personRow(name, name===e.payer, sh[name]||0)).join("");
      // Paid for other people entirely, with no share of it themselves - a
      // different kind of line from an ordinary split, so it gets its own
      // colour (the same green used for money coming back to somebody)
      // instead of blending into every other row.
      const gifted = between.indexOf(e.payer)<0;
      const r=el("button","ex2row"+(gifted?" gifted":"")); r.type="button";
      r.innerHTML=
        '<span class="ex-ic" style="--c:'+colorOf(e.payer,gid)+'"><span class="ms" aria-hidden="true">'+c.i+'</span></span>'+
        '<span class="ex-b"><span class="ex-t">'+esc(e.desc)+'</span>'+
          '<span class="ex-txt">'+esc(who)+' paid'+(gifted?' <span class="gtag">for them</span>':'')+
          (day ? ' &middot; '+esc(day) : '')+'</span>'+
          '<span class="ex-plist">'+plist+'</span></span>'+
        '<span class="ex-r"><span class="ex-amt">'+money(amt)+'</span>'+
          (cap ? '<span class="ex-cap">'+cap+'</span>' : '')+'</span>';
      r.addEventListener("click", ()=>sheetExpense(e));
      card.appendChild(r);
    });
    host.appendChild(card);

    const foot=el("div","exfoot");
    if(!showAll && list.length>CAP){
      const more=el("button","exmore","Show all "+list.length+" expenses"); more.type="button";
      more.addEventListener("click", ()=>{ EXP_ALL[gid]=true; draw(); });
      foot.appendChild(more);
    } else if(EXP_ALL[gid] && !filtering && !FULLVIEW && list.length>CAP){
      const less=el("button","exmore","Show fewer"); less.type="button";
      less.addEventListener("click", ()=>{ EXP_ALL[gid]=false; draw(); });
      foot.appendChild(less);
    }
    if(!FULLVIEW){
      const link=el("a","exlink",'Open full list<span class="ms" aria-hidden="true">open_in_new</span>');
      link.href=location.pathname+"?full=1#g="+gid; link.target="_blank"; link.rel="noopener";
      foot.appendChild(link);
    }
    if(foot.children.length) host.appendChild(foot);
  }
}
// "Sep 5 · 3:45 PM" - the year only when it isn't this one, and never a
// leading zero on the hour ("3:45 PM", not "03:45 PM"). A weekday alongside
// the date and time was one thing too many to read at a glance.
function fmtAdded(ts){ return fmtWhen(ts); }

function groupBalances(main, gid){
  const b=balances(gid), all=everyoneIn(gid);
  if(!all.length || !expensesOf(gid).length){
    main.appendChild(el("div","empty",
      '<span class="ms" aria-hidden="true">balance</span><h3>Add people and expenses first.</h3>'));
    if(!all.length) return;
  }
  /* You first, then whoever gets back the most down to whoever owes the most,
     so the list reads top to bottom. Each figure says in words what it means,
     so the colours never need explaining. */
  const me=meIn(gid);
  const val=(n)=> Math.round((b[n]||0)*100)/100;
  const order=all.slice().sort((x,y)=>
    (x===me ? -1 : y===me ? 1 : 0) || val(y)-val(x) || x.localeCompare(y));
  const card=el("div","card ballist");
  order.forEach(n=>{
    const m=memberOf(n, gid), v=val(n);
    const tone = v>0.004 ? "pos" : v<-0.004 ? "neg" : "zero";
    const figure = tone==="pos" ? "+"+money(v) : tone==="neg" ? "−"+money(-v) : money(0);
    const cap = tone==="pos" ? "gets back" : tone==="neg" ? "owes" : "settled";
    const r=el("button","row balrow"+(n===me?" mine":""));
    r.type="button";
    r.innerHTML=
      avatarHTML("", n, m&&m.color, m&&m.photo)+
      '<span class="body"><span class="t1"><span class="nm">'+esc(n)+'</span>'+
        (n===me?'<span class="bal-tag you">You</span>':'')+
        (!m?'<span class="bal-tag">not on the list</span>':'')+'</span>'+
      '<span class="t2">'+paidShareLine(n,gid)+'</span></span>'+
      '<span class="right"><span class="amt '+tone+'">'+figure+'</span>'+
        '<span class="cap">'+cap+'</span></span>'+
      '<span class="chev"><span class="ms" aria-hidden="true">chevron_right</span></span>';
    r.addEventListener("click", ()=>sheetPerson(n));
    card.appendChild(r);
  });
  main.appendChild(card);
}

function sectionWhoOwes(main, gid){
  const st=transferPlan(gid);
  if(!st.length){
    main.appendChild(el("div","empty",
      '<span class="ms" aria-hidden="true">check_circle</span>'+
      '<h3>All square - nobody owes anybody.</h3>'));
    return;
  }
  /* One plain sentence per payment - "You pay Kavya", "Kavya pays you",
     "Kelvin pays Kalai" - with both faces and an arrow between them. Grouping
     by who gets paid, with bars, made you work out the direction yourself.
     Yours come first, then everybody else's, biggest first. */
  const me=meIn(gid);
  const rank=(t)=> t.from===me ? 0 : t.to===me ? 1 : 2;
  const rows=st.slice().sort((a,c)=> rank(a)-rank(c) || c.amt-a.amt);
  const card=el("div","card owelist");
  rows.forEach(t=>{
    const iPay=!!me && t.from===me, iGet=!!me && t.to===me;
    const fm=memberOf(t.from,gid), tm=memberOf(t.to,gid);
    const line = iPay ? '<b>You</b> pay <b>'+esc(t.to)+'</b>'
               : iGet ? '<b>'+esc(t.from)+'</b> pays <b>you</b>'
               :        '<b>'+esc(t.from)+'</b> pays <b>'+esc(t.to)+'</b>';
    const note = iPay ? "You owe this" : iGet ? "Owed to you" : "Between them";
    const r=el("div","owe-row"+(iPay||iGet ? " mine" : ""));
    r.innerHTML=
      '<span class="owe-pair">'+avatarHTML("sm", t.from, fm&&fm.color, fm&&fm.photo)+
        '<span class="ms" aria-hidden="true">arrow_forward</span>'+
        avatarHTML("sm", t.to, tm&&tm.color, tm&&tm.photo)+'</span>'+
      '<span class="owe-b"><span class="owe-t">'+line+'</span>'+
        '<span class="owe-m">'+note+'</span></span>'+
      '<span class="owe-r"><span class="owe-amt '+(iPay?"neg":iGet?"pos":"zero")+'">'+
        money(t.amt)+'</span></span>';
    const right=r.querySelector(".owe-r");
    const btn=(label, soft)=>{
      const b=el("button","owe-btn"+(soft?" soft":""), label); b.type="button";
      right.appendChild(b); return b;
    };
    // The same two actions the Today card offers, where they belong.
    if(iPay){
      btn("Pay").addEventListener("click", ()=> sheetSettle(t.from, t.to, t.amt) );
    } else if(iGet){
      const key=gid+"|"+t.from, b=btn(NUDGED[key] ? "Reminder sent" : "Remind", true);
      b.disabled=!!NUDGED[key];
      b.addEventListener("click", ()=>{ if(sendNudge(gid, t.from, t.amt, b)) NUDGED[key]=true; });
    } else if(isAdmin()){
      btn("Record", true).addEventListener("click", ()=> sheetSettle(t.from, t.to, t.amt) );
    }
    card.appendChild(r);
  });
  main.appendChild(card);
}

function sectionPayments(main, gid){
  const pays=paymentsOf(gid);
  if(!pays.length) return;
  sectionHead(main, "payments", "Payments recorded", "Tap one to correct or delete it.");
  const card=el("div","card");
  pays.forEach(p=>{
    const r=el("button","row");
    r.innerHTML='<span class="cat teal"><span class="ms" aria-hidden="true">payments</span></span>'+
      '<span class="body"><span class="t1">'+esc(p.from)+' paid '+esc(p.to)+'</span>'+
      '<span class="t2">'+esc(fmtAdded(p.at))+(p.note?" · "+esc(p.note):"")+payStateHTML(p, gid)+'</span></span>'+
      '<span class="right"><span class="amt pos">'+money(p.amount)+'</span></span>';
    r.addEventListener("click", ()=>sheetSettle(p.from, p.to, p.amount, p));
    card.appendChild(r);
  });
  main.appendChild(card);
}

function groupActivity(main, gid){
  const items=[]
    .concat(expensesOf(gid).map(e=>({t:"e", at:e.at, e})))
    .concat(paymentsOf(gid).map(p=>({t:"p", at:p.at, p})))
    .sort((a,b)=>(b.at||0)-(a.at||0));
  if(!items.length){
    const e=el("div","empty");
    e.innerHTML='<span class="ms" aria-hidden="true">history</span><h3>Nothing yet</h3><p>Expenses and payments will show here.</p>';
    main.appendChild(e); return;
  }
  const card=el("div","card");
  items.forEach(it=>{
    const r=el(it.t==="p"?"button":"div","row");
    if(it.t!=="p") r.style.cursor="default";
    else r.addEventListener("click", ()=>sheetSettle(it.p.from, it.p.to, it.p.amount, it.p));
    if(it.t==="e"){
      const e=it.e, c=catOf(e.cat);
      r.innerHTML='<span class="cat"><span class="ms" aria-hidden="true">'+c.i+'</span></span>'+
        '<span class="body"><span class="t1">'+esc(e.by||e.payer)+' added “'+esc(e.desc)+'”</span>'+
        '<span class="t2">'+esc(fmtWhen(e.at))+'</span></span>'+
        '<span class="right"><span class="amt">'+money(e.amount)+'</span></span>';
    } else {
      const p=it.p;
      r.innerHTML='<span class="cat teal"><span class="ms" aria-hidden="true">payments</span></span>'+
        '<span class="body"><span class="t1">'+esc(p.from===ME?"You":p.from)+' paid '+esc(p.to===ME?"you":p.to)+'</span>'+
        '<span class="t2">'+esc(fmtWhen(p.at))+(p.note?" · "+esc(p.note):"")+payStateHTML(p, gid)+'</span></span>'+
        '<span class="right"><span class="amt pos">'+money(p.amount)+'</span></span>';
    }
    card.appendChild(r);
  });
  main.appendChild(card);
}

/* ---------- global activity ---------- */
function viewActivity(main){
  setTitle(main, "Activity");
  const items=[];
  joinedHere().forEach(g=>{
    expensesOf(g.id).forEach(e=> items.push({t:"e", at:Number(e.at)||0, e, gid:g.id}) );
    paymentsOf(g.id).forEach(p=> items.push({t:"p", at:Number(p.at)||0, p, gid:g.id}) );
  });
  items.sort((a,b)=> b.at-a.at);
  if(!items.length){
    const e=el("div","empty");
    e.innerHTML='<span class="ms" aria-hidden="true">receipt_long</span><h3>No activity yet</h3>'+
      '<p>Everything added across your groups shows up here.</p>';
    main.appendChild(e); return;
  }

  /* By month, then by day, newest first. Each day is its own card under a
     label saying which day it is and what was spent, so finding "that dinner
     last Tuesday" means scanning a handful of headings, not two hundred rows. */

  // A group's icon takes the same colour it has on the Groups screen.
  const order = joinedHere().slice().sort((a,b)=>groupName(a.id).localeCompare(groupName(b.id))).map(g=>g.id);
  const tint = (gid)=> "gc"+(Math.max(0, order.indexOf(gid)) % 6);
  const monthKey = (ts)=>{ const d=new Date(ts||0); return d.getFullYear()+"-"+d.getMonth(); };
  const monthName = (ts)=> ts ? new Date(ts).toLocaleDateString(undefined,{month:"long", year:"numeric"}) : "Undated";
  // Totals per currency: a day in a rupee group and a dollar group shows both.
  const spent = (bag)=> moneyMulti(bag)+" spent";

  const shown = items.slice(0,200);
  let month=null, day=null, card=null, dayTotal={}, dayOut=null, monthTotal={}, monthOut=null;

  shown.forEach(it=>{
    const mk=monthKey(it.at), dk=dayKey(it.at);
    if(mk!==month){
      month=mk; monthTotal={}; day=null;
      const mh=el("div","act-month");
      mh.innerHTML='<h2>'+esc(monthName(it.at))+'</h2><span class="act-mtotal"></span>';
      main.appendChild(mh);
      monthOut=mh.querySelector(".act-mtotal");
    }
    if(dk!==day){
      day=dk; dayTotal={};
      const dh=el("div","act-day");
      dh.innerHTML='<span>'+esc(dayLabel(it.at))+'</span><span class="act-dtotal"></span>';
      main.appendChild(dh);
      dayOut=dh.querySelector(".act-dtotal");
      card=el("div","card act-card");
      main.appendChild(card);
    }

    const me=meIn(it.gid);
    const r=el("button","act-row "+tint(it.gid));
    r.type="button";
    if(it.t==="e"){
      const e=it.e, c=catOf(e.cat), amt=Number(e.amount)||0;
      const mine = me ? (sharesOf(e)[me]||0) : 0;
      const iPaid = !!me && e.payer===me;
      let figure, tone, what;
      // What this expense means for me, said plainly.
      if(iPaid && amt-mine > 0.004){ figure="+"+money(amt-mine, it.gid); tone="pos"; what="you get back"; }
      else if(iPaid){                figure=money(amt, it.gid);  tone="zero"; what="you paid"; }
      else if(mine > 0.004){         figure="−"+money(mine, it.gid); tone="neg"; what="your share"; }
      else {                         figure=money(amt, it.gid);  tone="zero"; what="not yours"; }
      r.innerHTML=
        '<span class="act-ic"><span class="ms" aria-hidden="true">'+c.i+'</span></span>'+
        '<span class="act-b"><span class="act-t">'+esc(e.desc)+'</span>'+
          '<span class="act-m">'+esc(iPaid ? "You" : e.payer)+' paid · '+esc(groupName(it.gid))+'</span></span>'+
        '<span class="act-r"><span class="act-amt '+tone+'">'+figure+'</span>'+
          '<span class="act-cap">'+what+'</span></span>';
      curAdd(dayTotal, it.gid, amt); curAdd(monthTotal, it.gid, amt);
      dayOut.textContent=moneyMulti(dayTotal);
      monthOut.textContent=spent(monthTotal);
    } else {
      const p=it.p, amt=Number(p.amount)||0;
      const fromMe = !!me && p.from===me, toMe = !!me && p.to===me;
      r.classList.add("pay");
      const figure = toMe ? "+"+money(amt, it.gid) : money(amt, it.gid);
      const tone   = toMe ? "pos" : "zero";
      const what   = toMe ? "paid to you" : fromMe ? "you paid" : "payment";
      r.innerHTML=
        '<span class="act-ic"><span class="ms" aria-hidden="true">payments</span></span>'+
        '<span class="act-b"><span class="act-t">'+esc(fromMe ? "You" : p.from)+' paid '+esc(toMe ? "you" : p.to)+'</span>'+
          '<span class="act-m">'+esc(groupName(it.gid))+payStateHTML(p, it.gid)+'</span></span>'+
        '<span class="act-r"><span class="act-amt '+tone+'">'+figure+'</span>'+
          '<span class="act-cap">'+what+'</span></span>';
    }
    r.addEventListener("click", ()=>openGroup(it.gid));
    card.appendChild(r);
  });

  if(items.length > shown.length){
    main.appendChild(el("p","act-more","Showing the latest "+shown.length+" of "+items.length+
      ". Open a group to see all of its expenses."));
  }
}

/* ---------- account ---------- */
/* ---------- Interac ----------
   Your details shown as a card you could hand somebody, the bank app Pay
   opens, how paying works in three steps, and everybody else - those ready
   to be paid first, those not set up yet after. The card and the rows come
   in once per visit, not on every redraw the database causes. */
let IX_EDIT = false, IX_SEEN = false, IX_INFO = false;
const ETX_TINT = {cibc:"#B5123A", rbc:"#005DAA", td:"#1A8B3C", scotiabank:"#D8141C", bmo:"#0079C1"};
const ETX_MONO = {cibc:"CIBC", rbc:"RBC", td:"TD", scotiabank:"S", bmo:"BMO"};
function viewInterac(main){
  setTitle(main, "Pay");
  const enter = !IX_SEEN; IX_SEEN = true;
  // Canada pays back by Interac, India by UPI: the side decides.
  if(SIDE==="INR") return viewUpi(main, enter);
  const mine = etxFor(USER.uid);
  const raw = (DIRECTORY[USER.uid] && DIRECTORY[USER.uid].pay) || {};
  const bank = myBank();
  const editing = IX_EDIT || !mine;

  // ---- your card ----
  const hero=el("div","ix-hero"+(enter?" enter":""));
  const card=el("div","ix-card"+(mine?"":" blank"));
  card.innerHTML=
    '<div class="ix-card-top"><span class="ix-brand">Interac e-Transfer</span>'+
      '<span class="ms" aria-hidden="true">contactless</span></div>'+
    '<div class="ix-chipset"><span class="ix-chipgold" aria-hidden="true"></span>'+
      (bank ? '<span class="ix-bankname">'+esc(bank.name)+'</span>' : '')+'</div>'+
    (mine
      ? '<div class="ix-handle">'+esc(mine.handle)+'</div><div class="ix-holder">'+esc(mine.name)+'</div>'
      : '<div class="ix-handle ph">your@email.com</div>'+
        '<div class="ix-holder">Add your details so people can pay you back</div>');
  hero.appendChild(card);
  if(mine){
    const acts=el("div","ix-card-acts");
    acts.innerHTML=
      '<button class="ix-act" id="ixCopyMine" type="button"><span class="ms" aria-hidden="true">content_copy</span>Copy my details</button>'+
      '<button class="ix-act" id="ixEditBtn" type="button"><span class="ms" aria-hidden="true">'+(IX_EDIT?"close":"edit")+'</span>'+
        (IX_EDIT?"Close":"Edit")+'</button>';
    hero.appendChild(acts);
  }
  main.appendChild(hero);
  // The card leans toward the pointer, and its glow follows.
  card.addEventListener("pointermove", e=>{
    const r=card.getBoundingClientRect();
    const x=(e.clientX-r.left)/r.width-.5, y=(e.clientY-r.top)/r.height-.5;
    card.style.setProperty("--ry", (x*10).toFixed(2)+"deg");
    card.style.setProperty("--rx", (-y*8).toFixed(2)+"deg");
    card.style.setProperty("--gx", Math.round((x+.5)*100)+"%");
  });
  card.addEventListener("pointerleave", ()=>{ card.style.setProperty("--rx","0deg"); card.style.setProperty("--ry","0deg"); });
  if($("ixCopyMine")) $("ixCopyMine").addEventListener("click", ()=> etxCopy(mine.name+"\n"+mine.handle, "Your details") );
  if($("ixEditBtn")) $("ixEditBtn").addEventListener("click", ()=>{ IX_EDIT=!IX_EDIT; render(); });

  // ---- the form, only while editing or before anything is saved ----
  if(editing){
    const f=el("div","card pad ix-form");
    f.innerHTML=
      '<div class="ix-form-h"><span class="ms" aria-hidden="true">'+(mine ? "edit_note" : "badge")+'</span>'+
        '<div><b>'+(mine ? "Edit your details" : "Add your Interac details")+'</b>'+
        '<small>So friends can pay you back in a tap.</small></div></div>'+
      '<div class="field"><label for="ixName">Name on your Interac account</label>'+
        '<input id="ixName" type="text" autocomplete="name" maxlength="60" placeholder="'+esc(USER.name||"")+'"></div>'+
      '<div class="field"><label for="ixHandle">Interac email or phone</label>'+
        '<input id="ixHandle" type="text" inputmode="email" autocapitalize="off" autocorrect="off" maxlength="120" '+
        'placeholder="name@gmail.com or (416) 555-0123"></div>'+
      '<p class="ix-note"><span class="ms" aria-hidden="true">lock</span>Only people approved into Settle can see these.</p>'+
      '<div class="etx-actions"><button class="btn p" id="ixSave" type="button">'+(mine?"Save changes":"Save details")+'</button>'+
        (mine ? '<button class="btn s" id="ixClear" type="button">Remove</button>' : '')+'</div>';
    main.appendChild(f);
    $("ixName").value = (mine&&mine.name) || tidyName(raw.name||"") || "";
    $("ixHandle").value = (mine&&mine.handle) || String(raw.handle||"");
    $("ixSave").addEventListener("click", ()=>{
      const rec=etxRecord($("ixName").value, $("ixHandle").value);
      if(typeof rec==="string") return toast(rec.replace("the Interac account","your Interac account"));
      $("ixSave").disabled=true;
      updStrict("directory/"+USER.uid, {pay:rec}).then(()=>{
        DIRECTORY[USER.uid]=Object.assign({}, DIRECTORY[USER.uid]||{}, {pay:rec});
        IX_EDIT=false; IX_SEEN=false;           // let the card sweep in with the new details
        toast("Interac details saved"); render();
      }, e=>{ $("ixSave").disabled=false; toast(writeError(e)); });
    });
    if($("ixClear")) $("ixClear").addEventListener("click", ()=>{
      updStrict("directory/"+USER.uid, {pay:null}).then(()=>{
        if(DIRECTORY[USER.uid]) delete DIRECTORY[USER.uid].pay;
        IX_EDIT=false; toast("Interac details removed"); render();
      }, e=> toast(writeError(e)) );
    });
  }


  // ---- your bank app: one row of logos, the details folded away ----
  main.appendChild(ixHead("account_balance", "Your bank app", bank ? bank.name : "Not chosen", bank ? "good" : ""));
  const bankPanel=el("div","ix-panel");
  const banks=el("div","ix-banks"); banks.id="ixBanks";
  const cur=(PREFS&&PREFS.bank)||"";
  ETX_BANKS.concat([{id:"", name:"None"}]).forEach(b=>{
    const on = b.id===cur;
    const t=el("button","ix-bank"+(on?" on":"")); t.type="button";
    t.style.setProperty("--bk", ETX_TINT[b.id] || "var(--ink-3)");
    t.setAttribute("aria-pressed", on ? "true" : "false");
    t.innerHTML=
      '<span class="ix-mono">'+(b.id ? esc(ETX_MONO[b.id]||b.name) : '<span class="ms" aria-hidden="true">block</span>')+'</span>'+
      '<span class="ix-bank-n">'+esc(b.name)+'</span>'+
      (on ? '<span class="ix-tick ms" aria-hidden="true">check_circle</span>' : '');
    t.addEventListener("click", ()=>{
      PREFS=PREFS||{}; PREFS.bank=b.id;
      set("users/"+USER.uid+"/prefs/bank", b.id||null);
      render();
    });
    banks.appendChild(t);
  });
  bankPanel.appendChild(banks);
  const info=el("details","ix-info");
  info.innerHTML='<summary><span class="ms" aria-hidden="true">info</span>How Pay opens your bank'+
      '<span class="ms chev" aria-hidden="true">expand_more</span></summary>'+
    '<p>Pay copies the email and opens this app. Banks can’t be told who to pay, so you paste the email and '+
    'amount in. On iPhone the bank’s App Store page opens - tap Open there.</p>';
  info.open=IX_INFO;
  info.addEventListener("toggle", ()=>{ IX_INFO=info.open; });
  bankPanel.appendChild(info);
  main.appendChild(bankPanel);

  // ---- how paying works ----
  main.appendChild(ixHead("route", "How paying works"));
  const howPanel=el("div","ix-panel");
  const how=el("div","ix-how");
  how.innerHTML=[["payments","Tap Pay","on anything you owe"],
                 ["content_copy","Copy & open","your bank app"],
                 ["task_alt","Record it","back in Settle"]].map((st,i)=>
    '<div class="ix-step"><span class="ix-step-ic"><span class="ms" aria-hidden="true">'+st[0]+'</span><i>'+(i+1)+'</i></span>'+
      '<b>'+st[1]+'</b><small>'+st[2]+'</small></div>').join('<span class="ix-step-line" aria-hidden="true"></span>');
  howPanel.appendChild(how);
  main.appendChild(howPanel);

  // ---- everybody else ----
  // An address is copied exactly as saved; a phone number as digits only.
  ixPeople(main, enter, {
    what: "Interac details", none: "No Interac details yet",
    empty: "When people in your groups add their Interac details, they show up here, ready to copy.",
    edit: sheetEtxFor,
    detail: (uid)=>{
      const d=etxFor(uid); if(!d) return null;
      const email=/@/.test(d.handle);
      return {id:d.handle, name:d.name, what:"Interac "+(email?"email":"phone"),
              copy: ()=> email ? etxCopy(d.handle, "Email") : etxCopy(d.handle.replace(/[^\d]/g,""), "Phone")};
    }
  });
}

/* The administrator filling in somebody else's Interac details. The database
   rules let the administrator write only this part of another person's
   entry, and check its shape; the person can still change it themselves. */
function sheetEtxFor(uid, name){
  if(!isAdmin() || !uid) return;
  const raw=(DIRECTORY[uid]&&DIRECTORY[uid].pay)||{};
  const cur=etxClean(raw);
  openSheet("Interac for "+name, (b)=>{
    b.innerHTML=
      '<p class="lead">As the administrator you can fill these in for '+esc(name)+
        '. They can still change them in their own Interac tab.</p>'+
      '<div class="field"><label for="axName">Name on their Interac account</label>'+
        '<input id="axName" type="text" maxlength="60" autocomplete="off"></div>'+
      '<div class="field"><label for="axHandle">Their Interac email or phone</label>'+
        '<input id="axHandle" type="text" inputmode="email" autocapitalize="off" autocorrect="off" maxlength="120" '+
        'autocomplete="off" placeholder="name@gmail.com or (416) 555-0123"></div>'+
      '<button class="btn p wide" id="axSave" type="button">Save details</button>'+
      (cur ? '<button class="btn s wide" id="axDel" type="button" style="margin-top:10px">Remove their details</button>' : '');
    $("axName").value = (cur&&cur.name) || tidyName(raw.name||"") || name;
    $("axHandle").value = (cur&&cur.handle) || String(raw.handle||"");
    const failed = (e)=> toast(writeError(e));
    $("axSave").addEventListener("click", ()=>{
      const rec=etxRecord($("axName").value, $("axHandle").value);
      if(typeof rec==="string") return toast(rec);
      rec.by=USER.uid;
      $("axSave").disabled=true;
      updStrict("directory/"+uid, {pay:rec}).then(()=>{
        DIRECTORY[uid]=Object.assign({}, DIRECTORY[uid]||{}, {pay:rec});
        closeSheet(); toast(name+"'s Interac details saved"); render();
      }, (e)=>{ $("axSave").disabled=false; failed(e); });
    });
    if($("axDel")) $("axDel").addEventListener("click", ()=>{
      updStrict("directory/"+uid, {pay:null}).then(()=>{
        if(DIRECTORY[uid]) delete DIRECTORY[uid].pay;
        closeSheet(); toast(name+"'s Interac details removed"); render();
      }, failed);
    });
  });
}

/* ---------- shared by Interac and UPI ---------- */
// A heading like the ones on Today, with where things stand on the right.
function ixHead(icon, title, pill, pillCls){
  const h=el("div","th-head");
  h.innerHTML='<span class="th-ic"><span class="ms" aria-hidden="true">'+icon+'</span></span><h2>'+esc(title)+'</h2>'+
    (pill ? '<span class="ix-pill'+(pillCls ? ' '+pillCls : '')+'">'+esc(pill)+'</span>' : '');
  return h;
}
// The card leans toward the pointer, and its glow follows.
function ixTilt(card){
  card.addEventListener("pointermove", e=>{
    const r=card.getBoundingClientRect();
    const x=(e.clientX-r.left)/r.width-.5, y=(e.clientY-r.top)/r.height-.5;
    card.style.setProperty("--ry", (x*10).toFixed(2)+"deg");
    card.style.setProperty("--rx", (-y*8).toFixed(2)+"deg");
    card.style.setProperty("--gx", Math.round((x+.5)*100)+"%");
  });
  card.addEventListener("pointerleave", ()=>{ card.style.setProperty("--rx","0deg"); card.style.setProperty("--ry","0deg"); });
}
/* Everybody I might pay - the people in my groups, or everyone in Settle for
   the administrator - those ready to be paid first, then those not set up. */
function ixPeople(main, enter, o){
  const seen={}, people=[];
  joinedHere().forEach(g=> membersOf(g.id).forEach(m=>{
    if(!m.uid || m.uid===USER.uid || seen[m.uid]) return;
    seen[m.uid]=true;
    people.push({uid:m.uid, name:(DIRECTORY[m.uid]&&DIRECTORY[m.uid].name)||m.name, color:m.color, photo:m.photo});
  }));
  // The administrator looks after everybody's details, so sees everybody in
  // Settle, not only the people in their own groups.
  if(isAdmin()) Object.keys(DIRECTORY||{}).forEach(u=>{
    const e=DIRECTORY[u]||{};
    if(u===USER.uid || seen[u] || !e.name || !onThisSide(u)) return;
    seen[u]=true;
    people.push({uid:u, name:e.name, color:null, photo:e.photo||null});
  });
  people.sort((a,c)=> String(a.name).localeCompare(String(c.name)));
  const ready=people.filter(p=> o.detail(p.uid)), pending=people.filter(p=> !o.detail(p.uid));

  main.appendChild(ixHead("group", isAdmin() ? "Everyone in Settle" : "People in your groups",
    people.length ? ready.length+" of "+people.length+" ready" : "",
    people.length && ready.length===people.length ? "good" : ""));
  if(!people.length){
    const e=el("div","ix-panel ix-empty");
    e.innerHTML='<span class="ms" aria-hidden="true">person_search</span><b>No one to pay here yet</b>'+
      '<p>'+esc(o.empty)+'</p>';
    main.appendChild(e);
    return;
  }

  const wrap=el("div","ix-list"+(enter?" enter":""));
  let find=null;
  if(people.length>6){
    find=el("label","ix-search");
    find.innerHTML='<span class="ms" aria-hidden="true">search</span>'+
      '<input id="ixFind" type="search" placeholder="Find someone" aria-label="Find someone" autocomplete="off">';
    wrap.appendChild(find);
  }
  let n=0;
  const row=(p, d)=>{
    const r=el("div","etx-person ix-person"+(d?"":" off"));
    r.style.setProperty("--i", n++);
    r.dataset.q=(p.name+" "+(d ? d.id+" "+d.name : "")).toLowerCase();
    const pres=presenceText(p.uid);
    r.innerHTML=avatarHTML("", p.name, p.color, p.photo, p.uid)+
      '<span class="etx-b"><span class="etx-n">'+esc(p.name)+'</span>'+
        (d ? '<span class="etx-h">'+esc(d.id)+(d.name!==p.name ? ' &middot; '+esc(d.name) : '')+'</span>'
           : '<span class="etx-h none">'+esc(o.none)+'</span>')+
        (pres ? '<span class="etx-h pres'+(isOnline(p.uid)?' on':'')+'">'+esc(pres)+'</span>' : '')+'</span>';
    if(d){
      const b=el("button","etx-copy"); b.type="button";
      b.innerHTML='<span class="ms" aria-hidden="true">content_copy</span>Copy';
      b.setAttribute("aria-label","Copy "+p.name+"'s "+d.what);
      b.addEventListener("click", ()=>{
        d.copy();
        b.classList.add("done"); b.querySelector(".ms").textContent="check";
        setTimeout(()=>{ b.classList.remove("done"); b.querySelector(".ms").textContent="content_copy"; }, 1400);
      });
      r.appendChild(b);
    }
    if(isAdmin()){
      const e=el("button","etx-copy"); e.type="button";
      e.innerHTML='<span class="ms" aria-hidden="true">'+(d?"edit":"add")+'</span>'+(d?"Edit":"Add");
      e.setAttribute("aria-label",(d?"Edit ":"Add ")+p.name+"'s "+o.what);
      e.addEventListener("click", ()=> o.edit(p.uid, p.name) );
      r.appendChild(e);
    }
    return r;
  };
  const section=(label, list, cls)=>{
    if(!list.length) return;
    const box=el("div","ix-section");
    box.appendChild(el("div","ix-group-lab", label));
    const c=el("div","card etxlist "+cls);
    list.forEach(p=> c.appendChild(row(p, o.detail(p.uid))) );
    box.appendChild(c);
    wrap.appendChild(box);
  };
  section("Ready to pay", ready, "ix-ready");
  section("Not set up yet", pending, "ix-pending");
  main.appendChild(wrap);

  if(find){
    const input=find.querySelector("input");
    input.addEventListener("input", ()=>{
      const q=input.value.trim().toLowerCase();
      [].forEach.call(wrap.querySelectorAll(".ix-section"), sec=>{
        let shown=0;
        [].forEach.call(sec.querySelectorAll(".ix-person"), r=>{
          const hit=!q || r.dataset.q.indexOf(q)>-1; r.hidden=!hit; if(hit) shown++;
        });
        sec.hidden = !shown;
      });
    });
  }
}

/* ---------- UPI ----------
   The Pay page for India: your UPI ID on a card, the app Pay opens, how
   paying works, and everybody else's UPI ID ready to copy. */
let UPI_EDIT = false, UPI_INFO = false;
function viewUpi(main, enter){
  const mine = upiFor(USER.uid);
  const raw = (DIRECTORY[USER.uid] && DIRECTORY[USER.uid].upi) || {};
  const app = myUpiApp();
  const editing = UPI_EDIT || !mine;

  // ---- your card ----
  const hero=el("div","ix-hero"+(enter?" enter":""));
  const card=el("div","ix-card upi-card"+(mine?"":" blank"));
  card.innerHTML=
    '<div class="ix-card-top"><span class="ix-brand">UPI · India</span>'+
      '<span class="ms" aria-hidden="true">qr_code_2</span></div>'+
    '<div class="ix-chipset"><span class="upi-rupee" aria-hidden="true">₹</span>'+
      (app ? '<span class="ix-bankname">'+esc(app.name)+'</span>' : '')+'</div>'+
    (mine
      ? '<div class="ix-handle">'+esc(mine.vpa)+'</div><div class="ix-holder">'+esc(mine.name)+'</div>'
      : '<div class="ix-handle ph">yourname@okaxis</div>'+
        '<div class="ix-holder">Add your UPI ID so people can pay you back</div>');
  hero.appendChild(card);
  if(mine){
    const acts=el("div","ix-card-acts");
    acts.innerHTML=
      '<button class="ix-act" id="upCopy" type="button"><span class="ms" aria-hidden="true">content_copy</span>Copy</button>'+
      '<button class="ix-act" id="upQr" type="button"><span class="ms" aria-hidden="true">qr_code_2</span>My QR</button>'+
      '<button class="ix-act" id="upEdit" type="button"><span class="ms" aria-hidden="true">'+(UPI_EDIT?"close":"edit")+'</span>'+
        (UPI_EDIT?"Close":"Edit")+'</button>';
    hero.appendChild(acts);
  }
  main.appendChild(hero);
  ixTilt(card);
  if($("upCopy")) $("upCopy").addEventListener("click", ()=> etxCopy(mine.vpa, "Your UPI ID") );
  if($("upQr")) $("upQr").addEventListener("click", ()=> sheetMyUpiQr(mine) );
  if($("upEdit")) $("upEdit").addEventListener("click", ()=>{ UPI_EDIT=!UPI_EDIT; render(); });

  // ---- the form, only while editing or before anything is saved ----
  if(editing){
    const f=el("div","card pad ix-form");
    f.innerHTML=
      '<div class="ix-form-h"><span class="ms" aria-hidden="true">'+(mine ? "edit_note" : "badge")+'</span>'+
        '<div><b>'+(mine ? "Edit your UPI details" : "Add your UPI ID")+'</b>'+
        '<small>So friends can pay you back in rupees, in a tap.</small></div></div>'+
      '<div class="field"><label for="upName">Name on your bank account</label>'+
        '<input id="upName" type="text" autocomplete="name" maxlength="60" placeholder="'+esc(USER.name||"")+'"></div>'+
      '<div class="field"><label for="upVpa">UPI ID</label>'+
        '<input id="upVpa" type="text" inputmode="email" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="120" '+
        'placeholder="yourname@okaxis"></div>'+
      '<p class="ix-note"><span class="ms" aria-hidden="true">info</span>It’s on your profile in GPay, PhonePe or Paytm, shaped like name@bank.</p>'+
      '<p class="ix-note"><span class="ms" aria-hidden="true">lock</span>Only people approved into Settle can see it. Never share your UPI PIN.</p>'+
      '<div class="etx-actions"><button class="btn p" id="upSave" type="button">'+(mine?"Save changes":"Save UPI ID")+'</button>'+
        (mine ? '<button class="btn s" id="upClear" type="button">Remove</button>' : '')+'</div>';
    main.appendChild(f);
    $("upName").value = (mine&&mine.name) || tidyName(raw.name||"") || "";
    $("upVpa").value = (mine&&mine.vpa) || String(raw.vpa||"");
    $("upSave").addEventListener("click", ()=>{
      const rec=upiRecord($("upName").value, $("upVpa").value);
      if(typeof rec==="string") return toast(rec);
      $("upSave").disabled=true;
      updStrict("directory/"+USER.uid, {upi:rec}).then(()=>{
        DIRECTORY[USER.uid]=Object.assign({}, DIRECTORY[USER.uid]||{}, {upi:rec});
        UPI_EDIT=false; IX_SEEN=false;          // let the card sweep in with the new details
        toast("UPI ID saved"); render();
      }, e=>{ $("upSave").disabled=false; toast(writeError(e)); });
    });
    if($("upClear")) $("upClear").addEventListener("click", ()=>{
      updStrict("directory/"+USER.uid, {upi:null}).then(()=>{
        if(DIRECTORY[USER.uid]) delete DIRECTORY[USER.uid].upi;
        UPI_EDIT=false; toast("UPI ID removed"); render();
      }, e=> toast(writeError(e)) );
    });
  }

  // ---- your UPI app ----
  main.appendChild(ixHead("smartphone", "Your UPI app", app ? app.name : "Any app", app ? "good" : ""));
  const panel=el("div","ix-panel");
  const apps=el("div","ix-banks");
  const cur=(PREFS&&PREFS.upiApp)||"";
  UPI_APPS.concat([{id:"", name:"Any app"}]).forEach(a=>{
    const on=a.id===cur;
    const t=el("button","ix-bank"+(on?" on":"")); t.type="button";
    t.style.setProperty("--bk", a.tint || "var(--ink-3)");
    t.setAttribute("aria-pressed", on ? "true" : "false");
    t.innerHTML=
      '<span class="ix-mono">'+(a.id ? esc(a.mono) : '<span class="ms" aria-hidden="true">apps</span>')+'</span>'+
      '<span class="ix-bank-n">'+esc(a.name)+'</span>'+
      (on ? '<span class="ix-tick ms" aria-hidden="true">check_circle</span>' : '');
    t.addEventListener("click", ()=>{
      PREFS=PREFS||{}; PREFS.upiApp=a.id;
      set("users/"+USER.uid+"/prefs/upiApp", a.id||null);
      render();
    });
    apps.appendChild(t);
  });
  panel.appendChild(apps);
  const info=el("details","ix-info");
  info.innerHTML='<summary><span class="ms" aria-hidden="true">info</span>How Pay opens your UPI app'+
      '<span class="ms chev" aria-hidden="true">expand_more</span></summary>'+
    '<p>Pay opens this app with the UPI ID, name and amount already filled in. You check them and enter your UPI PIN '+
    'there - Settle never sees it. Some apps limit link payments to personal UPI IDs; if yours does, scan the QR code '+
    'or copy the UPI ID instead. On a computer, scan the QR code with your phone.</p>';
  info.open=UPI_INFO;
  info.addEventListener("toggle", ()=>{ UPI_INFO=info.open; });
  panel.appendChild(info);
  main.appendChild(panel);

  // ---- how paying works ----
  main.appendChild(ixHead("route", "How paying works"));
  const howPanel=el("div","ix-panel");
  const how=el("div","ix-how");
  how.innerHTML=[["payments","Tap Pay","on anything you owe"],
                 ["bolt","Pay in your app","amount filled in"],
                 ["task_alt","Record it","back in Settle"]].map((st,i)=>
    '<div class="ix-step"><span class="ix-step-ic"><span class="ms" aria-hidden="true">'+st[0]+'</span><i>'+(i+1)+'</i></span>'+
      '<b>'+st[1]+'</b><small>'+st[2]+'</small></div>').join('<span class="ix-step-line" aria-hidden="true"></span>');
  howPanel.appendChild(how);
  main.appendChild(howPanel);

  // ---- everybody else ----
  ixPeople(main, enter, {
    what: "UPI ID", none: "No UPI ID yet",
    empty: "When people in your groups add their UPI ID, they show up here, ready to copy.",
    edit: sheetUpiFor,
    detail: (uid)=>{ const d=upiFor(uid); return d && {id:d.vpa, name:d.name, what:"UPI ID", copy: ()=> etxCopy(d.vpa, "UPI ID")}; }
  });
}

/* My own UPI QR, with no amount in it, for somebody standing beside me. */
function sheetMyUpiQr(d){
  openSheet("Your UPI QR code", (b)=>{
    b.innerHTML='<p class="lead">Anyone can scan this with GPay, PhonePe, Paytm or any UPI app to pay '+esc(d.name)+'.</p>'+
      '<div class="upi-qr big"><div class="upi-qr-code" id="myUpiQr" role="img" aria-label="Your UPI QR code"></div>'+
      '<p><b>'+esc(d.vpa)+'</b></p></div>';
    qrInto($("myUpiQr"), "upi://pay?"+upiQuery(d, 0, ""));
  });
}

/* The administrator filling in somebody else's UPI ID - the same arrangement
   as Interac: the rules let the administrator write only this part of
   another person's entry, and check its shape. */
function sheetUpiFor(uid, name){
  if(!isAdmin() || !uid) return;
  const raw=(DIRECTORY[uid]&&DIRECTORY[uid].upi)||{};
  const cur=upiClean(raw);
  openSheet("UPI for "+name, (b)=>{
    b.innerHTML=
      '<p class="lead">As the administrator you can fill this in for '+esc(name)+
        '. They can still change it in their own Pay tab.</p>'+
      '<div class="field"><label for="auName">Name on their bank account</label>'+
        '<input id="auName" type="text" maxlength="60" autocomplete="off"></div>'+
      '<div class="field"><label for="auVpa">Their UPI ID</label>'+
        '<input id="auVpa" type="text" inputmode="email" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="120" '+
        'autocomplete="off" placeholder="name@okaxis"></div>'+
      '<button class="btn p wide" id="auSave" type="button">Save UPI ID</button>'+
      (cur ? '<button class="btn s wide" id="auDel" type="button" style="margin-top:10px">Remove their UPI ID</button>' : '');
    $("auName").value = (cur&&cur.name) || tidyName(raw.name||"") || name;
    $("auVpa").value = (cur&&cur.vpa) || String(raw.vpa||"");
    const failed = (e)=> toast(writeError(e));
    $("auSave").addEventListener("click", ()=>{
      const rec=upiRecord($("auName").value, $("auVpa").value);
      if(typeof rec==="string") return toast(rec);
      rec.by=USER.uid;
      $("auSave").disabled=true;
      updStrict("directory/"+uid, {upi:rec}).then(()=>{
        DIRECTORY[uid]=Object.assign({}, DIRECTORY[uid]||{}, {upi:rec});
        closeSheet(); toast(name+"'s UPI ID saved"); render();
      }, (e)=>{ $("auSave").disabled=false; failed(e); });
    });
    if($("auDel")) $("auDel").addEventListener("click", ()=>{
      updStrict("directory/"+uid, {upi:null}).then(()=>{
        if(DIRECTORY[uid]) delete DIRECTORY[uid].upi;
        closeSheet(); toast(name+"'s UPI ID removed"); render();
      }, failed);
    });
  });
}

function viewAccount(main){
  setTitle(main, "Account");
  const c=el("div","card");
  const me=el("div","row"); me.style.cursor="default";
  me.innerHTML=avatarHTML("lg", USER.name, "var(--tint)", USER.photo)+
    '<span class="body"><span class="t1" style="font-size:17px">'+esc(USER.name)+
      (isAdmin()?' <span class="tag admin">admin</span>':'')+'</span>'+
    '<span class="t2">'+esc(USER.email)+'</span></span>';
  c.appendChild(me);
  main.appendChild(c);

  main.appendChild(el("div","sechead","Totals on the "+SIDES[SIDE].name+" side"));
  // Per currency, never added across rupees and dollars.
  const netB={}, spentB={};
  joinedHere().forEach(g=>{
    const v=myBalance(g.id); if(Math.abs(v)>0.004) curAdd(netB, g.id, v);
    const n=meIn(g.id);
    if(n) expensesOf(g.id).forEach(e=>{ const sh=sharesOf(e); if(sh[n]) curAdd(spentB, g.id, sh[n]); });
  });
  const t=el("div","card pad");
  const tone=bagTone(netB), many=curKeys(netB).length>1 || curKeys(spentB).length>1;
  t.innerHTML='<div class="split'+(many?' multi':'')+'" style="margin:0"><div><div class="k">Your share of everything</div>'+
    '<div class="v">'+esc(moneyMulti(spentB))+'</div></div>'+
    '<div><div class="k">'+(tone==="pos"?"You are owed":tone==="neg"?"You owe":tone==="mix"?"Where you stand":"All square")+'</div>'+
    '<div class="v '+(tone==="pos"||tone==="neg"?tone:"")+'">'+esc(tone==="mix" ? moneySigned(netB) : moneyMulti(netB))+'</div></div></div>';
  main.appendChild(t);

  if(isAdmin()){
    main.appendChild(el("div","sechead","Administration"));
    const a=el("div","card");
    const r=el("button","row");
    r.innerHTML='<span class="cat teal"><span class="ms" aria-hidden="true">shield_person</span></span>'+
      '<span class="body"><span class="t1">Every group</span>'+
      '<span class="t2">Open, edit or delete any group in this app</span></span>'+
      '<span class="right"><span class="ms" aria-hidden="true" style="color:var(--label-3)">chevron_right</span></span>';
    r.addEventListener("click", ()=>{ ADMIN_VIEW=true; window.scrollTo(0,0); render(); });
    a.appendChild(r);

    const online=Object.keys(PRESENCE||{}).filter(u=>PRESENCE[u]&&PRESENCE[u].online).length;
    const pr=el("button","row");
    pr.innerHTML='<span class="cat'+(online?" teal":"")+'"><span class="ms" aria-hidden="true">bolt</span></span>'+
      '<span class="body"><span class="t1">Team Pulse</span>'+
      '<span class="t2">Who has Settle open, and who last did</span></span>'+
      '<span class="right">'+(online?'<span class="tag on">'+online+' online</span>':
        '<span class="ms" aria-hidden="true" style="color:var(--label-3)">chevron_right</span>')+'</span>';
    pr.addEventListener("click", ()=>{ ADMIN_PEOPLE=true; window.scrollTo(0,0); render(); });
    a.appendChild(pr);

    const anr=el("button","row");
    anr.innerHTML='<span class="cat teal"><span class="ms" aria-hidden="true">campaign</span></span>'+
      '<span class="body"><span class="t1">Send an announcement</span>'+
      '<span class="t2">Blocks their screen until they acknowledge it</span></span>'+
      '<span class="right"><span class="ms" aria-hidden="true" style="color:var(--label-3)">chevron_right</span></span>';
    anr.addEventListener("click", sheetAnnounce);
    a.appendChild(anr);

    const sr=el("button","row");
    sr.innerHTML='<span class="cat teal"><span class="ms" aria-hidden="true">schedule</span></span>'+
      '<span class="body"><span class="t1">Reminder schedule</span>'+
      '<span class="t2">'+esc(schedLine())+'</span></span>'+
      '<span class="right"><span class="ms" aria-hidden="true" style="color:var(--label-3)">chevron_right</span></span>';
    sr.addEventListener("click", sheetSchedule);
    a.appendChild(sr);

    // The email link is the quick path, but it expires and it can be missed.
    // This is the one that is always there.
    const waiting = Object.keys(REQUESTS).filter(u=>REQUESTS[u] && REQUESTS[u].status==="pending").length;
    const qr=el("button","row");
    qr.innerHTML='<span class="cat'+(waiting?" warn":" teal")+'"><span class="ms" aria-hidden="true">how_to_reg</span></span>'+
      '<span class="body"><span class="t1">Requests to join</span>'+
      '<span class="t2">'+(waiting ? waiting+" waiting for you" : "Nobody is waiting")+'</span></span>'+
      '<span class="right">'+(waiting?'<span class="tag warn">'+waiting+'</span>':
        '<span class="ms" aria-hidden="true" style="color:var(--label-3)">chevron_right</span>')+'</span>';
    qr.addEventListener("click", sheetRequests);
    a.appendChild(qr);

    main.appendChild(a);
  }

  // ---- how it looks ----
  main.appendChild(el("div","sechead","Appearance"));
  const tc = el("div","card");
  const tg = el("div","themes");
  THEMES.forEach(t=>{
    const b = el("button","theme");
    b.type = "button";
    b.setAttribute("aria-pressed", t.k===THEME ? "true" : "false");
    b.innerHTML =
      '<span class="swatch">'+t.sw.map(c=>'<i style="background:'+c+'"></i>').join("")+'</span>'+
      '<span class="n">'+esc(t.n)+'</span>'+
      '<span class="m">'+esc(t.m)+'</span>';
    b.addEventListener("click", ()=>{
      if(t.k===THEME) return;
      applyTheme(t.k);
      // On the account as well as on this device, so it follows you.
      if(remote && USER) savePrefs({theme: t.k});
      render();
      toast(t.n+" it is");
    });
    tg.appendChild(b);
  });
  tc.appendChild(tg);
  main.appendChild(tc);

  main.appendChild(el("div","sechead","Notifications"));
  const nc=el("div","card");
  const nrow=el("button","row");
  const weeklyOn = prefOn("weekly", true);
  nrow.innerHTML='<span class="cat'+(weeklyOn?" teal":"")+'"><span class="ms" aria-hidden="true">'+
    (weeklyOn?"notifications_active":"notifications_off")+'</span></span>'+
    '<span class="body"><span class="t1">Email reminders</span>'+
    '<span class="t2">'+(weeklyOn
      ? esc(schedLine())+" · "+esc(((PREFS.tz)||guessTz()).replace(/_/g," "))
      : "Weekly reminder is off for you")+'</span></span>'+
    '<span class="right"><span class="ms" aria-hidden="true" style="color:var(--label-3)">chevron_right</span></span>';
  nrow.addEventListener("click", sheetNotifications);
  nc.appendChild(nrow);
  pushAccountRow(nc);
  main.appendChild(nc);

  main.appendChild(el("div","sechead","App"));
  const c2=el("div","card");
  const off=el("div","row"); off.style.cursor="default";
  off.innerHTML='<span class="cat"><span class="ms" aria-hidden="true">cloud_done</span></span>'+
    '<span class="body"><span class="t1">Works offline</span>'+
    '<span class="t2">Open it with no signal. Anything you add syncs when you reconnect.</span></span>';
  c2.appendChild(off);
  // Which release this is. Updates arrive by themselves; this shows they have.
  const ver=el("div","row"); ver.style.cursor="default";
  ver.innerHTML='<span class="cat"><span class="ms" aria-hidden="true">system_update</span></span>'+
    '<span class="body"><span class="t1">Always up to date</span>'+
    '<span class="t2">Version '+esc(buildLabel())+' · new versions install by themselves</span></span>';
  c2.appendChild(ver);
  const out=el("button","row");
  out.innerHTML='<span class="cat"><span class="ms" aria-hidden="true">logout</span></span>'+
    '<span class="body"><span class="t1">Sign out</span>'+
    '<span class="t2">'+esc(USER.email)+'</span></span>';
  out.addEventListener("click", signOutNow);
  c2.appendChild(out);
  main.appendChild(c2);
}

/* ---------- admin: every group ---------- */
function viewAdmin(main){
  setTitle(main, "Every group");
  $("backBtn").hidden=false;
  const all=ADMIN_GROUPS;
  if(all===null){
    main.appendChild(el("div","empty",'<span class="ms" aria-hidden="true">hourglass_top</span><h3>Loading…</h3>'));
    return;
  }
  const keys=Object.keys(all);
  if(!keys.length){
    main.appendChild(el("div","empty",
      '<span class="ms" aria-hidden="true">shield_person</span><h3>Nothing to show</h3>'+
      '<p>Either there are no groups yet, or the database rules do not grant this account '+
      'admin read access. Check that the rules name ' + esc(ADMIN_EMAIL) + '.</p>'));
    return;
  }
  main.appendChild(el("div","sechead", keys.length+" group"+(keys.length===1?"":"s")+" in the database"));
  const card=el("div","card");
  keys.sort((a,b)=>{
    const an=(all[a].meta&&all[a].meta.name)||a, bn=(all[b].meta&&all[b].meta.name)||b;
    return an.localeCompare(bn);
  }).forEach(gid=>{
    const g=all[gid]||{};
    const ex=Object.keys(g.expenses||{}).length, pp=Object.keys(g.people||{}).length;
    let tot=0; Object.values(g.expenses||{}).forEach(e=> tot+=Number(e.amount)||0 );
    const mine=JOINED.some(j=>j.id===gid);
    const r=el("button","row");
    r.innerHTML='<span class="cat"><span class="ms" aria-hidden="true">'+
        ((g.meta&&g.meta.type==="home")?"home":(g.meta&&g.meta.type==="couple")?"favorite":"luggage")+'</span></span>'+
      '<span class="body"><span class="t1">'+esc((g.meta&&g.meta.name)||gid)+
        (mine?' <span class="tag on">joined</span>':'')+'</span>'+
      '<span class="t2">'+pp+(pp===1?' person':' people')+' · '+ex+' expense'+(ex===1?"":"s")+' · '+esc(gid)+'</span></span>'+
      '<span class="right"><span class="amt">'+money(tot)+'</span></span>';
    r.addEventListener("click", ()=>{
      DATA[gid]=g;
      if(!mine) rememberGroup(gid, (g.meta&&g.meta.name)||gid);
      ADMIN_VIEW=false; openGroup(gid);
    });
    card.appendChild(r);
  });
  main.appendChild(card);
  const note=el("p","fine");
  note.style.cssText="text-align:center;color:var(--label-3);font-size:12px;margin:16px 4px";
  note.textContent="Opening a group here adds it to your own list so you can work in it.";
  main.appendChild(note);
}

/* ---------- admin: Team Pulse ----------
   Everybody Settle has ever heard of - from the directory, from users/*, and
   from presence itself - so somebody who signed in before presence existed
   still shows up, going by the last time their profile was written (which
   happens on every sign-in) rather than vanishing from the list entirely. */
function adminPeopleList(){
  const seen={};
  Object.keys(DIRECTORY||{}).forEach(u=> seen[u]=1);
  Object.keys(ALLUSERS||{}).forEach(u=> seen[u]=1);
  Object.keys(PRESENCE||{}).forEach(u=> seen[u]=1);
  return Object.keys(seen).map(uid=>{
    const d=DIRECTORY[uid]||{}, prof=(ALLUSERS[uid]&&ALLUSERS[uid].profile)||{};
    const p=PRESENCE[uid];
    const online=!!(p && p.online===true);
    const at = p ? (Number(p.at)||0) : (Number(prof.at)||0);
    return { uid, name:d.name||prof.name||"Someone", email:d.email||prof.email||"",
             photo:d.photo||prof.photo||null, online, at, isMe: !!(USER && uid===USER.uid) };
  }).sort((a,b)=> (b.online-a.online) || (b.at-a.at) || a.name.localeCompare(b.name));
}
function viewAdminPeople(main){
  setTitle(main, "Team Pulse");
  $("backBtn").hidden=false;
  const people=adminPeopleList();
  const online=people.filter(p=>p.online);
  const dayAgo=Date.now()-864e5;
  const activeToday=people.filter(p=> p.online || p.at>dayAgo).length;

  const hero=el("div","tp-hero");
  hero.innerHTML=
    '<div class="tp-stat tp-on"><b>'+online.length+'</b><span>Online now</span></div>'+
    '<div class="tp-stat"><b>'+activeToday+'</b><span>Active today</span></div>'+
    '<div class="tp-stat"><b>'+people.length+'</b><span>People in Settle</span></div>';
  main.appendChild(hero);

  main.appendChild(el("div","sechead","Here right now"));
  const strip=el("div","tp-strip");
  if(!online.length){
    strip.innerHTML='<p class="tp-empty"><span class="ms" aria-hidden="true">bedtime</span>Nobody else is around right now.</p>';
  } else {
    online.forEach(p=>{
      const f=el("div","tp-face");
      f.innerHTML='<span class="tp-ring">'+avatarHTML("lg", p.name, "#8e99a6", p.photo, p.uid)+'</span>'+
        '<span>'+esc((p.name||"").split(" ")[0])+(p.isMe?" (you)":"")+'</span>';
      strip.appendChild(f);
    });
  }
  main.appendChild(strip);

  main.appendChild(el("div","sechead", people.length+" "+(people.length===1?"person":"people")+" total"));
  if(!people.length){
    main.appendChild(el("div","empty",
      '<span class="ms" aria-hidden="true">bolt</span><h3>Nobody yet</h3>'+
      '<p>Presence fills in once people open Settle with the rules published.</p>'));
    return;
  }
  const card=el("div","card tp-list");
  people.forEach(p=>{
    const r=el("div","row"); r.style.cursor="default";
    const fresh = p.at && (Date.now()-p.at < 864e5);
    const pillText = p.online ? "Online now" : p.at ? "Last seen "+arrAgo(p.at) : "Never opened it";
    const pillCls = p.online ? "on" : fresh ? "warm" : "";
    r.innerHTML=avatarHTML("", p.name, "#8e99a6", p.photo, p.uid)+
      '<span class="body"><span class="t1">'+esc(p.name)+(p.isMe?' <span class="tag on">you</span>':'')+'</span>'+
      '<span class="t2">'+esc(p.email||"no email on file")+'</span></span>'+
      '<span class="right"><span class="tp-pill '+pillCls+'">'+esc(pillText)+'</span></span>';
    card.appendChild(r);
  });
  main.appendChild(card);
  const note=el("p","fine");
  note.style.cssText="text-align:center;color:var(--label-3);font-size:12px;margin:16px 4px";
  note.textContent="Online means Settle is open for them right now, worked out the moment their connection drops - not a guess.";
  main.appendChild(note);
}
