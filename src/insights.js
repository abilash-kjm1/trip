/* =========================== VISUALIZE ===========================
   Four pictures, each answering one question people actually ask: who pays
   whom to finish this, when the money was spent, what it went on, and whose
   turn it is to pay. The chips at the top narrow every one of them to a
   single group. A debt is only ever listed once - how long it has waited is
   a tag on the payment itself, not a second list of the same thing. */
let VZ_SEEN = false, VZ_ENTER = false, VZ_N = 0;
let VZ_SCOPE = "all", VZ_WHO = "all", VZ_DAY = null, VZ_FOCUS = null;
const VZ_CAT_TINT = {general:"#8A8F84", food:"#B4703E", grocery:"#4F7A5C", transport:"#4A6A8A", fuel:"#86691A",
  home:"#7A5A86", utilities:"#3F7F7A", travel:"#5B7DB1", lodging:"#A0527A", fun:"#C07A2C", shopping:"#6E8B3D", health:"#A64B4B"};
const vzColor = (c)=> /^#[0-9a-f]{3,8}$/i.test(String(c||"")) ? c : "#8E99A6";
const vzTint = (k)=> VZ_CAT_TINT[k] || "#8A8F84";

function viewInsights(main){
  setTitle(main, "Visualize");
  VZ_ENTER = !VZ_SEEN; VZ_SEEN = true; VZ_N = 0;
  if(!joinedHere().length){
    main.appendChild(el("div","empty",
      '<span class="ms" aria-hidden="true">insights</span><h3>Nothing to picture yet</h3>'+
      '<p>Join or start a group and add a few expenses - this fills in on its own.</p>'));
    return;
  }
  const all = joinedHere().filter(g=> loaded(g.id)).sort((a,b)=> vzLastAt(b.id)-vzLastAt(a.id));
  if(VZ_SCOPE!=="all" && !all.some(g=> g.id===VZ_SCOPE)) VZ_SCOPE = "all";
  const gids = VZ_SCOPE==="all" ? all.map(g=> g.id) : [VZ_SCOPE];
  if(all.length>1) vzScopeChips(main, all);
  if(!gids.length){
    main.appendChild(el("div","empty",'<span class="ms" aria-hidden="true">hourglass_empty</span><h3>Loading your groups</h3>'));
    return;
  }
  // No expenses at all: one invitation, not four empty cards in a row.
  if(!gids.some(g=> expensesOf(g).length)){
    const e=el("div","empty");
    e.innerHTML='<span class="ms" aria-hidden="true">insights</span><h3>Nothing to picture yet</h3>'+
      '<p>Add an expense to '+(gids.length>1 ? 'any of your groups' : esc(groupName(gids[0])))+' and it’s drawn here.</p>';
    const b=el("button","btn p","Add an expense"); b.type="button";
    b.addEventListener("click", ()=>{ QA_LAST=gids[0]; sheetQuickAdd(); });
    e.appendChild(b);
    main.appendChild(e);
    return;
  }
  const L = vzLedger(gids);
  vzFlow(main, L, gids);
  vzTimeline(main, gids);
  vzWhere(main, gids);
  vzFair(main, gids);
}

function vzScopeChips(main, all){
  const bar=el("div","vz-scope");
  bar.setAttribute("role","group"); bar.setAttribute("aria-label","Which groups to show");
  const add=(id, label)=>{
    const c=el("button","chip"); c.type="button"; c.textContent=label;
    c.setAttribute("aria-pressed", VZ_SCOPE===id ? "true" : "false");
    c.addEventListener("click", ()=>{
      if(VZ_SCOPE===id) return;
      VZ_SCOPE=id; VZ_DAY=null; VZ_FOCUS=null; render();
    });
    bar.appendChild(c);
  };
  add("all", "All groups");
  all.forEach(g=> add(g.id, groupName(g.id)));
  main.appendChild(bar);
}

function vzSection(main, icon, title, sub){
  const s=el("div","vz-sec"+(VZ_ENTER?" enter":""));
  s.style.animationDelay=(VZ_N++*80)+"ms";
  s.innerHTML='<div class="vz-head"><span class="vz-ic"><span class="ms" aria-hidden="true">'+icon+'</span></span>'+
    '<div><h2>'+esc(title)+'</h2><p>'+esc(sub)+'</p></div></div>';
  main.appendChild(s);
  return s;
}
function vzLastAt(gid){
  let t=Number((DATA[gid]&&DATA[gid].meta&&DATA[gid].meta.at)||0);
  expensesOf(gid).forEach(e=>{ const a=Number(e.at)||0; if(a>t) t=a; });
  paymentsOf(gid).forEach(p=>{ const a=Number(p.at)||0; if(a>t) t=a; });
  return t;
}
function vzPayBtn(onClick){
  const b=el("button","vz-btn","Pay"); b.type="button";
  b.addEventListener("click", onClick);
  return b;
}
function vzRemindBtn(gid, who, amt){
  const key=gid+"|"+who;
  const b=el("button","vz-btn soft", NUDGED[key] ? "Reminder sent" : "Remind"); b.type="button";
  b.disabled=!!NUDGED[key];
  b.addEventListener("click", ()=>{ if(sendNudge(gid, who, amt, b)) NUDGED[key]=true; });
  return b;
}
function vzSlideHTML(id, label){
  return '<div class="pf-slide" id="'+id+'" role="slider" aria-label="'+esc(label)+'" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">'+
    '<span class="pf-slide-fill" aria-hidden="true"></span><span class="pf-slide-text">'+esc(label)+'</span>'+
    '<span class="pf-slide-knob" tabindex="0" role="button" aria-label="Drag right to confirm, or press End">'+
      '<span class="ms" aria-hidden="true">arrow_forward</span></span></div>';
}

/* Every debt in the chosen groups, with each person known across groups - by
   their account where they have one, by name where they do not - and then
   netted between each pair: owing Kavya $30 in one group and being owed $20
   by her in another becomes one $10 payment. Only pairs are netted, never
   routed through a third person. Every group on screen shares one currency
   (joinedHere is one side at a time), but pairs are still keyed by it. */
function vzLedger(gids){
  const meKey = USER ? "u:"+USER.uid : null;
  const people = {};
  const touch=(gid, name)=>{
    const m=membersOf(gid).find(x=>x.name===name);
    const key = m && m.uid ? "u:"+m.uid : "n:"+normName(name);
    if(!people[key]){
      const d = m && m.uid && DIRECTORY[m.uid];
      people[key]={key, uid:(m&&m.uid)||null, name: key===meKey ? "You" : ((d&&d.name)||name),
        color: vzColor((m&&m.color)||colorOf(name, gid)), photo:(m&&m.photo)||null, net:0};
    }
    return people[key];
  };
  const edges=[];
  gids.forEach(gid=>{
    transferPlan(gid).forEach(s=>{
      const a=touch(gid, s.from), b=touch(gid, s.to);
      if(a.key===b.key) return;
      a.net-=s.amt; b.net+=s.amt;
      edges.push({gid, cur:curOf(gid), from:a.key, to:b.key, fromName:s.from, toName:s.to, amt:s.amt});
    });
  });
  const pairs={};
  edges.forEach(e=>{
    const lo = e.from<e.to ? e.from : e.to, hi = e.from<e.to ? e.to : e.from;
    const k=e.cur+"|"+lo+"|"+hi;
    (pairs[k]=pairs[k]||{lo, hi, cur:e.cur, sum:0, parts:[]});
    pairs[k].sum += (e.from===lo ? 1 : -1) * e.amt;
    pairs[k].parts.push(e);
  });
  const transfers=Object.keys(pairs).map(k=>{
    const p=pairs[k], s=Math.round(p.sum*100)/100;
    return {from: s>=0 ? p.lo : p.hi, to: s>=0 ? p.hi : p.lo, amt: Math.abs(s), cur: p.cur, parts: p.parts};
  });
  return {meKey, people, edges, transfers};
}

/* Days a debt between two people has been waiting: from the last time money
   moved between them, or the first expense they shared after it. */
function vzAge(e){
  const gid=e.gid, a=e.fromName, b=e.toName;
  let since=0;
  paymentsOf(gid).forEach(p=>{
    if((p.from===a && p.to===b) || (p.from===b && p.to===a)){ const t=Number(p.at)||0; if(t>since) since=t; }
  });
  let start=null;
  expensesOf(gid).forEach(x=>{
    const at=Number(x.at)||0; if(!at || at<=since) return;
    const sh=sharesOf(x);
    if(((x.payer===a && sh[b]) || (x.payer===b && sh[a])) && (start===null || at<start)) start=at;
  });
  if(start===null) expensesOf(gid).forEach(x=>{ const at=Number(x.at)||0; if(at>since && (start===null || at<start)) start=at; });
  return start ? Math.max(0, Math.floor((Date.now()-start)/864e5)) : 0;
}

/* ---------- 1. who pays whom ---------- */
function vzFlow(main, L, gids){
  const one = gids.length===1;
  const sec=vzSection(main, "hub", "Who pays whom",
    !one ? "Every debt across your groups, netted into the fewest payments."
    : simplifyOn(gids[0]) ? "The fewest payments that settle "+groupName(gids[0])+"."
    : "What each pair owes each other in "+groupName(gids[0])+".");
  const moves=L.transfers.filter(t=>t.amt>0.004);
  const card=el("div","card vz-card");
  sec.appendChild(card);
  if(!moves.length){
    card.innerHTML='<div class="vz-empty"><span class="ms" aria-hidden="true">celebration</span><b>Everyone is square</b>'+
      '<p>Nobody owes anybody '+(one ? 'in '+esc(groupName(gids[0])) : 'in any of your groups')+'.</p></div>';
  } else {
    const before=L.edges.length;
    card.innerHTML=
      '<div class="vz-headline"><span class="vz-big">'+moves.length+'</span><span>payment'+(moves.length===1?'':'s')+
        ' settle'+(moves.length===1?'s':'')+' everything'+(before>moves.length ? ' <em>instead of '+before+'</em>' : '')+'</span></div>';
    const net=vzNetwork(L, moves);
    card.appendChild(net.el);
    const tones={}; moves.forEach(t=>{ tones[t.from===L.meKey ? "out" : t.to===L.meKey ? "in" : "other"]=1; });
    const keys=[["out","You pay"],["in","Paid to you"],["other","Between others"]].filter(x=>tones[x[0]]);
    if(keys.length>1 || !tones.other){
      card.appendChild(el("p","vz-legendline", keys.map(x=>'<span><i class="vz-key '+x[0]+'"></i>'+x[1]+'</span>').join("")));
    }
    if(net.people>2) card.appendChild(el("p","vz-hint","Tap someone to see only their payments."));
    const list=el("div","vz-list");
    const rank=t=> t.from===L.meKey ? 0 : t.to===L.meKey ? 1 : 2;
    const ini=p=> p.key===L.meKey && USER ? USER.name : p.name;   // your own initials, not "Y" for You
    moves.slice().sort((a,b)=> rank(a)-rank(b) || b.amt-a.amt).forEach(t=>{
      const A=L.people[t.from], B=L.people[t.to], out=t.from===L.meKey, inn=t.to===L.meKey;
      const gnames=[]; t.parts.forEach(p=>{ const n=groupName(p.gid); if(gnames.indexOf(n)<0) gnames.push(n); });
      const days=Math.max.apply(null, t.parts.map(vzAge));
      const age = days>=30 ? '<span class="vz-age old">'+days+' days</span>'
                : days>=14 ? '<span class="vz-age warm">'+days+' days</span>' : '';
      const meta = !one ? gnames.join(", ") : (t.parts.length>1 ? "Nets "+t.parts.length+" debts" : "");
      const r=el("div","vz-move");
      r.innerHTML=
        '<span class="vz-pair">'+avatarHTML("", ini(A), A.color, A.photo)+'<span class="ms" aria-hidden="true">arrow_forward</span>'+
          avatarHTML("", ini(B), B.color, B.photo)+'</span>'+
        '<span class="vz-b"><span class="vz-t"><b>'+esc(A.name)+'</b> '+(out?'pay':'pays')+' <b>'+esc(inn?'you':B.name)+'</b></span>'+
          ((age || meta) ? '<span class="vz-m">'+age+esc(meta)+'</span>' : '')+'</span>'+
        '<span class="vz-r"><span class="vz-val '+(out?'neg':inn?'pos':'')+'">'+esc(money(t.amt, t.cur))+'</span></span>';
      const right=r.querySelector(".vz-r");
      if(out) right.appendChild(vzPayBtn(()=> sheetNetSettle(t, L)));
      else if(inn){
        const p=t.parts.filter(x=>x.to===L.meKey).sort((a,b)=>b.amt-a.amt)[0];
        if(p) right.appendChild(vzRemindBtn(p.gid, p.fromName, t.amt));
      }
      list.appendChild(r);
    });
    card.appendChild(list);
  }
  // Even with somebody overall, while each group still shows a debt.
  L.transfers.filter(t=>t.amt<=0.004 && (t.from===L.meKey || t.to===L.meKey)).forEach(t=>{
    const other=L.people[t.from===L.meKey ? t.to : t.from];
    const n=el("div","vz-even");
    n.innerHTML='<span class="ms" aria-hidden="true">balance</span><span>Even with <b>'+esc(other.name)+
      '</b> across groups, but each group still shows a debt.</span>';
    const b=el("button","vz-btn soft","Mark even"); b.type="button";
    b.addEventListener("click", ()=> sheetNetSettle(t, L));
    n.appendChild(b);
    card.appendChild(n);
  });
}

/* The diagram: faces on a ring (you in the middle when you're in it), one
   curved arrow per payment, thicker for more money, with a small dot of money
   travelling along it. Faces, names and amounts are real HTML laid over the
   drawing, so photos load, text stays sharp, and every colour follows the
   theme. Tapping a face fades everything that doesn't involve them. */
function vzNetwork(L, moves){
  const keys=[];
  moves.forEach(t=>[t.from, t.to].forEach(k=>{ if(keys.indexOf(k)<0) keys.push(k); }));
  const n=keys.length, W=340, cx=W/2, rx=W/2-44, ry = n<=4 ? 86 : n<=6 ? 102 : 116, dense=n>=5;
  const hasMe=keys.indexOf(L.meKey)>-1, pos={};
  // You sit in the middle only when there are enough people around you for the
  // spokes to be long enough to label. With three or fewer, a middle would
  // leave no room between two faces for an amount, so everyone goes on the
  // ring - you at the bottom - and the short spokes become long chords.
  const center = hasMe && n>=5;
  if(n===2){
    // Two people read left to right: whoever pays on the left.
    pos[keys[0]]={x:cx-rx*.8, y:0}; pos[keys[1]]={x:cx+rx*.8, y:0};
  } else {
    if(center) pos[L.meKey]={x:cx, y:0};
    let ring=keys.filter(k=>!(center && k===L.meKey));
    let start=-Math.PI/2;
    if(!center && hasMe){                       // anchor You at the bottom
      ring=[L.meKey].concat(ring.filter(k=>k!==L.meKey));
      start=Math.PI/2;
    }
    ring.forEach((k,i)=>{
      const a=start + i*2*Math.PI/ring.length;
      pos[k]={x:cx+rx*Math.cos(a), y:ry*Math.sin(a)};
    });
  }
  // The drawing is as tall as where the faces actually landed - three people
  // make a triangle, and a fixed height left a dead strip under it. Room above
  // for the top name and below for the bottom names.
  const ys=keys.map(k=>pos[k].y), top=Math.min.apply(null, ys), bot=Math.max.apply(null, ys);
  const padTop = n>2 ? 48 : 32, padBot = 50;
  keys.forEach(k=>{ pos[k].y += padTop-top; });
  const H=Math.round(bot-top+padTop+padBot);
  const cy = center ? pos[L.meKey].y : padTop+(bot-top)/2;
  // In drawing units, matching the faces' sizes at a phone's width (where the
  // drawing is scaled to about 0.92), so each arrow stops at a face's edge.
  const R=k=> k===L.meKey ? (dense ? 25 : 27) : (dense ? 21 : 23);
  const f=v=>Math.round(v*10)/10, pct=(v, of)=> (v/of*100).toFixed(2)+"%";
  const maxAmt=Math.max.apply(null, moves.map(t=>t.amt)) || 1;
  const still = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  let edges="", dots="", pills="", nodes="";
  moves.forEach((t,i)=>{
    const a=pos[t.from], b=pos[t.to];
    const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy)||1;
    const bend = n===2 ? 0 : Math.min(28, len*.18);
    const mx0=(a.x+b.x)/2, my0=(a.y+b.y)/2;
    let nx=-dy/len, ny=dx/len;
    // Always bow away from the middle of the drawing, so a line between two
    // other people curves around you instead of cutting across your face.
    if(Math.hypot(mx0+nx-cx, my0+ny-cy) < Math.hypot(mx0-cx, my0-cy)){ nx=-nx; ny=-ny; }
    const qx=mx0+nx*bend, qy=my0+ny*bend;
    const toward=(p, r)=>{ const vx=qx-p.x, vy=qy-p.y, d=Math.hypot(vx,vy)||1; return {x:p.x+vx/d*r, y:p.y+vy/d*r}; };
    const s=toward(a, R(t.from)+5), e=toward(b, R(t.to)+10);
    const tone = t.from===L.meKey ? "out" : t.to===L.meKey ? "in" : "other";
    const d="M"+f(s.x)+" "+f(s.y)+" Q"+f(qx)+" "+f(qy)+" "+f(e.x)+" "+f(e.y);
    const ab=' data-a="'+esc(t.from)+'" data-b="'+esc(t.to)+'"';
    edges+='<path class="vz-edge '+tone+'"'+ab+' d="'+d+'" stroke-width="'+f(2.2+3*t.amt/maxAmt)+'" marker-end="url(#vzTip-'+tone+')"/>';
    if(!still){
      const begin=(i*.45).toFixed(2)+"s";
      dots+='<circle class="vz-dot '+tone+'"'+ab+' r="3.2" opacity="0">'+
        '<animateMotion dur="2.6s" begin="'+begin+'" repeatCount="indefinite" path="'+d+'"/>'+
        '<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.15;.8;1" dur="2.6s" begin="'+begin+'" repeatCount="indefinite"/></circle>';
    }
    // Centred on the stretch of line you can actually see between the two
    // faces, and without ".00" - the exact figure is in the list below, and a
    // narrower label keeps clear of both faces and the arrowhead.
    const mx=.25*s.x+.5*qx+.25*e.x, my=.25*s.y+.5*qy+.25*e.y;
    pills+='<span class="vz-amt '+tone+'"'+ab+' style="left:'+pct(mx,W)+';top:'+pct(my,H)+'">'+
      esc(money(t.amt, t.cur).replace(/\.00$/, ""))+'</span>';
  });
  keys.forEach(k=>{
    const p=L.people[k], q=pos[k], me=k===L.meKey;
    const up = !me && n>2 && q.y < cy-10;
    // "is-me", not "me": the app already has a global .me (the account button
    // in the top bar), and its overflow:hidden clipped the You badge away.
    nodes+='<button type="button" class="vz-node'+(me?' is-me':'')+(up?' up':'')+'" data-k="'+esc(k)+'" '+
      'style="left:'+pct(q.x,W)+';top:'+pct(q.y,H)+'" aria-pressed="false" aria-label="'+esc(me ? "You" : p.name)+'">'+
      avatarHTML("", me && USER ? USER.name : p.name, p.color, p.photo)+
      '<span class="vz-nm">'+esc(me ? "You" : p.name)+'</span></button>';
  });
  const tip=tone=>'<marker id="vzTip-'+tone+'" viewBox="0 0 10 10" refX="6" refY="5" markerUnits="userSpaceOnUse" '+
    'markerWidth="10" markerHeight="10" orient="auto"><path class="vz-tip '+tone+'" d="M1 1L9 5L1 9z"/></marker>';
  const wrap=el("div","vz-net"+(dense ? " dense" : ""));
  wrap.style.aspectRatio=W+" / "+H;
  wrap.setAttribute("role","group"); wrap.setAttribute("aria-label","Who pays whom");
  wrap.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" aria-hidden="true" focusable="false"><defs>'+tip("out")+tip("in")+tip("other")+'</defs>'+
    edges+dots+'</svg>'+pills+nodes;
  const apply=()=>{
    const focus = VZ_FOCUS && keys.indexOf(VZ_FOCUS)>-1 ? VZ_FOCUS : null;
    wrap.classList.toggle("focus", !!focus);
    wrap.querySelectorAll("[data-a]").forEach(x=> x.classList.toggle("dim", !(x.dataset.a===focus || x.dataset.b===focus)));
    wrap.querySelectorAll(".vz-node").forEach(x=>{
      const k=x.dataset.k, on=k===focus;
      const linked = moves.some(t=> (t.from===focus && t.to===k) || (t.to===focus && t.from===k));
      x.classList.toggle("on", on);
      x.classList.toggle("dim", !on && !linked);
      x.setAttribute("aria-pressed", on ? "true" : "false");
    });
  };
  wrap.addEventListener("click", ev=>{
    const nd=ev.target.closest(".vz-node");
    VZ_FOCUS = nd ? (VZ_FOCUS===nd.dataset.k ? null : nd.dataset.k) : null;
    apply();
  });
  apply();
  return {el:wrap, people:n};
}

/* One payment to somebody that clears what you owe them in every group, less
   what they owe you. Written as a payment in each group so every group's own
   balances come out right: what you owed is paid, and what they owed you is
   marked as netted against it - not as money you received. */
function sheetNetSettle(t, L){
  const iSend = t.from===L.meKey && t.amt>0.004;
  if(!iSend && t.amt>0.004) return;              // only whoever pays records it
  const other=L.people[t.from===L.meKey ? t.to : t.from];
  const groups=[]; t.parts.forEach(p=>{ if(groups.indexOf(p.gid)<0) groups.push(p.gid); });
  const lines=t.parts.map(p=>{
    const mineOut=p.from===L.meKey;
    return '<div class="ns-line"><span>'+esc(groupName(p.gid))+'</span><span class="'+(mineOut?'neg':'pos')+'">'+
      (mineOut ? 'You owe ' : 'Owes you ')+esc(money(p.amt, t.cur))+'</span></div>';
  }).join("");
  openSheet(iSend ? "Settle with "+other.name : "Even with "+other.name, (b)=>{
    b.innerHTML=
      '<p class="pf-sub">'+(t.parts.length>1
        ? 'One payment clears '+t.parts.length+' debts in '+groups.length+' group'+(groups.length===1?'':'s')+'.'
        : 'This clears the debt.')+'</p>'+
      '<div class="ns-lines">'+lines+
        '<div class="ns-line total"><span>'+(iSend ? 'You send' : 'Nothing to send')+'</span><b>'+esc(money(t.amt, t.cur))+'</b></div></div>'+
      '<div id="nsEtx"></div>'+
      vzSlideHTML("nsSlide", iSend ? "Slide to record "+money(t.amt, t.cur) : "Slide to mark even")+
      '<p class="pf-slide-hint">'+(t.parts.some(p=>p.to===L.meKey)
        ? 'What '+esc(other.name)+' owed you is marked as netted, not as money received.'
        : 'Slide all the way across to record it.')+'</p>';
    if(iSend){
      const p0=t.parts.find(p=>p.from===L.meKey) || t.parts[0];
      drawEtx($("nsEtx"), p0.gid, p0.fromName, p0.toName, t.amt, null);
    }
    const save=()=>{
      const at=Date.now(), multi=t.parts.length>1;
      t.parts.forEach(p=>{
        const mineOut=p.from===L.meKey, amt=Math.round(p.amt*100)/100;
        const rec={from:p.fromName, to:p.toName, amount:amt, at:at, by:meIn(p.gid)||USER.name, byUid:USER.uid,
          note: mineOut ? (multi ? "Net settle-up across groups" : "") : "Netted against other groups"};
        if(!mineOut) rec.netted=true;
        else rec.ask=true;                 // real money moved: its receiver is asked
        const key="p"+uid();
        set("trips/"+p.gid+"/payments/"+key, rec);
        notify("payment.add", p.gid, {desc: mineOut ? rec.from+" paid "+rec.to : rec.from+"'s debt to "+rec.to+" netted",
                                      amount:amt, ref:key});
      });
      closeSheet();
      setTimeout(()=> iSend ? celebratePayment(t.amt, other.name, t.cur) : toast("Marked even with "+other.name), 260);
      return true;
    };
    slideToConfirm($("nsSlide"), save);
  });
}

/* ---------- 2. when it was spent ---------- */
function vzStart(ts, unit){
  const d=new Date(ts); d.setHours(0,0,0,0);
  if(unit==="week") d.setDate(d.getDate()-(d.getDay()+6)%7);   // weeks start on Monday
  else if(unit==="month") d.setDate(1);
  return d.getTime();
}
function vzNext(ts, unit){
  const d=new Date(ts);
  if(unit==="day") d.setDate(d.getDate()+1);
  else if(unit==="week") d.setDate(d.getDate()+7);
  else d.setMonth(d.getMonth()+1);
  return d.getTime();
}
function vzTimeline(main, gids){
  const pts=[];
  gids.forEach(g=>{
    const me=meIn(g);
    expensesOf(g).forEach(e=>{
      const at=Number(e.at)||0; if(!at) return;
      pts.push({at, amt:Number(e.amount)||0, mine: me ? (sharesOf(e)[me]||0) : 0});
    });
  });
  if(!pts.length) return;
  const cur=curOf(gids[0]);
  const lo=Math.min.apply(null, pts.map(p=>p.at)), hi=Math.max.apply(null, pts.map(p=>p.at));
  const span=Math.round((vzStart(hi,"day")-vzStart(lo,"day"))/864e5)+1;
  // A trip reads day by day; a flat that's been going for a year, by month.
  const unit = span<=14 ? "day" : span<=98 ? "week" : "month";
  const buckets=[], end=vzStart(hi, unit);
  for(let s=vzStart(lo, unit), guard=0; s<=end && guard<400; s=vzNext(s, unit), guard++) buckets.push({s, total:0, mine:0});
  pts.forEach(p=>{ const s=vzStart(p.at, unit), b=buckets.find(x=>x.s===s); if(b){ b.total+=p.amt; b.mine+=p.mine; } });
  const total=pts.reduce((a,p)=>a+p.amt, 0), hasMine=pts.some(p=>p.mine>0.004);
  const max=Math.max.apply(null, buckets.map(b=>b.total)) || 1;
  let busy=0; buckets.forEach((b,i)=>{ if(b.total>buckets[busy].total) busy=i; });
  const oneYear = new Date(lo).getFullYear()===new Date(hi).getFullYear();
  const short=s=> new Date(s).toLocaleDateString(undefined, unit==="month"
    ? (oneYear ? {month:"short"} : {month:"short", year:"2-digit"}) : {month:"short", day:"numeric"});
  const long=s=> unit==="day" ? new Date(s).toLocaleDateString(undefined, {weekday:"short", month:"short", day:"numeric"})
    : unit==="week" ? "Week of "+new Date(s).toLocaleDateString(undefined, {month:"short", day:"numeric"})
    : new Date(s).toLocaleDateString(undefined, {month:"long", year:"numeric"});
  const per = unit==="day" ? "Day by day" : unit==="week" ? "Week by week" : "Month by month";
  const sec=vzSection(main, "bar_chart", "When it was spent",
    per+", what was spent"+(hasMine ? " - and your part of it." : "."));
  const card=el("div","card vz-card"); sec.appendChild(card);
  const n=buckets.length;
  const over = unit==="day" ? (n===1 ? "in a single day" : "over "+n+" days") : "over "+n+" "+unit+(n===1?"":"s");
  const step=Math.max(1, Math.ceil(n/6)), H=118;
  let sel=buckets.findIndex(b=>b.s===VZ_DAY); if(sel<0) sel=busy;
  card.innerHTML=
    '<div class="vz-headline"><span class="vz-big">'+esc(money(total, cur))+'</span><span>spent '+over+'</span></div>'+
    '<div class="vz-read" aria-live="polite"></div>'+
    '<div class="vz-cols'+(n<=8 ? ' few' : '')+'">'+buckets.map((b,i)=>{
      const has=b.total>0.004, h=has ? Math.max(6, b.total/max*H) : 3, mh=has ? Math.min(h, b.mine/b.total*h) : 0;
      return '<button type="button" class="vz-col'+(has ? '' : ' zero')+'" aria-pressed="false" '+
          'aria-label="'+esc(long(b.s)+": "+(has ? money(b.total, cur)+" spent" : "nothing spent"))+'">'+
        '<span class="vz-colbox"><span class="vz-colbar" style="height:'+h.toFixed(1)+'px">'+
          (mh>0.5 ? '<span class="vz-colmine" style="height:'+mh.toFixed(1)+'px"></span>' : '')+'</span></span>'+
        '<span class="vz-col-l'+(i%step===0 ? '' : ' hide')+'">'+esc(short(b.s))+'</span></button>';
    }).join("")+'</div>'+
    (hasMine ? '<div class="vz-keys"><span><i class="all"></i>Everyone</span><span><i class="mine"></i>Your share</span></div>' : '');
  const read=card.querySelector(".vz-read"), cols=card.querySelectorAll(".vz-col");
  const pick=i=>{
    VZ_DAY=buckets[i].s;
    cols.forEach((c,j)=>{ c.classList.toggle("on", j===i); c.setAttribute("aria-pressed", j===i ? "true" : "false"); });
    const b=buckets[i], has=b.total>0.004;
    read.innerHTML='<span class="vz-read-d">'+esc(long(b.s))+
        (i===busy && n>1 && has ? '<em>Busiest '+unit+'</em>' : '')+'</span>'+
      '<span class="vz-read-v">'+(has
        ? esc(money(b.total, cur))+(hasMine ? '<small>your share '+esc(money(b.mine, cur))+'</small>' : '')
        : '<small>Nothing spent</small>')+'</span>';
  };
  cols.forEach((c,j)=> c.addEventListener("click", ()=> pick(j)));
  pick(sel);
}

/* ---------- 3. where it went ---------- */
function vzWhere(main, gids){
  const all={}, mine={}; let tAll=0, tMine=0, paid=0;
  gids.forEach(g=>{
    const me=meIn(g);
    expensesOf(g).forEach(e=>{
      const a=Number(e.amount)||0, k=catOf(e.cat).k;
      all[k]=(all[k]||0)+a; tAll+=a;
      if(!me) return;
      if(e.payer===me) paid+=a;
      const s=sharesOf(e)[me]||0;
      if(s>0.004){ mine[k]=(mine[k]||0)+s; tMine+=s; }
    });
  });
  if(tAll<0.005) return;
  const cur=curOf(gids[0]), hasMine=tMine>0.004;
  if(VZ_WHO==="you" && !hasMine) VZ_WHO="all";
  const sec=vzSection(main, "donut_large", "Where it went", "What the money was spent on, by category.");
  const card=el("div","card vz-card"); sec.appendChild(card);
  const draw=()=>{
    const you=VZ_WHO==="you", cats=you ? mine : all, tot=you ? tMine : tAll;
    const order=Object.keys(cats).filter(k=>cats[k]>0.004).sort((a,b)=>cats[b]-cats[a]);
    const R=52, C=2*Math.PI*R, gap=order.length>1 ? 2.2 : 0;
    let off=0;
    const segs=order.map(k=>{
      const len=cats[k]/tot*C;
      const s='<circle class="vz-seg" cx="65" cy="65" r="'+R+'" style="stroke:'+vzTint(k)+'" '+
        'stroke-dasharray="'+Math.max(.01, len-gap).toFixed(2)+' '+C.toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'"/>';
      off+=len; return s;
    }).join("");
    const diff=Math.round((paid-tMine)*100)/100;
    const totTxt=money(tot, cur), fs = totTxt.length<=7 ? 21 : totTxt.length<=8 ? 19 : totTxt.length<=10 ? 16 : 14;
    card.innerHTML=
      (hasMine ? '<div class="vz-toggle" role="group" aria-label="Whose spending">'+
        '<button type="button" data-w="all" aria-pressed="'+(!you)+'">Everyone</button>'+
        '<button type="button" data-w="you" aria-pressed="'+you+'">Your share</button></div>' : '')+
      '<div class="vz-where">'+
        '<div class="vz-donut"><svg viewBox="0 0 130 130" aria-hidden="true" focusable="false">'+
          '<circle class="trk" cx="65" cy="65" r="'+R+'"/>'+segs+'</svg>'+
          '<div class="vz-donut-c"><b style="font-size:'+fs+'px">'+esc(totTxt)+'</b><small>'+(you ? 'your share' : 'spent')+'</small></div></div>'+
        '<div class="vz-cats">'+order.map(k=>{
          const p=cats[k]/tot*100, ps = p>0 && p<1 ? "<1%" : Math.round(p)+"%";
          return '<div class="vz-cat"><span class="ms" aria-hidden="true" style="background:'+vzTint(k)+'">'+catOf(k).i+'</span>'+
            '<span class="vz-cat-n">'+esc(catOf(k).n)+'<small>'+ps+'</small></span><b>'+esc(money(cats[k], cur))+'</b></div>';
        }).join("")+'</div>'+
      '</div>'+
      (you ? '<p class="vz-note">You paid <b>'+esc(money(paid, cur))+'</b> of it upfront'+
        (diff>0.004 ? ' - <b>'+esc(money(diff, cur))+'</b> more than your share.'
         : diff<-0.004 ? ' - <b>'+esc(money(-diff, cur))+'</b> less than your share.' : ' - exactly your share.')+'</p>' : '');
    card.querySelectorAll(".vz-toggle button").forEach(b=> b.addEventListener("click", ()=>{
      if(VZ_WHO===b.dataset.w) return;
      VZ_WHO=b.dataset.w; draw();
    }));
  };
  draw();
}

/* ---------- 4. whose turn to pay ---------- */
function vzFairOf(gid){
  const ppl=names(gid);
  if(ppl.length<2 || !expensesOf(gid).length) return null;
  const me=meIn(gid), paid={}, share={};
  ppl.forEach(n=>{ paid[n]=0; share[n]=0; });
  expensesOf(gid).forEach(e=>{
    const a=Number(e.amount)||0;
    if(paid[e.payer]!=null) paid[e.payer]+=a;
    const sh=sharesOf(e); Object.keys(sh).forEach(n=>{ if(share[n]!=null) share[n]+=sh[n]; });
  });
  // gap: what someone has paid, less what they have used. Below zero, they
  // have paid less than their share - and whoever is furthest below pays next.
  const rows=ppl.map(n=>({n, paid:paid[n], share:share[n], gap:Math.round((paid[n]-share[n])*100)/100, color:vzColor(colorOf(n, gid))}));
  const order=rows.slice().sort((a,b)=> a.gap-b.gap);
  return {gid, me, rows, order, next:order[0], behind: order[0].gap < -0.5};
}
function vzFace(gid, name, color, cls){
  const m=memberOf(name, gid);
  return '<span class="wn-av'+(cls ? ' '+cls : '')+'" style="--c:'+color+(m && m.photo ? '' : ';background:'+color)+'">'+
    (m && m.photo ? '<img src="'+esc(m.photo)+'" alt="" referrerpolicy="no-referrer">' : esc(initials(name)))+'</span>';
}
function vzFair(main, gids){
  const one = gids.length===1;
  const sec=vzSection(main, "balance", "Whose turn to pay",
    one ? "Whoever has paid least compared with their share goes next." : "In each group, who has paid least compared with their share.");
  if(!one){
    const list=gids.map(vzFairOf).filter(Boolean);
    if(!list.length){ sec.appendChild(el("p","vz-note","Add a couple of expenses to a group of two or more to see whose turn it is.")); return; }
    const card=el("div","card vz-card vz-fgs"); sec.appendChild(card);
    list.forEach(f=>{
      const b=el("button","vz-fg"); b.type="button";
      const who=f.next.n===f.me ? "You" : f.next.n;
      b.innerHTML=(f.behind ? vzFace(f.gid, f.next.n, f.next.color, "") :
          '<span class="wn-av even"><span class="ms" aria-hidden="true">handshake</span></span>')+
        '<span class="vz-b"><span class="vz-t"><b>'+esc(groupName(f.gid))+'</b></span>'+
          '<span class="vz-m">'+(f.behind ? esc(who)+' next · '+esc(money(-f.next.gap, f.gid))+' behind' : 'Anyone next · everyone about even')+'</span></span>'+
        '<span class="ms vz-chev" aria-hidden="true">chevron_right</span>';
      b.addEventListener("click", ()=>{ VZ_SCOPE=f.gid; VZ_DAY=null; VZ_FOCUS=null; window.scrollTo(0,0); render(); });
      card.appendChild(b);
    });
    return;
  }
  const f=vzFairOf(gids[0]);
  if(!f){ sec.appendChild(el("p","vz-note","Add a couple of expenses to a group of two or more to see whose turn it is.")); return; }
  const {gid, me, rows, order, next, behind}=f;
  const who=n=> n===me ? "You" : n;
  const tone=g=> g < -0.5 ? "neg" : g > 0.5 ? "pos" : "zero";
  const tag=g=> tone(g)==="neg" ? "−"+money(-g, gid) : tone(g)==="pos" ? "+"+money(g, gid) : "Even";
  const card=el("div","card vz-card"); sec.appendChild(card);
  const hero=el("div","wn-hero"+(behind ? "" : " even"));
  hero.innerHTML = behind
    ? vzFace(gid, next.n, next.color, "big")+
      '<div class="wn-hero-t"><small>Next to pay</small><b>'+esc(who(next.n))+'</b>'+
        '<p>'+(next.n===me ? 'You’ve' : esc(next.n)+' has')+' paid <strong>'+esc(money(-next.gap, gid))+'</strong> less than '+
        (next.n===me ? 'your' : 'their')+' share so far.</p></div>'
    : '<span class="wn-av big even"><span class="ms" aria-hidden="true">handshake</span></span>'+
      '<div class="wn-hero-t"><small>Next to pay</small><b>Anyone</b><p>Everyone has paid about their share.</p></div>';
  card.appendChild(hero);
  if(behind && next.n===me){
    const b=el("button","btn p wn-cta"); b.type="button";
    b.innerHTML='<span class="ms" aria-hidden="true">add</span>Add the next expense';
    b.addEventListener("click", ()=>{ QA_LAST=gid; sheetQuickAdd(); });
    card.appendChild(b);
  }
  card.appendChild(el("div","wn-label","Paid compared with their share"));
  const maxGap=Math.max(1, ...rows.map(r=>Math.abs(r.gap)));
  const list=el("div","wn-list");
  list.innerHTML=
    '<div class="wn-row wn-axis" aria-hidden="true"><span></span><span class="ax"><i>Paid less</i><i>Paid more</i></span><span></span></div>'+
    order.map(r=>{
      const t=tone(r.gap), w=(Math.abs(r.gap)/maxGap*50).toFixed(1);
      return '<div class="wn-row'+(r.n===me ? ' is-me' : '')+'">'+
        '<span class="wn-name"><i style="background:'+r.color+'"></i><span>'+esc(who(r.n))+'</span></span>'+
        '<span class="wn-bar">'+(t==="zero" ? '' : '<span class="wn-fill '+t+'" style="width:'+w+'%"></span>')+'</span>'+
        '<span class="wn-val '+t+'">'+esc(tag(r.gap))+'</span>'+
        '<span class="wn-sub">Paid '+esc(money(r.paid, gid))+' · share '+esc(money(r.share, gid))+'</span>'+
      '</div>';
    }).join("");
  card.appendChild(list);
}
