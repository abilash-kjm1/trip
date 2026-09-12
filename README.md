# Settle

A shared expense app for trips, flats and anything else people pay for
together. Everyone opens the same link, adds what they spent from their own
phone, and it syncs live across every device. Everyone signs in with their
own Google account.

## What it does

- **Groups** — one for each trip, flat, couple or one-off. Create as many as
  you like; invite people with a link or a short code.
- **Google sign-in** — everyone signs in with their own Google account, so
  their groups follow them to any phone or laptop, and the app can always
  answer "what do *I* owe?" rather than just listing totals.
- **Your own groups** — you only see the groups you belong to. Which groups
  those are is stored against your account, not against the device.
- **Claiming your name** — a group keeps its own list of names. The first time
  you open one, you pick which name is yours and your account takes it over.
  Regulars can be pinned to a name in `PEOPLE_LINKS`, and are linked silently
  without being asked. Names can be changed afterwards, and an account can be
  released or moved to a different name, from the group's people list.
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

## Administration

One Google account is the administrator, named in `ADMIN_EMAIL` in
`firebase-config.js` **and** in the database rules. It can list every group in
the app, open any of them, remove any member, and delete a group outright.
Everyone else can only see and work in the groups they belong to, and can only
delete a group they created themselves.

Changing `ADMIN_EMAIL` on its own changes nothing that matters — the rules in
the Firebase console are what actually enforce it.

## Firebase setup

Three things have to be true in the Firebase console for this to work:

1. **Authentication → Sign-in method → Google: enabled.**
2. **Authentication → Settings → Authorised domains** includes the site's
   domain (and `localhost` for local work).
3. **Realtime Database → Rules** matches `database.rules.json` in this repo.
   Those rules are what confine each person to their own `users/{uid}` record
   and what grant the administrator a read over every group.

## How it is built

Static HTML with no build step. Sign-in is Firebase Authentication (Google);
live sync is Firebase Realtime Database. Put your own project's values in
`firebase-config.js`, which also names the administrator.

Data lives under `trips/{groupId}` as `meta`, `people`, `expenses` and
`payments`. A person in a group carries the `uid` and `email` of whoever
claimed that name. Each account's own list of groups lives at
`users/{uid}/groups`, which is why it follows you between devices; a cached
copy is kept in `localStorage` so the app still opens offline.

The look is claymorphism: every surface is an inflated shape built from one
wide coloured drop shadow, a pale highlight from the top-left, and a pair of
insets that round the edge over. Those four shadow recipes live as CSS
variables (`--sh-out`, `--sh-in`, `--sh-press`, `--sh-sunk`) and everything
else is assembled from them, so the whole feel can be retuned in one place.
Raised means tappable; sunken means an input or a value you cannot press.
Headings are centred throughout, including the app bar title, which sits dead
centre between a single button on each side.

The theme is locked light (`color-scheme: light`, plus the same tokens
re-declared under `prefers-color-scheme: dark`) so a phone's dark mode cannot
invert it.
