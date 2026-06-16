# Contributing to Signet

## Open / Closed Boundary

**Open (Apache 2.0) — contributions welcome:**
- Everything in this repository: `src/` (parser, validator, runtime, enforcement compiler, verifier, canon, XAS-MEM), `cli/`, `tests/`, `examples/`, `docs/`

**Closed (ASL Labs — Agentic Specification Language Labs — proprietary) — not in this repository:**
- Signet Authority: Ed25519 receipt signing + approval-record issuance

This ensures verification is trustless (open code, anyone can run it) while authority stays centralized (only Signet Authority signs).

---

## Development Setup

```bash
git clone https://github.com/azel-asl/signet.git
cd signet
npm install                       # requires Node >= 22.5
npm test                          # 232 tests must pass
npm run signet -- validate examples/runtime-lock.packet.md
npm run signet -- run examples/runtime-lock.packet.md --receipt receipt.json
npm run signet -- verify receipt.json
```

---

## Pull Requests

1. Fork → feature branch → changes → tests → PR
2. All tests must pass (`npm test`)
3. No TS errors (`npm run build`)
4. Scope: open components only (see above)
5. One PR per feature/fix

For closed-component changes, open an issue or contact ASL Labs directly.

---

## Test Guidelines

```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from '../src/myModule.js';

describe('myFunction', () => {
  it('handles the normal case', () => {
    expect(myFunction({ a: 1 })).toBe(expectedValue);
  });
  it('throws on invalid input', () => {
    expect(() => myFunction(null)).toThrow();
  });
});
```

---

## License

Contributions to open components are licensed Apache 2.0.
