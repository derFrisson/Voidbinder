# Architecture Decision Records

Decisions that shape Voidbinder. A change to an accepted decision needs a new ADR approved by Max.
Template: Context, Decision, Consequences; status `Proposed`, `Accepted` or `Superseded by NNNN`.

| ADR                                      | Title                                                  | Status   |
| ---------------------------------------- | ------------------------------------------------------ | -------- |
| [0001](0001-stack.md)                    | Stack and monorepo layout                              | Accepted |
| [0002](0002-deploys-from-workstation.md) | Deploys run from the workstation, CI checks            | Accepted |
| [0003](0003-price-history-storage.md)    | Price history is stored, not fetched; provider options | Accepted |
| [0004](0004-caching-catalog-reads.md)    | Caching for catalog and price reads                    | Accepted |
| [0005](0005-sync-protocol.md)            | Sync protocol for the collection and decks             | Proposed |
| [0006](0006-search-index-d1.md)          | D1 as a read-only search index in front of PostgreSQL  | Accepted |
