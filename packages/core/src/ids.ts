/**
 * Branded identifiers. These exist so a ToolId can never be passed where an
 * AgentId is expected -- the registries and the Supervisor rely on that.
 */
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type DivisionId = Brand<string, 'DivisionId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type SkillId = Brand<string, 'SkillId'>;
export type ToolId = Brand<string, 'ToolId'>;
export type ProviderId = Brand<string, 'ProviderId'>;
export type ModelId = Brand<string, 'ModelId'>;
export type RunId = Brand<string, 'RunId'>;
export type MemoryId = Brand<string, 'MemoryId'>;
export type EvidenceId = Brand<string, 'EvidenceId'>;
export type ClaimId = Brand<string, 'ClaimId'>;
export type ContradictionId = Brand<string, 'ContradictionId'>;

export const divisionId = (value: string): DivisionId => value as DivisionId;
export const agentId = (value: string): AgentId => value as AgentId;
export const skillId = (value: string): SkillId => value as SkillId;
export const toolId = (value: string): ToolId => value as ToolId;
export const providerId = (value: string): ProviderId => value as ProviderId;
export const modelId = (value: string): ModelId => value as ModelId;
export const runId = (value: string): RunId => value as RunId;
export const memoryId = (value: string): MemoryId => value as MemoryId;
export const evidenceId = (value: string): EvidenceId => value as EvidenceId;
export const claimId = (value: string): ClaimId => value as ClaimId;
export const contradictionId = (value: string): ContradictionId => value as ContradictionId;

/** Injectable so runs are reproducible in tests. */
export interface IdGenerator {
  next(prefix: string): string;
}

export const cryptoIdGenerator: IdGenerator = {
  next: (prefix) => `${prefix}_${crypto.randomUUID()}`,
};
