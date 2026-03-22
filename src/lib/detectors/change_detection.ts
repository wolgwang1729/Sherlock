import { TransactionAnalysis, HeuristicResult, Confidence } from '../../types';
import { isCoinbase, getSpendableOutputs, isRoundSatValue } from '../../utils';
import { normalizeSummaryScriptType, getDustLimitByScriptType, deriveInputOwnershipTypes } from './utils';
import { detectBip69Fingerprint } from './bip69_fingerprint';

const CHANGE_DETECTION_MIN_SCORE = 2.5;
const CHANGE_DETECTION_AMBIGUITY_GAP = 0.75;
// Output below this share of total inputs can plausibly be change rather than full payment.
const CHANGE_DETECTION_MAX_CHANGE_SHARE = 0.9;
// Confidence bucket boundaries for accepted candidates.
const CHANGE_DETECTION_HIGH_CONF_SCORE_MIN = 6;
const CHANGE_DETECTION_MEDIUM_CONF_SCORE_MIN = 4;

const CHANGE_DETECTION_WEIGHTS = {
  SCRIPT_TYPE_MATCH: 3.0,
  SOLE_TYPE_MATCH: 1.5,
  ADDRESS_REUSE: 5.0,
  NON_ROUND_VALUE: 1.5,
  OUTPUT_POSITION: 0.5,
  VALUE_PATTERN: 0.5,
  DUST_ZERO: -10,
  DUST_LIMIT: -2,
} as const;

export function detectChangeDetection(tx: TransactionAnalysis, bip69Fingerprint: HeuristicResult = detectBip69Fingerprint(tx)): HeuristicResult {
  if (isCoinbase(tx)) {
    return { detected: false };
  }

  const candidates = getSpendableOutputs(tx);
  if (candidates.length < 2) {
    return { detected: false };
  }

  const inputOwnershipTypes = deriveInputOwnershipTypes(tx.vin);
  const inputAddresses = new Set(tx.vin.map((input) => input.address).filter((address): address is string => Boolean(address)));
  const matchingTypeCount = candidates.filter((candidate) => inputOwnershipTypes.has(normalizeSummaryScriptType(candidate.script_type))).length;

  const scored = candidates.map((output) => {
    let score = 0;
    const reasons: Array<'address_reuse' | 'script_type_match' | 'sole_type_match' | 'round_number_analysis' | 'output_position' | 'value_pattern'> = [];

    const outputSummaryType = normalizeSummaryScriptType(output.script_type);
    const ownershipTypeMatch = inputOwnershipTypes.has(outputSummaryType) && outputSummaryType !== 'unknown';
    if (ownershipTypeMatch) {
      score += CHANGE_DETECTION_WEIGHTS.SCRIPT_TYPE_MATCH;
      reasons.push('script_type_match');
    }
    if (matchingTypeCount === 1 && ownershipTypeMatch) {
      score += CHANGE_DETECTION_WEIGHTS.SOLE_TYPE_MATCH;
      reasons.push('sole_type_match');
    }
    if (output.address && inputAddresses.has(output.address)) {
      score += CHANGE_DETECTION_WEIGHTS.ADDRESS_REUSE;
      reasons.push('address_reuse');
    }
    if (!isRoundSatValue(output.value_sats)) {
      score += CHANGE_DETECTION_WEIGHTS.NON_ROUND_VALUE;
      reasons.push('round_number_analysis');
    }
    if (!bip69Fingerprint.detected && output.n === tx.vout[tx.vout.length - 1]!.n) {
      score += CHANGE_DETECTION_WEIGHTS.OUTPUT_POSITION;
      reasons.push('output_position');
    }
    if (output.value_sats < tx.total_input_sats * CHANGE_DETECTION_MAX_CHANGE_SHARE) {
      score += CHANGE_DETECTION_WEIGHTS.VALUE_PATTERN;
      reasons.push('value_pattern');
    }
    // Dust outputs are extremely unlikely to be change (possible dust attack vectors)
    const dustLimitSats = getDustLimitByScriptType(output.script_type);
    if (output.value_sats === 0) {
      score += CHANGE_DETECTION_WEIGHTS.DUST_ZERO;
    } else if (output.value_sats <= dustLimitSats) {
      score += CHANGE_DETECTION_WEIGHTS.DUST_LIMIT;
    }

    return { output, score, reasons };
  });

  scored.sort((a, b) => b.score - a.score || a.output.n - b.output.n);
  const best = scored[0];
  const runnerUp = scored[1];
  if (!best || best.score < CHANGE_DETECTION_MIN_SCORE) {
    return { detected: false };
  }
  const ambiguousSelection = Boolean(runnerUp) && (best.score - runnerUp.score < CHANGE_DETECTION_AMBIGUITY_GAP);

  const methodPriority: Array<'address_reuse' | 'script_type_match' | 'sole_type_match' | 'round_number_analysis' | 'output_position' | 'value_pattern'> = [
    'address_reuse',
    'script_type_match',
    'sole_type_match',
    'round_number_analysis',
    'output_position',
    'value_pattern',
  ];
  const method = methodPriority.find((entry) => best.reasons.includes(entry)) ?? 'value_pattern';
  const confidence: Confidence = ambiguousSelection
    ? 'low'
    : best.score >= CHANGE_DETECTION_HIGH_CONF_SCORE_MIN
      ? 'high'
      : best.score >= CHANGE_DETECTION_MEDIUM_CONF_SCORE_MIN
        ? 'medium'
        : 'low';

  return {
    detected: true,
    likely_change_index: best.output.n,
    method,
    confidence,
    output_ordering_fingerprint: bip69Fingerprint.detected ? 'bip69' : undefined,
  };
}
