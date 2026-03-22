import { BlockContext, HeuristicResult, TransactionAnalysis, Classification, TransactionChainAnalysis, HeuristicId, AnalysisSummary, SummaryScriptType, HEURISTIC_IDS, WarningCode, WarningSeverity, UiWarning, ScriptTypeCountMap, OpReturnDetail } from '../types';
import { calculateFeeRateStats, incrementAddressFrequency, isCoinbase, roundNumber } from '../utils';
import { detectCoinjoin } from './detectors/coinjoin';
import { normalizeSummaryScriptType } from './detectors/utils';
export { normalizeSummaryScriptType };
export { detectCoinjoin };

import { detectCioh } from './detectors/cioh';
import { detectRoundNumberPayment } from './detectors/round_number_payment';
import { detectOpReturn } from './detectors/op_return';
import { detectAddressReuse } from './detectors/address_reuse';
import { detectConsolidation } from './detectors/consolidation';
import { detectBip69Fingerprint } from './detectors/bip69_fingerprint';
import { detectChangeDetection } from './detectors/change_detection';
import { detectPayjoinSuspected } from './detectors/payjoin_suspected';
import { detectSelfTransfer } from './detectors/self_transfer';
import { detectBatchPayment } from './detectors/batch_payment';
import { detectPeelingChain } from './detectors/peeling_chain';

export {
  detectCioh,
  detectRoundNumberPayment,
  detectOpReturn,
  detectAddressReuse,
  detectConsolidation,
  detectBip69Fingerprint,
  detectChangeDetection,
  detectPayjoinSuspected,
  detectSelfTransfer,
  detectBatchPayment,
  detectPeelingChain,
};

const HEURISTIC_SAMPLE_LIMIT = 5;

const WARNING_SEVERITY: Partial<Record<WarningCode, WarningSeverity>> = {
  RBF_SIGNALING: 'warn',
  HIGH_FEE: 'high',
  DUST_OUTPUT: 'warn',
  UNKNOWN_OUTPUT_SCRIPT: 'info',
};

function toUiWarning(code: WarningCode): UiWarning {
  return {
    code,
    severity: WARNING_SEVERITY[code] ?? 'info',
  };
}

function countScriptTypes(values: string[]): ScriptTypeCountMap {
  return values.reduce<ScriptTypeCountMap>((accumulator, scriptType) => {
    accumulator[scriptType] = (accumulator[scriptType] ?? 0) + 1;
    return accumulator;
  }, {});
}

export function emptyScriptTypeDistribution(): Record<SummaryScriptType, number> {
  return {
    p2wpkh: 0,
    p2tr: 0,
    p2sh: 0,
    p2pkh: 0,
    p2wsh: 0,
    op_return: 0,
    unknown: 0,
  };
}

export function buildBlockContext(transactions: TransactionAnalysis[]): BlockContext {
  const addressFrequency = new Map<string, number>();
  const spendByOutpoint = new Map<string, { spender_txid: string; input_index: number }>();
  const txById = new Map<string, TransactionAnalysis>();

  for (const tx of transactions) {
    txById.set(tx.txid, tx);
    for (const [inputIndex, input] of tx.vin.entries()) {
      if (!input.coinbase) {
        incrementAddressFrequency(addressFrequency, input.address);
        spendByOutpoint.set(`${input.txid}:${input.vout}`, { spender_txid: tx.txid, input_index: inputIndex });
      }
    }
    for (const output of tx.vout) {
      incrementAddressFrequency(addressFrequency, output.address);
    }
  }

  return { transactions, txById, address_frequency: addressFrequency, spendByOutpoint };
}

export function buildDefaultHeuristics(): Record<HeuristicId, HeuristicResult> {
  return Object.fromEntries(
    HEURISTIC_IDS.map((id) => [id, { detected: false }])
  ) as Record<HeuristicId, HeuristicResult>;
}

function normalizeHeuristicResult(result: HeuristicResult): HeuristicResult {
  if (!result.detected) {
    return { detected: false };
  }

  return {
    ...result,
    detected: true,
  };
}

function normalizeHeuristics(heuristics: Record<HeuristicId, HeuristicResult>): Record<HeuristicId, HeuristicResult> {
  return Object.fromEntries(
    HEURISTIC_IDS.map((id) => [id, normalizeHeuristicResult(heuristics[id])]),
  ) as Record<HeuristicId, HeuristicResult>;
}


export function classifyTransaction(tx: TransactionAnalysis, heuristics: Record<HeuristicId, HeuristicResult>): Classification {
  if (isCoinbase(tx)) {
    return 'unknown';
  }
  if (heuristics.coinjoin.detected) {
    return 'coinjoin';
  }
  if (heuristics.consolidation.detected) {
    return 'consolidation';
  }
  if (heuristics.self_transfer.detected) {
    return 'self_transfer';
  }
  if (heuristics.batch_payment.detected) {
    return 'batch_payment';
  }
  if (heuristics.peeling_chain.detected) {
    return 'simple_payment';
  }
  if (heuristics.change_detection.detected || heuristics.round_number_payment.detected) {
    return 'simple_payment';
  }
  return 'unknown';
}

export function analyzeTransactionHeuristics(tx: TransactionAnalysis, context: BlockContext): TransactionChainAnalysis {
  const heuristics = buildDefaultHeuristics();
  const bip69Fingerprint = detectBip69Fingerprint(tx);
  heuristics.round_number_payment = detectRoundNumberPayment(tx);
  heuristics.op_return = detectOpReturn(tx);
  heuristics.address_reuse = detectAddressReuse(tx, context);
  heuristics.coinjoin = detectCoinjoin(tx);
  heuristics.cioh = detectCioh(tx, heuristics.coinjoin.detected);
  heuristics.consolidation = detectConsolidation(tx);
  heuristics.change_detection = detectChangeDetection(tx, bip69Fingerprint);
  const payjoinSuspected = detectPayjoinSuspected(
    tx,
    heuristics.change_detection,
    heuristics.round_number_payment,
    heuristics.coinjoin,
    heuristics.consolidation,
  );
  if (heuristics.cioh.detected && payjoinSuspected.detected) {
    heuristics.cioh = { detected: false };
  }
  heuristics.self_transfer = detectSelfTransfer(
    tx,
    heuristics.change_detection,
    heuristics.round_number_payment,
    heuristics.address_reuse,
  );
  heuristics.batch_payment = detectBatchPayment(
    tx,
    heuristics.change_detection,
    heuristics.round_number_payment,
    heuristics.coinjoin,
    heuristics.consolidation,
    heuristics.self_transfer,
  );
  heuristics.peeling_chain = detectPeelingChain(tx, context);

  const graphInputs = tx.vin.map((input) => ({
    txid: input.txid,
    vout: input.vout,
    value_sats: input.prevout.value_sats,
    script_type: input.prevout_script_type,
    address: input.address,
    coinbase: input.coinbase,
  }));

  const graphOutputs = tx.vout.map((output) => ({
    n: output.n,
    value_sats: output.value_sats,
    script_type: output.script_type,
    address: output.address,
    op_return_protocol: output.op_return_protocol,
  }));

  const opReturnDetails: OpReturnDetail[] = tx.vout
    .filter((output) => output.script_type === 'op_return')
    .map((output) => ({
      n: output.n,
      protocol: output.op_return_protocol ?? 'unknown',
      data_utf8: output.op_return_data_utf8 ?? null,
      data_hex: output.op_return_data_hex ?? '',
    }));

  const feePctOfInput = tx.total_input_sats > 0 ? roundNumber((tx.fee_sats / tx.total_input_sats) * 100) : 0;
  const warnings = tx.warnings.map((warning) => toUiWarning(warning.code));

  return {
    txid: tx.txid,
    wtxid: tx.wtxid,
    version: tx.version,
    weight: tx.weight,
    vbytes: tx.vbytes,
    fee_sats: tx.fee_sats,
    total_input_sats: tx.total_input_sats,
    total_output_sats: tx.total_output_sats,
    fee_pct_of_input: feePctOfInput,
    rbf_signaling: tx.rbf_signaling,
    locktime_type: tx.locktime_type,
    locktime_value: tx.locktime_value,
    segwit_savings: tx.segwit_savings,
    warnings,
    witness_input_count: tx.vin.filter((input) => input.witness.length > 0).length,
    input_script_counts: countScriptTypes(tx.vin.filter((input) => !input.coinbase).map((input) => input.script_type)),
    output_script_counts: countScriptTypes(tx.vout.map((output) => output.script_type)),
    has_op_return: opReturnDetails.length > 0,
    op_return_count: opReturnDetails.length,
    op_return_details: opReturnDetails,
    heuristics: normalizeHeuristics(heuristics),
    classification: classifyTransaction(tx, heuristics),
    fee_rate_sat_vb: tx.fee_rate_sat_vb,
    input_count: tx.vin.filter((input) => !input.coinbase).length,
    output_count: tx.vout.length,
    input_txids: Array.from(new Set(tx.vin.filter((input) => !input.coinbase).map((input) => input.txid))),
    output_addresses: Array.from(new Set(tx.vout.map((output) => output.address).filter((address): address is string => Boolean(address)))).slice(0, 8),
    graph: {
      total_input_sats: tx.total_input_sats,
      total_output_sats: tx.total_output_sats,
      fee_sats: tx.fee_sats,
      inputs: graphInputs,
      outputs: graphOutputs,
    },
  };
}


export function buildAnalysisSummary(parsedTransactions: TransactionAnalysis[], transactions: TransactionChainAnalysis[]): AnalysisSummary {
  const scriptTypeDistribution = emptyScriptTypeDistribution();
  const warningCounts: Partial<Record<WarningCode, number>> = {};
  let warningTransactions = 0;

  for (const tx of parsedTransactions) {
    for (const output of tx.vout) {
      scriptTypeDistribution[normalizeSummaryScriptType(output.script_type)] += 1;
    }

    if (tx.warnings.length > 0) {
      warningTransactions += 1;
      for (const warning of tx.warnings) {
        warningCounts[warning.code] = (warningCounts[warning.code] ?? 0) + 1;
      }
    }
  }

  const flaggedTransactions = transactions.filter((tx) => Object.values(tx.heuristics).some((heuristic) => heuristic.detected)).length;

  return {
    total_transactions_analyzed: transactions.length,
    heuristics_applied: [...HEURISTIC_IDS],
    flagged_transactions: flaggedTransactions,
    warning_counts: warningCounts,
    warning_transactions: warningTransactions,
    script_type_distribution: scriptTypeDistribution,
    fee_rate_stats: calculateFeeRateStats(parsedTransactions),
  };
}
