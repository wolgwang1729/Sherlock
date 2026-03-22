import { TransactionAnalysis, HeuristicResult } from '../../types';
import { isCoinbase, getDistinctAddresses, getScriptTypes } from '../../utils';

// Sequence values below this indicate replaceability signaling in policy terms.
const RBF_SIGNAL_SEQUENCE_CUTOFF = 0xfffffffe;
// CIOH scoring and collaborative-risk gates.
const CIOH_MIN_OWNERSHIP_SIGNAL_SCORE = 2;
const CIOH_COLLABORATIVE_RISK_DISTINCT_INPUTS_MIN = 3;
const CIOH_HIGH_CONFIDENCE_INPUT_COUNT = 4;

export function detectCioh(tx: TransactionAnalysis, suppressForCoinjoin = false): HeuristicResult {
  if (isCoinbase(tx)) {
    return { detected: false };
  }
  if (suppressForCoinjoin) {
    return { detected: false };
  }
  const inputCount = tx.vin.length;
  const distinctAddresses = getDistinctAddresses(tx.vin);
  const inputTypeSet = new Set(getScriptTypes(tx.vin));
  const rbfFlags = new Set(tx.vin.map((input) => input.sequence < RBF_SIGNAL_SEQUENCE_CUTOFF));
  const repeatedInputAddress = distinctAddresses.size < inputCount;
  const mixedInputTypes = inputTypeSet.size >= 2;
  const rbfConsistent = rbfFlags.size <= 1;
  const allInputsDistinct = distinctAddresses.size === inputCount;

  const ownershipSignalScore =
    (repeatedInputAddress ? 1 : 0)
    + (mixedInputTypes ? 0 : 1)
    + (rbfConsistent ? 1 : 0);
  const collaborativeSpendRisk =
    mixedInputTypes
    || !rbfConsistent
    || (allInputsDistinct && inputCount >= CIOH_COLLABORATIVE_RISK_DISTINCT_INPUTS_MIN);
  const detected = inputCount > 1 && ownershipSignalScore >= CIOH_MIN_OWNERSHIP_SIGNAL_SCORE && !collaborativeSpendRisk;

  return {
    detected,
    confidence: detected ? (inputCount >= CIOH_HIGH_CONFIDENCE_INPUT_COUNT ? 'high' : 'medium') : undefined,
    input_count: inputCount,
    distinct_input_address_count: distinctAddresses.size,
    mixed_input_types: mixedInputTypes,
    rbf_consistent: rbfConsistent,
    repeated_input_address: repeatedInputAddress,
    ownership_signal_score: ownershipSignalScore,
    collaborative_spend_risk: collaborativeSpendRisk,
  };
}
