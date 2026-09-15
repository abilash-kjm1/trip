/* ===========================================================================
   Announcements: a message from the administrator that blocks the screen
   until it is acknowledged. Sent to everyone or to one person.

   Realtime Database only honours a .read rule at the exact path being
   listened to - a rule nested one level down does not reach up to cover a
   listener on the parent. So this lives in three real places, each with its
   own direct read grant, rather than one list filtered after the fact:
     announcements/all/{id}          - broadcasts; anyone approved can list it
     announcements/inbox/{uid}/{id}  - a message to one person, keyed by them
     announcements/sent/{id}         - the admin's own log of everything
                                        sent, so the history list never has
                                        to reach into anyone's private inbox
   Each account answers only for itself, writing its own acknowledgement
   under whichever of the first two paths the message actually lives at.

   Shown one at a time, oldest first, the same way the did-it-arrive slip
   works: whichever is due comes up, and nothing else on screen can be
   reached until it is dealt with. There is no way to dismiss one without
   acknowledging it - no scrim tap, no swipe, no back button.
   =========================================================================== */
let ANNOUNCE_ALL   = {};           // announcements/all/* - broadcasts
let ANNOUNCE_INBOX = {};           // announcements/inbox/{my uid}/* - addressed only to me
let ANNOUNCE_SENT  = {};           // announcements/sent/* - admin's own log, for the history list
let ANNOUNCE_NODE  = null;         // the slip on screen now, so a redraw does not restart it

/* Mine to answer: not written by me, and I have not already acknowledged
   it. Oldest first, so an earlier notice is never skipped for a newer one. */
function announceQueue(){
  if(!USER) return [];
  const all   = Object.keys(ANNOUNCE_ALL||{}).map(k=>Object.assign({k, kind:"all"}, ANNOUNCE_ALL[k]));
  const inbox = Object.keys(ANNOUNCE_INBOX||{}).map(k=>Object.assign({k, kind:"inbox"}, ANNOUNCE_INBOX[k]));
  return all.concat(inbox)
    .filter(a=> a && a.text && a.byUid!==USER.uid && !(a.ack && a.ack[USER.uid]))
    .sort((a,b)=> (Number(a.at)||0) - (Number(b.at)||0));
}
function announcePath(a){ return a.kind==="all" ? "announcements/all/"+a.k : "announcements/inbox/"+USER.uid+"/"+a.k; }

function announceCheck(){
  if(!USER || !mayUse()){ announceClose(true); return; }
  const due=announceQueue();
  if(!due.length){ announceClose(); return; }
  const next=due[0];
  if(ANNOUNCE_NODE && ANNOUNCE_NODE.dataset.k===next.kind+"/"+next.k) return;   // already showing this one
  announceClose(true);
  announceShow(next);
}

function announceClose(now){
  if(!ANNOUNCE_NODE) return;
  const node=ANNOUNCE_NODE; ANNOUNCE_NODE=null;
  if(now){ node.remove(); return; }
  node.classList.add("out");
  setTimeout(()=> node.remove(), 320);
}

/* Switching to a different account on the same device: whatever is on
   screen belongs to whoever was signed in a moment ago. */
function announceForget(){ announceClose(true); ANNOUNCE_ALL={}; ANNOUNCE_INBOX={}; ANNOUNCE_SENT={}; }

// A handful of small stars scattered around the icon, each with its own
// position, size and twinkle timing - fixed per render so they do not
// jump between redraws, only ever decorative.
function announceSparkles(){
  const pts=[[14,18,1],[86,12,0],[92,54,2],[8,58,1],[50,4,2],[76,86,0],[22,88,1]];
  return pts.map((p,i)=>
    '<i class="an-spark" style="left:'+p[0]+'%; top:'+p[1]+'%; animation-delay:'+(p[2]*.6)+'s"></i>').join("");
}

function announceShow(a){
  const node=el("div","announce");
  node.dataset.k=a.kind+"/"+a.k;
  node.innerHTML=
    '<div class="announce-scrim" aria-hidden="true"></div>'+
    '<div class="announce-hold">'+
      '<span class="announce-orb o1" aria-hidden="true"></span>'+
      '<span class="announce-orb o2" aria-hidden="true"></span>'+
      '<div class="announce-card" role="alertdialog" aria-modal="true" aria-labelledby="anTitle" aria-describedby="anBody">'+
        '<div class="announce-icwrap" aria-hidden="true">'+
          announceSparkles()+
          '<span class="announce-ring"></span>'+
          '<span class="announce-ic"><span class="ms">campaign</span></span>'+
        '</div>'+
        '<h2 id="anTitle" class="an-rise" style="--i:0">Message from '+esc(a.by||"the administrator")+'</h2>'+
        '<p id="anBody" class="announce-text an-rise" style="--i:1">'+esc(a.text).replace(/\n/g,"<br>")+'</p>'+
        '<p class="announce-when an-rise" style="--i:2">'+esc(fmtWhen(a.at))+'</p>'+
        '<button class="announce-ack an-rise" type="button" style="--i:3">'+
          '<span class="announce-ack-shine" aria-hidden="true"></span>'+
          '<span class="ms" aria-hidden="true">check</span><span class="announce-ack-t">I understand</span>'+
        '</button>'+
      '</div>'+
    '</div>';
  document.body.appendChild(node);
  ANNOUNCE_NODE=node;
  const btn=node.querySelector(".announce-ack");
  setTimeout(()=>{ if(ANNOUNCE_NODE===node) btn.focus({preventScroll:true}); }, 500);
  btn.addEventListener("click", ()=>{
    if(btn.disabled) return;
    btn.disabled=true;
    // A satisfying "sealed" moment right away, rather than waiting on the
    // network before anything on screen agrees the tap landed.
    node.querySelector(".announce-card").classList.add("sealed");
    btn.querySelector(".announce-ack-t").textContent="Acknowledged";
    try{ if(navigator.vibrate) navigator.vibrate(12); }catch(e){}
    updStrict(announcePath(a)+"/ack", {[USER.uid]:{at:Date.now(), name:ME||USER.name}}).then(()=>{
      setTimeout(()=>{ announceClose(); setTimeout(announceCheck, 380); }, 520);
    }).catch(e=>{
      btn.disabled=false;
      node.querySelector(".announce-card").classList.remove("sealed");
      btn.querySelector(".announce-ack-t").textContent="I understand";
      toast(writeError(e));
    });
  });
}

/* ---------- admin: write one, and see who has read the last few ---------- */
function sheetAnnounce(){
  if(!isAdmin()) return;
  const people = Object.keys(DIRECTORY||{}).map(u=>Object.assign({uid:u}, DIRECTORY[u]||{}))
    .filter(p=>p.name && p.uid!==USER.uid)
    .sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  let target="all";
  openSheet("Send an announcement", (b)=>{
    b.innerHTML=
      '<p class="lead">Blocks their screen the moment they open Settle, until they tap through it.</p>'+
      '<div class="field"><label>Who should see this?</label><div class="chips" id="anWho"></div></div>'+
      '<div class="field"><label for="anText">Message</label>'+
      '<textarea id="anText" rows="4" maxlength="500" placeholder="What do you need them to know?"></textarea>'+
      '<div class="help" id="anCount">0 / 500</div></div>'+
      '<button class="btn p wide" id="anSend" type="button">Send</button>'+
      '<div id="anHist"></div>';

    const who=$("anWho");
    const setTarget=(val, c)=>{
      target=val;
      [].forEach.call(who.children, x=>x.setAttribute("aria-pressed","false"));
      c.setAttribute("aria-pressed","true");
    };
    const chip=(label, val)=>{
      const c=el("button","chip"); c.type="button"; c.textContent=label;
      c.setAttribute("aria-pressed", val===target ? "true":"false");
      c.addEventListener("click", ()=> setTarget(val, c));
      who.appendChild(c);
    };
    chip("Everyone", "all");
    people.forEach(p=> chip(p.name, p.uid));

    const ta=$("anText");
    ta.addEventListener("input", ()=> $("anCount").textContent=ta.value.length+" / 500");
    $("anSend").addEventListener("click", ()=>{
      const text=ta.value.trim();
      if(!text) return toast("Write a message first");
      $("anSend").disabled=true;
      const key="a"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
      const rec={text, at:Date.now(), byUid:USER.uid, by:USER.name};
      const path = target==="all" ? "announcements/all/"+key : "announcements/inbox/"+target+"/"+key;
      // Written to where the recipient can actually read it, and logged
      // once more under the admin's own path so the history list below
      // never has to reach into anyone's private inbox to show itself.
      Promise.all([
        updStrict(path, rec),
        updStrict("announcements/sent/"+key, Object.assign({to:target}, rec))
      ]).then(()=>{
        closeSheet();
        toast(target==="all" ? "Sent to everyone" : "Sent to "+(DIRECTORY[target]&&DIRECTORY[target].name || "them"));
      }).catch(e=>{
        $("anSend").disabled=false;
        toast(writeError(e));
      });
    });

    // Sent before, newest first - and, for a broadcast, who has actually
    // seen it. A message to one person shows as sent rather than guessing
    // at whether they have opened Settle since - that would mean reaching
    // into their inbox, which is theirs to read, not the history list's.
    const approved = Object.keys(REQUESTS||{}).filter(u=>REQUESTS[u]&&REQUESTS[u].status==="approved" && u!==USER.uid).length;
    const past = Object.keys(ANNOUNCE_SENT||{}).map(k=>Object.assign({k}, ANNOUNCE_SENT[k]))
      .filter(a=>a && a.text).sort((x,y)=> (Number(y.at)||0)-(Number(x.at)||0)).slice(0,12);
    if(past.length){
      const host=$("anHist");
      host.innerHTML='<div class="sechead" style="margin-top:22px">Sent before</div><div class="card" id="anHistList"></div>';
      const list=$("anHistList");
      past.forEach(a=>{
        const broadcast = a.to==="all";
        const ackN = broadcast ? Object.keys((ANNOUNCE_ALL[a.k]&&ANNOUNCE_ALL[a.k].ack)||{}).length : 0;
        const done = broadcast && approved>0 && ackN>=approved;
        const pill = !broadcast ? "Sent"
          : approved>0 ? ackN+" / "+approved
          : ackN+(ackN===1?" seen it":" have seen it");
        const r=el("div","row"); r.style.cursor="default";
        r.innerHTML=
          '<span class="cat'+(done?" teal":"")+'"><span class="ms" aria-hidden="true">'+(done?"mark_email_read":"mail")+'</span></span>'+
          '<span class="body"><span class="t1">'+esc(a.text.length>64 ? a.text.slice(0,64)+"…" : a.text)+'</span>'+
          '<span class="t2">'+(broadcast ? "Everyone" : esc((DIRECTORY[a.to]&&DIRECTORY[a.to].name)||"Someone"))+
            ' · '+esc(fmtWhen(a.at))+'</span></span>'+
          '<span class="right"><span class="tp-pill'+(done?" on":"")+'">'+esc(pill)+'</span></span>';
        list.appendChild(r);
      });
    }
  });
}
