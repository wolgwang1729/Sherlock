import { TransactionAnalysis, HeuristicResult } from '../../types';
import { isCoinbase, getSpendableOutputs } from '../../utils';
import { normalizeSummaryScriptType, deriveInputOwnershipTypes } from './utils';

export function detectSelfTransfer(
  tx: TransactionAnalysis,
  changeDetection: HeuristicResult,
  roundNumberPayment: HeuristicResult,
  addressReuse: HeuristicResult,
): HeuristicResult {
  if (isCoinbase(tx)) {
    return { detected: false };
  }

  const spendableOutputs = getSpendableOutputs(tx);
  if (spendableOutputs.length === 0) {
    return { detected: false };
  }

  const inputOwnershipTypes = deriveInputOwnershipTypes(tx.vin);
  const allOutputsMatch = spendableOutputs.every((output) => inputOwnershipTypes.has(normalizeSummaryScriptType(output.script_type)));
  const strongReuse = Array.isArray(addressReuse.within_transaction) && addressReuse.within_transaction.length > 0;
  const detected = allOutputsMatch && (strongReuse || changeDetection.confidence === 'high') && !roundNumberPayment.detected;

  return {
    detected,
    confidence: detected ? (strongReuse ? 'high' : 'medium') : undefined,
    output_count: spendableOutputs.length,
  };
}
