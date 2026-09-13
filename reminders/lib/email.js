/* ---------------------------------------------------------------------------
   Sending, over plain fetch. No SDK for either provider: one HTTP call is not
   worth a dependency, and fewer dependencies is fewer things to go stale.

   Two providers, because they have different entry costs:

     brevo   verifies a single SENDER ADDRESS. No domain needed, so it can
             mail anybody from day one. Free tier is 300 a day.
     resend  only mails the account owner until a DOMAIN is verified. Better
             once you own one; useless for a group of friends before that.

   Whichever key is present is the one used, so switching later is a matter of
   swapping an environment variable and redeploying. Neither key is ever read
   anywhere but here, on the server.
   --------------------------------------------------------------------------- */

/** "Name <a@b.c>" or "a@b.c" -> { name, email } */
function parseFrom(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) return { name: m[1] || "Settle", email: m[2] };
  return { name: "Settle", email: s };
}

export function provider() {
  const forced = String(process.env.EMAIL_PROVIDER || "").toLowerCase();
  if (forced === "brevo" || forced === "resend") return forced;
  if (process.env.BREVO_API_KEY) return "brevo";
  if (process.env.RESEND_API_KEY) return "resend";
  return null;
}

async function sendViaResend({ to, subject, html, text, from }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, text })
  });
  const body = await res.text();
  if (!res.ok) throw new Error(explain("Resend", res.status, body));
  try { return JSON.parse(body); } catch { return { id: null }; }
}

async function sendViaBrevo({ to, subject, html, text, from }) {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error("BREVO_API_KEY is not set");
  const sender = parseFrom(from);
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender,
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text
    })
  });
  const body = await res.text();
  if (!res.ok) throw new Error(explain("Brevo", res.status, body));
  try { return { id: (JSON.parse(body) || {}).messageId || null }; } catch { return { id: null }; }
}

/* The two rejections that actually happen during setup, said in words rather
   than passed through as a raw provider payload. */
function explain(name, status, body) {
  const b = String(body || "");
  if (name === "Resend" && /only send testing emails to your own/i.test(b)) {
    const m = b.match(/\(([^)]+)\)/);
    return "Resend will only deliver to the account owner" +
      (m ? " (" + m[1] + ")" : "") +
      " until a domain is verified. For a group, use Brevo instead: it verifies a " +
      "single sender address and needs no domain. Set BREVO_API_KEY.";
  }
  if (name === "Brevo" && /sender|not valid|unrecognised|unrecognized/i.test(b) && status === 400) {
    return "Brevo does not recognise the sender address in REMINDER_FROM. " +
      "Verify that exact address under Senders, Domains & Dedicated IPs -> Senders.";
  }
  return name + " " + status + ": " + b.slice(0, 300);
}

export async function sendEmail({ to, subject, html, text }) {
  const from = process.env.REMINDER_FROM || "Settle <onboarding@resend.dev>";
  const p = provider();
  if (!p) throw new Error("No email provider configured: set BREVO_API_KEY or RESEND_API_KEY");
  return p === "brevo"
    ? sendViaBrevo({ to, subject, html, text, from })
    : sendViaResend({ to, subject, html, text, from });
}
