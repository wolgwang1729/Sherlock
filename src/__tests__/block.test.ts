import { buildBlockChainAnalysis } from '../lib/block';
import { HEURISTIC_IDS } from '../types';
import { makeParsedBlock, makeTx, makeInput } from './helpers';

describe('block analysis', () => {
  it('builds block chain analysis with per-transaction heuristic output', () => {
    const parsedBlock = makeParsedBlock({
      block_height: 321,
      parsed_transactions: [
        makeTx({ txid: '1'.repeat(64) }),
        makeTx({ txid: '2'.repeat(64), vin: [
          {
            ...makeTx().vin[0],
            address: 'a1',
          },
          {
            ...makeTx().vin[0],
            address: 'a2',
          },
        ] }),
      ],
      tx_count: 2,
    });

    const result = buildBlockChainAnalysis(parsedBlock);
    expect(result.block_height).toBe(321);
    expect(result.tx_count).toBe(2);
    expect(result.transactions).toHaveLength(2);
    expect(result.analysis_summary.heuristics_applied).toEqual(HEURISTIC_IDS);
  });

  it('handles empty fee rates in block chain analysis', () => {
    const parsedBlock = makeParsedBlock({
      parsed_transactions: [
        makeTx({ vin: [makeInput({ coinbase: true })] }),
      ],
    });
    const result = buildBlockChainAnalysis(parsedBlock);
    expect(result.analysis_summary.fee_rate_stats.min_sat_vb).toBe(0);
  });

});
