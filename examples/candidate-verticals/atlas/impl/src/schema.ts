// Minimal JSON Schema validator for the ATLAS V0 schemas (draft 2020-12 subset).
// Supports exactly the keywords the three committed schemas use:
// $defs/$ref (local only), type, const, enum, pattern, format (date/date-time),
// required, properties, additionalProperties, items, minItems, maxItems,
// minimum, maximum, oneOf. Anything else in a schema is ignored.
//
// Failures carry RFC 6901 JSON pointers so a rejection names the exact path,
// never just "invalid".

export interface ValidationIssue {
  pointer: string; // JSON pointer, '' = document root
  message: string;
}

type Schema = Record<string, any>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

function esc(seg: string | number): string {
  return '/' + String(seg).replace(/~/g, '~0').replace(/\//g, '~1');
}

function joinPtr(base: string, seg: string | number): string {
  return base + esc(seg);
}

function checkFormat(format: string, value: string): string | null {
  if (format === 'date') return DATE_RE.test(value) ? null : 'must be a date (YYYY-MM-DD)';
  if (format === 'date-time') {
    if (!DATE_TIME_RE.test(value)) return 'must be an ISO 8601 date-time with offset';
    if (Number.isNaN(Date.parse(value))) return 'must be a parseable date-time';
    return null;
  }
  return null; // unknown formats are not enforced
}

function typeMatches(t: string, value: unknown): boolean {
  switch (t) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    default: return false;
  }
}

export function createValidator(root: Schema) {
  function resolveRef(ref: string): Schema {
    if (ref === '#') return root;
    if (ref.startsWith('#/$defs/')) {
      const name = ref.slice('#/$defs/'.length);
      const def = root.$defs?.[name];
      if (!def) throw new Error(`unresolvable $ref ${ref}`);
      return def;
    }
    throw new Error(`unsupported $ref ${ref} (only local #/$defs refs are supported)`);
  }

  function validate(schema: Schema, value: unknown, ptr: string, issues: ValidationIssue[]): void {
    if (schema.$ref) {
      validate(resolveRef(schema.$ref), value, ptr, issues);
      return;
    }
    if (schema.const !== undefined && !deepEqual(schema.const, value)) {
      issues.push({ pointer: ptr, message: `must equal constant ${JSON.stringify(schema.const)}` });
    }
    if (schema.enum && !schema.enum.some((e: unknown) => deepEqual(e, value))) {
      issues.push({ pointer: ptr, message: `must be one of ${JSON.stringify(schema.enum)}` });
    }
    if (schema.type) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((t: string) => typeMatches(t, value))) {
        issues.push({ pointer: ptr, message: `must be of type ${types.join('|')}` });
        return; // further checks are meaningless on a mistyped value
      }
    }
    if (typeof value === 'string') {
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        issues.push({ pointer: ptr, message: `must match pattern ${schema.pattern}` });
      }
      if (schema.format) {
        const err = checkFormat(schema.format, value);
        if (err) issues.push({ pointer: ptr, message: err });
      }
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        issues.push({ pointer: ptr, message: `must be >= ${schema.minimum}` });
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        issues.push({ pointer: ptr, message: `must be <= ${schema.maximum}` });
      }
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        issues.push({ pointer: ptr, message: `must have at least ${schema.minItems} items` });
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        issues.push({ pointer: ptr, message: `must have at most ${schema.maxItems} items` });
      }
      if (schema.items) {
        value.forEach((item, i) => validate(schema.items, item, joinPtr(ptr, i), issues));
      }
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if (schema.required) {
        for (const key of schema.required) {
          if (!(key in obj)) issues.push({ pointer: ptr, message: `missing required property '${key}'` });
        }
      }
      const props: Record<string, Schema> = schema.properties ?? {};
      for (const key of Object.keys(obj)) {
        const childPtr = joinPtr(ptr, key);
        if (key in props) {
          validate(props[key], obj[key], childPtr, issues);
        } else if (schema.additionalProperties === false) {
          issues.push({ pointer: childPtr, message: `unexpected property '${key}'` });
        } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          validate(schema.additionalProperties, obj[key], childPtr, issues);
        }
      }
    }
    if (schema.oneOf) {
      const passing = schema.oneOf.filter((sub: Schema) => {
        const subIssues: ValidationIssue[] = [];
        validate(sub, value, ptr, subIssues);
        return subIssues.length === 0;
      }).length;
      if (passing !== 1) {
        issues.push({ pointer: ptr, message: `must match exactly one subschema (matched ${passing})` });
      }
    }
  }

  return {
    validate(value: unknown): ValidationIssue[] {
      const issues: ValidationIssue[] = [];
      validate(root, value, '', issues);
      return issues;
    },
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, (b as unknown[])[i]));
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  const ak = Object.keys(ao), bk = Object.keys(bo);
  return ak.length === bk.length && ak.every((k) => k in bo && deepEqual(ao[k], bo[k]));
}

/** Load a JSON document and validate it against a schema file. */
export async function loadJsonFile(path: string): Promise<unknown> {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(path, 'utf8'));
}
