import { TransactionAnalysis, HeuristicResult, BlockContext, Confidence } from '../../types';
import { isCoinbase, getSpendableOutputs, isRoundSatValue } from '../../utils';
import { normalizeSummaryScriptType } from './utils';

const PEELING_CARRY_MIN_SHARE = 0.7;
const PEELING_SMALL_MAX_SHARE = 0.3;
// Forward-link validation: next spend should keep one dominant carry output.
const NEXT_SPENDER_CARRY_MIN_SHARE = 0.6;
// Canonical one-step peeling shape constraints.
const PEELING_EXPECTED_INPUT_COUNT = 1;
const PEELING_EXPECTED_OUTPUT_COUNT = 2;

export function detectPeelingChain(tx: TransactionAnalysis, context: BlockContext): HeuristicResult {
  if (isCoinbase(tx)) {
    return { detected: false };
  }

  const spendableOutputs = [...getSpendableOutputs(tx)].sort((a, b) => b.value_sats - a.value_sats);
  if (tx.vin.length !== PEELING_EXPECTED_INPUT_COUNT || spendableOutputs.length !== PEELING_EXPECTED_OUTPUT_COUNT) {
    return { detected: false };
  }

  const [largeOutput, smallOutput] = spendableOutputs;
  const totalSpendable = largeOutput!.value_sats + smallOutput!.value_sats;
  const outpoint = `${tx.txid}:${largeOutput!.n}`;
  const nextSpend = context.spendByOutpoint.get(outpoint);
  const nextTransaction = nextSpend
    ? context.txById.get(nextSpend.spender_txid)
    : undefined;
  const nextTransactionSpendableOutputs = nextTransaction
    ? nextTransaction.vout.filter((output) => output.script_type !== 'op_return')
    : [];
  const nextInputCount = nextTransaction
    ? nextTransaction.vin.filter((input) => !input.coinbase).length
    : 0;
  const nextPeelShapeValid =
    !nextTransaction ||
    (nextInputCount === 1 && nextTransactionSpendableOutputs.length >= 1 && nextTransactionSpendableOutputs.length <= 3);
  const nextLargestOutput = nextTransactionSpendableOutputs.reduce((largest, output) => Math.max(largest, output.value_sats), 0);
  const nextTotalOutput = nextTransactionSpendableOutputs.reduce((sum, output) => sum + output.value_sats, 0);
  const nextLargestOutputShare = nextTotalOutput > 0 ? nextLargestOutput / nextTotalOutput : 0;
  const nextCarryLooksDominant = !nextTransaction || nextLargestOutputShare >= NEXT_SPENDER_CARRY_MIN_SHARE;
  const peelingShapeDetected =
    largeOutput!.value_sats >= totalSpendable * PEELING_CARRY_MIN_SHARE &&
    smallOutput!.value_sats <= totalSpendable * PEELING_SMALL_MAX_SHARE;
  const forwardEvidenceDetected = Boolean(nextSpend) && nextPeelShapeValid && nextCarryLooksDominant;
  const noForwardEvidenceAvailable = !nextSpend;
  const detected =
    peelingShapeDetected &&
    (forwardEvidenceDetected || noForwardEvidenceAvailable);

  const inputType = normalizeSummaryScriptType(tx.vin[0]!.prevout_script_type);
  const carriedType = normalizeSummaryScriptType(largeOutput!.script_type);
  const scriptTypeConsistent = inputType !== 'unknown' && carriedType === inputType;
  const smallIsRound = isRoundSatValue(smallOutput!.value_sats);
  const confidence: Confidence | undefined = detected
    ? (forwardEvidenceDetected && scriptTypeConsistent && smallIsRound)
      ? 'high'
      : forwardEvidenceDetected
        ? 'medium'
        : 'low'
    : undefined;

  return {
    detected,
    confidence,
    carried_output_index: detected ? largeOutput!.n : undefined,
    next_spender_txid: nextSpend?.spender_txid,
    next_spender_input_count: detected && nextTransaction ? nextInputCount : undefined,
    next_spender_spendable_output_count: detected && nextTransaction ? nextTransactionSpendableOutputs.length : undefined,
    next_spender_largest_output_share: detected && nextTransaction ? +nextLargestOutputShare.toFixed(4) : undefined,
    script_type_consistent: scriptTypeConsistent,
    value_ratio: detected ? +(largeOutput!.value_sats / totalSpendable).toFixed(4) : undefined,
    small_output_round: detected ? isRoundSatValue(smallOutput!.value_sats) : undefined,
  };
}
