import { TransactionAnalysis, HeuristicResult } from '../../types';
import { isCoinbase, getSpendableOutputs, countBy } from '../../utils';
import { normalizeSummaryScriptType } from './utils';

// Broad consolidation shape: many inputs collapsing into one or two spendable outputs.
const CONSOLIDATION_MIN_INPUTS = 5;
const CONSOLIDATION_MAX_SPENDABLE_OUTPUTS = 2;
const CONSOLIDATION_LARGEST_OUTPUT_MIN_SHARE = 0.65;
// Tight same-address sweep allowance.
const CONSOLIDATION_TIGHT_SHAPE_MIN_INPUTS = 3;
const CONSOLIDATION_TIGHT_SHAPE_OUTPUTS = 1;
// High-confidence cutoffs.
const CONSOLIDATION_DOMINANT_TYPE_HIGH_SHARE = 0.8;
const CONSOLIDATION_LARGEST_OUTPUT_HIGH_SHARE = 0.8;

export function detectConsolidation(tx: TransactionAnalysis): HeuristicResult {
  if (isCoinbase(tx)) {
    return { detected: false };
  }

  const spendableOutputs = getSpendableOutputs(tx);
  const totalSpendableOutputValue = spendableOutputs.reduce((sum, output) => sum + output.value_sats, 0);
  const largestSpendableOutput = spendableOutputs.reduce((largest, output) => Math.max(largest, output.value_sats), 0);
  const largestOutputShare = totalSpendableOutputValue > 0 ? largestSpendableOutput / totalSpendableOutputValue : 0;
  const inputTypes = tx.vin.map((input) => normalizeSummaryScriptType(input.prevout_script_type));
  const typeCounts = [...countBy(inputTypes).values()];
  const dominantShare = inputTypes.length === 0 ? 0 : Math.max(...typeCounts) / inputTypes.length;
  const inputAddresses = tx.vin.map((input) => input.address).filter((a): a is string => Boolean(a));
  const allSameAddress = inputAddresses.length === tx.vin.length && new Set(inputAddresses).size === 1;
  const detected =
    (tx.vin.length >= CONSOLIDATION_MIN_INPUTS
      && spendableOutputs.length > 0
      && spendableOutputs.length <= CONSOLIDATION_MAX_SPENDABLE_OUTPUTS
      && (spendableOutputs.length === CONSOLIDATION_TIGHT_SHAPE_OUTPUTS || largestOutputShare >= CONSOLIDATION_LARGEST_OUTPUT_MIN_SHARE || allSameAddress))
    || (tx.vin.length >= CONSOLIDATION_TIGHT_SHAPE_MIN_INPUTS
      && spendableOutputs.length === CONSOLIDATION_TIGHT_SHAPE_OUTPUTS
      && allSameAddress);

  return {
    detected,
    confidence: detected
      ? (allSameAddress
        || spendableOutputs.length === CONSOLIDATION_TIGHT_SHAPE_OUTPUTS
        || dominantShare >= CONSOLIDATION_DOMINANT_TYPE_HIGH_SHARE
        || largestOutputShare >= CONSOLIDATION_LARGEST_OUTPUT_HIGH_SHARE
        ? 'high'
        : 'medium')
      : undefined,
    input_count: tx.vin.length,
    spendable_output_count: spendableOutputs.length,
    all_same_address: allSameAddress,
    largest_output_share: detected ? +largestOutputShare.toFixed(4) : undefined,
  };
}
