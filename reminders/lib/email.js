/* ---------------------------------------------------------------------------
   Resend, over plain fetch. No SDK: one HTTP call is not worth a dependency,
   and fewer dependencies is fewer things that can go stale on a free plan.

   RESEND_API_KEY is read here and nowhere else, and this file only ever runs
   on the server.
   --------------------------------------------------------------------------- */

export async function sendEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");

  const from = process.env.REMINDER_FROM || "Settle <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from, to: [to], subject, html, text })
  });

  const body = await res.text();
  if (!res.ok) {
    // Surface Resend's own message; it is usually specific and actionable.
    throw new Error("Resend " + res.status + ": " + body.slice(0, 300));
  }
  try { return JSON.parse(body); } catch { return { id: null }; }
}
