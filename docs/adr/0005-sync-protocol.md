# 0005: Sync protocol for the collection and decks

- Status: Proposed
- Raised by: VB-32 (Sprint 3), 2026-10-10; for Max to accept

## Context

Collectors edit their collection where there is no signal: at a card shop, at a tournament, on a
train. The native app (Expo, ADR 0001) keeps a local copy and writes there first; the server has
to take those edits later, from several devices, without losing any. The tables were shaped for
this in Sprint 2 (VB-31, VB-34): every row has a client-generated `id`, an `updated_at` and a
`deleted_at` tombstone, so a deleted row is still there to be synced. The REST routes write the
same tables and must keep working next to the sync.

What was missing: a way to ask "what changed since I last looked" that cannot skip a row, and a
rule for two devices editing the same row.

## Decision

One endpoint pair under `/sync`, signed in (`requireUser`), user-scoped, Zod-validated
(`packages/shared/src/api/sync.ts`); the pure rules live in `packages/core/src/sync` so the
native client runs the same code.

- **Cursor.** A global sequence `sync_seq`. A trigger on `binders`, `collection_entries`,
  `wishlist_entries`, `decks` and `deck_entries` stamps the next value on every insert and update,
  whoever writes (REST or sync). `GET /sync/pull?since=&limit=` answers the user's rows with
  `sync_seq > since` (tombstones included), the lowest first across the tables, pages of at most
  500, and the next cursor. Never the wall clock: clocks of devices and pods disagree, the
  sequence does not.
- **No row behind the cursor.** A sequence hands out numbers in order but transactions commit in
  any order, so a pull could see number 11 committed while 10 is still in flight and move its
  cursor past 10 for good. The trigger therefore takes a shared per-user advisory lock (held to
  the end of the transaction) before it takes a number, and a pull takes the same lock
  exclusively: it waits for every write of that user in flight, and while it reads, no write of
  that user can take a number. Writers never block each other; a pull waits at most for the
  user's own open writes.
- **Push.** `POST /sync/push` takes `{ changes: [{ table, rows }] }`: full rows with `updatedAt`
  (the device's edit time), `deletedAt` for a delete and `baseUpdatedAt` (the `updatedAt` the
  device last pulled; null for a row it created). At most 500 rows, and at most 5000 deck
  entries (500 per deck), so one push cannot hold the user's lock for a quarter million writes;
  one transaction; applied in
  table order (binders before entries, decks before their lists). A deck's entries are its whole
  list and travel with the deck row, because the deck rules judge a list as a whole.
- **Conflict rule: last writer wins per row, the server's row has authority.** The stored row
  changed after the device's base: the server keeps it and returns it in `conflicts`, and the
  device replaces its copy. Two exceptions, both decided by the edit times: a delete newer than
  the stored edit still wins, and an edit newer than a stored delete brings the row back. A row
  that already equals the stored one writes nothing, so a retried push is harmless. An applied
  row's `updatedAt` never goes back in time (a device clock behind the stored edit gets the
  stored time plus a millisecond). The trigger enforces the same for every writer: an update
  stores at least the old `updated_at` plus 1 ms, to the millisecond, so a REST `now()` behind a
  device clock that ran fast cannot slip under a device's base and be overwritten unseen. The
  answer lists the `updatedAt` the server holds for every
  pushed row, the device's next base.
- **Ownership.** An id of another user, or a print, card or binder that does not exist, answers
  404 and the whole push writes nothing.

## Consequences

- The REST routes need no change: the trigger stamps their writes too.
- One more lock per write and a short exclusive lock per pull, per user. Fine for one person's
  devices; a pull that waits on a long write of the same user (a 500-row import) waits for it.
- Ceilings, accepted for now:
  - Last writer wins per **row**: two devices that change different fields of the same row
    offline keep one device's row (the other gets a conflict). No field-level merge.
  - "Newer" for deletes and resurrections compares clocks of different devices; a device with a
    wrong clock can win or lose such a race it should not have.
  - The unique rules (a binder name, one wish per print, language and finish) answer 409 for the
    whole push when two devices created the same thing offline; the client has to rename or
    merge and push again.
  - A pull page holds at most 500 rows plus the full lists of the decks among them, and ends
    early once rows and lists pass 5000 (one row always fits, so a full deck still pages).
- The native client half (local SQLite mirror of these rows, the outbox of pushes, applying pull
  pages and conflicts) follows with the device work (VB-67, VB-29) and reuses
  `resolvePush` and `orderChanges` from `@voidbinder/core`.
