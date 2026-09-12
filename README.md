# Expenses

A shared expense tracker. Everyone opens the same link, adds what they
spent from their own phone, and it syncs live across every device.

- Add people once from the PIN-protected admin panel, each with their own colour
- Log an expense: who paid, how much, and who it was split between
- Balances show what each person paid against their share, so the figure is checkable
- Tap a name for an itemised receipt, or a two-way statement with anyone else
- "Who owes whom" settles everyone up in the fewest payments
- Filter by text, by payer, or by how many ways an expense was split
- Print or save the whole record as a PDF
- Works offline; changes sync when signal returns

Static HTML with no build step. Live sync is Firebase Realtime Database;
put your own project's values in `firebase-config.js`, which also holds the
admin PIN and the id of the shared sheet.
