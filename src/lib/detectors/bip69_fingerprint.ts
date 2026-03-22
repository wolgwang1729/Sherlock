import { TransactionAnalysis, HeuristicResult } from '../../types';
import { isSortedByComparator, compareInputsBip69, compareOutputsBip69 } from '../../utils';

export function detectBip69Fingerprint(tx: TransactionAnalysis): HeuristicResult {
  const comparableInputs = tx.vin.length >= 2;
  const comparableOutputs = tx.vout.length >= 2;
  if (!comparableInputs && !comparableOutputs) {
    return { detected: false };
  }

  const input_order_sorted = comparableInputs ? isSortedByComparator(tx.vin, compareInputsBip69) : false;
  const output_order_sorted = comparableOutputs ? isSortedByComparator(tx.vout, compareOutputsBip69) : false;
  const detected = input_order_sorted && output_order_sorted;

  return {
    detected,
    confidence: detected ? (tx.vin.length >= 3 || tx.vout.length >= 3 ? 'high' : 'medium') : undefined,
    input_order_sorted,
    output_order_sorted,
  };
}
