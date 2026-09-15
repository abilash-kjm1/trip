/* ===========================================================================
   Live activity feed: a small stack of cards in the top corner that appears
   the moment something changes - an expense or payment added, edited or
   deleted, or being added to a group - on either side. Each stays up until
   tapped away with its own close button; tapping the card itself opens the
   group it is about.

   Not a log of everything that has ever happened: only real changes while
   the app is open, found by comparing each group's data against a shadow
   copy taken as it loads. The first look at anything - the app just opening,
   a group just being joined - only sets that baseline, so signing in never
   floods the corner with history, and nothing here duplicates the
   did-it-arrive slip or the flag badge, which already cover that ground.
   =========================================================================== */
let NOTIF_LIST = [];              // {id, icon, text, gid} on screen now, newest first
let NOTIF_SHADOW = {};            // gid -> {expenses:{k:{sig,label}}, payments:{k:{sig,label}}}
let NOTIF_KNOWN_GROUPS = null;    // group ids already accounted for, once the baseline is set
let NOTIF_SELF_UNTIL = 0;         // Date.now() until which my own writes are not news
const NOTIF_CAP = 5;

/* Every local write goes through push/set/del/upd/updStrict in app-js.js,
   each of which calls this first - so whatever THIS device just did is
   folded into the next baseline rather than read back to it as news.
   Deliberately per-device, not per-account: it lives only in this tab's
   memory and is never synced, so an account's other phones and computers
   still hear about a change made here - which is the point of a device
   knowing when something you did elsewhere has landed. */
function notifSelfGrace(){ NOTIF_SELF_UNTIL = Date.now() + 2500; }

/* One colour per kind of change, so the stack can be read at a glance
   without reading every word: blue for something added, amber for
   something changed, red for something removed, green for money paid,
   violet for a group. */
function notifPush(kind, icon, text, gid){
  NOTIF_LIST.unshift({id:"n"+Date.now().toString(36)+Math.random().toString(36).slice(2,6), kind, icon, text, gid});
  if(NOTIF_LIST.length > NOTIF_CAP) NOTIF_LIST.length = NOTIF_CAP;
  notifRender();
}
function notifDismiss(id){
  NOTIF_LIST = NOTIF_LIST.filter(n=>n.id!==id);
  notifRender();
}
/* An admin switching to a different account on the same device, without
   signing all the way out first, gets a fresh baseline here too - called
   from forgetPreviousAccount() in app-js.js, alongside its own reset. */
function notifForget(){
  NOTIF_LIST = []; NOTIF_SHADOW = {}; NOTIF_KNOWN_GROUPS = null; NOTIF_SELF_UNTIL = 0;
  notifRender();
}
function notifRender(){
  const host=$("notifStack"); if(!host) return;
  host.innerHTML = NOTIF_LIST.map(n=>
    '<div class="notif-card k-'+n.kind+'" data-id="'+n.id+'" role="status">'+
      '<span class="notif-ic"><span class="ms" aria-hidden="true">'+n.icon+'</span></span>'+
      '<span class="notif-t">'+esc(n.text)+'</span>'+
      '<button class="notif-x" type="button" aria-label="Dismiss">'+
        '<span class="ms" aria-hidden="true">close</span></button>'+
    '</div>').join("");
  [].forEach.call(host.querySelectorAll(".notif-card"), card=>{
    const id=card.dataset.id;
    card.querySelector(".notif-x").addEventListener("click", e=>{ e.stopPropagation(); notifDismiss(id); });
    card.addEventListener("click", ()=>{
      const n=NOTIF_LIST.find(x=>x.id===id);
      notifDismiss(id);
      if(n && n.gid) openGroup(n.gid);   // follows the group's own side, same as a notification tap
    });
  });
}

function notifCheck(){
  if(!USER || !mayUse()) return;
  const grace = Date.now() < NOTIF_SELF_UNTIL;

  if(NOTIF_KNOWN_GROUPS===null){
    NOTIF_KNOWN_GROUPS = new Set(JOINED.map(g=>g.id));
  } else if(!grace){
    JOINED.forEach(g=>{
      if(!NOTIF_KNOWN_GROUPS.has(g.id)) notifPush("group", "group_add", "Added to "+groupName(g.id), g.id);
    });
  }
  JOINED.forEach(g=> NOTIF_KNOWN_GROUPS.add(g.id));

  JOINED.forEach(g=>{
    const gid=g.id;
    if(!loaded(gid)) return;
    const first=!NOTIF_SHADOW[gid];
    const shadow = NOTIF_SHADOW[gid] = NOTIF_SHADOW[gid] || {expenses:{}, payments:{}};

    const tail=" · "+groupName(gid);
    [["expenses", expensesOf(gid), "add_circle",
      (e)=> (e.by||"Someone")+" added "+(e.desc||"an expense")+" · "+money(e.amount, gid)+tail,
      (e)=> (e.by||"Someone")+" edited "+(e.desc||"an expense")+" · "+money(e.amount, gid)+tail],
     ["payments", paymentsOf(gid), "payments",
      (p)=> (p.by||p.from||"Someone")+" paid "+(p.to||"?")+" · "+money(p.amount, gid)+tail,
      (p)=> "Payment edited · "+money(p.amount, gid)+tail]
    ].forEach(([kind, list, addIcon, addText, editText])=>{
      const now={};
      const addKind = kind==="payments" ? "pay" : "add";
      list.forEach(item=>{
        const sig=JSON.stringify([item.desc, item.amount, item.payer, item.between, item.vals, item.from, item.to, item.note]);
        const label=item.desc || ((item.from||"?")+" → "+(item.to||"?"));
        now[item.k]={sig, label, amount:item.amount};
        if(first || grace) return;
        const was=shadow[kind][item.k];
        if(!was){ notifPush(addKind, addIcon, addText(item), gid); }
        else if(was.sig!==sig){ notifPush("edit", "edit", editText(item), gid); }
      });
      if(!first && !grace){
        Object.keys(shadow[kind]).forEach(k=>{
          if(!(k in now)){
            const was=shadow[kind][k];
            notifPush("del", "delete", "“"+was.label+"” removed · "+money(was.amount, gid)+tail, gid);
          }
        });
      }
      shadow[kind]=now;
    });
  });
}
