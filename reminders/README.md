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

## Activity notices

Three more switches on the Account screen - **New expenses**, **Expense
changes** and **Payments** - send a note when something happens rather than on
a timetable. They are off unless somebody turns them on.

The browser cannot send email: the mail key never leaves the server. So the app
writes a line to `mail/queue` saying what it did, and this endpoint drains that
queue on every pass. With the hourly (or quarter-hourly) caller in place, a
notice arrives within about fifteen minutes, and everything that happened in
that window reaches a person as one email rather than several.

The queued note says **what happened and never who to tell**. Recipients are
worked out here, from the group's own membership, so a note somebody tampered
with cannot reach anybody its author could not already reach. Before it is
acted on, the author must still be a member of the group the note names.

The rules make `mail/queue` write-only for the app - no client can read it,
overwrite an existing entry, or post under another account's uid:

```json
"mail": {
  "queue": {
    ".read": false,
    "$k": { ".write": "auth != null && !data.exists() && newData.child('actorUid').val() == auth.uid" }
  }
}
```

Notes older than 48 hours are discarded unread, and a run handles at most 300
of them, 40 lines per email, 120 emails. The queue is cleared whether or not
the mail got through: these describe something that has already happened and is
visible in the app, so a retry loop repeating the same failure every quarter of
an hour would be worse than one missed notice.

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
| `BREVO_API_KEY` *or* `RESEND_API_KEY` | one of them | See **Choosing a sender** below. |
| `EMAIL_PROVIDER` | no | `brevo` or `resend`, to force one when both keys are set. Otherwise Brevo wins. |
| `REMINDER_FROM` | no | e.g. `Settle <you@gmail.com>`. With Brevo this exact address must be verified under Senders; with Resend it must sit on a verified domain. |
| `APP_URL` | no | Link target in the email. Defaults to the GitHub Pages URL. |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Choosing a sender

The two differ in what they make you prove before they will mail anybody.

| | Brevo | Resend |
|---|---|---|
| Verifies | a single **email address** | a whole **domain** |
| Need a domain? | **no** | yes |
| Before that | sends to anyone | only to the account owner |
| Free tier | 300 a day | 100 a day, 3,000 a month |

**Without a domain, use Brevo.** Resend will accept the API call and then
refuse each recipient who is not the account holder, which looks like success
in the dashboard and silence in everyone's inbox.

Brevo setup, about five minutes:

1. brevo.com → sign up free
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender** — put in the
   address you want the mail to come from, e.g. your own Gmail
3. Click the link in the confirmation email that arrives at that address
4. **SMTP & API → API Keys → Generate a new API key**
5. In Vercel set `BREVO_API_KEY`, and `REMINDER_FROM` to that same verified
   address. Remove `RESEND_API_KEY` or leave it; Brevo takes precedence.

Switching later costs one environment variable and a redeploy. No code change.

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

## Timezones

Each account stores its own at `users/{uid}/prefs.tz`, defaulting to
`America/Toronto` and seeded from the browser on first sign-in. Somebody is
only emailed when it is **Sunday, late afternoon, on their own clock** — the
window is 16:00–20:00 local, adjustable with `SEND_HOUR_FROM` / `SEND_HOUR_TO`.

It is a window rather than an exact hour because the schedule is fixed in UTC
and the clocks move. `0 21 * * 0` is 17:00 in Toronto on EDT but **16:00 once
EST begins**, so testing for exactly 17:00 would have gone silent every
November. The window covers both, and the `lastWeekly` stamp means a wider
window still cannot produce more than one email a week.

Everyone in this group is in Canada, so with the single daily firing:

| Zone | When it arrives (EDT) | (EST) |
|---|---|---|
| Toronto / Montreal | 17:00 | 16:00 |
| Halifax | 18:00 | 17:00 |
| Winnipeg | 16:00 | 15:00 — outside the window, see below |
| Vancouver | 14:00 — outside the window | 13:00 — outside |

Ontario, Quebec and the Maritimes are covered. If somebody joins from further
west, widen the window (`SEND_HOUR_FROM=13`) or move to hourly: the endpoint is
already written for it, so changing the schedule to `0 * * * *` is the only
edit. That needs either a Vercel plan allowing hourly crons or a free external
pinger such as cron-job.org hitting the same URL with the same bearer token.

## Running it hourly

The schedule is set in the app (Account → Administration → Reminder schedule),
but the endpoint can only act when something calls it. **Vercel Hobby fires a
cron once a day**, so out of the box only a window that happens to cover that
one firing will ever send. Any other chosen hour goes unnoticed.

Calling it every hour fixes that, and costs nothing:

1. **cron-job.org** → sign up free
2. **Create cronjob**
3. **URL**: `https://YOUR-PROJECT.vercel.app/api/weekly-expense-reminder`
4. **Schedule**: Every hour, at minute 0
5. **Advanced → Headers**, add one:
   * name `Authorization`
   * value `Bearer YOUR_CRON_SECRET`
6. Save and enable

Leave the Vercel cron in `vercel.json` as it is. Two callers are harmless: the
`lastWeekly` stamp means the second one finds nothing to do, and it is a free
backstop if cron-job.org ever misses a run.

With hourly calls the window can be narrowed to one or two hours and a chosen
time means what it says, daylight saving included.

### What an hourly call actually costs

Nearly nothing, because the run does as little as possible before ruling
itself out:

| Every run | Reads `config/reminders`, a few bytes |
| Most runs | Reads `users` to see if anybody is due, then stops |
| The one run that sends | Also reads `trips`, then emails |

So 720 calls a month, of which roughly four touch the expenses at all.

## Cost

| | Free tier | What this uses |
|---|---|---|
| Brevo | **300 emails a day** (~9,000/month) | 4 a week - about 1% of a single day's allowance |
| Vercel Hobby | 100,000 function calls a month | 720 if run hourly |
| cron-job.org | unlimited jobs | 1 |
| Firebase RTDB | 10 GB download a month | a few MB |

The email allowance is the one people worry about, and it is the one with the
most room: at four people on a weekly schedule you would need about seventy
times as many people before a daily limit of 300 came into view.

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
* Activity notices are the one thing a user can set in motion, and all they can
  do is add a line to `mail/queue`. They cannot name the recipients, cannot
  read the queue, cannot post as somebody else, and cannot reach a group they
  do not belong to. Sending still happens only on the cron's own schedule,
  behind `CRON_SECRET`.
