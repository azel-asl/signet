# Security Policy

## Reporting a vulnerability

Please report security issues privately. Open a
[GitHub security advisory](https://github.com/azel-asl/signet/security/advisories/new)
or email the maintainer rather than filing a public issue.

We aim to acknowledge reports within a few days.

## Scope

This repository is the **open Signet protocol**: parser, validator,
simulation runtime, hook-enforcement compiler, receipt verifier, canon, and
CLI. Relevant concerns include:
- parser/validator denial-of-service or injection via crafted packets,
- receipt verification bypass (a tampered receipt verifying as intact),
- hook-enforcement bypass on a supported host.

## Out of scope

- The closed **Signet Authority** layer (signing keys, approval issuance,
  hosted services) is not in this repository. Report Authority issues through
  the same private channel, noting they concern the closed layer.
- "Simulation does not constrain a live agent" is **documented behavior**, not
  a vulnerability. Simulation evaluates declared actions; live control on
  hook-capable hosts is provided by `signet hook init`.

## What a receipt does and does not prove

A verified receipt proves its contents are unmodified since creation. It does
**not** prove the underlying work was performed or correct, and an unsigned
receipt carries no authority attestation. Claims to the contrary are bugs in
documentation — please report them too.
