import { describe, it, expect } from 'vitest';
import {
  parseEvidenceRef, checkEvidenceTemplate, isValidEvidenceType, getTemplateFields
} from '../src/evidence.js';

// ── Evidence template validation ─────────────────────────────

describe('evidence module', () => {
  describe('isValidEvidenceType', () => {
    it('accepts all valid evidence types', () => {
      const types = [
        'file_read', 'file_write', 'command_output', 'gate_check',
        'acceptance_test', 'human_confirmation', 'agent_assertion',
      ];
      for (const t of types) {
        expect(isValidEvidenceType(t)).toBe(true);
      }
    });

    it('rejects unknown evidence type', () => {
      expect(isValidEvidenceType('magic_proof')).toBe(false);
      expect(isValidEvidenceType('')).toBe(false);
    });
  });

  describe('getTemplateFields', () => {
    it('returns required fields for file_write', () => {
      const fields = getTemplateFields('file_write');
      expect(fields).toContain('path');
      expect(fields).toContain('diff_summary');
      expect(fields).toContain('checksum');
    });

    it('returns required fields for command_output', () => {
      const fields = getTemplateFields('command_output');
      expect(fields).toContain('command');
      expect(fields).toContain('exit_code');
      expect(fields).toContain('key_result');
    });

    it('returns required fields for agent_assertion', () => {
      const fields = getTemplateFields('agent_assertion');
      expect(fields).toContain('claim');
      expect(fields).toContain('reason_not_system_verified');
    });
  });

  describe('parseEvidenceRef', () => {
    it('parses pipe-delimited evidence_ref', () => {
      const ref = parseEvidenceRef('path: src/index.ts | diff_summary: added 50 lines | checksum: abc123', 'file_write');
      expect(ref.fields['path']).toBe('src/index.ts');
      expect(ref.fields['diff_summary']).toBe('added 50 lines');
      expect(ref.fields['checksum']).toBe('abc123');
    });

    it('handles single-value ref without pipes', () => {
      const ref = parseEvidenceRef('file created', 'file_write');
      expect(ref.fields['_raw']).toBe('file created');
    });
  });

  describe('checkEvidenceTemplate', () => {
    it('returns no missing fields when all required fields present', () => {
      const ref = parseEvidenceRef(
        'path: src/index.ts | diff_summary: added lines | checksum: abc',
        'file_write'
      );
      const missing = checkEvidenceTemplate('file_write', ref);
      expect(missing).toHaveLength(0);
    });

    it('detects missing required fields', () => {
      const ref = parseEvidenceRef('path: src/index.ts', 'file_write');
      const missing = checkEvidenceTemplate('file_write', ref);
      expect(missing).toContain('diff_summary');
      expect(missing).toContain('checksum');
    });

    it('accepts agent_assertion with claim and reason', () => {
      const ref = parseEvidenceRef(
        'claim: packet read | reason_not_system_verified: source prompt processed',
        'agent_assertion'
      );
      const missing = checkEvidenceTemplate('agent_assertion', ref);
      expect(missing).toHaveLength(0);
    });

    it('detects missing agent_assertion fields', () => {
      const ref = parseEvidenceRef('claim: done', 'agent_assertion');
      const missing = checkEvidenceTemplate('agent_assertion', ref);
      expect(missing).toContain('reason_not_system_verified');
    });
  });
});
