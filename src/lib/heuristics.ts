import { BlockContext, HeuristicResult, TransactionAnalysis, Classification, TransactionChainAnalysis, HeuristicId, AnalysisSummary, SummaryScriptType, HEURISTIC_IDS } from '../types';
import { calculateFeeRateStats, incrementAddressFrequency, isCoinbase } from '../utils';
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

  return {
    txid: tx.txid,
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
  for (const tx of parsedTransactions) {
    for (const output of tx.vout) {
      scriptTypeDistribution[normalizeSummaryScriptType(output.script_type)] += 1;
    }
  }

  const flaggedTransactions = transactions.filter((tx) => Object.values(tx.heuristics).some((heuristic) => heuristic.detected)).length;

  return {
    total_transactions_analyzed: transactions.length,
    heuristics_applied: [...HEURISTIC_IDS],
    flagged_transactions: flaggedTransactions,
    script_type_distribution: scriptTypeDistribution,
    fee_rate_stats: calculateFeeRateStats(parsedTransactions),
  };
}
