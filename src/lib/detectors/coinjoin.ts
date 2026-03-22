import { TransactionAnalysis, HeuristicResult, Confidence } from '../../types';
import { isCoinbase, getSpendableOutputs, countBy, getDistinctAddresses, computeAddressReuseRatio, getScriptTypes } from '../../utils';
import { IDetector, DetectorContext } from './types';

const COINJOIN_NEAR_EQUAL_TOLERANCE_RATIO = 1.02;
const COINJOIN_MIN_DISTINCT_ADDRESSES_LARGE = 5;
const COINJOIN_HIGH_ADDRESS_REUSE_RATIO = 0.7;
// Suppress giant high-reuse fan-in/fan-out service patterns unless fingerprint is very strong.
const COINJOIN_HIGH_REUSE_SUPPRESSION_MIN_IO = 20;
// Ignore tiny denomination clusters unlikely to be standardized CoinJoin outputs.
const COINJOIN_MIN_PLAUSIBLE_DENOMINATION_SATS = 1_000;
const WHIRLPOOL_POOL_SIZE = 5;
const WHIRLPOOL_PREMIX_EPSILON_MAX_SATS = 100_000;

interface CoinjoinContext {
  tx: TransactionAnalysis;
  spendableOutputs: ReturnType<typeof getSpendableOutputs>;
  largestEqualGroup: number;
  distinctInputAddresses: number;
  distinctOutputAddresses: number;
  dominantEqualValue: number;
  equalValuePlausible: boolean;
  nearEqualGroup: number;
  nearEqualValue: number | null;
  highAddressReuse: boolean;
  mixedInputTypes: boolean;
  standardizedOutputCount: number;
  standardizedOutputShare: number;
  estimatedParticipants: number;
  allOutputsEqual: boolean;
  allOutputsNearEqual: boolean;
  nearEqualToleranceUsed: boolean;
}

function isWhirlpoolLike(ctx: CoinjoinContext): boolean {
  return ctx.tx.vin.length === WHIRLPOOL_POOL_SIZE &&
    ctx.spendableOutputs.length === WHIRLPOOL_POOL_SIZE &&
    ctx.largestEqualGroup === WHIRLPOOL_POOL_SIZE &&
    ctx.equalValuePlausible &&
    ctx.distinctInputAddresses >= WHIRLPOOL_POOL_SIZE &&
    ctx.distinctOutputAddresses >= WHIRLPOOL_POOL_SIZE &&
    ctx.tx.vin.every((input) => input.prevout.value_sats >= ctx.dominantEqualValue && input.prevout.value_sats <= ctx.dominantEqualValue + WHIRLPOOL_PREMIX_EPSILON_MAX_SATS) &&
    ctx.tx.vin.some((input) => input.prevout.value_sats > ctx.dominantEqualValue);
}

function isJoinMarketLike(ctx: CoinjoinContext): boolean {
  return ctx.equalValuePlausible &&
    ctx.estimatedParticipants >= 3 &&
    ctx.largestEqualGroup === ctx.estimatedParticipants &&
    ctx.spendableOutputs.length <= ctx.estimatedParticipants * 2 &&
    ctx.distinctInputAddresses >= ctx.estimatedParticipants &&
    ctx.distinctOutputAddresses === ctx.spendableOutputs.length;
}

function isWasabi2Like(ctx: CoinjoinContext): boolean {
  return ctx.tx.vin.length >= 20 &&
    ctx.standardizedOutputShare >= 0.5 &&
    ctx.distinctInputAddresses >= COINJOIN_MIN_DISTINCT_ADDRESSES_LARGE &&
    ctx.distinctOutputAddresses >= COINJOIN_MIN_DISTINCT_ADDRESSES_LARGE;
}

function isBaseCoinjoin(ctx: CoinjoinContext): boolean {
  return ctx.equalValuePlausible && (
    (ctx.tx.vin.length >= 5 && ctx.spendableOutputs.length >= 5 && ctx.largestEqualGroup >= 3 && (ctx.distinctInputAddresses >= 3 || ctx.mixedInputTypes))
    || (ctx.allOutputsEqual && ctx.tx.vin.length >= 3 && ctx.distinctInputAddresses >= 3)
    || (ctx.allOutputsNearEqual && ctx.tx.vin.length >= 3 && ctx.distinctInputAddresses >= 3 && ctx.nearEqualGroup >= 3)
  );
}

export class CoinjoinDetector implements IDetector {
  id = 'coinjoin' as const;

  detect(context: DetectorContext): HeuristicResult {
    const { tx } = context;

    if (isCoinbase(tx)) {
      return { detected: false };
    }

    const spendableOutputs = getSpendableOutputs(tx);
    const equalValueCounts = countBy(spendableOutputs.map((output) => output.value_sats));
    let largestEqualGroup = 0;
    let equalValue: number | null = null;
    for (const [value, count] of equalValueCounts.entries()) {
      if (count > largestEqualGroup) {
        largestEqualGroup = count;
        equalValue = value;
      }
    }

    // Near-equal tolerance: group outputs within 2% to catch CoinJoins where values differ due to fee handling.
    let nearEqualGroup = largestEqualGroup;
    let nearEqualValue = equalValue;
    if (largestEqualGroup < 3 && spendableOutputs.length >= 3) {
      const sorted = [...spendableOutputs].sort((a, b) => a.value_sats - b.value_sats);
      let left = 0;
      while (left < sorted.length && sorted[left]!.value_sats === 0) left++;
      for (let right = left; right < sorted.length; right++) {
        while (sorted[right]!.value_sats > sorted[left]!.value_sats * COINJOIN_NEAR_EQUAL_TOLERANCE_RATIO) left++;
        const count = right - left + 1;
        if (count > nearEqualGroup) {
          nearEqualGroup = count;
          nearEqualValue = sorted[left]!.value_sats;
        }
      }
    }

    const distinctInputAddresses = getDistinctAddresses(tx.vin).size;
    const distinctOutputAddresses = getDistinctAddresses(spendableOutputs).size;
    const inputAddressReuseRatio = computeAddressReuseRatio(tx.vin.map((input) => input.address));
    const outputAddressReuseRatio = computeAddressReuseRatio(spendableOutputs.map((output) => output.address));
    const highAddressReuse = inputAddressReuseRatio > COINJOIN_HIGH_ADDRESS_REUSE_RATIO || outputAddressReuseRatio > COINJOIN_HIGH_ADDRESS_REUSE_RATIO;
    const mixedInputTypes = new Set(getScriptTypes(tx.vin)).size >= 2;
    const standardizedOutputCount = [...equalValueCounts.values()].reduce((sum, count) => (count >= 2 ? sum + count : sum), 0);
    const standardizedOutputShare = spendableOutputs.length > 0 ? +(standardizedOutputCount / spendableOutputs.length).toFixed(4) : 0;
    const estimatedParticipants = Math.max(largestEqualGroup, nearEqualGroup);
    const dominantEqualValue = (equalValue ?? nearEqualValue) ?? 0;
    const equalValuePlausible = dominantEqualValue >= COINJOIN_MIN_PLAUSIBLE_DENOMINATION_SATS;
    const allOutputsEqual = largestEqualGroup === spendableOutputs.length && spendableOutputs.length >= 3;
    const allOutputsNearEqual = nearEqualGroup === spendableOutputs.length && spendableOutputs.length >= 3;
    const nearEqualToleranceUsed = nearEqualGroup > largestEqualGroup;

    const ctx: CoinjoinContext = {
      tx,
      spendableOutputs,
      largestEqualGroup,
      distinctInputAddresses,
      distinctOutputAddresses,
      dominantEqualValue,
      equalValuePlausible,
      nearEqualGroup,
      nearEqualValue,
      highAddressReuse,
      mixedInputTypes,
      standardizedOutputCount,
      standardizedOutputShare,
      estimatedParticipants,
      allOutputsEqual,
      allOutputsNearEqual,
      nearEqualToleranceUsed,
    };

    const whirlpoolLike = isWhirlpoolLike(ctx);
    const joinMarketLike = isJoinMarketLike(ctx);
    const wasabi2Like = isWasabi2Like(ctx);
    const baseDetected = isBaseCoinjoin(ctx);

    const highAddressReuseSuppression =
      highAddressReuse
      && tx.vin.length >= COINJOIN_HIGH_REUSE_SUPPRESSION_MIN_IO
      && spendableOutputs.length >= COINJOIN_HIGH_REUSE_SUPPRESSION_MIN_IO;
    const detected = (baseDetected || whirlpoolLike || joinMarketLike || wasabi2Like) && !(highAddressReuseSuppression && !whirlpoolLike);

    let confidence: Confidence | undefined;
    if (detected) {
      if (whirlpoolLike) {
        confidence = 'high';
      } else if (nearEqualToleranceUsed) {
        confidence = nearEqualGroup >= 5 ? 'medium' : 'low';
      } else if (wasabi2Like || joinMarketLike) {
        confidence = largestEqualGroup >= 5 ? 'high' : 'medium';
      } else {
        confidence = largestEqualGroup >= 5 ? 'high' : 'medium';
      }
    }

    const protocolFingerprint = whirlpoolLike
      ? 'whirlpool_like'
      : wasabi2Like
        ? 'wasabi2_like'
        : joinMarketLike
          ? 'joinmarket_like'
          : undefined;

    return {
      detected,
      confidence,
      equal_output_value_sats: equalValue ?? nearEqualValue,
      equal_output_count: Math.max(largestEqualGroup, nearEqualGroup),
      near_equal_tolerance_used: nearEqualToleranceUsed,
      distinct_output_address_count: distinctOutputAddresses,
      estimated_participants: estimatedParticipants || undefined,
      standardized_output_count: standardizedOutputCount,
      standardized_output_share: standardizedOutputShare,
      input_address_reuse_ratio: inputAddressReuseRatio,
      output_address_reuse_ratio: outputAddressReuseRatio,
      protocol_fingerprint: protocolFingerprint,
    };
  }
}

export function detectCoinjoin(tx: TransactionAnalysis): HeuristicResult {
  return new CoinjoinDetector().detect({ tx });
}
