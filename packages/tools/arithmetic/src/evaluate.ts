/**
 * A small, safe arithmetic evaluator.
 *
 * `eval()` and `new Function()` are not options: tool input is attacker-shaped
 * by definition -- it can originate from a model, which can be influenced by
 * retrieved text. This is a tokeniser and a shunting-yard parser over a closed
 * grammar, so the worst a malformed expression can do is fail.
 *
 * Grammar: decimal numbers, `+ - * / % ^`, unary minus, and parentheses.
 */
import { type Result, ok, err, nexusError } from '@nexus/core';

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'operator'; value: string }
  | { kind: 'paren'; value: '(' | ')' };

/**
 * Exponentiation binds tighter than unary minus, so `-2^2` is -(2^2) = -4.
 *
 * The original table gave unary minus the highest precedence, which produced
 * (-2)^2 = 4. That is Excel's reading; it is not mathematical convention, and
 * it is not what Python or a scientific calculator does. For a package Finance
 * will eventually use, silently returning the wrong sign is the worst kind of
 * bug -- it looks like an answer.
 */
const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, u: 3, '^': 4 };
const RIGHT_ASSOCIATIVE = new Set(['^', 'u']);
/** Prefix operators take no left operand, so they never pop on the way in. */
const PREFIX = new Set(['u', 'p']);

function tokenize(input: string): Result<Token[]> {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i] as string;

    if (ch === ' ' || ch === '\t' || ch === '\n') {
      i += 1;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      // `_` is a digit separator INSIDE a literal (1_000), so it is consumed
      // here rather than skipped as whitespace -- skipping it would split the
      // literal into two adjacent numbers and read as malformed.
      let literal = '';
      while (i < input.length && /[0-9._]/.test(input[i] as string)) literal += input[i++];
      const digits = literal.replace(/_/g, '');
      const value = Number(digits);
      if (digits === '' || !/[0-9]/.test(digits) || !Number.isFinite(value)) {
        return err(nexusError('INVALID_INPUT', `not a number: '${literal}'`));
      }
      tokens.push({ kind: 'number', value });
      continue;
    }

    if ('+-*/%^'.includes(ch)) {
      // Unary minus: a '-' with no value before it negates rather than subtracts.
      const previous = tokens[tokens.length - 1];
      const atPrefixPosition =
        previous === undefined ||
        previous.kind === 'operator' ||
        (previous.kind === 'paren' && previous.value === '(');
      const value =
        atPrefixPosition && ch === '-' ? 'u'
        : atPrefixPosition && ch === '+' ? 'p'
        : ch;
      tokens.push({ kind: 'operator', value });
      i += 1;
      continue;
    }

    if (ch === '(' || ch === ')') {
      tokens.push({ kind: 'paren', value: ch });
      i += 1;
      continue;
    }

    return err(
      nexusError('INVALID_INPUT', `unexpected character '${ch}' at position ${i}`, {
        details: { position: i, character: ch },
      }),
    );
  }

  if (tokens.length === 0) {
    return err(nexusError('INVALID_INPUT', 'expression is empty'));
  }
  return ok(tokens);
}

/** Shunting-yard: infix tokens to reverse Polish notation. */
function toRpn(tokens: readonly Token[]): Result<Token[]> {
  const output: Token[] = [];
  const operators: Token[] = [];

  for (const token of tokens) {
    if (token.kind === 'number') {
      output.push(token);
      continue;
    }

    if (token.kind === 'operator') {
      // A prefix operator binds to what follows it, so it pops nothing.
      if (PREFIX.has(token.value)) {
        operators.push(token);
        continue;
      }
      while (operators.length > 0) {
        const top = operators[operators.length - 1];
        if (!top || top.kind !== 'operator') break;
        const higher = (PRECEDENCE[top.value] ?? 0) > (PRECEDENCE[token.value] ?? 0);
        const equalAndLeft =
          (PRECEDENCE[top.value] ?? 0) === (PRECEDENCE[token.value] ?? 0) &&
          !RIGHT_ASSOCIATIVE.has(token.value);
        if (!higher && !equalAndLeft) break;
        output.push(operators.pop() as Token);
      }
      operators.push(token);
      continue;
    }

    if (token.value === '(') {
      operators.push(token);
    } else {
      let balanced = false;
      while (operators.length > 0) {
        const top = operators.pop() as Token;
        if (top.kind === 'paren' && top.value === '(') {
          balanced = true;
          break;
        }
        output.push(top);
      }
      if (!balanced) return err(nexusError('INVALID_INPUT', 'unbalanced closing parenthesis'));
    }
  }

  while (operators.length > 0) {
    const top = operators.pop() as Token;
    if (top.kind === 'paren') return err(nexusError('INVALID_INPUT', 'unbalanced opening parenthesis'));
    output.push(top);
  }

  return ok(output);
}

function evaluateRpn(rpn: readonly Token[]): Result<number> {
  const stack: number[] = [];

  for (const token of rpn) {
    if (token.kind === 'number') {
      stack.push(token.value);
      continue;
    }
    if (token.kind !== 'operator') {
      return err(nexusError('INVALID_INPUT', 'malformed expression'));
    }

    if (token.value === 'u' || token.value === 'p') {
      const operand = stack.pop();
      if (operand === undefined) return err(nexusError('INVALID_INPUT', 'malformed expression'));
      stack.push(token.value === 'u' ? -operand : operand);
      continue;
    }

    const right = stack.pop();
    const left = stack.pop();
    if (left === undefined || right === undefined) {
      return err(nexusError('INVALID_INPUT', 'malformed expression'));
    }

    switch (token.value) {
      case '+':
        stack.push(left + right);
        break;
      case '-':
        stack.push(left - right);
        break;
      case '*':
        stack.push(left * right);
        break;
      case '/':
        // Returning Infinity would let a wrong answer travel onwards silently.
        if (right === 0) return err(nexusError('INVALID_INPUT', 'division by zero'));
        stack.push(left / right);
        break;
      case '%':
        if (right === 0) return err(nexusError('INVALID_INPUT', 'modulo by zero'));
        stack.push(left % right);
        break;
      case '^':
        stack.push(left ** right);
        break;
      default:
        return err(nexusError('INVALID_INPUT', `unknown operator '${token.value}'`));
    }
  }

  const result = stack.pop();
  if (result === undefined || stack.length > 0) {
    return err(nexusError('INVALID_INPUT', 'malformed expression'));
  }
  if (!Number.isFinite(result)) {
    return err(nexusError('INVALID_INPUT', 'result is not a finite number'));
  }
  return ok(result);
}

export function evaluateExpression(expression: string): Result<number> {
  const tokens = tokenize(expression);
  if (!tokens.ok) return tokens;
  const rpn = toRpn(tokens.value);
  if (!rpn.ok) return rpn;
  return evaluateRpn(rpn.value);
}
