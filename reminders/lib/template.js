/* ---------------------------------------------------------------------------
   The reminder email. Inline styles only, tables for layout, no external
   images or webfonts - the things mail clients actually strip.
   --------------------------------------------------------------------------- */
import { money } from "./ledger.js";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const GREEN = "#1e7b34";
const RED = "#c9271e";
const INK = "#111318";
const SOFT = "#5b6270";
const LINE = "#e4e6ec";

function row(left, right, colour) {
  return `<tr>
    <td style="padding:9px 0;border-bottom:1px solid ${LINE};color:${INK};font-size:15px">${left}</td>
    <td style="padding:9px 0;border-bottom:1px solid ${LINE};color:${colour || INK};font-size:15px;text-align:right;white-space:nowrap;font-weight:600">${right}</td>
  </tr>`;
}

function section(title, rowsHtml) {
  if (!rowsHtml) return "";
  return `
  <p style="margin:26px 0 6px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${SOFT}">${esc(title)}</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rowsHtml}</table>`;
}

/**
 * @param {object} p
 * @param {string} p.name      display name
 * @param {number} p.owe       total they owe, positive
 * @param {number} p.owed      total owed to them, positive
 * @param {Array}  p.groups    groupSummary() results
 * @param {string} p.appUrl
 */
export function reminderEmail({ name, owe, owed, groups, appUrl }) {
  const net = owed - owe;
  const headline = Math.abs(net) < 0.005
    ? "You are all square"
    : net > 0 ? `You are owed ${money(net)}` : `You owe ${money(-net)}`;
  const headColour = Math.abs(net) < 0.005 ? SOFT : (net > 0 ? GREEN : RED);

  // Who to pay, gathered across every group. This is the part somebody acts
  // on, so it goes first rather than under a list of expenses.
  const toPay = [], toGet = [];
  groups.forEach((g) => {
    (g.plan || []).forEach((t) => {
      const entry = { who: t.from === g.me ? t.to : t.from, amt: t.amt, group: g.group };
      (t.from === g.me ? toPay : toGet).push(entry);
    });
  });
  // The group is always named, even with only one of them. Somebody reading
  // this on a phone should not have to remember which ledger it refers to.
  function person(x, colour) {
    return `<tr>
      <td style="padding:13px 0;border-bottom:1px solid ${LINE}">
        <span style="font-size:17px;font-weight:600;color:${INK}">${esc(x.who)}</span>
        <br><span style="color:${SOFT};font-size:13px">in ${esc(x.group)}</span>
      </td>
      <td style="padding:13px 0;border-bottom:1px solid ${LINE};text-align:right;white-space:nowrap">
        <span style="font-size:20px;font-weight:700;color:${colour}">${money(x.amt)}</span>
      </td>
    </tr>`;
  }

  let body = "";

  if (toPay.length) {
    body += section("Pay these people", toPay.map((x) => person(x, RED)).join(""));
  }
  if (toGet.length) {
    body += section("These people owe you", toGet.map((x) => person(x, GREEN)).join(""));
  }
  if (!toPay.length && !toGet.length) {
    body += section("Settling up", row("Nobody owes anybody", "settled", SOFT));
  }

  body += section("Totals",
    row("Total you owe", money(owe), owe > 0.004 ? RED : SOFT) +
    row("Total owed to you", money(owed), owed > 0.004 ? GREEN : SOFT)
  );

  groups.forEach((g) => {
    let rows = "";
    g.owes.forEach((x) => {
      rows += row(
        `${esc(x.desc)}<br><span style="color:${SOFT};font-size:13px">${esc(x.payer)} paid ${money(x.amount)}</span>`,
        `${money(x.share)}<br><span style="color:${SOFT};font-size:12px;font-weight:400">your share</span>`,
        RED
      );
    });
    g.lent.forEach((x) => {
      rows += row(
        `${esc(x.desc)}<br><span style="color:${SOFT};font-size:13px">you paid ${money(x.amount)}</span>`,
        `${money(x.out)}<br><span style="color:${SOFT};font-size:12px;font-weight:400">still out</span>`,
        GREEN
      );
    });

    const label = `${g.group} — ${Math.abs(g.net) < 0.005 ? "settled"
      : g.net > 0 ? `you are owed ${money(g.net)}` : `you owe ${money(-g.net)}`}`;

    body += section(label, rows);
  });

  const html = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(headline)}</title>
</head><body style="margin:0;padding:0;background:#f2f2f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f7;padding:24px 12px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width:560px;background:#ffffff;border-radius:18px;padding:28px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <tr><td>
      <p style="margin:0 0 4px;font-size:14px;color:${SOFT}">Sunday round-up</p>
      <h1 style="margin:0 0 2px;font-size:26px;line-height:1.2;color:${INK}">Hello ${esc(name)},</h1>
      <p style="margin:10px 0 0;font-size:22px;font-weight:700;color:${headColour}">${headline}</p>
      ${body}
      <p style="margin:30px 0 0">
        <a href="${esc(appUrl)}" style="display:inline-block;background:#34c759;color:#ffffff;text-decoration:none;
           font-size:16px;font-weight:600;padding:13px 24px;border-radius:12px">Open Settle</a>
      </p>
      <p style="margin:26px 0 0;font-size:12px;color:${SOFT};line-height:1.5">
        You are getting this because the Sunday reminder is switched on for your account.
        Turn it off in the app under Account &rarr; Notifications.
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  // A plain-text alternative, for clients that refuse HTML.
  let t = `Hello ${name},\n\n${headline}\n`;
  if (toPay.length) {
    t += `\nPAY THESE PEOPLE\n`;
    toPay.forEach((x) => { t += `  ${x.who} in ${x.group}: ${money(x.amt)}\n`; });
  }
  if (toGet.length) {
    t += `\nTHESE PEOPLE OWE YOU\n`;
    toGet.forEach((x) => { t += `  ${x.who} in ${x.group}: ${money(x.amt)}\n`; });
  }
  t += `\nTotal you owe: ${money(owe)}\nTotal owed to you: ${money(owed)}\n`;
  groups.forEach((g) => {
    t += `\n${g.group}\n`;
    g.owes.forEach((x) => { t += `  ${x.desc} — ${x.payer} paid ${money(x.amount)}, your share ${money(x.share)}\n`; });
    g.lent.forEach((x) => { t += `  ${x.desc} — you paid ${money(x.amount)}, ${money(x.out)} still out\n`; });
  });
  t += `\nOpen Settle: ${appUrl}\nTurn this off under Account > Notifications.\n`;

  const subject = Math.abs(net) < 0.005
    ? "Your weekly expenses round-up"
    : net > 0 ? `You are owed ${money(net)}` : `You owe ${money(-net)}`;

  return { subject, html, text: t };
}

/* ---------------------------------------------------------------------------
   The activity notice: what has happened in your groups since we last looked.

   Quieter than the weekly round-up on purpose. It carries no balances - those
   are one tap away in the app, and recomputing them here would put a number in
   somebody's inbox that is already out of date by the time they read it.
   --------------------------------------------------------------------------- */
export function activityEmail({ name, groups, appUrl }) {
  const count = groups.reduce((n, g) => n + g.lines.length, 0);
  const one = count === 1;

  const headline = one
    ? "One update in " + groups[0].group
    : count + " updates" + (groups.length === 1 ? " in " + groups[0].group : "");

  let body = "";
  groups.forEach((g) => {
    const rows = g.lines.map((line) => `<tr>
      <td style="padding:11px 0;border-bottom:1px solid ${LINE};color:${INK};font-size:15px;line-height:1.45">${esc(line)}</td>
    </tr>`).join("");
    body += section(g.group, rows);
  });

  const html = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(headline)}</title>
</head><body style="margin:0;padding:0;background:#f2f2f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f7;padding:24px 12px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width:560px;background:#ffffff;border-radius:18px;padding:28px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <tr><td>
      <p style="margin:0 0 4px;font-size:14px;color:${SOFT}">Activity</p>
      <h1 style="margin:0 0 2px;font-size:26px;line-height:1.2;color:${INK}">Hello ${esc(name)},</h1>
      <p style="margin:10px 0 0;font-size:20px;font-weight:700;color:${INK}">${esc(headline)}</p>
      ${body}
      <p style="margin:30px 0 0">
        <a href="${esc(appUrl)}" style="display:inline-block;background:#34c759;color:#ffffff;text-decoration:none;
           font-size:16px;font-weight:600;padding:13px 24px;border-radius:12px">Open Settle</a>
      </p>
      <p style="margin:26px 0 0;font-size:12px;color:${SOFT};line-height:1.5">
        You are getting this because activity notices are switched on for your account.
        Turn them off in the app under Account &rarr; Notifications.
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  let t = `Hello ${name},\n\n${headline}\n`;
  groups.forEach((g) => {
    t += `\n${g.group.toUpperCase()}\n`;
    g.lines.forEach((line) => { t += `  ${line}\n`; });
  });
  t += `\nOpen Settle: ${appUrl}\nTurn these off under Account > Notifications.\n`;

  return { subject: headline, html, text: t };
}
