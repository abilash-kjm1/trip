/* ===========================================================================
   SETTLE — shared expense app
   Data model (Firebase Realtime Database):
     trips/{gid}/meta          {name, type, at, by}
     trips/{gid}/people/{k}    {n, c, uid?, email?, photo?, invite?}
     invites/{emailKey}/{gid}  {name, at, by}   <- so an invited person sees it
     trips/{gid}/expenses/{k}  {desc, amount, payer, mode, between[], vals{}, cat, note, at, by}
     trips/{gid}/payments/{k}  {from, to, amount, note, at, by}
     users/{uid}/profile       {name, email, photo, at}
     users/{uid}/prefs         {weekly, newExpense, updates, payments, tz, lastWeekly}
     config/reminders          {enabled, days[], hour, windowHours}  <- admin only
     access/{uid}              {status, name, email, at, decidedAt, decidedBy}
     directory/{uid}           {name, email, photo, at}  <- so people can be picked
     mail/queue/{k}            {kind, gid, actorUid, actor, desc, amount, at}
                               <- write-only for the app, drained by the cron
     users/{uid}/groups/{gid}  {name, at}      <- which groups this person is in
   Who you are comes from Google sign-in. Which groups you belong to lives in
   the database under your own uid, so it follows you to any device.
   =========================================================================== */
const $  = (id) => document.getElementById(id);
const el = (t, c, h) => { const n=document.createElement(t); if(c) n.className=c; if(h!=null) n.innerHTML=h; return n; };

// The tracker's own palette. People created by the original app carry a colour
// from this list, so any colour handed out later has to come from the same one
// or the avatars and the bars stop matching each other.
const PALETTE = ["#006b5d","#1565c0","#6a1b9a","#c62828","#ef6c00","#2e7d32",
                 "#ad1457","#4527a0","#00838f","#558b2f","#5d4037","#37474f"];
const CATS = [
  {k:"general",  i:"receipt_long",   n:"General"},
  {k:"food",     i:"restaurant",     n:"Food & drink"},
  {k:"grocery",  i:"shopping_cart",  n:"Groceries"},
  {k:"transport",i:"directions_car", n:"Transport"},
  {k:"fuel",     i:"local_gas_station", n:"Fuel"},
  {k:"home",     i:"home",           n:"Home & rent"},
  {k:"utilities",i:"bolt",           n:"Utilities"},
  {k:"travel",   i:"flight",         n:"Travel"},
  {k:"lodging",  i:"hotel",          n:"Lodging"},
  {k:"fun",      i:"celebration",    n:"Entertainment"},
  {k:"shopping", i:"shopping_bag",   n:"Shopping"},
  {k:"health",   i:"medical_services",n:"Health"}
];
const catOf = (k) => CATS.find(c=>c.k===k) || CATS[0];
const FULLVIEW = /[?&]full=1/.test(location.search);
const ADMIN_EMAIL = (window.ADMIN_EMAIL || "").toLowerCase();
const PEOPLE_LINKS = (function(){
  const src=window.PEOPLE_LINKS||{}, out={};
  Object.keys(src).forEach(k=> out[k.toLowerCase()]=src[k] );
  return out;
})();
// The name this account always goes by, if it has been pinned to one.
const linkedName = (email) => PEOPLE_LINKS[String(email||"").toLowerCase()] || null;

/* ---------------- local state ---------------- */
const LS = {
  grp: "settle.groups.v2",   // cached copy of users/{uid}/groups, for offline
  cur: "settle.cur.v2",
  who: "settle.uid.v2",      // whose cache the other two are
  theme: "settle.theme.v1"   // a look, kept on the device so it applies at once
};
function lsGet(k, d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } }
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }

let USER     = null;                        // {uid, name, email, photo} from Google
let PREFS    = {};                          // users/{uid}/prefs - notification settings
let SCHED    = {};                          // config/reminders - when the email goes out
let ACCESS   = undefined;                   // access/{uid} - undefined until it has loaded
let REQUESTS = {};                          // access/* - everybody, admin only
let ALLUSERS = {};                          // users/* - admin only, to find who never asked
let DIRECTORY= {};                          // directory/* - everybody in Settle, to pick from
let PRESENCE = {};                          // presence/{uid} -> {online, at} - who has Settle open right now
let ME       = null;                        // my person-name inside CURRENT group
let JOINED   = lsGet(LS.grp, []);           // [{id,name}]
let CURRENT  = null;                        // active group id
let TAB      = "home";                      // home | groups | activity | interac | account
let DATA     = {};                          // gid -> {meta, people, expenses, payments}
let remote   = null;                        // firebase handles
const subs   = {};                          // gid -> unsubscribe

/* ---------------- how it looks ----------------
   A theme is a palette. It changes no wording, no layout and no meaning:
   green is money coming to you and red is money going out in every one of
   them. Kept on the device as well as on the account, so it is already right
   on the first paint rather than flickering once the database answers. */
const THEMES = [
  {k:"warm",   n:"Warm",   m:"Cream and apricot", sw:["#F4EEE6","#EEB586","#2F332D"]},
  {k:"purple", n:"Purple", m:"Borahae \u{1F49C}",  sw:["#F8F5FD","#C4AEEF","#2A1F3D"]}
];
let THEME = lsGet(LS.theme, "warm");
function applyTheme(k){
  THEME = THEMES.some(t=>t.k===k) ? k : "warm";
  if(THEME==="warm") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", THEME);
  lsSet(LS.theme, THEME);
}
applyTheme(THEME);

const isAdmin = () => !!(USER && ADMIN_EMAIL && (USER.email||"").toLowerCase()===ADMIN_EMAIL);

/* ---------------- joining ----------------
   Signing in gets somebody an account, not access. The administrator is
   always in - they are the one who would have to let themselves back in
   otherwise. This is the same condition the database rules enforce; the rules
   are what actually stop anything, and this only decides what to show. */
const accessState = () => {
  if(isAdmin()) return "approved";
  if(ACCESS === undefined) return "loading";
  const s = ACCESS && ACCESS.status;
  return (s==="approved" || s==="pending" || s==="declined") ? s : "none";
};
const mayUse = () => accessState()==="approved";

function requestAccess(){
  if(!remote || !USER) return Promise.resolve();
  const rec = {status:"pending", name:USER.name, email:(USER.email||"").toLowerCase(),
               photo:USER.photo||null, at:Date.now()};
  // The record has to exist before the note, or the mailer will look it up,
  // find nothing waiting, and quietly throw the request away.
  return set("access/"+USER.uid, rec).then(()=>{
    ACCESS = rec;
    notify("access.request", null, {});
    render();
  });
}

/* ---------------- helpers ---------------- */
/* ---------------- currency ----------------
   Each group keeps its own currency: Canadian dollars unless it says
   otherwise, or Indian rupees. Nothing is ever converted. A rupee
   group and a dollar group are separate ledgers, so a figure that spans
   groups is shown once per currency - "$120.00 + ₹4,500.00" - rather than
   added up into a number that means nothing. */
const CURRENCIES = {
  CAD: {code:"CAD", sym:"$",   name:"Canadian dollar", pay:"Interac e-Transfer"},
  INR: {code:"INR", sym:"₹",   name:"Indian rupee",    pay:"UPI · GPay, PhonePe, Paytm"}
};
const CUR_DEFAULT = "CAD";
function curOf(gid){
  const c = gid && DATA[gid] && DATA[gid].meta && DATA[gid].meta.currency;
  return (typeof c==="string" && CURRENCIES.hasOwnProperty(c)) ? c : CUR_DEFAULT;
}
// A currency code, a group id, or nothing at all for the group that is open.
function curCode(c){
  if(typeof c==="string" && CURRENCIES.hasOwnProperty(c)) return c;
  if(typeof c==="string" && c) return curOf(c);
  return CURRENT ? curOf(CURRENT) : CUR_DEFAULT;
}
const curSym = (c)=> CURRENCIES[curCode(c)].sym;
// "1234567" -> "12,34,567": rupees are grouped in lakhs and crores.
function groupIN(s){
  const last=s.slice(-3), rest=s.slice(0,-3);
  return rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")+","+last : last;
}
function money(n, c){
  const code=curCode(c), v=Math.round(((Number(n)||0)+Number.EPSILON)*100)/100;
  const abs=Math.abs(v).toFixed(2), sign=v<0?"-":"";
  if(code==="INR"){ const p=abs.split("."); return sign+"₹"+groupIN(p[0])+"."+p[1]; }
  return sign+CURRENCIES[code].sym+abs;
}
/* Amounts that span groups, kept apart by currency: {CAD:120, INR:4500}. */
function curAdd(bag, gid, n){ const c=curOf(gid); bag[c]=(bag[c]||0)+(Number(n)||0); return bag; }
function curKeys(bag){ return Object.keys(CURRENCIES).filter(c=> Math.abs((bag&&bag[c])||0)>0.004); }
function cursInUse(){ const s={}; joinedHere().forEach(g=>{ s[curOf(g.id)]=1; }); return Object.keys(CURRENCIES).filter(c=>s[c]); }
/* ---------------- the two sides: Canada and India ----------------
   Settle is two apps in one. The flag switch in the top bar picks a side, and
   every screen - Today, expenses, groups, Pay, Visualize - shows only that
   side's groups: dollar groups paid back by Interac on one, rupee groups paid
   back by UPI on the other. A group is on the side of its currency. Whatever
   happens on the side not on screen shows as a count on its flag. */
const SIDES = {
  CAD: {name:"Canada", flag:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" fill="#fff"/>'+
    '<rect width="6" height="24" fill="#D52B1E"/><rect x="18" width="6" height="24" fill="#D52B1E"/>'+
    '<path fill="#D52B1E" transform="translate(12 11) scale(.82) translate(-12 -11)" d="M12 5.2l1 2 1.3-.6-.4 3 1.7-1.6.4 1 1.8-.4-.6 1.9.8.4-2.9 2.3.3 1-2.8-.4.1 2.6h-1.4l.1-2.6-2.8.4.3-1-2.9-2.3.8-.4-.6-1.9 1.8.4.4-1 1.7 1.6-.4-3 1.3.6z"/></svg>'},
  INR: {name:"India", flag:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" fill="#fff"/>'+
    '<rect width="24" height="8" fill="#FF9933"/><rect y="16" width="24" height="8" fill="#138808"/>'+
    '<circle cx="12" cy="12" r="2.9" fill="none" stroke="#000080" stroke-width=".8"/><circle cx="12" cy="12" r=".8" fill="#000080"/></svg>'}
};
const LS_SIDE = "settle.side.v1", LS_SIDE_SEEN = "settle.sideseen.v1", LS_SIDE_MAP = "settle.sidemap.v1";
let SIDE_PICKED = lsGet(LS_SIDE, null);
let SIDE = SIDES.hasOwnProperty(SIDE_PICKED) ? SIDE_PICKED : CUR_DEFAULT;
let SIDE_SEEN = lsGet(LS_SIDE_SEEN, {}) || {};   // side -> when it was last on screen
let SIDE_MAP  = lsGet(LS_SIDE_MAP, {}) || {};    // gid -> currency, for before a group has loaded
const otherSide = (s)=> (s||SIDE)==="INR" ? "CAD" : "INR";
function sideOf(gid){
  if(DATA[gid] && DATA[gid].meta) return curOf(gid);
  const c=SIDE_MAP[gid];
  return CURRENCIES.hasOwnProperty(c) ? c : CUR_DEFAULT;
}
// My groups on the side on screen. Every view starts from this, never JOINED.
function joinedHere(){ return JOINED.filter(g=> sideOf(g.id)===SIDE); }
// What a new group starts in: the side it is made on.
function curUsual(){ return SIDE; }
function setSide(side){
  if(!SIDES.hasOwnProperty(side)) return false;
  const now=Date.now(), moved = side!==SIDE;
  SIDE_SEEN[SIDE]=now; SIDE_SEEN[side]=now;
  SIDE=side; SIDE_PICKED=side;
  lsSet(LS_SIDE, side); lsSet(LS_SIDE_SEEN, SIDE_SEEN);
  return moved;
}
/* Before every draw: remember each group's side, follow an open group to its
   side (a notification about a rupee group opens India), and mark this side
   as seen. */
let SIDE_SAVED = 0;
function sideSync(){
  let changed=false;
  JOINED.forEach(g=>{
    if(DATA[g.id] && DATA[g.id].meta){ const c=curOf(g.id); if(SIDE_MAP[g.id]!==c){ SIDE_MAP[g.id]=c; changed=true; } }
  });
  if(changed) lsSet(LS_SIDE_MAP, SIDE_MAP);
  // Until somebody picks, the side most of their groups are on.
  if(!SIDES.hasOwnProperty(SIDE_PICKED)){
    let inr=0; JOINED.forEach(g=>{ if(sideOf(g.id)==="INR") inr++; });
    SIDE = inr*2 > JOINED.length ? "INR" : "CAD";
  }
  if(CURRENT && DATA[CURRENT] && DATA[CURRENT].meta && curOf(CURRENT)!==SIDE) setSide(curOf(CURRENT));
  const now=Date.now();
  // News counts from the first time Settle has sides, not from the beginning.
  Object.keys(SIDES).forEach(s=>{ if(!SIDE_SEEN[s]) SIDE_SEEN[s]=now; });
  SIDE_SEEN[SIDE]=now;
  if(now-SIDE_SAVED > 4000){ SIDE_SAVED=now; lsSet(LS_SIDE_SEEN, SIDE_SEEN); }
}
/* What is new on a side since it was last on screen: expenses and payments
   somebody else added, and payments still waiting for me to say whether they
   arrived. Not "got" answers - those already popped up as their own slip, on
   whichever side was on screen when they arrived, and are gone the moment
   that slip is dismissed. Counting them here too would leave a number on the
   flag with nothing behind it to go and find. */
function sideNews(side){
  if(!USER) return 0;
  const since=Number(SIDE_SEEN[side])||Date.now(), hit={};
  JOINED.forEach(g=>{
    if(sideOf(g.id)!==side) return;
    const me=meIn(g.id);
    const byOther=(x)=> x.byUid ? x.byUid!==USER.uid : (!me || x.by!==me);
    expensesOf(g.id).forEach(e=>{ if((Number(e.at)||0)>since && byOther(e)) hit["e/"+g.id+"/"+e.k]=1; });
    paymentsOf(g.id).forEach(p=>{
      const id="p/"+g.id+"/"+p.k;
      if((Number(p.at)||0)>since && byOther(p)) hit[id]=1;
      if(me && p.ask && !p.netted && !p.got && p.to===me && p.from!==me && p.byUid!==USER.uid &&
         !(p.later && p.later.uid===USER.uid && Number(p.later.until)>Date.now())) hit[id]=1;
    });
  });
  return Object.keys(hit).length;
}
function sideShow(){
  const b=$("sideBtn"); if(!b) return;
  b.hidden = !USER || !mayUse();
  if(b.hidden) return;
  if(!b.dataset.drawn){
    b.querySelector('[data-s="CAD"] .sf-flag').innerHTML=SIDES.CAD.flag;
    b.querySelector('[data-s="INR"] .sf-flag').innerHTML=SIDES.INR.flag;
    b.dataset.drawn="1";
  }
  const other=otherSide(), n=sideNews(other);
  b.dataset.side=SIDE;
  b.title="Switch to "+SIDES[other].name;
  b.setAttribute("aria-label", SIDES[SIDE].name+" side. Switch to "+SIDES[other].name+(n ? ", "+n+" new there" : ""));
  const badge=b.querySelector(".sf-badge");
  badge.hidden=!n; badge.textContent = n>9 ? "9+" : String(n); badge.dataset.on=other;
}
/* People follow the same split. Somebody is offered on a side once they are
   in one of my groups on it - or while they are in none of my groups at all,
   so a newcomer can be added on either side. Somebody added only on India is
   not offered on Canada until they are added there too, and the other way. */
function sideUids(){
  const here={}, there={};
  JOINED.forEach(g=>{
    const on = sideOf(g.id)===SIDE;
    membersOf(g.id).forEach(m=>{ if(m.uid) (on ? here : there)[m.uid]=1; });
  });
  return {here, there};
}
function onThisSide(uid, s){ s = s || sideUids(); return !!s.here[uid] || !s.there[uid]; }
// The empty screen for a side with no groups yet.
function sideEmptyHTML(icon){
  return '<span class="ms" aria-hidden="true">'+icon+'</span><h3>No '+SIDES[SIDE].name+' groups yet</h3>'+
    '<p>'+(SIDE==="INR" ? 'Rupee groups live here, paid back by UPI.' : 'Dollar groups live here, paid back by Interac.')+
    ' Create one for a trip, a flat or family - or tap the flag at the top for the '+SIDES[otherSide()].name+' side.</p>';
}
// Nothing, in the one currency my groups use - or in dollars when they differ.
function moneyZero(){ return money(0, SIDE); }
function moneyMulti(bag){
  const k=curKeys(bag);
  return k.length ? k.map(c=> money(Math.abs(bag[c]), c)).join(" + ") : moneyZero();
}
// With the sign that says which way it goes: "+$20.00 · −₹300.00".
function moneySigned(bag){
  const k=curKeys(bag);
  return k.length ? k.map(c=> (bag[c]>0?"+":"−")+money(Math.abs(bag[c]), c)).join(" · ") : moneyZero();
}
// pos, neg or zero - or mix, when I am up in one currency and down in another.
function bagTone(bag){
  const k=curKeys(bag);
  if(!k.length) return "zero";
  const up=k.some(c=>bag[c]>0), down=k.some(c=>bag[c]<0);
  return up && down ? "mix" : up ? "pos" : "neg";
}
function bagNet(a, b){
  const o={};
  Object.keys(CURRENCIES).forEach(c=>{ const v=((a&&a[c])||0)-((b&&b[c])||0); if(v) o[c]=v; });
  return o;
}
function plain(n){ return (Math.round((n+Number.EPSILON)*100)/100).toFixed(2); }
function trim(n){ return String(Math.round((n+Number.EPSILON)*100)/100); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function initials(n){ const p=String(n||"?").trim().split(/\s+/); return (p[0].charAt(0)+(p[1]?p[1].charAt(0):"")).toUpperCase(); }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
let toastT;
function toast(m){ const t=$("toast"); t.textContent=m; t.classList.add("on");
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("on"), 2600); }
function fmtDate(ts){
  if(!ts) return "";
  const d=new Date(ts); if(isNaN(d)) return "";
  const o={day:"numeric", month:"short"};
  if(d.getFullYear()!==new Date().getFullYear()) o.year="numeric";
  return d.toLocaleDateString(undefined,o);
}
function fmtWhen(ts){
  if(!ts) return "";
  const d=new Date(ts); if(isNaN(d)) return "";
  return fmtDate(ts)+" · "+d.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"});
}
function dayKey(ts){ const d=new Date(ts||0);
  return isNaN(d) ? "" : d.getFullYear()+"-"+d.getMonth()+"-"+d.getDate(); }
function dayLabel(ts){
  const d=new Date(ts||0); if(isNaN(d)) return "Undated";
  const t=new Date();
  if(dayKey(ts)===dayKey(t)) return "Today";
  if(dayKey(ts)===dayKey(Date.now()-864e5)) return "Yesterday";
  return d.toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long"});
}
/* ---------------- presence: who has Settle open right now ----------------
   presence/{uid} = {online, at}, kept current with Firebase's own
   .info/connected + onDisconnect: the database itself notices a phone has
   gone away - closed, lost signal, out of battery - and flips the record,
   with nothing left for that phone to do on its way out. */
const isOnline = (uid)=> !!(uid && PRESENCE[uid] && PRESENCE[uid].online===true);
function presenceText(uid){
  if(!uid || !PRESENCE[uid]) return "";
  if(PRESENCE[uid].online===true) return "Online now";
  const at=Number(PRESENCE[uid].at)||0;
  return at ? "Last seen "+arrAgo(at) : "";
}
/* Told directly, the moment a connection exists: onDisconnect is registered
   fresh on every reconnect (an earlier registration does not survive a drop),
   so this runs whenever ".info/connected" turns true, not only at sign-in.
   A raw write, outside the durable/outbox layer on purpose - there is
   nothing to gain by queuing "I am online" for later delivery: read while
   offline, that would only be stale. */
function presenceGoOnline(){
  if(!fb || !fb.dbMod || !remote || !remote.db || !USER) return;
  const r=fb.dbMod.ref(remote.db, "presence/"+USER.uid);
  fb.dbMod.onDisconnect(r).set({online:false, at:Date.now()}).then(()=>{
    fb.dbMod.set(r, {online:true, at:Date.now()});
  }).catch(()=>{});
}
function presenceGoOffline(){
  if(!fb || !fb.dbMod || !remote || !remote.db || !USER) return;
  try{ fb.dbMod.set(fb.dbMod.ref(remote.db, "presence/"+USER.uid), {online:false, at:Date.now()}); }catch(e){}
}
function avatarHTML(cls, name, colour, photo, uid){
  const inner = photo
    ? '<img class="av '+cls+'" src="'+esc(photo)+'" alt="" referrerpolicy="no-referrer">'
    : '<span class="av '+cls+'" style="background:'+(colour||"#8e99a6")+'">'+esc(initials(name))+'</span>';
  if(!isOnline(uid)) return inner;
  return '<span class="avwrap '+cls+'">'+inner+'<i class="av-dot" aria-label="Online now"></i></span>';
}

/* ---------------- group data accessors ---------------- */
function membersOf(gid){
  const g=DATA[gid]||{}, raw=g.people||{};
  const keys=Object.keys(raw).sort();
  const taken=new Set(); keys.forEach(k=>{ const c=raw[k] && raw[k].c; if(c) taken.add(c.toLowerCase()); });
  let next=0;
  return keys.map(k=>{
    const v=raw[k]; const obj=(v&&typeof v==="object")?v:{n:String(v)};
    const name=obj.n||"";
    let color=obj.c||null;
    if(!color){
      while(next<PALETTE.length && taken.has(PALETTE[next].toLowerCase())) next++;
      color=PALETTE[next%PALETTE.length]; taken.add(color.toLowerCase()); next++;
    }
    return {k, name, color, uid:obj.uid||null, email:obj.email||null,
            photo:obj.photo||null, invite:(obj.invite||"").toLowerCase()||null};
  }).sort((a,b)=>a.name.localeCompare(b.name));
}
const names   = (gid) => membersOf(gid||CURRENT).map(m=>m.name);
const memberOf= (n, gid) => membersOf(gid||CURRENT).find(x=>x.name===n) || null;
const colorOf = (n, gid) => { const m=memberOf(n, gid); return m?m.color:"#8e99a6"; };
function listOf(gid, what){
  const raw=(DATA[gid]||{})[what]||{};
  return Object.entries(raw).map(([k,v])=>Object.assign({k},v)).sort((a,b)=>(b.at||0)-(a.at||0));
}
const expensesOf = (gid) => listOf(gid||CURRENT, "expenses");
const paymentsOf = (gid) => listOf(gid||CURRENT, "payments");

// Which person in this group is me? Null until I have claimed a slot.
function meIn(gid){
  if(!USER) return null;
  const m=membersOf(gid).find(x=>x.uid===USER.uid);
  return m ? m.name : null;
}
const loaded = (gid) => !!(DATA[gid] && (DATA[gid].meta || DATA[gid].people || DATA[gid].expenses));

/* Nobody goes into a group twice. A second seat for the same account or
   address splits one person's balance in two; a second seat with the same
   name is worse, because the ledger is keyed by name and the two quietly
   become one. Names are compared the way people read them - "Kavya",
   "kavya" and " Kavya  " are the same - and so are addresses.
   Account first, then address, then name, so the message names the real
   reason. `exceptKey` leaves out the seat being edited. */
const normName = (s)=> String(s||"").trim().replace(/\s+/g," ").toLowerCase();
const normMail = (s)=> String(s||"").trim().toLowerCase();
const tidyName = (s)=> String(s||"").trim().replace(/\s+/g," ");
function inGroupAlready(gid, p, exceptKey){
  const list = membersOf(gid).filter(m=> m.k!==exceptKey);
  const n = normName(p.name), mail = normMail(p.email);
  let m = p.uid && list.find(x=> x.uid===p.uid);
  if(m) return {m, by:"account", text: m.name+" is already in this group"};
  m = mail && list.find(x=> normMail(x.email)===mail || normMail(x.invite)===mail);
  if(m) return {m, by:"email", text: mail+" is already in this group, as "+m.name};
  if(!n) return null;
  m = list.find(x=> normName(x.name)===n);
  if(m) return {m, by:"name", text: "Someone in this group is already called "+m.name};
  // A name that has left the members list but is still on expenses holds a
  // balance; a new seat with that name would inherit it.
  const self = exceptKey ? (membersOf(gid).find(x=>x.k===exceptKey)||{}).name : null;
  const old = everyoneIn(gid).find(x=> x!==self && normName(x)===n);
  if(old) return {m:{name:old}, by:"name", text: old+" is still on this group's expenses. Use that name, or merge"};
  return null;
}

/* A name typed for somebody who is already in Settle should be their account,
   not a label their app knows nothing about - otherwise the group never shows
   up for them. An address is proof. A whole name counts only when exactly one
   account has it: two people can share a name, and guessing wrong would hand
   one of them a stranger's group. Returns the directory entry, or null. */
/* ---------------- Interac e-Transfer details ----------------
   Kept on a person's own directory entry, so only approved Settle users can
   read them and only that person can change them. Checked on the way out as
   well as on the way in: whatever is in the database, only a plausible name
   and a real-looking address or phone number is ever shown. */
/* iPhone: every bank opens its App Store page, which shows Open when the app
   is installed - one more tap, but it always lands in the app. CIBC's
   sign-in page is listed as a universal link for its app, yet in practice it
   loaded the website instead, so it is not used. */
const ETX_BANKS = [
  {id:"cibc",       name:"CIBC",       pkg:"com.cibc.android.mobi",   appstore:"351448953",
   web:"https://www.cibc.com/en/personal-banking.html"},
  {id:"rbc",        name:"RBC",        pkg:"com.rbc.mobile.android",  appstore:"407597290", web:"https://www.rbcroyalbank.com/"},
  {id:"td",         name:"TD",         pkg:"com.td",                  appstore:"358790776", web:"https://www.td.com/ca/en/personal-banking"},
  {id:"scotiabank", name:"Scotiabank", pkg:"com.scotiabank.banking",  appstore:"341151570", web:"https://www.scotiabank.com/ca/en/personal.html"},
  {id:"bmo",        name:"BMO",        pkg:"com.bmo.mobile",          appstore:"429080319", web:"https://www.bmo.com/en-ca/main/personal/"}
];
const etxEmailOk = (s)=> /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,24}$/i.test(String(s||""));
const etxPhone   = (s)=> { const d=String(s||"").replace(/[^\d]/g,""); return d.length===11 && d[0]==="1" ? d.slice(1) : d; };
const etxPhoneOk = (s)=> /^\d{10}$/.test(etxPhone(s)) && !/[a-z@]/i.test(String(s||""));
function etxClean(p){
  if(!p || typeof p!=="object") return null;
  const name=tidyName(p.name).slice(0,60);
  const raw=String(p.handle||"").trim();
  let handle=null;
  if(etxEmailOk(raw)) handle=raw.toLowerCase();
  else if(etxPhoneOk(raw)){ const d=etxPhone(raw); handle="("+d.slice(0,3)+") "+d.slice(3,6)+"-"+d.slice(6); }
  return name && handle ? {name, handle} : null;
}
// What gets saved, or why it cannot be. Used for my own details and for the
// administrator filling in somebody else's, so the two cannot drift apart.
function etxRecord(name, handle){
  const n=tidyName(name).slice(0,60), h=String(handle||"").trim();
  if(!n) return "Enter the name on the Interac account";
  if(!etxEmailOk(h) && !etxPhoneOk(h)) return "Enter a valid email, or a 10-digit phone number";
  return {name:n, handle: etxEmailOk(h) ? h.toLowerCase() : etxPhone(h), at:Date.now()};
}
function etxFor(uid){ return uid && DIRECTORY && DIRECTORY[uid] ? etxClean(DIRECTORY[uid].pay) : null; }
function myBank(){ const id=(PREFS&&PREFS.bank)||""; return ETX_BANKS.find(b=>b.id===id) || null; }
/* Where "Open <bank>" goes, per phone. It is a real link the person taps -
   iOS only hands a web link to an app when it is tapped, not when a script
   navigates. Android asks Chrome for the app by its store id and falls back
   to the store page. iPhone uses the bank's universal link if it has one,
   otherwise its App Store page. A computer gets the bank's site. No personal
   detail ever goes into these addresses. */
const etxIsIOS = ()=> /iPhone|iPad|iPod/i.test(navigator.userAgent||"") ||
  (/Macintosh/i.test(navigator.userAgent||"") && (navigator.maxTouchPoints||0) > 1);
function etxBankLink(bank){
  if(!bank) return null;
  const ua=navigator.userAgent||"";
  if(/Android/i.test(ua)){
    const store="https://play.google.com/store/apps/details?id="+bank.pkg;
    return "intent://#Intent;package="+bank.pkg+";S.browser_fallback_url="+encodeURIComponent(store)+";end";
  }
  if(etxIsIOS()) return bank.ios || ("https://apps.apple.com/ca/app/id"+bank.appstore);
  return bank.web;
}
function etxCopy(text, label){
  const done=()=> toast((label||"Copied")+" copied");
  const fallback=()=>{
    const t=document.createElement("textarea"); t.value=text; t.setAttribute("readonly","");
    t.style.cssText="position:fixed;left:-9999px;top:0"; document.body.appendChild(t);
    t.select(); try{ document.execCommand("copy"); done(); }catch(e){ toast("Could not copy"); }
    document.body.removeChild(t);
  };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
}

/* ---------------- UPI (India) ----------------
   Beside Interac, on the same directory entry and under the same rules: the
   name on the account and a UPI ID (name@bank). Checked on the way in and on
   the way out. A UPI link can carry the amount, so GPay, PhonePe or Paytm
   opens with it filled in - the person still checks the name and enters their
   UPI PIN in that app. Settle never moves money and never sees a PIN. */
const UPI_APPS = [
  {id:"gpay",    name:"GPay",    tint:"#1A73E8", mono:"G",  pkg:"com.google.android.apps.nbu.paisa.user", ios:"tez://upi/pay"},
  {id:"phonepe", name:"PhonePe", tint:"#5F259F", mono:"Pe", pkg:"com.phonepe.app",  ios:"phonepe://pay"},
  {id:"paytm",   name:"Paytm",   tint:"#00A0E3", mono:"Pt", pkg:"net.one97.paytm",  ios:"paytmmp://pay"}
];
const upiIdOk = (s)=> { const v=String(s||"").trim(); return v.length<=120 && /^[a-z0-9][a-z0-9._-]+@[a-z][a-z0-9]+$/i.test(v); };
function upiClean(p){
  if(!p || typeof p!=="object") return null;
  const name=tidyName(p.name).slice(0,60), vpa=String(p.vpa||"").trim().toLowerCase();
  return name && upiIdOk(vpa) ? {name, vpa} : null;
}
function upiRecord(name, vpa){
  const n=tidyName(name).slice(0,60), v=String(vpa||"").trim().toLowerCase();
  if(!n) return "Enter the name on the UPI account";
  if(!upiIdOk(v)) return "Enter a UPI ID like yourname@okaxis";
  return {name:n, vpa:v, at:Date.now()};
}
function upiFor(uid){ return uid && DIRECTORY && DIRECTORY[uid] ? upiClean(DIRECTORY[uid].upi) : null; }
function myUpiApp(){ const id=(PREFS&&PREFS.upiApp)||""; return UPI_APPS.find(a=>a.id===id) || null; }
const etxIsAndroid = ()=> /Android/i.test(navigator.userAgent||"");
/* The request itself: whose UPI ID, their name, how much, and a short note.
   Nothing about the person paying goes in it. */
function upiQuery(d, amount, note){
  const q=["pa="+encodeURIComponent(d.vpa), "pn="+encodeURIComponent(d.name)];
  if(amount>0) q.push("am="+(Math.round(amount*100)/100).toFixed(2));
  q.push("cu=INR");
  const tn=String(note||"").replace(/[^A-Za-z0-9 .,&'-]/g,"").replace(/\s+/g," ").trim().slice(0,50);
  if(tn) q.push("tn="+encodeURIComponent(tn));
  return q.join("&");
}
/* Android hands a upi:// link to the app named in an intent, or offers every
   UPI app when none is named. iPhone has no such chooser, so each app is
   opened by its own address. A computer has neither: it gets the QR code. */
function upiLink(d, amount, note, app){
  const q=upiQuery(d, amount, note);
  if(app && etxIsAndroid()) return "intent://pay?"+q+"#Intent;scheme=upi;package="+app.pkg+";end";
  if(app && etxIsIOS()) return app.ios+"?"+q;
  return "upi://pay?"+q;
}
/* QR codes are drawn by a small library, fetched only the first time one is
   needed. Pinned to one version and checked against its published hash, so a
   changed copy is refused rather than run. */
const QR_SRC = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
const QR_SRI = "sha512-ZDSPMa/JM1D+7kdg2x3BsruQ6T/JpJo3jWDWkCZsP+5yVyp1KfESqLI+7RqB5k24F7p2cV7i2YHh/890y6P6Sw==";
let qrLoading = null;
function qrLib(){
  if(typeof window.qrcode==="function") return Promise.resolve(window.qrcode);
  if(qrLoading) return qrLoading;
  qrLoading = new Promise((ok, no)=>{
    const s=document.createElement("script");
    s.src=QR_SRC; s.integrity=QR_SRI; s.crossOrigin="anonymous"; s.referrerPolicy="no-referrer";
    s.onload=()=> typeof window.qrcode==="function" ? ok(window.qrcode) : no(new Error("no QR"));
    s.onerror=()=>{ qrLoading=null; s.remove(); no(new Error("no QR")); };
    document.head.appendChild(s);
  });
  return qrLoading;
}
function qrSvg(text){
  return qrLib().then(qrcode=>{
    const qr=qrcode(0, "M"); qr.addData(text); qr.make();
    return qr.createSvgTag({cellSize:4, margin:3, scalable:true});
  });
}
/* Draw a QR into `host`, saying so plainly if it cannot be drawn. */
function qrInto(host, text){
  if(!host) return;
  host.innerHTML='<span class="upi-qr-wait"><span class="ms" aria-hidden="true">qr_code_2</span></span>';
  qrSvg(text).then(svg=>{ if(host.isConnected) host.innerHTML=svg; })
    .catch(()=>{ if(host.isConnected) host.innerHTML='<span class="upi-qr-wait off">The QR code needs a connection the first time. The UPI ID works without it.</span>'; });
}

function settleAccountFor(name, email){
  const people = Object.keys(DIRECTORY||{}).map(u=> Object.assign({uid:u}, DIRECTORY[u]||{}));
  const mail = normMail(email);
  if(mail){ const p = people.find(x=> normMail(x.email)===mail); if(p) return p; }
  const n = normName(name); if(!n) return null;
  const same = people.filter(x=> normName(x.name)===n);
  return same.length===1 ? same[0] : null;
}
/* Accounts a partly typed name could mean - "kav" for "Kavya R" - offered as
   a tap, never linked on their own. Leaves out me and anyone already in the
   group. */
function settleSuggestions(name, gid){
  const n = normName(name); if(n.length<2) return [];
  const inGroup = gid ? membersOf(gid).map(m=>m.uid).filter(Boolean) : [];
  return Object.keys(DIRECTORY||{}).map(u=> Object.assign({uid:u}, DIRECTORY[u]||{}))
    .filter(p=> p.name && inGroup.indexOf(p.uid)<0 && !(USER && p.uid===USER.uid) && onThisSide(p.uid))
    .filter(p=>{ const full=normName(p.name); return full.indexOf(n)===0 || full.split(" ").some(w=> w.indexOf(n)===0); })
    .slice(0,4);
}

// Everyone the money actually involves. An expense can name someone who is no
// longer on the members list; they still hold a balance, so any screen that
// claims to show "everyone" has to include them or the figures will not add up.
function everyoneIn(gid){
  const out=names(gid).slice();
  Object.keys(balances(gid)).forEach(n=>{ if(out.indexOf(n)<0) out.push(n); });
  return out;
}

/* ---------------- who may change what ----------------
   Only whoever paid may record it. Only whoever added a line may change or remove
   it - except the administrator, who may touch anything. Older rows predate
   uid stamping, so they fall back to matching the recorded name. */
function addedByMe(rec){
  if(!USER || !rec) return false;
  if(rec.byUid) return rec.byUid===USER.uid;
  return !!ME && rec.by===ME;
}
const canEdit = (rec) => isAdmin() || addedByMe(rec);

/* Who may be named as the payer when recording something. Money goes into the
   ledger under the name of whoever paid, so only they may put it there - if
   Kelvin paid, Kelvin records it. The administrator may record for anyone.
   Everybody else gets their own name only, and nobody at all until they have
   said which name in the group is theirs. Used by every place that asks who
   paid, so they cannot drift apart. */
function payersAllowed(gid, ppl){
  if(isAdmin()) return ppl.slice();
  const me = meIn(gid);
  return me && ppl.indexOf(me) > -1 ? [me] : [];
}
function ownerOf(rec){
  if(!rec) return "someone else";
  return rec.by || "someone else";
}

// Emails are keys under invites/, and RTDB keys cannot contain a dot.
// The database rule performs the same substitution, so this must match it.
function emailKey(e){ return String(e||"").trim().toLowerCase().replace(/\./g, ","); }
const emailOk = (e) => /^[^\s@#$\[\]/]+@[^\s@#$\[\]/]+\.[^\s@#$\[\]/]+$/.test(String(e||"").trim());

/* ---------------- split maths ---------------- */
// Returns {name: amountOwed}. Modes: equal | exact | percent | shares
function sharesOf(e){
  const out={};
  const between=(e.between&&e.between.length)?e.between:[e.payer];
  const vals=e.vals||{};
  const amt=Number(e.amount)||0;
  if(e.mode==="exact"){
    between.forEach(n=> out[n]=Number(vals[n])||0 );
  } else if(e.mode==="percent"){
    between.forEach(n=> out[n]= amt*((Number(vals[n])||0)/100) );
  } else if(e.mode==="shares"){
    const tot=between.reduce((a,n)=>a+(Number(vals[n])||0),0) || 1;
    between.forEach(n=> out[n]= amt*((Number(vals[n])||0)/tot) );
  } else {
    const per=amt/between.length;
    between.forEach(n=> out[n]=per );
  }
  return out;
}
// Net position per person: positive = they are owed, negative = they owe
function balances(gid){
  const b={};
  names(gid).forEach(n=> b[n]=0 );
  expensesOf(gid).forEach(e=>{
    if(!(e.payer in b)) b[e.payer]=0;
    b[e.payer]+=Number(e.amount)||0;
    const sh=sharesOf(e);
    Object.keys(sh).forEach(n=>{ if(!(n in b)) b[n]=0; b[n]-=sh[n]; });
  });
  paymentsOf(gid).forEach(p=>{
    if(!(p.from in b)) b[p.from]=0;
    if(!(p.to   in b)) b[p.to]=0;
    b[p.from]+=Number(p.amount)||0;   // paying down what you owe
    b[p.to]  -=Number(p.amount)||0;
  });
  return b;
}
// Fewest transfers that clear everyone
function settlements(gid){
  const b=balances(gid), cred=[], deb=[];
  Object.keys(b).forEach(n=>{ const v=Math.round(b[n]*100)/100;
    if(v>0.004) cred.push({n, v}); else if(v<-0.004) deb.push({n, v:-v}); });
  cred.sort((a,c)=>c.v-a.v); deb.sort((a,c)=>c.v-a.v);
  const out=[]; let i=0,j=0,guard=0;
  while(i<deb.length && j<cred.length && guard++<9999){
    const pay=Math.min(deb[i].v, cred[j].v);
    if(pay>0.004) out.push({from:deb[i].n, to:cred[j].n, amt:pay});
    deb[i].v-=pay; cred[j].v-=pay;
    if(deb[i].v<=0.004) i++;
    if(cred[j].v<=0.004) j++;
  }
  return out;
}
// Net between two people, positive when `a` still owes `b`. Counts each
// person's share of what the other paid for, then the payments already made
// between the two.
function pairNet(gid, a, b){
  let net=0;
  expensesOf(gid).forEach(e=>{
    const sh=sharesOf(e);
    if(e.payer===b && sh[a]) net += sh[a];
    if(e.payer===a && sh[b]) net -= sh[b];
  });
  paymentsOf(gid).forEach(p=>{
    if(p.from===a && p.to===b) net -= Number(p.amount)||0;
    if(p.from===b && p.to===a) net += Number(p.amount)||0;
  });
  return Math.round(net*100)/100;
}

// What to put in the amount box for a given pair, and why.
function suggestSettle(gid, from, to){
  if(from===to) return {amt:0, why:"Pick two different people."};
  const plan=settlements(gid).find(t=>t.from===from && t.to===to);
  if(plan) return {amt:Math.round(plan.amt*100)/100,
                   why:"This clears "+(from===ME?"you":from)+" in the settle-up plan."};
  const net=pairNet(gid, from, to);
  if(net>0.004)  return {amt:net, why:(from===ME?"You owe":from+" owes")+" "+to+" this much between the two of them."};
  if(net<-0.004) return {amt:0,   why:"The other way round \u2014 "+to+" owes "+
                                      (from===ME?"you":from)+" "+money(-net, gid)+"."};
  return {amt:0, why:"Nothing outstanding between these two."};
}

const myBalance = (gid) => { const n=meIn(gid); if(!n) return 0; const b=balances(gid); return b[n]||0; };
function totalOf(gid){ let t=0; expensesOf(gid).forEach(e=> t+=Number(e.amount)||0 ); return t; }

/* ---------------- writes ---------------- */
function ref(path){ return remote.ref(remote.db, path); }
function push(path, val){
  if(typeof notifSelfGrace==="function") notifSelfGrace();
  if(!remote){ toast("Not signed in yet"); return Promise.resolve(); }
  return remote.push(ref(path), val).catch(e=>toast("Could not save: "+e.message));
}
function set(path, val){
  if(typeof notifSelfGrace==="function") notifSelfGrace();
  if(!remote) return Promise.resolve();
  return remote.set(ref(path), val).catch(e=>toast("Could not save: "+e.message));
}
function del(path){
  if(typeof notifSelfGrace==="function") notifSelfGrace();
  if(!remote) return Promise.resolve();
  return remote.remove(ref(path)).catch(e=>toast("Could not remove: "+e.message));
}
function upd(path, obj){
  if(typeof notifSelfGrace==="function") notifSelfGrace();
  if(!remote) return Promise.resolve();
  return remote.update(ref(path), obj).catch(e=>toast("Could not save: "+e.message));
}
/* The same write, but a refusal stays a refusal. upd() above reports an error
   and then carries on as if it had worked - fine for background writes, wrong
   for a form that goes on to say "saved": the screen showed details the
   database had turned down, and a refresh took them away. */
function updStrict(path, obj){
  if(typeof notifSelfGrace==="function") notifSelfGrace();
  if(!remote) return Promise.reject(new Error("Not signed in yet"));
  return remote.update(ref(path), obj);
}
function writeError(e){
  const why=String((e && (e.code || e.message)) || "");
  return /permission/i.test(why)
    ? "The database refused this. Publish the updated rules in Firebase, then try again."
    : "Could not save: "+((e && e.message) || "try again");
}

/* ---------------- the activity outbox ----------------
   The browser holds no mail key and can send nothing. It leaves a note here
   instead; the scheduler reads it on its next pass, works out from the
   group's own membership who ought to hear, and sends. So the note says what
   happened and never who to tell - picking recipients stays on the server,
   where a tampered note cannot reach anyone it could not already reach.
   Best effort throughout: a note that fails to save must never stop the
   thing it describes from being saved. */
function notify(kind, gid, what){
  if(!remote || !USER || !USER.uid) return;
  const rec = {
    kind: kind, actorUid: USER.uid,
    actor: String(ME || USER.name || "Someone").slice(0,80),
    desc: String((what && what.desc) || "").slice(0,120),
    at: Date.now()
  };
  if(gid) rec.gid = gid;              // a request to join names no group
  const amt = Number(what && what.amount);
  if(isFinite(amt) && amt > 0) rec.amount = Math.round(amt*100)/100;
  // Which payment it is about, so a phone can be asked about exactly that one.
  const r = what && what.ref;
  if(typeof r === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(r)) rec.ref = r;
  try {
    const saved = remote.push(ref("mail/queue"), rec);
    Promise.resolve(saved).catch(()=>{});
    if(PUSH_NOW_KINDS[kind]) pushNow(saved);
  } catch(e){}
}

/* Phone notifications straight away. Once the note is saved, the server is
   asked to look at this account's own notes now rather than on its next pass.
   It is only a nudge: the server checks who is asking, reads the notes itself
   and decides who hears, and if this call never lands the pass sends them
   anyway. Several saves in a moment make one call. */
const PUSH_NOW_URL = "https://trip-xi-flax.vercel.app/api/notify";
const PUSH_NOW_KINDS = {"payment.add":1, "payment.ask":1, "payment.got":1,
                        "expense.add":1, "expense.edit":1, "expense.del":1};
let pushNowT = null;
const pushNowWait = [];
function pushNow(saved){
  pushNowWait.push(Promise.resolve(saved).catch(()=>{}));
  clearTimeout(pushNowT);
  pushNowT = setTimeout(()=>{
    const waits = pushNowWait.splice(0);
    Promise.all(waits)
      .then(()=> (fb && fb.auth && fb.auth.currentUser) ? fb.auth.currentUser.getIdToken() : null)
      .then(tok=> tok ? fetch(PUSH_NOW_URL, {method:"POST", headers:{Authorization:"Bearer "+tok}}) : null)
      .catch(()=>{});
  }, 600);
}

/* ---------------- linking an account to a name ---------------- */
/* trips/{gid}/uids is the membership list the database rules read. The people
   records already carry a uid, but rules cannot scan a list, so the same fact
   is kept in a shape a rule can ask about in one step. Anything that attaches
   an account to a name has to keep this in step, or that person can no longer
   open the group. */
function joinUid(gid, uid){
  return uid ? set("trips/"+gid+"/uids/"+uid, true) : Promise.resolve();
}
function dropUid(gid, uid){
  return uid ? del("trips/"+gid+"/uids/"+uid) : Promise.resolve();
}

function linkPerson(gid, key){
  return upd("trips/"+gid+"/people/"+key,
    {uid:USER.uid, email:USER.email, photo:USER.photo||null})
    .then(()=> joinUid(gid, USER.uid) );
}
function unlinkPerson(gid, key){
  const m = membersOf(gid).find(x=>x.k===key);
  const gone = m && m.uid;
  return upd("trips/"+gid+"/people/"+key, {uid:null, email:null, photo:null})
    .then(()=> dropUid(gid, gone) );
}

// Fold one person into another: everything `from` paid, owed or was split
// into becomes `to`, and `from` disappears. Used to repair a duplicate — the
// same human entered twice — which otherwise skews every split they are in.
// One atomic update, because a half-applied merge would silently change what
// people owe.
function mergePeople(gid, from, to){
  const u={};
  expensesOf(gid).forEach(e=>{
    if(e.payer===from) u["expenses/"+e.k+"/payer"]=to;
    const b=e.between||[];
    if(b.indexOf(from)>-1){
      const vals=Object.assign({}, e.vals||{});
      if(vals[from]!=null){
        // both halves of the duplicate contributed, so their shares add up
        vals[to]=(Number(vals[to])||0)+(Number(vals[from])||0);
        delete vals[from];
      }
      const nb=[];
      b.forEach(n=>{ const m=(n===from)?to:n; if(nb.indexOf(m)<0) nb.push(m); });
      u["expenses/"+e.k+"/between"]=nb;
      u["expenses/"+e.k+"/vals"]=vals;
    }
  });
  paymentsOf(gid).forEach(p=>{
    const f=(p.from===from)?to:p.from, t=(p.to===from)?to:p.to;
    if(f===t) u["payments/"+p.k]=null;             // paying yourself means nothing
    else{
      if(f!==p.from) u["payments/"+p.k+"/from"]=f;
      if(t!==p.to)   u["payments/"+p.k+"/to"]=t;
    }
  });
  const gone   = membersOf(gid).find(x=>x.name===from);
  const target = membersOf(gid).find(x=>x.name===to);
  if(gone){
    // If the target is only a name carried on the expenses and has no record
    // of its own, deleting the source would throw away the account, the email
    // and the colour attached to it - and leave the name orphaned exactly as
    // before. Rename the record onto that name instead: same effect on the
    // money, and the orphan is absorbed rather than perpetuated.
    if(target) u["people/"+gone.k]=null;
    else       u["people/"+gone.k+"/n"]=to;
  }
  return upd("trips/"+gid, u);
}
// What a merge would touch, so it can be described before it happens.
function mergePreview(gid, from){
  let paid=0, inSplit=0, pays=0;
  expensesOf(gid).forEach(e=>{
    if(e.payer===from) paid++;
    if((e.between||[]).indexOf(from)>-1) inSplit++;
  });
  paymentsOf(gid).forEach(p=>{ if(p.from===from||p.to===from) pays++; });
  return {paid, inSplit, pays};
}

// Renaming has to move the name everywhere it is used as a key, or the
// balances stop adding up. One atomic update so it cannot half-apply.
function renamePerson(gid, key, from, to){
  const u={}; u["people/"+key+"/n"]=to;
  expensesOf(gid).forEach(e=>{
    if(e.payer===from) u["expenses/"+e.k+"/payer"]=to;
    if(e.between && e.between.indexOf(from)>-1)
      u["expenses/"+e.k+"/between"]=e.between.map(n=> n===from?to:n );
    if(e.vals && Object.prototype.hasOwnProperty.call(e.vals, from)){
      const v={}; Object.keys(e.vals).forEach(n=> v[n===from?to:n]=e.vals[n] );
      u["expenses/"+e.k+"/vals"]=v;
    }
  });
  paymentsOf(gid).forEach(p=>{
    if(p.from===from) u["payments/"+p.k+"/from"]=to;
    if(p.to===from)   u["payments/"+p.k+"/to"]=to;
  });
  return upd("trips/"+gid, u);
}

/* Two people share a phone, or one person has two accounts. Everything held
   locally - the group list, the group last open, the group named in the
   address bar - belongs to whoever was signed in before, and none of it is
   the next person's to see. Signing out clears it; signing straight in as
   somebody else did not, and that is how one account came to be looking at
   another's group. Returns true when it wiped something. */
function forgetPreviousAccount(uid){
  if(!uid) return false;
  if(lsGet(LS.who, null) === uid) return false;
  JOINED = []; CURRENT = null; DATA = {};
  try{ localStorage.removeItem(LS.grp); localStorage.removeItem(LS.cur); }catch(e){}
  forgetCachedGroups();     // the last account's groups are not this one's to see
  // The activity feed's own memory of what it has already seen - an admin
  // switching between accounts on one device, without signing all the way
  // out, must not have the new account's long-standing groups read as
  // freshly joined, or its existing expenses compared against what the
  // last account happened to have loaded.
  if(typeof notifForget==="function") notifForget();
  if(typeof announceForget==="function") announceForget();
  if(typeof location !== "undefined" && location.hash) location.hash = "";
  lsSet(LS.who, uid);
  return true;
}

/* ---------------- which groups I am in ---------------- */
function rememberGroup(id, name){
  if(!JOINED.some(g=>g.id===id)) JOINED.push({id, name});
  else JOINED = JOINED.map(g=> g.id===id ? {id, name:name||g.name} : g);
  lsSet(LS.grp, JOINED);
  if(remote && USER) set("users/"+USER.uid+"/groups/"+id, {name:name||id, at:Date.now()});
}
function forgetGroup(id){
  JOINED = JOINED.filter(g=>g.id!==id); lsSet(LS.grp, JOINED);
  if(subs[id]){ subs[id](); delete subs[id]; }
  delete DATA[id];
  if(remote && USER){
    del("users/"+USER.uid+"/groups/"+id);
    // And the invite that brought it here. Left behind, the app read it on the
    // next load and put the group straight back on the list - so leaving a
    // group, or losing a deleted one, never stuck.
    if(USER.email) del("invites/"+emailKey(USER.email)+"/"+id);
  }
}
function groupName(id){
  const g=DATA[id]&&DATA[id].meta&&DATA[id].meta.name;
  if(g) return g;
  const j=JOINED.find(x=>x.id===id);
  return j? j.name : "Group";
}
