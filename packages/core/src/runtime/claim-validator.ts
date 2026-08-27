/**
 * The reference `ClaimValidator` (spec §6.1).
 *
 * The contract lives in `contracts/claim.ts`; this is its implementation, and
 * it belongs in the Core rather than in a division for one reason: §6.1 is a
 * system-wide rule about what an assertion must carry, not a Research
 * convention. Research produces claims and so does Finance, and two divisions
 * enforcing "a fact without evidence is a defect" separately would eventually
 * enforce two slightly different versions of it.
 *
 * Structural enforcement is the whole point. A rule kept by convention is one a
 * model under pressure to sound confident will eventually break.
 */
import type { Claim, ClaimValidator } from '../contracts/claim.ts';
import { type Result, ok, err } from '../result.ts';
import { nexusError } from '../errors.ts';

export function createClaimValidator(): ClaimValidator {
  return {
    validate(claim: Claim): Result<void> {
      // Every problem is collected before returning. Reporting only the first
      // turns fixing a malformed claim into a guessing game.
      const problems: string[] = [];

      if (claim.statement.trim() === '') problems.push('statement is empty');
      if (claim.subject.trim() === '') problems.push('subject is empty');
      if (!Number.isFinite(claim.confidence) || claim.confidence < 0 || claim.confidence > 1) {
        problems.push('confidence must be between 0 and 1');
      }

      switch (claim.status) {
        case 'fact':
          // §6.1: "A FACT without evidence is a defect, not a stylistic issue."
          if (claim.supportedBy.length === 0) {
            problems.push('a fact must cite at least one piece of evidence');
          }
          break;
        case 'inference':
          if (claim.derivedFrom.length === 0) {
            problems.push('an inference must name the claims it derives from');
          }
          break;
        case 'recommendation':
          if (claim.derivedFrom.length === 0) {
            problems.push('a recommendation must name the claims it derives from');
          }
          if (claim.assumptions.length === 0) {
            problems.push('a recommendation must state its assumptions');
          }
          break;
        case 'uncertain':
          if (!claim.uncertaintyReason || claim.uncertaintyReason.trim() === '') {
            problems.push('an uncertain claim must say what is missing or conflicting');
          }
          break;
      }

      if (problems.length > 0) {
        return err(
          nexusError('INVALID_INPUT', `invalid ${claim.status} claim: ${problems.join('; ')}`, {
            details: { claimId: claim.id, status: claim.status, problems },
          }),
        );
      }
      return ok(undefined);
    },
  };
}
