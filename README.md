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
- **Merging a duplicate** — if the same person ends up on the list twice, fold
  one into the other from the people list. The target may be a name that is
  only carried on the expenses and has no record of its own; in that case the
  record is renamed onto it rather than deleted, so the account and email
  survive and the orphaned name is absorbed. Everything they paid, owe or were
  split into moves across in one atomic write, a payment between the two
  halves is dropped as meaningless, and an equal split correctly loses the
  phantom head so the remaining people's shares go up.
- **Four ways to split** — equally between the people you tick, exact amounts,
  percentages, or shares (2 shares pays twice what 1 does). The editor shows
  each person's figure as you type and refuses to save a split that does not
  add up.
- **Categories** — twelve of them, so the feed is readable at a glance.
- **One page per group** — total spent, the add-expense form, the expense
  list, balances and the who-pays-whom chart all on a single scroll, the way
  the original tracker was laid out. The form sits on the page rather than
  behind a button, and survives somebody else's change syncing in mid-typing.
- **A capped list** — past six expenses the list scrolls inside itself rather
  than pushing the rest of the page away, with "Open full list" opening every
  expense on its own page.
- **Filters** — search the expenses, or narrow them to who paid, or to how
  many ways they were split. Each expense also names who it was split
  between rather than only counting them.
- **Balances** — what everyone paid against their share, and "who pays whom":
  the fewest payments that settle the whole group. Anyone carried on the
  expenses is listed, including a name that is no longer a member, so the
  figures always add up.
- **Record a payment** — when cash or a transfer actually changes hands, log
  it and the balances move. The amount follows the two people picked: it fills
  with the payment that clears them in the settle-up plan, or failing that
  with what is outstanding directly between the pair, and says which of the
  two it is. Typing over it stops it being overwritten. Tap it again in Activity to correct or delete it;
  a payment entered twice is otherwise invisible and doubles what someone
  appears to be owed.
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

The look is Liquid Glass, applied the way Apple specifies it. The rule that
governs everything: glass is the material of the **navigation layer only** —
the bar buttons, the tab bar, the floating action button, the sheet surface.
It floats above content and refracts the content passing beneath it. It is
never applied to content itself: lists, rows, cards, tiles, fields or text.
And glass is never nested in glass, so the controls inside a glass sheet are
solid, and the bar buttons flatten the moment the bar itself turns to glass.

Content is therefore an ordinary opaque iOS grouped list — white cards on a
grey ground, hairline separators inset to the text. That contrast is the whole
point: glass reads as glass only because there is something solid underneath
for it to bend.

The glass itself is two pseudo-elements on a `.glass` class. `::before` is a
gradient ring masked to the border alone, so the edge reads as the *thickness*
of the material catching light from one side; `::after` is the specular sweep
across the curved surface. The fill is around 42% white and stays legible
because the backdrop filter lifts what is behind it rather than painting over
it.

Accessibility is part of the spec, not an afterthought: `prefers-reduced-
transparency` turns every glass surface opaque, `prefers-contrast: more`
darkens the label hierarchy and thickens separators, and an `@supports` block
covers browsers with no `backdrop-filter` at all.

Wording is the original tracker's, verbatim — "is owed" and "owes", "Green is
owed money back. Red still owes.", "Who owes whom", "All square - nobody owes
anybody." Tapping a name opens the itemised receipt: what they paid out, what
their share came to with the division spelled out, any payments, and the
subtraction that produces the balance. Picking another name turns it into a
two-way statement between the pair.

The theme is locked light (`color-scheme: light`, plus the same tokens
re-declared under `prefers-color-scheme: dark`) so a phone's dark mode cannot
invert it.
