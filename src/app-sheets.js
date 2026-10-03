/* =========================== SHEETS =========================== */
let sheetOnClose=null;
function openSheet(title, build, onClose){
  $("sheetTitle").textContent=title;
  const b=$("sheetBody"); b.innerHTML="";
  build(b);
  sheetOnClose=onClose||null;
  $("scrim").hidden=false; $("sheet").hidden=false;
  $("sheet").scrollTop=0;
  document.body.style.overflow="hidden";
  sheetFit();
}
function closeSheet(){
  $("scrim").hidden=true; $("sheet").hidden=true;
  const s=$("sheet"); s.style.bottom=""; s.style.removeProperty("--vvh");
  document.body.style.overflow="";
  const f=sheetOnClose; sheetOnClose=null; if(f) f();
}
/* On a phone the keyboard covers the bottom of the screen without moving
   anything that is fixed in place, so a tall sheet could end up with its top
   - title and close button - above the part of the screen you can see. Keep
   the sheet inside what is actually visible, keyboard or not. */
function sheetFit(){
  const s=$("sheet");
  if(!s || s.hidden) return;
  const vv=window.visualViewport;
  if(!vv || window.innerWidth>=620){ s.style.bottom=""; s.style.removeProperty("--vvh"); return; }
  const below=Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  s.style.setProperty("--vvh", Math.round(vv.height)+"px");
  s.style.bottom = below ? below+"px" : "";
}
if(window.visualViewport){
  window.visualViewport.addEventListener("resize", sheetFit);
  window.visualViewport.addEventListener("scroll", sheetFit);
}
window.addEventListener("resize", sheetFit);

function fieldHTML(id, label, type, value, extra){
  return '<div class="field"><label for="'+id+'">'+label+'</label>'+
    '<input id="'+id+'" type="'+type+'" value="'+esc(value==null?"":value)+'" '+(extra||"")+'></div>';
}
function dateVal(ts){
  const d=new Date(ts||Date.now()); if(isNaN(d)) return "";
  const p=n=>String(n).padStart(2,"0");
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());
}
function tsFromDate(v, old){
  if(!v) return old||Date.now();
  const parts=v.split("-").map(Number);
  const o=new Date(old||Date.now());
  const d=new Date(parts[0], parts[1]-1, parts[2], o.getHours(), o.getMinutes(), o.getSeconds());
  return isNaN(d)?(old||Date.now()):d.getTime();
}

/* ---------- "which one of these is me?" ---------- */
function sheetClaim(gid){
  const free=membersOf(gid).filter(m=>!m.uid);
  openSheet("Which one is you?", (b)=>{
    b.innerHTML=
      '<p class="lead">'+esc(groupName(gid))+' keeps its own list of names. Pick yours and '+
      'this account takes it over, so the app can tell you what <em>you</em> owe.</p>'+
      '<div id="clList"></div>'+
      '<div class="sechead">Not on the list?</div>'+
      '<div class="field"><label for="clNew">Add yourself with this name</label>'+
      '<div style="display:flex;gap:8px"><input id="clNew" type="text">'+
      '<button class="btn p" id="clAdd" style="flex:0 0 auto">Add me</button></div></div>';
    $("clNew").value = USER.name || "";
    const host=$("clList");
    if(!free.length){
      host.innerHTML='<p class="fine">Every name here already belongs to someone.</p>';
    } else {
      const first=String(USER.name||"").trim().split(/\s+/)[0].toLowerCase();
      const pinned=(linkedName(USER.email)||"").toLowerCase();
      free.sort((a,c)=>{
        const rank=x=> x.name.toLowerCase()===pinned ? 0 : x.name.toLowerCase()===first ? 1 : 2;
        return rank(a)-rank(c) || a.name.localeCompare(c.name);
      });
      const card=el("div","card"); card.style.marginBottom="4px";
      free.forEach(m=>{
        const hit = m.name.toLowerCase()===pinned || m.name.toLowerCase()===first;
        const r=el("button","row");
        r.innerHTML='<span class="av" style="background:'+m.color+'">'+esc(initials(m.name))+'</span>'+
          '<span class="body"><span class="t1">'+esc(m.name)+
            (hit?' <span class="tag on">probably you</span>':'')+'</span>'+
          '<span class="t2">'+paidShareLine(m.name,gid)+'</span></span>'+
          '<span class="right"><span class="ms" aria-hidden="true" style="color:var(--tint)">how_to_reg</span></span>';
        r.addEventListener("click", ()=>claim(gid, m.k, m.name));
        card.appendChild(r);
      });
      host.appendChild(card);
    }
    $("clAdd").addEventListener("click", ()=>{
      const v=tidyName($("clNew").value);
      if(!v) return toast("Enter a name");
      if(meIn(gid)) return toast("You are already in this group, as "+meIn(gid));
      const hit=inGroupAlready(gid, {name:v});
      if(hit) return toast(hit.m.k && !hit.m.uid
        ? v+" is already on the list — pick that name above" : hit.text);
      push("trips/"+gid+"/people", {n:v, c:freeColour(gid), uid:USER.uid, email:USER.email, photo:USER.photo||null})
        .then(()=> joinUid(gid, USER.uid) )
        .then(()=>{ rememberGroup(gid, groupName(gid)); closeSheet(); toast("You are in"); });
    });
  });
  function claim(gid, key, name){
    const mine = membersOf(gid).find(x=> x.uid===USER.uid);
    if(mine && mine.k!==key) return toast("You are already in this group, as "+mine.name);
    set("trips/"+gid+"/people/"+key+"/uid",   USER.uid)
      .then(()=> set("trips/"+gid+"/people/"+key+"/email", USER.email))
      .then(()=> USER.photo ? set("trips/"+gid+"/people/"+key+"/photo", USER.photo) : null)
      .then(()=> joinUid(gid, USER.uid))
      .then(()=>{ rememberGroup(gid, groupName(gid)); closeSheet(); toast("You are "+name+" in this group"); });
  }
}
function drawEtx(host, gid, from, to, amount, existing){
  if(!host) return;
  // A rupee group is paid over UPI, not Interac.
  if(curOf(gid)==="INR") return drawUpi(host, gid, from, to, amount, existing);
  host.innerHTML="";
  if(existing || !USER || from!==meIn(gid)) return;
  const seat=membersOf(gid).find(m=>m.name===to);
  const d=seat && etxFor(seat.uid);
  if(!d){
    host.appendChild(el("p","etx-missing",
      '<span class="ms" aria-hidden="true">info</span>'+esc(to)+' has not added Interac details yet.'));
    return;
  }
  const bank=myBank();
  const box=el("div","etx");
  const amt = amount>0 ? (Math.round(amount*100)/100).toFixed(2) : "";
  box.innerHTML=
    '<div class="etx-title"><span class="ms" aria-hidden="true">send_money</span>Send by Interac e-Transfer</div>'+
    '<div class="etx-line"><span class="k">To</span><span class="v">'+esc(d.name)+'</span></div>'+
    '<div class="etx-line"><span class="k">'+(/@/.test(d.handle)?"Email":"Phone")+'</span><span class="v">'+esc(d.handle)+'</span>'+
      '<button class="etx-copy" type="button" data-c="h"><span class="ms" aria-hidden="true">content_copy</span>Copy</button></div>'+
    '<div class="etx-line"><span class="k">Amount</span><span class="v">'+(amt ? esc(money(amount, gid)) : "&mdash;")+'</span>'+
      (amt ? '<button class="etx-copy" type="button" data-c="a"><span class="ms" aria-hidden="true">content_copy</span>Copy</button>' : '')+'</div>'+
    (bank ? '<a class="btn dark wide etx-open" target="_blank" rel="noopener" href="'+esc(etxBankLink(bank))+'">Open '+esc(bank.name)+'</a>'
          : '<button class="etx-pick" type="button">Choose your bank app</button>')+
    '<p class="etx-then">Send it in your bank app, then come back and record the payment below.</p>';
  host.appendChild(box);
  const hc=box.querySelector('[data-c="h"]'), ac=box.querySelector('[data-c="a"]');
  if(hc) hc.addEventListener("click", ()=> etxCopy(/@/.test(d.handle) ? d.handle : d.handle.replace(/[^\d]/g,""), /@/.test(d.handle) ? "Email" : "Phone") );
  if(ac) ac.addEventListener("click", ()=> etxCopy(amt, "Amount") );
  const ob=box.querySelector(".etx-open");
  // The tap follows the link itself, so the app can take it; the address is
  // copied on the way, ready to paste into the bank's e-Transfer screen.
  if(ob) ob.addEventListener("click", ()=>{ etxCopy(/@/.test(d.handle) ? d.handle : d.handle.replace(/[^\d]/g,""), /@/.test(d.handle) ? "Email" : "Phone"); });
  const pk=box.querySelector(".etx-pick");
  if(pk) pk.addEventListener("click", ()=>{ closeSheet(); CURRENT=null; TAB="interac"; window.scrollTo(0,0); render(); });
}
/* Paying somebody in a rupee group: their UPI ID and the amount, one tap into
   GPay, PhonePe or Paytm with both filled in, and a QR code any UPI app can
   scan. The app is only opened - whoever is paying checks the name and enters
   their PIN there, then records the payment here. */
let UPI_QR_OPEN = false;
function drawUpi(host, gid, from, to, amount, existing){
  host.innerHTML="";
  if(existing || !USER || from!==meIn(gid)) return;
  const seat=membersOf(gid).find(m=>m.name===to);
  const d=seat && upiFor(seat.uid);
  if(!d){
    host.appendChild(el("p","etx-missing",
      '<span class="ms" aria-hidden="true">info</span>'+esc(to)+' has not added a UPI ID yet.'));
    return;
  }
  const amt = amount>0 ? Math.round(amount*100)/100 : 0;
  const note = "Settle "+groupName(gid);
  const phone = etxIsAndroid() || etxIsIOS();
  const pref = myUpiApp();
  const apps = pref ? [pref].concat(UPI_APPS.filter(a=>a!==pref)) : UPI_APPS;
  const box=el("div","etx upi");
  box.innerHTML=
    '<div class="etx-title"><span class="upi-mark" aria-hidden="true">UPI</span>Pay with UPI</div>'+
    '<div class="etx-line"><span class="k">To</span><span class="v">'+esc(d.name)+'</span></div>'+
    '<div class="etx-line"><span class="k">UPI ID</span><span class="v">'+esc(d.vpa)+'</span>'+
      '<button class="etx-copy" type="button" data-c="h"><span class="ms" aria-hidden="true">content_copy</span>Copy</button></div>'+
    '<div class="etx-line"><span class="k">Amount</span><span class="v">'+(amt ? esc(money(amt, "INR")) : "&mdash;")+'</span>'+
      (amt ? '<button class="etx-copy" type="button" data-c="a"><span class="ms" aria-hidden="true">content_copy</span>Copy</button>' : '')+'</div>'+
    (phone
      ? '<div class="upi-apps">'+apps.map(a=>
          '<a class="upi-app'+(pref===a?' on':'')+'" style="--bk:'+a.tint+'" href="'+esc(upiLink(d, amt, note, a))+'">'+
            '<span class="upi-mono">'+esc(a.mono)+'</span><span class="upi-app-n">'+esc(a.name)+'</span></a>').join("")+
          '<a class="upi-app" style="--bk:#5B6270" href="'+esc(upiLink(d, amt, note, null))+'">'+
            '<span class="upi-mono"><span class="ms" aria-hidden="true">apps</span></span><span class="upi-app-n">Other app</span></a>'+
        '</div>'+
        '<button class="upi-qr-toggle" type="button" aria-expanded="'+(UPI_QR_OPEN?"true":"false")+'"></button>'
      : '')+
    '<div class="upi-qr"'+(phone && !UPI_QR_OPEN ? ' hidden' : '')+'>'+
      '<div class="upi-qr-code" role="img" aria-label="UPI QR code to pay '+esc(d.name)+'"></div>'+
      '<p>'+(phone ? 'Scan from another phone' : 'Scan with GPay, PhonePe, Paytm or any UPI app')+
        (amt ? ' · '+esc(money(amt, "INR"))+' filled in' : '')+'</p></div>'+
    '<p class="etx-then">Enter your UPI PIN in the app, then come back and record the payment below. '+
      'If an app won’t take the link, scan the QR code or pay the UPI ID.</p>';
  host.appendChild(box);
  box.querySelector('[data-c="h"]').addEventListener("click", ()=> etxCopy(d.vpa, "UPI ID"));
  const ac=box.querySelector('[data-c="a"]');
  if(ac) ac.addEventListener("click", ()=> etxCopy(amt.toFixed(2), "Amount"));
  // The link opens the app. The UPI ID goes on the clipboard on the way, in
  // case the app asks for it rather than taking it from the link.
  [].forEach.call(box.querySelectorAll(".upi-app"), a=> a.addEventListener("click", ()=>{
    try{ if(navigator.clipboard) navigator.clipboard.writeText(d.vpa).catch(()=>{}); }catch(e){}
  }));
  const qrBox=box.querySelector(".upi-qr");
  const draw=()=> qrInto(box.querySelector(".upi-qr-code"), "upi://pay?"+upiQuery(d, amt, note));
  if(!qrBox.hidden) draw();
  const tg=box.querySelector(".upi-qr-toggle");
  const label=()=>{ tg.innerHTML='<span class="ms" aria-hidden="true">qr_code_2</span>'+(UPI_QR_OPEN ? "Hide QR code" : "Show QR code");
                    tg.setAttribute("aria-expanded", UPI_QR_OPEN?"true":"false"); };
  if(tg){
    label();
    tg.addEventListener("click", ()=>{ UPI_QR_OPEN=!UPI_QR_OPEN; qrBox.hidden=!UPI_QR_OPEN; label(); if(UPI_QR_OPEN) draw(); });
  }
}
function freeColour(gid){
  const used={}; membersOf(gid).forEach(m=>{ used[m.color.toLowerCase()]=1; });
  for(let i=0;i<PALETTE.length;i++){ if(!used[PALETTE[i].toLowerCase()]) return PALETTE[i]; }
  return PALETTE[membersOf(gid).length%PALETTE.length];
}

/* ---------- add / edit an expense ---------- */
function sheetExpense(existing){
  const gid=CURRENT, ppl=names(gid);
  if(!ppl.length){ toast("Add people to the group first"); return sheetMembers(); }

  let mode = existing ? (existing.mode||"equal") : "equal";
  let between = existing && existing.between && existing.between.length
      ? existing.between.filter(n=>ppl.indexOf(n)>-1) : ppl.slice();
  if(!between.length) between=ppl.slice();
  let vals = Object.assign({}, (existing&&existing.vals)||{});
  let cat  = existing ? (existing.cat||"general") : "general";
  // Only whoever paid may record it. Editing keeps the payer the row already
  // has: changing who paid is for the administrator alone.
  const payerChoices = existing
    ? (isAdmin() ? ppl.concat(existing.payer && ppl.indexOf(existing.payer)<0 ? [existing.payer] : [])
                 : [existing.payer])
    : payersAllowed(gid, ppl);
  if(!payerChoices.length){
    toast("Say which name in this group is yours first");
    return sheetClaim(gid);
  }
  const payerDefault = existing ? existing.payer : (payerChoices.indexOf(ME)>-1 ? ME : payerChoices[0]);
  const payerLocked = payerChoices.length===1;

  const mayEdit = !existing || canEdit(existing);
  openSheet(existing?(mayEdit?"Edit expense":"Expense"):"Add an expense", (b)=>{
    b.innerHTML =
      '<div class="field"><label for="exDesc">What was it for?</label>'+
      '<input id="exDesc" type="text" placeholder="Dinner, fuel, groceries…" value="'+esc(existing?existing.desc:"")+'"></div>'+
      '<div class="field"><label for="exAmt">Amount</label><div class="amtbig"><span class="cur">'+esc(curSym(gid))+'</span>'+
      '<input id="exAmt" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="'+
        (existing?esc(plain(Number(existing.amount)||0)):"")+'"></div></div>'+
      '<div class="field"><label for="exPayer">Paid by</label><select id="exPayer"'+(payerLocked?' disabled':'')+'>'+
        payerChoices.map(n=>'<option value="'+esc(n)+'"'+(n===payerDefault?' selected':'')+'>'+esc(n)+(n===ME?" (you)":"")+'</option>').join("")+
      '</select>'+
      (payerLocked && !existing ? '<div class="help">You can only add what you paid. If someone else paid, they add it.</div>' : '')+
      '</div>'+
      '<div class="field"><label>Category</label><div class="chips" id="exCats"></div></div>'+
      '<div class="field"><label>How to split</label><div class="seg" id="exMode">'+
        '<button type="button" data-m="equal">Equally</button>'+
        '<button type="button" data-m="exact">Exact</button>'+
        '<button type="button" data-m="percent">%</button>'+
        '<button type="button" data-m="shares">Shares</button>'+
      '</div><div class="help" id="exModeHelp"></div></div>'+
      '<div class="field"><label>Between</label><div id="exSplit"></div>'+
        '<div class="splitsum" id="exSum"><span></span><span></span></div></div>'+
      fieldHTML("exDate","Date","date", dateVal(existing?existing.at:null))+
      '<div class="field"><label for="exNote">Note (optional)</label>'+
      '<textarea id="exNote" placeholder="Anything worth remembering">'+esc(existing?(existing.note||""):"")+'</textarea></div>'+
      (mayEdit
        ? '<div class="btnrow"><button class="btn p" id="exSave">'+(existing?"Save changes":"Add expense")+'</button></div>'+
          (existing?'<button class="btn d wide" id="exDel" style="margin-top:10px">Delete this expense</button>':'')
        : '<p class="locked"><span class="ms" aria-hidden="true">lock</span>'+
          'Only '+esc(ownerOf(existing))+' can change this, because they added it.</p>')+
      (existing?'<p class="fine" style="text-align:center;margin-top:12px">Added by '+
        esc(existing.by||existing.payer)+' · '+esc(fmtWhen(existing.at))+'</p>':'');

    const cats=$("exCats");
    CATS.forEach(c=>{
      const ch=el("button","chip"); ch.type="button";
      ch.innerHTML='<span class="ms" aria-hidden="true" style="font-size:18px">'+c.i+'</span>'+c.n;
      ch.setAttribute("aria-pressed", c.k===cat?"true":"false");
      ch.addEventListener("click",()=>{ cat=c.k;
        [].forEach.call(cats.children,x=>x.setAttribute("aria-pressed","false"));
        ch.setAttribute("aria-pressed","true"); });
      cats.appendChild(ch);
    });

    [].forEach.call($("exMode").children, btn=>{
      btn.addEventListener("click", ()=>{ mode=btn.dataset.m; drawMode(); drawSplit(); });
    });
    $("exAmt").addEventListener("input", drawSplit);
    drawMode(); drawSplit();

    if(!mayEdit){
      // read only: let them look, not touch
      [].forEach.call(b.querySelectorAll("input,select,textarea"), x=>{ x.disabled=true; });
      [].forEach.call(b.querySelectorAll(".chip,.seg button"), x=>{ x.disabled=true; x.style.opacity=".75"; });
      return;
    }
    $("exSave").addEventListener("click", save);
    if(existing) $("exDel").addEventListener("click", ()=>{
      if(!confirm('Delete "'+existing.desc+'"? This removes it for everyone.')) return;
      del("trips/"+gid+"/expenses/"+existing.k);
      notify("expense.del", gid, Object.assign({}, existing, {ref: existing.k}));
      closeSheet(); toast("Expense deleted");
    });

    function drawMode(){
      [].forEach.call($("exMode").children, b2=>
        b2.setAttribute("aria-pressed", b2.dataset.m===mode?"true":"false"));
      $("exModeHelp").textContent = mode==="equal" ? "Split evenly between everyone ticked below."
        : mode==="exact" ? "Type exactly what each person owes. It must add up to the total."
        : mode==="percent" ? "Type each person's percentage. It must add up to 100%."
        : "Give each person a number of shares — 2 shares pays twice as much as 1.";
    }
    function drawSplit(){
      const host=$("exSplit"); host.innerHTML="";
      const amt=Number($("exAmt").value)||0;
      if(mode==="equal"){
        const chips=el("div","chips");
        ppl.forEach(n=>{
          const on=between.indexOf(n)>-1;
          const ch=el("button","chip"); ch.type="button";
          ch.innerHTML='<span class="dot" style="background:'+colorOf(n,gid)+'"></span>'+esc(n)+(n===ME?" (you)":"");
          ch.setAttribute("aria-pressed", on?"true":"false");
          ch.addEventListener("click",()=>{
            const i=between.indexOf(n);
            if(i>-1){ if(between.length===1) return toast("At least one person"); between.splice(i,1); }
            else between.push(n);
            drawSplit();
          });
          chips.appendChild(ch);
        });
        host.appendChild(chips);
        const all=el("button","btn s","Everyone"); all.type="button";
        all.style.cssText="margin-top:12px;min-height:44px;padding:9px 18px;font-size:13.5px;border-radius:16px";
        all.addEventListener("click",()=>{ between=ppl.slice(); drawSplit(); });
        host.appendChild(all);
        const per=between.length?amt/between.length:0;
        setSum(between.length+(between.length===1?" person":" people")+" · "+money(per)+" each", "", true);
        return;
      }
      ppl.forEach(n=>{
        const on=between.indexOf(n)>-1;
        const r=el("div","splitrow");
        r.innerHTML=
          '<span class="av sm" style="background:'+(on?colorOf(n,gid):"#c9ced6")+'">'+esc(initials(n))+'</span>'+
          '<span class="nm" style="'+(on?"":"opacity:.5")+'">'+esc(n)+(n===ME?" (you)":"")+'</span>'+
          '<span class="calc" data-calc></span>'+
          '<input type="number" inputmode="decimal" step="'+(mode==="shares"?"1":"0.01")+'" min="0" '+
            'value="'+(on&&vals[n]!=null?esc(String(vals[n])):"")+'" aria-label="'+esc(n)+'">'+
          '<span class="unit">'+(mode==="percent"?"%":mode==="shares"?"sh":curSym(gid))+'</span>';
        const inp=r.querySelector("input");
        inp.addEventListener("input", ()=>{
          const v=inp.value.trim();
          if(v===""){ delete vals[n]; const i=between.indexOf(n); if(i>-1) between.splice(i,1); }
          else { vals[n]=Number(v)||0; if(between.indexOf(n)<0) between.push(n); }
          recalc();
        });
        host.appendChild(r);
      });
      recalc();
    }
    function recalc(){
      const amt=Number($("exAmt").value)||0;
      const rows=$("exSplit").querySelectorAll(".splitrow");
      const eff=between.filter(n=>ppl.indexOf(n)>-1);
      let tot=0; eff.forEach(n=> tot+=Number(vals[n])||0 );
      [].forEach.call(rows,(r,i)=>{
        const n=ppl[i], c=r.querySelector("[data-calc]"), on=eff.indexOf(n)>-1;
        r.querySelector(".nm").style.opacity = on?"1":".5";
        r.querySelector(".av").style.background = on?colorOf(n,gid):"#c9ced6";
        if(!on || !amt){ c.textContent=""; return; }
        const v=Number(vals[n])||0;
        c.textContent = mode==="exact" ? "" :
          mode==="percent" ? money(amt*v/100) :
          money(tot? amt*v/tot : 0);
      });
      if(mode==="exact"){
        const left=Math.round((amt-tot)*100)/100;
        setSum(money(tot)+" of "+money(amt),
               Math.abs(left)<0.005?"all accounted for":(left>0?money(left)+" left":money(-left)+" over"),
               Math.abs(left)<0.005);
      } else if(mode==="percent"){
        const left=Math.round((100-tot)*100)/100;
        setSum(trim(tot)+"% of 100%",
               Math.abs(left)<0.005?"adds up":(left>0?trim(left)+"% left":trim(-left)+"% over"),
               Math.abs(left)<0.005);
      } else {
        setSum(trim(tot)+" share"+(tot===1?"":"s")+" between "+eff.length,
               eff.length?"":"pick at least one", eff.length>0 && tot>0);
      }
    }
    function setSum(a, bTxt, ok){
      const s=$("exSum"); s.className="splitsum"+(ok?" ok":bTxt?" bad":"");
      s.children[0].textContent=a; s.children[1].textContent=bTxt;
    }
    function save(){
      const desc=$("exDesc").value.trim();
      const amt=Math.round((Number($("exAmt").value)||0)*100)/100;
      if(!desc) return toast("Give it a description");
      if(!(amt>0)) return toast("Enter an amount");
      const eff=between.filter(n=>ppl.indexOf(n)>-1);
      if(!eff.length) return toast("Pick who it is split between");
      const v={};
      if(mode!=="equal"){
        let tot=0; eff.forEach(n=>{ v[n]=Number(vals[n])||0; tot+=v[n]; });
        if(mode==="exact"   && Math.abs(tot-amt)>0.011) return toast("The amounts must add up to "+money(amt));
        if(mode==="percent" && Math.abs(tot-100)>0.011) return toast("The percentages must add up to 100");
        if(mode==="shares"  && tot<=0)                  return toast("Give someone at least one share");
      }
      if(payerChoices.indexOf($("exPayer").value)<0) return toast("You can only add what you paid");
      const rec={
        desc: desc, amount: amt, payer: $("exPayer").value, mode: mode,
        between: eff, vals: v, cat: cat, note: $("exNote").value.trim(),
        at: tsFromDate($("exDate").value, existing?existing.at:null),
        by: existing ? (existing.by||ME||USER.name) : (ME||USER.name),
        byUid: existing ? (existing.byUid||USER.uid) : USER.uid
      };
      // Keyed here, so the note can say which expense the phones should hear about.
      const key = existing ? existing.k : "e"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
      set("trips/"+gid+"/expenses/"+key, rec);
      notify(existing?"expense.edit":"expense.add", gid, Object.assign({ref:key}, rec));
      closeSheet(); toast(existing?"Expense updated":"Expense added");
    }
  });
  setTimeout(()=>{ const d=$("exDesc"); if(d && !existing) d.focus(); }, 90);
}

/* ---------- record a payment ---------- */
/* Sounds, made in the page with Web Audio - no files to fetch. Browsers only
   allow sound after a touch, so the slider wakes the audio when the handle
   is first pressed. Quiet by design: a soft click as the slide lands, and a
   short bright chime when the payment is saved. */
const SFX = (()=>{
  let ctx = null;
  const get = ()=>{
    try{
      if(!ctx){ const A = window.AudioContext || window.webkitAudioContext; if(!A) return null; ctx = new A(); }
      if(ctx.state === "suspended") ctx.resume();
      return ctx;
    }catch(e){ return null; }
  };
  const tone = (c, freq, start, dur, vol, type)=>{
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(c.destination);
    o.start(start); o.stop(start + dur + 0.03);
  };
  return {
    unlock(){ get(); },
    // A soft upward sweep and a tick, like something clicking into place.
    slide(){
      const c = get(); if(!c) return;
      const t = c.currentTime, o = c.createOscillator(), g = c.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(420, t);
      o.frequency.exponentialRampToValueAtTime(880, t + 0.12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.2);
      tone(c, 1320, t + 0.11, 0.08, 0.045, "sine");
    },
    // Two bright notes a fifth apart, with a soft shimmer blooming above.
    success(){
      const c = get(); if(!c) return;
      const t = c.currentTime + 0.02;
      tone(c, 659.25, t,        0.36, 0.15, "sine");      // E5
      tone(c, 1318.5, t,        0.18, 0.028, "sine");
      tone(c, 987.77, t + 0.12, 0.62, 0.15, "sine");      // B5
      tone(c, 1975.5, t + 0.12, 0.34, 0.03, "sine");
      tone(c, 1318.5, t + 0.24, 0.72, 0.06, "triangle");  // E6 bloom
    },
    // A soft knock-knock, low then lower, for something asking a question.
    knock(){
      const c = get(); if(!c || c.state !== "running") return;
      const t = c.currentTime + 0.02;
      tone(c, 783.99, t,        0.22, 0.09, "sine");      // G5
      tone(c, 587.33, t + 0.16, 0.34, 0.09, "sine");      // D5
    }
  };
})();

/* The moment a payment is saved: a seal in the theme's colour - glowing like
   the + in the bar - springs in, a check draws itself on it and two halos
   ripple out with a small burst in the app's own colours, then the amount and
   who it went to. Goes by itself after a couple of seconds; a tap closes it
   sooner. */
function celebratePayment(amount, to, cur){
  const who = to===ME ? "you" : to;
  const tints = ["var(--apricot)", "var(--good)", "var(--apricot-dk)"];
  const pop = el("div","paid-pop");
  pop.setAttribute("role","status");
  pop.setAttribute("aria-live","polite");
  pop.innerHTML=
    '<div class="paid-card">'+
      '<div class="paid-mark"><span class="paid-seal"><span class="paid-halo"></span><span class="paid-halo h2"></span>'+
        '<svg viewBox="0 0 40 40" aria-hidden="true"><path class="paid-check" d="M10 21l7 7 14-15"/></svg></span></div>'+
      '<div class="paid-dots" aria-hidden="true">'+
        Array.from({length:14}, (_, i)=> '<i style="--a:'+Math.round(i*360/14)+'deg;--d:'+(58 + (i%3)*18)+'px;--c:'+tints[i%3]+'"></i>').join("")+
      '</div>'+
      '<div class="paid-lab">Payment recorded</div>'+
      '<div class="paid-amt">'+esc(money(amount, cur))+'</div>'+
      '<div class="paid-to">to '+esc(who)+'</div>'+
    '</div>';
  document.body.appendChild(pop);
  SFX.success();
  try{ if(navigator.vibrate) navigator.vibrate([12, 60, 18]); }catch(e){}
  const close = ()=>{
    if(pop.classList.contains("out")) return;
    pop.classList.add("out");
    setTimeout(()=> pop.remove(), 320);
  };
  pop.addEventListener("click", close);
  setTimeout(close, 2400);
}

/* Slide to confirm. A tap cannot record a payment by accident: the handle has
   to be dragged most of the way across. Let go early and it springs back.
   onDone returns true when it went through; anything else springs it back so
   the person can fix what the toast says and slide again. Arrow keys and End
   move it for anyone using a keyboard. */
function slideToConfirm(track, onDone){
  const knob=track.querySelector(".pf-slide-knob"), fill=track.querySelector(".pf-slide-fill");
  const icon=knob.querySelector(".ms");
  let startX=0, x=0, max=0, dragging=false, done=false;
  const measure=()=>{ max=Math.max(0, track.clientWidth - knob.offsetWidth - 8); };
  const put=(v, animate)=>{
    x=Math.max(0, Math.min(max, v));
    track.classList.toggle("anim", !!animate);
    knob.style.transform="translateX("+x+"px)";
    fill.style.width=(x + knob.offsetWidth + 8)+"px";
    const p = max ? x/max : 0;
    track.style.setProperty("--p", p.toFixed(3));
    track.setAttribute("aria-valuenow", String(Math.round(p*100)));
  };
  const reset=()=>{ done=false; track.classList.remove("done"); icon.textContent="arrow_forward"; measure(); put(0, true); };
  const finish=()=>{
    if(done) return;
    if(max && x >= max*0.9){
      done=true; put(max, true); track.classList.add("done"); icon.textContent="check";
      try{ if(navigator.vibrate) navigator.vibrate(15); }catch(e){}
      SFX.slide();
      setTimeout(()=>{ if(onDone()!==true) reset(); }, 200);
    } else {
      put(0, true);
    }
  };
  knob.addEventListener("pointerdown", e=>{
    if(done) return;
    SFX.unlock();
    measure(); dragging=true; startX=e.clientX - x;
    try{ knob.setPointerCapture(e.pointerId); }catch(err){}
    track.classList.add("dragging"); track.classList.remove("anim");
    e.preventDefault();
  });
  knob.addEventListener("pointermove", e=>{ if(dragging) put(e.clientX - startX); });
  const up=()=>{ if(!dragging) return; dragging=false; track.classList.remove("dragging"); finish(); };
  knob.addEventListener("pointerup", up);
  knob.addEventListener("pointercancel", up);
  knob.addEventListener("keydown", e=>{
    if(done) return;
    SFX.unlock();
    measure();
    if(e.key==="ArrowRight"){ e.preventDefault(); put(x + max*0.34, true); if(x >= max*0.9) finish(); }
    else if(e.key==="ArrowLeft"){ e.preventDefault(); put(x - max*0.34, true); }
    else if(e.key==="End"){ e.preventDefault(); put(max, true); finish(); }
  });
  window.addEventListener("resize", ()=>{ if(!done){ measure(); put(0); } });
  return {reset};
}

function sheetSettle(from, to, amt, existing){
  const gid=CURRENT;
  // A payment can name someone who is no longer on the members list, so the
  // pickers have to offer those names too or editing it would silently move
  // the money to somebody else.
  const ppl=names(gid).slice();
  if(existing){ [existing.from, existing.to].forEach(n=>{ if(n && ppl.indexOf(n)<0) ppl.push(n); }); }
  if(ppl.length<2){ toast("You need at least two people"); return; }
  /* Whoever paid records it - and so may whoever was paid. People forget to
     say they have sent money, and the person it went to is the one who can
     actually see it arrive, so they can mark it themselves rather than wait.
     Editing keeps the payer the row already has; the administrator may record
     for anyone. */
  const recvMode = !existing && !isAdmin() && !!ME && to===ME && from!==ME;
  const fromChoices = existing ? (isAdmin() ? ppl : [existing.from])
    : recvMode ? ppl.filter(n=>n!==ME)
    : payersAllowed(gid, ppl);
  if(!fromChoices.length){ toast("Say which name in this group is yours first"); return sheetClaim(gid); }
  if(!existing && from && fromChoices.indexOf(from)<0){
    toast("Only "+from+" can record a payment they made");
    return;
  }
  from = from || (fromChoices.indexOf(ME)>-1 ? ME : fromChoices[0]);
  const fromLocked = fromChoices.length===1;
  // With who paid fixed, they cannot also be the one who received it - and
  // when this is money that came to me, the other end is me and stays me.
  const toChoices = recvMode ? [ME] : fromLocked ? ppl.filter(n=>n!==from) : ppl;
  if(!to || toChoices.indexOf(to)<0) to = toChoices.filter(n=>n!==from)[0] || toChoices[0];
  const toLocked = toChoices.length===1;
  const mayEdit = !existing || canEdit(existing);
  openSheet(existing ? (mayEdit?"Edit payment":"Payment") : recvMode ? "Mark as received" : "Record a payment", (b)=>{
    /* Who paid whom, as two faces and an arrow; the amount large under it,
       with the outstanding figure a tap away; then the Interac details if
       there are any, the date and a note side by side, and one button that
       says exactly what it will record. */
    const opts=(list, pick)=> list.map(n=>'<option value="'+esc(n)+'"'+(n===pick?' selected':'')+'>'+esc(n)+(n===ME?" (you)":"")+'</option>').join("");
    b.innerHTML=
      (existing ? '' : '<p class="pf-sub">'+(recvMode
        ? 'For money that has already reached you, when whoever paid forgot to record it.'
        : 'For cash or a transfer that has already happened.')+'</p>')+
      '<div class="pf">'+
        // No choice to make: say the name plainly, so it can wrap instead of
        // being cut short inside a dropdown that does nothing.
        '<div class="pf-person"><span class="pf-av" id="pfFromAv"></span><span class="pf-role">Paid by</span>'+
          (fromLocked
            ? '<span class="pf-name">'+esc(from===ME ? "You" : from)+'</span>'+
              '<select id="stFrom" hidden disabled>'+opts(fromChoices, from)+'</select>'
            : '<label class="pf-select"><select id="stFrom" aria-label="Who paid">'+opts(fromChoices, from)+'</select>'+
              '<span class="ms" aria-hidden="true">expand_more</span></label>')+'</div>'+
        '<div class="pf-arrow" aria-hidden="true"><span class="pf-line"></span><span class="ms">arrow_forward</span></div>'+
        '<div class="pf-person"><span class="pf-av" id="pfToAv"></span><span class="pf-role">To</span>'+
          (toLocked
            ? '<span class="pf-name">'+esc(to===ME ? "You" : to)+'</span>'+
              '<select id="stTo" hidden disabled>'+opts(toChoices, to)+'</select>'
            : '<label class="pf-select"><select id="stTo" aria-label="Who received it">'+opts(toChoices, to)+'</select>'+
              '<span class="ms" aria-hidden="true">expand_more</span></label>')+'</div>'+
      '</div>'+
      '<div class="pf-amount"><label class="pf-lab" for="stAmt">Amount</label>'+
        '<div class="pf-amt"><span class="cur">'+esc(curSym(gid))+'</span><input id="stAmt" type="number" inputmode="decimal" step="0.01" min="0" '+
          'placeholder="0.00" value="'+(amt?esc(plain(amt)):"")+'"></div>'+
        '<div class="pf-why" id="stWhy"></div><div class="pf-quick" id="stQuick"></div></div>'+
      '<div id="stEtx"></div>'+
      '<div class="pf-details">'+
        fieldHTML("stDate","Date","date", dateVal(existing?existing.at:null))+
        '<div class="field"><label for="stNote">Note</label>'+
        '<input id="stNote" type="text" placeholder="'+(curOf(gid)==="INR" ? "UPI, cash…" : "e-Transfer, cash…")+'" value="'+
          esc(existing?(existing.note||""):"")+'"></div>'+
      '</div>'+
      (recvMode
        ? '<p class="pf-help">Mark this once the money has actually reached you. Whoever paid will see that you recorded it.</p>'
        : fromLocked && !existing && mayEdit
          ? '<p class="pf-help">You can only record a payment you made, or one that was paid to you.</p>' : '')+
      (mayEdit
        ? (existing
            ? '<button class="btn p wide pf-save" id="stSave"><span class="ms" aria-hidden="true">check</span>'+
                '<span id="stSaveLbl">Save changes</span></button>'+
              '<button class="pf-del" id="stDel" type="button">Delete this payment</button>'
            // Recording is a slide, not a tap, so a stray touch cannot do it.
            : '<button id="stSave" type="button" hidden>Record payment</button>'+
              '<div class="pf-slide" id="stSlide" role="slider" aria-label="Slide to record the payment" '+
                'aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">'+
                '<span class="pf-slide-fill" aria-hidden="true"></span>'+
                '<span class="pf-slide-text" id="stSaveLbl">Slide to record</span>'+
                '<span class="pf-slide-knob" tabindex="0" role="button" aria-label="Drag right to record, or press End">'+
                  '<span class="ms" aria-hidden="true">arrow_forward</span></span>'+
              '</div>'+
              '<p class="pf-slide-hint">Slide all the way across to record it.</p>')
        : '<p class="locked"><span class="ms" aria-hidden="true">lock</span>'+
          'Only '+esc(ownerOf(existing))+' can change this, because they recorded it.</p>')+
      (existing?'<div id="stGot"></div><p class="fine">Recorded by '+esc(existing.by||existing.from)+' · '+esc(fmtWhen(existing.at))+'</p>':'');
    // The two faces and the button's wording follow the choices.
    const face=(id, name)=>{
      const m=memberOf(name, gid), host=$(id);
      host.style.background = (m && m.color) || colorOf(name, gid);
      host.innerHTML = m && m.photo ? '<img src="'+esc(m.photo)+'" alt="" referrerpolicy="no-referrer">' : esc(initials(name));
    };
    const refresh=()=>{
      face("pfFromAv", $("stFrom").value); face("pfToAv", $("stTo").value);
      // Rupee amounts run long - 62500.00 - so the figure shrinks to stay whole.
      const len=String($("stAmt").value||"").length;
      $("stAmt").classList.toggle("long", len>6 && len<=8);
      $("stAmt").classList.toggle("xlong", len>8);
      if(!$("stSaveLbl")) return;
      const a=Math.round((Number($("stAmt").value)||0)*100)/100, t=$("stTo").value;
      $("stSaveLbl").textContent = existing ? "Save changes"
        : recvMode ? (a>0 ? "Slide to mark "+money(a)+" received" : "Slide to mark received")
        : a>0 ? "Slide to record "+money(a) : "Slide to record";
    };
    refresh();
    // Where it stands with the person it went to - and, when that is me and I
    // have not said, the same two answers the slip offers.
    if(existing && $("stGot")){
      const st=payState(existing, gid), me=meIn(gid);
      const askMe = st && st.k==="wait" && existing.to===me && existing.from!==me;
      if(st) $("stGot").innerHTML='<div class="pf-got '+st.k+'">'+payStateHTML(existing, gid)+
        (askMe ? '<span class="pf-got-acts"><button type="button" class="pf-got-yes">It arrived</button>'+
                 '<button type="button" class="pf-got-no">It didn’t</button></span>' : '')+'</div>';
      if(askMe){
        const answer=(ok)=> updStrict("trips/"+gid+"/payments/"+existing.k,
          {got:{ok, at:Date.now(), uid:USER.uid, name:me}, later:null})
          .then(()=>{ notify("payment.got", gid, {ref: existing.k}); closeSheet(); if(ok){ SFX.unlock(); SFX.success(); toast("Marked as received"); }
                      else toast(existing.from+" will see it hasn’t arrived"); })
          .catch(e=> toast(writeError(e)));
        b.querySelector(".pf-got-yes").addEventListener("click", ()=> answer(true));
        b.querySelector(".pf-got-no").addEventListener("click", ()=> answer(false));
      }
    }
    if(!mayEdit){
      [].forEach.call(b.querySelectorAll("input,select"), x=>{ x.disabled=true; });
      return;
    }
    // The amount follows whoever is picked, so choosing a different pair shows
    // what is outstanding between them rather than leaving a stale figure. A
    // payment that already exists counts as set by hand: opening it to fix a
    // note used to wipe the amount, because the payment itself had settled the
    // debt and so nothing was outstanding to suggest - and then it could not
    // be saved at all without typing the figure back in.
    let touched = !!existing;
    $("stAmt").addEventListener("input", ()=>{ touched = true; refresh(); });
    // Paying somebody who saved their Interac details: show them, with the
    // amount, ready to copy - and the bank app one tap away.
    const etx=()=> drawEtx($("stEtx"), gid, $("stFrom").value, $("stTo").value, Number($("stAmt").value)||0, existing);
    ["stFrom","stTo"].forEach(id=> $(id).addEventListener("change", ()=> setTimeout(etx,0)) );
    $("stAmt").addEventListener("input", etx);
    setTimeout(etx,0);
    function suggest(force){
      const s2=suggestSettle(gid, $("stFrom").value, $("stTo").value);
      $("stWhy").textContent = s2.why;
      if(force || !touched){
        $("stAmt").value = s2.amt ? plain(s2.amt) : "";
        touched = false;
      }
      // What is outstanding between them, and half of it, one tap each.
      const quick=$("stQuick"); quick.innerHTML="";
      if(s2.amt>0.004){
        [["Full", s2.amt], ["Half", Math.round(s2.amt/2*100)/100]].forEach(q=>{
          const c=el("button","pf-chip"); c.type="button"; c.textContent=q[0]+" "+money(q[1]);
          c.addEventListener("click", ()=>{ $("stAmt").value=plain(q[1]); touched=true; etx(); refresh(); });
          quick.appendChild(c);
        });
      }
      refresh();
    }
    $("stFrom").addEventListener("change", ()=>{
      if($("stFrom").value===$("stTo").value){
        const other=ppl.filter(n=>n!==$("stFrom").value)[0];
        if(other) $("stTo").value=other;
      }
      suggest(true);
    });
    $("stTo").addEventListener("change", ()=>{
      if($("stTo").value===$("stFrom").value){
        const other=ppl.filter(n=>n!==$("stTo").value)[0];
        if(other) $("stFrom").value=other;
      }
      suggest(true);
    });
    suggest(!amt && !existing);

    const save=()=>{
      const f=$("stFrom").value, t=$("stTo").value;
      const a=Math.round((Number($("stAmt").value)||0)*100)/100;
      if(f===t) return toast("Pick two different people");
      if(!(a>0)) return toast("Enter an amount");
      if(fromChoices.indexOf(f)<0) return toast(recvMode ? "Pick who paid you" : "You can only record a payment you made");
      const rec={from:f, to:t, amount:a, note:$("stNote").value.trim(),
                 at:tsFromDate($("stDate").value, existing?existing.at:null),
                 by: existing ? (existing.by||ME||USER.name) : (ME||USER.name),
                 byUid: existing ? (existing.byUid||USER.uid) : USER.uid};
      // The person it went to is asked whether it arrived. Correcting a note or
      // a date keeps their answer; changing who or how much asks them again.
      const same = existing && existing.to===t && Math.abs((Number(existing.amount)||0)-a) < 0.005;
      if(existing && existing.netted) rec.netted = true;      // no money moved: nobody to ask
      else if(recvMode){
        // I am the end it came to, so there is nobody to ask whether it
        // arrived: recording it is itself the answer.
        rec.got = {ok:true, at:Date.now(), uid:USER.uid, name:ME||USER.name};
      }
      else {
        if(!existing || !same || existing.ask) rec.ask = true;
        if(same && existing.got) rec.got = existing.got;
      }
      // The key is made here rather than by push(), so the note can name this
      // payment and the phone it went to can be asked about exactly this one.
      const key = existing ? existing.k : "p"+uid();
      set("trips/"+gid+"/payments/"+key, rec);
      // A payment has no description of its own, so say who paid whom.
      notify(existing?"payment.edit":"payment.add", gid,
             {desc: f+" paid "+t, amount: a, ref: key});
      if(existing && !same && rec.ask) notify("payment.ask", gid, {ref: key});
      closeSheet();
      if(existing) toast("Payment updated");
      else if(recvMode) toast("Marked as received · "+f+" will see it");
      else setTimeout(()=> celebratePayment(a, t), 260);   // once the sheet has slid away
      return true;
    };
    $("stSave").addEventListener("click", save);
    if($("stSlide")) slideToConfirm($("stSlide"), save);
    if(existing) $("stDel").addEventListener("click", ()=>{
      if(!confirm("Delete this "+money(existing.amount)+" payment from "+existing.from+
                  " to "+existing.to+"? Everyone's balance will move.")) return;
      del("trips/"+gid+"/payments/"+existing.k);
      notify("payment.del", gid, {desc: existing.from+" paid "+existing.to,
                                  amount: existing.amount});
      closeSheet(); toast("Payment deleted");
    });
  });
}

/* ---------- one person's detail ---------- */
/* ---------- the receipt: an itemised statement, as the tracker had it ---------- */
let rcFilter="__all__";
function sheetPerson(name){
  rcFilter="__all__";
  openSheet(name, (b)=>{
    b.innerHTML='<div class="rcrole" id="rcRole"></div>'+
      '<div class="frow" id="rcFilters"></div>'+
      '<div class="paper" id="rcPaper"></div>'+
      '<button class="btn p wide" id="rcSettle" style="margin-top:18px">Settle up</button>';
    drawFilters(); drawPaper();
    $("rcSettle").addEventListener("click", ()=>{
      const v=Math.round((balances(CURRENT)[name]||0)*100)/100;
      closeSheet();
      setTimeout(()=>{
        if(v<-0.004) sheetSettle(name, null, Math.abs(v));
        else if(v>0.004) sheetSettle(null, name, Math.abs(v));
        else sheetSettle();
      }, 220);
    });
  });

  function drawFilters(){
    const host=$("rcFilters"); host.innerHTML="";
    const opts=["__all__"].concat(everyoneIn(CURRENT).filter(n=>n!==name));
    opts.forEach(o=>{
      const c=el("button","chip"); c.type="button";
      c.textContent = o==="__all__" ? "Everything" : o;
      c.setAttribute("aria-pressed", rcFilter===o ? "true":"false");
      c.addEventListener("click", ()=>{ rcFilter=o; drawFilters(); drawPaper(); });
      host.appendChild(c);
    });
  }

  function drawPaper(){
    const gid=CURRENT, paper=$("rcPaper");
    let h='<div class="rc-title">'+esc(name)+'</div>';

    if(rcFilter==="__all__"){
      $("rcRole").textContent="how the balance is worked out";
      h+='<div class="rc-sub">every line that moves '+esc(name)+'&rsquo;s balance</div><div class="rc-rule"></div>';

      const all=expensesOf(gid);
      const paid=all.filter(e=> e.payer===name );
      const share=all.filter(e=>{
        const b2=(e.between&&e.between.length)?e.between:[e.payer];
        return b2.indexOf(name)!==-1;
      });

      let paidTotal=0;
      h+='<div class="rc-grp">PAID OUT &middot; '+paid.length+' item'+(paid.length===1?"":"s")+'</div>';
      if(!paid.length) h+='<div class="rc-line"><span class="d note">nothing</span><span class="n">'+money(0)+'</span></div>';
      paid.forEach((e,i)=>{
        paidTotal+=Number(e.amount)||0;
        h+='<div class="rc-line"><span class="d">'+(i+1)+') '+esc(e.desc)+'</span><span class="n">'+money(e.amount)+'</span></div>';
      });
      h+='<div class="rc-rule"></div><div class="rc-tot"><span class="d">total paid</span><span class="n">'+money(paidTotal)+'</span></div>';

      let shareTotal=0;
      h+='<div class="rc-grp">THEIR SHARE &middot; '+share.length+' item'+(share.length===1?"":"s")+'</div>';
      if(!share.length) h+='<div class="rc-line"><span class="d note">nothing</span><span class="n">'+money(0)+'</span></div>';
      share.forEach((e,i)=>{
        const sh=sharesOf(e), cut=sh[name]||0;
        const b2=(e.between&&e.between.length)?e.between:[e.payer];
        shareTotal+=cut;
        h+='<div class="rc-line"><span class="d">'+(i+1)+') '+esc(e.desc)+
           ' <span class="note">('+money(e.amount)+(e.mode&&e.mode!=="equal" ? "" : " &divide; "+b2.length)+')</span></span>'+
           '<span class="n">'+money(cut)+'</span></div>';
      });
      h+='<div class="rc-rule"></div><div class="rc-tot"><span class="d">total share</span><span class="n">'+money(shareTotal)+'</span></div>';

      let net=paidTotal-shareTotal;
      const pays=paymentsOf(gid).filter(p=> p.from===name || p.to===name );
      if(pays.length){
        h+='<div class="rc-grp">PAYMENTS &middot; '+pays.length+' item'+(pays.length===1?"":"s")+'</div>';
        pays.forEach((p,i)=>{
          const out = p.from===name;
          net += out ? (Number(p.amount)||0) : -(Number(p.amount)||0);
          h+='<div class="rc-line"><span class="d">'+(i+1)+') '+
             (out ? "paid "+esc(p.to) : "received from "+esc(p.from))+'</span>'+
             '<span class="n">'+(out?"+":"&minus;")+money(p.amount)+'</span></div>';
        });
      }

      h+='<div class="rc-rule solid"></div>';
      h+='<div class="rc-line" style="margin-top:2px"><span class="d">paid</span><span class="n">'+money(paidTotal)+'</span></div>';
      h+='<div class="rc-line"><span class="d">less their share</span><span class="n">&minus;'+money(shareTotal)+'</span></div>';
      h+='<div class="rc-rule"></div>';
      h+='<div class="rc-net">'+(Math.abs(net)<0.005
          ? "SQUARE &mdash; paid exactly their share"
          : (net>0 ? esc(name).toUpperCase()+" IS OWED "+money(net)
                   : esc(name).toUpperCase()+" OWES "+money(-net)))+'</div>';
      h+='<div class="rc-sub" style="margin-top:8px">Tap a name above to see it split person by person.</div>';
    } else {
      const other=rcFilter;
      $("rcRole").textContent="statement with "+other;
      h+='<div class="rc-sub">statement with '+esc(other)+'</div><div class="rc-rule"></div>';
      const theyOwe=itemsOwedTo(name, other), weOwe=itemsOwedTo(other, name);
      const a=sumShares(theyOwe), b2=sumShares(weOwe);

      h+='<div class="rc-grp">'+esc(other).toUpperCase()+' OWES '+esc(name).toUpperCase()+'</div>';
      if(!theyOwe.length) h+='<div class="rc-line"><span class="d note">nothing</span><span class="n">'+money(0)+'</span></div>';
      theyOwe.forEach((x,i)=>{
        h+='<div class="rc-line"><span class="d">'+(i+1)+') '+esc(x.desc)+' <span class="note">('+money(x.total)+' / '+x.ways+')</span></span><span class="n">'+money(x.share)+'</span></div>';
      });
      h+='<div class="rc-rule"></div><div class="rc-tot"><span class="d">subtotal</span><span class="n">'+money(a)+'</span></div>';

      h+='<div class="rc-grp">'+esc(name).toUpperCase()+' OWES '+esc(other).toUpperCase()+'</div>';
      if(!weOwe.length) h+='<div class="rc-line"><span class="d note">nothing</span><span class="n">'+money(0)+'</span></div>';
      weOwe.forEach((x,i)=>{
        h+='<div class="rc-line"><span class="d">'+(i+1)+') '+esc(x.desc)+' <span class="note">('+money(x.total)+' / '+x.ways+')</span></span><span class="n">'+money(x.share)+'</span></div>';
      });
      h+='<div class="rc-rule"></div><div class="rc-tot"><span class="d">subtotal</span><span class="n">'+money(b2)+'</span></div>';

      const net=a-b2;
      h+='<div class="rc-rule solid"></div>';
      h+='<div class="rc-net">'+(Math.abs(net)<0.005
          ? "SQUARE - nothing between you"
          : (net>0 ? esc(other).toUpperCase()+" OWES "+esc(name).toUpperCase()+" "+money(net)
                   : esc(name).toUpperCase()+" OWES "+esc(other).toUpperCase()+" "+money(-net)))+'</div>';
    }
    paper.innerHTML=h;
  }
}
// Lines where `debtor` carries a share of something `creditor` paid for.
function itemsOwedTo(creditor, debtor){
  const out=[];
  expensesOf(CURRENT).forEach(e=>{
    if(e.payer!==creditor) return;
    const b=(e.between&&e.between.length)?e.between:[e.payer];
    if(b.indexOf(debtor)<0) return;
    const sh=sharesOf(e);
    out.push({desc:e.desc, total:Number(e.amount)||0, ways:b.length, share:sh[debtor]||0});
  });
  return out;
}
function sumShares(list){ let t=0; list.forEach(x=> t+=x.share ); return t; }
function paidShareLine(n, gid){
  let paid=0, share=0;
  expensesOf(gid).forEach(e=>{
    if(e.payer===n) paid+=Number(e.amount)||0;
    const sh=sharesOf(e); if(sh[n]) share+=sh[n];
  });
  // Each half stays whole, so a narrow screen breaks between them, never
  // between a word and its figure.
  return '<span class="nw">Paid '+money(paid)+'</span> &middot; <span class="nw">Share '+money(share)+'</span>';
}

/* Add somebody we already know, by their account rather than by their name.
   If a seat is already waiting for them - an unclaimed name that matches, or
   one invited at their address - take that one. Creating a second record
   instead is how a person ends up in a group twice with their balance split
   between the two, which has bitten this group before. */
function addFromDirectory(gid, person){
  const mail = normMail(person.email);
  const full = normName(person.name);
  const first = full.split(" ")[0];
  const free = membersOf(gid).filter(m=>!m.uid);

  // Already here on their account, or on a seat somebody else holds under
  // their address: adding them again is the duplicate this exists to stop.
  // Resolves false when nothing was added, so callers do not act on it.
  const linked = inGroupAlready(gid, {uid:person.uid, email:mail});
  if(linked && (linked.by==="account" || linked.m.uid)){
    toast(linked.text); return Promise.resolve(false);
  }

  // The address is proof. A whole name is near enough.
  let seat = free.find(m=> m.invite && m.invite===mail )
          || free.find(m=> normName(m.name)===full );

  // A Google account says "Kelvin Raj" where the group has always said
  // "Kelvin". Take the seat on a first name only when exactly one could be
  // meant - with two Kelvins, guessing is worse than adding somebody new,
  // because a wrong guess hands one person another person's balance.
  if(!seat && first){
    const near = free.filter(m=>{
      const n=normName(m.name);
      return n===first || n.split(" ")[0]===first;
    });
    if(near.length===1) seat = near[0];
  }

  const after = ()=>{
    // A seat that was waiting keeps the name the group already uses.
    toast((seat ? seat.name : tidyName(person.name))+" added");
    return (mail ? inviteByEmail(gid, mail) : Promise.resolve()).then(()=> true);
  };

  if(seat){
    return upd("trips/"+gid+"/people/"+seat.k,
      {uid:person.uid, email:mail||null, photo:person.photo||null})
      .then(()=> joinUid(gid, person.uid) ).then(after);
  }
  // No seat to take, so this is a new name in the group - and it must not be
  // one the group already uses for somebody else.
  const clash = inGroupAlready(gid, {name:person.name});
  if(clash){
    toast(clash.text+". Rename them first if this is somebody else");
    return Promise.resolve(false);
  }
  return push("trips/"+gid+"/people", {n:tidyName(person.name), c:freeColour(gid), uid:person.uid,
    email:mail||null, photo:person.photo||null})
    .then(()=> joinUid(gid, person.uid) ).then(after);
}

/* ---------- members ---------- */
function sheetMembers(){
  const gid=CURRENT;
  openSheet("People in this group", (b)=>{
    const draw=()=>{
      const list=membersOf(gid), bal=balances(gid);
      b.innerHTML=
        '<div id="mPick"></div>'+
        '<div class="sechead" style="margin-top:18px">Someone new</div>'+
        '<div class="field"><label for="mName">Their name</label>'+
        '<input id="mName" type="text" placeholder="Their name" autocomplete="off"></div>'+
        '<div class="suggest" id="mSuggest" hidden></div>'+
        '<div class="field"><label for="mMail">Their email</label>'+
        '<div style="display:flex;gap:8px"><input id="mMail" type="email" inputmode="email" '+
        'autocapitalize="off" autocorrect="off" placeholder="name@gmail.com">'+
        '<button class="btn p" id="mAdd" style="flex:0 0 auto">Invite</button></div>'+
        '<div class="help">We email them an invitation, so there is nothing for you to send on. '+
        'Leave the address blank to add a name now and sort the account out later.</div></div>'+
        (list.length?'<div class="sechead" style="margin-top:18px">'+list.length+' member'+(list.length===1?"":"s")+'</div>':"")+
        '<div id="mList"></div>';

      // Everybody already in Settle who is not already in this group. Typing a
      // name that has to match exactly is how the same person ends up in a
      // group twice, so offer the people we already know by name instead.
      const taken = membersOf(gid).map(m=>m.uid).filter(Boolean);
      const pool = Object.keys(DIRECTORY)
        .map(u=>Object.assign({uid:u}, DIRECTORY[u]||{}))
        .filter(p=>p.name && taken.indexOf(p.uid)<0 && onThisSide(p.uid))
        .sort((a,b)=>String(a.name).localeCompare(String(b.name)));

      if(pool.length){
        $("mPick").innerHTML='<div class="sechead">Already in Settle — tap to add</div>'+
          '<div class="card" id="mPickList"></div>'+
          '<p class="fine">Picking somebody links their account straight away, so their name '+
          'and balance are theirs from the start — they never have to claim it.</p>';
        const ph=$("mPickList");
        pool.forEach(p=>{
          const r=el("button","row");
          r.innerHTML=avatarHTML("", p.name, null, p.photo, p.uid)+
            '<span class="body"><span class="t1">'+esc(p.name)+'</span>'+
            '<span class="t2">'+esc(p.email||presenceText(p.uid)||"")+'</span></span>'+
            '<span class="right"><span class="ms" aria-hidden="true" '+
            'style="color:var(--tint)">person_add</span></span>';
          r.addEventListener("click", ()=> addFromDirectory(gid, p).then(()=>setTimeout(draw,150)) );
          ph.appendChild(r);
        });
      }

      const host=$("mList");
      list.forEach(m=>{
        const v=bal[m.name]||0, isMe=m.name===ME, mayEdit=isAdmin()||isMe||!m.uid;
        const r=el("div","splitrow");
        const presence=presenceText(m.uid);
        r.innerHTML=avatarHTML("sm", m.name, m.color, m.photo, m.uid)+
          '<span class="nm">'+esc(m.name)+(isMe?' <span class="tag on">you</span>':'')+
          '<span style="display:block;font-size:11.5px;color:var(--label-3)">'+
            (m.email?esc(m.email)+(presence?" \u00b7 "+esc(presence):"")
                    :presence?esc(presence)
                    :m.invite?"invited \u00b7 "+esc(m.invite)
                    :"not signed in yet")+'</span></span>'+
          '<span class="calc">'+(Math.abs(v)<0.005?"settled":money(v))+'</span>';
        if(mayEdit){
          const p=el("button","ibtn");
          p.style.cssText="color:var(--label-2);width:38px;height:38px";
          p.setAttribute("aria-label","Edit "+m.name);
          p.innerHTML='<span class="ms" aria-hidden="true" style="font-size:19px">edit</span>';
          p.addEventListener("click", ()=> sheetPersonEdit(gid, m, draw) );
          r.appendChild(p);
          const x=el("button","ibtn");
          x.style.cssText="color:var(--danger);width:38px;height:38px";
          x.setAttribute("aria-label","Remove "+m.name);
          x.innerHTML='<span class="ms" aria-hidden="true" style="font-size:20px">close</span>';
          x.addEventListener("click", ()=>{
            const used=expensesOf(gid).some(e=>e.payer===m.name||(e.between||[]).indexOf(m.name)>-1)
                    || paymentsOf(gid).some(p2=>p2.from===m.name||p2.to===m.name);
            if(used) return toast("Remove or edit their expenses first");
            del("trips/"+gid+"/people/"+m.k)
              .then(()=> dropUid(gid, m.uid) )
              .then(()=>setTimeout(draw,150));
          });
          r.appendChild(x);
        }
        host.appendChild(r);
      });
      const add=()=>{
        const v=tidyName($("mName").value);
        const mail=normMail($("mMail").value);
        if(!v) return toast("Enter a name");
        if(mail && !emailOk(mail)) return toast("That does not look like an email address");
        const hit=inGroupAlready(gid, {name:v, email:mail});
        if(hit) return toast(hit.text);
        // An address that already belongs to somebody in Settle is that person:
        // add their account, not a second, unlinked copy of them.
        // So is a name exactly one account in Settle has.
        const known = settleAccountFor(v, mail);
        if(known){
          return addFromDirectory(gid, Object.assign({}, known, {name:v}))
            .then(ok=>{ if(ok){
              toast(v+" is in Settle, so their account was added");
              $("mName").value=""; $("mMail").value=""; setTimeout(draw,150);
            } });
        }
        const rec={n:v, c:freeColour(gid)};
        if(mail) rec.invite=mail;
        push("trips/"+gid+"/people", rec).then(()=>{
          if(mail){
            inviteByEmail(gid, mail);
            // And actually tell them. Writing the invitation into the database
            // and hoping they wander in one day is not an invitation.
            notify("group.invite", gid, {desc: mail});
            toast("Invitation on its way to "+mail);
          } else {
            toast(v+" added");
          }
          $("mName").value=""; $("mMail").value="";
          setTimeout(draw,150);
        });
      };
      $("mAdd").addEventListener("click", add);
      // While a name is typed, anybody in Settle it could mean is one tap away.
      const suggest=()=>{
        const host=$("mSuggest"), list=settleSuggestions($("mName").value, gid);
        host.innerHTML=""; host.hidden=!list.length;
        if(!list.length) return;
        host.appendChild(el("span","suggest-l","In Settle:"));
        list.forEach(p=>{
          const c=el("button","chip"); c.type="button";
          c.innerHTML=esc(p.name)+(p.email?'<small>'+esc(p.email)+'</small>':'');
          c.addEventListener("click", ()=> addFromDirectory(gid, p).then(ok=>{
            if(ok){ $("mName").value=""; $("mMail").value=""; setTimeout(draw,150); }
          }));
          host.appendChild(c);
        });
      };
      $("mName").addEventListener("input", suggest);
      $("mName").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); add(); } });
    };
    draw();
  }, render);
}

/* ---------- rename a person / move an account between names ---------- */
function sheetPersonEdit(gid, m, after){
  const isMe = m.uid && USER && m.uid===USER.uid;
  // A duplicate usually needs folding into a name that has fallen off the
  // members list, so offer those too - they still hold a balance.
  const others = everyoneIn(gid).filter(n=> n!==m.name ).map(n=>({name:n}));
  const pv = mergePreview(gid, m.name);
  openSheet(m.name, (b)=>{
    b.innerHTML=
      fieldHTML("pnName","Name","text", m.name)+
      '<div class="help" style="margin:-8px 0 16px">Changing this renames them on every expense and '+
      'payment in the group, so the balances stay right.</div>'+
      '<button class="btn p wide" id="pnSave">Save name</button>'+
      (m.email?'<div class="sechead">Account</div>'+
        '<p class="fine" style="margin:0 0 12px">'+esc(m.name)+' is signed in as '+esc(m.email)+'.</p>'
       :'<div class="sechead">Invite by email</div>'+
        '<div class="field"><label for="pnMail">Their Google address</label>'+
        '<input id="pnMail" type="email" inputmode="email" autocapitalize="off" autocorrect="off" '+
        'value="'+esc(m.invite||"")+'" placeholder="name@gmail.com"></div>'+
        '<button class="btn s wide" id="pnInvite">Save address and invite</button>'+
        '<p class="fine">The group shows up for them when they sign in, already on this name.</p>')+
      (isMe?'<button class="btn s wide" id="pnFree">This is not me — release this name</button>'+
        '<p class="fine">You will be asked which name is yours next time you open the group.</p>':'')+
      ((!m.uid && USER)?'<div class="sechead">Or</div>'+
        '<button class="btn s wide" id="pnMine">This one is me</button>':'')+
      (others.length?'<div class="sechead">Same person twice?</div>'+
        '<p class="lead" style="text-align:left;margin:0 0 14px">'+
        'Fold '+esc(m.name)+' into someone else. Everything they paid, owe or were '+
        'split into moves across, and '+esc(m.name)+' is removed. '+
        (pv.paid+pv.inSplit+pv.pays ?
          'That is '+pv.paid+' expense'+(pv.paid===1?'':'s')+' paid, '+
          pv.inSplit+' split'+(pv.inSplit===1?'':'s')+' and '+
          pv.pays+' payment'+(pv.pays===1?'':'s')+'.' :
          'They are not on anything yet.')+'</p>'+
        '<div class="field"><label for="pnInto">Merge into</label><select id="pnInto">'+
          others.map(o=>'<option value="'+esc(o.name)+'">'+esc(o.name)+'</option>').join("")+
        '</select></div>'+
        '<button class="btn d wide" id="pnMerge">Merge and remove '+esc(m.name)+'</button>':'');

    $("pnSave").addEventListener("click", ()=>{
      const v=tidyName($("pnName").value);
      if(!v) return toast("Enter a name");
      if(v===m.name){ closeSheet(); return; }
      // Their own name in different case is fine; anybody else's is not -
      // folding two people together is what Merge is for, and it says so.
      const hit=inGroupAlready(gid, {name:v}, m.k);
      if(hit) return toast(hit.text);
      renamePerson(gid, m.k, m.name, v).then(()=>{
        closeSheet(); toast("Renamed to "+v); if(after) setTimeout(after,200);
      });
    });
    if($("pnFree")) $("pnFree").addEventListener("click", ()=>{
      unlinkPerson(gid, m.k).then(()=>{
        claimAsked[gid]=false; autoLinked[gid]=true;   // do not silently retake it
        closeSheet(); toast("Released — pick your name again"); render();
      });
    });
    if($("pnInvite")) $("pnInvite").addEventListener("click", ()=>{
      const mail=normMail($("pnMail").value);
      if(!emailOk(mail)) return toast("That does not look like an email address");
      const hit=inGroupAlready(gid, {email:mail}, m.k);
      if(hit) return toast(hit.text);
      upd("trips/"+gid+"/people/"+m.k, {invite:mail})
        .then(()=> inviteByEmail(gid, mail) )
        .then(()=>{ closeSheet(); toast(m.name+" will see this group when they sign in");
                    if(after) setTimeout(after,220); });
    });
    if($("pnMerge")) $("pnMerge").addEventListener("click", ()=>{
      const into=$("pnInto").value;
      if(into===m.name) return toast("Pick a different person");
      const ok=confirm("Move everything from "+m.name+" to "+into+", and remove "+m.name+"?"
        +"\n\nThis changes what people owe, and it cannot be undone.");
      if(!ok) return;
      mergePeople(gid, m.name, into).then(()=>{
        closeSheet(); toast(m.name+" merged into "+into); render();
        if(after) setTimeout(after, 250);
      });
    });
    if($("pnMine")) $("pnMine").addEventListener("click", ()=>{
      const had = meIn(gid);
      const mine = had ? membersOf(gid).find(x=>x.uid===USER.uid) : null;
      const go = mine ? unlinkPerson(gid, mine.k) : Promise.resolve();
      go.then(()=> linkPerson(gid, m.k) ).then(()=>{
        closeSheet(); toast("You are "+m.name+" in this group"); render();
      });
    });
  });
}

// The invitee cannot be reached by uid before they have ever signed in, so the
// pointer is filed under their email and they pick it up on first sign-in.
function inviteByEmail(gid, mail){
  return set("invites/"+emailKey(mail)+"/"+gid,
             {name:groupName(gid), at:Date.now(), by:(ME||USER.name)})
    .catch(()=>{ toast("Saved the address, but could not send the invite"); });
}

/* ---------- notification settings ----------
   Stored at users/{uid}/prefs, which only that account can read or write.
   The weekly reminder is on unless it has been explicitly switched off, so an
   account that predates this setting still gets one. */
const PREF_ROWS = [
  ["weekly",    "Weekly reminder",        "A round-up of what you owe and what you are owed.",                  true],
  // On for everybody unless they switch it off, the same as the weekly one -
  // and the same rule the mailer applies, so the switch shows what will happen.
  ["newExpense","New expenses",           "When somebody adds an expense to one of your groups.",              true],
  ["updates",   "Expense changes",        "When somebody edits or deletes an expense you are part of.",        true],
  ["payments",  "Payments",               "When somebody records a payment involving you.",                    true]
];
// Canada first, since that is where this group is, then the rest.
const TZ_CHOICES = [
  "America/Toronto","America/Montreal","America/Halifax","America/St_Johns",
  "America/Winnipeg","America/Regina","America/Edmonton","America/Vancouver",
  "America/New_York","America/Chicago","America/Denver","America/Los_Angeles",
  "Europe/London","Europe/Paris","Asia/Kolkata","Asia/Dubai","Asia/Singapore",
  "Asia/Tokyo","Australia/Sydney","Pacific/Auckland","UTC"
];
const prefOn = (k, dflt) => {
  const v = PREFS[k];
  return v === undefined || v === null ? dflt : v !== false;
};
function guessTz(){
  try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto"; }
  catch(e){ return "America/Toronto"; }
}

function sheetNotifications(){
  openSheet("Notifications", (b)=>{
    const tzNow = (typeof PREFS.tz === "string" && PREFS.tz) || guessTz();
    const choices = TZ_CHOICES.indexOf(tzNow)>-1 ? TZ_CHOICES : [tzNow].concat(TZ_CHOICES);
    b.innerHTML =
      '<p class="lead">Emails go to '+esc(USER.email)+'. With phone notifications on, these switches cover your phone too.</p>'+
      '<div class="card" id="prefList"></div>'+
      '<div class="sechead">Your timezone</div>'+
      '<div class="field"><label for="prTz">Send at 5pm where you are</label>'+
      '<select id="prTz">'+choices.map(t=>
        '<option value="'+esc(t)+'"'+(t===tzNow?' selected':'')+'>'+esc(t.replace(/_/g," "))+'</option>').join("")+
      '</select>'+
      '<div class="help">The reminder is worked out against this clock, so it arrives on your '+
      'Sunday evening rather than somebody else’s.</div></div>'+
      '<p class="fine">Reminders currently go out: '+esc(schedLine())+'.</p>'+
      '<p class="fine">The bottom three are gathered up and sent '+esc(callGap())+', so four '+
      'expenses added in one sitting arrive as one email rather than four.</p>';

    const host=$("prefList");
    PREF_ROWS.forEach(r=>{
      const [key, title, sub, dflt] = r;
      const on = prefOn(key, dflt);
      const row=el("button","row");
      row.innerHTML=
        '<span class="cat'+(on?" teal":"")+'"><span class="ms" aria-hidden="true">'+
          (on?"notifications_active":"notifications_off")+'</span></span>'+
        '<span class="body"><span class="t1">'+esc(title)+'</span>'+
        '<span class="t2">'+esc(sub)+'</span></span>'+
        '<span class="right"><span class="switch'+(on?" on":"")+'" aria-hidden="true"><i></i></span></span>';
      row.setAttribute("role","switch");
      row.setAttribute("aria-checked", on?"true":"false");
      row.addEventListener("click", ()=>{
        const next = !(row.getAttribute("aria-checked")==="true");
        PREFS[key]=next;
        savePrefs({[key]: next});
        sheetNotifications();                      // redraw with the new state
      });
      host.appendChild(row);
    });

    $("prTz").addEventListener("change", ()=>{
      PREFS.tz=$("prTz").value;
      savePrefs({tz: PREFS.tz});
      toast("Reminders will follow "+PREFS.tz.replace(/_/g," "));
    });
  });
}
function savePrefs(patch){
  if(!remote || !USER) return Promise.resolve();
  return upd("users/"+USER.uid+"/prefs", patch);
}

/* ---------- admin: when reminders go out ----------
   Lives at config/reminders. Readable by anyone signed in so the app can show
   what the schedule is; writable only by the administrator, enforced by the
   database rules rather than by hiding the button. */
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const SCHED_DEFAULT = { enabled:true, days:[0], hour:16, windowHours:5, callEveryMins:1440 };

/* How often the outside caller actually rings the endpoint. Nothing in here
   can detect that - it is a setting on cron-job.org or Vercel - so the
   administrator states it, and everything that depends on it follows: the
   warning about unreachable send times, and every promise the app makes
   about how long an email takes to arrive. */
const CALL_CHOICES = [[1440,"Once a day"],[60,"Every hour"],[30,"Every 30 minutes"],
                      [15,"Every 15 minutes"],[10,"Every 10 minutes"],[5,"Every 5 minutes"],
                      [2,"Every 2 minutes"],[1,"Every minute"]];

function schedNow(){
  const c = (SCHED && typeof SCHED === "object") ? SCHED : {};
  let days = Array.isArray(c.days) ? c.days.filter(d=>Number.isInteger(d)&&d>=0&&d<=6) : [];
  days = [...new Set(days)].sort((a,b)=>a-b);
  return {
    enabled: c.enabled !== false,
    days: days.length ? days : SCHED_DEFAULT.days,
    hour: Number.isInteger(c.hour)&&c.hour>=0&&c.hour<=23 ? c.hour : SCHED_DEFAULT.hour,
    windowHours: Number.isInteger(c.windowHours)&&c.windowHours>=1&&c.windowHours<=12
      ? c.windowHours : SCHED_DEFAULT.windowHours,
    // hourly was a yes/no before this was a number. Honour the old value so
    // an existing setting does not silently revert to once a day.
    callEveryMins: Number.isInteger(c.callEveryMins) && c.callEveryMins>0 && c.callEveryMins<=1440
      ? c.callEveryMins : (c.hourly === true ? 60 : SCHED_DEFAULT.callEveryMins)
  };
}
function schedLine(){
  const c = schedNow();
  if(!c.enabled) return "Reminders are switched off";
  const to = (c.hour + c.windowHours) % 24;
  return c.days.map(d=>DAY_NAMES[d]).join(", ")+" between "+
         String(c.hour).padStart(2,"0")+":00 and "+String(to).padStart(2,"0")+":00";
}

/* How long something dropped in the queue waits, in words. Used wherever the
   app tells somebody an email is on its way. */
function callGap(){
  const m = schedNow().callEveryMins;
  if(m >= 1440) return "on the next daily run";
  if(m === 60)  return "within the hour";
  if(m === 1)   return "within a minute";
  return "within about "+m+" minutes";
}

function sheetSchedule(){
  openSheet("Reminder schedule", (b)=>{
    const draw = ()=>{
      const c = schedNow();
      b.innerHTML =
        '<p class="lead">When the weekly email goes out. Each person still gets it at '+
        'this time on <em>their own</em> clock.</p>'+
        '<div class="card" id="schOn"></div>'+
        '<div class="sechead">Days</div>'+
        '<div class="chips" id="schDays"></div>'+
        '<div class="sechead">Time</div>'+
        '<div class="arow">'+
          '<div class="field" style="flex:1 1 140px"><label for="schHour">From</label>'+
          '<select id="schHour">'+[...Array(24).keys()].map(h=>
            '<option value="'+h+'"'+(h===c.hour?' selected':'')+'>'+String(h).padStart(2,"0")+':00</option>').join("")+
          '</select></div>'+
          '<div class="field" style="flex:1 1 140px"><label for="schWin">Window</label>'+
          '<select id="schWin">'+[1,2,3,4,5,6,8,12].map(w=>
            '<option value="'+w+'"'+(w===c.windowHours?' selected':'')+'>'+w+' hour'+(w===1?"":"s")+'</option>').join("")+
          '</select></div>'+
        '</div>'+
        '<p class="fine" id="schSummary"></p>'+
        '<div id="schWarn"></div>'+
        '<div class="sechead">Scheduler</div>'+
        '<div class="card" id="schHourly"></div>'+
        '<p class="fine">The window exists because a once-a-day scheduler is fixed in UTC, '+
        'and that drifts by an hour when the clocks change. Keep it at least two hours wide '+
        'unless the scheduler runs more often than daily.</p>';

      const on = c.enabled;
      const row = el("button","row");
      row.innerHTML='<span class="cat'+(on?" teal":"")+'"><span class="ms" aria-hidden="true">'+
        (on?"alarm_on":"alarm_off")+'</span></span>'+
        '<span class="body"><span class="t1">Send reminders</span>'+
        '<span class="t2">'+(on?"On for everyone who has not opted out":"Nobody receives them")+'</span></span>'+
        '<span class="right"><span class="switch'+(on?" on":"")+'" aria-hidden="true"><i></i></span></span>';
      row.setAttribute("role","switch"); row.setAttribute("aria-checked", on?"true":"false");
      row.addEventListener("click", ()=> saveSched({enabled: !on}).then(draw) );
      $("schOn").appendChild(row);

      DAY_NAMES.forEach((nm,i)=>{
        const ch=el("button","chip"); ch.type="button"; ch.textContent=nm;
        const picked = c.days.indexOf(i)>-1;
        ch.setAttribute("aria-pressed", picked?"true":"false");
        ch.addEventListener("click", ()=>{
          const days = picked ? c.days.filter(d=>d!==i) : c.days.concat([i]).sort((a,b)=>a-b);
          if(!days.length) return toast("Pick at least one day");
          saveSched({days}).then(draw);
        });
        $("schDays").appendChild(ch);
      });

      $("schSummary").textContent = schedLine();

      // The once-a-day scheduler lands at 17:00 Toronto in summer and 16:00 in
      // winter. A window that misses both hours will simply never fire, and
      // the only symptom is silence - so say so here rather than let it be
      // discovered weeks later.
      const covers = (h)=>{
        for(let i=0;i<c.windowHours;i++) if((c.hour+i)%24===h) return true;
        return false;
      };
      const hr=el("div","field");
      hr.style.cssText="padding:12px 16px 14px";
      hr.innerHTML='<label for="schCall">How often the scheduler calls</label>'+
        '<select id="schCall">'+CALL_CHOICES.map(x=>
          '<option value="'+x[0]+'"'+(x[0]===c.callEveryMins?' selected':'')+'>'+x[1]+'</option>').join("")+
        '</select>'+
        '<div class="help">Set this to match cron-job.org. It is what decides how long '+
        'a new expense or a request to join waits before the email goes out — right now, '+
        esc(callGap())+'.</div>';
      $("schHourly").appendChild(hr);
      $("schCall").addEventListener("change", ()=> saveSched({callEveryMins: Number($("schCall").value)}).then(draw) );

      // Only a once-a-day scheduler can miss a window. Anything more frequent
      // lands inside any window there is, so the warning would be wrong.
      if(c.enabled && c.callEveryMins >= 1440 && !(covers(16) && covers(17))){
        const w=el("div","notice warn");
        w.innerHTML='<span class="ms" aria-hidden="true">warning</span>'+
          '<div><strong>Nothing will be sent at this time</strong><br>'+
          'The scheduler runs once a day and lands around 16:00–17:00. This window '+
          'misses it. Either include those hours, or call the endpoint more often and '+
          'say so above — then any time works.</div>';
        $("schWarn").appendChild(w);
      }
      $("schHour").addEventListener("change", ()=> saveSched({hour: Number($("schHour").value)}).then(draw) );
      $("schWin").addEventListener("change", ()=> saveSched({windowHours: Number($("schWin").value)}).then(draw) );
    };
    draw();
  }, render);
}
function saveSched(patch){
  if(!remote || !USER) return Promise.resolve();
  SCHED = Object.assign({}, schedNow(), patch);
  return upd("config/reminders",
    Object.assign({}, patch, {updatedAt: Date.now(), updatedBy: USER.email || USER.name}))
    .then(()=> toast("Schedule saved") );
}

/* ---------- admin: who is waiting to be let in ----------
   The email link is the quick path, but it expires after a fortnight and it
   can be deleted or missed. This is the copy that is always there, and it is
   also the only way to change a decision already made. */
const ACC_WORDS = { pending:"Waiting", never:"Never asked", approved:"In", declined:"Turned away" };

function sheetRequests(){
  openSheet("Requests to join", (b)=>{
    const draw = ()=>{
      const all = Object.keys(REQUESTS).map(uid=>Object.assign({uid}, REQUESTS[uid]||{}))
        .filter(x=>x.status);

      // Anybody who has signed in but has no record at all. Before the gate
      // existed that was everybody, and they need approving before it shuts.
      Object.keys(ALLUSERS).forEach(uid=>{
        if(REQUESTS[uid] && REQUESTS[uid].status) return;
        const p = (ALLUSERS[uid]||{}).profile || {};
        if(!p.email) return;
        all.push({uid, status:"never", name:p.name, email:p.email, at:p.at});
      });

      const order = {pending:0, never:1, approved:2, declined:3};
      all.sort((x,y)=> (order[x.status]-order[y.status]) || (Number(y.at||0)-Number(x.at||0)) );

      if(!all.length){
        b.innerHTML='<p class="lead">Nobody has asked to join yet.</p>'+
          '<p class="fine">When somebody signs in with Google for the first time they '+
          'are shown a screen asking them to request access, and you get an email.</p>';
        return;
      }

      const never = all.filter(x=>x.status==="never").length;
      b.innerHTML='<p class="lead">Approving somebody lets them see the groups they '+
        'are added to, start their own, and add expenses. Nobody can ever change or '+
        'delete an entry somebody else made.</p>'+
        (never ? '<p class="fine"><strong>'+never+'</strong> '+(never===1?"person has":"people have")+
                 ' been using Settle since before this screen existed. Approve '+
                 (never===1?"them":"them all")+' before switching the gate on, or they '+
                 'will be locked out.</p>' : '')+
        '<div class="card" id="reqList"></div>'+
        '<p class="fine">Turning somebody away does not delete anything. You can change '+
        'your mind here at any time.</p>';

      const host=$("reqList");
      all.forEach(x=>{
        const row=el("div","row");
        const when = x.at ? " · "+fmtDate(Number(x.at)) : "";
        row.innerHTML=
          '<span class="cat'+(x.status==="approved"?" teal":x.status==="declined"?" bad":" warn")+'">'+
            '<span class="ms" aria-hidden="true">'+
            (x.status==="approved"?"check":x.status==="declined"?"block":
             x.status==="never"?"person":"schedule")+'</span></span>'+
          '<span class="body"><span class="t1">'+esc(x.name||x.email||x.uid)+'</span>'+
          '<span class="t2">'+esc(x.email||"no address")+esc(when)+'</span></span>'+
          '<span class="right"><span class="tag'+(x.status==="approved"?" on":x.status==="declined"?"":" warn")+'">'+
            ACC_WORDS[x.status]+'</span></span>';
        host.appendChild(row);

        const acts=el("div","arow");
        acts.style.cssText="padding:0 16px 14px;gap:8px";
        if(x.status!=="approved"){
          const y=el("button","btn primary"); y.type="button"; y.style.flex="1 1 120px";
          y.textContent = x.status==="declined" ? "Let them in" : "Approve";
          y.addEventListener("click", ()=> decide(x, "approved") );
          acts.appendChild(y);
        }
        if(x.status!=="declined"){
          const n=el("button","btn"); n.type="button"; n.style.flex="1 1 120px";
          n.textContent = x.status==="approved" ? "Remove access" : "Decline";
          n.addEventListener("click", ()=>{
            if(x.status==="approved" &&
               !confirm("Remove access for "+(x.name||x.email)+"? They keep their expenses, "+
                        "but will not be able to open Settle.")) return;
            decide(x, "declined");
          });
          acts.appendChild(n);
        }
        // Taking somebody off the list is not the same as turning them away.
        // Declined is an answer and they are told it; removed is a clean slate,
        // and the next time they open Settle they are asked to request again.
        // It is also the only way back from a decision made by mistake.
        if(x.status!=="never"){
          const rm=el("button","btn"); rm.type="button"; rm.style.flex="1 1 100%";
          rm.textContent="Remove from the list";
          rm.addEventListener("click", ()=>{
            if(!confirm("Take "+(x.name||x.email)+" off the list?\n\n"+
                        "Nothing of theirs is deleted — their expenses and their name in "+
                        "any group stay exactly as they are. They simply go back to being "+
                        "asked to request access next time they open Settle.")) return;
            del("access/"+x.uid).then(()=>{
              delete REQUESTS[x.uid];
              toast((x.name||x.email)+" taken off the list");
              draw(); render();
            });
          });
          acts.appendChild(rm);
        }

        if(acts.children.length) host.appendChild(acts);
      });

      function decide(x, status){
        // The app writes the decision; the email telling them is sent by the
        // server, which is the only place that may send anything.
        const patch = {status:status, decidedAt:Date.now(),
                       decidedBy:(USER.email||USER.name)};
        // Somebody who never asked has no record to carry their details, and
        // the server reads this record — not their profile — to find out
        // where to send the answer. Without this they would be approved and
        // never told.
        if(!(REQUESTS[x.uid] && REQUESTS[x.uid].email)){
          patch.name = x.name || "";
          patch.email = (x.email||"").toLowerCase();
          patch.at = Number(x.at) || Date.now();
        }
        upd("access/"+x.uid, patch)
          .then(()=>{
            REQUESTS[x.uid]=Object.assign({}, REQUESTS[x.uid], patch);
            toast(status==="approved" ? (x.name||x.email)+" can use Settle"
                                      : (x.name||x.email)+" cannot use Settle");
            draw(); render();
          });
      }
    };
    draw();
  }, render);
}

/* ---------- create / join / share a group ---------- */
function slug(s){
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,28) || "group";
}
function sheetGroupNew(){
  // Everybody already in Settle, so they can be picked rather than typed.
  const pool = Object.keys(DIRECTORY||{}).map(u=> Object.assign({uid:u}, DIRECTORY[u]||{}))
    .filter(p=> p.name && !(USER && p.uid===USER.uid) && onThisSide(p.uid))
    .sort((a,c)=> String(a.name).localeCompare(String(c.name)));
  const chosen = {};
  openSheet("New group", (b)=>{
    b.innerHTML=
      '<div class="field"><label for="gName">Group name</label>'+
      '<input id="gName" type="text" placeholder="Montréal trip, Flat 4B, Sunday football…"></div>'+
      '<div class="field"><label>What is it for?</label><div class="chips" id="gType"></div></div>'+
      '<div class="sidenote"><span class="sf-flag">'+SIDES[SIDE].flag+'</span><span><b>'+SIDES[SIDE].name+' group</b>'+
        '<small>'+(SIDE==="INR" ? 'In ₹ rupees, paid back by UPI' : 'In $ dollars, paid back by Interac')+'</small></span></div>'+
      (pool.length ? '<div class="field"><label>Already in Settle — tap to include</label>'+
        '<div class="chips" id="gPick"></div></div>' : '')+
      '<div class="field"><label for="gPeople">'+(pool.length ? "Anyone else" : "Everyone else")+' (one name per line)</label>'+
      '<textarea id="gPeople" rows="3" placeholder="Friends who are not on Settle yet"></textarea>'+
      '<div class="help" id="gNote"></div></div>'+
      '<button class="btn p wide" id="gGo">Create group</button>';
    let type="trip";
    const types=[["trip","Trip","luggage"],["home","Home","home"],["couple","Couple","favorite"],["other","Other","group"]];
    types.forEach(t=>{
      const ch=el("button","chip"); ch.type="button";
      ch.innerHTML='<span class="ms" aria-hidden="true" style="font-size:18px">'+t[2]+'</span>'+t[1];
      ch.setAttribute("aria-pressed", t[0]===type?"true":"false");
      ch.addEventListener("click",()=>{ type=t[0];
        [].forEach.call($("gType").children,x=>x.setAttribute("aria-pressed","false"));
        ch.setAttribute("aria-pressed","true"); });
      $("gType").appendChild(ch);
    });
    // A group is made on the side on screen, in that side's currency.
    const cur=SIDE;
    $("gGo").addEventListener("click", ()=>{
      const nm=$("gName").value.trim();
      if(!nm) return toast("Give the group a name");
      const gid=slug(nm)+"-"+Math.random().toString(36).slice(2,6);
      const people={};
      people["m0"+uid().slice(-4)]={n:USER.name, c:PALETTE[0], uid:USER.uid, email:USER.email, photo:USER.photo||null};
      const seen={}; seen[normName(USER.name)]=1;
      const uids={[USER.uid]:true}, invite=[];
      let i=0;
      // One seat per person. Somebody with an account goes in as that account -
      // on the membership list and with an invitation under their address - so
      // the group shows up for them without anybody sending a link.
      const seat=(n, acct)=>{
        const key=normName(n);
        if(seen[key] || (acct && uids[acct.uid])) return;
        seen[key]=1; i++;
        const rec={n:n, c:PALETTE[i%PALETTE.length]};
        if(acct){
          rec.uid=acct.uid; rec.email=normMail(acct.email)||null; rec.photo=acct.photo||null;
          uids[acct.uid]=true; if(rec.email) invite.push(rec.email);
        }
        people["m"+i+uid().slice(-4)]=rec;
      };
      pool.filter(p=> chosen[p.uid]).forEach(p=> seat(tidyName(p.name), p) );
      $("gPeople").value.split(/\r?\n/).map(tidyName).filter(Boolean).forEach(n=>{
        const acct=settleAccountFor(n);
        seat(n, acct && acct.uid!==USER.uid ? acct : null);
      });
      // The person creating it is its first member, in the index the rules read
      // as well as in the people list - otherwise they cannot open what they
      // have just made.
      set("trips/"+gid, {meta:{name:nm, type:type, currency:cur, at:Date.now(), by:USER.name, byUid:USER.uid},
                         people:people, uids:uids}).then(()=>{
        rememberGroup(gid, nm); watchGroup(gid); claimAsked[gid]=true; closeSheet();
        invite.forEach(m=> inviteByEmail(gid, m) );
        setTimeout(()=>{ openGroup(gid); toast("Group created — share the link to invite people"); }, 260);
      });
    });
    // People already in Settle, picked with a tap.
    if(pool.length){
      pool.forEach(p=>{
        const c=el("button","chip"); c.type="button"; c.textContent=p.name;
        c.setAttribute("aria-pressed","false");
        c.addEventListener("click", ()=>{
          chosen[p.uid]=!chosen[p.uid];
          c.setAttribute("aria-pressed", chosen[p.uid] ? "true" : "false");
          note();
        });
        $("gPick").appendChild(c);
      });
    }
    // Say which typed names will be linked to an account, as they are typed.
    function note(){
      const typed=$("gPeople").value.split(/\r?\n/).map(tidyName).filter(Boolean);
      const linked=typed.map(n=> settleAccountFor(n)).filter(a=> a && a.uid!==USER.uid && !chosen[a.uid]);
      $("gNote").textContent = linked.length
        ? "Linked to their Settle account: "+linked.map(a=>a.name).join(", ")+". You are added automatically."
        : "You are added automatically. Names that match someone in Settle are linked to their account.";
    }
    $("gPeople").addEventListener("input", note);
    note();
    setTimeout(()=>$("gName").focus(), 90);
  });
}
function sheetGroupJoin(){
  openSheet("Join a group", (b)=>{
    b.innerHTML=
      '<p class="lead">Paste the link someone shared, or type the group code from the end of it.</p>'+
      '<div class="field"><label for="jCode">Link or code</label>'+
      '<input id="jCode" type="text" placeholder="https://…/#g=montreal-trip-4f2a" autocapitalize="off" autocorrect="off"></div>'+
      '<button class="btn p wide" id="jGo">Join</button>';
    $("jGo").addEventListener("click", ()=>{
      let v=$("jCode").value.trim();
      const m=v.match(/[#?&]g=([A-Za-z0-9_-]+)/);
      if(m) v=m[1];
      v=v.replace(/^.*\//,"").replace(/[^A-Za-z0-9_-]/g,"");
      if(!v) return toast("Paste a link or code");
      if(!remote) return toast("Not signed in yet — try again in a moment");
      remote.get(ref("trips/"+v+"/meta")).then(snap=>{
        if(!snap.exists()) return toast("No group with that code");
        const meta=snap.val()||{};
        rememberGroup(v, meta.name||"Group"); watchGroup(v); closeSheet();
        setTimeout(()=>{ openGroup(v); toast("Joined "+(meta.name||"the group")); }, 260);
      }).catch(()=>toast("Could not check that code"));
    });
    setTimeout(()=>$("jCode").focus(), 90);
  });
}
function shareURL(gid){ return location.origin+location.pathname+"#g="+gid; }
function sheetShare(){
  const gid=CURRENT, url=shareURL(gid);
  openSheet("Invite people", (b)=>{
    b.innerHTML=
      '<p class="lead">Anyone who opens this link signs in with Google, picks their name '+
      'from the list, and sees the same expenses as you — live.</p>'+
      '<div class="field"><label for="shUrl">Link</label>'+
      '<input id="shUrl" type="text" readonly value="'+esc(url)+'"></div>'+
      '<div class="btnrow"><button class="btn p" id="shCopy">Copy link</button>'+
      (navigator.share?'<button class="btn s" id="shNative">Share…</button>':'')+'</div>'+
      '<div class="sechead">Group code</div>'+
      '<p class="code">'+esc(gid)+'</p>';
    $("shCopy").addEventListener("click", ()=>{
      const i=$("shUrl"); i.select(); i.setSelectionRange(0,9999);
      const done=()=>toast("Link copied");
      if(navigator.clipboard && navigator.clipboard.writeText)
        navigator.clipboard.writeText(url).then(done, ()=>{ document.execCommand("copy"); done(); });
      else { document.execCommand("copy"); done(); }
    });
    if($("shNative")) $("shNative").addEventListener("click", ()=>{
      navigator.share({title:groupName(gid), text:"Join “"+groupName(gid)+"” to split expenses", url:url}).catch(()=>{});
    });
  });
}
/* Deleting a group is never one tap. The menu item opens this; it says what
   will be lost, and the button stays off until the group's name is typed -
   a deliberate act that a stray tap or a muscle-memory "OK" cannot make. */
function sheetGroupDelete(gid){
  if(!isAdmin()) return toast("Only the administrator can delete a group");
  const name = groupName(gid);
  const ex = expensesOf(gid).length, pay = paymentsOf(gid).length, ppl = membersOf(gid).length;
  const n = (k, one, many)=> k+" "+(k===1 ? one : many);
  openSheet("Delete this group?", (b)=>{
    b.innerHTML=
      '<div class="delwarn"><span class="ms" aria-hidden="true">warning</span>'+
        '<p>Are you sure you want to delete <strong>'+esc(name)+'</strong>? '+
        'It is removed for everyone in it, and it cannot be undone.</p></div>'+
      '<ul class="dellist">'+
        '<li>'+n(ex,"expense","expenses")+' deleted</li>'+
        '<li>'+n(pay,"payment","payments")+' deleted</li>'+
        '<li>'+n(ppl,"person loses","people lose")+' the group and its balances</li>'+
      '</ul>'+
      '<div class="field"><label for="gdName">To confirm, type the group name: <strong>'+esc(name)+'</strong></label>'+
        '<input id="gdName" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" '+
        'spellcheck="false" placeholder="'+esc(name)+'"></div>'+
      '<button class="btn d wide" id="gdGo" disabled>Delete for everyone</button>'+
      '<button class="btn s wide" id="gdKeep" style="margin-top:10px">Keep the group</button>';
    const typed = ()=> normName($("gdName").value)===normName(name);
    $("gdName").addEventListener("input", ()=>{ $("gdGo").disabled = !typed(); });
    $("gdName").addEventListener("keydown", e=>{ if(e.key==="Enter") e.preventDefault(); });
    $("gdKeep").addEventListener("click", closeSheet);
    $("gdGo").addEventListener("click", ()=>{
      if(!typed() || !isAdmin()) return;
      $("gdGo").disabled = true;
      del("trips/"+gid).then(()=>{
        closeSheet(); forgetGroup(gid); closeGroup(); toast("Group deleted");
      }, ()=>{
        $("gdGo").disabled = false; toast("Could not delete the group");
      });
    });
    setTimeout(()=>$("gdName").focus(), 120);
  });
}
function sheetGroupMenu(){
  const gid=CURRENT;
  const meta=(DATA[gid]&&DATA[gid].meta)||{};
  // Deleting a group takes every expense and payment in it away from everyone
  // in it, so it is the administrator's alone - not whoever happened to create
  // it. The database rules say the same, so the menu is not the only guard.
  const canDelete = isAdmin();
  openSheet(groupName(gid), (b)=>{
    const items=[
      ["People in this group","Add or remove members","group", sheetMembers],
      ["Settle up","Record a cash or transfer payment","payments", function(){ sheetSettle(); }],
      ["Rename group","","edit", sheetGroupRename],
      ["Side", SIDES[curOf(gid)].name+(curOf(gid)==="INR" ? " · ₹ rupees, UPI" : " · $ dollars, Interac"), "flag", sheetGroupCurrency],
      ["Simplify debts", simplifyOn(gid) ? "On · fewest payments" : "Off · every direct debt shown", "call_split", sheetSimplifyToggle],
      ["Invite people","Share the link or code","person_add", sheetShare],
      ["Print / save as PDF","A full statement of this group","print", doPrint],
      ["Leave group","Your name and balances stay in it for everyone else.","logout", function(){
          if(!confirm("Leave “"+groupName(gid)+"”? Your name and what you owe stay in the group, and someone can add you back.")) return;
          // Off the seat as well as off the list. Still seated on this account,
          // the group would be put straight back on the list on the next pass.
          const mine = USER && membersOf(gid).find(x=>x.uid===USER.uid);
          const off = mine
            ? upd("trips/"+gid+"/people/"+mine.k, {invite:null}).then(()=> unlinkPerson(gid, mine.k) ).catch(()=>{})
            : Promise.resolve();
          off.then(()=>{ forgetGroup(gid); closeGroup(); });
      }]
    ];
    if(!meIn(gid)) items.unshift(["Tell them which one is you","Claim your name in this group","how_to_reg",
      function(){ sheetClaim(gid); }]);
    if(canDelete) items.push(["Delete group","Permanently delete it for everyone","delete_forever", function(){
          sheetGroupDelete(gid);
      }]);
    const c=el("div","card"); c.style.cssText="margin:-16px -16px 0;box-shadow:none";
    items.forEach(it=>{
      const danger = it[2]==="delete_forever";
      const r=el("button","row");
      r.innerHTML='<span class="cat'+(danger?" bad":it[2]==="how_to_reg"?" teal":"")+'">'+
        '<span class="ms" aria-hidden="true">'+it[2]+'</span></span>'+
        '<span class="body"><span class="t1"'+(danger?' style="color:var(--danger)"':'')+'>'+it[0]+'</span>'+
        (it[1]?'<span class="t2">'+it[1]+'</span>':'')+'</span>';
      r.addEventListener("click", ()=>{ closeSheet(); setTimeout(it[3], 240); });
      c.appendChild(r);
    });
    b.appendChild(c);
    if(canDelete){
      const f=el("p","fine");
      f.style.cssText="text-align:center;margin:14px 0 0";
      f.textContent = "Only you can delete this, because you are the administrator.";
      b.appendChild(f);
    }
  });
}
/* The group's currency. Changing it changes the symbol and how people pay -
   it never converts an amount - so it is for putting right a group that was
   started in the wrong one. */
function sheetGroupCurrency(){
  const gid=CURRENT, now=curOf(gid), n=expensesOf(gid).length+paymentsOf(gid).length;
  openSheet("Side", (b)=>{
    b.innerHTML='<p class="lead">Which side '+esc(groupName(gid))+' is on. Canada groups are in dollars, India groups in rupees.</p>'+
      '<div class="card cur-list" id="curList"></div>'+
      (n ? '<p class="fine cur-warn"><span class="ms" aria-hidden="true">warning</span><span>Amounts are not converted. '+
           (n===1 ? 'The entry already here keeps its number and only changes symbol.'
                  : 'The '+n+' entries already here keep their numbers and only change symbol.')+'</span></p>' : '');
    Object.keys(CURRENCIES).forEach(c=>{
      const r=el("button","row cur-row"+(c===now?" on":"")); r.type="button";
      r.setAttribute("aria-pressed", c===now?"true":"false");
      r.innerHTML='<span class="cat cur-flag"><span class="sf-flag">'+SIDES[c].flag+'</span></span>'+
        '<span class="body"><span class="t1">'+esc(SIDES[c].name)+'<span class="cur-code">'+esc(CURRENCIES[c].sym+" "+c)+'</span></span>'+
        '<span class="t2">Paid by '+esc(CURRENCIES[c].pay)+'</span></span>'+
        '<span class="right">'+(c===now ? '<span class="ms" aria-hidden="true" style="color:var(--good)">check_circle</span>' : '')+'</span>';
      r.addEventListener("click", ()=>{
        if(c===now){ closeSheet(); return; }
        if(n && !confirm("Move "+groupName(gid)+" to the "+SIDES[c].name+" side? Amounts keep their numbers: "+
                         money(1234.5, now)+" becomes "+money(1234.5, c)+".")) return;
        updStrict("trips/"+gid+"/meta", {currency:c}).then(()=>{
          if(DATA[gid] && DATA[gid].meta) DATA[gid].meta.currency=c;
          setSide(c); closeSheet(); toast(groupName(gid)+" moved to the "+SIDES[c].name+" side"); render();
        }, e=> toast(writeError(e)));
      });
      $("curList").appendChild(r);
    });
  });
}
/* Fewest payments (the default) nets the whole group down to a minimum
   number of transfers, which can route your payment to someone you never
   actually split anything with - confusing when nobody can see why. Turning
   it off shows every pair's own direct debt instead: more payments, but each
   one traces back to money that actually passed between those two people. */
function sheetSimplifyToggle(){
  const gid=CURRENT, on=simplifyOn(gid);
  const set=(val)=>{
    updStrict("trips/"+gid+"/meta", {simplify:val}).then(()=>{
      if(DATA[gid] && DATA[gid].meta) DATA[gid].meta.simplify=val;
      closeSheet(); toast(val ? "Simplifying to the fewest payments" : "Showing every direct debt");
      render();
    }, e=> toast(writeError(e)));
  };
  openSheet("Simplify debts", (b)=>{
    b.innerHTML='<p class="lead">How "Who owes whom" works out payments in '+esc(groupName(gid))+'.</p>'+
      '<div class="card cur-list" id="simpList"></div>';
    const opts=[
      {v:true,  t:"On · fewer payments", d:"Combines everyone's debts so the group clears up with as few payments as possible. Quicker to settle, but you might end up paying someone you never actually split anything with — tap “How this was worked out” to see why."},
      {v:false, t:"Off · pay who you actually owe", d:"Shows exactly what you owe each person, only for things you two actually split together. Easier to follow, even if it takes a few more payments to clear everyone."}
    ];
    opts.forEach(o=>{
      const r=el("button","row cur-row"+(o.v===on?" on":"")); r.type="button";
      r.setAttribute("aria-pressed", o.v===on?"true":"false");
      r.innerHTML='<span class="cat"><span class="ms" aria-hidden="true">'+(o.v?"call_split":"link")+'</span></span>'+
        '<span class="body"><span class="t1">'+esc(o.t)+'</span><span class="t2">'+esc(o.d)+'</span></span>'+
        '<span class="right">'+(o.v===on ? '<span class="ms" aria-hidden="true" style="color:var(--good)">check_circle</span>' : '')+'</span>';
      r.addEventListener("click", ()=>{ if(o.v===on){ closeSheet(); return; } set(o.v); });
      $("simpList").appendChild(r);
    });
  });
}
/* The visual the user actually asked for: show the raw, pair-by-pair debts
   as they really are, then the optimized plan they collapse into, so anyone
   can see why the plan asks them to pay a specific person a specific amount
   even when it isn't who they personally split something with. */
function sheetSimplifyDiagram(gid){
  const raw=pairSettlements(gid), plan=settlements(gid);
  const arrowRow=(t)=>{
    const fm=memberOf(t.from,gid), tm=memberOf(t.to,gid);
    const r=el("div","owe-row");
    r.innerHTML=
      '<span class="owe-pair">'+avatarHTML("sm", t.from, fm&&fm.color, fm&&fm.photo)+
        '<span class="ms" aria-hidden="true">arrow_forward</span>'+
        avatarHTML("sm", t.to, tm&&tm.color, tm&&tm.photo)+'</span>'+
      '<span class="owe-b"><span class="owe-t"><b>'+esc(t.from)+'</b> to <b>'+esc(t.to)+'</b></span></span>'+
      '<span class="owe-r"><span class="owe-amt zero">'+money(t.amt, curOf(gid))+'</span></span>';
    return r;
  };
  openSheet("How this was worked out", (b)=>{
    b.innerHTML=
      '<p class="lead">This is why the plan asks for the payments it does — even ones between people who never split anything together.</p>'+
      '<div class="sect" style="margin-top:0"><h2><span class="ms" aria-hidden="true">people</span>Step 1 · What everyone really owes</h2></div>'+
      '<p class="fine" style="margin:-8px var(--s4) 10px">Based only on what each pair actually split together.</p>'+
      '<div class="card owelist" id="simpRaw"></div>'+
      '<div class="simp-combine"><span class="ms" aria-hidden="true">south</span>gets squashed down into</div>'+
      '<div class="sect"><h2><span class="ms" aria-hidden="true">swap_horiz</span>Step 2 · The payments you’ll actually see</h2></div>'+
      '<div class="card owelist" id="simpPlan"></div>'+
      '<p class="fine" id="simpNote"></p>';
    const rawHost=$("simpRaw"), planHost=$("simpPlan");
    if(!raw.length) rawHost.innerHTML='<div class="mom"><span class="b"><span class="m">Nobody owes anybody anything here.</span></span></div>';
    else raw.forEach(t=> rawHost.appendChild(arrowRow(t)) );
    if(!plan.length) planHost.innerHTML='<div class="mom"><span class="b"><span class="m">All square.</span></span></div>';
    else plan.forEach(t=> planHost.appendChild(arrowRow(t)) );
    $("simpNote").textContent = raw.length && plan.length
      ? raw.length+" real "+(raw.length===1?"debt":"debts")+" got squashed into just "+plan.length+" "+(plan.length===1?"payment":"payments")+". Everyone ends up with exactly what they owed or were owed — the app just found a shorter way to get there, even if it means paying someone new."
      : "";
  });
}
function sheetGroupRename(){
  const gid=CURRENT;
  openSheet("Rename group", (b)=>{
    b.innerHTML=fieldHTML("grName","Group name","text", groupName(gid))+
      '<button class="btn p wide" id="grGo">Save</button>';
    $("grGo").addEventListener("click", ()=>{
      const v=$("grName").value.trim(); if(!v) return toast("Enter a name");
      set("trips/"+gid+"/meta/name", v).then(()=>{ rememberGroup(gid,v); closeSheet(); toast("Renamed"); });
    });
  });
}
