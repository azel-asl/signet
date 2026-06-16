#!/usr/bin/env node
// Test using Signet as a library (no CLI)

import { verifyReceipt } from '../dist/src/verify.js';
import { canonHash } from '../dist/src/canon.js';
import { readFileSync } from 'node:fs';

console.log('\n=== Signet Library Usage Test ===\n');

// 1. Test canonHash (open module)
console.log('1. Using canonHash directly:\n');
const data = { task: 'read', target: 'src/index.ts' };
const hash = canonHash(data);
console.log(`   Input:  ${JSON.stringify(data)}`);
console.log(`   Hash:   ${hash}\n`);

// 2. Test verifyReceipt (open module)
console.log('2. Using verifyReceipt directly:\n');
const receiptJson = readFileSync(new URL('./receipt.verified.json', import.meta.url), 'utf-8');
const result = verifyReceipt(receiptJson);

console.log(`   Receipt parsed:  ${result.checks.parse_ok}`);
console.log(`   Version valid:   ${result.checks.version_ok}`);
console.log(`   Structure OK:    ${result.checks.structure_ok}`);
console.log(`   SHA256 match:    ${result.checks.sha256_ok}`);
console.log(`   H10 match:       ${result.checks.h10_ok}`);
console.log(`   Status:          ${result.status}\n`);

if (result.receipt_summary) {
  console.log(`   Packet:          ${result.receipt_summary.packet_id}`);
  console.log(`   Verdict:         ${result.receipt_summary.verdict}`);
  console.log(`   Outcome:         ${result.receipt_summary.outcome}`);
  console.log(`   Blocks:          ${result.receipt_summary.blocks_recorded}\n`);
}

// 3. Show how to detect tampering
console.log('3. Detecting tampering:\n');
if (!result.checks.sha256_ok) {
  console.log('   ✗ TAMPERED - receipt was modified');
  console.log(`   Reasons: ${result.failures.join(', ')}\n`);
} else {
  console.log('   ✓ VERIFIED - receipt is authentic\n');
}

console.log('=== Summary ===');
console.log('Signet modules can be imported and used directly:');
console.log('  - canonHash(): hash any data with XAS-CANON-1');
console.log('  - verifyReceipt(): verify receipt authenticity');
console.log('  - All open modules are Apache 2.0\n');
