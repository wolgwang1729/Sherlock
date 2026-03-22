import { TransactionAnalysis, HeuristicResult } from '../../types';
import { isCoinbase, getSpendableOutputs, countBy, isRoundSatValue, sampleArray } from '../../utils';

// Base batch pattern requires explicit recipient fanout beyond one change output.
const BATCH_MIN_SPENDABLE_OUTPUTS = 3;
const BATCH_MIN_RECIPIENT_OUTPUTS = 2;
const BATCH_MIN_DISTINCT_RECIPIENTS = 2;
const BATCH_ROUND_SIGNAL_MIN_COUNT = 1;
const BATCH_STRONG_FANOUT_RECIPIENTS = 3;
// Repeated equal recipient values above this are treated as likely non-batch patterns.
const BATCH_MAX_EQUAL_RECIPIENT_GROUP = 2;
const BATCH_HIGH_CONF_MIN_RECIPIENT_OUTPUTS = 3;
const BATCH_HIGH_CONF_MIN_DISTINCT_RECIPIENTS = 3;
const BATCH_HIGH_CONF_EQUAL_GROUP = 1;

export function detectBatchPayment(
  tx: TransactionAnalysis,
  changeDetection: HeuristicResult,
  roundNumberPayment: HeuristicResult,
  coinjoin: HeuristicResult,
  consolidation: HeuristicResult,
  selfTransfer: HeuristicResult,
): HeuristicResult {
  if (isCoinbase(tx)) {
    return { detected: false };
  }

  const spendableOutputs = getSpendableOutputs(tx);
  const likelyChangeIndex = typeof changeDetection.likely_change_index === 'number' ? changeDetection.likely_change_index : null;
  if (
    spendableOutputs.length < BATCH_MIN_SPENDABLE_OUTPUTS ||
    !changeDetection.detected ||
    likelyChangeIndex === null ||
    coinjoin.detected ||
    consolidation.detected ||
    selfTransfer.detected
  ) {
    return { detected: false };
  }

  const recipientOutputs = spendableOutputs.filter((output) => output.n !== likelyChangeIndex);
  const recipientValueCounts = countBy(recipientOutputs.map((output) => output.value_sats));
  const largestEqualRecipientGroup = Math.max(0, ...recipientValueCounts.values());
  const roundRecipientOutputs = recipientOutputs.filter((output) => isRoundSatValue(output.value_sats));
  const uniqueRecipientAddresses = new Set(recipientOutputs.map((output) => output.address).filter((address): address is string => Boolean(address)));
  const supportsBatchShape = roundRecipientOutputs.length >= BATCH_ROUND_SIGNAL_MIN_COUNT || recipientOutputs.length >= BATCH_STRONG_FANOUT_RECIPIENTS;
  const strongChangeSignal = changeDetection.confidence === 'high' || changeDetection.confidence === 'medium' || recipientOutputs.length >= BATCH_STRONG_FANOUT_RECIPIENTS;
  const detected =
    recipientOutputs.length >= BATCH_MIN_RECIPIENT_OUTPUTS &&
    supportsBatchShape &&
    strongChangeSignal &&
    uniqueRecipientAddresses.size >= BATCH_MIN_DISTINCT_RECIPIENTS &&
    largestEqualRecipientGroup <= BATCH_MAX_EQUAL_RECIPIENT_GROUP;

  return {
    detected,
    confidence: detected
      ? (recipientOutputs.length >= BATCH_HIGH_CONF_MIN_RECIPIENT_OUTPUTS
        && uniqueRecipientAddresses.size >= BATCH_HIGH_CONF_MIN_DISTINCT_RECIPIENTS
        && largestEqualRecipientGroup === BATCH_HIGH_CONF_EQUAL_GROUP
        ? 'high'
        : 'medium')
      : undefined,
    likely_change_index: likelyChangeIndex,
    recipient_output_count: recipientOutputs.length,
    recipient_output_indexes: sampleArray(recipientOutputs.map((output) => output.n)),
    round_recipient_count: roundRecipientOutputs.length,
    non_round_batch_supported: recipientOutputs.length >= BATCH_STRONG_FANOUT_RECIPIENTS && roundRecipientOutputs.length === 0,
  };
}
