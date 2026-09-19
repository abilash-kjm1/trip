/* ---------- Today ----------
   Answers "do I owe anybody anything" before it shows anything else: the one
   payment worth making, two figures, then what has been happening. Every row
   is real data; nothing on this screen is a placeholder. */

/* Every settling-up payment I am part of, across every group. Smallest first,
   because clearing a whole person for the least money is the one worth doing
   today. */
function toDoNext(){
  const out = [];
  joinedHere().forEach(g=>{
    const me = meIn(g.id);
    if(!me) return;
    transferPlan(g.id).forEach(t=>{
      if(t.from===me)    out.push({dir:"pay", who:t.to,   amt:t.amt, gid:g.id});
      else if(t.to===me) out.push({dir:"get", who:t.from, amt:t.amt, gid:g.id});
    });
  });
  return out.sort((a,b)=> a.amt-b.amt );
}

/* The most recent expenses anywhere, with what each one means for me. */
function latestMoments(n){
  const out = [];
  joinedHere().forEach(g=>{
    const me = meIn(g.id);
    expensesOf(g.id).forEach(e=>{
      const share = sharesOf(e)[me] || 0;
      out.push({ gid:g.id, desc:e.desc, amount:Number(e.amount)||0, cat:e.cat,
                 at:Number(e.at)||0,
                 mine: (me && e.payer===me) ? (Number(e.amount)||0) - share : -share });
    });
  });
  return out.sort((a,b)=> b.at-a.at ).slice(0, n);
}

/* Everyone I share anything with, and where we stand across every group. */
function friendsAcross(){
  const by = {};
  joinedHere().forEach(g=>{
    const me = meIn(g.id);
    if(!me) return;
    const seat = (n)=> membersOf(g.id).find(x=>x.name===n);
    everyoneIn(g.id).forEach(n=>{
      if(n===me) return;
      const m = seat(n);
      // `net` is per currency: owing someone rupees in one group does not
      // cancel dollars they owe me in another.
      by[n] = by[n] || {name:n, bills:0, net:{}, colour:(m&&m.colour)||"#A0A398", photo:(m&&m.photo)||null};
    });
    expensesOf(g.id).forEach(e=>{
      const sh = sharesOf(e);
      Object.keys(sh).forEach(n=>{ if(n!==me && by[n]) by[n].bills++; });
    });
    transferPlan(g.id).forEach(t=>{
      if(t.from===me && by[t.to])      curAdd(by[t.to].net, g.id, -t.amt);
      else if(t.to===me && by[t.from]) curAdd(by[t.from].net, g.id, t.amt);
    });
  });
  const size = (p)=> curKeys(p.net).reduce((s,c)=> Math.max(s, Math.abs(p.net[c])), 0);
  return Object.keys(by).map(k=>by[k])
    .sort((a,b)=> size(b)-size(a) || a.name.localeCompare(b.name));
}

/* What am I paying them for? The newest thing we both share, so the panel can
   name it instead of saying "a balance". */
function whatFor(gid, who){
  const me = meIn(gid);
  const both = expensesOf(gid).filter(e=>{
    const sh = sharesOf(e);
    return sh[me] && (sh[who] || e.payer===who);
  }).sort((a,b)=> (b.at||0)-(a.at||0) );
  return both.length ? both[0].desc : null;
}

/* Ask somebody to settle up. The email goes out on the scheduler's next pass,
   like everything else the app sends, and the button says so rather than
   claiming the message has already arrived. */
function sendNudge(gid, who, amount, btn){
  const seat = membersOf(gid).find(x=>x.name===who);
  if(!seat || !seat.uid){
    toast(who+" has not signed in yet, so there is nowhere to send it");
    return false;
  }
  if(btn){ btn.disabled=true; btn.textContent="Reminder sent"; }
  notify("nudge", gid, {desc: who, amount: amount});
  toast("Reminder on its way to "+who+" · "+callGap());
  return true;
}

/* The Today panel turns through everything there is to settle, across every
   group, for whoever is signed in. The database redraws the screen whenever
   anything changes, so which card is showing, and who has already been
   reminded, live out here - or every redraw would jump back to the first card
   and forget the reminder. */
let HERO_I = 0;
let TH_SEEN = false;     // the sections below the card have risen in once this session
let HERO_SWEPT = null;   // the card the light last passed over, so a redraw does not replay it
const NUDGED = {};             // "gid|name" -> reminded this session

// What I owe first, biggest first; then what I am owed, biggest first.
function heroSlides(){
  const plan = toDoNext();
  const big = (a,b)=> b.amt-a.amt;
  return plan.filter(t=>t.dir==="pay").sort(big)
    .concat(plan.filter(t=>t.dir==="get").sort(big));
}

/* ---- Purple theme: the Today card as a little sky ----
   Day from 6am to 7pm by the phone's own clock, night otherwise. Bora - an
   original bunny-bear - peeks over the top edge: awake under the sun, dozing
   in a nightcap under the moon. Everything here is decoration around the card,
   never on top of what it says, and the other theme never shows it. */
function heroSky(){ const h=new Date().getHours(); return (h>=6 && h<19) ? "day" : "night"; }
const HD_BORA_BASE =
  '<g stroke="#fff" stroke-width="5" stroke-linejoin="round" paint-order="stroke">'+
    '<ellipse cx="36" cy="22" rx="11" ry="19" fill="#E9DDFC" transform="rotate(-12 36 22)"/>'+
    '<ellipse cx="84" cy="22" rx="11" ry="19" fill="#E9DDFC" transform="rotate(12 84 22)"/>'+
    '<ellipse cx="60" cy="56" rx="43" ry="34" fill="#E9DDFC"/></g>'+
  '<ellipse cx="36" cy="23" rx="5" ry="12" fill="#F9C3DC" transform="rotate(-12 36 23)"/>'+
  '<ellipse cx="84" cy="23" rx="5" ry="12" fill="#F9C3DC" transform="rotate(12 84 23)"/>'+
  '<ellipse cx="30" cy="66" rx="10" ry="6" fill="#F9C3DC"/><ellipse cx="90" cy="66" rx="10" ry="6" fill="#F9C3DC"/>'+
  '<ellipse cx="60" cy="61" rx="2.6" ry="1.9" fill="#2A1F3D"/>';
const HD_BORA_AWAKE =
  '<ellipse class="hd-blink" cx="45" cy="52" rx="8.5" ry="10" fill="#2A1F3D"/>'+
  '<ellipse class="hd-blink" cx="75" cy="52" rx="8.5" ry="10" fill="#2A1F3D"/>'+
  '<circle cx="48.5" cy="47.5" r="3.4" fill="#fff"/><circle cx="78.5" cy="47.5" r="3.4" fill="#fff"/>'+
  '<circle cx="42" cy="56" r="1.6" fill="#fff"/><circle cx="72" cy="56" r="1.6" fill="#fff"/>'+
  '<path d="M54 66q6 8 12 0z" fill="#E8739F" stroke="#2A1F3D" stroke-width="1.8" stroke-linejoin="round"/>'+
  '<path d="M80 14c-10-8-18-4-14 4 3 6 11 3 14-4zM80 14c10-8 18-4 14 4-3 6-11 3-14-4z" fill="#8F63D8" stroke="#fff" stroke-width="2.5" paint-order="stroke"/>'+
  '<circle cx="80" cy="15" r="3.6" fill="#6D3FBF"/>';
const HD_BORA_ASLEEP =
  '<path d="M37 54q8 6 16 0M67 54q8 6 16 0" fill="none" stroke="#2A1F3D" stroke-width="3" stroke-linecap="round"/>'+
  '<path d="M57 67q3 2 6 0" fill="none" stroke="#2A1F3D" stroke-width="2" stroke-linecap="round"/>'+
  '<path d="M30 20C40 -6 84 -8 92 18c-20-8-42-8-62 2z" fill="#8F63D8" stroke="#fff" stroke-width="3" paint-order="stroke"/>'+
  '<circle cx="100" cy="6" r="6" fill="#fff" stroke="#E9DDFC" stroke-width="1.5"/>'+
  '<text class="hd-z" x="104" y="36" font-size="14" font-weight="700" fill="#8F63D8" font-family="sans-serif">z</text>';
const hdHeart = (cls, fill)=> '<svg class="hd-heart '+cls+'" viewBox="0 0 40 40"><path d="M20 35C8 27 3 20 3 13a8 8 0 0 1 17-4 8 8 0 0 1 17 4c0 7-5 14-17 22z" fill="'+fill+'" stroke="#fff" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke"/></svg>';
const hdStar = (cls)=> '<svg class="hd-star '+cls+'" viewBox="0 0 20 20"><path d="M10 0l2.4 7.6L20 10l-7.6 2.4L10 20l-2.4-7.6L0 10l7.6-2.4z"/></svg>';
function heroDecoBack(sky){
  const night = sky==="night";
  return '<div class="hero-deco back" aria-hidden="true">'+
    (night
      ? '<svg class="hd-sky moon" viewBox="0 0 40 40"><path d="M26 4a16 16 0 1 0 10 26A13 13 0 0 1 26 4z" fill="#FFE9A8" stroke="#fff" stroke-width="2.5" paint-order="stroke"/>'+
          '<circle cx="15" cy="20" r="1.4" fill="#C9A84F"/><circle cx="21" cy="26" r="1" fill="#C9A84F"/></svg>'+
        hdStar("s1")+hdStar("s2")+hdStar("s3")
      : '<svg class="hd-sky sun" viewBox="0 0 48 48"><g class="hd-rays" stroke="#FFD66B" stroke-width="3" stroke-linecap="round">'+
          '<path d="M24 2v6M24 40v6M2 24h6M40 24h6M8.5 8.5l4 4M35.5 35.5l4 4M39.5 8.5l-4 4M12.5 35.5l-4 4"/></g>'+
          '<circle cx="24" cy="24" r="12" fill="#FFE08A" stroke="#fff" stroke-width="2.5" paint-order="stroke"/>'+
          '<circle cx="20" cy="23" r="1.5" fill="#2A1F3D"/><circle cx="28" cy="23" r="1.5" fill="#2A1F3D"/>'+
          '<path d="M21 27q3 2.5 6 0" fill="none" stroke="#2A1F3D" stroke-width="1.4" stroke-linecap="round"/>'+
          '<ellipse cx="17" cy="27" rx="2.2" ry="1.4" fill="#F9B6C9"/><ellipse cx="31" cy="27" rx="2.2" ry="1.4" fill="#F9B6C9"/></svg>'+
        '<svg class="hd-cloud c1" viewBox="0 0 48 30"><path d="M12 27a8 8 0 0 1 0-16 11 11 0 0 1 21-3 9 9 0 0 1 3 19z" fill="#fff" stroke="#E4D7F9" stroke-width="2"/></svg>'+
        '<svg class="hd-cloud c2" viewBox="0 0 48 30"><path d="M12 27a8 8 0 0 1 0-16 11 11 0 0 1 21-3 9 9 0 0 1 3 19z" fill="#fff" stroke="#E4D7F9" stroke-width="2"/></svg>')+
    '<svg class="hd-bora" viewBox="0 0 120 84" overflow="visible">'+HD_BORA_BASE+(night ? HD_BORA_ASLEEP : HD_BORA_AWAKE)+'</svg>'+
    hdHeart("h1","#8F63D8")+hdHeart("h2","#C9B3F2")+
  '</div>';
}
function heroDecoFront(){
  return '<div class="hero-deco front" aria-hidden="true">'+
    '<svg class="hd-paw" viewBox="0 0 30 20"><ellipse cx="15" cy="10" rx="13" ry="8.5" fill="#E9DDFC" stroke="#fff" stroke-width="3.5" paint-order="stroke"/>'+
      '<path d="M9 8v4M15 7v5M21 8v4" stroke="#C7B3EC" stroke-width="1.6" stroke-linecap="round"/></svg>'+
    // A paw making a finger heart, with a little heart popping out of it.
    '<svg class="hd-finger" viewBox="0 0 40 40" overflow="visible"><g stroke="#fff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">'+
      '<ellipse cx="17" cy="31" rx="13" ry="8.5" fill="#E9DDFC"/>'+
      '<path d="M13 27c-1.5-6 0-12 3.5-13s4.5 3.5 2.5 10z" fill="#E9DDFC"/>'+
      '<path d="M18 25c1.5-5.5 5.5-9 8.5-8.2s2.4 5-2.8 9.4z" fill="#E9DDFC"/></g>'+
      '<path class="hd-pop" d="M30 11c-3.2-2.3-4.8-3.8-4.8-5.3a2 2 0 0 1 4.8-.8 2 2 0 0 1 4.8.8c0 1.5-1.6 3-4.8 5.3z" fill="#E8739F" stroke="#fff" stroke-width="1.6" paint-order="stroke"/></svg>'+
    hdHeart("h3","#8F63D8")+
  '</div>';
}

/* ---- Apricot theme: Maple the bear, and honey on the card ----
   An original storybook bear cub peeking over the top edge. By day (6am to
   7pm by the phone's clock) he watches the bees round his honey jar, blinks,
   wiggles his ears, licks his lips and waves; after that he is asleep, with a
   snore bubble and a moon. Inside the card a coat of honey drips from the top
   edge under a soft shine. All of it sits behind or around what the card says,
   never on it, and only the Apricot theme shows it. */
const MP_INK = "#3A2A1E";
const mpPaw = (x, cls, extra)=>{
  const d = "M"+x+" 17 C"+x+" 2 "+(x+28)+" 2 "+(x+28)+" 17 L"+(x+28)+" 24 C"+(x+28)+" 31 "+x+" 31 "+x+" 24 Z";
  return '<g'+(cls ? ' class="'+cls+'"' : '')+'><path d="'+d+'" fill="#fff" stroke="#fff" stroke-width="7" stroke-linejoin="round"/>'+
    '<path d="'+d+'" fill="#C98A55" class="mp-o"/>'+(extra||'')+'</g>';
};
const mpStar = (style)=> '<svg class="mp-star" style="'+style+'" viewBox="0 0 14 14"><path d="M7 0 L8.6 5.4 L14 7 L8.6 8.6 L7 14 L5.4 8.6 L0 7 L5.4 5.4 Z"/></svg>';
const mpBee = (cls)=> '<svg class="mp-bee'+(cls ? ' '+cls : '')+'" viewBox="0 0 22 18">'+
  '<ellipse class="mp-wing" cx="9" cy="5" rx="4" ry="5" fill="#E7F4FF" stroke="'+MP_INK+'" stroke-width="1.2"/>'+
  '<ellipse class="mp-wing" cx="14" cy="5" rx="4" ry="5" fill="#E7F4FF" stroke="'+MP_INK+'" stroke-width="1.2"/>'+
  '<ellipse cx="11" cy="12" rx="8" ry="5.5" fill="#FFC93C" stroke="'+MP_INK+'" stroke-width="1.4"/>'+
  '<path d="M9 7 v10 M13 7 v10" stroke="'+MP_INK+'" stroke-width="2"/><circle cx="18" cy="11" r="1" fill="'+MP_INK+'"/></svg>';

function bearDecoBack(sky){
  const night = sky==="night";
  const face = night
    ? '<path d="M59 71 q7 5 14 0 M91 71 q7 5 14 0" fill="none" class="mp-o"/>'+
      '<ellipse cx="82" cy="84" rx="8" ry="5.6" fill="#3B2A1D"/>'+
      '<ellipse cx="82" cy="96" rx="3.4" ry="2.8" fill="#8A4A3A" class="mp-o"/>'+
      '<g class="mp-snore"><circle cx="98" cy="86" r="7" fill="rgba(190,228,255,.75)" stroke="#8FBDE3" stroke-width="1.6"/><circle cx="95.5" cy="83.5" r="1.8" fill="#fff"/></g>'+
      '<g class="mp-zz"><text x="122" y="44">z</text><text x="126" y="42">z</text><text x="130" y="40">Z</text></g>'
    : '<g class="mp-look"><g class="mp-eyes">'+
        '<circle cx="66" cy="70" r="4.8" fill="'+MP_INK+'"/><circle cx="98" cy="70" r="4.8" fill="'+MP_INK+'"/>'+
        '<circle cx="67.6" cy="68.4" r="1.6" fill="#fff"/><circle cx="99.6" cy="68.4" r="1.6" fill="#fff"/></g></g>'+
      '<path d="M60 60 q6 -4 12 -1 M92 59 q6 -3 12 1" fill="none" class="mp-o"/>'+
      '<ellipse cx="82" cy="84" rx="8" ry="5.6" fill="#3B2A1D"/><ellipse cx="80" cy="82.4" rx="2.4" ry="1.4" fill="#fff" opacity=".8"/>'+
      '<path d="M82 89.5 v4 M82 93.5 q-5 4.5 -10 1 M82 93.5 q5 4.5 10 1" fill="none" class="mp-o"/>'+
      '<ellipse class="mp-tongue" cx="82" cy="98" rx="4" ry="3.4" fill="#EC7F7F" stroke="'+MP_INK+'" stroke-width="1.6"/>';
  const head =
    '<svg class="mp-head" viewBox="0 0 164 124"><g class="mp-tilt'+(night ? ' mp-sleeping' : '')+'">'+
      '<g class="mp-ear l"><circle cx="44" cy="34" r="17" fill="#B97A48" class="mp-o mp-rim"/><circle cx="45" cy="36" r="9" fill="#EBC49C"/></g>'+
      '<g class="mp-ear r"><circle cx="120" cy="34" r="17" fill="#B97A48" class="mp-o mp-rim"/><circle cx="119" cy="36" r="9" fill="#EBC49C"/></g>'+
      '<ellipse cx="82" cy="74" rx="46" ry="42" fill="#C98A55" class="mp-o mp-rim"/>'+
      '<path d="M72 34 q4 -8 10 -2 q4 -7 10 0" fill="none" class="mp-o"/>'+
      '<ellipse cx="82" cy="92" rx="23" ry="17" fill="#F6DDBE"/>'+
      '<ellipse cx="56" cy="88" rx="7" ry="4.2" fill="#EF9A7C" opacity=".65"/><ellipse cx="108" cy="88" rx="7" ry="4.2" fill="#EF9A7C" opacity=".65"/>'+
      face+
    '</g></svg>';
  const sky_ = night
    ? '<svg class="mp-moon" viewBox="0 0 58 58">'+
        '<path d="M38 6 A24 24 0 1 0 52 42 A18 18 0 0 1 38 6 Z" fill="#FFE39A" stroke="#fff" stroke-width="6" paint-order="stroke"/>'+
        '<path d="M38 6 A24 24 0 1 0 52 42 A18 18 0 0 1 38 6 Z" fill="none" class="mp-o"/>'+
        '<path d="M19 32 q3 2.5 6 0 M29 38 q3 2.5 6 0" fill="none" class="mp-o"/></svg>'+
      mpStar("left:calc(50% - 52px); top:calc(var(--ct) - 84px)")+
      mpStar("right:96px; top:calc(var(--ct) - 46px); width:10px; height:10px; animation-delay:.9s")+
      mpStar("left:20px; top:calc(var(--ct) - 86px); animation-delay:1.7s")+
      '<span class="mp-ffly"></span>'
    : '<svg class="mp-sun" viewBox="0 0 58 58"><g class="mp-rays" stroke="#F4A93C" stroke-width="3.6" stroke-linecap="round">'+
        '<path d="M29 2v8M29 48v8M2 29h8M48 29h8M10 10l5.6 5.6M42.4 42.4l5.6 5.6M48 10l-5.6 5.6M15.6 42.4L10 48"/></g>'+
        '<circle cx="29" cy="29" r="13" fill="#FFD66E" stroke="#fff" stroke-width="6" paint-order="stroke"/>'+
        '<circle cx="29" cy="29" r="13" fill="none" class="mp-o"/></svg>'+
      '<svg class="mp-leaf" viewBox="0 0 22 22"><path d="M11 1 L13 7 L18 5 L16 10 L21 12 L15 14 L16 19 L11 16 L6 19 L7 14 L1 12 L6 10 L4 5 L9 7 Z" fill="#D8572A" stroke="#fff" stroke-width="2" paint-order="stroke" stroke-linejoin="round"/>'+
        '<path d="M11 16 V21" stroke="#8E3A1C" stroke-width="1.6" stroke-linecap="round"/></svg>';
  return '<div class="bear-deco back" aria-hidden="true">'+sky_+head+(night ? '' : mpBee("")+mpBee("b2"))+'</div>';
}
function bearDecoFront(sky){
  const night = sky==="night";
  const jarBody = "M10 18 C4 22 2 30 2 38 C2 50 12 56 30 56 C48 56 58 50 58 38 C58 30 56 22 50 18 Z";
  const jar =
    '<svg class="mp-jar" viewBox="0 0 62 58">'+
      '<path d="'+jarBody+'" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>'+
      '<path d="'+jarBody+'" fill="'+(night ? '#E8A333' : '#F2B23A')+'" class="mp-o"/>'+
      '<path d="M8 30 C18 36 42 36 54 30 C55 42 50 52 30 52 C10 52 6 42 8 30 Z" fill="'+(night ? '#C97A18' : '#E0901E')+'" opacity=".55"/>'+
      '<path d="M12 26 C10 32 10 40 14 46" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>'+
      '<path d="M6 12 C6 6 56 6 56 12 L56 20 C56 24 6 24 6 20 Z" fill="'+(night ? '#DCC9AA' : '#EAD8BA')+'" class="mp-o"/>'+
      '<path d="M6 16 H56" stroke="#B97A48" stroke-width="2.2"/>'+
      (night ? '' :
        '<path class="mp-drip" d="M40 22 C40 22 38 28 40 32 C42 34 44 32 43 28 C42 25 41 23 40 22 Z" fill="#F2B23A" stroke="'+MP_INK+'" stroke-width="1.4"/>'+
        '<circle class="mp-drop" cx="41.5" cy="36" r="2.2" fill="#F2B23A" stroke="'+MP_INK+'" stroke-width="1"/>')+
    '</svg>';
  const paws = night
    ? '<svg class="mp-paws night" viewBox="0 0 164 36">'+
        mpPaw(30, "", '<path d="M38 9 v7 M46 9 v7" class="mp-o mp-thin"/>')+
        mpPaw(108, "", '<path d="M116 9 v7 M124 9 v7" class="mp-o mp-thin"/>')+'</svg>'
    : '<svg class="mp-paws" viewBox="0 0 164 36">'+
        mpPaw(18, "", '<path d="M26 9 v7 M34 9 v7" class="mp-o mp-thin"/>')+
        mpPaw(118, "mp-wave", '<ellipse cx="132" cy="16" rx="5" ry="4" fill="#F6DDBE"/><circle cx="124" cy="9" r="2" fill="#F6DDBE"/>'+
          '<circle cx="132" cy="7" r="2" fill="#F6DDBE"/><circle cx="140" cy="9" r="2" fill="#F6DDBE"/>')+'</svg>';
  // A little paw holding the card's bottom-left corner: it taps by day and
  // rests at night.
  const toes = '<ellipse cx="20" cy="23" rx="13" ry="11"/><circle cx="7.5" cy="11" r="5.2"/><circle cx="15" cy="5.5" r="5.2"/>'+
               '<circle cx="25" cy="5.5" r="5.2"/><circle cx="32.5" cy="11" r="5.2"/>';
  const cornerPaw =
    '<svg class="mp-cornerpaw'+(night ? ' night' : '')+'" viewBox="0 0 40 36"><g class="mp-pat">'+
      '<g fill="#fff" stroke="#fff" stroke-width="9" stroke-linejoin="round">'+toes+'</g>'+
      '<g fill="'+MP_INK+'" stroke="'+MP_INK+'" stroke-width="4.4" stroke-linejoin="round">'+toes+'</g>'+
      '<g fill="#C98A55">'+toes+'</g>'+
      '<g fill="#F6DDBE"><ellipse cx="20" cy="24.5" rx="7" ry="5.4"/><circle cx="8" cy="11.5" r="2.4"/><circle cx="15.2" cy="6.4" r="2.4"/>'+
        '<circle cx="24.8" cy="6.4" r="2.4"/><circle cx="32" cy="11.5" r="2.4"/></g>'+
    '</g></svg>';
  return '<div class="bear-deco front" aria-hidden="true">'+jar+paws+cornerPaw+'</div>';
}
// Inside the card: a glossy coat of honey along the top edge, drips that
// stretch, a drop that falls down the empty right-hand side, and a soft shine.
function heroHoney(){
  const glint = (cls)=> '<svg class="hh-glint '+cls+'" viewBox="0 0 12 12"><path d="M6 0 L7.2 4.8 L12 6 L7.2 7.2 L6 12 L4.8 7.2 L0 6 L4.8 4.8 Z"/></svg>';
  return '<div class="hc-honey" aria-hidden="true">'+
    '<span class="hh-gloss"></span>'+
    '<svg class="hh-coat" viewBox="0 0 360 26" preserveAspectRatio="none">'+
      '<path d="M0 0 H360 V11 C346 13 336 19 322 15 C304 10 294 22 278 17 C262 12 250 21 232 15 C214 10 200 19 184 14 C168 9 154 21 138 15 C120 9 106 19 90 14 C74 9 58 21 42 15 C26 10 12 17 0 13 Z"/>'+
      '<path class="hl" d="M8 6 C60 8 120 5 180 7 S300 6 352 6"/></svg>'+
    '<i class="hh-drip d1"></i><i class="hh-drip d2"></i><i class="hh-drip d3"></i><i class="hh-drip d4"></i><i class="hh-drop"></i>'+
    glint("g1")+glint("g2")+glint("g3")+
  '</div>';
}

function addExpenseAnywhere(){
  if(!joinedHere().length) return sheetGroupNew();
  if(joinedHere().length===1){ openGroup(joinedHere()[0].id); setTimeout(()=>sheetExpense(null), 260); return; }
  sheetPickGroup();
}

function viewHome(main){
  // A phone shows the brand here; a computer, whose sidebar already carries
  // the brand, shows the screen's name.
  $("barTitle").textContent = "Today";
  $("barTitle").hidden = false;
  $("barBrand").hidden = false;
  $("fab").hidden = true;

  const head = el("div","topline");
  head.innerHTML =
    '<div><h1 class="display">Money feels lighter when it’s clear.</h1>'+
    '<p class="eyebrow">'+esc(new Date().toLocaleDateString(undefined,
      {weekday:"long", month:"long", day:"numeric"}))+'</p></div>';
  // On a phone this button would sit beside the raised one in the bar below,
  // so it only appears where there is no bar.
  const addBtn = el("button","btn dark","+  Add expense");
  addBtn.addEventListener("click", sheetQuickAdd);
  head.appendChild(addBtn);
  main.appendChild(head);

  if(!joinedHere().length){
    const e=el("div","empty");
    e.innerHTML=sideEmptyHTML("group");
    const b=el("button","btn p","Create a group"); b.addEventListener("click", sheetGroupNew);
    e.appendChild(b);
    e.style.marginTop="var(--s5)";
    main.appendChild(e);
    return;
  }

  // Kept per currency: a rupee group and a dollar group are never added up.
  const owedB={}, oweB={}, sharedB={};
  joinedHere().forEach(g=>{
    const v=myBalance(g.id);
    if(v>0.004) curAdd(owedB, g.id, v); else if(v<-0.004) curAdd(oweB, g.id, -v);
    curAdd(sharedB, g.id, totalOf(g.id));
  });
  const plan = toDoNext();
  const oweWho = {}, owedWho = {};
  plan.forEach(t=> (t.dir==="pay" ? oweWho : owedWho)[t.who]=true );
  const netB = bagNet(owedB, oweB);

  /* ---- the feature panel: everything to settle, one card at a time ----
     The amount is the point of each card, so it is the biggest thing on it;
     who, which group and what for sit around it. */
  const slides = heroSlides();
  if(HERO_I >= slides.length) HERO_I = 0;
  const still = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  const hero = el("section","hero carousel"+(still ? " still" : ""));
  hero.setAttribute("aria-roledescription","carousel");
  hero.setAttribute("aria-label","What there is to settle");
  // Honey and shine go in first, so everything the card says sits on top.
  hero.insertAdjacentHTML("beforeend", heroHoney());
  // The cards slide inside their own window. The panel clips at its border,
  // not inside its padding, so without this the next card showed at the edge.
  const view = el("div","hc-view");
  const track = el("div","hc-track");
  view.appendChild(track);
  hero.appendChild(view);
  // Light passes across the card once each time a new one comes up. It is its
  // own layer because the panel's two drawn circles already use ::before and
  // ::after.
  const sheen = el("span","hc-sheen");
  sheen.setAttribute("aria-hidden","true");
  hero.appendChild(sheen);

  const face = (icon, text)=> '<span class="ms" aria-hidden="true">'+icon+'</span>'+esc(text);

  if(!slides.length){
    const s0 = el("div","hc-slide done on");
    s0.innerHTML =
      '<div class="hc-top"><span class="hc-av" aria-hidden="true"><span class="ms">check</span></span>'+
        '<span class="hc-chip">All clear</span></div>'+
      '<h2 class="hc-amt">Everything is settled.</h2>'+
      '<p class="hc-for">Nobody owes anybody in any of your groups.</p>';
    track.appendChild(s0);
  }
  slides.forEach((t,i)=>{
    const pay = t.dir==="pay", forWhat = whatFor(t.gid, t.who), key = t.gid+"|"+t.who;
    const sl = el("div","hc-slide "+(pay ? "owe" : "get"));
    sl.setAttribute("role","group");
    sl.setAttribute("aria-roledescription","slide");
    sl.setAttribute("aria-label", (i+1)+" of "+slides.length);
    sl.innerHTML =
      '<div class="hc-top">'+
        '<span class="hc-av" aria-hidden="true">'+esc(initials(t.who))+'</span>'+
        '<span class="hc-chip">'+(pay ? "You owe" : "Owed to you")+'<i aria-hidden="true"></i>'+esc(groupName(t.gid))+'</span>'+
      '</div>'+
      '<p class="hc-line">'+(pay ? 'You owe <b>'+esc(t.who)+'</b>' : '<b>'+esc(t.who)+'</b> owes you')+'</p>'+
      '<h2 class="hc-amt">'+money(t.amt, t.gid)+'</h2>'+
      '<p class="hc-for">'+(forWhat ? 'for '+esc(forWhat) : 'in '+esc(groupName(t.gid)))+'</p>'+
      '<div class="act"></div>';
    const b = el("button","btn dark hc-btn");
    const label = (pay ? "Pay " : "Remind ")+t.who;
    b.setAttribute("aria-label", label+" "+money(t.amt, t.gid));
    if(!pay && NUDGED[key]){
      b.innerHTML = face("done","Reminder sent"); b.disabled = true;
      b.setAttribute("aria-label","Reminder sent to "+t.who);
    } else {
      b.innerHTML = face(pay ? "north_east" : "notifications_active", label);
    }
    b.addEventListener("click", ()=>{
      if(pay){
        // I owe them: record that I paid.
        const me = meIn(t.gid);
        openGroup(t.gid);
        setTimeout(()=> sheetSettle(me, t.who, t.amt, null), 260);
        return;
      }
      // They owe me: ask them for it. If they have already paid and simply
      // forgot to say so, "They paid me" beside this records it instead.
      if(sendNudge(t.gid, t.who, t.amt, b)){
        NUDGED[key] = true;
        b.innerHTML = face("done","Reminder sent");
        b.setAttribute("aria-label","Reminder sent to "+t.who);
      }
    });
    sl.querySelector(".act").appendChild(b);
    // Money that has already arrived, which they never got round to recording.
    if(!pay){
      const m = el("button","hc-btn2");
      m.type = "button";
      m.innerHTML = face("task_alt","They paid me");
      m.setAttribute("aria-label", t.who+" paid me - mark "+money(t.amt, t.gid)+" as received");
      m.addEventListener("click", ()=>{
        const me = meIn(t.gid);
        openGroup(t.gid);
        setTimeout(()=> sheetSettle(t.who, me, t.amt, null), 260);
      });
      sl.querySelector(".act").appendChild(m);
    }
    track.appendChild(sl);
  });

  const foot = el("div","hc-foot");
  const segs = el("div","hc-segs");
  foot.appendChild(segs);
  // One quiet line: the words, then the figure with its sign and colour, so it
  // reads "you are up" or "you are down" at a glance.
  // Up in one currency and down in another shows both, without a colour.
  const tone = bagTone(netB);
  foot.insertAdjacentHTML("beforeend",
    '<span class="net '+(tone==="mix" ? "zero" : tone)+(curKeys(netB).length>1 ? " multi" : "")+'"><small>Overall balance</small><b>'+
      esc(moneySigned(netB))+'</b></span>');
  hero.appendChild(foot);
  // The card sits in a wrapper so the sky and Bora can go behind and in front
  // of it. The decoration shows in the purple theme only.
  const sky = heroSky();
  const heroWrap = el("div","hero-wrap sky-"+sky);
  heroWrap.innerHTML = heroDecoBack(sky) + bearDecoBack(sky);
  heroWrap.appendChild(hero);
  heroWrap.insertAdjacentHTML("beforeend", heroDecoFront() + bearDecoFront(sky));
  main.appendChild(heroWrap);
  pushPromptCard(main);

  if(slides.length > 1){
    slides.forEach((t,j)=>{
      const d = el("button","hc-seg"); d.type = "button";
      d.setAttribute("aria-label", "Show "+(j+1)+" of "+slides.length);
      d.innerHTML = "<i></i>";
      d.addEventListener("click", ()=> show(j) );
      // The bar filling on the showing segment is the clock: when it runs out
      // the next card comes up. Holding the card pauses the fill, so the time
      // left can never drift from what the bar shows. No timer to leak, and a
      // background tab pauses it by itself.
      d.firstChild.addEventListener("animationend", ()=>{ if(j===HERO_I) show(HERO_I + 1); });
      segs.appendChild(d);
    });
  }

  function show(i){
    if(!slides.length){
      // All clear: nothing to page through, but it still glows and gets its
      // one pass of light.
      hero.classList.add("mood-done");
      if(!still && HERO_SWEPT!=="done"){ sheen.classList.add("go"); }
      HERO_SWEPT = "done";
      return;
    }
    HERO_I = (i + slides.length) % slides.length;
    track.style.transform = "translateX("+(-HERO_I*100)+"%)";
    // Cards off to the side are out of reach of the keyboard and screen
    // readers, so Tab never lands on a button that cannot be seen.
    [].forEach.call(track.children, (c,j)=>{ c.inert = j!==HERO_I; c.classList.toggle("on", j===HERO_I); });
    // The glow takes the colour of what is showing: warm for money you owe,
    // green for money coming back to you.
    const cur = track.children[HERO_I];
    ["owe","get","done"].forEach(m=> hero.classList.toggle("mood-"+m, !!cur && cur.classList.contains(m)) );
    if(!still && HERO_I!==HERO_SWEPT){
      sheen.classList.remove("go"); void sheen.offsetWidth; sheen.classList.add("go");
    }
    HERO_SWEPT = HERO_I;
    [].forEach.call(segs.children, (d,j)=>{
      d.setAttribute("aria-current", j===HERO_I ? "true" : "false");
      d.classList.remove("run");
      if(j===HERO_I && !still){ void d.offsetWidth; d.classList.add("run"); }
    });
  }

  // Hold still while a hand is on it, or while it has keyboard focus - but not
  // merely because a tap left focus on a button, or it would stay stopped
  // after every tap.
  const hold = (on)=> hero.classList.toggle("held", on);
  hero.addEventListener("pointerenter", ()=> hold(true));
  hero.addEventListener("pointerleave", ()=> hold(false));
  hero.addEventListener("focusin", (e)=>{ if(e.target.matches && e.target.matches(":focus-visible")) hold(true); });
  hero.addEventListener("focusout", ()=> hold(false));

  // Swipe between cards.
  let x0 = null;
  track.addEventListener("pointerdown", e=>{ x0 = e.clientX; });
  track.addEventListener("pointerup", e=>{
    if(x0 === null) return;
    const dx = e.clientX - x0; x0 = null;
    if(Math.abs(dx) > 40) show(HERO_I + (dx < 0 ? 1 : -1));
  });

  // Put the card that was showing back without sliding to it from the first.
  track.style.transition = "none";
  show(HERO_I);
  void track.offsetWidth;
  track.style.transition = "";

  /* ---- summary cards ---- */
  const nOwed=Object.keys(owedWho).length, nOwe=Object.keys(oweWho).length;
  const multi = (bag)=> curKeys(bag).length>1 ? " multi" : "";
  const sums = el("div","sums");
  sums.innerHTML =
    '<div class="sum"><span class="k">Friends owe you</span>'+
      '<span class="v pos'+multi(owedB)+'">'+esc(moneyMulti(owedB))+'</span>'+
      '<span class="s">'+(nOwed ? "Across "+nOwed+" "+(nOwed===1?"person":"people") : "Nobody, right now")+'</span></div>'+
    '<div class="sum"><span class="k">You need to pay</span>'+
      '<span class="v neg'+multi(oweB)+'">'+esc(moneyMulti(oweB))+'</span>'+
      '<span class="s">'+(nOwe ? "Across "+nOwe+" "+(nOwe===1?"person":"people") : "Nobody, right now")+'</span></div>'+
    '<div class="sum"><span class="k">Shared so far</span>'+
      '<span class="v'+multi(sharedB)+'">'+esc(moneyMulti(sharedB))+'</span>'+
      '<span class="s">Across '+joinedHere().length+' group'+(joinedHere().length===1?"":"s")+'</span></div>';
  main.appendChild(sums);

  /* ---- latest moments, friends and your groups ----
     Each opens with a small heading and, where there is more, a way to it.
     They rise in the first time Today is opened, not on every redraw. */
  const enter = !TH_SEEN; TH_SEEN = true;
  const secHead = (icon, title, action)=>{
    const h = el("div","th-head");
    h.innerHTML = '<span class="th-ic"><span class="ms" aria-hidden="true">'+icon+'</span></span><h2>'+esc(title)+'</h2>';
    if(action){
      const a = el("button","th-more"); a.type = "button";
      a.innerHTML = esc(action[0])+'<span class="ms" aria-hidden="true">chevron_right</span>';
      a.addEventListener("click", action[1]);
      h.appendChild(a);
    }
    return h;
  };
  const goTab = (t)=> ()=>{ TAB = t; window.scrollTo(0,0); render(); };
  const rise = (node, i)=>{ if(enter){ node.classList.add("th-enter"); node.style.setProperty("--i", i); } };
  const cols = el("div","cols2");

  // Latest moments: a timeline, each stop coloured by what it was.
  const left = el("div","th-col");
  left.appendChild(secHead("history", "Latest moments", ["See all", goTab("activity")]));
  const tl = el("div","th-card th-timeline");
  const moments = latestMoments(4);
  if(!moments.length) tl.innerHTML = '<p class="th-empty">Nothing added yet. Expenses you add show up here.</p>';
  moments.forEach((x,i)=>{
    const tint = (typeof VZ_CAT_TINT!=="undefined" && VZ_CAT_TINT[x.cat]) || "#B4703E";
    const tone = x.mine>0.004 ? "pos" : x.mine<-0.004 ? "neg" : "zero";
    const b = el("button","th-mom"); b.type = "button";
    b.style.setProperty("--t", tint); rise(b, i);
    b.innerHTML =
      '<span class="th-node"><span class="ms" aria-hidden="true">'+catOf(x.cat).i+'</span></span>'+
      '<span class="th-b"><span class="th-t">'+esc(x.desc)+'</span>'+
        '<span class="th-m">'+esc(dayLabel(x.at))+' · '+esc(groupName(x.gid))+'</span></span>'+
      '<span class="th-amt"><b>'+money(x.amount, x.gid)+'</b>'+
        '<span class="th-pill '+tone+'">'+(tone==="pos" ? "You get "+money(x.mine, x.gid) : tone==="neg" ? "You pay "+money(-x.mine, x.gid) : "Not yours")+'</span></span>';
    b.addEventListener("click", ()=> openGroup(x.gid) );
    tl.appendChild(b);
  });
  left.appendChild(tl);
  cols.appendChild(left);

  // Friends: a row of cards, each ringed by where you stand with them.
  const right = el("div","th-col");
  right.appendChild(secHead("diversity_3", "Friends"));
  const fr = el("div","th-friends");
  const friends = friendsAcross();
  if(!friends.length) fr.innerHTML = '<p class="th-empty th-card">Nobody else yet. Add people to a group and they show up here.</p>';
  friends.slice(0,10).forEach((p,i)=>{
    const tone = bagTone(p.net);
    const b = el("button","th-friend "+tone); b.type = "button"; rise(b, i);
    b.innerHTML =
      '<span class="th-fav">'+avatarHTML("", p.name, p.colour, p.photo)+'<i class="th-fdot" aria-hidden="true"></i></span>'+
      '<span class="th-fn">'+esc(p.name)+'</span>'+
      '<span class="th-fs">'+(tone==="pos" ? "Owes you" : tone==="neg" ? "You owe" : tone==="mix" ? "Both ways" : "All square")+'</span>'+
      (tone==="zero" ? '<span class="th-fa zero"><span class="ms" aria-hidden="true">check</span></span>'
        : '<b class="th-fa'+(curKeys(p.net).length>1 ? ' multi' : '')+'">'+esc(tone==="mix" ? moneySigned(p.net) : moneyMulti(p.net))+'</b>');
    b.addEventListener("click", ()=> sheetFriend(p.name) );
    fr.appendChild(b);
  });
  right.appendChild(fr);
  cols.appendChild(right);
  main.appendChild(cols);

  // Your groups: a tile each in the group's own colour, the same one it has
  // on the Groups screen, with who is in it and where you stand.
  main.appendChild(secHead("group_work", "Your groups", ["All groups", goTab("groups")]));
  const grid = el("div","th-groups");
  joinedHere().slice().sort((a,b)=>groupName(a.id).localeCompare(groupName(b.id))).forEach((g,i)=>{
    const v = myBalance(g.id), ppl = membersOf(g.id), total = totalOf(g.id);
    const tone = v>0.004 ? "pos" : v<-0.004 ? "neg" : "zero";
    const t = el("button","th-group gc"+(i%6)); t.type = "button"; rise(t, i);
    const faces = ppl.slice(0,4).map(m=> m.photo
        ? '<img src="'+esc(m.photo)+'" alt="" referrerpolicy="no-referrer">'
        : '<span style="background:'+esc(m.color)+'">'+esc(initials(m.name))+'</span>').join("")+
      (ppl.length>4 ? '<span class="more">+'+(ppl.length-4)+'</span>' : '');
    t.innerHTML =
      '<span class="th-gtop"><span class="th-gic"><span class="ms" aria-hidden="true">'+groupIcon(g.id)+'</span></span>'+
        '<span class="th-faces" aria-hidden="true">'+faces+'</span></span>'+
      '<span class="th-gn">'+esc(groupName(g.id))+'</span>'+
      '<span class="th-gm">'+ppl.length+' '+(ppl.length===1 ? "member" : "members")+' · '+money(total, g.id)+' spent</span>'+
      '<span class="th-gb '+tone+'">'+(tone==="zero" ? '<span class="ms" aria-hidden="true">check_circle</span>Settled'
        : tone==="pos" ? "You get "+money(v, g.id) : "You owe "+money(-v, g.id))+'</span>';
    t.addEventListener("click", ()=> openGroup(g.id) );
    grid.appendChild(t);
  });
  const add = el("button","th-group th-add"); add.type = "button"; rise(add, joinedHere().length);
  add.innerHTML = '<span class="ms" aria-hidden="true">add</span><span>New group</span>';
  add.addEventListener("click", sheetGroupNew);
  grid.appendChild(add);
  main.appendChild(grid);
}

/* Which group is this expense for? Only asked when there is more than one. */
function sheetPickGroup(){
  openSheet("Add to which group?", (b)=>{
    b.innerHTML = '<p class="lead">Pick the group this expense belongs to.</p><div class="card" id="pgList"></div>';
    const host=$("pgList");
    joinedHere().slice().sort((x,y)=>groupName(x.id).localeCompare(groupName(y.id))).forEach(g=>{
      const r=el("button","row");
      r.innerHTML='<span class="cat"><span class="ms" aria-hidden="true">'+groupIcon(g.id)+'</span></span>'+
        '<span class="body"><span class="t1">'+esc(groupName(g.id))+'</span>'+
        '<span class="t2">'+everyoneIn(g.id).length+' members</span></span>'+
        '<span class="right"><span class="ms" aria-hidden="true" style="color:var(--ink-3)">chevron_right</span></span>';
      r.addEventListener("click", ()=>{ closeSheet(); openGroup(g.id); setTimeout(()=>sheetExpense(null),260); });
      host.appendChild(r);
    });
  }, render);
}

/* One person, across every group we share. */
function sheetFriend(name){
  openSheet(name, (b)=>{
    b.innerHTML = '<p class="lead">Everything you and '+esc(name)+' share.</p><div class="card" id="frList"></div>';
    const host=$("frList");
    const rows=[];
    joinedHere().forEach(g=>{
      const me=meIn(g.id);
      if(!me || everyoneIn(g.id).indexOf(name)<0) return;
      let net=0;
      transferPlan(g.id).forEach(t=>{
        if(t.from===me && t.to===name) net-=t.amt;
        else if(t.to===me && t.from===name) net+=t.amt;
      });
      rows.push({gid:g.id, net:net});
    });
    if(!rows.length){ host.innerHTML='<div class="mom"><span class="b"><span class="m">No shared groups.</span></span></div>'; return; }
    rows.forEach(x=>{
      const r=el("button","row");
      r.innerHTML='<span class="cat"><span class="ms" aria-hidden="true">'+groupIcon(x.gid)+'</span></span>'+
        '<span class="body"><span class="t1">'+esc(groupName(x.gid))+'</span></span>'+
        '<span class="right"><span class="amt '+(x.net>0.004?"pos":x.net<-0.004?"neg":"zero")+'">'+
        (Math.abs(x.net)<0.005 ? "settled" : x.net>0 ? "gets you "+money(x.net, x.gid) : "you pay "+money(-x.net, x.gid))+
        '</span></span>';
      r.addEventListener("click", ()=>{ closeSheet(); openGroup(x.gid); setTimeout(()=>sheetPerson(name),260); });
      host.appendChild(r);
    });
  }, render);
}
