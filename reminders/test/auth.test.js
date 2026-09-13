import handler from "../api/weekly-expense-reminder.js";
function mk(headers={}, method="GET", query={}){
  const res={code:null, body:null, headers:{},
    status(c){ this.code=c; return this; },
    json(b){ this.body=b; return this; },
    setHeader(k,v){ this.headers[k]=v; }};
  return [{method, headers, query}, res];
}
let fail=0;
const is=(a,e,w)=>{ if(JSON.stringify(a)===JSON.stringify(e)) console.log("  ok   "+w);
  else { fail++; console.log("  FAIL "+w+"  expected "+JSON.stringify(e)+" got "+JSON.stringify(a)); } };

console.log("with no CRON_SECRET configured on the server");
delete process.env.CRON_SECRET;
let [q,r]=mk(); await handler(q,r);
is(r.code, 500, "refuses to run rather than running unprotected");

process.env.CRON_SECRET="s3cr3t-test-value";

console.log("\nwithout the bearer token");
[q,r]=mk({}); await handler(q,r);
is(r.code, 401, "anonymous request is rejected");
is(r.body.ok, false, "and says so");

console.log("\nwith the wrong token");
[q,r]=mk({authorization:"Bearer wrong"}); await handler(q,r);
is(r.code, 401, "wrong secret is rejected");

console.log("\nwith a token that only shares a prefix");
[q,r]=mk({authorization:"Bearer s3cr3t"}); await handler(q,r);
is(r.code, 401, "prefix of the secret is rejected");

console.log("\nwrong method");
[q,r]=mk({authorization:"Bearer s3cr3t-test-value"},"DELETE"); await handler(q,r);
is(r.code, 405, "DELETE is refused");

console.log("\ncorrect token, but Firebase not configured");
delete process.env.FIREBASE_SERVICE_ACCOUNT;
[q,r]=mk({authorization:"Bearer s3cr3t-test-value"}); await handler(q,r);
is(r.code, 500, "fails closed with a server error");
is(/FIREBASE_SERVICE_ACCOUNT/.test(r.body.error||""), true, "names the missing variable");

console.log(fail? "\n"+fail+" FAILED" : "\nall passed");
process.exit(fail?1:0);
