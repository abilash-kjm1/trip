# Weekly expense reminders

A single Vercel Cron job that, every Sunday, emails each person a round-up of
what they owe and what they are owed. Nothing is sent to somebody who is square.

## How this fits the rest of the app

The app itself is a static page on GitHub Pages with no server, and its data
lives in **Firebase Realtime Database**. So this folder is a *separate, tiny*
Vercel project that reads the same database with a service account and sends
through Resend. The app does not move and nothing about it changes except the
settings screen.

There is no Supabase here. Adding one would mean two databases holding the same
expenses and a sync problem between them, which is a worse outcome than reusing
what already works.

```
  GitHub Pages  ──►  Firebase Realtime Database  ◄──  Vercel Cron (this folder)
   the app                the only store                 reads, then emails
                                                              │
                                                           Resend
```

## What it sends

For each account with the Sunday reminder on, it walks the groups that account
belongs to and works out, per group:

* their net position,
* every line where they carry a share of something somebody else paid for —
  description, the full amount, and their share,
* every line they paid that other people still owe on,
* the settling-up payments that involve them.

If the totals come to nothing, no email goes out.

## The arithmetic

`lib/ledger.js` is a deliberate port of the app's own split maths — all four
modes (equal, exact, percent, shares) plus recorded payments. If the two ever
drift, somebody gets an email contradicting what the app shows them, which is
worse than silence. `npm test` pins it:

```
cd reminders
npm install
npm test          # 17 assertions, including balances that must sum to zero
node test/preview.js   # renders test/preview.html and checks the timezone gate
```

## Environment variables

All are set in **Vercel → Project → Settings → Environment Variables**. None of
them are ever read by the browser.

| Variable | Required | What it is |
|---|---|---|
| `CRON_SECRET` | yes | Any long random string. Vercel sends it as a bearer token on scheduled runs; the endpoint answers `401` without it. This is what stops anybody on the internet triggering a mass send. |
| `FIREBASE_SERVICE_ACCOUNT` | yes | The whole service-account JSON, pasted as one line. Firebase Console → Project settings → Service accounts → **Generate new private key**. |
| `FIREBASE_DATABASE_URL` | yes | `https://trip-expense-35c6d-default-rtdb.firebaseio.com` |
| `RESEND_API_KEY` | yes | From resend.com → API Keys. Sending permission is enough. |
| `REMINDER_FROM` | no | e.g. `Settle <reminders@yourdomain.com>`. Defaults to `Settle <onboarding@resend.dev>`, which Resend allows **only to your own address** until you verify a domain. |
| `APP_URL` | no | Link target in the email. Defaults to the GitHub Pages URL. |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Deploying

```bash
cd reminders
npx vercel            # first run links the project
npx vercel --prod
```

Set the **Root Directory** to `reminders` if you deploy from the repo rather
than from inside the folder, otherwise Vercel will not find `api/`.

Then add the environment variables above and redeploy so they take effect.

## Checking it works

Dry run — works out who is due and what they would get, sends nothing:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://YOUR-PROJECT.vercel.app/api/weekly-expense-reminder?dry=1&force=1"
```

Send for real, ignoring the day-and-hour gate:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://YOUR-PROJECT.vercel.app/api/weekly-expense-reminder?force=1"
```

Without the header you should get `401`. That is the check that matters.

The response is a summary: `{ ok, ms, considered, due, skippedNothingOwing,
sent, failed, errors }`. Failures are per-account and never stop the run.

## Timezones, and an honest limit

Each account stores its own timezone at `users/{uid}/prefs.tz`, defaulting to
`America/Toronto` (the app fills in the browser's own zone on first sign-in).
The endpoint only emails somebody when it is **Sunday, in the 17:00 hour, on
their clock** — so the logic is per-person, not per-server.

The schedule in `vercel.json` is `0 21 * * 0`, which is 17:00 in Toronto during
EDT. **On the Vercel Hobby plan a cron can only fire once a day**, so that one
firing is the only chance anyone gets. In practice:

* Toronto accounts get it at 17:00 as intended (16:00 once EST starts in
  November — change the schedule to `0 22 * * 0` then, or leave it).
* Accounts in other zones will not be in their 17:00 hour at that moment, so
  they are skipped.

To serve every timezone properly the endpoint needs to run hourly. It is
already written for that — change the schedule to `0 * * * *`, and the
`lastWeekly` stamp keeps anybody from being emailed twice in a week. That needs
either a Vercel plan that allows hourly crons, or a free external pinger such
as cron-job.org hitting the same URL with the same bearer token.

## Cost

Designed to sit inside the free tiers: one cron job, two database reads per
run regardless of how many people there are, and one Resend call per person who
actually owes something. Resend's free tier is 100 emails a day, 3,000 a month.

## Security notes

* `RESEND_API_KEY` and the service account are read only inside `lib/`, which
  only ever runs on Vercel. Nothing here is bundled into the page.
* The endpoint requires `CRON_SECRET` on every request, including `force`
  and `dry`. There is no unauthenticated path that sends anything.
* Records out of the database are validated before use: amounts are coerced
  with `Number()`, missing arrays fall back, a malformed expense contributes
  zero rather than `NaN`, and an address is only used if it looks like an
  address.
* Groups are only read through the account's own `users/{uid}/groups` list, so
  a reminder can never quote a group the recipient is not in.
