# Signet Starter — No-Code Pack

For non-technical users. No installation. Turn plain-English intent into a
governed, checkable Signet packet using any capable LLM.

## How to use (2 minutes)

1. Upload this whole `signet-starter/` folder to your LLM (Claude, etc.).
2. Say: **"Read PROMPT.md and act as the Signet Intent Compiler."**
3. Type your intent, for example:

   ```
   /signet Review this vendor contract, flag payment risks,
   do not give legal advice, and create a receipt.
   ```

4. The LLM will generate a Signet packet, run parser + verifier checks, show
   pass/fail, correct anything missing, and **ask before running**. Nothing
   executes automatically.

## What's inside

| Folder | What it is |
|---|---|
| `PROMPT.md` | The Intent Compiler instructions (the brain) |
| `QUICKSTART.md` | Both the no-code and developer paths |
| `specs/` | The Signet format spec + canonical hashing rules |
| `samples/` | Two worked packets + two verifiable demo receipts |
| `templates/` | Blank packet + receipt templates |
| `parser/` | Structural rules the LLM applies |
| `verifier/` | Governance + receipt rules the LLM applies |
| `skills/signet/` | The `/signet` skill, if your client supports skills |

## Want deterministic checks?

Developers can run the real CLI (parse, validate, simulate, verify receipts)
from the full repository: https://github.com/azel-asl/signet

## What a Signet result means

A passing verifier means the **contract** is well-formed and governed — not
that the work was done or done correctly. A verified receipt means its
contents are unmodified — not that the outcome is proven. Signet is honest
about this on purpose.
