import { TransactionAnalysis, HeuristicResult } from '../../types';
import { isCoinbase, getSpendableOutputs, countBy } from '../../utils';
import { normalizeSummaryScriptType } from './utils';

// Typical PayJoin candidates are compact interactive payments.
const PAYJOIN_MIN_INPUTS = 2;
const PAYJOIN_MAX_INPUTS = 3;
const PAYJOIN_REQUIRED_SPENDABLE_OUTPUTS = 2;

export function detectPayjoinSuspected(
  tx: TransactionAnalysis,
  changeDetection: HeuristicResult,
  roundNumberPayment: HeuristicResult,
  coinjoin: HeuristicResult,
  consolidation: HeuristicResult,
): HeuristicResult {
  if (isCoinbase(tx)) {
    return { detected: false };
  }

  const spendableOutputs = getSpendableOutputs(tx);
  if (
    tx.vin.length < PAYJOIN_MIN_INPUTS ||
    tx.vin.length > PAYJOIN_MAX_INPUTS ||
    spendableOutputs.length !== PAYJOIN_REQUIRED_SPENDABLE_OUTPUTS ||
    !changeDetection.detected ||
    coinjoin.detected ||
    consolidation.detected
  ) {
    return { detected: false };
  }

  const distinctInputAddresses = new Set(tx.vin.map((input) => input.address).filter((address): address is string => Boolean(address)));
  const inputTypes = tx.vin.map((input) => normalizeSummaryScriptType(input.prevout_script_type));
  const dominantInputType = [...countBy(inputTypes).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
  const likelyChangeIndex = typeof changeDetection.likely_change_index === 'number' ? changeDetection.likely_change_index : null;
  const likelyChangeOutput = spendableOutputs.find((output) => output.n === likelyChangeIndex);
  const paymentOutput = spendableOutputs.find((output) => output.n !== likelyChangeIndex);
  const mixedInputTypes = new Set(inputTypes).size >= 2;
  const splitOutputTypes =
    dominantInputType !== 'unknown' &&
    spendableOutputs.filter((output) => normalizeSummaryScriptType(output.script_type) === dominantInputType).length === 1;
  const changeConfidence = changeDetection.confidence;
  const enoughSignals =
    mixedInputTypes ||
    roundNumberPayment.detected ||
    changeConfidence === 'high';
  const detected =
    distinctInputAddresses.size >= 2 &&
    Boolean(likelyChangeOutput) &&
    Boolean(paymentOutput) &&
    splitOutputTypes &&
    enoughSignals &&
    normalizeSummaryScriptType(paymentOutput!.script_type) !== normalizeSummaryScriptType(likelyChangeOutput!.script_type);

  return {
    detected,
    confidence: detected ? (mixedInputTypes && roundNumberPayment.detected ? 'medium' : 'low') : undefined,
    distinct_input_address_count: distinctInputAddresses.size,
    likely_change_index: likelyChangeIndex,
    mixed_input_types: mixedInputTypes,
    round_number_payment_present: roundNumberPayment.detected,
  };
}
