/* ---------- quick add ----------
   The raised + in the bar. One sheet, top to bottom: how much, what for,
   which group, who paid, who it was for. Every group is already listed and
   the one you were last in is picked; if the right group is not there it can
   be made on the spot, and so can a person - so adding an expense never means
   leaving to set something up first and finding your way back. */
let QA_LAST = null;          // the group used last time, picked first next time

/* A group's people, each name once. Somebody added from this sheet is shown
   straight away, before the database's own copy of them arrives - and for that
   moment both copies are in the list. Counted twice, they would be split twice
   and charged twice. */
function qaPeople(gid){ return [...new Set(names(gid))]; }

function sheetQuickAdd(){
  if(!USER || !remote) return;
  let gid = CURRENT || QA_LAST || null;
  if(gid && !joinedHere().some(g=>g.id===gid)) gid = null;
  if(!gid && joinedHere().length===1) gid = joinedHere()[0].id;
  let payer = null;
  let picked = {};
  let pickedFor = null;      // which group `picked` was filled for
  let personOpen = false;    // the add-a-person panel stays open while adding several

  openSheet("Quick add", (b)=>{
    b.innerHTML =
      '<div class="field"><label for="qaAmt">Amount</label>'+
        '<div class="qa-money"><span aria-hidden="true" id="qaCur">'+esc(curSym(gid || curUsual()))+'</span>'+
        '<input id="qaAmt" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00"></div></div>'+
      '<div class="field"><label for="qaDesc">What was it for?</label>'+
        '<input id="qaDesc" type="text" autocomplete="off" placeholder="Dinner, petrol, tickets…"></div>'+
      '<div class="field"><label>Group</label><div class="chips" id="qaGroups"></div>'+
        '<div class="qa-new" id="qaNewGroup" hidden>'+
          '<input id="qaGroupName" type="text" autocomplete="off" placeholder="New group name">'+
          '<button class="btn p" id="qaGroupGo" type="button">Create</button></div></div>'+
      '<div id="qaWho"></div>'+
      '<button class="btn p wide" id="qaSave" type="button">Add expense</button>';

    function drawGroups(){
      // The symbol by the amount follows the group: ₹ for a rupee group.
      if($("qaCur")) $("qaCur").textContent = curSym(gid || curUsual());
      const host=$("qaGroups"); host.innerHTML="";
      joinedHere().slice().sort((a,c)=>groupName(a.id).localeCompare(groupName(c.id))).forEach(g=>{
        const ch=el("button","chip"); ch.type="button";
        ch.textContent=groupName(g.id);
        ch.setAttribute("aria-pressed", g.id===gid ? "true" : "false");
        ch.addEventListener("click", ()=>{ gid=g.id; drawGroups(); drawWho(); });
        host.appendChild(ch);
      });
      const nw=el("button","chip add"); nw.type="button";
      nw.innerHTML='<span class="ms" aria-hidden="true" style="font-size:17px">add</span>New group';
      nw.addEventListener("click", ()=>{
        $("qaNewGroup").hidden = !$("qaNewGroup").hidden;
        if(!$("qaNewGroup").hidden) $("qaGroupName").focus();
      });
      host.appendChild(nw);
    }

    function drawWho(){
      const host=$("qaWho"); host.innerHTML="";
      if(!gid){
        host.innerHTML='<p class="fine">Pick a group above, or make a new one.</p>';
        return;
      }
      const ppl = qaPeople(gid);
      const me = meIn(gid);
      // Only whoever paid adds it; the administrator may add for anyone.
      const payers = payersAllowed(gid, ppl);
      const firstPayer = payers.indexOf(me)>-1 ? me : (payers[0] || null);
      // A different group has different people, so the choices start over.
      if(pickedFor!==gid){
        picked={}; ppl.forEach(n=>picked[n]=true);
        payer = firstPayer; pickedFor = gid; personOpen = false;
      }
      if(payers.indexOf(payer)<0) payer = firstPayer;

      host.innerHTML =
        '<div class="field"><label>Paid by</label><div class="chips" id="qaPayer"></div>'+
          (payers.length===1 && !isAdmin()
            ? '<div class="help">You can only add what you paid. If someone else paid, they add it.</div>' : '')+
          (!payers.length
            ? '<div class="help">Say which name in this group is yours first. '+
              '<button class="linkbtn" id="qaClaim" type="button">Choose my name</button></div>' : '')+
        '</div>'+
        '<div class="field"><label>Split equally between</label><div class="chips" id="qaSplit"></div>'+
          '<div class="qa-person" id="qaNewPerson" hidden>'+
            '<div id="qaPickWrap"><p class="qa-sub">Already in Settle — tap to add</p>'+
              '<div class="chips" id="qaPick"></div></div>'+
            '<p class="qa-sub">Someone new</p>'+
            '<div class="qa-new"><input id="qaPersonName" type="text" autocomplete="off" placeholder="Their name">'+
              '<button class="btn p" id="qaPersonGo" type="button">Add</button></div></div>'+
          '<p class="qa-each" id="qaEach"></p></div>';

      payers.forEach(n=>{
        const c=el("button","chip"); c.type="button"; c.textContent = n===me ? n+" (you)" : n;
        c.setAttribute("aria-pressed", n===payer ? "true" : "false");
        c.addEventListener("click", ()=>{ payer=n; drawWho(); });
        $("qaPayer").appendChild(c);
      });
      if($("qaClaim")) $("qaClaim").addEventListener("click", ()=> sheetClaim(gid) );

      ppl.forEach(n=>{
        const c=el("button","chip"); c.type="button"; c.textContent = n===me ? n+" (you)" : n;
        c.setAttribute("aria-pressed", picked[n] ? "true" : "false");
        c.addEventListener("click", ()=>{ picked[n]=!picked[n]; drawWho(); });
        $("qaSplit").appendChild(c);
      });
      const ap=el("button","chip add"); ap.type="button";
      ap.innerHTML='<span class="ms" aria-hidden="true" style="font-size:17px">person_add</span>Person';
      $("qaSplit").appendChild(ap);

      // Everybody already approved into Settle and not yet in this group. The
      // usual case is somebody the app already knows, so it is a tap - not a
      // name typed in that has to match what the group calls them.
      const inGroup = membersOf(gid).map(m=>m.uid).filter(Boolean);
      const pool = Object.keys(DIRECTORY||{})
        .map(u=>Object.assign({uid:u}, DIRECTORY[u]||{}))
        .filter(p=>p.name && p.uid!==USER.uid && inGroup.indexOf(p.uid)<0 && onThisSide(p.uid))
        .sort((a,c)=>String(a.name).localeCompare(String(c.name)));
      $("qaPickWrap").hidden = !pool.length;
      pool.forEach(p=>{
        const c=el("button","chip"); c.type="button"; c.textContent=p.name;
        c.addEventListener("click", ()=>{
          c.disabled=true;
          // The same add the People sheet uses: links their account, puts them
          // on the membership list, and takes a seat the group already has for
          // them rather than making a second one.
          addFromDirectory(gid, p).then(ok=>{
            // Only tick a name that is really theirs: when the add was refused
            // because the name is taken, that name belongs to somebody else.
            const m = membersOf(gid).find(x=>x.uid===p.uid);
            if(m) picked[m.name] = true;
            if(!ok && !m) c.disabled=false;
            drawWho();
          });
        });
        $("qaPick").appendChild(c);
      });

      ap.addEventListener("click", ()=>{
        personOpen = !personOpen;
        $("qaNewPerson").hidden = !personOpen;
        // Only jump to typing when there is nobody to tap - on a phone the
        // keyboard would otherwise cover the list.
        if(personOpen && !pool.length) $("qaPersonName").focus();
      });
      $("qaNewPerson").hidden = !personOpen;

      $("qaPersonGo").addEventListener("click", addPerson);
      $("qaPersonName").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); addPerson(); } });
      each();
    }

    // What each person's share comes to, updated as the amount is typed.
    function each(){
      const out=$("qaEach"); if(!out) return;
      const amt=Number($("qaAmt").value)||0;
      const n=Object.keys(picked).filter(k=>picked[k]).length;
      out.textContent = n && amt>0 ? money(Math.round(amt/n*100)/100, gid)+" each, split between "+n
                      : n ? "Split between "+n : "Pick at least one person";
    }

    let qaAsked=null;
    function addPerson(){
      const nm=tidyName($("qaPersonName").value);
      if(!nm) return toast("Enter a name");
      const hit=inGroupAlready(gid, {name:nm});
      if(hit) return toast(hit.text);
      // Somebody already in Settle goes in as their account, not as a name.
      const known=settleAccountFor(nm);
      if(known && known.uid!==USER.uid){
        $("qaPersonName").value="";
        return addFromDirectory(gid, Object.assign({}, known, {name:nm})).then(ok=>{
          const m=membersOf(gid).find(x=>x.uid===known.uid);
          if(m) picked[m.name]=true;
          if(ok) toast(nm+" is in Settle, so their account was added");
          drawWho();
        });
      }
      // A near match is asked about once; pressing Add again adds the name.
      const near=settleSuggestions(nm, gid);
      if(near.length && qaAsked!==normName(nm)){
        qaAsked=normName(nm);
        return toast("Did you mean "+near.map(p=>p.name).join(" or ")+"? Tap them above, or press Add again for a new name");
      }
      const rec={n:nm, c:freeColour(gid)};
      // Shown straight away; the database's own copy replaces this when it lands.
      DATA[gid]=DATA[gid]||{}; DATA[gid].people=DATA[gid].people||{};
      DATA[gid].people["qa"+uid()]=rec;
      picked[nm]=true;
      push("trips/"+gid+"/people", rec);
      toast(nm+" added to "+groupName(gid));
      drawWho();
    }

    function createGroup(){
      const nm=$("qaGroupName").value.trim();
      if(!nm) return toast("Give the group a name");
      const id=slug(nm)+"-"+Math.random().toString(36).slice(2,6);
      const people={};
      people["m0"+uid().slice(-4)]={n:USER.name, c:PALETTE[0], uid:USER.uid, email:USER.email, photo:USER.photo||null};
      const meta={name:nm, type:"other", currency:curUsual(), at:Date.now(), by:USER.name, byUid:USER.uid};
      // The creator goes on the membership list the rules read, or they could
      // not open the group they have just made.
      set("trips/"+id, {meta:meta, people:people, uids:{[USER.uid]:true}}).then(()=>{
        DATA[id]={meta:meta, people:people, uids:{[USER.uid]:true}};
        rememberGroup(id, nm); watchGroup(id); claimAsked[id]=true;
        gid=id;
        $("qaNewGroup").hidden=true; $("qaGroupName").value="";
        drawGroups(); drawWho();
        toast(nm+" created");
      });
    }

    function save(){
      const amt=Math.round((Number($("qaAmt").value)||0)*100)/100;
      const desc=$("qaDesc").value.trim();
      if(!(amt>0)) return toast("Enter an amount");
      if(!desc) return toast("Say what it was for");
      if(!gid) return toast("Pick a group");
      const ppl=qaPeople(gid);
      const between=ppl.filter(n=>picked[n]);
      if(!between.length) return toast("Pick who it is split between");
      if(!payer || payersAllowed(gid, ppl).indexOf(payer)<0) return toast("You can only add what you paid");
      const rec={ desc:desc, amount:amt, payer:payer, mode:"equal", between:between, vals:{},
                  cat:"general", note:"", at:Date.now(),
                  by:(meIn(gid)||USER.name), byUid:USER.uid };
      const where=gid;
      $("qaSave").disabled=true;
      const key="e"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
      set("trips/"+where+"/expenses/"+key, rec).then(()=>{
        notify("expense.add", where, Object.assign({ref:key}, rec));
        QA_LAST=where;
        closeSheet();
        toast("Added to "+groupName(where));
      }).catch(()=>{ $("qaSave").disabled=false; });
    }

    drawGroups(); drawWho();
    $("qaAmt").addEventListener("input", each);
    $("qaGroupGo").addEventListener("click", createGroup);
    $("qaGroupName").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); createGroup(); } });
    $("qaSave").addEventListener("click", save);
    setTimeout(()=>{ const a=$("qaAmt"); if(a) a.focus(); }, 90);
  }, render);
}
