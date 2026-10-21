---
kind: upgrade-guide
description: "Zhuanleme ledger schema 3 adds explicit cost recognition and net settlements, and new partial actuals no longer replace category estimates."
---
# Zhuanleme cost recognition and settlement basis

English | [中文](guide.zh.md)

## Change

The local Zhuanleme product upgrades ledger `user_version` from 1 or 2 to 3 without rewriting existing entries, rules, audit records or requests. Earlier readers reject schema 3. JSON exports use format version 3; the new reader also accepts version 2 backups. Full customer backups accept both SQLite generations.

New actual costs default to `costCoverage: partial`. Profit remains incomplete until a user explicitly marks the category complete. Historical actuals retain their calculation and are labelled provisional until reviewed. Costs with `costFrom` and `costTo` replace estimates over their service period, independently of the payment date. A monthly-rule cost requires an explicit service period or `costTiming: daily`.

Net settlements require `revenueBasis: net` and `platformFee`: gross sales are reconstructed and the fee is counted once. Same-channel manual fees and overlapping fixed platform estimates are rejected. Reports add `profitStatus`: `incomplete`, `provisional`, `estimated` or `verified`. A numeric amount alone does not imply verified profit.

## Migration

1. Stop writers and back up the complete Profile, customer ledger directories and identity database before starting schema 3. Restore code and data together for a downgrade; do not open new data with an older product.
2. Use each table row's recognition action, customer entry fields or tool arguments to declare cost completeness and service dates. Do not mark a partial receipt complete. Historical records are preserved; review their meaning before editing.
3. Enter the deducted fee with each net settlement, including refunded fees. Remove duplicate same-channel fee entries before converting existing sales to net settlements. Use `feeChannel` for another channel's manual fee.
4. Configure income channels and reconcile each day, including zero-sales channels. Display and report `profitStatus` with the amount. Fixed or percentage estimates remain labelled estimated.
5. Verify daily and period reports, retries, edits, refunds and backup restoration with the product tests and the outer project's `scripts/test-monthly-ledger.mjs`, which uses temporary books and no model.
