import { analyzeTransactionWithResolver } from '../lib/transaction';
import {
  P2PKH_SCRIPT_HEX,
  P2WPKH_SCRIPT_HEX,
  hexBuffer,
  makeBitcoinTransaction,
  makeCoinbaseTransaction,
  makePrevout,
  makePrevoutResolver,
} from './helpers';

describe('transaction analysis', () => {
  it('treats coinbase inputs as self-funded and skips prevout resolution', () => {
    const tx = makeCoinbaseTransaction({
      script: Buffer.from([0x02, 0x10, 0x27]),
      outputs: [{ script: hexBuffer(P2WPKH_SCRIPT_HEX), value: BigInt(500_000_000) }],
    });
    const resolver = vi.fn();

    const analysis = analyzeTransactionWithResolver(tx, 'mainnet', resolver, { coinbase: true });

    expect(resolver).not.toHaveBeenCalled();
    expect(analysis.vin).toHaveLength(1);
    expect(analysis.vin[0]).toMatchObject({ coinbase: true, script_type: 'unknown' });
    expect(analysis.total_input_sats).toBe(analysis.total_output_sats);
    expect(analysis.fee_sats).toBe(0);
    expect(analysis.locktime_type).toBe('none');
    expect(analysis.wtxid).toBeNull();
    expect(analysis.warnings).toEqual([]);
  });

  it('throws when a non-coinbase input cannot be resolved', () => {
    const tx = makeBitcoinTransaction();

    expect(() => analyzeTransactionWithResolver(tx, 'mainnet', () => undefined)).toThrow('Missing prevout for input 0');
  });

  it('analyzes segwit transactions and emits fee, dust, unknown-script, and rbf warnings', () => {
    const tx = makeBitcoinTransaction({
      locktime: 600_000_000,
      inputs: [
        {
          hashByte: 7,
          sequence: 0x00400002,
          witness: [Buffer.alloc(71, 0x30), Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 0x44)])],
        },
      ],
      outputs: [
        { script: hexBuffer(P2WPKH_SCRIPT_HEX), value: BigInt(20_000) },
        { script: Buffer.from([0xff, 0x00]), value: BigInt(100) },
      ],
    });

    const analysis = analyzeTransactionWithResolver(
      tx,
      'mainnet',
      makePrevoutResolver([
        makePrevout({
          value_sats: 2_000_000,
          script_pubkey_hex: P2WPKH_SCRIPT_HEX,
          script_type: 'p2wpkh',
        }),
      ]),
    );

    expect(analysis.segwit).toBe(true);
    expect(analysis.wtxid).toMatch(/^[a-f0-9]{64}$/);
    expect(analysis.segwit_savings).not.toBeNull();
    expect(analysis.locktime_type).toBe('unix_timestamp');
    expect(analysis.locktime_value).toBe(600_000_000);
    expect(analysis.rbf_signaling).toBe(true);
    expect(analysis.vin[0]).toMatchObject({
      script_type: 'p2wpkh',
      prevout_script_type: 'p2wpkh',
      relative_timelock: { enabled: true, type: 'time', value: 1024 },
    });
    expect(analysis.vout[1]).toMatchObject({ script_type: 'unknown', value_sats: 100 });
    expect(analysis.fee_sats).toBe(1_979_900);
    expect(analysis.warnings.map((warning) => warning.code)).toEqual([
      'RBF_SIGNALING',
      'HIGH_FEE',
      'DUST_OUTPUT',
      'UNKNOWN_OUTPUT_SCRIPT',
    ]);
  });

  it('aggregates multiple prevouts and preserves output classification details', () => {
    const tx = makeBitcoinTransaction({
      locktime: 450_000,
      inputs: [
        { hashByte: 1 },
        { hashByte: 2, index: 1 },
      ],
      outputs: [
        { script: hexBuffer(P2PKH_SCRIPT_HEX), value: BigInt(100_000) },
        { script: Buffer.from('6a046f6d6e69', 'hex'), value: BigInt(0) },
      ],
    });
    const resolver = makePrevoutResolver([
      makePrevout({ value_sats: 50_000, script_pubkey_hex: P2PKH_SCRIPT_HEX, script_type: 'p2pkh' }),
      makePrevout({ value_sats: 60_000, script_pubkey_hex: P2WPKH_SCRIPT_HEX, script_type: 'p2wpkh' }),
    ]);

    const analysis = analyzeTransactionWithResolver(tx, 'mainnet', resolver);

    expect(resolver).toHaveBeenCalledTimes(2);
    expect(analysis.segwit).toBe(false);
    expect(analysis.total_input_sats).toBe(110_000);
    expect(analysis.total_output_sats).toBe(100_000);
    expect(analysis.fee_sats).toBe(10_000);
    expect(analysis.locktime_type).toBe('block_height');
    expect(analysis.vout[0]).toMatchObject({ script_type: 'p2pkh' });
    expect(analysis.vout[1]).toMatchObject({
      script_type: 'op_return',
      op_return_data_hex: '6f6d6e69',
      op_return_protocol: 'omni',
    });
    expect(analysis.warnings).toEqual([]);
  });
});