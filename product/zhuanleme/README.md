# Zhuanleme DSH plugin

English | [中文](README.zh.md)

An independent product Bundle that reuses official DSH chat and workspace services without modifying official `apps/` or `packages/`. It currently provides a business ledger within a local Profile, not SaaS tenant permissions, inventory/BOM, payments, or statutory financial statements.

## Usage

Add a shop under “My shops” in the sidebar, or select an existing workspace as a shop. Conversations in the same shop share a persistent ledger. The overview shows horizontally scrollable revenue, expense, and profit trends, seven days per screen, with hidden scrollbars and drag navigation. It initially loads 30 days and loads earlier dates at the left edge. Selecting a date changes that day's data without rearranging the trend range. The entries table switches between income and expenses, with light grid lines and right-aligned amounts. Click a cell to edit without an underline; Enter or leaving the cell saves, and Esc cancels. New entries use borderless table rows; after entering the date and amount, Enter or leaving the row saves. Each row always shows a delete icon for direct deletion; the toolbar provides undo. Search, sorting, filtering, compact display, fullscreen, and Excel / CSV export are available. On mobile, horizontal scrolling stays inside the table. The entries view does not show cost rules or a review section.

### Table components and export

Material React Table 3.2.1 and MUI 6.5.0 (MIT) provide the table, native editors, and menus; SheetJS provides export. The table API and model tools share one SQLite ledger. The model can query and analyze records and propose additions, edits, or deletions through confirmation cards. The table refreshes after confirmation.

Undo and change history use persistent server audit records and remain available after refreshes, date changes, or restarts. “Change history and recovery” in the More menu loads earlier records in pages of 100. Version and content checks prevent an old operation from overwriting later edits. Failed edits and incomplete new entries stay in the current browser for resumption; retries reuse the original submission identifier.

“Export Excel / CSV” downloads saved records for the current shop, date, income/expense type, and search, in the current sort order, excluding empty new-entry rows and action columns. Export is disabled during editing so unsubmitted amounts are not exported as posted entries. Notes remain text and amounts remain numeric. Excel uses [SheetJS CE 0.20.3](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/) (Apache-2.0), installed from its official URL with a pinned version. Downloads run locally in the browser without cloud conversion. Dependency licenses are in each package's LICENSE file, and builds retain their notices.

The table uses its components' native cell editing and in-table insertion modes. The toolbar contains income/expense selection, undo, add, More, and search.

When AI produces an entry draft or change proposal, the conversation shows a confirmation card. Review the shop, date, amount, and before/after values, then confirm to post the entry or apply the change and refresh the table. Cards also allow discarding proposals; discarded entry drafts are marked voided. Confirmation does not require opening the overview, and the ledger still retains items awaiting review.

“Business assistant” is a peer of “Overview” and “Entries”. It starts collapsed and expands directly into conversations; the rightmost plus creates a conversation in the current shop. The title's More menu opens archived or deleted conversations in separate searchable recovery windows. The sidebar always lists unarchived conversations. Shops and the assistant section collapse independently.

Conversations use compact single rows. Hover or keyboard focus reveals archive and More icons; touch screens show them continuously. More, right-click, or Shift+F10 opens pin, archive, and delete actions in an overlay menu, closed by outside clicks or Esc. Pins persist locally across refreshes. Archive, unarchive, move to deleted, and restore update the list directly without extra success notices. “Show more conversations” loads older entries, and title search covers the complete list when there are many conversations. Moving to deleted requires confirmation; running conversations must first finish or stop. Deletion is recoverable hiding: it does not permanently erase chat records or shop entries.

The six cost categories are goods, labor, rent, utilities, platform fees, and other. Rules support daily fixed amounts, monthly fixed amounts, and revenue percentages, with explicit calculation bases and effective dates. Enter 0 explicitly for absent costs. Unconfigured costs are not treated as zero, and profit remains incomplete. New entries default to individual transactions; same-day channel income and actual expenses in the same category accumulate independently. Actual category totals replace that category's estimate. Older data retains daily-summary semantics, and the two modes cannot be mixed. Enabled income channels require daily reconciliation, including explicit confirmation of zero revenue. Reports and model results flag incomplete revenue before day close. Purchases appear in purchase details without directly reducing profit.

## Installation and build

Run from the official source root (the outer project also provides `pnpm` and `dsh` wrappers):

```sh
node product/zhuanleme/build.mjs
../dsh plugin --profile web add "link:$PWD/product/zhuanleme"
```

Install local development dependencies with `pnpm --dir product/zhuanleme install --offline --ignore-workspace`. Cordis and the tool runner declare versions through peerDependencies, with development links to the current checkout; do not bundle a second runtime. The outer `./dsh` uses the built official CLI and Profile. Rebuild after updating DSH source; do not mix tsx source aliases with package lib exports.

Prefer absolute `link:` paths to avoid changes in relative resolution when a Profile switches directories. Restart DSH to load Host changes; the official module system loads Client artifacts. The browser title uses the full official build variable `DSH_CLIENT_TITLE=赚了么`, not a startup setting. The plugin builder resolves esbuild through the checkout's tsx and emits a lazy CJS factory using DSH `__ModuleLoader__.load`. Only React and the JSX runtime are platform externals. This local development package does not claim compatibility with arbitrary DSH versions.

## DSH extension contract

- `package.json` declares `dsh.bundle.patch`, `dsh.client.platform`, and `./client`.
- The Host depends on `connection`, `webServer`, `workspaceRegistry`, `tools`, `profileContext`, and `agents`. Business APIs register with `connection.fetch`, reusing DSH Host/Origin checks and browser authentication. Running state comes from the official Agent registry.
- UI registration occurs inside the `slots.inject` declaration barrier, using `priority: -100` to replace brand leaves, workspace browsing, and `main.conversation`. It does not redeclare official child Slots or import official feature components.
- The main panel reuses chat, message nodes, and the composer through the public `conversation.content` Factory. Registered observable hooks inject page state; components do not receive Context.
- Three business confirmation cards register by tool name in `tool.call.toolview`, shared by Native and PTC child calls. `conversation.chat.turnTail` retains the turn's review items so compact tool rendering does not hide confirmation access. The official Runtime owns call trees, result pairing, and replay.
- Client CSS Modules and Locale dictionaries belong to the plugin. Styles, dictionaries, requests, timers, databases, and routes clean up with their lifecycle. Colors follow the DSH theme.
- Installation only adds Profile composition; it does not disable the existing marketplace, GenUI, settings, or plugin management.

## AI tools and Model Experience

Five tools register through official `defineTool`, validate model arguments, and return structured JSON compatible with Native and PTC scheduling. Host presentation functions remain pure. Web confirmation cards handle drafts, entry changes, and cost rules; queries and errors retain generic tool rows. Model amount inputs use yuan; report amounts use integer cents.

- `zhuanleme_report(day?)` returns the ledger, entry id/version, rulesVersion, pending change proposals, business date, and timezone. An omitted date first uses the current conversation's ledger date, otherwise today's Shanghai date. viewContext includes the current search and income/expense type, while totals still cover the whole day. Details are capped at 100 entries with a truncation flag.
- `zhuanleme_period(from,to,offset?,limit?,status?)` queries daily totals and paginated entries for 1 to 366 days, up to 500 entries per page. status selects posted entries, drafts, or deleted records; totals always include posted entries only.
- `zhuanleme_draft(...)` creates an income, purchase, or actual-cost draft. Repeated requests return the current real state without duplicate posting.
- `zhuanleme_change(...)` proposes an edit or void for an existing entry. Query id/version first and provide complete fields for edits.
- `zhuanleme_rules(...)` proposes cost rules for explicitly named items using the queried rulesVersion. Unspecified items remain unchanged, without assumed zero values.

The model can pass `today/今天`, `yesterday/昨天`, or an explicit date without querying the date through Bash. The shop resolves only from the executing Agent's Session cwd; the model cannot select another shop. Tools check cancellation before and after asynchronous shop resolution. Ask for missing required dates, amounts, or ownership. AI additions and changes wait for user confirmation; model tools provide no confirmation action. Drafts and pending proposals must not be described as posted or effective.

Successful write proposals return `review: { shop, type, id }`. Native results also retain presentation metadata, and persistent PTC child-call results preserve the same identifier. Cards verify that it matches their conversation's shop before reading current records through the authenticated API's `review` operation. Historical cards show the current posted, voided, applied, or discarded state. Confirmation submits the version the user saw rather than silently switching to a newer one; conflicts show an error and reload state. Change confirmation checks the original version and updates the ledger, proposal, and audit in one transaction. Discard stale proposals before generating replacements.

## Data and cost model

The database is `$DSH_HOME/profiles/<profile>/zhuanleme/ledger.sqlite`, using SQLite WAL, transactions, and a busy timeout. The private ledger's `user_version=2` stores entries, cost rules, audit, change proposals, stable operation receipts, channel settings, and day closures. Version 1 migrates incrementally; newer unsupported versions are rejected. Amounts use integer cents. Monthly cost remainders are allocated to the first days of the month so allocations exactly equal the configured total. Percentage rates use basis points. Rules retain effective dates and ordered versions; entry edits and voids write audit records without physically deleting old entries.

Create, edit, and void requests preserve original responses in operations, deduplicate by shop and submission identifier, and compare contents with the original creation audit. Later edits or voids do not allow the same original request to post again. Confirmation or voiding can retry the same immediately successful `id/version/action`; intervening edits reject the old version. Manual cost-rule forms retain the rulesVersion at opening. If rules change meanwhile, the entire submission is rejected and the form must reopen. Refresh and silent synchronization publish only results from the current request generation, preventing data from crossing shop switches.

The official WorkspaceRegistry persists archive state. Pins and recoverable deletion markers live in the adjacent `conversations.sqlite`, separate from the ledger and DSH Session logs. Deletion verifies shop ownership and running state, archives the conversation, and records a marker; restoration unarchives it and removes the marker. The plugin offers no permanent deletion and does not change Session persistence formats. Unloading stops accepting conversation operations and waits for accepted operations before closing the database.

Cost categories and calculation concepts draw on the adjacent `zhuanleme/agent-core/docs/ury-analysis.md` and pinned `ury-reference`; implementation is independent and neither copies nor depends on URY. The first version applies actual-cost overrides by day, without cross-period bill allocation, automatic inventory consumption, or cash-flow accounting. Purchase amounts represent purchase records without asserting payment. UI business dates default to today in Shanghai; model tools accept explicit relative dates.

## Validation

See the [remediation report](REMEDIATION.md) for current fixes and acceptance results; earlier issues and evidence remain in the [original acceptance checklist](AUDIT-CURRENT.md). Historical AUDIT.md results do not replace current UI and real-model acceptance.

```sh
node --test product/zhuanleme/tests/*.test.mjs
```

Unit tests cover cost calculation, shop isolation, concurrent versions, create/confirmation retries, authenticated API record scoping, persistent conversation deletion/recovery, and Cordis unload/reload. Real DSH ToolRuntime tests cover card identifiers in Native results and PTC child calls. Client model tests cover stale responses, duplicate clicks, and confirmation versions. Scripted-model and tool tests are not real-model or browser end-to-end acceptance; see actual results in [AUDIT.md](AUDIT.md).

There is no separate invariant companion. SQLite owns ledger truth and totals are computed on demand. Conversation deletion markers and official archive state store separate deletion and archive facts; tests cover serial operations, failure recovery, and lifecycle.

The browser acceptance script, `tests/browser-smoke.mjs`, targets only the isolated `zlm-test` Profile. Set `ZLM_ACCEPTANCE_LOG` to its startup log and `ZLM_ACCEPTANCE_PROFILE=zlm-test`, then execute with Node. It requires installed Google Chrome, a Chinese UI, and an isolated Profile without configured credentials. It creates simulated shops and entries and overwrites `.impeccable/review/`; do not run against real data.

## Retail demo shop

“Try demo shop” creates or opens the isolated “Demo shop · Qinghe Living”. Its seven days of sales, purchases, and costs are fictional and persist only in that shop's ledger. Reopening neither duplicates entries nor overwrites edited or voided demo records. The initial date is stored in the current Profile's `zhuanleme/demo-shop.json`; the date range remains available through the date picker. API and AI reports return `demo: true`. Goods costs keep the existing `materials` category identifier without migrating ledger data.

## Profile code regression

From the outer directory, run `.dsh-tools/node-v24.21.0-darwin-arm64/bin/node deepseek-harness/product/zhuanleme/tests/profile-smoke.mjs`. It launches a temporary Profile from the official Web template, exercises queries, drafts, and changes through the real Loader, AgentLoop, tool runner, and SQLite, and verifies persistent card identifiers and unchanged posted records before manual confirmation. A scripted model replaces only external inference. The test closes its child process. Complete sessions and startup logs remain in the printed temporary directory; logs contain test authentication links and must not be committed.

`ZLM_AUDIT_LIVE=1` runs an isolated test with this project's existing model configuration, removing temporary credential and settings copies afterward. Provider failures fail the test instead of falling back to simulated success. `--browser` or `ZLM_AUDIT_BROWSER=1` additionally invokes `tests/review-smoke.mjs` to check the isolated page; code tests do not replace page acceptance. See [REMEDIATION.md](REMEDIATION.md) for current results and limitations.

## Local shop projects

Each shop maps to an official WorkspaceRegistry workspace project. New shops create a local `<profile.dir>/zhuanleme/shops/<UUID>/` folder; existing workspaces keep their paths. Overview and entries are fixed shop destinations, with multiple conversations sharing shop data. The ledger remains centralized in `<profile.dir>/zhuanleme/ledger.sqlite` and isolated by shop, rather than one database per shop folder. Backups must include Profile data, not just shop folders.

## Daily operations and recovery

The table combines business date and occurrence time into a “Date” column accepting YYYY-MM-DD HH:mm, optional seconds, or a date alone. Storage retains separate fields in the Shanghai timezone. Unknown times remain blank rather than using system creation time. More can reveal transaction/daily-summary mode, linked refunds, payment status, and account. Refund amounts are positive inputs counted negatively through their links; excessive or cross-shop refunds are rejected. An original entry with an active refund cannot be directly deleted. Payment status and accounts record user-supplied information only, without automatic reconciliation or cash-flow statements.

Period reports in More provide multi-day totals, paginated details, and full-period Excel export. Changes during export abort it and require a fresh query. Unrecorded dates remain missing; confirmed zero revenue remains zero. “Revenue reconciliation and day close” requires all enabled channels and cannot omit a channel with recorded income that day.

“Ledger backup and recovery” creates a JSON snapshot within one transaction, containing shop rules, audit, proposals, operation receipts, channels, and day closures. Restoration validates and previews the backup and only targets a new empty shop. It remaps identifiers and historical sequence numbers, rolling back the entire operation on synchronization failure without overwriting the original shop. The checksum detects corruption; it is not a source signature. DSH and the separate conversation database own chats and archive state, which are excluded from ledger backups. Full environment backups still require the Profile.

A recoverable delete action appears beside the shop name. Deleted shops disappear from the sidebar; the backend retains restoration with the same identity, although the sidebar has no recovery entry. Ledgers and conversations are retained. Running shops cannot be deleted, and deleted shops reject ledger API and business-tool reads and writes.

The composer has one microphone between model selection and send. Clicking it replaces the bottom toolbar with a dotted waveform, cancel, stop, and send. A browser AudioWorklet continuously captures audio and sends it through the authenticated API and `dsh-voice`'s `voice_stream` to local Zipformer. Recognition updates the draft continuously; SenseVoice corrects words, numbers, and punctuation at sentence endings. No API Key or cloud recognition is required, but initial use needs browser microphone permission on HTTPS or localhost. Recording is limited to two minutes. Cancel restores the original draft, stop retains final text, and send flushes audio before submission. Switching conversations or disconnecting the device stops recording. Manual edits take priority and are never overwritten. The outer project configures speech models and the Python service; backend changes require restarting the DSH Profile.

On first opening entries, if the day contains only posted expenses, the expense tab opens by default. Income and expense tabs display their respective posted record counts; purchases are expenses. Search filtering does not change tab counts.

The sidebar does not expose “Deleted shops” or “Try demo shop”. Removing these entry points does not erase existing ledgers, conversations, or deletion markers.
