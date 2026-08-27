import { test, expect, describe } from 'bun:test';
import { evaluateExpression } from '../src/evaluate.ts';

const value = (expr: string): number => {
  const r = evaluateExpression(expr);
  if (!r.ok) throw new Error(`expected success for '${expr}': ${r.error.message}`);
  return r.value;
};
const fails = (expr: string): boolean => !evaluateExpression(expr).ok;

describe('arithmetic', () => {
  test('evaluates the basic operators', () => {
    expect(value('1 + 2')).toBe(3);
    expect(value('7 - 9')).toBe(-2);
    expect(value('6 * 7')).toBe(42);
    expect(value('9 / 2')).toBe(4.5);
    expect(value('7 % 3')).toBe(1);
    expect(value('2 ^ 10')).toBe(1024);
  });

  test('honours precedence without parentheses', () => {
    expect(value('2 + 3 * 4')).toBe(14);
    expect(value('2 * 3 + 4')).toBe(10);
    expect(value('2 + 3 ^ 2')).toBe(11);
  });

  test('parentheses override precedence', () => {
    expect(value('(2 + 3) * 4')).toBe(20);
    expect(value('2 * (3 + (4 - 1))')).toBe(12);
  });

  test('exponentiation is right-associative', () => {
    // 2^(3^2) = 512, not (2^3)^2 = 64
    expect(value('2 ^ 3 ^ 2')).toBe(512);
  });

  test('subtraction stays left-associative', () => {
    expect(value('10 - 3 - 2')).toBe(5);
  });

  test('handles unary minus in every position it can appear', () => {
    expect(value('-5')).toBe(-5);
    expect(value('-5 + 3')).toBe(-2);
    expect(value('3 * -2')).toBe(-6);
    expect(value('-(2 + 3)')).toBe(-5);
    expect(value('2 - -3')).toBe(5);
  });

  test('reads decimals and ignores separators', () => {
    expect(value('0.5 + 0.25')).toBe(0.75);
    expect(value('1_000 * 2')).toBe(2000);
  });
});

describe('failures are reported, never guessed at', () => {
  test('division and modulo by zero fail rather than returning Infinity', () => {
    // Infinity would let a wrong answer travel onwards silently.
    expect(fails('1 / 0')).toBe(true);
    expect(fails('1 % 0')).toBe(true);
  });

  test('rejects unbalanced parentheses', () => {
    expect(fails('(1 + 2')).toBe(true);
    expect(fails('1 + 2)')).toBe(true);
  });

  test('rejects malformed expressions', () => {
    expect(fails('1 +')).toBe(true);
    expect(fails('* 2')).toBe(true);
    expect(fails('1 2')).toBe(true);
    expect(fails('')).toBe(true);
    expect(fails('   ')).toBe(true);
  });

  test('an overflowing result is rejected, not returned as Infinity', () => {
    expect(fails('9 ^ 9 ^ 9')).toBe(true);
  });

  test('reports where an unexpected character was found', () => {
    const r = evaluateExpression('1 + a');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_INPUT');
      expect(r.error.details?.['character']).toBe('a');
    }
  });
});

describe('it is not an interpreter', () => {
  // Tool input is attacker-shaped by definition: it can come from a model,
  // which can be influenced by retrieved text. The grammar is closed, so the
  // worst a hostile expression can do is fail.
  test.each([
    'process.exit(1)',
    'require("fs")',
    '__proto__',
    'globalThis',
    '1; console.log(2)',
    'constructor.constructor("return 1")()',
    'fetch("https://example.invalid")',
  ])('refuses to evaluate %p', (hostile) => {
    expect(fails(hostile)).toBe(true);
  });
});
