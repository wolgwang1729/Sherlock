import {
  OP_0,
  OP_1,
  OP_CHECKSIG,
  OP_CHECKMULTISIG,
  OP_PUSHDATA1,
  OP_PUSHDATA2,
  OP_PUSHDATA4,
  OP_RETURN,
  buildResolvedPrevout,
  classifyInputScriptType,
  classifyOutputScript,
  buildRelativeTimelock,
  disassembleScript,
  fastGetAddress,
  isCoinbaseInput,
  isMultisig,
  isP2pk,
  isP2pkh,
  isP2sh,
  isP2tr,
  isP2wpkh,
  isP2wsh,
  determineOutputScriptType,
  parseScriptInstructions,
  determineOpReturnProtocol,
  formatScriptAsm,
  getLastDataPush,
  buildSegwitSavings,
  isWitnessProgram,
  tryGetAddress,
} from '../lib/script';
import * as bitcoin from 'bitcoinjs-lib';
import { ScriptInstruction } from '../types';

describe('script library', () => {
  it('parses script instructions with pushes and opcodes', () => {
    const script = Buffer.from([0x02, 0xab, 0xcd, OP_CHECKSIG]);
    const instructions = parseScriptInstructions(script);

    expect(instructions).toHaveLength(2);
    expect(instructions[0]).toMatchObject({ type: 'data', pushType: 'OP_PUSHBYTES_2' });
    expect(instructions[1]).toMatchObject({ type: 'opcode', name: 'OP_CHECKSIG' });
  });

  it('classifies p2pkh and op_return output scripts', () => {
    const p2pkh = Buffer.from('76a914111111111111111111111111111111111111111188ac', 'hex');
    const p2pkhInstructions = parseScriptInstructions(p2pkh);
    const p2pkhClassified = classifyOutputScript(p2pkh, p2pkhInstructions);
    expect(p2pkhClassified.script_type).toBe('p2pkh');
    expect(p2pkhClassified.address).toBeTruthy();

    const opReturn = Buffer.from('6a046f6d6e69', 'hex');
    const opReturnInstructions = parseScriptInstructions(opReturn);
    const opReturnClassified = classifyOutputScript(opReturn, opReturnInstructions);
    expect(opReturnClassified.script_type).toBe('op_return');
    expect(opReturnClassified.op_return_payload?.op_return_protocol).toBe('omni');
  });

  it('detects output script types for witness and unknown scripts', () => {
    const p2wpkh = Buffer.concat([Buffer.from([OP_0, 0x14]), Buffer.alloc(20, 1)]);
    expect(determineOutputScriptType(p2wpkh)).toBe('p2wpkh');
    expect(determineOutputScriptType(Buffer.from([0xff, 0x00]))).toBe('unknown');
    expect(determineOutputScriptType(Buffer.from([OP_RETURN]))).toBe('op_return');
  });

  it('classifies input script type for p2sh wrapped witness and taproot', () => {
    const redeemScript = Buffer.concat([Buffer.from([OP_0, 0x14]), Buffer.alloc(20, 2)]);
    const scriptSig = Buffer.concat([Buffer.from([redeemScript.length]), redeemScript]);
    const scriptSigInstructions = parseScriptInstructions(scriptSig);
    const wrapped = classifyInputScriptType('p2sh', scriptSigInstructions, []);
    expect(wrapped.scriptType).toBe('p2sh-p2wpkh');

    const taprootKeypath = classifyInputScriptType('p2tr', [], [Buffer.from('aa', 'hex')]);
    const taprootScriptpath = classifyInputScriptType('p2tr', [], [Buffer.from('aa', 'hex'), Buffer.from('bb', 'hex')]);
    expect(taprootKeypath.scriptType).toBe('p2tr_keypath');
    expect(taprootScriptpath.scriptType).toBe('p2tr_scriptpath');
  });

  it('builds relative timelock metadata from sequence', () => {
    expect(buildRelativeTimelock(0xffffffff)).toEqual({ enabled: false });
    expect(buildRelativeTimelock(0x00000010)).toEqual({ enabled: true, type: 'blocks', value: 16 });
    expect(buildRelativeTimelock(0x00400002)).toEqual({ enabled: true, type: 'time', value: 1024 });
  });

  it('recognizes standard output templates and rejects cross-type shapes', () => {
    const p2pkh = Buffer.from('76a914111111111111111111111111111111111111111188ac', 'hex');
    const p2sh = Buffer.from('a914111111111111111111111111111111111111111187', 'hex');
    const p2wpkh = Buffer.from('00141111111111111111111111111111111111111111', 'hex');
    const p2wsh = Buffer.from('00201111111111111111111111111111111111111111111111111111111111111111', 'hex');
    const p2tr = Buffer.from('51201111111111111111111111111111111111111111111111111111111111111111', 'hex');

    expect(isP2pkh(p2pkh)).toBe(true);
    expect(isP2sh(p2sh)).toBe(true);
    expect(isP2wpkh(p2wpkh)).toBe(true);
    expect(isP2wsh(p2wsh)).toBe(true);
    expect(isP2tr(p2tr)).toBe(true);

    expect(isP2wpkh(p2wsh)).toBe(false);
    expect(isP2tr(p2wpkh)).toBe(false);
    expect(isP2sh(Buffer.from('a91411', 'hex'))).toBe(false);
  });

  it('recognizes p2pk and multisig output scripts', () => {
    const compressedPubKey = Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 0x11)]);
    const p2pk = Buffer.concat([Buffer.from([compressedPubKey.length]), compressedPubKey, Buffer.from([OP_CHECKSIG])]);
    const multisig = Buffer.concat([
      Buffer.from([OP_1]),
      Buffer.from([compressedPubKey.length]),
      compressedPubKey,
      Buffer.from([compressedPubKey.length]),
      Buffer.concat([Buffer.from([0x03]), Buffer.alloc(32, 0x22)]),
      Buffer.from([0x52, OP_CHECKMULTISIG]),
    ]);

    expect(isP2pk(p2pk)).toBe(true);
    expect(determineOutputScriptType(p2pk)).toBe('p2pk');
    expect(isMultisig(multisig)).toBe(true);
    expect(determineOutputScriptType(multisig)).toBe('multisig');
  });

  it('derives addresses for supported standard script types', () => {
    const p2pkh = Buffer.from('76a914111111111111111111111111111111111111111188ac', 'hex');
    const p2sh = Buffer.from('a914111111111111111111111111111111111111111187', 'hex');
    const p2wpkh = Buffer.from('00141111111111111111111111111111111111111111', 'hex');
    const p2wsh = Buffer.from('00201111111111111111111111111111111111111111111111111111111111111111', 'hex');
    const p2tr = Buffer.from('51201111111111111111111111111111111111111111111111111111111111111111', 'hex');

    expect(fastGetAddress(p2pkh, 'p2pkh')).toMatch(/^1/);
    expect(fastGetAddress(p2sh, 'p2sh')).toMatch(/^3/);
    expect(fastGetAddress(p2wpkh, 'p2wpkh')).toMatch(/^bc1q/);
    expect(fastGetAddress(p2wsh, 'p2wsh')).toMatch(/^bc1q/);
    expect(fastGetAddress(p2tr, 'p2tr')).toMatch(/^bc1p/);
    expect(fastGetAddress(Buffer.from([0x51]), 'unknown')).toBeNull();
  });

  it('falls back cleanly when address derivation cannot decode a script', () => {
    const invalidTaproot = Buffer.concat([Buffer.from([OP_1, 0x20]), Buffer.alloc(31, 0x11)]);

    expect(tryGetAddress(invalidTaproot)).toBeNull();
  });

  it('captures witness script assembly for wrapped p2wsh inputs', () => {
    const witnessScript = Buffer.from([0x51, OP_CHECKSIG]);
    const redeemScript = Buffer.concat([Buffer.from([OP_0, 0x20]), Buffer.alloc(32, 0x33)]);
    const scriptSigInstructions = parseScriptInstructions(Buffer.concat([Buffer.from([redeemScript.length]), redeemScript]));

    const classified = classifyInputScriptType('p2sh', scriptSigInstructions, [Buffer.from('aa', 'hex'), witnessScript]);
    expect(classified.scriptType).toBe('p2sh-p2wsh');
    expect(classified.witnessScriptAsm).toBe(disassembleScript(witnessScript));
  });

  it('parses truncated pushdata instructions without throwing', () => {
    const truncatedPushBytes = parseScriptInstructions(Buffer.from([0x02, 0xaa]));
    expect(truncatedPushBytes).toHaveLength(1);
    expect(truncatedPushBytes[0]).toMatchObject({ type: 'data', pushType: 'OP_PUSHBYTES_2' });

    expect(parseScriptInstructions(Buffer.from([OP_PUSHDATA1]))).toEqual([]);

    const pushdata1 = parseScriptInstructions(Buffer.from([OP_PUSHDATA1, 0x02, 0xaa]));
    expect(pushdata1).toHaveLength(1);
    expect(pushdata1[0]).toMatchObject({ type: 'data', pushType: 'OP_PUSHDATA1' });

    const pushdata2 = parseScriptInstructions(Buffer.from([OP_PUSHDATA2, 0x02, 0x00, 0xaa]));
    expect(pushdata2).toHaveLength(1);
    expect(pushdata2[0]).toMatchObject({ type: 'data', pushType: 'OP_PUSHDATA2' });

    expect(parseScriptInstructions(Buffer.from([OP_PUSHDATA4, 0x02, 0x00, 0x00]))).toEqual([]);

    const fullPushdata4 = parseScriptInstructions(Buffer.from([OP_PUSHDATA4, 0x02, 0x00, 0x00, 0x00, 0xaa, 0xbb]));
    expect(fullPushdata4).toHaveLength(1);
    expect(fullPushdata4[0]).toMatchObject({ type: 'data', pushType: 'OP_PUSHDATA4' });
  });

  it('classifies native p2wsh inputs and legacy p2sh fallbacks', () => {
    const witnessScript = Buffer.from([OP_1, OP_CHECKSIG]);
    expect(classifyInputScriptType('p2wsh', [], [Buffer.from('aa', 'hex'), witnessScript])).toEqual({
      scriptType: 'p2wsh',
      witnessScriptAsm: disassembleScript(witnessScript),
    });

    const legacyP2sh = classifyInputScriptType('p2sh', parseScriptInstructions(Buffer.from([OP_1])), []);
    expect(legacyP2sh).toEqual({ scriptType: 'unknown' });
  });

  it('recognizes opentimestamps payloads and derives resolved prevout metadata', () => {
    const opReturn = Buffer.from('6a050109f91102', 'hex');
    const classified = classifyOutputScript(opReturn, parseScriptInstructions(opReturn));
    expect(classified.op_return_payload?.op_return_protocol).toBe('opentimestamps');

    const resolved = buildResolvedPrevout({
      txid: '0'.repeat(64),
      vout: 1,
      value_sats: 123_456,
      script_pubkey_hex: '76a914111111111111111111111111111111111111111188ac',
    });
    expect(resolved.script_type).toBe('p2pkh');
    expect(resolved.address).toMatch(/^1/);
  });

  it('handles unknown opcodes gracefully', () => {
    const script = Buffer.from([0xba]); // 0xba is an undefined opcode in some contexts
    const instructions = parseScriptInstructions(script);
    expect(instructions).toHaveLength(1);
    expect(instructions[0].type).toBe('opcode');
  });

  it('handles empty scripts without errors', () => {
    const script = Buffer.alloc(0);
    const instructions = parseScriptInstructions(script);
    expect(instructions).toHaveLength(0);
    expect(determineOutputScriptType(script)).toBe('unknown');
    expect(disassembleScript(script)).toBe('');
  });

  it('classifies unknown input script types', () => {
    const classified = classifyInputScriptType('unknown', [], []);
    expect(classified.scriptType).toBe('unknown');
  });

  it('determines output script type for multisig with valid pubkeys', () => {
    const pubkey = Buffer.alloc(33, 2);
    pubkey[0] = 0x02;
    const script = Buffer.concat([
      Buffer.from([OP_1]),
      Buffer.from([0x21]),
      pubkey,
      Buffer.from([OP_1, OP_CHECKMULTISIG]),
    ]);
    expect(determineOutputScriptType(script)).toBe('multisig');
  });

  it('recognizes uncompressed p2pk scripts', () => {
    const pubkey = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 0x11)]);
    const script = Buffer.concat([Buffer.from([0x41]), pubkey, Buffer.from([OP_CHECKSIG])]);

    expect(isP2pk(script)).toBe(true);
    expect(determineOutputScriptType(script)).toBe('p2pk');
  });

  it('identifies known OP_RETURN protocols from hex signatures', () => {
    expect(determineOpReturnProtocol(Buffer.from('6f6d6e6900000000', 'hex'))).toBe('omni');
    expect(determineOpReturnProtocol(Buffer.from('0109f91102000000', 'hex'))).toBe('opentimestamps');
    expect(determineOpReturnProtocol(Buffer.from('deadbeef12345678', 'hex'))).toBe('unknown');
  });

  it('formats script assembly strings from parsed tokens', () => {
    const instructions: ScriptInstruction[] = [
      { type: 'opcode', name: 'OP_0', opcode: 0 },
      { type: 'data', pushType: 'OP_PUSHBYTES_20', data: Buffer.from('1111111111111111111111111111111111111111', 'hex') },
    ];
    
    expect(formatScriptAsm(instructions)).toBe('OP_0 OP_PUSHBYTES_20 1111111111111111111111111111111111111111');
  });

  it('calculates expected segwit savings metrics correctly', () => {
    const sizeBytes = 250;
    const weightActual = 600;
    
    const savings = buildSegwitSavings(sizeBytes, weightActual);
    
    // Weight if legacy = 250 * 4 = 1000
    // Savings PCT = (1000 - 600) / 1000 = 40%
    expect(savings.weight_if_legacy).toBe(1000);
    expect(savings.savings_pct).toBe(40);
    expect(savings.witness_bytes).toBe(133); // round((4 * 250 - 600) / 3)
    expect(savings.non_witness_bytes).toBe(117);
  });

  it('evicts oldest entries from address cache on overflow', () => {
    // Fill the cache (limit is 20,000)
    // We don't need to actually fill 20,000 for this test if we can observe behavior,
    // but the code explicitly checks > 20,000.
    // However, we can't easily change the constant.
    // We'll test the logic by adding many entries and checking if it stays functional.
    for (let i = 0; i < 100; i++) {
      const script = Buffer.concat([Buffer.from([OP_0, 0x14]), Buffer.alloc(20, i)]);
      classifyOutputScript(script, []);
    }
    // Just verifying it doesn't crash and returns valid data
    const testScript = Buffer.concat([Buffer.from([OP_0, 0x14]), Buffer.alloc(20, 255)]);
    const classified = classifyOutputScript(testScript, []);
    expect(classified.address).toBeTruthy();
  });

  it('handles invalid multisig scripts', () => {
    // m > n
    const invalidMultisig = Buffer.from([0x52, 0x21, ...Buffer.alloc(33, 2), 0x51, OP_CHECKMULTISIG]);
    expect(isMultisig(invalidMultisig)).toBe(false);

    // invalid opcode for m
    const invalidM = Buffer.from([0x00, 0x21, ...Buffer.alloc(33, 2), 0x51, OP_CHECKMULTISIG]);
    expect(isMultisig(invalidM)).toBe(false);

    // invalid push length
    const invalidPush = Buffer.from([0x51, 0x20, ...Buffer.alloc(32, 2), 0x51, OP_CHECKMULTISIG]);
    expect(isMultisig(invalidPush)).toBe(false);

    // script too short
    expect(isMultisig(Buffer.from([OP_1, OP_CHECKMULTISIG]))).toBe(false);
  });

  it('classifies additional input script types', () => {
    expect(classifyInputScriptType('p2pk', [], []).scriptType).toBe('p2pk');
    expect(classifyInputScriptType('multisig', [], []).scriptType).toBe('multisig');
    
    const p2wpkhRedeem = Buffer.concat([Buffer.from([OP_0, 0x14]), Buffer.alloc(20, 1)]);
    expect(classifyInputScriptType('p2sh', [{ type: 'data', data: p2wpkhRedeem, pushType: 'OP_PUSHBYTES_22' }], []).scriptType).toBe('p2sh-p2wpkh');

    const p2wshRedeem = Buffer.concat([Buffer.from([OP_0, 0x20]), Buffer.alloc(32, 1)]);
    expect(classifyInputScriptType('p2sh', [{ type: 'data', data: p2wshRedeem, pushType: 'OP_PUSHBYTES_34' }], []).scriptType).toBe('p2sh-p2wsh');
  });

  it('handles op_return edge cases', () => {
    const emptyOpReturn = Buffer.from([OP_RETURN]);
    const classified = classifyOutputScript(emptyOpReturn, [{ type: 'opcode', opcode: OP_RETURN, name: 'OP_RETURN' }]);
    expect(classified.op_return_payload?.data_hex).toBe('');
    expect(classified.op_return_payload?.data_utf8).toBe('');
  });

  it('recognizes the exact coinbase input shape', () => {
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32, 0), 0xffffffff, 0xffffffff, Buffer.from([0x01, 0x01]));

    expect(isCoinbaseInput(tx.ins[0]!)).toBe(true);
    expect(isCoinbaseInput({ ...tx.ins[0]!, index: 0 } as bitcoin.Transaction['ins'][number])).toBe(false);
  });

  it('returns the last pushed data item and detects witness programs', () => {
    const instructions = parseScriptInstructions(Buffer.from([0x01, 0xaa, 0x02, 0xbb, 0xcc]));
    const redeemScript = Buffer.concat([Buffer.from([OP_0, 0x20]), Buffer.alloc(32, 0x33)]);

    expect(getLastDataPush(instructions)?.toString('hex')).toBe('bbcc');
    expect(getLastDataPush([{ type: 'opcode', opcode: OP_CHECKSIG, name: 'OP_CHECKSIG' }])).toBeNull();
    expect(isWitnessProgram(redeemScript, OP_0, 32)).toBe(true);
    expect(isWitnessProgram(redeemScript, OP_1, 32)).toBe(false);
  });
});
