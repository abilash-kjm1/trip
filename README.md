# Settle

A shared expense app for trips, flats and anything else people pay for
together. Everyone opens the same link, adds what they spent from their own
phone, and it syncs live across every device — no accounts, no installs.

## What it does

- **Groups** — one for each trip, flat, couple or one-off. Create as many as
  you like; invite people with a link or a short code.
- **Identity** — you tell the app your name once per device, so every screen
  can answer "what do *I* owe?" rather than just listing totals.
- **Four ways to split** — equally between the people you tick, exact amounts,
  percentages, or shares (2 shares pays twice what 1 does). The editor shows
  each person's figure as you type and refuses to save a split that does not
  add up.
- **Categories** — twelve of them, so the feed is readable at a glance.
- **Balances** — what everyone paid against their share, plus "settle up":
  the fewest payments that clear the whole group.
- **Record a payment** — when cash or a transfer actually changes hands, log
  it and the balances move.
- **Activity** — a running log per group and across all your groups.
- **Print / save as PDF** — a full statement: balances, settlements, every
  expense with its split, and every payment made.
- **Works offline** — it opens with no signal and syncs when signal returns.
- **Installable** — add it to your home screen and it runs like an app.

## How it is built

Static HTML with no build step. Live sync is Firebase Realtime Database with
anonymous auth; put your own project's values in `firebase-config.js`, which
also names the sheet that a first-time visitor joins.

Data lives under `trips/{groupId}` as `meta`, `people`, `expenses` and
`payments`. Your name and the list of groups you have joined stay on your own
device — they are never written to the database.

The theme is locked light (`color-scheme: light`, plus the same tokens
re-declared under `prefers-color-scheme: dark`) so a phone's dark mode cannot
invert it.
