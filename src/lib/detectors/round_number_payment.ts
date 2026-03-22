import { TransactionAnalysis, HeuristicResult } from '../../types';
import { isCoinbase, isRoundSatValue, sampleArray } from '../../utils';

// Large rounded outputs are more likely intentional user-facing payment amounts.
const ROUND_PAYMENT_HIGH_CONFIDENCE_MIN_VALUE_SATS = 1_000_000;

export function detectRoundNumberPayment(tx: TransactionAnalysis): HeuristicResult {
  if (isCoinbase(tx)) {
    return { detected: false };
  }
  const matchingOutputs = tx.vout.filter((output) => output.script_type !== 'op_return' && isRoundSatValue(output.value_sats));
  return {
    detected: matchingOutputs.length > 0,
    confidence: matchingOutputs.length > 0
      ? (matchingOutputs.some((output) => output.value_sats >= ROUND_PAYMENT_HIGH_CONFIDENCE_MIN_VALUE_SATS) ? 'high' : 'medium')
      : undefined,
    output_count: matchingOutputs.length,
    output_indexes: sampleArray(matchingOutputs.map((output) => output.n)),
    sample_output_values_sats: sampleArray(matchingOutputs.map((output) => output.value_sats)),
  };
}
