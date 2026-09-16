/* =========================== VISUALIZE ===========================
   Not charts for their own sake - every part says what to do next:
   settle everything across every group in the fewest payments, whose turn
   it is to pay, what things really cost you, which debts have been left
   waiting, and what stands between you and leaving a group clean. */
let VZ_SEEN = false, VZ_ENTER = false, VZ_N = 0, VZ_GROUP = null;
const VZ_CAT_TINT = {general:"#8A8F84", food:"#B4703E", grocery:"#4F7A5C", transport:"#4A6A8A", fuel:"#86691A",
  home:"#7A5A86", utilities:"#3F7F7A", travel:"#5B7DB1", lodging:"#A0527A", fun:"#C07A2C", shopping:"#6E8B3D", health:"#A64B4B"};
const vzColor = (c)=> /^#[0-9a-f]{3,8}$/i.test(String(c||"")) ? c : "#8E99A6";

function viewInsights(main){
  setTitle(main, "Visualize");
  VZ_ENTER = !VZ_SEEN; VZ_SEEN = true; VZ_N = 0;
  if(!joinedHere().length){
    const e=el("div","empty");
    e.innerHTML='<span class="ms" aria-hidden="true">hub</span><h3>Nothing to show yet</h3>'+
      '<p>Join or start a group and add a few expenses - this fills in on its own.</p>';
    main.appendChild(e);
    return;
  }
  const L=vzLedger();
  vzSettleEverything(main, L);
  vzWhoNext(main);
  vzRealCost(main);
  vzOldDebts(main, L);
  vzLeaveClean(main, L);
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
// Paying a debt in one group opens that group's payment screen, as Today does.
function vzPay(gid, from, to, amt){ openGroup(gid); setTimeout(()=> sheetSettle(from, to, amt, null), 260); }
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

/* Every debt in every group, with each person known across groups - by their
   account where they have one, by name where they do not - and then netted
   between each pair: owing Kavya $30 in one group and being owed $20 by her
   in another becomes one $10 payment. Only pairs are netted, never routed
   through a third person, so nobody is asked to pay somebody they never
   shared anything with. */
function vzLedger(){
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
  joinedHere().forEach(g=>{
    if(!loaded(g.id)) return;
    transferPlan(g.id).forEach(s=>{
      const a=touch(g.id, s.from), b=touch(g.id, s.to);
      if(a.key===b.key) return;
      a.net-=s.amt; b.net+=s.amt;
      edges.push({gid:g.id, cur:curOf(g.id), from:a.key, to:b.key, fromName:s.from, toName:s.to, amt:s.amt});
    });
  });
  // Netted within one currency only. Rupees owed never cancel dollars owed:
  // nothing is converted, so the two stay two payments.
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

/* ---------- 1. settle everything ---------- */
function vzSettleEverything(main, L){
  const sec=vzSection(main, "hub", "Settle everything", "Every debt across your groups, netted into the fewest payments.");
  const moves=L.transfers.filter(t=>t.amt>0.004);
  const card=el("div","card vz-card");
  sec.appendChild(card);
  if(!moves.length){
    card.innerHTML='<div class="vz-empty"><span class="ms" aria-hidden="true">celebration</span><b>Everyone is square</b>'+
      '<p>Nobody owes anybody in any of your groups.</p></div>';
  } else {
    const before=L.edges.length;
    card.innerHTML=
      '<div class="vz-headline"><span class="vz-big">'+moves.length+'</span><span>payment'+(moves.length===1?'':'s')+
        ' clear'+(moves.length===1?'s':'')+' everything'+(before>moves.length ? ' <em>instead of '+before+'</em>' : '')+'</span></div>'+
      vzNetSvg(L, moves)+
      '<p class="vz-legendline"><span class="vz-key out"></span>you pay <span class="vz-key in"></span>paid to you '+
        '<span class="vz-key other"></span>between others</p>';
    const list=el("div","vz-list");
    const rank=t=> t.from===L.meKey ? 0 : t.to===L.meKey ? 1 : 2;
    const ini=p=> p.key===L.meKey && USER ? USER.name : p.name;   // your own initials, not "Y" for You
    moves.slice().sort((a,b)=> rank(a)-rank(b) || b.amt-a.amt).forEach(t=>{
      const A=L.people[t.from], B=L.people[t.to], out=t.from===L.meKey, inn=t.to===L.meKey;
      const gnames=[]; t.parts.forEach(p=>{ const n=groupName(p.gid); if(gnames.indexOf(n)<0) gnames.push(n); });
      const r=el("div","vz-move"+(out||inn?" vz-mine":""));
      r.innerHTML=
        '<span class="vz-pair">'+avatarHTML("", ini(A), A.color, A.photo)+'<span class="ms" aria-hidden="true">arrow_forward</span>'+
          avatarHTML("", ini(B), B.color, B.photo)+'</span>'+
        '<span class="vz-b"><span class="vz-t"><b>'+esc(A.name)+'</b> '+(out?'pay':'pays')+' <b>'+esc(inn?'you':B.name)+'</b></span>'+
          '<span class="vz-m">'+(t.parts.length>1 ? 'Nets '+t.parts.length+' debts · ' : '')+esc(gnames.join(", "))+'</span></span>'+
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

function vzNetSvg(L, moves){
  const keys=[];
  moves.forEach(t=>[t.from, t.to].forEach(k=>{ if(keys.indexOf(k)<0) keys.push(k); }));
  const W=340, H=300, cx=170, cy=142;
  const hasMe=keys.indexOf(L.meKey)>-1, ring=keys.filter(k=>!(hasMe && k===L.meKey)), n=ring.length;
  const pos={};
  if(hasMe) pos[L.meKey]={x:cx, y:cy};
  const rx = (hasMe || n>1) ? 120 : 0, ry = (hasMe || n>1) ? 98 : 0;
  ring.forEach((k,i)=>{
    const a=-Math.PI/2 + i*2*Math.PI/Math.max(1,n) + (hasMe ? 0 : Math.PI/Math.max(2,n));
    pos[k]={x:cx+rx*Math.cos(a), y:cy+ry*Math.sin(a)};
  });
  const f=v=>Math.round(v*10)/10;
  // Line weight and circle size compare amounts, which only means something
  // in one currency. With rupees and dollars on the same drawing, every line
  // is drawn alike and a circle grows with how many payments touch it.
  const oneCur=moves.every(t=> t.cur===moves[0].cur);
  const maxAmt=Math.max.apply(null, moves.map(t=>t.amt)) || 1;
  const maxNet=Math.max.apply(null, keys.map(k=>Math.abs(L.people[k].net))) || 1;
  const deg={}; moves.forEach(t=>{ deg[t.from]=(deg[t.from]||0)+1; deg[t.to]=(deg[t.to]||0)+1; });
  const maxDeg=Math.max.apply(null, keys.map(k=>deg[k]||0)) || 1;
  const rad={}; keys.forEach(k=>{
    rad[k]=17+9*Math.min(1, oneCur ? Math.abs(L.people[k].net)/maxNet : (deg[k]||0)/maxDeg);
  });
  let flows="", labels="", nodes="";
  moves.forEach(t=>{
    const a=pos[t.from], b=pos[t.to];
    const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy)||1;
    const bend=Math.min(30, len*.2), qx=(a.x+b.x)/2 - dy/len*bend, qy=(a.y+b.y)/2 + dx/len*bend;
    const trim=(p, r)=>{ const vx=qx-p.x, vy=qy-p.y, d=Math.hypot(vx,vy)||1; return {x:p.x+vx/d*r, y:p.y+vy/d*r}; };
    const s=trim(a, rad[t.from]+3), e=trim(b, rad[t.to]+8);
    const tone = t.from===L.meKey ? "out" : t.to===L.meKey ? "in" : "other";
    flows+='<path class="vz-flow '+tone+'" d="M'+f(s.x)+' '+f(s.y)+' Q'+f(qx)+' '+f(qy)+' '+f(e.x)+' '+f(e.y)+
      '" stroke-width="'+f(1.8+3.2*t.amt/maxAmt)+'" marker-end="url(#vzA-'+tone+')"/>';
    // On the curve itself, halfway along - clear of the circles at either end.
    const mx=.25*a.x+.5*qx+.25*b.x, my=.25*a.y+.5*qy+.25*b.y;
    labels+='<text class="vz-amt" x="'+f(mx)+'" y="'+f(my+4)+'">'+esc(money(t.amt, t.cur))+'</text>';
  });
  keys.forEach(k=>{
    const p=L.people[k], q=pos[k], r=rad[k], me=k===L.meKey;
    const nm = p.name.length>12 ? p.name.slice(0,11)+"…" : p.name;
    nodes+='<g class="vz-node'+(me?' me':'')+'"><circle cx="'+f(q.x)+'" cy="'+f(q.y)+'" r="'+f(r)+'" style="fill:'+p.color+'"/>'+
      '<text class="ini" x="'+f(q.x)+'" y="'+f(q.y)+'">'+esc(initials(me && USER ? USER.name : p.name))+'</text>'+
      // You sit in the middle with arrows on every side; the ring says it is you.
      (me ? '' : '<text class="nm" x="'+f(q.x)+'" y="'+f(q.y < cy-10 ? q.y-r-7 : q.y+r+14)+'">'+esc(nm)+'</text>')+'</g>';
  });
  const marker=tone=>'<marker id="vzA-'+tone+'" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto">'+
    '<path class="vz-arrow '+tone+'" d="M0 0L10 5L0 10z"/></marker>';
  return '<svg class="vz-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Who pays whom across your groups">'+
    '<defs>'+marker("out")+marker("in")+marker("other")+'</defs>'+flows+nodes+labels+'</svg>';
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

/* ---------- 2. who should pay next ---------- */
function vzWhoNext(main){
  const sec=vzSection(main, "autorenew", "Who should pay next", "Whoever has paid least compared with their share.");
  const groups=joinedHere().filter(g=> loaded(g.id) && expensesOf(g.id).length && names(g.id).length>1)
    .sort((a,b)=> vzLastAt(b.id)-vzLastAt(a.id));
  if(!groups.length){
    sec.appendChild(el("p","vz-note","Add a couple of expenses to a group of two or more to see whose turn it is."));
    return;
  }
  if(!VZ_GROUP || !groups.some(g=>g.id===VZ_GROUP)) VZ_GROUP=groups[0].id;
  const card=el("div","card vz-card"); sec.appendChild(card);
  if(groups.length>1){
    const chips=el("div","vz-chips");
    groups.forEach(g=>{
      const c=el("button","chip"); c.type="button"; c.textContent=groupName(g.id);
      c.setAttribute("aria-pressed", g.id===VZ_GROUP ? "true" : "false");
      c.addEventListener("click", ()=>{ VZ_GROUP=g.id; render(); });
      chips.appendChild(c);
    });
    card.appendChild(chips);
  }
  const gid=VZ_GROUP, ppl=names(gid), me=meIn(gid);
  const paid={}, share={}; ppl.forEach(n=>{ paid[n]=0; share[n]=0; });
  expensesOf(gid).forEach(e=>{
    const a=Number(e.amount)||0;
    if(paid[e.payer]!=null) paid[e.payer]+=a;
    const sh=sharesOf(e); Object.keys(sh).forEach(n=>{ if(share[n]!=null) share[n]+=sh[n]; });
  });
  // gap: what someone has paid, less what they have used. Below zero, they
  // have paid less than their share - and whoever is furthest below pays next.
  const rows=ppl.map(n=>({n, paid:paid[n], share:share[n], gap:Math.round((paid[n]-share[n])*100)/100, color:vzColor(colorOf(n, gid))}));
  const order=rows.slice().sort((a,b)=> a.gap-b.gap);
  const next=order[0];
  const EVEN=0.5;                                   // cents either way is not a turn
  const behind = next.gap < -EVEN;
  const who=n=> n===me ? "You" : n;
  const tone=g=> g < -EVEN ? "neg" : g > EVEN ? "pos" : "zero";
  const tag=g=> tone(g)==="neg" ? "−"+money(-g, gid) : tone(g)==="pos" ? "+"+money(g, gid) : "Even";
  const face=(r, cls)=>{
    const m=memberOf(r.n, gid);
    return '<span class="wn-av'+(cls ? ' '+cls : '')+'" style="--c:'+r.color+(m && m.photo ? '' : ';background:'+r.color)+'">'+
      (m && m.photo ? '<img src="'+esc(m.photo)+'" alt="" referrerpolicy="no-referrer">' : esc(initials(r.n)))+'</span>';
  };

  // 1. The answer, first and large.
  const hero=el("div","wn-hero"+(behind ? "" : " even"));
  hero.innerHTML = behind
    ? face(next, "big")+
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

  // 2. Turn order: who pays first, then who, then who.
  if(order.length>1){
    card.appendChild(el("div","wn-label","Turn order"));
    const q=el("div","wn-queue");
    q.innerHTML=order.map((r,i)=>
      (i ? '<span class="wn-arrow ms" aria-hidden="true">chevron_right</span>' : '')+
      '<div class="wn-q'+(i===0 && behind ? ' first' : '')+'">'+
        '<span class="wn-q-av">'+face(r, "")+'<i>'+(i+1)+'</i></span>'+
        '<span class="nm">'+esc(who(r.n))+'</span>'+
        '<span class="wn-tag '+tone(r.gap)+'">'+esc(tag(r.gap))+'</span>'+
      '</div>').join("");
    card.appendChild(q);
  }

  // 3. Paid against share, from a middle line: left is less, right is more.
  card.appendChild(el("div","wn-label","Paid vs share"));
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
  card.appendChild(el("p","vz-note","Share is each person’s part of every expense in "+groupName(gid)+". Whoever has paid least against it pays next."));
}

/* ---------- 3. what this really cost you ---------- */
function vzRealCost(main){
  const sec=vzSection(main, "pie_chart", "What this really cost you", "Your own share of the spending - not the group’s total.");
  // One card per currency: a share in rupees and a share in dollars are never
  // added together.
  const by={};
  joinedHere().forEach(g=>{
    if(!loaded(g.id)) return;
    const me=meIn(g.id); if(!me) return;
    const c=curOf(g.id);
    const t=by[c]=by[c]||{cats:{}, share:0, paid:0, groupTotal:0, per:[]};
    const gc={}; let gs=0;
    expensesOf(g.id).forEach(e=>{
      const a=Number(e.amount)||0; t.groupTotal+=a;
      if(e.payer===me) t.paid+=a;
      const s=sharesOf(e)[me]||0;
      if(s>0.004){ const k=catOf(e.cat).k; gc[k]=(gc[k]||0)+s; t.cats[k]=(t.cats[k]||0)+s; gs+=s; }
    });
    if(gs>0.004) t.per.push({gid:g.id, share:gs, cats:gc});
    t.share+=gs;
  });
  const curs=Object.keys(CURRENCIES).filter(c=> by[c] && by[c].share>=0.005);
  if(!curs.length){
    const card=el("div","card vz-card"); sec.appendChild(card);
    card.innerHTML='<div class="vz-empty"><span class="ms" aria-hidden="true">receipt_long</span><b>Nothing on you yet</b>'+
      '<p>Once you’re part of an expense, your share shows up here.</p></div>';
    return;
  }
  curs.forEach(c=>{
    const {cats, share, paid, groupTotal, per}=by[c];
    const m=(n)=> esc(money(n, c));
    const card=el("div","card vz-card"); sec.appendChild(card);
    const order=Object.keys(cats).sort((a,b)=> cats[b]-cats[a]);
    const stack=(cmap, tot)=> '<div class="vz-stack">'+order.filter(k=>cmap[k]).map(k=>
      '<i style="width:'+(cmap[k]/tot*100).toFixed(2)+'%;background:'+(VZ_CAT_TINT[k]||"#8A8F84")+'" title="'+esc(catOf(k).n)+'"></i>').join("")+'</div>';
    const diff=Math.round((paid-share)*100)/100;
    card.innerHTML=
      (curs.length>1 ? '<span class="vz-curtag">'+esc(CURRENCIES[c].sym+" "+CURRENCIES[c].name+"s")+'</span>' : '')+
      '<div class="vz-headline"><span class="vz-big">'+m(share)+'</span><span>your share of '+m(groupTotal)+' spent</span></div>'+
      '<p class="vz-note vz-tight">You fronted '+m(paid)+(diff>0.004 ? ' - '+m(diff)+' more than your share.'
        : diff<-0.004 ? ' - '+m(-diff)+' less than your share.' : ', exactly your share.')+'</p>'+
      stack(cats, share)+
      '<div class="vz-legend">'+order.map(k=>
        '<span class="vz-leg"><span class="ms" aria-hidden="true" style="background:'+(VZ_CAT_TINT[k]||"#8A8F84")+'">'+catOf(k).i+'</span>'+
        '<span class="vz-leg-n">'+esc(catOf(k).n)+'</span><b>'+m(cats[k])+'</b></span>').join("")+'</div>'+
      (per.length>1 ? '<div class="vz-gl">'+per.sort((a,b)=> b.share-a.share).map(p=>
        '<div class="vz-gl-row"><span>'+esc(groupName(p.gid))+'</span><b>'+m(p.share)+'</b>'+stack(p.cats, p.share)+'</div>').join("")+'</div>' : '');
  });
}

/* ---------- 4. old debts ---------- */
function vzOldDebts(main, L){
  const sec=vzSection(main, "hourglass_bottom", "Old debts", "How long each balance has been waiting.");
  const now=Date.now(), items=[];
  L.edges.forEach(e=>{
    if(e.from!==L.meKey && e.to!==L.meKey) return;
    const gid=e.gid, a=e.fromName, b=e.toName;
    // From the last time money moved between the two, or the first expense
    // they shared after it.
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
    items.push({e, days: start ? Math.max(0, Math.floor((now-start)/864e5)) : 0});
  });
  const card=el("div","card vz-card"); sec.appendChild(card);
  if(!items.length){
    card.innerHTML='<div class="vz-empty"><span class="ms" aria-hidden="true">task_alt</span><b>No debts waiting</b>'+
      '<p>Nothing is owed to you or by you right now.</p></div>';
    return;
  }
  items.sort((x,y)=> y.days-x.days || y.e.amt-x.e.amt);
  const span=Math.max(45, items[0].days);
  items.forEach(it=>{
    const e=it.e, days=it.days, out=e.from===L.meKey;
    const other=L.people[out ? e.to : e.from], otherName=out ? e.toName : e.fromName;
    const tone=days>30 ? "old" : days>=14 ? "warm" : "fresh";
    const r=el("div","vz-debt");
    r.innerHTML=
      '<div class="vz-debt-top">'+avatarHTML("", other.name, other.color, other.photo)+
        '<span class="vz-b"><span class="vz-t">'+(out ? 'You owe <b>'+esc(other.name)+'</b>' : '<b>'+esc(other.name)+'</b> owes you')+
          ' <b>'+esc(money(e.amt, e.gid))+'</b></span><span class="vz-m">'+esc(groupName(e.gid))+'</span></span>'+
        '<span class="vz-days '+tone+'">'+(days===0 ? "today" : days===1 ? "1 day" : days+" days")+'</span></div>'+
      '<div class="vz-agebar"><i class="'+tone+'" style="width:'+Math.max(4, Math.min(100, days/span*100)).toFixed(1)+'%"></i></div>';
    r.querySelector(".vz-debt-top").appendChild(out
      ? vzPayBtn(()=> vzPay(e.gid, e.fromName, e.toName, e.amt))
      : vzRemindBtn(e.gid, otherName, e.amt));
    card.appendChild(r);
  });
  card.appendChild(el("p","vz-note","Amber after two weeks, red after a month. A gentle reminder now is easier than an awkward one later."));
}

/* ---------- 5. leave clean ---------- */
function vzLeaveClean(main, L){
  const sec=vzSection(main, "door_open", "Leave clean", "What stands between you and walking away from each group owing nothing.");
  const gs=joinedHere().filter(g=> loaded(g.id) && meIn(g.id)).map(g=>({
    gid:g.id, mine:L.edges.filter(e=> e.gid===g.id && (e.from===L.meKey || e.to===L.meKey))
  })).sort((a,b)=> b.mine.length-a.mine.length || groupName(a.gid).localeCompare(groupName(b.gid)));
  if(!gs.length){ sec.appendChild(el("p","vz-note","Say which name is yours in a group to see this.")); return; }
  const wrap=el("div","vz-leave"); sec.appendChild(wrap);
  gs.forEach(g=>{
    const mine=g.mine;
    const pay=mine.filter(e=>e.from===L.meKey).reduce((s,e)=>s+e.amt, 0);
    const get=mine.filter(e=>e.to===L.meKey).reduce((s,e)=>s+e.amt, 0);
    const c=el("div","card vz-lc"+(mine.length ? "" : " clean"));
    c.innerHTML=
      '<div class="vz-lc-h"><b>'+esc(groupName(g.gid))+'</b>'+(mine.length
        ? '<span class="vz-todo">'+mine.length+' to do</span>'
        : '<span class="vz-ok"><span class="ms" aria-hidden="true">check_circle</span>Clean</span>')+'</div>'+
      '<p class="vz-lc-sum">'+(mine.length
        ? (pay>0.004 ? 'Pay <b>'+esc(money(pay, g.gid))+'</b>' : '')+(pay>0.004 && get>0.004 ? ' · ' : '')+
          (get>0.004 ? 'Collect <b>'+esc(money(get, g.gid))+'</b>' : '')
        : 'You owe nothing here and nobody owes you. You can leave any time.')+'</p>';
    mine.forEach(e=>{
      const out=e.from===L.meKey, name=out ? e.toName : e.fromName;
      const line=el("div","vz-lc-line");
      line.innerHTML='<span class="ms" aria-hidden="true">'+(out ? 'north_east' : 'south_west')+'</span>'+
        '<span class="vz-lc-t">'+(out ? 'Pay <b>'+esc(name)+'</b>' : 'Collect from <b>'+esc(name)+'</b>')+'</span>'+
        '<b class="vz-val '+(out ? 'neg' : 'pos')+'">'+esc(money(e.amt, g.gid))+'</b>';
      line.appendChild(out ? vzPayBtn(()=> vzPay(g.gid, e.fromName, e.toName, e.amt)) : vzRemindBtn(g.gid, name, e.amt));
      c.appendChild(line);
    });
    wrap.appendChild(c);
  });
}
