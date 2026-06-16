#!/usr/bin/env node
// Test using Signet as a library with TypeScript

import { verifyReceipt, type VerifyResult } from '../src/verify.js';
import { canonHash } from '../src/canon.js';
import { readFileSync } from 'node:fs';

console.log('\n=== Signet Library Usage (TypeScript) ===\n');

// 1. Hashing with types
console.log('1. Type-safe hashing:\n');
interface TaskData {
  task: string;
  target: string;
  action: 'read' | 'write' | 'execute';
}

const taskData: TaskData = {
  task: 'read',
  target: 'src/index.ts',
  action: 'read',
};

const hash: string = canonHash(taskData);
console.log(`   Task: ${taskData.task}`);
console.log(`   Hash: ${hash}\n`);

// 2. Verifying receipts with type checking
console.log('2. Type-safe verification:\n');
const receiptJson: string = readFileSync(new URL('./receipt.verified.json', import.meta.url), 'utf-8');
const result: VerifyResult = verifyReceipt(receiptJson);

console.log(`   Status: ${result.status}`);
console.log(`   Checks:`);
console.log(`     parse:      ${result.checks.parse_ok}`);
console.log(`     version:    ${result.checks.version_ok}`);
console.log(`     structure:  ${result.checks.structure_ok}`);
console.log(`     sha256:     ${result.checks.sha256_ok}`);
console.log(`     h10:        ${result.checks.h10_ok}\n`);

// 3. Working with receipt summary
if (result.receipt_summary) {
  const { packet_id, verdict, outcome } = result.receipt_summary;
  console.log(`3. Receipt summary:\n`);
  console.log(`   Packet:  ${packet_id}`);
  console.log(`   Verdict: ${verdict}`);
  console.log(`   Outcome: ${outcome}\n`);
}

// 4. Error handling
console.log('4. Error handling:\n');
if (result.status === 'FAIL' || result.status === 'ERROR') {
  console.log(`   ✗ Verification failed:`);
  for (const failure of result.failures) {
    console.log(`     - ${failure}`);
  }
} else {
  console.log(`   ✓ Receipt verified successfully`);
}

console.log('\n=== Imports ===');
console.log('import { verifyReceipt, type VerifyResult } from "@azel-asl/signet";');
console.log('import { canonHash } from "@azel-asl/signet";');
