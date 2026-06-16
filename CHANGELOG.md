# Changelog

All notable changes to the open Signet protocol. The closed Signet Authority
layer (signing, approval issuance) is versioned separately and is not part of
this repository.

## v0.3.0 — Hook enforcement
- `signet hook init` compiles a packet's locks into a dependency-free
  PreToolUse hook that denies forbidden tool calls before they execute, on
  hook-capable hosts (Claude Code).
- `signet enforce report` turns journaled denials into a verifiable
  `signet-enforcement-receipt-v1`.
- Only `hook_intercepted` denials are described as enforcement of a running
  agent. Hook enforcement is not a sandbox.

## v0.2.0 — Verifier hardening + usage memory
- Verifier reports `UNSIGNED` explicitly, gives human-readable failure
  explanations, and offers packet ↔ receipt structural alignment
  (`signet verify --packet`).
- XAS-MEM usage memory: every run auto-logs to `SIGNET-USAGE.md` and a local
  SQLite database (`node:sqlite`, zero npm deps). `signet history` lists runs;
  prior runs are surfaced before a re-run.

## v0.1.0 — Foundation
- Packet parser + validator (ASL Lite + GCL).
- Governed simulation runtime.
- Dual-hash receipts (XAS-CANON-1: `sha256` byte integrity + `h10` semantic
  core) and an independent receipt verifier.

## Unreleased / planned (open repo)
- Receipt chains / lineage.
- Content-aware enforcement.
- Multi-agent attribution.
- npm package.

> Signature issuance lives in the closed Signet Authority layer. Anyone can
> write packets and verify receipts; only an Authority can issue trusted
> signatures. Enterprises can run a delegated authority.
