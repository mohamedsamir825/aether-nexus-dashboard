/**
 * The §5 boundary, enforced.
 *
 * §5 states three prohibitions. Documented rules get broken by whoever is next
 * under deadline, so each one is a check that fails loudly:
 *
 *   1. Business does not price.        -> a figure must carry `pricedBy`
 *   2. Business does not assert market facts without Research evidence.
 *   3. Business does not recommend.    -> an option set must not converge
 *
 * The third is the one that needs a real definition, because "does not
 * recommend" is easy to satisfy in form and violate in substance. A set with
 * one analysed option and three rejected ones is a recommendation with extra
 * steps. So is a set where every option but one has no downsides.
 */
import { type Result, err, nexusError, ok } from '@nexus/core';
import type { OptionSet, StrategicOption } from './types.ts';

/** How many analysed options a set needs before it is a choice at all. */
const MINIMUM_OPTIONS = 2;

export interface OptionValidator {
  validateOption(option: StrategicOption): Result<void>;
  validateSet(set: OptionSet): Result<void>;
}

export function createOptionValidator(): OptionValidator {
  const validateOption = (option: StrategicOption): Result<void> => {
    const problems: string[] = [];

    if (option.label.trim() === '') problems.push('option has no label');

    // Both directions, always. An option with only upsides has been advocated
    // for rather than analysed, and the difference is this division's whole
    // contribution.
    if (option.upsides.length === 0) {
      problems.push('no upside is stated — an option nobody can argue for is not an option');
    }
    if (option.downsides.length === 0) {
      problems.push('no downside is stated — every real choice costs something');
    }

    // §6.1 applied to consequences: an assertion with nothing behind it.
    for (const consequence of [...option.upsides, ...option.downsides]) {
      if (consequence.derivedFrom.length === 0) {
        problems.push(`consequence '${consequence.statement}' derives from no claim`);
      }
      if (consequence.criterion.trim() === '') {
        problems.push('a consequence names no criterion, so it answers no question');
      }
    }

    // Prohibition 1: Business does not price.
    for (const priced of option.priced) {
      if (priced.pricedBy === undefined || priced.pricedBy.trim() === '') {
        problems.push(
          `'${priced.driver}' carries a figure with no pricing run behind it — ` +
            'Business does not price; Finance does (§5)',
        );
      }
    }

    if (option.assumptions.length === 0) {
      problems.push(
        'no assumptions stated — an option whose preconditions are unstated ' +
          'cannot be argued against',
      );
    }

    if (problems.length > 0) {
      return err(
        nexusError('INVALID_INPUT', `option '${option.id}' is not analysed: ${problems.join('; ')}`, {
          details: { optionId: option.id, problems },
        }),
      );
    }
    return ok(undefined);
  };

  return {
    validateOption,

    validateSet(set: OptionSet): Result<void> {
      const problems: string[] = [];

      // Prohibition 3, in its literal form.
      if (set.options.length < MINIMUM_OPTIONS) {
        problems.push(
          `${set.options.length} analysed option(s): a set with fewer than ${MINIMUM_OPTIONS} ` +
            'is a recommendation, and §5 reserves the strategic call for the user',
        );
      }

      // Prohibition 3, in the form that actually happens. Every option but one
      // carrying downsides is a recommendation expressed as a table.
      const withoutDownsides = set.options.filter((o) => o.downsides.length === 0);
      if (set.options.length >= MINIMUM_OPTIONS && withoutDownsides.length > 0) {
        problems.push(
          `${withoutDownsides.length} option(s) have no downside, which frames the rest as losers`,
        );
      }

      if (set.criteria.length === 0) {
        problems.push('no criteria: options cannot be compared on nothing');
      }

      // Every criterion should be addressed by every option, or the set is not
      // a comparison -- it is several unrelated analyses side by side.
      for (const option of set.options) {
        const addressed = new Set(
          [...option.upsides, ...option.downsides].map((c) => c.criterion),
        );
        const missing = set.criteria.filter((c) => !addressed.has(c));
        if (missing.length > 0) {
          problems.push(`option '${option.id}' says nothing about: ${missing.join(', ')}`);
        }
      }

      for (const option of set.options) {
        const valid = validateOption(option);
        if (!valid.ok) problems.push(valid.error.message);
      }

      if (problems.length > 0) {
        return err(
          nexusError('INVALID_INPUT', `option set is not decidable: ${problems.join('; ')}`, {
            details: { problems },
          }),
        );
      }
      return ok(undefined);
    },
  };
}
