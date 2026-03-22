import * as bitcoin from 'bitcoinjs-lib';
import { TransactionAnalysis, Vin, Vout, ParsedBlockRecord, HeuristicId, ResolvedPrevout } from '../types';

export const P2PKH_SCRIPT_HEX = '76a914111111111111111111111111111111111111111188ac';
export const P2WPKH_SCRIPT_HEX = '00141111111111111111111111111111111111111111';
export const P2TR_SCRIPT_HEX = '51201111111111111111111111111111111111111111111111111111111111111111';

export function hexBuffer(hex: string): Buffer {
  return Buffer.from(hex, 'hex');
}

export function makePrevout(overrides: Partial<ResolvedPrevout> = {}): ResolvedPrevout {
  return {
    value_sats: 100_000,
    script_pubkey_hex: P2WPKH_SCRIPT_HEX,
    script_type: 'p2wpkh',
    address: 'bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq5d8f8',
    ...overrides,
  };
}

export function makeTxInput(hashByte: number, index = 0, sequence = 0xffffffff, script = Buffer.alloc(0)): bitcoin.Transaction['ins'][number] {
  return {
    hash: Buffer.alloc(32, hashByte),
    index,
    script,
    sequence,
    witness: [],
  };
}

export function makeBitcoinTransaction(options?: {
  version?: number;
  locktime?: number;
  inputs?: Array<{
    hashByte?: number;
    index?: number;
    sequence?: number;
    script?: Buffer;
    witness?: Buffer[];
  }>;
  outputs?: Array<{
    script?: Buffer;
    value?: bigint;
  }>;
}): bitcoin.Transaction {
  const tx = new bitcoin.Transaction();
  tx.version = options?.version ?? 2;
  tx.locktime = options?.locktime ?? 0;

  const inputs = options?.inputs ?? [{ hashByte: 1 }];
  for (const input of inputs) {
    tx.addInput(
      Buffer.alloc(32, input.hashByte ?? 1),
      input.index ?? 0,
      input.sequence ?? 0xffffffff,
      input.script ?? Buffer.alloc(0),
    );
  }

  const outputs = options?.outputs ?? [{ script: hexBuffer(P2WPKH_SCRIPT_HEX), value: BigInt(90_000) }];
  for (const output of outputs) {
    tx.addOutput(output.script ?? hexBuffer(P2WPKH_SCRIPT_HEX), output.value ?? BigInt(90_000));
  }

  for (const [index, input] of inputs.entries()) {
    tx.ins[index]!.witness = input.witness ?? [];
  }

  return tx;
}

export function makeCoinbaseTransaction(options?: {
  script?: Buffer;
  sequence?: number;
  outputs?: Array<{ script?: Buffer; value?: bigint }>;
}): bitcoin.Transaction {
  return makeBitcoinTransaction({
    version: 1,
    inputs: [
      {
        hashByte: 0,
        index: 0xffffffff,
        sequence: options?.sequence ?? 0xffffffff,
        script: options?.script ?? Buffer.from([0x01, 0x01]),
      },
    ],
    outputs: options?.outputs,
  });
}

export function makePrevoutResolver(prevouts: Array<ResolvedPrevout | undefined>) {
  return vi.fn((_: bitcoin.Transaction['ins'][number], inputIndex: number) => prevouts[inputIndex]);
}

export function encodeCoreVarInt(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('encodeCoreVarInt requires a non-negative safe integer');
  }

  const bytes: number[] = [];
  let remaining = value;
  let isFinalChunk = true;

  while (true) {
    let byte = remaining & 0x7f;
    if (!isFinalChunk) {
      byte |= 0x80;
    }
    bytes.unshift(byte);

    if (remaining <= 0x7f) {
      break;
    }

    remaining = (remaining >> 7) - 1;
    isFinalChunk = false;
  }

  return Buffer.from(bytes);
}

export function encodeCompactSize(value: number): Buffer {
  if (value < 253) {
    return Buffer.from([value]);
  }
  if (value <= 0xffff) {
    const buffer = Buffer.alloc(3);
    buffer[0] = 253;
    buffer.writeUInt16LE(value, 1);
    return buffer;
  }
  const buffer = Buffer.alloc(5);
  buffer[0] = 254;
  buffer.writeUInt32LE(value, 1);
  return buffer;
}

export function encodeUndoBlock(prevoutGroups: Array<Array<{ value_sats: number; script_pubkey_hex: string }>>): Buffer {
  const chunks = [encodeCompactSize(prevoutGroups.length)];
  for (const group of prevoutGroups) {
    chunks.push(encodeCompactSize(group.length));
    for (const prevout of group) {
      chunks.push(encodeCoreVarInt(0));
      chunks.push(encodeCoreVarInt(prevout.value_sats === 0 ? 0 : 1));
      const script = hexBuffer(prevout.script_pubkey_hex);
      chunks.push(encodeCoreVarInt(script.length + 6));
      chunks.push(script);
    }
  }
  chunks.push(Buffer.alloc(32, 0));
  return Buffer.concat(chunks);
}

export function encodeObfuscatedRecord(payload: Buffer, xorKey = Buffer.alloc(0), options?: { checksumTrailer?: Buffer }): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(0xf9beb4d9, 0);
  header.writeUInt32LE(payload.length, 4);

  const parts = [header, payload];
  if (options?.checksumTrailer) {
    parts.push(options.checksumTrailer);
  }

  if (xorKey.length === 0 || xorKey.every((byte) => byte === 0)) {
    return Buffer.concat(parts);
  }

  const combined = Buffer.concat(parts);
  const encoded = Buffer.alloc(combined.length);
  for (let index = 0; index < combined.length; index += 1) {
    encoded[index] = combined[index]! ^ xorKey[index % xorKey.length]!;
  }
  return encoded;
}

export function makeInput(overrides: Partial<Vin> = {}): Vin {
  return {
    txid: 'a'.repeat(64),
    vout: 0,
    sequence: 0xffffffff,
    script_sig_hex: '',
    script_asm: '',
    witness: [],
    script_type: 'p2wpkh',
    prevout_script_type: 'p2wpkh',
    address: 'bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq5d8f8',
    prevout: {
      value_sats: 100_000,
      script_pubkey_hex: '00140000000000000000000000000000000000000000',
    },
    relative_timelock: {
      enabled: false,
    },
    ...overrides,
  };
}

export function makeOutput(overrides: Partial<Vout> = {}): Vout {
  return {
    n: 0,
    value_sats: 90_000,
    script_pubkey_hex: '00140000000000000000000000000000000000000000',
    script_asm: '',
    script_type: 'p2wpkh',
    address: 'bc1qyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyk9z49',
    ...overrides,
  };
}

export function makeTx(overrides: Partial<TransactionAnalysis> = {}): TransactionAnalysis {
  const vin = overrides.vin ?? [makeInput()];
  const vout = overrides.vout ?? [makeOutput()];
  const totalInput = overrides.total_input_sats ?? vin.reduce((sum, input) => sum + input.prevout.value_sats, 0);
  const totalOutput = overrides.total_output_sats ?? vout.reduce((sum, output) => sum + output.value_sats, 0);
  const fee = overrides.fee_sats ?? totalInput - totalOutput;
  const vbytes = overrides.vbytes ?? 100;

  return {
    ok: true,
    network: 'mainnet',
    segwit: false,
    txid: 'f'.repeat(64),
    wtxid: null,
    version: 2,
    locktime: 0,
    size_bytes: 100,
    weight: 400,
    vbytes,
    total_input_sats: totalInput,
    total_output_sats: totalOutput,
    fee_sats: fee,
    fee_rate_sat_vb: overrides.fee_rate_sat_vb ?? Math.max(0, fee / vbytes),
    rbf_signaling: false,
    locktime_type: 'none',
    locktime_value: 0,
    segwit_savings: null,
    vin,
    vout,
    warnings: [],
    ...overrides,
  };
}

export function makeParsedBlock(overrides: Partial<ParsedBlockRecord> = {}): ParsedBlockRecord {
  const parsedTransactions = overrides.parsed_transactions ?? [makeTx({ txid: '1'.repeat(64) })];
  return {
    block_hash: '0'.repeat(64),
    block_height: 100,
    timestamp: 1_700_000_000,
    tx_count: parsedTransactions.length,
    parsed_transactions: parsedTransactions,
    ...overrides,
  };
}

export function triggeredHeuristics(ids: HeuristicId[] = []): Record<HeuristicId, { detected: boolean }> {
  return {
    cioh: { detected: ids.includes('cioh') },
    change_detection: { detected: ids.includes('change_detection') },
    address_reuse: { detected: ids.includes('address_reuse') },
    coinjoin: { detected: ids.includes('coinjoin') },
    consolidation: { detected: ids.includes('consolidation') },
    batch_payment: { detected: ids.includes('batch_payment') },
    self_transfer: { detected: ids.includes('self_transfer') },
    peeling_chain: { detected: ids.includes('peeling_chain') },
    op_return: { detected: ids.includes('op_return') },
    round_number_payment: { detected: ids.includes('round_number_payment') },
  };
}
