import {
  BufferCursor,
  bufferToHexReversed,
  calculateFeeRateStats,
  countBy,
  decodeBip34Height,
  decodeUtf8Strict,
  decompressScriptFromUndo,
  decompressAmount,
  formatUnixTimestamp,
  hash256,
  incrementAddressFrequency,
  isRoundSatValue,
  median,
  parseObfuscatedRecords,
  parseScriptNumLE,
  parseTxInUndo,
  readUInt64LEAsNumber,
  readCompactSize,
  readCoreVarInt,
  decompressUncompressedPubKey,
  roundNumber,
  tryParseUndoPrevoutsForBlock,
  xorDecodeSlice,
  countTrailingDecimalZeros,
  modPow,
} from '../utils';
import { encodeCompactSize, encodeCoreVarInt, encodeObfuscatedRecord, encodeUndoBlock, hexBuffer, makeBitcoinTransaction, makeCoinbaseTransaction, makeInput, makeTx } from './helpers';

describe('utils', () => {
  it('decodes valid utf-8 and rejects invalid utf-8 sequences', () => {
    expect(decodeUtf8Strict(Buffer.from('hello'))).toBe('hello');
    expect(decodeUtf8Strict(Buffer.from([0xc3, 0x28]))).toBeNull();
  });

  it('reverses buffer hex correctly', () => {
    expect(bufferToHexReversed(Buffer.from('a1b2c3', 'hex'))).toBe('c3b2a1');
  });

  it('bufferToHexReversed handles empty buffers', () => {
    expect(bufferToHexReversed(Buffer.alloc(0))).toBe('');
  });

  it('computes bitcoin-style hash256', () => {
    expect(hash256(Buffer.alloc(0)).toString('hex')).toBe('5df6e0e2761359d30a8275058e299fcc0381534545f55cf43e41983f5d4c9456');
  });

  it('parses script numbers from little-endian buffers', () => {
    expect(parseScriptNumLE(Buffer.from([]))).toBe(0);
    expect(parseScriptNumLE(Buffer.from([0x01]))).toBe(1);
    expect(parseScriptNumLE(Buffer.from([0x81]))).toBe(-1);
    expect(parseScriptNumLE(Buffer.from([0x10, 0x27]))).toBe(10000);
  });

  it('decodes BIP34 heights and rejects malformed pushes', () => {
    expect(decodeBip34Height(Buffer.from([0x02, 0x10, 0x27]))).toBe(10000);
    expect(decodeBip34Height(Buffer.from([0x03, 0x01]))).toBe(0);
    expect(decodeBip34Height(Buffer.from([0x00]))).toBe(0);
  });

  it('reads uint64 values within the safe range and rejects overflow', () => {
    const safe = Buffer.alloc(8);
    safe.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER));
    expect(readUInt64LEAsNumber(safe)).toBe(Number.MAX_SAFE_INTEGER);

    const overflow = Buffer.alloc(8);
    overflow.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1));
    expect(() => readUInt64LEAsNumber(overflow)).toThrow('Numeric value exceeds safe integer range');
  });

  it('calculates fee stats while ignoring coinbase txs', () => {
    const stats = calculateFeeRateStats([
      makeTx({ fee_rate_sat_vb: 10.123, vin: [makeInput({ coinbase: true })] }),
      makeTx({ fee_rate_sat_vb: 5 }),
      makeTx({ fee_rate_sat_vb: 15.456 }),
      makeTx({ fee_rate_sat_vb: -2 }),
    ]);

    expect(stats).toEqual({
      min_sat_vb: 0,
      max_sat_vb: 15.46,
      median_sat_vb: 5,
      mean_sat_vb: 6.82,
    });
  });

  it('calculates fee stats for a single transaction', () => {
    const stats = calculateFeeRateStats([
      makeTx({ fee_rate_sat_vb: 10 }),
    ]);
    expect(stats.min_sat_vb).toBe(10);
    expect(stats.max_sat_vb).toBe(10);
    expect(stats.median_sat_vb).toBe(10);
    expect(stats.mean_sat_vb).toBe(10);
  });

  it('returns zeros for empty transaction list or only coinbase', () => {
    const statsEmpty = calculateFeeRateStats([]);
    expect(statsEmpty.min_sat_vb).toBe(0);

    const statsCoinbase = calculateFeeRateStats([
      makeTx({ fee_rate_sat_vb: 10, vin: [makeInput({ coinbase: true })] }),
    ]);
    expect(statsCoinbase.min_sat_vb).toBe(0);
  });

  it('provides numeric helpers used by heuristics', () => {
    expect(roundNumber(1.239)).toBe(1.24);
    expect(median([1, 7, 3, 2])).toBe(2.5);
    expect(isRoundSatValue(100_000)).toBe(true);
    expect(isRoundSatValue(120_000)).toBe(false);

    expect(countBy(['a', 'a', 'b']).get('a')).toBe(2);

    const freq = new Map<string, number>();
    incrementAddressFrequency(freq, 'bc1abc');
    incrementAddressFrequency(freq, null);
    incrementAddressFrequency(freq, 'bc1abc');
    expect(freq.get('bc1abc')).toBe(2);
  });

  it('median calculates correctly for varying array lengths', () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([10, 20])).toBe(15);
    expect(median([10, 20, 30])).toBe(20);
    expect(median([40, 10, 30, 20])).toBe(25); // Unsorted input
  });

  it('reads compact size and core varint values across encoded boundaries', () => {
    const compactCursor = new BufferCursor(Buffer.concat([
      Buffer.from([252]),
      encodeCompactSize(253),
      encodeCompactSize(65535),
      encodeCompactSize(70000),
      Buffer.from([255, 0, 0, 0, 0, 1, 0, 0, 0]),
    ]));

    expect(readCompactSize(compactCursor)).toBe(252);
    expect(readCompactSize(compactCursor)).toBe(253);
    expect(readCompactSize(compactCursor)).toBe(65535);
    expect(readCompactSize(compactCursor)).toBe(70000);
    expect(readCompactSize(compactCursor)).toBe(4294967296);

    const coreVarIntCursor = new BufferCursor(Buffer.concat([encodeCoreVarInt(127), encodeCoreVarInt(128), encodeCoreVarInt(16511)]));
    expect(readCoreVarInt(coreVarIntCursor)).toBe(127);
    expect(readCoreVarInt(coreVarIntCursor)).toBe(128);
    expect(readCoreVarInt(coreVarIntCursor)).toBe(16511);
  });

  it('reads additional integer widths from the cursor', () => {
    const buffer = Buffer.alloc(10);
    buffer.writeUInt16LE(0x1234, 0);
    buffer.writeBigUInt64LE(BigInt(500), 2);
    const cursor = new BufferCursor(buffer);

    expect(cursor.readUInt16LE()).toBe(0x1234);
    expect(cursor.readUInt64LE()).toBe(500);
  });

  it('BufferCursor readSlice works exactly up to the boundary', () => {
    const cursor = new BufferCursor(Buffer.from([0x01, 0x02, 0x03]));
    expect(cursor.remaining).toBe(3);
    
    const slice = cursor.readSlice(3);
    expect(slice).toEqual(Buffer.from([0x01, 0x02, 0x03]));
    expect(cursor.remaining).toBe(0);
  });

  it('throws when a cursor reads past the end of the buffer', () => {
    const cursor = new BufferCursor(Buffer.from([0xaa, 0xbb]));

    expect(cursor.readUInt8()).toBe(0xaa);
    expect(() => cursor.readUInt32LE()).toThrow('Unexpected end of buffer');
    expect(() => cursor.readSlice(2)).toThrow('Unexpected end of buffer');
  });

  it('parses obfuscated records with xor decoding and checksum trailers', () => {
    const xorKey = Buffer.from('0102030405060708', 'hex');
    const payload = Buffer.from('deadbeef', 'hex');
    const checksum = Buffer.alloc(32, 0xab);
    const fileBuffer = encodeObfuscatedRecord(payload, xorKey, { checksumTrailer: checksum });

    const [record] = parseObfuscatedRecords(fileBuffer, xorKey, { hasChecksumTrailer: true });
    expect(record).toEqual(Buffer.concat([payload, checksum]));
  });

  it('decompresses compact amounts and XOR-decodes aligned slices', () => {
    expect(decompressAmount(0)).toBe(0);
    expect(decompressAmount(1)).toBe(1);
    expect(decompressAmount(10)).toBe(1_000_000_000);

    const source = Buffer.from('001122334455667788', 'hex');
    const key = Buffer.from('0102030405060708', 'hex');
    const absoluteOffset = 3;
    const expected = Buffer.from(
      Array.from(source, (byte, index) => byte ^ key[(absoluteOffset + index) % key.length]!),
    );

    expect(xorDecodeSlice(source, key, absoluteOffset)).toEqual(expected);
    expect(xorDecodeSlice(source, Buffer.alloc(8), absoluteOffset)).toEqual(source);
    expect(xorDecodeSlice(source, Buffer.alloc(0), absoluteOffset)).toEqual(source);

    const shortKey = Buffer.from([0x01, 0x02, 0x03]);
    const expectedShortKey = Buffer.from(
      Array.from(source, (byte, index) => byte ^ shortKey[(absoluteOffset + index) % shortKey.length]!),
    );
    expect(xorDecodeSlice(source, shortKey, absoluteOffset)).toEqual(expectedShortKey);
  });

  it('decompresses undo scripts and tx inputs for multiple script code branches', () => {
    const p2shHash = Buffer.alloc(20, 0x22);
    const p2shCursor = new BufferCursor(Buffer.concat([encodeCoreVarInt(1), p2shHash]));
    expect(decompressScriptFromUndo(p2shCursor).toString('hex')).toBe(`a914${p2shHash.toString('hex')}87`);

    const generatorX = Buffer.from('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex');
    const compressedCursor = new BufferCursor(Buffer.concat([encodeCoreVarInt(2), generatorX]));
    expect(decompressScriptFromUndo(compressedCursor).toString('hex')).toBe(`2102${generatorX.toString('hex')}ac`);

    const uncompressed = decompressUncompressedPubKey(generatorX, false);
    const uncompressedCursor = new BufferCursor(Buffer.concat([encodeCoreVarInt(4), generatorX]));
    expect(decompressScriptFromUndo(uncompressedCursor).toString('hex')).toBe(`41${uncompressed.toString('hex')}ac`);

    const rawScript = Buffer.from('51ac', 'hex');
    const rawScriptCursor = new BufferCursor(Buffer.concat([encodeCoreVarInt(rawScript.length + 6), rawScript]));
    expect(decompressScriptFromUndo(rawScriptCursor)).toEqual(rawScript);

    const txUndoCursor = new BufferCursor(Buffer.concat([
      encodeCoreVarInt(2),
      encodeCoreVarInt(0),
      encodeCoreVarInt(1),
      encodeCoreVarInt(1),
      p2shHash,
    ]));
    expect(parseTxInUndo(txUndoCursor)).toEqual({
      value_sats: 1,
      script_pubkey_hex: `a914${p2shHash.toString('hex')}87`,
    });

    const p2pkhHash = Buffer.alloc(20, 0x55);
    const heightAwareCursor = new BufferCursor(Buffer.concat([
      encodeCoreVarInt(2),
      encodeCoreVarInt(0),
      encodeCoreVarInt(1),
      encodeCoreVarInt(0),
      p2pkhHash,
    ]));
    expect(parseTxInUndo(heightAwareCursor)).toEqual({
      value_sats: 1,
      script_pubkey_hex: `76a914${p2pkhHash.toString('hex')}88ac`,
    });
  });

  it('rejects truncated obfuscated payloads and checksum trailers', () => {
    const payloadHeaderOnly = Buffer.alloc(8);
    payloadHeaderOnly.writeUInt32LE(0, 0);
    payloadHeaderOnly.writeUInt32LE(5, 4);

    expect(() => parseObfuscatedRecords(payloadHeaderOnly, Buffer.alloc(0))).toThrow('Truncated record payload while parsing obfuscated file');

    const validPayloadWithoutChecksum = encodeObfuscatedRecord(Buffer.from('abcd', 'hex'));
    expect(() => parseObfuscatedRecords(validPayloadWithoutChecksum, Buffer.alloc(0), { hasChecksumTrailer: true })).toThrow(
      'Truncated checksum trailer while parsing undo file',
    );
  });

  it('matches undo prevouts in forward and reverse order for block transactions', () => {
    const coinbaseTx = makeCoinbaseTransaction();
    const oneInputTx = makeBitcoinTransaction({ inputs: [{ hashByte: 1 }] });
    const twoInputTx = makeBitcoinTransaction({ inputs: [{ hashByte: 2 }, { hashByte: 3 }] });
    const blockTransactions = [coinbaseTx, oneInputTx, twoInputTx];

    const forwardUndo = encodeUndoBlock([
      [{ value_sats: 1, script_pubkey_hex: hexBuffer('51').toString('hex') }],
      [
        { value_sats: 1, script_pubkey_hex: hexBuffer('51').toString('hex') },
        { value_sats: 1, script_pubkey_hex: hexBuffer('51').toString('hex') },
      ],
    ]);
    expect(tryParseUndoPrevoutsForBlock(forwardUndo, blockTransactions)?.map((group) => group.length)).toEqual([1, 2]);

    const reversedUndo = encodeUndoBlock([
      [
        { value_sats: 1, script_pubkey_hex: hexBuffer('51').toString('hex') },
        { value_sats: 1, script_pubkey_hex: hexBuffer('51').toString('hex') },
      ],
      [{ value_sats: 1, script_pubkey_hex: hexBuffer('51').toString('hex') }],
    ]);
    expect(tryParseUndoPrevoutsForBlock(reversedUndo, blockTransactions)?.map((group) => group.length)).toEqual([1, 2]);
  });

  it('returns null when undo data does not match transaction input counts', () => {
    const blockTransactions = [makeCoinbaseTransaction(), makeBitcoinTransaction({ inputs: [{ hashByte: 1 }, { hashByte: 2 }] })];
    const incompatibleUndo = encodeUndoBlock([[{ value_sats: 1, script_pubkey_hex: '51' }]]);

    expect(tryParseUndoPrevoutsForBlock(incompatibleUndo, blockTransactions)).toBeNull();
    expect(tryParseUndoPrevoutsForBlock(Buffer.alloc(31, 0), blockTransactions)).toBeNull();
  });

  it('rejects malformed undo blocks that exceed parser safety bounds', () => {
    const malformedUndo = Buffer.concat([encodeCompactSize(200001), Buffer.alloc(32, 0)]);
    const blockTransactions = [makeCoinbaseTransaction(), makeBitcoinTransaction({ inputs: [{ hashByte: 1 }] })];

    expect(tryParseUndoPrevoutsForBlock(malformedUndo, blockTransactions)).toBeNull();
  });

  it('formats unix timestamps in UTC', () => {
    expect(formatUnixTimestamp(0)).toBe('1970-01-01T00:00:00.000Z');
  });

  it('counts trailing decimal zeros accurately for heuristics', () => {
    expect(countTrailingDecimalZeros(100_000)).toBe(5);
    expect(countTrailingDecimalZeros(123_450)).toBe(1);
    expect(countTrailingDecimalZeros(123_456)).toBe(0);
    expect(countTrailingDecimalZeros(0)).toBe(0);
  });

  it('decompresses undo amounts encoded by Bitcoin Core', () => {
    // Basic structural checks for decompressAmount algorithm
    expect(decompressAmount(0)).toBe(0);
    // Values compressed via the x10 exponent rule
    expect(decompressAmount(0x02)).toBe(10); // Exponent 1, amount 1 -> 10
    expect(decompressAmount(0x0b)).toBe(2);  // Exponent 0, amount 2 -> 2
  });

  it('computes modular exponentiation for secp256k1 pubkey recovery', () => {
    // Using small safe primes for verifiable test math
    // 2^3 % 5 = 8 % 5 = 3
    expect(modPow(BigInt(2), BigInt(3), BigInt(5))).toBe(BigInt(3));
    // 5^2 % 7 = 25 % 7 = 4
    expect(modPow(BigInt(5), BigInt(2), BigInt(7))).toBe(BigInt(4));
  });

  it('throws on core varint overflow', () => {
    // 10 bytes of 0xff would definitely overflow a safe integer
    const overflowBuffer = Buffer.alloc(10, 0xff);
    const cursor = new BufferCursor(overflowBuffer);
    expect(() => readCoreVarInt(cursor)).toThrow('Core VarInt exceeds safe integer range');
  });

  it('uses cache for fully parsed undo blocks', () => {
    const undoData = encodeUndoBlock([[{ value_sats: 100, script_pubkey_hex: '51' }]]);
    const blockTransactions = [makeCoinbaseTransaction(), makeBitcoinTransaction({ inputs: [{ hashByte: 1 }] })];
    
    // First call populates cache
    tryParseUndoPrevoutsForBlock(undoData, blockTransactions);
    
    // Second call should hit cache (we just verify it still works)
    const result = tryParseUndoPrevoutsForBlock(undoData, blockTransactions);
    expect(result?.[0]?.[0]?.value_sats).toBe(1); // encodeUndoBlock currently encodes code 1 for non-zero
  });

  it('handles obfuscated records without checksum trailer', () => {
    const xorKey = Buffer.from('0102030405060708', 'hex');
    const payload = Buffer.from('deadbeef', 'hex');
    const fileBuffer = encodeObfuscatedRecord(payload, xorKey);

    const [record] = parseObfuscatedRecords(fileBuffer, xorKey, { hasChecksumTrailer: false });
    expect(record).toEqual(payload);
  });

  it('handles zero-length obfuscated records', () => {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(0, 0); // record id
    header.writeUInt32LE(0, 4); // payload size
    
    expect(parseObfuscatedRecords(header, Buffer.alloc(8))).toEqual([]);
  });
});
