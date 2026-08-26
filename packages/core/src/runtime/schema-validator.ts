/**
 * JSON Schema validation over a deliberate subset -- zero dependencies.
 *
 * The `SchemaValidator` seam has existed since Phase 1 with no implementation.
 * This fills it (spec §27 A12) without adding a dependency to a Core that has
 * none.
 *
 * ## The rule that shapes this file
 *
 * JSON Schema says unknown keywords are annotations and may be ignored. That is
 * safe for `title` or `description`. It is NOT safe for a keyword that asserts
 * something: silently ignoring `patternProperties` or `$ref` would make
 * validation pass inputs it should reject, which is worse than no validation at
 * all because it looks like a guarantee.
 *
 * So: annotations are ignored, and **unsupported assertions are rejected** with
 * a message naming the keyword. A schema either validates honestly or says it
 * cannot.
 *
 * Swapping in a full JSON Schema library later means implementing the same
 * `SchemaValidator` interface -- that is why the seam exists (ADR notes in
 * ARCHITECTURE.md §4).
 */
import { type Result, ok, err } from '../result.ts';
import { nexusError } from '../errors.ts';
import type { JsonSchema, SchemaValidator } from '../contracts/model-provider.ts';

export interface ValidationIssue {
  /** JSON-pointer-ish location, e.g. `/user/name` or `` for the root. */
  readonly path: string;
  readonly message: string;
}

/**
 * Assertions we do not implement. Rejected rather than ignored, because
 * ignoring an assertion silently weakens the schema.
 */
const UNSUPPORTED_ASSERTIONS = [
  '$ref',
  '$dynamicRef',
  'patternProperties',
  'dependentSchemas',
  'dependentRequired',
  'dependencies',
  'if',
  'then',
  'else',
  'propertyNames',
  'contains',
  'prefixItems',
  'unevaluatedProperties',
  'unevaluatedItems',
] as const;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep equality sufficient for `enum` and `const` over JSON values. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && jsonEqual(a[k], b[k]));
  }
  return false;
}

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isObject(value);
    default:
      return false;
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

class SchemaError extends Error {}

function check(schema: unknown, value: unknown, path: string, issues: ValidationIssue[]): void {
  // A boolean schema: `true` accepts anything, `false` rejects everything.
  if (schema === true) return;
  if (schema === false) {
    issues.push({ path, message: 'schema is `false`: no value is valid here' });
    return;
  }
  if (!isObject(schema)) {
    throw new SchemaError(`schema at '${path || '/'}' must be an object or boolean`);
  }

  for (const keyword of UNSUPPORTED_ASSERTIONS) {
    if (keyword in schema) {
      throw new SchemaError(
        `unsupported schema keyword '${keyword}' at '${path || '/'}': this validator covers a ` +
          `subset of JSON Schema and refuses to ignore an assertion it cannot enforce`,
      );
    }
  }

  const fail = (message: string) => issues.push({ path, message });

  // --- combinators -------------------------------------------------------
  if ('not' in schema) {
    const inner: ValidationIssue[] = [];
    check(schema['not'], value, path, inner);
    if (inner.length === 0) fail('value matches `not` schema');
  }

  if (Array.isArray(schema['allOf'])) {
    for (const sub of schema['allOf']) check(sub, value, path, issues);
  }

  if (Array.isArray(schema['anyOf'])) {
    const matched = schema['anyOf'].some((sub) => {
      const inner: ValidationIssue[] = [];
      check(sub, value, path, inner);
      return inner.length === 0;
    });
    if (!matched) fail('value matches none of the `anyOf` schemas');
  }

  if (Array.isArray(schema['oneOf'])) {
    const matches = schema['oneOf'].filter((sub) => {
      const inner: ValidationIssue[] = [];
      check(sub, value, path, inner);
      return inner.length === 0;
    }).length;
    if (matches !== 1) fail(`value must match exactly one \`oneOf\` schema, matched ${matches}`);
  }

  // --- type --------------------------------------------------------------
  const type = schema['type'];
  if (typeof type === 'string') {
    if (!typeMatches(value, type)) {
      fail(`expected ${type}, received ${describe(value)}`);
      return; // further keywords assume the type; stop to avoid noise
    }
  } else if (Array.isArray(type)) {
    if (!type.some((t) => typeof t === 'string' && typeMatches(value, t))) {
      fail(`expected one of ${type.join(', ')}, received ${describe(value)}`);
      return;
    }
  }

  // --- const / enum ------------------------------------------------------
  if ('const' in schema && !jsonEqual(value, schema['const'])) {
    fail(`expected the constant ${JSON.stringify(schema['const'])}`);
  }
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && !enumValues.some((allowed) => jsonEqual(value, allowed))) {
    fail(`expected one of ${enumValues.map((v) => JSON.stringify(v)).join(', ')}`);
  }

  // --- numbers -----------------------------------------------------------
  if (typeof value === 'number') {
    const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf } = schema as Record<
      string,
      unknown
    >;
    if (typeof minimum === 'number' && value < minimum) fail(`must be >= ${minimum}`);
    if (typeof maximum === 'number' && value > maximum) fail(`must be <= ${maximum}`);
    if (typeof exclusiveMinimum === 'number' && value <= exclusiveMinimum) {
      fail(`must be > ${exclusiveMinimum}`);
    }
    if (typeof exclusiveMaximum === 'number' && value >= exclusiveMaximum) {
      fail(`must be < ${exclusiveMaximum}`);
    }
    if (typeof multipleOf === 'number' && multipleOf > 0) {
      const ratio = value / multipleOf;
      if (Math.abs(ratio - Math.round(ratio)) > Number.EPSILON * 1e3) {
        fail(`must be a multiple of ${multipleOf}`);
      }
    }
  }

  // --- strings -----------------------------------------------------------
  if (typeof value === 'string') {
    const { minLength, maxLength, pattern } = schema as Record<string, unknown>;
    // Length in code points, not UTF-16 units, per JSON Schema.
    const length = [...value].length;
    if (typeof minLength === 'number' && length < minLength) {
      fail(`must be at least ${minLength} characters`);
    }
    if (typeof maxLength === 'number' && length > maxLength) {
      fail(`must be at most ${maxLength} characters`);
    }
    if (typeof pattern === 'string') {
      let re: RegExp;
      try {
        re = new RegExp(pattern, 'u');
      } catch {
        throw new SchemaError(`invalid \`pattern\` at '${path || '/'}': ${pattern}`);
      }
      if (!re.test(value)) fail(`must match /${pattern}/`);
    }
  }

  // --- arrays ------------------------------------------------------------
  if (Array.isArray(value)) {
    const { minItems, maxItems, uniqueItems, items } = schema as Record<string, unknown>;
    if (typeof minItems === 'number' && value.length < minItems) {
      fail(`must have at least ${minItems} items`);
    }
    if (typeof maxItems === 'number' && value.length > maxItems) {
      fail(`must have at most ${maxItems} items`);
    }
    if (uniqueItems === true) {
      const duplicated = value.some((a, i) => value.slice(i + 1).some((b) => jsonEqual(a, b)));
      if (duplicated) fail('items must be unique');
    }
    if (items !== undefined) {
      if (Array.isArray(items)) {
        throw new SchemaError(
          `tuple form of \`items\` at '${path || '/'}' is not supported; use a single schema`,
        );
      }
      value.forEach((entry, i) => check(items, entry, `${path}/${i}`, issues));
    }
  }

  // --- objects -----------------------------------------------------------
  if (isObject(value)) {
    const required = schema['required'];
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === 'string' && !(key in value)) {
          issues.push({ path: `${path}/${key}`, message: 'required property is missing' });
        }
      }
    }

    const properties = isObject(schema['properties']) ? schema['properties'] : undefined;
    if (properties) {
      for (const [key, sub] of Object.entries(properties)) {
        if (key in value) check(sub, value[key], `${path}/${key}`, issues);
      }
    }

    const additional = schema['additionalProperties'];
    if (additional !== undefined && additional !== true) {
      const known = new Set(properties ? Object.keys(properties) : []);
      for (const key of Object.keys(value)) {
        if (known.has(key)) continue;
        if (additional === false) {
          issues.push({ path: `${path}/${key}`, message: 'unexpected additional property' });
        } else {
          check(additional, value[key], `${path}/${key}`, issues);
        }
      }
    }
  }
}

/**
 * Validates against the supported subset. Returns INVALID_INPUT with every
 * issue found (not just the first), or UNSUPPORTED when the schema itself uses
 * a keyword this validator refuses to pretend to enforce.
 */
export function createSchemaValidator(): SchemaValidator {
  return {
    validate(schema: JsonSchema, value: unknown): Result<void> {
      const issues: ValidationIssue[] = [];
      try {
        check(schema, value, '', issues);
      } catch (cause) {
        if (cause instanceof SchemaError) {
          return err(nexusError('UNSUPPORTED', cause.message, { cause }));
        }
        throw cause;
      }
      if (issues.length === 0) return ok(undefined);
      return err(
        nexusError('INVALID_INPUT', `${issues.length} validation issue(s)`, {
          details: {
            issues: issues.map((i) => ({ path: i.path || '/', message: i.message })),
          },
        }),
      );
    },
  };
}

/** Shared instance; the validator is stateless. */
export const schemaValidator: SchemaValidator = createSchemaValidator();
