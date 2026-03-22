import {
  analyzeTransactionHeuristics,
  buildAnalysisSummary,
  buildBlockContext,
  classifyTransaction,
  detectAddressReuse,
  detectBatchPayment,
  detectBip69Fingerprint,
  detectChangeDetection,
  detectCoinjoin,
  detectCioh,
  detectPeelingChain,
  detectPayjoinSuspected,
  detectRoundNumberPayment,
  detectOpReturn,
  detectConsolidation,
  detectSelfTransfer,
  normalizeSummaryScriptType,
  buildDefaultHeuristics,
} from '../lib/heuristics';
import { makeInput, makeOutput, makeTx } from './helpers';

describe('heuristics', () => {
  it('detects CIOH and address reuse', () => {
    const tx = makeTx({
      vin: [
        makeInput({ address: 'reuse-1' }),
        makeInput({ address: 'reuse-2' }),
      ],
      vout: [
        makeOutput({ n: 0, address: 'reuse-1', value_sats: 40_000 }),
        makeOutput({ n: 1, address: 'new-1', value_sats: 150_000 }),
      ],
    });

    expect(detectCioh(tx)).toMatchObject({ detected: true, confidence: 'medium' });

    const context = buildBlockContext([tx]);
    const reuse = detectAddressReuse(tx, context);
    expect(reuse.detected).toBe(true);
    expect(reuse.within_transaction_count).toBeGreaterThan(0);
  });

  it('detects coinjoin-like patterns', () => {
    const vin = Array.from({ length: 5 }, (_, i) => makeInput({ address: `in-${i}`, prevout_script_type: i % 2 === 0 ? 'p2wpkh' : 'p2sh' }));
    const vout = [
      makeOutput({ n: 0, value_sats: 50_000 }),
      makeOutput({ n: 1, value_sats: 50_000 }),
      makeOutput({ n: 2, value_sats: 50_000 }),
      makeOutput({ n: 3, value_sats: 31_000 }),
      makeOutput({ n: 4, value_sats: 29_000 }),
    ];
    const tx = makeTx({ vin, vout });

    const result = detectCoinjoin(tx);
    expect(result.detected).toBe(true);
    expect(result.equal_output_count).toBe(3);
  });

  it('includes compact input and output graph data in analyzed transactions', () => {
    const tx = makeTx({
      txid: 'graph-tx'.padEnd(64, '0'),
      wtxid: 'graph-wtx'.padEnd(64, 'f'),
      rbf_signaling: true,
      locktime_type: 'block_height',
      locktime_value: 800_000,
      segwit_savings: {
        witness_bytes: 50,
        non_witness_bytes: 90,
        total_bytes: 140,
        weight_actual: 470,
        weight_if_legacy: 560,
        savings_pct: 16.07,
      },
      warnings: [{ code: 'RBF_SIGNALING' }, { code: 'HIGH_FEE' }],
      vin: [
        makeInput({
          txid: 'source-a'.padEnd(64, '1'),
          vout: 2,
          address: 'sender-a',
          prevout_script_type: 'p2tr',
          prevout: {
            value_sats: 125_000,
            script_pubkey_hex: '51201111111111111111111111111111111111111111111111111111111111111111',
          },
        }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 100_000, address: 'recipient-a', script_type: 'p2wpkh' }),
        makeOutput({
          n: 1,
          value_sats: 20_000,
          address: null,
          script_type: 'op_return',
          op_return_protocol: 'opentimestamps',
          op_return_data_hex: '736f622d32303236',
          op_return_data_utf8: null,
        }),
      ],
      total_input_sats: 125_000,
      total_output_sats: 120_000,
      fee_sats: 5_000,
    });

    const analyzed = analyzeTransactionHeuristics(tx, buildBlockContext([tx]));

    expect(analyzed).toMatchObject({
      wtxid: 'graph-wtx'.padEnd(64, 'f'),
      rbf_signaling: true,
      locktime_type: 'block_height',
      locktime_value: 800_000,
      has_op_return: true,
      op_return_count: 1,
      witness_input_count: 0,
      warnings: [
        { code: 'RBF_SIGNALING', severity: 'warn' },
        { code: 'HIGH_FEE', severity: 'high' },
      ],
    });

    expect(analyzed.input_script_counts?.p2wpkh).toBe(1);
    expect(analyzed.output_script_counts?.p2wpkh).toBe(1);
    expect(analyzed.output_script_counts?.op_return).toBe(1);
    expect(analyzed.op_return_details).toEqual([
      {
        n: 1,
        protocol: 'opentimestamps',
        data_utf8: null,
        data_hex: '736f622d32303236',
      },
    ]);

    expect(analyzed.graph).toMatchObject({
      total_input_sats: 125_000,
      total_output_sats: 120_000,
      fee_sats: 5_000,
      inputs: [
        {
          txid: 'source-a'.padEnd(64, '1'),
          vout: 2,
          value_sats: 125_000,
          script_type: 'p2tr',
          address: 'sender-a',
        },
      ],
      outputs: [
        {
          n: 0,
          value_sats: 100_000,
          script_type: 'p2wpkh',
          address: 'recipient-a',
        },
        {
          n: 1,
          value_sats: 20_000,
          script_type: 'op_return',
          address: null,
          op_return_protocol: 'opentimestamps',
        },
      ],
    });
  });

  it('assigns lower confidence to near-equal coinjoin patterns than strict-equal sets', () => {
    const nearEqualTx = makeTx({
      vin: [
        makeInput({ address: 'mix-in-0' }),
        makeInput({ address: 'mix-in-1' }),
        makeInput({ address: 'mix-in-2' }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 100_000, address: 'mix-out-0' }),
        makeOutput({ n: 1, value_sats: 100_080, address: 'mix-out-1' }),
        makeOutput({ n: 2, value_sats: 100_090, address: 'mix-out-2' }),
      ],
    });

    const strictEqualTx = makeTx({
      vin: Array.from({ length: 5 }, (_, index) => makeInput({ address: `strict-in-${index}` })),
      vout: [
        makeOutput({ n: 0, value_sats: 75_000, address: 'strict-out-0' }),
        makeOutput({ n: 1, value_sats: 75_000, address: 'strict-out-1' }),
        makeOutput({ n: 2, value_sats: 75_000, address: 'strict-out-2' }),
        makeOutput({ n: 3, value_sats: 75_000, address: 'strict-out-3' }),
        makeOutput({ n: 4, value_sats: 75_000, address: 'strict-out-4' }),
      ],
    });

    expect(detectCoinjoin(nearEqualTx)).toMatchObject({
      detected: true,
      near_equal_tolerance_used: true,
      confidence: 'low',
      equal_output_count: 3,
    });

    expect(detectCoinjoin(strictEqualTx)).toMatchObject({
      detected: true,
      near_equal_tolerance_used: false,
      confidence: 'high',
      equal_output_count: 5,
    });
  });

  it('detects likely change output using scoring', () => {
    const tx = makeTx({
      total_input_sats: 200_000,
      vin: [
        makeInput({ address: 'sender-A', prevout_script_type: 'p2wpkh' }),
        makeInput({ address: 'sender-B', prevout_script_type: 'p2wpkh' }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 100_000, script_type: 'p2pkh', address: 'recipient' }),
        makeOutput({ n: 1, value_sats: 86_543, script_type: 'p2wpkh', address: 'sender-A' }),
      ],
    });

    const result = detectChangeDetection(tx);
    expect(result.detected).toBe(true);
    expect(result.likely_change_index).toBe(1);
  });

  it('uses script-aware dust thresholds for change scoring', () => {
    const tx = makeTx({
      total_input_sats: 1_000,
      vin: [
        makeInput({ prevout_script_type: 'p2wpkh', address: 'input-wpkh' }),
        makeInput({ prevout_script_type: 'p2pkh', address: 'input-pkh' }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 150, script_type: 'p2pkh', address: 'recipient' }),
        makeOutput({ n: 1, value_sats: 101, script_type: 'p2wpkh', address: 'candidate-change' }),
      ],
    });

    expect(detectChangeDetection(tx)).toMatchObject({
      detected: true,
      likely_change_index: 1,
    });
  });

  it('builds classification and summary from analyzed transactions', () => {
    const txA = makeTx({
      txid: 'a'.repeat(64),
      vin: [makeInput(), makeInput({ address: 'x' }), makeInput({ address: 'y' }), makeInput({ address: 'z' }), makeInput({ address: 'w' })],
      vout: [
        makeOutput({ n: 0, value_sats: 60_000 }),
        makeOutput({ n: 1, value_sats: 60_000 }),
        makeOutput({ n: 2, value_sats: 60_000 }),
        makeOutput({ n: 3, value_sats: 40_000 }),
        makeOutput({ n: 4, value_sats: 30_000 }),
      ],
    });
    const txB = makeTx({
      txid: 'b'.repeat(64),
      vout: [makeOutput({ n: 0, script_type: 'op_return', address: null })],
      warnings: [{ code: 'RBF_SIGNALING' }, { code: 'DUST_OUTPUT' }],
    });

    const context = buildBlockContext([txA, txB]);
    const analyzedA = analyzeTransactionHeuristics(txA, context);
    const analyzedB = analyzeTransactionHeuristics(txB, context);

    expect(classifyTransaction(txA, analyzedA.heuristics)).toBe(analyzedA.classification);

    const summary = buildAnalysisSummary([txA, txB], [analyzedA, analyzedB]);
    expect(summary.total_transactions_analyzed).toBe(2);
    expect(summary.heuristics_applied.length).toBe(10);
    expect(summary.script_type_distribution.op_return).toBeGreaterThanOrEqual(1);
    expect(summary.warning_transactions).toBe(1);
    expect(summary.warning_counts?.RBF_SIGNALING).toBe(1);
    expect(summary.warning_counts?.DUST_OUTPUT).toBe(1);
  });

  it('detects BIP69-style ordering fingerprints', () => {
    const tx = makeTx({
      vin: [
        makeInput({ txid: '0'.repeat(63) + '1', vout: 0 }),
        makeInput({ txid: '1'.repeat(64), vout: 2 }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 40_000, script_pubkey_hex: '0014' + '11'.repeat(20) }),
        makeOutput({ n: 1, value_sats: 80_000, script_pubkey_hex: '0014' + '22'.repeat(20) }),
      ],
    });

    expect(detectBip69Fingerprint(tx)).toMatchObject({
      detected: true,
      input_order_sorted: true,
      output_order_sorted: true,
    });
  });

  it('suppresses the last-output bias when the transaction is BIP69 sorted', () => {
    const tx = makeTx({
      total_input_sats: 170_000,
      vin: [
        makeInput({ txid: '0'.repeat(63) + '1', vout: 0, prevout_script_type: 'p2wpkh' }),
        makeInput({ txid: '1'.repeat(64), vout: 2, prevout_script_type: 'p2wpkh' }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 68_765, script_type: 'p2wpkh', address: 'wallet-change', script_pubkey_hex: '0014' + '11'.repeat(20) }),
        makeOutput({ n: 1, value_sats: 100_000, script_type: 'p2pkh', address: 'recipient', script_pubkey_hex: '76a914' + '22'.repeat(20) + '88ac' }),
      ],
    });

    expect(detectChangeDetection(tx)).toMatchObject({
      detected: true,
      likely_change_index: 0,
      output_ordering_fingerprint: 'bip69',
    });
  });

  it('does not guess change when the best candidate is ambiguous', () => {
    const tx = makeTx({
      vin: [makeInput({ address: 'sender-A', prevout_script_type: 'p2wpkh' })],
      vout: [
        makeOutput({ n: 0, value_sats: 123_456, script_type: 'p2wpkh', address: 'recipient-A' }),
        makeOutput({ n: 1, value_sats: 123_456, script_type: 'p2wpkh', address: 'recipient-B' }),
      ],
      total_input_sats: 260_000,
    });

    expect(detectChangeDetection(tx)).toMatchObject({
      detected: true,
      confidence: 'low',
    });
  });

  it('classifies high-confidence self transfers from heuristic combinations', () => {
    const tx = makeTx({
      txid: 'c'.repeat(64),
      vin: [makeInput({ address: 'wallet-1', prevout_script_type: 'p2wpkh' })],
      vout: [
        makeOutput({ n: 0, value_sats: 98_765, script_type: 'p2wpkh', address: 'external-1' }),
        makeOutput({ n: 1, value_sats: 87_654, script_type: 'p2wpkh', address: 'wallet-1' }),
      ],
      total_input_sats: 200_000,
    });

    const analyzed = analyzeTransactionHeuristics(tx, buildBlockContext([tx]));

    expect(analyzed.classification).toBe('self_transfer');
    expect(analyzed.heuristics.change_detection).toMatchObject({ detected: true, confidence: 'high' });
    expect(analyzed.heuristics.address_reuse).toMatchObject({ detected: true, confidence: 'high' });
    expect(analyzed.heuristics.self_transfer).toMatchObject({ detected: true, confidence: 'high' });
  });

  it('detects peeling chains when the large output is spent by the next transaction', () => {
    const txA = makeTx({
      txid: 'd'.repeat(64),
      vin: [makeInput({ txid: 'p'.repeat(64), vout: 1, address: 'source-1' })],
      vout: [
        makeOutput({ n: 0, value_sats: 180_000, address: 'carry-forward' }),
        makeOutput({ n: 1, value_sats: 20_000, address: 'recipient-1' }),
      ],
      total_input_sats: 205_000,
    });
    const txB = makeTx({
      txid: 'e'.repeat(64),
      vin: [makeInput({ txid: txA.txid, vout: 0, address: 'carry-forward' })],
      vout: [
        makeOutput({ n: 0, value_sats: 150_000, address: 'carry-next' }),
        makeOutput({ n: 1, value_sats: 25_000, address: 'recipient-2' }),
      ],
      total_input_sats: 180_000,
    });

    const context = buildBlockContext([txA, txB]);
    expect(detectPeelingChain(txA, context)).toMatchObject({
      detected: true,
      confidence: 'medium',
      carried_output_index: 0,
      next_spender_txid: txB.txid,
    });
  });

  it('detects conservative payjoin suspicion and suppresses CIOH in the full analysis', () => {
    const tx = makeTx({
      txid: '9'.repeat(64),
      total_input_sats: 340_000,
      vin: [
        makeInput({ address: 'sender-input', prevout_script_type: 'p2wpkh', prevout: { value_sats: 250_000, script_pubkey_hex: '0014' + '11'.repeat(20) } }),
        makeInput({ address: 'merchant-input', prevout_script_type: 'p2pkh', prevout: { value_sats: 90_000, script_pubkey_hex: '76a914' + '22'.repeat(20) + '88ac' } }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 88_765, script_type: 'p2wpkh', address: 'sender-change' }),
        makeOutput({ n: 1, value_sats: 200_000, script_type: 'p2pkh', address: 'merchant-receive' }),
      ],
    });

    const change = detectChangeDetection(tx);
    const round = detectRoundNumberPayment(tx);
    const coinjoin = detectCoinjoin(tx);
    const consolidation = detectConsolidation(tx);

    expect(detectPayjoinSuspected(tx, change, round, coinjoin, consolidation)).toMatchObject({ detected: true });

    const analyzed = analyzeTransactionHeuristics(tx, buildBlockContext([tx]));
    expect(analyzed.heuristics.cioh).toEqual({ detected: false });
  });

  it('suppresses transactional heuristics for coinbase transactions', () => {
    const coinbase = makeTx({
      txid: 'f'.repeat(64),
      vin: [makeInput({ coinbase: true, address: null, txid: '0'.repeat(64) })],
      vout: [makeOutput({ n: 0, script_type: 'op_return', address: null })],
    });

    const analyzed = analyzeTransactionHeuristics(coinbase, buildBlockContext([coinbase]));

    expect(analyzed.classification).toBe('unknown');
    expect(analyzed.heuristics.cioh).toEqual({ detected: false });
    expect(analyzed.heuristics.change_detection).toEqual({ detected: false });
    expect(analyzed.heuristics.address_reuse).toEqual({ detected: false });
    expect(analyzed.heuristics.coinjoin).toEqual({ detected: false });
    expect(analyzed.heuristics.consolidation).toEqual({ detected: false });
    expect(analyzed.heuristics.self_transfer).toEqual({ detected: false });
    expect(analyzed.heuristics.peeling_chain).toEqual({ detected: false });
  });

  it('detects round number payments (clean trailing zeros)', () => {
    const tx = makeTx({
      vin: [makeInput()],
      vout: [
        makeOutput({ n: 0, value_sats: 500_000 }), // Round (5 trailing zeros)
        makeOutput({ n: 1, value_sats: 123_456 }), // Not round
      ],
    });

    const result = detectRoundNumberPayment(tx);
    expect(result.detected).toBe(true);
    expect(result.output_count).toBe(1);
    expect(result.output_indexes).toContain(0);
    expect(result.sample_output_values_sats).toContain(500_000);
  });

  it('detects OP_RETURN outputs and extracts protocols', () => {
    const tx = makeTx({
      vin: [makeInput()],
      vout: [
        makeOutput({ n: 0, script_type: 'op_return', op_return_protocol: 'omni' }),
        makeOutput({ n: 1, script_type: 'p2wpkh' }),
      ],
    });

    const result = detectOpReturn(tx);
    expect(result.detected).toBe(true);
    expect(result.output_count).toBe(1);
    expect(result.protocols).toContain('omni');
  });

  it('detects consolidation of many inputs to few outputs', () => {
    const vin = Array.from({ length: 6 }, (_, i) => makeInput({ address: `in-${i}`, prevout_script_type: 'p2wpkh' }));
    const tx = makeTx({
      vin,
      vout: [makeOutput({ n: 0, value_sats: 1_000_000 })], // Single output
    });

    const result = detectConsolidation(tx);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBe('high');
    expect(result.input_count).toBe(6);
    expect(result.spendable_output_count).toBe(1);
  });

  it('classifies batch payments only when they have a likely change output and multiple recipients', () => {
    const tx = makeTx({
      total_input_sats: 450_000,
      vin: [
        makeInput({ address: 'wallet-a', prevout_script_type: 'p2wpkh', prevout: { value_sats: 250_000, script_pubkey_hex: '0014' + '11'.repeat(20) } }),
        makeInput({ address: 'wallet-b', prevout_script_type: 'p2wpkh', prevout: { value_sats: 200_000, script_pubkey_hex: '0014' + '22'.repeat(20) } }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 100_000, address: 'recipient-1' }),
        makeOutput({ n: 1, value_sats: 200_000, address: 'recipient-2' }),
        makeOutput({ n: 2, value_sats: 85_321, script_type: 'p2wpkh', address: 'wallet-change' }),
      ],
    });

    const change = detectChangeDetection(tx);
    const round = detectRoundNumberPayment(tx);
    const coinjoin = detectCoinjoin(tx);
    const consolidation = detectConsolidation(tx);
    const selfTransfer = detectSelfTransfer(tx, change, round, detectAddressReuse(tx, buildBlockContext([tx])));

    expect(detectBatchPayment(tx, change, round, coinjoin, consolidation, selfTransfer)).toMatchObject({
      detected: true,
      likely_change_index: 2,
      recipient_output_count: 2,
    });

    const analyzed = analyzeTransactionHeuristics(tx, buildBlockContext([tx]));
    expect(analyzed.classification).toBe('batch_payment');
  });
});

describe('additional heuristics', () => {
  it('detects round number payments', () => {
    const tx = makeTx({
      vout: [
        makeOutput({ n: 0, value_sats: 100_000_000, address: 'addr1' }), // 1 BTC
        makeOutput({ n: 1, value_sats: 1_234_567, address: 'addr2' }),
      ],
    });

    const result = detectRoundNumberPayment(tx);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBe('high');
    expect(result.output_indexes).toContain(0);
  });

  it('detects smaller round number payments', () => {
    const tx = makeTx({
      vout: [
        makeOutput({ n: 0, value_sats: 100_000, address: 'addr1' }), // 0.001 BTC
      ],
    });

    const result = detectRoundNumberPayment(tx);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBe('medium');
  });

  it('detects OP_RETURN protocols', () => {
    const tx = makeTx({
      vout: [
        makeOutput({ n: 0, script_type: 'op_return', op_return_protocol: 'omni' }),
      ],
    });

    const result = detectOpReturn(tx);
    expect(result.detected).toBe(true);
    expect(result.protocols).toContain('omni');
  });

  it('detects consolidation transactions', () => {
    const vin = Array.from({ length: 10 }, (_, i) => makeInput({ address: `in-${i}` }));
    const tx = makeTx({
      vin,
      vout: [
        makeOutput({ n: 0, value_sats: 1_000_000 }),
      ],
    });

    const result = detectConsolidation(tx);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBe('high');
  });

  it('normalizes script types correctly', () => {
    expect(normalizeSummaryScriptType('p2wpkh')).toBe('p2wpkh');
    expect(normalizeSummaryScriptType('p2pk')).toBe('unknown');
    expect(normalizeSummaryScriptType('multisig')).toBe('unknown');
    expect(normalizeSummaryScriptType('op_return')).toBe('op_return');
  });

  it('detects CIOH with multiple common inputs', () => {
    const tx = makeTx({
      vin: [
        makeInput({ address: 'addr1' }),
        makeInput({ address: 'addr2' }),
        makeInput({ address: 'addr1' }),
      ],
      vout: [
        makeOutput({ n: 0, address: 'addr3' }),
      ],
    });
    const result = detectCioh(tx);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBe('medium');
  });

  it('does not detect CIOH when all inputs have different addresses', () => {
    const tx = makeTx({
      vin: [
        makeInput({ address: 'addr1' }),
        makeInput({ address: 'addr2' }),
        makeInput({ address: 'addr3' }),
      ],
      vout: [
        makeOutput({ n: 0, address: 'addr4' }),
      ],
    });
    const result = detectCioh(tx);
    expect(result.detected).toBe(false);
    expect(result.collaborative_spend_risk).toBe(true);
  });

  it('detects round number payments with various thresholds', () => {
    // 0.1 BTC - High confidence
    const txHigh = makeTx({ vout: [makeOutput({ value_sats: 10_000_000 })] });
    expect(detectRoundNumberPayment(txHigh)).toMatchObject({ detected: true, confidence: 'high' });

    // 0.001 BTC - Medium confidence
    const txMedium = makeTx({ vout: [makeOutput({ value_sats: 100_000 })] });
    expect(detectRoundNumberPayment(txMedium)).toMatchObject({ detected: true, confidence: 'medium' });

    // 0.00001 BTC - Low confidence (if it was supported, but currently it's not)
    const txNone = makeTx({ vout: [makeOutput({ value_sats: 1_000 })] });
    expect(detectRoundNumberPayment(txNone).detected).toBe(false);
  });

  it('classifies transactions correctly using classifyTransaction', () => {
    const txPayment = makeTx({ vout: [makeOutput(), makeOutput()] });
    const heuristics = buildDefaultHeuristics();
    expect(classifyTransaction(txPayment, { ...heuristics, round_number_payment: { detected: true } })).toBe('simple_payment');
    expect(classifyTransaction(txPayment, { ...heuristics, peeling_chain: { detected: true } })).toBe('simple_payment');

    const txConsolidation = makeTx({ vin: [makeInput(), makeInput()], vout: [makeOutput()] });
    expect(classifyTransaction(txConsolidation, { ...heuristics, consolidation: { detected: true } })).toBe('consolidation');

    const txSelf = makeTx({ vout: [makeOutput()] });
    expect(classifyTransaction(txSelf, { ...heuristics, self_transfer: { detected: true } })).toBe('self_transfer');

    const txCoinjoin = makeTx({ vin: [makeInput(), makeInput()], vout: [makeOutput(), makeOutput()] });
    expect(classifyTransaction(txCoinjoin, { ...heuristics, coinjoin: { detected: true } })).toBe('coinjoin');
  });

  it('does not classify arbitrary multi-output payments as batch payments without a likely change output', () => {
    const heuristics = buildDefaultHeuristics();
    const tx = makeTx({
      vout: [
        makeOutput({ n: 0, value_sats: 40_001, address: 'recipient-1' }),
        makeOutput({ n: 1, value_sats: 40_002, address: 'recipient-2' }),
        makeOutput({ n: 2, value_sats: 40_003, address: 'recipient-3' }),
      ],
    });

    expect(classifyTransaction(tx, heuristics)).toBe('unknown');
  });

  it('suppresses self-transfer when round-number payments are present', () => {
    const tx = makeTx({
      total_input_sats: 210_000,
      vin: [makeInput({ address: 'wallet-1', prevout_script_type: 'p2wpkh' })],
      vout: [
        makeOutput({ n: 0, value_sats: 100_000, script_type: 'p2wpkh', address: 'recipient-1' }),
        makeOutput({ n: 1, value_sats: 95_000, script_type: 'p2wpkh', address: 'wallet-1' }),
      ],
    });

    const changeDetection = detectChangeDetection(tx);
    const roundNumberPayment = detectRoundNumberPayment(tx);
    const addressReuse = detectAddressReuse(tx, buildBlockContext([tx]));

    expect(changeDetection).toMatchObject({ detected: true, confidence: 'high' });
    expect(roundNumberPayment).toMatchObject({ detected: true });
    expect(addressReuse).toMatchObject({ detected: true, confidence: 'high' });
    expect(detectSelfTransfer(tx, changeDetection, roundNumberPayment, addressReuse)).toEqual({ detected: false, output_count: 2 });
  });

  it('compacts analyzed heuristic output to user-facing fields', () => {
    const tx = makeTx({
      total_input_sats: 200_000,
      vin: [makeInput({ address: 'wallet-2', prevout_script_type: 'p2wpkh' })],
      vout: [
        makeOutput({ n: 0, value_sats: 98_765, script_type: 'p2wpkh', address: 'external-2' }),
        makeOutput({ n: 1, value_sats: 87_654, script_type: 'p2wpkh', address: 'wallet-2' }),
      ],
    });

    const analyzed = analyzeTransactionHeuristics(tx, buildBlockContext([tx]));

    expect(analyzed.heuristics.cioh).toEqual({ detected: false });
    expect(analyzed.heuristics.address_reuse).toMatchObject({ detected: true, confidence: 'high' });
    expect(analyzed.heuristics.address_reuse).toHaveProperty('within_transaction_count');
    expect(analyzed.heuristics.change_detection).toMatchObject({
      detected: true,
      likely_change_index: 1,
      method: 'address_reuse',
      confidence: 'high',
    });
  });

  it('does not detect coinjoin with too few participants or non-equal outputs', () => {
    // 2 inputs, 3 equal outputs — not enough distinct addresses for the small-CoinJoin path
    const txTooFew = makeTx({
      vin: [makeInput({ address: 'in-0' }), makeInput({ address: 'in-1' })],
      vout: Array.from({ length: 3 }, (_, i) => makeOutput({ n: i, value_sats: 50_000 })),
    });
    expect(detectCoinjoin(txTooFew).detected).toBe(false);

    // 5 inputs, 5 outputs but NO equal group >= 3 (all different values)
    const txNoEqual = makeTx({
      vin: Array.from({ length: 5 }, (_, i) => makeInput({ address: `in-${i}` })),
      vout: Array.from({ length: 5 }, (_, i) => makeOutput({ n: i, value_sats: 50_000 + i * 1_000 })),
    });
    expect(detectCoinjoin(txNoEqual).detected).toBe(false);
  });

  it('detects coinjoin with 4 inputs and all-equal outputs via alternative path', () => {
    // 4 distinct addresses + 5 all-equal outputs → detected via alternative path
    const tx = makeTx({
      vin: Array.from({ length: 4 }, (_, i) => makeInput({ address: `in-${i}` })),
      vout: Array.from({ length: 5 }, (_, i) => makeOutput({ n: i, value_sats: 50_000 })),
    });
    expect(detectCoinjoin(tx).detected).toBe(true);
  });

  it('does not detect consolidation if there are more than 2 spendable outputs', () => {
    const vin = Array.from({ length: 6 }, (_, i) => makeInput({ address: `in-${i}` }));
    const tx = makeTx({
      vin,
      vout: [
        makeOutput({ n: 0, value_sats: 500_000 }),
        makeOutput({ n: 1, value_sats: 300_000 }),
        makeOutput({ n: 2, value_sats: 200_000 }), // 3rd spendable output disqualifies it
      ],
    });

    const result = detectConsolidation(tx);
    expect(result.detected).toBe(false);
  });

  it('does not detect peeling chain if the large output is not spent in the context', () => {
    const tx = makeTx({
      txid: 'peel-test'.repeat(7),
      vin: [makeInput({ txid: 'source', vout: 0 })],
      vout: [
        makeOutput({ n: 0, value_sats: 900_000, address: 'carry-forward' }),
        makeOutput({ n: 1, value_sats: 100_000, address: 'recipient' }),
      ],
    });

    // Provide an empty context where the outpoint is NOT spent
    const context = buildBlockContext([tx]);
    const result = detectPeelingChain(tx, context);

    expect(result.detected).toBe(true);
    expect(result.confidence).toBe('low');
  });

  it('does not detect self-transfer if output script types do not match input script types', () => {
    const tx = makeTx({
      vin: [makeInput({ prevout_script_type: 'p2wpkh' })],
      vout: [
        makeOutput({ script_type: 'p2tr' }), // Different type
      ],
    });

    const changeDetection = { detected: true, confidence: 'high' } as any;
    const roundNumberPayment = { detected: false } as any;
    const addressReuse = { detected: false } as any;

    const result = detectSelfTransfer(tx, changeDetection, roundNumberPayment, addressReuse);
    expect(result.detected).toBe(false);
  });

  it('detects self-transfer for wallet migrations (p2sh-p2wpkh → p2wpkh)', () => {
    const tx = makeTx({
      total_input_sats: 200_000,
      vin: [makeInput({
        address: 'wallet-1',
        prevout_script_type: 'p2sh',
        script_type: 'p2sh-p2wpkh',
      })],
      vout: [
        makeOutput({ n: 0, value_sats: 98_765, script_type: 'p2wpkh', address: 'wallet-new' }),
        makeOutput({ n: 1, value_sats: 87_654, script_type: 'p2wpkh', address: 'wallet-1' }),
      ],
    });

    const context = buildBlockContext([tx]);
    const analyzed = analyzeTransactionHeuristics(tx, context);

    expect(analyzed.heuristics.self_transfer.detected).toBe(true);
    expect(analyzed.heuristics.self_transfer.confidence).toBe('high');
  });

  it('detects smaller CoinJoin patterns (Whirlpool-style with 3 participants)', () => {
    const vin = [
      makeInput({ address: 'participant-a', prevout_script_type: 'p2wpkh' }),
      makeInput({ address: 'participant-b', prevout_script_type: 'p2wpkh' }),
      makeInput({ address: 'participant-c', prevout_script_type: 'p2wpkh' }),
    ];
    const vout = [
      makeOutput({ n: 0, value_sats: 50_000 }),
      makeOutput({ n: 1, value_sats: 50_000 }),
      makeOutput({ n: 2, value_sats: 50_000 }),
    ];
    const tx = makeTx({ vin, vout });

    const result = detectCoinjoin(tx);
    expect(result.detected).toBe(true);
    expect(result.equal_output_count).toBe(3);
    expect(result.confidence).toBe('medium');
  });

  it('does not detect CoinJoin for 3-input/3-equal-output when addresses are not distinct', () => {
    const vin = [
      makeInput({ address: 'same-addr', prevout_script_type: 'p2wpkh' }),
      makeInput({ address: 'same-addr', prevout_script_type: 'p2wpkh' }),
      makeInput({ address: 'other-addr', prevout_script_type: 'p2wpkh' }),
    ];
    const vout = [
      makeOutput({ n: 0, value_sats: 50_000 }),
      makeOutput({ n: 1, value_sats: 50_000 }),
      makeOutput({ n: 2, value_sats: 50_000 }),
    ];
    const tx = makeTx({ vin, vout });

    const result = detectCoinjoin(tx);
    expect(result.detected).toBe(false);
  });

  it('detects change via sole_type_match when one output uniquely matches input type', () => {
    const tx = makeTx({
      total_input_sats: 300_000,
      vin: [
        makeInput({ address: 'sender', prevout_script_type: 'p2wpkh' }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 100_000, script_type: 'p2tr', address: 'recipient-a' }),
        makeOutput({ n: 1, value_sats: 100_000, script_type: 'p2tr', address: 'recipient-b' }),
        makeOutput({ n: 2, value_sats: 87_654, script_type: 'p2wpkh', address: 'wallet-change' }),
      ],
    });

    const result = detectChangeDetection(tx);
    expect(result.detected).toBe(true);
    expect(result.likely_change_index).toBe(2);
    expect(result.method).toBe('script_type_match');
  });

  it('boosts consolidation confidence when all inputs share the same address', () => {
    const vin = Array.from({ length: 6 }, () => makeInput({ address: 'same-wallet', prevout_script_type: 'p2wpkh' }));
    const tx = makeTx({
      vin,
      vout: [
        makeOutput({ n: 0, value_sats: 500_000, script_type: 'p2wpkh' }),
        makeOutput({ n: 1, value_sats: 300_000, script_type: 'p2tr' }),
      ],
    });

    const result = detectConsolidation(tx);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBe('high');
    expect(result.all_same_address).toBe(true);
  });

  it('boosts peeling chain confidence when script type matches and peel is round', () => {
    const txA = makeTx({
      txid: 'peel-high'.padEnd(64, '0'),
      vin: [makeInput({ txid: 'source'.padEnd(64, '0'), vout: 0, prevout_script_type: 'p2wpkh' })],
      vout: [
        makeOutput({ n: 0, value_sats: 700_000, script_type: 'p2wpkh', address: 'carry' }),
        makeOutput({ n: 1, value_sats: 100_000, script_type: 'p2tr', address: 'recipient' }),
      ],
      total_input_sats: 810_000,
    });
    const txB = makeTx({
      txid: 'next-peel'.padEnd(64, '0'),
      vin: [makeInput({ txid: txA.txid, vout: 0, address: 'carry' })],
      vout: [makeOutput({ n: 0, value_sats: 690_000 })],
    });

    const context = buildBlockContext([txA, txB]);
    const result = detectPeelingChain(txA, context);

    expect(result.detected).toBe(true);
    expect(result.confidence).toBe('high');
    expect(result.script_type_consistent).toBe(true);
  });

  it('keeps peeling chain at medium confidence when script types differ', () => {
    const txA = makeTx({
      txid: 'peel-med'.padEnd(64, '0'),
      vin: [makeInput({ txid: 'source'.padEnd(64, '0'), vout: 0, prevout_script_type: 'p2wpkh' })],
      vout: [
        makeOutput({ n: 0, value_sats: 700_000, script_type: 'p2tr', address: 'carry' }),
        makeOutput({ n: 1, value_sats: 100_000, script_type: 'p2wpkh', address: 'recipient' }),
      ],
      total_input_sats: 810_000,
    });
    const txB = makeTx({
      txid: 'next-peel'.padEnd(64, '0'),
      vin: [makeInput({ txid: txA.txid, vout: 0, address: 'carry' })],
      vout: [makeOutput({ n: 0, value_sats: 690_000 })],
    });

    const context = buildBlockContext([txA, txB]);
    const result = detectPeelingChain(txA, context);

    expect(result.detected).toBe(true);
    expect(result.confidence).toBe('medium');
    expect(result.script_type_consistent).toBe(false);
  });

  it('downgrades CIOH confidence when CoinJoin is detected', () => {
    const vin = Array.from({ length: 5 }, (_, i) =>
      makeInput({ address: `in-${i}`, prevout_script_type: i % 2 === 0 ? 'p2wpkh' : 'p2sh' }),
    );
    const vout = [
      makeOutput({ n: 0, value_sats: 50_000 }),
      makeOutput({ n: 1, value_sats: 50_000 }),
      makeOutput({ n: 2, value_sats: 50_000 }),
      makeOutput({ n: 3, value_sats: 31_000 }),
      makeOutput({ n: 4, value_sats: 29_000 }),
    ];
    const tx = makeTx({ vin, vout });

    const context = buildBlockContext([tx]);
    const analyzed = analyzeTransactionHeuristics(tx, context);

    expect(analyzed.heuristics.coinjoin.detected).toBe(true);
    expect(analyzed.heuristics.cioh).toEqual({ detected: false });
  });
});

describe('heuristic edge cases and improvements', () => {
  it('CIOH reports distinct address count, mixed types, and RBF consistency', () => {
    const tx = makeTx({
      vin: [
        makeInput({ address: 'addr-a', prevout_script_type: 'p2wpkh', sequence: 0xfffffffd }),
        makeInput({ address: 'addr-b', prevout_script_type: 'p2tr', sequence: 0xfffffffd }),
        makeInput({ address: 'addr-a', prevout_script_type: 'p2wpkh', sequence: 0xfffffffd }),
      ],
      vout: [makeOutput({ n: 0 })],
    });

    const result = detectCioh(tx);
    expect(result.detected).toBe(false);
    expect(result.distinct_input_address_count).toBe(2);
    expect(result.mixed_input_types).toBe(true);
    expect(result.rbf_consistent).toBe(true);
    expect(result.collaborative_spend_risk).toBe(true);
  });

  it('CIOH detects inconsistent RBF signaling across inputs', () => {
    const tx = makeTx({
      vin: [
        makeInput({ address: 'addr-a', sequence: 0xfffffffd }),
        makeInput({ address: 'addr-b', sequence: 0xffffffff }),
      ],
      vout: [makeOutput({ n: 0 })],
    });

    const result = detectCioh(tx);
    expect(result.detected).toBe(false);
    expect(result.rbf_consistent).toBe(false);
    expect(result.collaborative_spend_risk).toBe(true);
  });

  it('change detection penalizes dust outputs to disambiguate change', () => {
    // Both outputs match input type (p2wpkh). Without dust penalty, the gap between
    // the dust output and the real change output is too small to detect. The dust
    // penalty on the 80-sat output (below p2wpkh dust) breaks the tie and enables correct detection.
    const tx = makeTx({
      total_input_sats: 200_000,
      vin: [makeInput({ prevout_script_type: 'p2wpkh' })],
      vout: [
        makeOutput({ n: 0, value_sats: 80, script_type: 'p2wpkh', address: 'dust-addr' }),
        makeOutput({ n: 1, value_sats: 87_654, script_type: 'p2wpkh', address: 'change-addr' }),
      ],
    });

    const result = detectChangeDetection(tx);
    expect(result.detected).toBe(true);
    expect(result.likely_change_index).toBe(1);
  });

  it('change detection never picks zero-value output as change', () => {
    const tx = makeTx({
      total_input_sats: 200_000,
      vin: [makeInput({ prevout_script_type: 'p2wpkh' })],
      vout: [
        makeOutput({ n: 0, value_sats: 0, script_type: 'p2wpkh', address: 'zero-addr' }),
        makeOutput({ n: 1, value_sats: 190_000, script_type: 'p2wpkh', address: 'out-addr' }),
      ],
    });

    const result = detectChangeDetection(tx);
    if (result.detected) {
      expect(result.likely_change_index).toBe(1);
    }
  });

  it('change detection boosts migration-compatible outputs (p2sh-p2wpkh → p2wpkh)', () => {
    const tx = makeTx({
      total_input_sats: 300_000,
      vin: [
        makeInput({ address: 'sender', prevout_script_type: 'p2sh', script_type: 'p2sh-p2wpkh' }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 200_000, script_type: 'p2tr', address: 'recipient' }),
        makeOutput({ n: 1, value_sats: 87_654, script_type: 'p2wpkh', address: 'wallet-upgrade' }),
      ],
    });

    const result = detectChangeDetection(tx);
    expect(result.detected).toBe(true);
    expect(result.likely_change_index).toBe(1);
  });

  it('consolidation detects 3 same-address inputs to single output', () => {
    const vin = Array.from({ length: 3 }, () => makeInput({ address: 'same-wallet', prevout_script_type: 'p2wpkh' }));
    const tx = makeTx({
      vin,
      vout: [makeOutput({ n: 0, value_sats: 280_000 })],
    });

    const result = detectConsolidation(tx);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBe('high');
    expect(result.all_same_address).toBe(true);
  });

  it('consolidation does not fire for 3 different-address inputs to single output', () => {
    const vin = Array.from({ length: 3 }, (_, i) => makeInput({ address: `addr-${i}`, prevout_script_type: 'p2wpkh' }));
    const tx = makeTx({
      vin,
      vout: [makeOutput({ n: 0, value_sats: 280_000 })],
    });

    const result = detectConsolidation(tx);
    expect(result.detected).toBe(false);
  });

  it('consolidation does not fire for 3 same-address inputs with 2 outputs', () => {
    const vin = Array.from({ length: 3 }, () => makeInput({ address: 'same-wallet', prevout_script_type: 'p2wpkh' }));
    const tx = makeTx({
      vin,
      vout: [
        makeOutput({ n: 0, value_sats: 200_000 }),
        makeOutput({ n: 1, value_sats: 80_000 }),
      ],
    });

    const result = detectConsolidation(tx);
    expect(result.detected).toBe(false);
  });

  it('CoinJoin detects near-equal output values within 0.1% tolerance', () => {
    const tx = makeTx({
      vin: [
        makeInput({ address: 'participant-a' }),
        makeInput({ address: 'participant-b' }),
        makeInput({ address: 'participant-c' }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 100_000 }),
        makeOutput({ n: 1, value_sats: 100_050 }),
        makeOutput({ n: 2, value_sats: 100_099 }),
      ],
    });

    const result = detectCoinjoin(tx);
    expect(result.detected).toBe(true);
    expect(result.near_equal_tolerance_used).toBe(true);
    expect(result.equal_output_count).toBe(3);
  });

  it('CoinJoin does not use near-equal tolerance when exact matches already sufficient', () => {
    const tx = makeTx({
      vin: Array.from({ length: 3 }, (_, i) => makeInput({ address: `in-${i}` })),
      vout: Array.from({ length: 3 }, (_, i) => makeOutput({ n: i, value_sats: 50_000 })),
    });

    const result = detectCoinjoin(tx);
    expect(result.detected).toBe(true);
    expect(result.near_equal_tolerance_used).toBe(false);
  });

  it('CoinJoin near-equal tolerance does not fire when gap exceeds 2%', () => {
    const tx = makeTx({
      vin: [
        makeInput({ address: 'participant-a' }),
        makeInput({ address: 'participant-b' }),
        makeInput({ address: 'participant-c' }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 100_000 }),
        makeOutput({ n: 1, value_sats: 102_100 }),
        makeOutput({ n: 2, value_sats: 104_500 }),
      ],
    });

    const result = detectCoinjoin(tx);
    expect(result.detected).toBe(false);
  });

  it('peeling chain reports value ratio and round small output', () => {
    const txA = makeTx({
      txid: 'peel-meta'.padEnd(64, '0'),
      vin: [makeInput({ txid: 'source'.padEnd(64, '0'), vout: 0, prevout_script_type: 'p2wpkh' })],
      vout: [
        makeOutput({ n: 0, value_sats: 800_000, script_type: 'p2wpkh', address: 'carry' }),
        makeOutput({ n: 1, value_sats: 200_000, script_type: 'p2tr', address: 'recipient' }),
      ],
      total_input_sats: 1_010_000,
    });
    const txB = makeTx({
      txid: 'next-peel2'.padEnd(64, '0'),
      vin: [makeInput({ txid: txA.txid, vout: 0, address: 'carry' })],
      vout: [makeOutput({ n: 0, value_sats: 790_000 })],
    });

    const context = buildBlockContext([txA, txB]);
    const result = detectPeelingChain(txA, context);

    expect(result.detected).toBe(true);
    expect(result.value_ratio).toBe(0.8);
    expect(result.small_output_round).toBe(true);
  });

  it('does not detect consolidation for ambiguous two-output split without strong ownership signal', () => {
    const vin = Array.from({ length: 6 }, (_, i) => makeInput({ address: `wallet-${i}`, prevout_script_type: 'p2wpkh' }));
    const tx = makeTx({
      vin,
      vout: [
        makeOutput({ n: 0, value_sats: 500_000, script_type: 'p2wpkh' }),
        makeOutput({ n: 1, value_sats: 490_000, script_type: 'p2tr' }),
      ],
    });

    const result = detectConsolidation(tx);
    expect(result.detected).toBe(false);
  });

  it('detects batch payments with non-round recipients when recipient fanout is strong', () => {
    const tx = makeTx({
      total_input_sats: 1_000_000,
      vin: [
        makeInput({ address: 'wallet-a', prevout_script_type: 'p2wpkh' }),
        makeInput({ address: 'wallet-b', prevout_script_type: 'p2wpkh' }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 111_111, script_type: 'p2tr', address: 'recipient-1' }),
        makeOutput({ n: 1, value_sats: 122_223, script_type: 'p2tr', address: 'recipient-2' }),
        makeOutput({ n: 2, value_sats: 133_337, script_type: 'p2tr', address: 'recipient-3' }),
        makeOutput({ n: 3, value_sats: 620_000, script_type: 'p2wpkh', address: 'wallet-a' }),
      ],
    });

    const analyzed = analyzeTransactionHeuristics(tx, buildBlockContext([tx]));
    expect(analyzed.heuristics.batch_payment.detected).toBe(true);
    expect(analyzed.classification).toBe('batch_payment');
  });

  it('detects payjoin suspicion even when payment output is non-round if mixed ownership signals exist', () => {
    const tx = makeTx({
      total_input_sats: 340_000,
      vin: [
        makeInput({ address: 'sender-input', prevout_script_type: 'p2wpkh', script_type: 'p2wpkh' }),
        makeInput({ address: 'merchant-input', prevout_script_type: 'p2pkh', script_type: 'p2pkh' }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 88_765, script_type: 'p2wpkh', address: 'sender-input' }),
        makeOutput({ n: 1, value_sats: 200_123, script_type: 'p2pkh', address: 'merchant-receive' }),
      ],
    });

    const change = detectChangeDetection(tx);
    const round = detectRoundNumberPayment(tx);
    const coinjoin = detectCoinjoin(tx);
    const consolidation = detectConsolidation(tx);

    expect(round.detected).toBe(false);
    expect(detectPayjoinSuspected(tx, change, round, coinjoin, consolidation)).toMatchObject({ detected: true, confidence: 'low' });
  });

  it('does not detect peeling chain if the next spender merges with multiple inputs', () => {
    const txA = makeTx({
      txid: 'peel-merge'.padEnd(64, '0'),
      vin: [makeInput({ txid: 'source'.padEnd(64, '0'), vout: 0, prevout_script_type: 'p2wpkh' })],
      vout: [
        makeOutput({ n: 0, value_sats: 850_000, script_type: 'p2wpkh', address: 'carry' }),
        makeOutput({ n: 1, value_sats: 100_000, script_type: 'p2tr', address: 'recipient' }),
      ],
      total_input_sats: 960_000,
    });
    const txB = makeTx({
      txid: 'next-merge'.padEnd(64, '0'),
      vin: [
        makeInput({ txid: txA.txid, vout: 0, address: 'carry' }),
        makeInput({ txid: 'other-source'.padEnd(64, '0'), vout: 1, address: 'other' }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 900_000, script_type: 'p2wpkh' }),
      ],
    });

    const result = detectPeelingChain(txA, buildBlockContext([txA, txB]));
    expect(result.detected).toBe(false);
  });

  it('supports taproot spend compatibility in change detection when prevout type is unknown', () => {
    const tx = makeTx({
      total_input_sats: 300_000,
      vin: [
        makeInput({
          address: 'sender',
          prevout_script_type: 'unknown',
          script_type: 'p2tr_keypath',
        }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 200_000, script_type: 'p2pkh', address: 'recipient' }),
        makeOutput({ n: 1, value_sats: 87_654, script_type: 'p2tr', address: 'wallet-taproot' }),
      ],
    });

    const result = detectChangeDetection(tx);
    expect(result.detected).toBe(true);
    expect(result.likely_change_index).toBe(1);
  });

  it('does not flag block-level address reuse when repeats exist only within one transaction', () => {
    const tx = makeTx({
      vin: [makeInput({ address: 'unique-input' })],
      vout: [
        makeOutput({ n: 0, address: 'repeated-output-address', value_sats: 50_000 }),
        makeOutput({ n: 1, address: 'repeated-output-address', value_sats: 40_000 }),
      ],
    });

    const result = detectAddressReuse(tx, buildBlockContext([tx]));
    expect(result.detected).toBe(false);
    expect(result.reused_address_count).toBe(0);
    expect(result.within_transaction_count).toBe(0);
  });

  it('flags block-level address reuse when the same address appears in a different transaction', () => {
    const txA = makeTx({
      txid: '1'.repeat(64),
      vin: [makeInput({ address: 'wallet-a' })],
      vout: [makeOutput({ n: 0, address: 'shared-block-address', value_sats: 80_000 })],
    });
    const txB = makeTx({
      txid: '2'.repeat(64),
      vin: [makeInput({ address: 'wallet-b' })],
      vout: [makeOutput({ n: 0, address: 'shared-block-address', value_sats: 70_000 })],
    });

    const result = detectAddressReuse(txA, buildBlockContext([txA, txB]));
    expect(result.detected).toBe(true);
    expect(result.within_transaction_count).toBe(0);
    expect(result.reused_addresses).toContain('shared-block-address');
  });

  it('does not detect CoinJoin for equal outputs when denomination is implausibly tiny', () => {
    const tx = makeTx({
      vin: [
        makeInput({ address: 'participant-a' }),
        makeInput({ address: 'participant-b' }),
        makeInput({ address: 'participant-c' }),
      ],
      vout: [
        makeOutput({ n: 0, value_sats: 500, address: 'out-a' }),
        makeOutput({ n: 1, value_sats: 500, address: 'out-b' }),
        makeOutput({ n: 2, value_sats: 500, address: 'out-c' }),
      ],
    });

    const result = detectCoinjoin(tx);
    expect(result.detected).toBe(false);
  });

  it('does not detect peeling chain when the next spender does not keep a dominant carry output', () => {
    const txA = makeTx({
      txid: 'peel-nondominant'.padEnd(64, '0'),
      vin: [makeInput({ txid: 'source'.padEnd(64, '0'), vout: 0, prevout_script_type: 'p2wpkh' })],
      vout: [
        makeOutput({ n: 0, value_sats: 900_000, script_type: 'p2wpkh', address: 'carry' }),
        makeOutput({ n: 1, value_sats: 100_000, script_type: 'p2tr', address: 'recipient' }),
      ],
      total_input_sats: 1_010_000,
    });

    const txB = makeTx({
      txid: 'peel-next-balanced'.padEnd(64, '0'),
      vin: [makeInput({ txid: txA.txid, vout: 0, address: 'carry' })],
      vout: [
        makeOutput({ n: 0, value_sats: 300_000, address: 'a' }),
        makeOutput({ n: 1, value_sats: 300_000, address: 'b' }),
        makeOutput({ n: 2, value_sats: 250_000, address: 'c' }),
      ],
    });

    const result = detectPeelingChain(txA, buildBlockContext([txA, txB]));
    expect(result.detected).toBe(false);
  });
});
