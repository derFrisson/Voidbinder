# 0005: Sync protocol for the collection and decks

- Status: Accepted, with the deletion-log amendment (VB-75, Max, 2026-10-10: "delete means
  delete")
- Raised by: VB-32 (Sprint 3), 2026-10-10

## Context

Collectors edit their collection where there is no signal: at a card shop, at a tournament, on a
train. The native app (Expo, ADR 0001) keeps a local copy and writes there first; the server has
to take those edits later, from several devices, without losing any. The tables were shaped for
this in Sprint 2 (VB-31, VB-34): every row has a client-generated `id` and an `updated_at`. They
also had a `deleted_at` tombstone, so a deleted row stayed in the table to be synced; VB-75
replaced that with a hard delete and a deletion log (below): a deleted binder, entry, wish or deck
is gone from the database at once. The REST routes write the same tables and must keep working
next to the sync.

What was missing: a way to ask "what changed since I last looked" that cannot skip a row, and a
rule for two devices editing the same row.

## Decision

One endpoint pair under `/sync`, signed in (`requireUser`), user-scoped, Zod-validated
(`packages/shared/src/api/sync.ts`); the pure rules live in `packages/core/src/sync` so the
native client runs the same code.

- **Cursor.** A global sequence `sync_seq`. A trigger on `binders`, `collection_entries`,
  `wishlist_entries`, `decks` and `deck_entries` stamps the next value on every insert and update,
  whoever writes (REST or sync). `GET /sync/pull?since=&limit=` answers the user's rows and
  deletions with `sync_seq > since`, the lowest first across the tables, pages of at most 500,
  and the next cursor. Never the wall clock: clocks of devices and pods disagree, the sequence
  does not.
- **Deletes (VB-75).** A delete, REST or pushed, removes the row in the same transaction that
  writes `(user_id, table, id)` to `sync_deletions`, with no content (a deck's entries go with
  the deck, only the deck is logged; a deleted binder's entries move out of it, as before). The
  log row takes its `sync_seq` from the same trigger, under the same lock, so a pull hands it out
  in order with the rows: the answer's `deletions` (`[{ table, id }]`), counted in the page's
  budget. A device applies a page's `deletions` before its rows (a row on the server is newer
  than any deletion of its id). The log keeps `deleted_at` (the delete's time, a device's clock
  for a pushed delete) and `logged_at` (when the server wrote it).
- **Retention and resync.** A daily sweep (the Scryfall cron of each environment) removes log
  rows whose `logged_at` is older than `SYNC_DELETION_RETENTION_DAYS` (30, in
  `@voidbinder/shared/api`) less one day, so that with a daily run none outlives 30 days, in batches, and keeps the highest `sync_seq` it removed as the
  horizon (`app_meta.sync_deletions_horizon`). A pull whose cursor is below the horizon may have
  missed a deletion that is gone: it answers 409 `resync_required`, and the device drops its
  local copy and pulls from 0. So that a device that is up to date is never sent there, the last
  page of a pull hands out the sequence's current value as its cursor (no write of the user is in
  flight under the pull's lock, so the next one numbers above it), and the pages of a full pull
  hand out their cursor negated, which skips the check (they walk through old rows, but the
  device holds nothing older). The cursor is opaque to the device: it sends back what it got.
- **No row behind the cursor.** A sequence hands out numbers in order but transactions commit in
  any order, so a pull could see number 11 committed while 10 is still in flight and move its
  cursor past 10 for good. The trigger therefore takes a shared per-user advisory lock (held to
  the end of the transaction) before it takes a number, and a pull takes the same lock
  exclusively: it waits for every write of that user in flight, and while it reads, no write of
  that user can take a number. Writers never block each other on this lock; a pull waits at
  most for the user's own open writes.
- **Push.** `POST /sync/push` takes `{ changes: [{ table, rows }] }`: full rows with `updatedAt`
  (the device's edit time), `deletedAt` to delete it and `baseUpdatedAt` (the `updatedAt` the
  device last pulled; null for a row it created). At most 500 rows, and at most 5000 deck
  entries (500 per deck), so one push cannot hold the user's lock for a quarter million writes;
  one transaction; applied in table order (binders before entries, decks before their lists). A
  deck's entries are its whole list and travel with the deck row, because the deck rules judge a
  list as a whole. Pushes of one user run one at a time (an exclusive per-user push lock), so a
  retry that overlaps its original waits for it and then finds its rows equal.
- **Conflict rule: last writer wins per row, the server's row has authority.** The stored row
  changed after the device's base: the server keeps it and returns it in `conflicts`, and the
  device replaces its copy. Two exceptions, both decided by the edit times: a delete newer than
  the stored edit still wins, and an edit newer than a logged delete brings the row back (it is
  inserted again and its log row goes). A row that is gone answers with its log row: an edit
  older than the delete is a conflict whatever its base (a logged delete's time can lie before
  the row's last edit, so a base at or after it proves nothing), returned in `deletions` (the device drops its copy), and a
  delete is applied without writing anything. An edit with a base for an id with neither row nor
  log row is answered in `deletions` too (the base proves the server held it, so its log row was
  swept); only a row the device created (no base) is inserted. A row that already equals the stored one writes
  nothing, so a retried push is harmless. An applied
  row's `updatedAt` never goes back in time (a device clock behind the stored edit gets the
  stored time plus a millisecond). The trigger enforces the same for every writer: an update
  stores at least the old `updated_at` plus 1 ms, to the millisecond, so a REST `now()` behind a
  device clock that ran fast cannot slip under a device's base and be overwritten unseen. The
  answer lists the `updatedAt` the server holds for every
  pushed row, the device's next base.
- **Ownership.** An id of another user, or a print, card or binder that does not exist, answers
  404 and the whole push writes nothing.

## Consequences

- The REST routes need no change for the cursor (the trigger stamps their writes too); their
  deletes write the log row themselves (VB-75).
- A deleted row's content is gone at once; only its id and table stay, at most 30 days (the sweep
  removes entries older than 29 days, daily), which keeps the privacy policy's promise about deletion markers. A
  device that did not sync for longer than that pulls everything again.
- The `deleted_at` columns of the five tables stay for one release (every row has it null,
  nothing reads it) and are dropped in a later one.
- One more lock per write, a short exclusive lock per pull and one push at a time, per user.
  Fine for one person's devices; a pull or push that comes during a long write of the same user (a
  500-row import) waits for it.
- Ceilings, accepted for now:
  - Last writer wins per **row**: two devices that change different fields of the same row
    offline keep one device's row (the other gets a conflict). No field-level merge.
  - "Newer" for deletes and resurrections compares clocks of different devices; a device with a
    wrong clock can win or lose such a race it should not have.
  - A pushed `updatedAt` or `deletedAt` more than 5 minutes ahead of the server's clock is cut to
    now plus 5 minutes, so a device clock far ahead cannot pin a row in the future for good (the
    trigger never lowers `updated_at`); the device still syncs.
  - The horizon is one for all users: a device more than 30 days behind resyncs even when its
    user deleted nothing in that time. Per-user horizons when that costs too much.
  - The unique rules (a binder name, one wish per print, language and finish) answer 409 for the
    whole push when two devices created the same thing offline; the message names the first
    pushed row that ran into one (`binders <id>: …`, `wishlist_entries <id>: …`), and the client
    renames or merges that row and pushes again.
  - A pull page holds at most 500 rows plus the full lists of the decks among them, and ends
    early once rows and lists pass 5000 (one row always fits, so a full deck still pages).
- The native client half (local SQLite mirror of these rows, the outbox of pushes, applying pull
  pages and conflicts) follows with the device work (VB-67, VB-29) and reuses
  `resolvePush` and `orderChanges` from `@voidbinder/core`.
