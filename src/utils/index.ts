import * as bitcoin from 'bitcoinjs-lib';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { FeeRateStats, TransactionAnalysis } from '../types';

export const OPS = bitcoin.opcodes;

const P2PKH_PREFIX = Buffer.from([OPS.OP_DUP, OPS.OP_HASH160, 0x14]);
const P2PKH_SUFFIX = Buffer.from([OPS.OP_EQUALVERIFY, OPS.OP_CHECKSIG]);
const P2SH_PREFIX = Buffer.from([OPS.OP_HASH160, 0x14]);
const P2SH_SUFFIX = Buffer.from([OPS.OP_EQUAL]);
const P2PK_UNCOMPRESSED_PREFIX = Buffer.from([0x41]);
const CHECKSIG_SUFFIX = Buffer.from([OPS.OP_CHECKSIG]);

const XOR_SCRATCH = Buffer.allocUnsafe(8);
// Upper bound guardrail when decoding potentially malformed undo structures.
const PARSE_SAFETY_MAX_ITEM_COUNT = 200_000;
// Keep numeric report values at two decimal places.
const ROUND_NUMBER_DECIMAL_SCALE = 100;

export const OPCODE_NAME_BY_CODE: Record<number, string> = Object.entries(OPS).reduce(
  (map, [name, value]) => {
    if (typeof value === 'number' && name.startsWith('OP_') && !map[value]) {
      map[value] = name;
    }
    return map;
  },
  {} as Record<number, string>,
);

export function decodeUtf8Strict(buffer: Buffer): string | null {
  if (buffer.length === 0) {
    return '';
  }
  const decoded = buffer.toString('utf8');
  return Buffer.from(decoded, 'utf8').equals(buffer) ? decoded : null;
}

export function readUInt64LEAsNumber(buffer: Buffer): number {
  const value = buffer.readBigUInt64LE(0);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Numeric value exceeds safe integer range');
  }
  return Number(value);
}

export function hash256(data: Buffer): Buffer {
  return createHash('sha256').update(createHash('sha256').update(data).digest()).digest();
}

export function bufferToHexReversed(buffer: Buffer): string {
  return Buffer.from(buffer).reverse().toString('hex');
}

export function parseScriptNumLE(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0;
  }
  
  const lastIndex = buffer.length - 1;
  let lastByte = buffer[lastIndex]!;
  const negative = (lastByte & 0x80) !== 0;

  // Clear the sign bit on our local number variable, leaving the buffer untouched
  lastByte = lastByte & 0x7f; 

  let value = 0;
  // Loop through all bytes EXCEPT the last one
  for (let index = 0; index < lastIndex; index += 1) {
    value += buffer[index]! * (256 ** index);
  }
  
  // Add our modified last byte
  value += lastByte * (256 ** lastIndex);

  return negative ? -value : value;
}

export function decodeBip34Height(scriptSig: Buffer): number {
  if (scriptSig.length === 0) {
    return 0;
  }
  const pushLength = scriptSig[0]!;
  if (pushLength === 0 || 1 + pushLength > scriptSig.length) {
    return 0;
  }
  return parseScriptNumLE(scriptSig.slice(1, 1 + pushLength));
}

export class BufferCursor {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  get remaining(): number {
    return this.buffer.length - this.offset;
  }

  get currentOffset(): number {
    return this.offset;
  }

  readUInt8(): number {
    if (this.remaining < 1) throw new Error('Unexpected end of buffer');
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readUInt16LE(): number {
    if (this.remaining < 2) throw new Error('Unexpected end of buffer');
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  readUInt32LE(): number {
    if (this.remaining < 4) throw new Error('Unexpected end of buffer');
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readUInt64LE(): number {
    if (this.remaining < 8) throw new Error('Unexpected end of buffer');
    const value = readUInt64LEAsNumber(this.buffer.slice(this.offset, this.offset + 8));
    this.offset += 8;
    return value;
  }

  readSlice(length: number): Buffer {
    if (length < 0 || this.remaining < length) throw new Error('Unexpected end of buffer');
    const slice = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }
}

export function readCompactSize(cursor: BufferCursor): number {
  const first = cursor.readUInt8();
  if (first < 253) return first;
  if (first === 253) return cursor.readUInt16LE();
  if (first === 254) return cursor.readUInt32LE();
  return cursor.readUInt64LE();
}

export function readCoreVarInt(cursor: BufferCursor): number {
  let value = 0;
  while (true) {
    const byte = cursor.readUInt8();
    value = value * 128 + (byte & 0x7f);
    if (value > Number.MAX_SAFE_INTEGER) {
      throw new Error('Core VarInt exceeds safe integer range');
    }
    if ((byte & 0x80) !== 0) {
      value += 1;
      continue;
    }
    return value;
  }
}

export function decompressAmount(code: number): number {
  if (code === 0) return 0;
  let value = code - 1;
  const exponent = value % 10;
  value = Math.floor(value / 10);

  let amount: number;
  if (exponent < 9) {
    const digit = (value % 9) + 1;
    value = Math.floor(value / 9);
    amount = value * 10 + digit;
  } else {
    amount = value + 1;
  }

  for (let index = 0; index < exponent; index += 1) {
    amount *= 10;
  }
  return amount;
}

export const SECP256K1_P = (BigInt(1) << BigInt(256)) - (BigInt(1) << BigInt(32)) - BigInt(977);

export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = BigInt(1);
  let factor = ((base % modulus) + modulus) % modulus;
  let exp = exponent;
  while (exp > 0) {
    if ((exp & BigInt(1)) === BigInt(1)) {
      result = (result * factor) % modulus;
    }
    factor = (factor * factor) % modulus;
    exp >>= BigInt(1);
  }
  return result;
}

export function bigintTo32ByteBuffer(value: bigint): Buffer {
  return Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
}

export function decompressUncompressedPubKey(xBytes: Buffer, odd: boolean): Buffer {
  const x = BigInt(`0x${xBytes.toString('hex')}`);
  const ySquared = (modPow(x, BigInt(3), SECP256K1_P) + BigInt(7)) % SECP256K1_P;
  let y = modPow(ySquared, (SECP256K1_P + BigInt(1)) >> BigInt(2), SECP256K1_P);
  if ((y * y) % SECP256K1_P !== ySquared) {
    throw new Error('Invalid compressed pubkey in undo script');
  }
  if (((y & BigInt(1)) === BigInt(1)) !== odd) {
    y = (SECP256K1_P - y) % SECP256K1_P;
  }
  return Buffer.concat([Buffer.from([0x04]), xBytes, bigintTo32ByteBuffer(y)]);
}

export function decompressScriptFromUndo(cursor: BufferCursor): Buffer {
  const scriptCode = readCoreVarInt(cursor);

  if (scriptCode === 0) {
    return Buffer.concat([P2PKH_PREFIX, cursor.readSlice(20), P2PKH_SUFFIX]);
  }

  if (scriptCode === 1) {
    return Buffer.concat([P2SH_PREFIX, cursor.readSlice(20), P2SH_SUFFIX]);
  }

  if (scriptCode === 2 || scriptCode === 3) {
    return Buffer.concat([Buffer.from([0x21, scriptCode]), cursor.readSlice(32), CHECKSIG_SUFFIX]);
  }

  if (scriptCode === 4 || scriptCode === 5) {
    const x = cursor.readSlice(32);
    const pubkey = decompressUncompressedPubKey(x, scriptCode === 5);
    return Buffer.concat([P2PK_UNCOMPRESSED_PREFIX, pubkey, CHECKSIG_SUFFIX]);
  }

  return cursor.readSlice(scriptCode - 6);
}

export function parseTxInUndo(cursor: BufferCursor): { value_sats: number; script_pubkey_hex: string } {
  const metadataCode = readCoreVarInt(cursor);
  const height = Math.floor(metadataCode / 2);
  if (height > 0) {
    readCoreVarInt(cursor);
  }
  return {
    value_sats: decompressAmount(readCoreVarInt(cursor)),
    script_pubkey_hex: decompressScriptFromUndo(cursor).toString('hex'),
  };
}

export function xorDecodeSlice(source: Buffer, key: Buffer, absoluteOffset: number): Buffer {
  if (key.length === 0 || key.every((byte) => byte === 0)) {
    return Buffer.from(source);
  }
  const decoded = Buffer.allocUnsafe(source.length);
  const keyLen = key.length;
  let i = 0;

  if (keyLen === 8) {
    const shift = absoluteOffset % 8;
    key.copy(XOR_SCRATCH, 0, shift, 8);
    key.copy(XOR_SCRATCH, 8 - shift, 0, shift);
    
    const k0 = XOR_SCRATCH.readUInt32LE(0);
    const k1 = XOR_SCRATCH.readUInt32LE(4);
    
    while (i + 8 <= source.length) {
      decoded.writeUInt32LE((source.readUInt32LE(i) ^ k0) >>> 0, i);
      decoded.writeUInt32LE((source.readUInt32LE(i + 4) ^ k1) >>> 0, i + 4);
      i += 8;
    }
  }

  for (; i < source.length; i += 1) {
    decoded[i] = source[i]! ^ key[(absoluteOffset + i) % keyLen]!;
  }
  return decoded;
}

export function parseObfuscatedRecords(fileBuffer: Buffer, xorKey: Buffer, options?: { hasChecksumTrailer?: boolean }): Buffer[] {
  const records: Buffer[] = [];
  let offset = 0;
  const hasChecksumTrailer = options?.hasChecksumTrailer === true;

  while (offset + 8 <= fileBuffer.length) {
    const header = xorDecodeSlice(fileBuffer.slice(offset, offset + 8), xorKey, offset);
    const payloadSize = header.readUInt32LE(4);
    offset += 8;

    if (payloadSize === 0) {
      continue;
    }
    if (offset + payloadSize > fileBuffer.length) {
      throw new Error('Truncated record payload while parsing obfuscated file');
    }

    const payload = xorDecodeSlice(fileBuffer.slice(offset, offset + payloadSize), xorKey, offset);
    offset += payloadSize;

    if (hasChecksumTrailer) {
      if (offset + 32 > fileBuffer.length) {
        throw new Error('Truncated checksum trailer while parsing undo file');
      }
      const checksum = xorDecodeSlice(fileBuffer.slice(offset, offset + 32), xorKey, offset);
      records.push(Buffer.concat([payload, checksum]));
      offset += 32;
    } else {
      records.push(payload);
    }
  }

  return records;
}

const parsedUndoCache = new WeakMap<Buffer, any>();
const PARSE_ERROR = Symbol('PARSE_ERROR');

function parseFullyUndoBlock(undoBuffer: Buffer): Array<Array<{ value_sats: number; script_pubkey_hex: string }>> | null {
  if (parsedUndoCache.has(undoBuffer)) {
    const cached = parsedUndoCache.get(undoBuffer);
    return cached === PARSE_ERROR ? null : (cached as any);
  }

  try {
    const cursor = new BufferCursor(undoBuffer.slice(0, undoBuffer.length - 32));
    const txUndoCount = readCompactSize(cursor);
    
    // Safety bound to prevent infinite loops on garbage data
    if (txUndoCount > PARSE_SAFETY_MAX_ITEM_COUNT) throw new Error('txUndoCount too large');

    const undoPrevoutsRaw: Array<Array<{ value_sats: number; script_pubkey_hex: string }>> = [];
    for (let txIndex = 0; txIndex < txUndoCount; txIndex += 1) {
      const vinUndoCount = readCompactSize(cursor);
      
      // Safety bound
      if (vinUndoCount > PARSE_SAFETY_MAX_ITEM_COUNT) throw new Error('vinUndoCount too large');
      
      const prevouts: Array<{ value_sats: number; script_pubkey_hex: string }> = [];
      for (let inputIndex = 0; inputIndex < vinUndoCount; inputIndex += 1) {
        prevouts.push(parseTxInUndo(cursor));
      }
      undoPrevoutsRaw.push(prevouts);
    }

    parsedUndoCache.set(undoBuffer, undoPrevoutsRaw);
    return undoPrevoutsRaw;
  } catch {
    parsedUndoCache.set(undoBuffer, PARSE_ERROR);
    return null;
  }
}

export function tryParseUndoPrevoutsForBlock(
  undoBuffer: Buffer,
  blockTransactions: bitcoin.Transaction[],
): Array<Array<{ value_sats: number; script_pubkey_hex: string }>> | null {
  if (undoBuffer.length < 32) {
    return null;
  }

  const expectedNonCoinbaseCount = blockTransactions.length - 1;
  const parsed = parseFullyUndoBlock(undoBuffer);
  
  if (!parsed || parsed.length < expectedNonCoinbaseCount) {
    return null;
  }

  const undoPrevoutsRaw = parsed.slice(0, expectedNonCoinbaseCount);

  const forwardMatches = undoPrevoutsRaw.every((prevouts, index) => prevouts.length === blockTransactions[index + 1]!.ins.length);
  const reverseMatches = undoPrevoutsRaw.every(
    (prevouts, index) => prevouts.length === blockTransactions[expectedNonCoinbaseCount - index]!.ins.length,
  );

  if (!forwardMatches && !reverseMatches) {
    return null;
  }

  return forwardMatches ? undoPrevoutsRaw : [...undoPrevoutsRaw].reverse();
}

export function roundNumber(value: number): number {
  return Math.round(value * ROUND_NUMBER_DECIMAL_SCALE) / ROUND_NUMBER_DECIMAL_SCALE;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 0) {
    return roundNumber((values[middle - 1]! + values[middle]!) / 2);
  }
  return roundNumber(values[middle]!);
}

export function calculateFeeRateStats(transactions: Iterable<TransactionAnalysis>): FeeRateStats {
  let minSatVb = Infinity;
  let maxSatVb = -Infinity;
  let totalFeeRate = 0;
  let count = 0;
  const feeRates: number[] = [];

  for (const tx of transactions) {
    if (!tx.vin.some((input) => input.coinbase)) {
      const rate = Math.max(0, tx.fee_rate_sat_vb);
      feeRates.push(rate);
      
      if (rate < minSatVb) minSatVb = rate;
      if (rate > maxSatVb) maxSatVb = rate;
      totalFeeRate += rate;
      count += 1;
    }
  }

  if (count === 0) {
    return { min_sat_vb: 0, max_sat_vb: 0, median_sat_vb: 0, mean_sat_vb: 0 };
  }

  return {
    min_sat_vb: roundNumber(minSatVb),
    max_sat_vb: roundNumber(maxSatVb),
    median_sat_vb: median(feeRates),
    mean_sat_vb: roundNumber(totalFeeRate / count),
  };
}

export function countTrailingDecimalZeros(value: number): number {
  if (value === 0) return 0;
  let remaining = value;
  let zeros = 0;
  while (remaining % 10 === 0) {
    remaining /= 10;
    zeros += 1;
  }
  return zeros;
}

export function isRoundSatValue(valueSats: number): boolean {
  return valueSats >= 100_000 && countTrailingDecimalZeros(valueSats) >= 5;
}

export function countBy<T extends string | number>(values: T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export function incrementAddressFrequency(addressFrequency: Map<string, number>, address: string | null): void {
  if (!address) return;
  addressFrequency.set(address, (addressFrequency.get(address) ?? 0) + 1);
}

export function formatUnixTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

export function sampleArray<T>(values: T[], limit = 5): T[] {
  return values.length <= limit ? values : values.slice(0, limit);
}

export function compareStringsLexicographically(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function compareInputsBip69(
  left: { txid: string; vout: number },
  right: { txid: string; vout: number },
): number {
  const txidComparison = compareStringsLexicographically(left.txid, right.txid);
  return txidComparison !== 0 ? txidComparison : left.vout - right.vout;
}

export function compareOutputsBip69(
  left: { value_sats: number; script_pubkey_hex: string },
  right: { value_sats: number; script_pubkey_hex: string },
): number {
  return left.value_sats !== right.value_sats
    ? left.value_sats - right.value_sats
    : compareStringsLexicographically(left.script_pubkey_hex, right.script_pubkey_hex);
}

export function isSortedByComparator<T>(values: T[], comparator: (left: T, right: T) => number): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (comparator(values[index - 1]!, values[index]!) > 0) {
      return false;
    }
  }
  return true;
}

export function computeAddressReuseRatio(addresses: Array<string | null>): number {
  const nonNullAddresses = addresses.filter((address): address is string => Boolean(address));
  if (nonNullAddresses.length === 0) return 0;
  return +(1 - new Set(nonNullAddresses).size / nonNullAddresses.length).toFixed(4);
}

export const isCoinbase = (tx: TransactionAnalysis): boolean => 
  tx.vin.some(input => input.coinbase);

export const getSpendableOutputs = (tx: TransactionAnalysis) => 
  tx.vout.filter(output => output.script_type !== 'op_return');

export function getDistinctAddresses(items: Array<{ address?: string | null }>): Set<string> {
  return new Set(items.map((item) => item.address).filter((a): a is string => Boolean(a)));
}

export function getScriptTypes(items: Array<{ prevout_script_type: string }>): string[] {
  return items.map((item) => item.prevout_script_type);
}

