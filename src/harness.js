/* ===== TEST HARNESS — never shipped. Fakes a signed-in user + data. ===== */
(function(){
  // Never let a cached shell serve a stale harness.
  if(navigator.serviceWorker) navigator.serviceWorker.getRegistrations()
    .then(rs=>rs.forEach(r=>r.unregister())).catch(()=>{});
  if(window.caches) caches.keys().then(ks=>ks.forEach(k=>caches.delete(k))).catch(()=>{});
  const q = new URLSearchParams(location.search);
  USER = { uid:"u1", name:"Abilash K",
           email: q.get("admin") ? "abilashkjm01@gmail.com" : "someone@gmail.com",
           photo:null };

  const mine = q.get("unclaimed") ? null : "u1";

  // The approval gate. Default approved so every other harness test still
  // reaches the app; ?access=none|pending|declined exercises the screens.
  const acc = q.get("access") || "approved";
  ACCESS = acc==="none" ? null : {status:acc, name:USER.name, email:USER.email, at:Date.now()-86400e3};
  REQUESTS = {
    u1:{status:"approved", name:"Abilash K", email:"abilashkjm01@gmail.com", at:Date.now()-9e6},
    u5:{status:"pending",  name:"Kalai",     email:"kalai@example.com",      at:Date.now()-3e5},
    u6:{status:"declined", name:"A Stranger",email:"nobody@example.com",     at:Date.now()-8e6}
  };
  DIRECTORY = {
    u1:{name:"Abilash K",  email:"abilashkjm01@gmail.com",  at:Date.now()-9e6},
    u5:{name:"Kalai",      email:"kalai@example.com",       at:Date.now()-3e5},
    u8:{name:"Kavya",      email:"kavya@example.com",       at:Date.now()-2e6},
    u9:{name:"Kelvin Raj", email:"kelvin@example.com",      at:Date.now()-1e6}
  };
  ALLUSERS = {
    u1:{profile:{name:"Abilash K", email:"abilashkjm01@gmail.com", at:Date.now()-9e6}},
    u5:{profile:{name:"Kalai",     email:"kalai@example.com",      at:Date.now()-3e5}},
    u8:{profile:{name:"Kavya",     email:"kavya@example.com",      at:Date.now()-2e6}}
  };
  DATA = {
    g1: {
      meta:{name:"Montreal & Quebec", type:"trip", at:Date.now(), by:"Abilash", byUid:"u1"},
      people:{
        
        b:{n:"Kalai",   c:"#006b5d"},
        c:{n:"Kavya",   c:"#1565c0"},
        d:{n:"Kelvin",  c:"#ef6c00"},
        z:{n:"Abilash KJM", c:"#2e7d32", uid:mine, email:"abilashkjm01@gmail.com"}
      },
      expenses:{
        e1:{desc:"Hotel Montreal", amount:300, payer:"Kalai", mode:"equal",
            between:["Abilash","Kalai","Kavya","Kelvin"], vals:{}, cat:"lodging", at:Date.now()-3600e3, by:"Kalai"},
        e2:{desc:"Dinner at Schwartz", amount:100, payer:"Abilash", mode:"exact",
            between:["Abilash","Kalai","Kavya","Kelvin"], vals:{Abilash:40,Kalai:30,Kavya:20,Kelvin:10},
            cat:"food", at:Date.now()-90000e3, by:"Abilash"},
        e3:{desc:"Fuel", amount:80, payer:"Kavya", mode:"equal",
            between:["Kavya","Kelvin"], vals:{}, cat:"fuel", at:Date.now()-200000e3, by:"Kavya"},
        e4:{desc:"Parking Old Quebec", amount:36, payer:"Abilash", mode:"equal",
            between:["Abilash","Kalai","Kavya"], vals:{}, cat:"transport", at:Date.now()-240000e3, by:"Abilash"},
        e5:{desc:"Bagels", amount:18, payer:"Kelvin", mode:"equal",
            between:["Kelvin"], vals:{}, cat:"food", at:Date.now()-300000e3, by:"Kelvin"},
        e6:{desc:"Poutine", amount:44, payer:"Abilash", mode:"equal",
            between:["Abilash","Kalai","Kavya","Kelvin"], vals:{}, cat:"food", at:Date.now()-340000e3, by:"Abilash"},
        e7:{desc:"Museum tickets", amount:96, payer:"Kalai", mode:"equal",
            between:["Abilash","Kalai","Kavya","Kelvin"], vals:{}, cat:"fun", at:Date.now()-380000e3, by:"Kalai"},
        e8:{desc:"Breakfast", amount:52, payer:"Kavya", mode:"equal",
            between:["Abilash","Kavya"], vals:{}, cat:"food", at:Date.now()-420000e3, by:"Kavya"}
      },
      payments:{ p1:{from:"Kelvin", to:"Kalai", amount:20, note:"cash", at:Date.now()-1000e3, by:"Kelvin"} }
    }
  };
  JOINED = [{id:"g1", name:"Montreal & Quebec"}];
  if(q.get("many")){
    ["Lisbon trip","Apartment 4B","Maya's birthday","Ski weekend","Book club","Road trip"].forEach((n,i)=>{
      const id="x"+i;
      DATA[id]={meta:{name:n, type:"trip"}, people:{a:{n:"Abilash KJM", uid:"u1"}}, expenses:{}};
      JOINED.push({id, name:n});
    });
  }
  LEGACY_OK = false;
  ADMIN_GROUPS = Object.assign({}, DATA);

  // An in-memory stand-in for the database so writes can be exercised.
  function at(path){
    const parts=String(path).split("/");
    if(parts[0]==="access"){
      const uid=parts[1];
      if(parts.length===2) return [REQUESTS, uid];
      REQUESTS[uid]=REQUESTS[uid]||{};
      return [REQUESTS[uid], parts[2]];
    }
    if(parts[0]!=="trips") return null;
    const gid=parts[1];
    if(parts.length===2) return [DATA, gid];
    let o=DATA[gid]||(DATA[gid]={});
    const rest=parts.slice(2);
    for(let i=0;i<rest.length-1;i++){ o=o[rest[i]]||(o[rest[i]]={}); }
    return [o, rest[rest.length-1]];
  }
  const MAIL = [];              // notes the app leaves for the mailer
  const later = ()=>{ setTimeout(render,0); return Promise.resolve(); };
  remote = {
    db:"", ref:(db,pp)=>pp,
    set:(pp,v)=>{ const a=at(pp); if(a){ if(v===null) delete a[0][a[1]]; else a[0][a[1]]=v; } return later(); },
    update:(pp,obj)=>{ Object.keys(obj).forEach(k=>{ const a=at(pp+"/"+k);
        if(a){ if(obj[k]===null) delete a[0][a[1]]; else a[0][a[1]]=obj[k]; } }); return later(); },
    remove:(pp)=>{ const a=at(pp); if(a) delete a[0][a[1]]; return later(); },
    push:(pp,v)=>{
      if(String(pp)==="mail/queue"){ MAIL.push(v); return Promise.resolve(); }
      const a=at(pp+"/k"+Math.random().toString(36).slice(2,7)); if(a) a[0][a[1]]=v; return later(); },
    onValue:()=>()=>{}, off:()=>{},
    get:()=>Promise.resolve({exists:()=>false, val:()=>null})
  };

  window.__H = { get DATA(){return DATA}, get USER(){return USER}, get ME(){return ME},
                 get MAIL(){return MAIL}, forgetPreviousAccount,
                 get JOINED(){return JOINED}, get remote(){return remote}, watchGroup, forgetGroup,
                 balances, sharesOf, settlements, names, membersOf, meIn, render,
                 inGroupAlready, addFromDirectory, openGroup, sheetMembers,
                 get DIRECTORY(){return DIRECTORY}, get CURRENT(){return CURRENT},
                 setPush:(s)=>{ PUSH_STATE=s; render(); }, sheetPush,
                 durableRemote, updateBusy, syncConnected, manualRefresh,
                 get PENDING(){return PENDING}, get OUTBOX(){return OUTBOX} };

  setSync("warn","TEST HARNESS — in-memory only, nothing reaches the database");
  if(q.get("g")) openGroup(q.get("g")); else render();
})();
