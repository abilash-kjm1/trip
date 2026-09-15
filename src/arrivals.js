/* ======================= DID THE MONEY ARRIVE? =======================
   Recording a payment is the payer's word. The person it went to is asked,
   on their own phone, to check their bank and say whether it landed:

     payments/{k}.ask  true          - set when the payment is recorded
     payments/{k}.got  {ok, at, uid, name}
                                     - written by the receiver: ok true when
                                       it arrived, false when it has not

   The ask arrives as a slip that drops from the top of the screen and stays
   until they answer. "Not yet" puts it away for a few hours on this device
   and writes nothing. The payer hears back either way: a short note when it
   is confirmed, and a slip of their own when it has not arrived.

   Balances do not wait for the answer. The payer's record still counts, as
   it always has; this adds a second pair of eyes, not a second gate.
   Payments from before this existed carry no `ask` and are never asked
   about, and nobody is asked about money netted across groups, because none
   moved. */

const ARR_SNOOZE_KEY = "settle.arrive.snooze.v1";   // "gid/k" -> ask again after
const ARR_SEEN_KEY   = "settle.arrive.seen.v1";     // "gid/k@at" -> when it was seen
const ARR_SNOOZE_MS  = 3 * 3600e3;
const ARR_NEWS_DAYS  = 14;
let ARR = null;                                     // {id, kind, node, busy}

// A little bookkeeping for the two lists on the device, pruned as it goes.
// Held in memory as well, so a browser that refuses storage (a private
// window) still does not ask the same question again straight after "Not yet".
const ARR_MEM = {};
function arrMap(key){
  const m=lsGet(key, {});
  return Object.assign({}, ARR_MEM[key]||{}, (m && typeof m==="object") ? m : {});
}
function arrKeep(key, id, value, maxAge){
  const m=arrMap(key), now=Date.now();
  Object.keys(m).forEach(k=>{ if(!(Number(m[k]) > now - maxAge)) delete m[k]; });
  m[id]=value; ARR_MEM[key]=m; lsSet(key, m);
}

/* Where a payment stands, from where I am sitting. Null when there is nothing
   to say: an old payment, money netted across groups, or a name with no
   account behind it, who could never be asked. */
function payState(p, gid){
  if(!p || p.netted) return null;
  const me = meIn(gid), toMe = !!me && p.to===me;
  const who = toMe ? "you" : p.to;
  if(p.got && p.got.ok===true)  return {k:"ok",   i:"verified",   t: toMe ? "You confirmed it" : p.to+" got it"};
  if(p.got && p.got.ok===false) return {k:"no",   i:"error",      t: toMe ? "You said it hasn't arrived" : "Not arrived yet"};
  if(!p.ask) return null;
  const m = memberOf(p.to, gid);
  if(!m || !m.uid) return null;
  if(p.later && Number(p.later.until) > Date.now())
    return {k:"wait", i:"snooze", t:(toMe ? "You’ll check " : p.to+" will check ")+arrWhen(p.later.until)};
  return {k:"wait", i:"schedule", t:"Waiting for "+who};
}
function payStateHTML(p, gid){
  const s=payState(p, gid);
  return s ? '<span class="pst '+s.k+'"><span class="ms" aria-hidden="true">'+s.i+'</span>'+esc(s.t)+'</span>' : '';
}

// Payments waiting on me to say whether they arrived, oldest first.
function arrivalsDue(){
  if(!USER) return [];
  const snooze=arrMap(ARR_SNOOZE_KEY), now=Date.now(), out=[];
  joinedHere().forEach(g=>{
    const me=meIn(g.id); if(!me) return;
    paymentsOf(g.id).forEach(p=>{
      if(!p.ask || p.netted || p.got || p.to!==me || p.from===me) return;
      if(p.byUid && p.byUid===USER.uid) return;          // the admin recording their own
      // Put off with "Not yet" - on whichever of my devices it was.
      if(p.later && p.later.uid===USER.uid && Number(p.later.until) > now) return;
      const id=g.id+"/"+p.k;
      if((Number(snooze[id])||0) > now) return;
      out.push({id, gid:g.id, p});
    });
  });
  return out.sort((a,b)=> (Number(a.p.at)||0) - (Number(b.p.at)||0));
}

// Answers to payments I recorded that I have not seen yet.
function arrivalsNews(){
  if(!USER) return [];
  const seen=arrMap(ARR_SEEN_KEY), now=Date.now(), out=[];
  joinedHere().forEach(g=> paymentsOf(g.id).forEach(p=>{
    if(!p.got || p.netted || p.byUid!==USER.uid) return;
    const at=Number(p.got.at)||0;
    if(now - at > ARR_NEWS_DAYS*864e5) return;
    const id=g.id+"/"+p.k+"@"+at;
    if(seen[id]) return;
    out.push({id, gid:g.id, p, kind: p.got.ok ? "ok" : "no"});
  }));
  // The ones that need doing something about come first.
  return out.sort((a,b)=> (a.kind==="no"?0:1)-(b.kind==="no"?0:1) || (Number(a.p.got.at)||0)-(Number(b.p.got.at)||0));
}

/* Called at the end of every render. Cheap when nothing has changed: the slip
   on screen is left alone - no restarted animation, no lost focus - unless
   what it is showing has been answered somewhere else. */
function arrivals(){
  if(!USER || !mayUse()){ arrClose(true); return; }
  arrWake();
  if(ARR && ARR.busy) return;
  const due=arrivalsDue();
  if(due.length){
    if(ARR && ARR.kind==="in" && ARR.id===due[0].id){ arrCount(due.length); return; }
    arrClose(true); arrIncoming(due[0], due.length); return;
  }
  // A "got it" note is marked seen the moment it shows, so it is no longer on
  // the list - it goes by itself, and asks for the next one when it does.
  if(ARR && ARR.kind==="ok") return;
  const news=arrivalsNews();
  if(news.length){
    const n=news[0];
    if(ARR && ARR.id===n.id) return;
    arrClose(true);
    if(n.kind==="ok") arrConfirmed(n); else arrNotArrived(n);
    return;
  }
  if(ARR) arrClose();
}

function arrClose(now){
  if(!ARR) return;
  const node=ARR.node; ARR=null;
  if(now){ node.remove(); return; }
  node.classList.add("out");
  setTimeout(()=> node.remove(), 420);
}
// Put away this slip - and only this one. By the time a save comes back the
// redraw it caused may already have put the next slip up, which must stay.
function arrDone(node){
  if(ARR && ARR.node===node) arrClose();
  else if(node.isConnected){ node.classList.add("out"); setTimeout(()=> node.remove(), 420); }
  setTimeout(arrivals, 460);
}
function arrCount(n){
  if(!ARR || !ARR.node) return;
  const c=ARR.node.querySelector(".arr-count");
  if(c){ c.hidden = n<2; c.textContent = "1 of "+n; }
}

// A face: their picture, or initials on their colour.
function arrFace(name, gid, cls){
  const m=memberOf(name, gid);
  const bg=(m && m.color) || colorOf(name, gid);
  return m && m.photo
    ? '<span class="arr-av '+(cls||"")+'"><img src="'+esc(m.photo)+'" alt="" referrerpolicy="no-referrer"></span>'
    : '<span class="arr-av '+(cls||"")+'" style="background:'+esc(bg)+'">'+esc(initials(name))+'</span>';
}
/* When "Not yet" can bring the question back: in five minutes; in an hour;
   this evening - or in three hours once the evening is close - and the next
   morning. */
const arrClock = (ts)=> new Date(ts).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
function arrTimes(now){
  const out=[{i:"timer", t:"In 5 minutes", u:now+5*60e3}, {i:"schedule", t:"In 1 hour", u:now+3600e3}];
  const eve=new Date(now); eve.setHours(19,0,0,0);
  if(eve.getTime()-now >= 2*3600e3) out.push({i:"wb_twilight", t:"This evening", u:eve.getTime()});
  else out.push({i:"hourglass_top", t:"In 3 hours", u:now+3*3600e3});
  const morn=new Date(now); if(morn.getHours()>=6) morn.setDate(morn.getDate()+1); morn.setHours(9,0,0,0);
  out.push({i:"wb_sunny", t: dayKey(morn.getTime())===dayKey(now) ? "This morning" : "Tomorrow morning", u:morn.getTime()});
  return out.map(o=> Object.assign(o, {s: arrClock(o.u)}));
}
// "at 7:00 PM", "tomorrow at 9:00 AM", or a date further out.
function arrWhen(ts){
  if(dayKey(ts)===dayKey(Date.now())) return "at "+arrClock(ts);
  if(dayKey(ts)===dayKey(Date.now()+864e5)) return "tomorrow at "+arrClock(ts);
  return "on "+fmtDate(ts)+" at "+arrClock(ts);
}
/* Something put off comes back by itself when its time comes - even if nothing
   else changes on screen meanwhile - and as soon as the app is looked at again
   after that. */
let ARR_WAKE=null;
function arrWake(){
  clearTimeout(ARR_WAKE);
  if(!USER) return;
  const now=Date.now(); let next=0;
  const soon=(u)=>{ u=Number(u); if(u>now && (!next || u<next)) next=u; };
  JOINED.forEach(g=>{
    const me=meIn(g.id); if(!me) return;
    paymentsOf(g.id).forEach(p=>{ if(!p.got && p.to===me && p.later && p.later.uid===USER.uid) soon(p.later.until); });
  });
  const sn=arrMap(ARR_SNOOZE_KEY); Object.keys(sn).forEach(k=> soon(sn[k]));
  if(next) ARR_WAKE=setTimeout(()=>{ if(!document.hidden) render(); }, Math.min(next-now+1500, 2147483000));
}
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && USER && mayUse()) render(); });
function arrAgo(ts){
  const s=Math.max(0, (Date.now()-(Number(ts)||0))/1000);
  if(s < 60) return "just now";
  if(s < 3600) return Math.round(s/60)+" min ago";
  if(s < 86400) return Math.round(s/3600)+" h ago";
  return fmtDate(ts);
}

/* A soft two-note knock when a slip arrives. Browsers only play sound after
   the page has been touched, so on a fresh open this is silent - which is
   the right way round for something that appears unasked. */
function arrKnock(){
  try{ SFX.knock(); }catch(e){}
  try{ if(navigator.vibrate) navigator.vibrate([10, 90, 10]); }catch(e){}
}

/* ---------- the receiver: did it land? ---------- */
function arrIncoming(item, total){
  const {gid, p}=item, amt=Number(p.amount)||0, me=meIn(gid);
  // Rupees land in an Indian account, not the Canadian bank app picked for Interac.
  const bank=curOf(gid)==="INR" ? null : myBank(), bankHref=bank && etxBankLink(bank);
  const node=el("div","arr");
  node.innerHTML=
    '<div class="arr-scrim" aria-hidden="true"></div>'+
    '<div class="arr-hold">'+
    '<div class="arr-slip" role="alertdialog" aria-modal="true" aria-labelledby="arrQ" aria-describedby="arrWhat">'+
      '<div class="arr-top">'+
        '<div class="arr-eyebrow"><span class="arr-ping" aria-hidden="true"></span>'+
          '<span class="arr-grp">'+esc(groupName(gid))+'</span>'+
          '<span class="arr-count"'+(total<2?' hidden':'')+'>1 of '+total+'</span></div>'+
        '<div class="arr-flow" aria-hidden="true">'+arrFace(p.from, gid)+
          '<span class="arr-track"><i></i><i></i><i></i></span>'+arrFace(me, gid, "me")+'</div>'+
        '<div class="arr-amt">'+esc(money(amt, gid))+'</div>'+
        '<p class="arr-what" id="arrWhat"><b>'+esc(p.from)+'</b> says this is on its way to you'+
          ' <span class="arr-dot">·</span> '+esc(arrAgo(p.at))+
          (p.note ? '<span class="arr-note">“'+esc(String(p.note).slice(0,60))+'”</span>' : '')+'</p>'+
        '<div class="arr-stamp" aria-hidden="true"><span>Received</span></div>'+
      '</div>'+
      '<div class="arr-stub">'+
        '<div class="arr-ask">'+
          '<h2 id="arrQ">Did it reach your bank?</h2>'+
          '<p>Check your account first, then tell '+esc(p.from)+'.</p>'+
          (bankHref ? '<a class="arr-bank" href="'+esc(bankHref)+'" target="_blank" rel="noopener">'+
                        '<span class="ms" aria-hidden="true">account_balance</span>Open '+esc(bank.name)+'</a>' : '')+
          '<div class="arr-acts">'+
            '<button class="arr-yes" type="button"><span class="ms" aria-hidden="true">check</span>Yes, it’s in</button>'+
            '<button class="arr-later" type="button"><span class="ms" aria-hidden="true">snooze</span>Not yet</button>'+
          '</div>'+
          '<button class="arr-no" type="button">It didn’t arrive</button>'+
        '</div>'+
        '<div class="arr-when" hidden>'+
          '<h2>When should we ask again?</h2>'+
          '<p>It comes back at that time on this phone and your other devices.</p>'+
          '<div class="arr-times">'+arrTimes(Date.now()).map(o=>
            '<button class="arr-time" type="button" data-until="'+o.u+'"><span class="ms" aria-hidden="true">'+o.i+'</span>'+
              '<b>'+esc(o.t)+'</b><small>'+esc(o.s)+'</small></button>').join("")+'</div>'+
          '<button class="arr-when-back" type="button">Back</button>'+
        '</div>'+
        '<div class="arr-sure" hidden>'+
          '<h2>Tell '+esc(p.from)+' it hasn’t arrived?</h2>'+
          '<p>They’ll be asked to check where they sent it. Nothing changes in the balances.</p>'+
          '<div class="arr-acts">'+
            '<button class="arr-tell" type="button">Tell '+esc(p.from)+'</button>'+
            '<button class="arr-back" type="button">Back</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div></div>';
  document.body.appendChild(node);
  ARR={id:item.id, kind:"in", node, busy:false};
  arrTear(node);
  arrKnock();
  const q=(s)=> node.querySelector(s);
  setTimeout(()=>{ const b=q(".arr-yes"); if(b && ARR && ARR.node===node) b.focus({preventScroll:true}); }, 480);
  arrTrap(node);

  const path="trips/"+gid+"/payments/"+p.k;
  // Saved, then the payer's phone is told - by the server, from this record.
  const answer=(ok)=> updStrict(path, {got:{ok, at:Date.now(), uid:USER.uid, name:me||USER.name}, later:null})
    .then(()=> notify("payment.got", gid, {ref:p.k}));

  q(".arr-yes").addEventListener("click", ()=>{
    if(ARR && ARR.node===node) ARR.busy=true;
    SFX.unlock();
    q(".arr-slip").classList.add("stamped");
    node.querySelectorAll("button, a").forEach(b=>{ b.disabled=true; b.tabIndex=-1; });
    setTimeout(()=>{ SFX.success(); try{ if(navigator.vibrate) navigator.vibrate([14, 50, 22]); }catch(e){} }, 180);
    answer(true).then(()=>{
      setTimeout(()=>{ if(ARR && ARR.node===node) ARR.busy=false; arrDone(node); }, 1500);
    }).catch(e=>{
      if(ARR && ARR.node===node) ARR.busy=false;
      q(".arr-slip").classList.remove("stamped");
      node.querySelectorAll("button, a").forEach(b=>{ b.disabled=false; b.tabIndex=0; });
      toast(writeError(e));
    });
  });
  // "Not yet" asks when to come back, rather than guessing.
  q(".arr-later").addEventListener("click", ()=>{
    q(".arr-ask").hidden=true; q(".arr-when").hidden=false; arrTear(node);
    const f=q(".arr-time"); if(f) f.focus({preventScroll:true});
  });
  q(".arr-when-back").addEventListener("click", ()=>{
    q(".arr-when").hidden=true; q(".arr-ask").hidden=false; arrTear(node);
    q(".arr-later").focus({preventScroll:true});
  });
  [].forEach.call(node.querySelectorAll(".arr-time"), b=> b.addEventListener("click", ()=>{
    const until=Number(b.dataset.until);
    if(!(until > Date.now())) return;
    // On this device at once, even with no signal. On every other device -
    // and for the reminder on their phone - through the payment itself.
    arrKeep(ARR_SNOOZE_KEY, item.id, until, 30*864e5);
    updStrict(path, {later:{uid:USER.uid, name:me||USER.name, until, at:Date.now()}}).catch(()=>{});
    arrClose();
    toast("We’ll ask again "+arrWhen(until));
    setTimeout(arrivals, 460);
  }));
  q(".arr-no").addEventListener("click", ()=>{
    q(".arr-ask").hidden=true; q(".arr-sure").hidden=false;
    q(".arr-slip").classList.add("doubt"); arrTear(node);
    q(".arr-tell").focus({preventScroll:true});
  });
  q(".arr-back").addEventListener("click", ()=>{
    q(".arr-sure").hidden=true; q(".arr-ask").hidden=false;
    q(".arr-slip").classList.remove("doubt"); arrTear(node);
    q(".arr-no").focus({preventScroll:true});
  });
  q(".arr-tell").addEventListener("click", ()=>{
    q(".arr-tell").disabled=true;
    answer(false).then(()=>{
      arrDone(node); toast(p.from+" will see it hasn’t arrived");
    }).catch(e=>{ q(".arr-tell").disabled=false; toast(writeError(e)); });
  });
}

/* ---------- the payer: it landed ----------
   A note, not a question: it drops in, says so, and goes by itself. */
function arrConfirmed(item){
  const {gid, p}=item;
  const node=el("div","arr arr-quiet");
  node.innerHTML=
    '<div class="arr-hold"><button class="arr-pill" type="button" role="status" aria-live="polite">'+
      '<span class="arr-pseal"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M10 21l7 7 14-15"/></svg></span>'+
      '<span class="arr-ptext"><b>'+esc(p.to)+' got your '+esc(money(Number(p.amount)||0, gid))+'</b>'+
        '<span>Confirmed '+esc(arrAgo(p.got.at))+' · '+esc(groupName(gid))+'</span></span>'+
    '</button></div>';
  document.body.appendChild(node);
  ARR={id:item.id, kind:"ok", node, busy:false};
  arrKeep(ARR_SEEN_KEY, item.id, Date.now(), 60*864e5);
  SFX.success();
  const done=()=>{ if(ARR && ARR.node===node){ arrClose(); setTimeout(arrivals, 460); } };
  node.querySelector(".arr-pill").addEventListener("click", done);
  setTimeout(done, 4800);
}

/* ---------- the payer: it has not arrived ---------- */
function arrNotArrived(item){
  const {gid, p}=item, amt=Number(p.amount)||0;
  const node=el("div","arr");
  node.innerHTML=
    '<div class="arr-scrim" aria-hidden="true"></div>'+
    '<div class="arr-hold">'+
    '<div class="arr-slip doubt" role="alertdialog" aria-modal="true" aria-labelledby="arrQ" aria-describedby="arrWhat">'+
      '<div class="arr-top">'+
        '<div class="arr-eyebrow"><span class="arr-ping" aria-hidden="true"></span>'+
          '<span class="arr-grp">'+esc(groupName(gid))+'</span></div>'+
        '<div class="arr-flow broken" aria-hidden="true">'+arrFace(p.from, gid)+
          '<span class="arr-track"><i></i><i></i><i></i><b class="ms">question_mark</b></span>'+arrFace(p.to, gid)+'</div>'+
        '<div class="arr-amt">'+esc(money(amt, gid))+'</div>'+
        '<p class="arr-what" id="arrWhat"><b>'+esc(p.to)+'</b> checked and can’t see your payment'+
          ' <span class="arr-dot">·</span> sent '+esc(fmtDate(p.at))+'</p>'+
      '</div>'+
      '<div class="arr-stub">'+
        '<h2 id="arrQ">Worth a second look</h2>'+
        '<p>Make sure it went to '+esc(p.to)+'’s '+(curOf(gid)==="INR"
          ? 'UPI ID and shows as successful in your UPI app. ' : 'Interac address and wasn’t held by your bank. ')+
          'Once it’s sorted, ask them to check again.</p>'+
        '<div class="arr-acts">'+
          '<button class="arr-yes" type="button"><span class="ms" aria-hidden="true">refresh</span>Ask '+esc(p.to)+' again</button>'+
          '<button class="arr-later" type="button">See payment</button>'+
        '</div>'+
      '</div>'+
    '</div></div>';
  document.body.appendChild(node);
  ARR={id:item.id, kind:"no", node, busy:false};
  arrTear(node);
  arrKnock();
  arrTrap(node);
  const q=(s)=> node.querySelector(s);
  setTimeout(()=>{ const b=q(".arr-yes"); if(b && ARR && ARR.node===node) b.focus({preventScroll:true}); }, 480);
  const seen=()=> arrKeep(ARR_SEEN_KEY, item.id, Date.now(), 60*864e5);

  q(".arr-yes").addEventListener("click", ()=>{
    q(".arr-yes").disabled=true;
    // Clearing the answer puts the question back on their screen.
    updStrict("trips/"+gid+"/payments/"+p.k, {got:null, ask:true, later:null}).then(()=>{
      notify("payment.ask", gid, {ref:p.k});
      seen(); arrDone(node); toast(p.to+" will be asked again");
    }).catch(e=>{ q(".arr-yes").disabled=false; toast(writeError(e)); });
  });
  q(".arr-later").addEventListener("click", ()=>{
    seen(); arrClose();
    setTimeout(()=>{
      openGroup(gid);
      setTimeout(()=>{ const fresh=paymentsOf(gid).find(x=>x.k===p.k);
        if(fresh) sheetSettle(fresh.from, fresh.to, fresh.amount, fresh); }, 120);
    }, 200);
  });
}

// The two notches either side of the tear line sit exactly on it, wherever
// the top of the slip ends for this amount and this much wording.
function arrTear(node){
  requestAnimationFrame(()=>{
    const slip=node.querySelector(".arr-slip"), top=node.querySelector(".arr-top");
    if(slip && top) slip.style.setProperty("--tear", top.offsetHeight+"px");
  });
}
// Tab stays on the slip while it is asking something.
function arrTrap(node){
  node.addEventListener("keydown", e=>{
    if(e.key!=="Tab") return;
    const f=[].filter.call(node.querySelectorAll("button, a[href]"), b=> !b.disabled && b.offsetParent!==null);
    if(!f.length) return;
    const first=f[0], last=f[f.length-1];
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  });
}
