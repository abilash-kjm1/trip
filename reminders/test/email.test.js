/* Provider selection and the setup-time error messages, with no network. */
import { provider } from "../lib/email.js";
let bad=0;
const is=(a,e,w)=>{ if(JSON.stringify(a)===JSON.stringify(e)) console.log("  ok   "+w);
  else { bad++; console.log("  FAIL "+w+"  expected "+JSON.stringify(e)+" got "+JSON.stringify(a)); } };
const clear=()=>{ delete process.env.BREVO_API_KEY; delete process.env.RESEND_API_KEY; delete process.env.EMAIL_PROVIDER; };

console.log("which provider gets used");
clear(); is(provider(), null, "neither key set -> none");
clear(); process.env.RESEND_API_KEY="re_x"; is(provider(), "resend", "only Resend set");
clear(); process.env.BREVO_API_KEY="xk_x";  is(provider(), "brevo",  "only Brevo set");
clear(); process.env.RESEND_API_KEY="re_x"; process.env.BREVO_API_KEY="xk_x";
is(provider(), "brevo", "both set -> Brevo wins, since it needs no domain");
clear(); process.env.RESEND_API_KEY="re_x"; process.env.BREVO_API_KEY="xk_x"; process.env.EMAIL_PROVIDER="resend";
is(provider(), "resend", "EMAIL_PROVIDER overrides");

console.log("\nsending with nothing configured");
clear();
const { sendEmail } = await import("../lib/email.js?fresh=" + Date.now());
try { await sendEmail({to:"a@b.c", subject:"x", html:"x", text:"x"}); is("no throw","throw","should refuse"); }
catch(e){ is(/set BREVO_API_KEY or RESEND_API_KEY/.test(e.message), true, "names both options"); }

console.log(bad? "\n"+bad+" FAILED" : "\nall passed");
process.exit(bad?1:0);
