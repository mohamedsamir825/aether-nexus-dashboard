/**
 * `math.evaluate` — arithmetic as a NEXUS Tool.
 *
 * The first real tool in the system, and deliberately a boring one: the point
 * is to prove the whole path (permissions -> belt -> schema -> execution ->
 * evidence -> budget -> events) with a capability whose correctness is not in
 * question. Finance will need exactly this later.
 *
 * Two contract choices worth naming:
 *
 * - `sideEffect: 'none'`. Evaluation touches nothing outside the process, so it
 *   needs no external-write authorisation (spec §20.2).
 * - `producesEvidence: true`. A computed number IS a claim, and the expression
 *   that produced it is the evidence for it. Declaring this also exercises the
 *   ToolBelt guarantee that rejects a tool claiming evidence and returning none.
 */
import {
  type Evidence,
  type ExecutionContext,
  type Result,
  type SchemaValidator,
  type Tool,
  type ToolDescriptor,
  type ToolOutcome,
  err,
  evidenceId,
  nexusError,
  ok,
  schemaValidator as defaultValidator,
  toolId,
} from '@nexus/core';
import { evaluateExpression } from './evaluate.ts';

export const MATH_EVALUATE_TOOL_ID = toolId('math.evaluate');

export interface MathEvaluateInput {
  readonly expression: string;
  /** Round the result to this many decimal places. Omitted means full precision. */
  readonly precision?: number;
}

export interface MathEvaluateOutput {
  readonly expression: string;
  readonly result: number;
}

export const mathEvaluateDescriptor: ToolDescriptor = {
  id: MATH_EVALUATE_TOOL_ID,
  name: 'math.evaluate',
  description:
    'Evaluates an arithmetic expression over + - * / % ^ and parentheses. ' +
    'No variables, no functions, no external data.',
  version: '1.0.0',
  inputSchema: {
    type: 'object',
    properties: {
      expression: { type: 'string', minLength: 1, maxLength: 1_000 },
      precision: { type: 'integer', minimum: 0, maximum: 15 },
    },
    required: ['expression'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: { expression: { type: 'string' }, result: { type: 'number' } },
    required: ['expression', 'result'],
    additionalProperties: false,
  },
  requiredCapabilities: ['tool:execute'],
  sideEffect: 'none',
  producesEvidence: true,
};

export interface CreateMathEvaluateToolOptions {
  /** Injectable so a stricter validator can be swapped in later. */
  readonly validator?: SchemaValidator;
}

export function createMathEvaluateTool(
  options: CreateMathEvaluateToolOptions = {},
): Tool<MathEvaluateInput, MathEvaluateOutput> {
  const validator = options.validator ?? defaultValidator;

  return {
    descriptor: mathEvaluateDescriptor,

    validate(input: unknown): Result<MathEvaluateInput> {
      const valid = validator.validate(mathEvaluateDescriptor.inputSchema, input);
      if (!valid.ok) return valid;
      // The schema has already established the shape; this cast is the one
      // place the two type systems meet.
      return ok(input as MathEvaluateInput);
    },

    async execute(
      input: MathEvaluateInput,
      context: ExecutionContext,
    ): Promise<Result<ToolOutcome<MathEvaluateOutput>>> {
      const evaluated = evaluateExpression(input.expression);
      if (!evaluated.ok) return evaluated;

      const result =
        input.precision === undefined
          ? evaluated.value
          : Number(evaluated.value.toFixed(input.precision));

      if (!Number.isFinite(result)) {
        return err(nexusError('INVALID_INPUT', 'result is not a finite number'));
      }

      const evidence: Evidence = {
        id: evidenceId(`ev_${context.runId}_math`),
        // The claim is the equation; the evidence for it is the computation.
        claim: `${input.expression} = ${result}`,
        source: {
          kind: 'computation',
          title: `${mathEvaluateDescriptor.name}@${mathEvaluateDescriptor.version}`,
          retrievedAt: context.clock.now().toISOString(),
        },
        excerpt: input.expression,
        // Deterministic arithmetic over a closed grammar: nothing is inferred.
        confidence: 1,
      };

      return ok({
        output: { expression: input.expression, result },
        evidence: [evidence],
      });
    },

    async health() {
      return {
        component: `tool:${mathEvaluateDescriptor.name}`,
        status: 'healthy' as const,
        checkedAt: new Date().toISOString(),
        detail: 'pure computation; no external dependency',
      };
    },
  };
}
