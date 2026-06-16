# Signet — Project Instructions

Signet provides **governance by contract, enforcement by hook (on
hook-capable hosts), and verification by receipt**. GCL stands for
**Governance Contract Layer**.

Two modes, one packet format. `signet run` evaluates the actions a packet
*declares* against its locks (simulation — works everywhere). `signet hook
init` compiles the packet's locks into a PreToolUse hook that denies
forbidden tool calls as the agent attempts them (Claude Code today).
Hook enforcement is **not a sandbox**: it checks declared lock patterns
only, and a host without hooks provides no constraint. Only
`hook_intercepted` denial events are ever described as enforcement of a
running agent.

## Commands

```bash
npm run signet -- validate <packet.md>
npm run signet -- run <packet.md> --receipt <out.json>   # simulation; auto-logs to SIGNET-USAGE.md + xas_mem
npm run signet -- verify <receipt.json> [--packet <packet.md>]
npm run signet -- history [--limit <n>]
npm run signet -- hook init <packet.md> [--install]      # compile locks → .signet/hook.mjs (+ settings merge)
npm run signet -- enforce report [--receipt <out.json>]  # journaled denials → enforcement receipt
npm test
```

## Usage logging

`signet run` logs every run automatically: one row in `data/xas_mem.db`
(7 fields: handle, packet_id, receipt_path, verdict, alignment_score,
lessons, created_at) and one entry appended to `SIGNET-USAGE.md`.

Two fields need a human afterwards: **Significance** and **Time spent**
are written as fill-in placeholders by the auto-logger.

### /signet record

When the user types `/signet record`, append a new entry to `SIGNET-USAGE.md`:

1. Ask for (or infer from conversation): packet name, action, result,
   significance, time spent, receipt path, notes.
2. Compute alignment score from the receipt if one exists
   ((gates passed + ATs passed) ÷ (total gates + ATs) × 10); otherwise ask.
3. Append an entry using the 9-field table template already in the file
   (Date, Packet name, Action, Result, Alignment score, Significance,
   Time spent, Receipt path, Notes / drift / blockers).
4. Do not modify or delete existing entries.

### /signet record last

When the user types `/signet record last`, find the most recent auto-logged
entry in `SIGNET-USAGE.md` and fill in its placeholder fields (Significance,
Time spent, and amend Notes) from the conversation context. Edit only the
placeholder text — never change Date, Result, Alignment score, or Receipt path.

## Rules

- Never run `npm publish` — `"private": true` is intentional until a deliberate npm release.
- Never describe simulation as enforcement of a live agent.
- All 232+ tests must pass before any commit (`npm test`).
- ASL always means **Agentic Specification Language** — expand it at first mention in any public-facing doc.
- Closed-layer code (Signet Authority: signing, approval issuance) must never enter this repo.
