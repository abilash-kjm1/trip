/* ===========================================================================
   /api/access?t=<token>

   The page the administrator lands on from the email. GET shows the request
   and two buttons; POST records the decision and writes back to the person who
   asked.

   The split matters. Mail apps, security scanners and link previewers fetch
   links to see what is behind them, and a link that approved somebody just by
   being fetched would approve people nobody ever looked at. Nothing here
   changes until a form is submitted.

   The markup itself lives in lib/access.js, so the wording can be checked
   without a database, a mail account or a deployment.
   =========================================================================== */
import { readPath, database } from "../lib/firebase.js";
import { sendEmail } from "../lib/email.js";
import { accessDecisionEmail } from "../lib/template.js";
import { readToken, normaliseAccess, accessPage, decisionPage, outcomePage,
         escapeHtml as esc } from "../lib/access.js";

const APP_URL = process.env.APP_URL || "https://abilash-kjm1.github.io/trip/";

const html = (res, code, body) =>
  res.status(code).setHeader("Content-Type", "text/html; charset=utf-8").send(body);

const plain = (res, code, title, body) => html(res, code, accessPage(title, body));

export default async function handler(req, res) {
  const method = req.method === "POST" ? "POST" : "GET";
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[access] CRON_SECRET is not set; refusing to decide anything");
    return plain(res, 500, "Not configured",
      `<h1>Not configured</h1><p>CRON_SECRET is missing on the server, so this link cannot be checked.</p>`);
  }

  const token = String((req.query && (req.query.t || req.query.token)) ||
                       (req.body && req.body.t) || "");
  const uid = readToken(token, secret);
  if (!uid) {
    // Deliberately vague: a bad token and an expired one look the same from
    // outside, and neither says whether the person exists.
    return plain(res, 400, "Link not usable",
      `<h1>This link is no longer usable</h1>
       <p>It may have expired, or been altered on the way. Open Settle and decide
          under Account &rarr; Requests instead.</p>`);
  }

  try {
    const record = normaliseAccess(await readPath("access/" + uid));
    const who = esc(record.name || record.email || "Somebody");

    if (!record.status) {
      return plain(res, 404, "Nothing to decide",
        `<h1>Nothing to decide</h1><p>There is no request here any more.</p>`);
    }

    // Already settled. Idempotent on purpose: a forwarded link, a double tap
    // or a reloaded page must not flip a decision or send a second email.
    if (record.status !== "pending") {
      const word = record.status === "approved" ? "approved" : "declined";
      return plain(res, 200, "Already decided",
        `<h1>${who} was already ${word}</h1>
         <p>Nothing has changed. You can undo this in the app under
            Account &rarr; Requests.</p>`);
    }

    if (method === "GET") return html(res, 200, decisionPage(record, token));

    const decision = String((req.body && req.body.decision) ||
                            (req.query && req.query.decision) || "");
    if (decision !== "approve" && decision !== "decline") {
      return plain(res, 400, "No decision",
        `<h1>No decision was sent</h1><p>Open the link again and press one of the buttons.</p>`);
    }
    const approved = decision === "approve";

    await database().ref("access/" + uid).update({
      status: approved ? "approved" : "declined",
      decidedAt: Date.now(),
      decidedBy: process.env.ADMIN_EMAIL || "administrator"
    });
    console.log("[access]", uid, approved ? "approved" : "declined");

    // Telling them is the point of the exercise, but a mail failure must not
    // undo a decision that is already recorded.
    let note = "They have been told by email.";
    try {
      if (record.email) {
        await sendEmail({
          to: record.email,
          ...accessDecisionEmail({ name: record.name || record.email.split("@")[0],
                                   approved, appUrl: APP_URL })
        });
      } else {
        note = "There was no email address on the request, so nobody could be told.";
      }
    } catch (err) {
      note = "The decision is saved, but the email could not be sent: " +
             esc(((err && err.message) || String(err)).slice(0, 300));
      console.error("[access] could not tell", uid, err);
    }

    return html(res, 200, outcomePage(record, approved, note));
  } catch (err) {
    const msg = (err && err.message) || String(err);
    console.error("[access] aborted:", msg);
    return plain(res, 500, "Something went wrong",
      `<h1>Something went wrong</h1><p>${esc(msg.slice(0, 300))}</p>`);
  }
}
