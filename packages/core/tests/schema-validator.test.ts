import { test, expect, describe } from 'bun:test';
import { createSchemaValidator } from '../src/runtime/schema-validator.ts';

const v = createSchemaValidator();
const issuesOf = (r: ReturnType<typeof v.validate>) =>
  r.ok ? [] : ((r.error.details?.['issues'] as { path: string; message: string }[]) ?? []);

describe('types', () => {
  test('checks primitive types', () => {
    expect(v.validate({ type: 'string' }, 'x').ok).toBe(true);
    expect(v.validate({ type: 'string' }, 1).ok).toBe(false);
    expect(v.validate({ type: 'boolean' }, false).ok).toBe(true);
    expect(v.validate({ type: 'null' }, null).ok).toBe(true);
    expect(v.validate({ type: 'object' }, []).ok).toBe(false);
    expect(v.validate({ type: 'array' }, []).ok).toBe(true);
  });

  test('integer rejects a fractional number, number accepts it', () => {
    expect(v.validate({ type: 'integer' }, 3).ok).toBe(true);
    expect(v.validate({ type: 'integer' }, 3.5).ok).toBe(false);
    expect(v.validate({ type: 'number' }, 3.5).ok).toBe(true);
  });

  test('NaN and Infinity are not valid numbers', () => {
    expect(v.validate({ type: 'number' }, Number.NaN).ok).toBe(false);
    expect(v.validate({ type: 'number' }, Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  test('accepts a union of types', () => {
    const s = { type: ['string', 'null'] };
    expect(v.validate(s, 'x').ok).toBe(true);
    expect(v.validate(s, null).ok).toBe(true);
    expect(v.validate(s, 5).ok).toBe(false);
  });
});

describe('objects', () => {
  const schema = {
    type: 'object',
    properties: { name: { type: 'string' }, age: { type: 'integer', minimum: 0 } },
    required: ['name'],
    additionalProperties: false,
  };

  test('accepts a valid object', () => {
    expect(v.validate(schema, { name: 'a', age: 3 }).ok).toBe(true);
  });

  test('reports a missing required property at its own path', () => {
    const r = v.validate(schema, { age: 3 });
    expect(r.ok).toBe(false);
    expect(issuesOf(r)[0]?.path).toBe('/name');
  });

  test('rejects an unexpected property when additionalProperties is false', () => {
    const r = v.validate(schema, { name: 'a', nope: 1 });
    expect(r.ok).toBe(false);
    expect(issuesOf(r)[0]?.path).toBe('/nope');
  });

  test('additionalProperties as a schema validates the extras', () => {
    const s = { type: 'object', properties: {}, additionalProperties: { type: 'number' } };
    expect(v.validate(s, { a: 1, b: 2 }).ok).toBe(true);
    expect(v.validate(s, { a: 'x' }).ok).toBe(false);
  });

  test('reports every issue, not just the first', () => {
    const r = v.validate(schema, { age: -1, extra: true });
    expect(issuesOf(r).length).toBeGreaterThanOrEqual(3);
  });

  test('nested paths are reported accurately', () => {
    const s = {
      type: 'object',
      properties: { user: { type: 'object', properties: { id: { type: 'integer' } } } },
    };
    const r = v.validate(s, { user: { id: 'x' } });
    expect(issuesOf(r)[0]?.path).toBe('/user/id');
  });
});

describe('arrays', () => {
  test('validates items, length and uniqueness', () => {
    const s = { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 };
    expect(v.validate(s, ['a']).ok).toBe(true);
    expect(v.validate(s, []).ok).toBe(false);
    expect(v.validate(s, ['a', 'b', 'c']).ok).toBe(false);
    expect(v.validate(s, [1]).ok).toBe(false);
    expect(v.validate({ type: 'array', uniqueItems: true }, [{ a: 1 }, { a: 1 }]).ok).toBe(false);
  });

  test('reports the failing index', () => {
    const r = v.validate({ type: 'array', items: { type: 'string' } }, ['a', 2]);
    expect(issuesOf(r)[0]?.path).toBe('/1');
  });
});

describe('strings and numbers', () => {
  test('length is counted in code points, not UTF-16 units', () => {
    // A single emoji is one character but two UTF-16 units.
    expect(v.validate({ type: 'string', maxLength: 1 }, '\u{1F600}').ok).toBe(true);
  });

  test('applies pattern', () => {
    const s = { type: 'string', pattern: '^ab+$' };
    expect(v.validate(s, 'abb').ok).toBe(true);
    expect(v.validate(s, 'ba').ok).toBe(false);
  });

  test('an invalid pattern is a schema error, not a validation failure', () => {
    const r = v.validate({ type: 'string', pattern: '([' }, 'x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNSUPPORTED');
  });

  test('applies numeric bounds and multipleOf', () => {
    expect(v.validate({ minimum: 0, maximum: 10 }, 5).ok).toBe(true);
    expect(v.validate({ minimum: 0 }, -1).ok).toBe(false);
    expect(v.validate({ exclusiveMaximum: 10 }, 10).ok).toBe(false);
    expect(v.validate({ multipleOf: 0.5 }, 1.5).ok).toBe(true);
    expect(v.validate({ multipleOf: 2 }, 3).ok).toBe(false);
  });
});

describe('enum, const and combinators', () => {
  test('enum and const compare deeply', () => {
    expect(v.validate({ enum: ['a', 'b'] }, 'b').ok).toBe(true);
    expect(v.validate({ enum: ['a'] }, 'z').ok).toBe(false);
    expect(v.validate({ const: { a: [1] } }, { a: [1] }).ok).toBe(true);
    expect(v.validate({ const: { a: [1] } }, { a: [2] }).ok).toBe(false);
  });

  test('anyOf, oneOf, allOf and not', () => {
    expect(v.validate({ anyOf: [{ type: 'string' }, { type: 'number' }] }, 1).ok).toBe(true);
    expect(v.validate({ anyOf: [{ type: 'string' }] }, true).ok).toBe(false);
    // oneOf demands exactly one match; both branches match here, so it fails.
    expect(v.validate({ oneOf: [{ type: 'number' }, { minimum: 0 }] }, 1).ok).toBe(false);
    expect(v.validate({ oneOf: [{ type: 'number' }, { type: 'string' }] }, 1).ok).toBe(true);
    expect(v.validate({ allOf: [{ type: 'number' }, { minimum: 5 }] }, 4).ok).toBe(false);
    expect(v.validate({ not: { type: 'string' } }, 1).ok).toBe(true);
    expect(v.validate({ not: { type: 'string' } }, 'x').ok).toBe(false);
  });

  test('boolean schemas', () => {
    expect(v.validate(true as never, 'anything').ok).toBe(true);
    expect(v.validate(false as never, 'anything').ok).toBe(false);
  });
});

describe('honesty about what it cannot enforce', () => {
  test('annotations are ignored', () => {
    const s = { type: 'string', title: 'Name', description: 'x', examples: ['a'], default: 'a' };
    expect(v.validate(s, 'ok').ok).toBe(true);
  });

  test('an unknown non-assertion keyword is ignored', () => {
    expect(v.validate({ type: 'string', 'x-vendor-hint': 1 }, 'ok').ok).toBe(true);
  });

  test.each([
    '$ref',
    'patternProperties',
    'if',
    'dependentRequired',
    'propertyNames',
    'contains',
    'prefixItems',
    'unevaluatedProperties',
  ])('refuses to silently ignore the assertion `%s`', (keyword) => {
    const r = v.validate({ type: 'object', [keyword]: {} }, {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('UNSUPPORTED');
      expect(r.error.message).toContain(keyword);
    }
  });

  test('rejects the tuple form of items rather than under-validating', () => {
    const r = v.validate({ type: 'array', items: [{ type: 'string' }] }, ['a', 'b']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNSUPPORTED');
  });

  test('a malformed schema is UNSUPPORTED, not a crash', () => {
    const r = v.validate({ type: 'object', properties: { a: 42 } } as never, { a: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNSUPPORTED');
  });
});
