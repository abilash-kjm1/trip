/* ---------------------------------------------------------------------------
   Joining Settle.

   Signing in with Google gets somebody an account, not access. A first-time
   visitor asks to join; the administrator approves or declines from a link in
   their email; the answer goes back to the person who asked.

   The link has to work from a tap in a mail app, with no sign-in, so it
   carries a signed token rather than a session. The token proves only one
   thing - that this request was posted by whoever received the email - and it
   expires. Crucially the link itself does nothing: it opens a page with two
   buttons, and the decision is a POST. Mail scanners and link previewers
   follow links; they do not submit forms.
   --------------------------------------------------------------------------- */
import { createHmac, timingSafeEqual } from "node:crypto";

export const STATUSES = ["pending", "approved", "declined"];
export const TOKEN_TTL_MS = 14 * 24 * 3600 * 1000;   // a fortnight to decide

const b64url = (buf) => Buffer.from(buf).toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

/* The token is signed with CRON_SECRET rather than a key of its own, so
   there is one secret to look after instead of two. The prefix keeps a token
   from ever being mistaken for the bearer value the cron sends. */
function sign(payload, secret) {
  return b64url(createHmac("sha256", String(secret)).update("settle-access:" + payload).digest());
}

/** A token authorising a decision about one person's request. */
export function makeToken(uid, secret, now = Date.now()) {
  if (!uid || !secret) throw new Error("makeToken needs a uid and a secret");
  const payload = b64url(JSON.stringify({ u: String(uid), e: now + TOKEN_TTL_MS }));
  return payload + "." + sign(payload, secret);
}

/** The uid a token authorises, or null. Never throws on rubbish input. */
export function readToken(token, secret, now = Date.now()) {
  if (typeof token !== "string" || !secret) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;

  const payload = token.slice(0, dot);
  const given = token.slice(dot + 1);
  const want = sign(payload, secret);

  // Compared byte by byte in constant time, so a wrong token cannot be
  // narrowed down by how long it takes to reject.
  const a = Buffer.from(given), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let claim;
  try { claim = JSON.parse(unb64url(payload).toString("utf8")); } catch { return null; }
  if (!claim || typeof claim.u !== "string" || !claim.u) return null;
  if (!Number.isFinite(claim.e) || claim.e < now) return null;
  return claim.u;
}

/** What the database holds about somebody, made safe to act on. */
export function normaliseAccess(raw) {
  const r = (raw && typeof raw === "object") ? raw : {};
  const status = STATUSES.indexOf(r.status) > -1 ? r.status : null;
  return {
    status,
    email: typeof r.email === "string" ? r.email.trim().toLowerCase().slice(0, 320) : "",
    name:  typeof r.name === "string" ? r.name.trim().slice(0, 120) : "",
    at: Number(r.at) || 0,
    decidedAt: Number(r.decidedAt) || 0,
    decidedBy: typeof r.decidedBy === "string" ? r.decidedBy.slice(0, 320) : ""
  };
}

export const isApproved = (raw) => normaliseAccess(raw).status === "approved";

/* ---------------------------------------------------------------------------
   The page the administrator lands on. Kept here rather than in the endpoint
   so the wording and the markup can be checked without a database, a mail
   account or a deployment.
   --------------------------------------------------------------------------- */
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function accessPage(title, bodyHtml) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — Settle</title>
<style>
  :root{ color-scheme:light; --ink:#111318; --soft:#5b6270; --line:#e4e6ec; --bg:#f2f2f7; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);min-height:100vh;display:flex;
       align-items:center;justify-content:center;padding:24px;
       font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
  .card{background:#fff;border-radius:18px;padding:28px 26px;max-width:460px;width:100%;
        box-shadow:0 1px 3px rgba(0,0,0,.06)}
  h1{margin:0 0 6px;font-size:24px;line-height:1.2}
  p{margin:12px 0 0;color:var(--soft)}
  dl{margin:20px 0 0;display:grid;grid-template-columns:auto 1fr;gap:9px 16px;font-size:15px}
  dt{color:var(--soft)} dd{margin:0;font-weight:600;overflow-wrap:anywhere}
  form{margin:26px 0 0;display:flex;gap:10px;flex-wrap:wrap}
  button{font:inherit;font-weight:600;padding:13px 22px;border-radius:12px;border:0;cursor:pointer;flex:1 1 130px}
  .yes{background:#34c759;color:#fff}
  .no{background:#fff;color:#c9271e;border:1px solid var(--line)}
  .fine{margin:20px 0 0;font-size:13px}
</style>
</head><body><div class="card">${bodyHtml}</div></body></html>`;
}

/** The request itself, with the two buttons. */
export function decisionPage(record, token) {
  const who = esc(record.name || record.email || "Somebody");
  return accessPage("Request to join",
    `<h1>${who} wants to join Settle</h1>
     <dl>
       <dt>Name</dt><dd>${esc(record.name || "not given")}</dd>
       <dt>Google account</dt><dd>${esc(record.email || "not known")}</dd>
     </dl>
     <form method="POST" action="/api/access">
       <input type="hidden" name="t" value="${esc(token)}">
       <button class="yes" name="decision" value="approve" type="submit">Approve</button>
       <button class="no" name="decision" value="decline" type="submit">Decline</button>
     </form>
     <p class="fine">Approving lets them see the groups they are added to, start
        groups of their own, and add expenses. They will never be able to change
        or delete anybody else's entries.</p>`);
}

/** What they see afterwards. */
export function outcomePage(record, approved, note) {
  const who = esc(record.name || record.email || "Somebody");
  return accessPage(approved ? "Approved" : "Declined",
    `<h1>${who} was ${approved ? "approved" : "declined"}</h1>
     <p>${note}</p>
     <p class="fine">You can change this in the app under Account &rarr; Requests.</p>`);
}

export { esc as escapeHtml };
