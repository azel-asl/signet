# Signet Quickstart

Two ways to use Signet. Pick the one that fits you.

---

## Path A — No-code (LLM-assisted, ~2 minutes)

For anyone. No installation.

1. Download this repository as a ZIP (or use the prepared `signet-starter/` package).
2. Open your LLM (Claude, etc.) and upload the folder — or at minimum
   `PROMPT.md`, `specs/`, `samples/`, `templates/`, `parser/`, and `verifier/`.
3. Tell the LLM: **"Read PROMPT.md and act as the Signet Intent Compiler."**
4. Type your intent:

   ```
   /signet Review this vendor contract, flag payment risks,
   do not give legal advice, and create a receipt.
   ```

5. The LLM will:
   - turn your intent into a Signet packet (`asl::BLOCK … ::END`),
   - run parser checks (structure) and show PASS/FAIL,
   - run verifier checks (governance) and show PASS / PASS_WITH_LIMITS / FAIL,
   - show warnings and any missing fields,
   - produce a corrected packet if needed,
   - keep execution **NOT RUN** and **ask you** before doing anything.

Nothing runs automatically. Default mode is `DRAFT_ONLY`.

---

## Path B — Developer (deterministic CLI)

For local, repeatable parsing, validation, simulation, and receipt checking.

```bash
git clone https://github.com/azel-asl/signet.git
cd signet
npm install            # requires Node >= 22.5 (uses the node:sqlite built-in)
npm test               # 232 tests pass

# Validate a packet (parse + structure + governance)
npm run signet -- validate examples/contract-review.packet.md

# Run a packet in governed simulation — writes a receipt
npm run signet -- run examples/phi-transfer.packet.md --receipt receipt.json

# Verify a receipt independently (anyone can do this)
npm run signet -- verify receipt.json
```

Expected: `contract-review` is **VALID** (Tier 1 review). `phi-transfer`
runs and **blocks at the human-approval gate** (GATE_002) because no approval
token is present — the intended behavior. The receipt still verifies as
intact.

---

## Which mode does what

| | ZIP mode (Path A) | CLI mode (Path B) |
|---|---|---|
| Who | Anyone, no install | Developers |
| Intent → packet | LLM generates it | You/LLM author it |
| Parser / verifier | LLM applies the rules logically | Deterministic, sub-second |
| Simulation run | — | `signet run` |
| Receipt verification | — | `signet verify` (trustless) |

See [README.md](README.md) for the full picture and
[examples/](examples/) for working packets.
