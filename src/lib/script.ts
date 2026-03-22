import * as bitcoin from 'bitcoinjs-lib';
import { OutputScriptType, InputScriptType, OpReturnProtocol, ScriptInstruction, Vin, SegwitSavings, ScriptPushToken, PrevoutInput, ResolvedPrevout } from '../types';
import { decodeUtf8Strict, OPCODE_NAME_BY_CODE, roundNumber } from '../utils';
import { normalizeSummaryScriptType, emptyScriptTypeDistribution } from './heuristics';

export const MAINNET = bitcoin.networks.bitcoin;
const OPS = bitcoin.opcodes;

export const {
  OP_PUSHDATA1,
  OP_PUSHDATA2,
  OP_PUSHDATA4,
  OP_RETURN,
  OP_0,
  OP_1,
  OP_16,
  OP_CHECKSIG,
  OP_CHECKMULTISIG,
} = OPS;

export function parseScriptInstructions(script: Buffer): ScriptInstruction[] {
  const instructions: ScriptInstruction[] = [];
  let offset = 0;

  while (offset < script.length) {
    const opcode = script[offset++]!;

    if (opcode >= 0x01 && opcode <= 0x4b) {
      const length = opcode;
      const end = Math.min(script.length, offset + length);
      const data = script.slice(offset, end);
      instructions.push({ type: 'data', pushType: `OP_PUSHBYTES_${length}`, data });
      offset = end;
      if (data.length < length) {
        break;
      }
      continue;
    }

    if (opcode === OP_PUSHDATA1) {
      if (offset + 1 > script.length) {
        break;
      }
      const length = script[offset++]!;
      const end = Math.min(script.length, offset + length);
      const data = script.slice(offset, end);
      instructions.push({ type: 'data', pushType: 'OP_PUSHDATA1', data });
      offset = end;
      if (data.length < length) {
        break;
      }
      continue;
    }

    if (opcode === OP_PUSHDATA2) {
      if (offset + 2 > script.length) {
        break;
      }
      const length = script.readUInt16LE(offset);
      offset += 2;
      const end = Math.min(script.length, offset + length);
      const data = script.slice(offset, end);
      instructions.push({ type: 'data', pushType: 'OP_PUSHDATA2', data });
      offset = end;
      if (data.length < length) {
        break;
      }
      continue;
    }

    if (opcode === OP_PUSHDATA4) {
      if (offset + 4 > script.length) {
        break;
      }
      const length = script.readUInt32LE(offset);
      offset += 4;
      const end = Math.min(script.length, offset + length);
      const data = script.slice(offset, end);
      instructions.push({ type: 'data', pushType: 'OP_PUSHDATA4', data });
      offset = end;
      if (data.length < length) {
        break;
      }
      continue;
    }

    instructions.push({
      type: 'opcode',
      opcode,
      name: OPCODE_NAME_BY_CODE[opcode] ?? `OP_UNKNOWN_${opcode.toString(16).padStart(2, '0')}`,
    });
  }

  return instructions;
}

export function formatScriptAsm(instructions: ScriptInstruction[]): string {
  return instructions
    .map((instruction) => {
      if (instruction.type === 'opcode') {
        return instruction.name;
      }
      return `${instruction.pushType} ${instruction.data.toString('hex')}`;
    })
    .join(' ');
}

const OMNI_PREFIX = Buffer.from([0x6f, 0x6d, 0x6e, 0x69]);
const OTS_PREFIX = Buffer.from([0x01, 0x09, 0xf9, 0x11, 0x02]);

export function determineOpReturnProtocol(payload: Buffer): OpReturnProtocol {
  if (payload.length >= 4 && payload.subarray(0, 4).equals(OMNI_PREFIX)) {
    return 'omni';
  }
  if (payload.length >= 5 && payload.subarray(0, 5).equals(OTS_PREFIX)) {
    return 'opentimestamps';
  }
  return 'unknown';
}

export function determineOutputScriptType(script: Buffer): OutputScriptType {
  if (isP2wpkh(script)) return 'p2wpkh';
  if (isP2tr(script)) return 'p2tr';
  if (isP2sh(script)) return 'p2sh';
  if (isP2pkh(script)) return 'p2pkh';
  if (isP2wsh(script)) return 'p2wsh';
  if (isOpReturnScript(script)) return 'op_return';
  if (isP2pk(script)) return 'p2pk';
  if (isMultisig(script)) return 'multisig';
  return 'unknown';
}

const MAX_ADDRESS_CACHE_ENTRIES = 20_000;
const globalAddressCache = new Map<string, string | null>();

export function clearAddressCache(): void {
  globalAddressCache.clear();
}

function getCachedAddress(scriptHex: string): string | null | undefined {
  const cached = globalAddressCache.get(scriptHex);
  if (cached !== undefined) {
    globalAddressCache.delete(scriptHex);
    globalAddressCache.set(scriptHex, cached);
  }
  return cached;
}

function setCachedAddress(scriptHex: string, address: string | null): void {
  if (globalAddressCache.has(scriptHex)) {
    globalAddressCache.delete(scriptHex);
  }
  globalAddressCache.set(scriptHex, address);

  if (globalAddressCache.size > MAX_ADDRESS_CACHE_ENTRIES) {
    const oldestKey = globalAddressCache.keys().next().value;
    if (oldestKey !== undefined) {
      globalAddressCache.delete(oldestKey);
    }
  }
}

export function fastGetAddress(script: Buffer, script_type: OutputScriptType): string | null {
  if (script_type === 'p2pkh') {
    return bitcoin.address.toBase58Check(script.subarray(3, 23), MAINNET.pubKeyHash);
  }
  if (script_type === 'p2sh') {
    return bitcoin.address.toBase58Check(script.subarray(2, 22), MAINNET.scriptHash);
  }
  if (script_type === 'p2wpkh') {
    return bitcoin.address.toBech32(script.subarray(2, 22), 0, MAINNET.bech32);
  }
  if (script_type === 'p2wsh') {
    return bitcoin.address.toBech32(script.subarray(2, 34), 0, MAINNET.bech32);
  }
  if (script_type === 'p2tr') {
    return bitcoin.address.toBech32(script.subarray(2, 34), 1, MAINNET.bech32);
  }
  return null;
}

export function classifyOutputScript(
  script: Buffer,
  instructions: ScriptInstruction[],
  scriptHex?: string
): {
  script_type: OutputScriptType;
  address: string | null;
  op_return_payload:
    | {
        data_hex: string;
        data_utf8: string | null;
        op_return_protocol: OpReturnProtocol;
      }
    | undefined;
} {
  const script_type = determineOutputScriptType(script);
  let address: string | null = null;
  if (script_type !== 'op_return') {
    const hex = scriptHex ?? script.toString('hex');
    const cached = getCachedAddress(hex);
    if (cached !== undefined) {
      address = cached;
    } else {
      address = fastGetAddress(script, script_type);
      if (address === null && script_type === 'unknown') {
        address = tryGetAddress(script);
      }
      setCachedAddress(hex, address);
    }
  }

  let op_return_payload;
  if (script_type === 'op_return') {
    const opcodeIndex = instructions.findIndex((instruction) => instruction.type === 'opcode' && instruction.name === 'OP_RETURN');
    const payloadInstructions = opcodeIndex >= 0 ? instructions.slice(opcodeIndex + 1) : [];
    const payload = Buffer.concat(
      payloadInstructions
        .filter((instruction): instruction is ScriptPushToken => instruction.type === 'data')
        .map((instruction) => instruction.data),
    );

    op_return_payload = {
      data_hex: payload.toString('hex'),
      data_utf8: payload.length === 0 ? '' : decodeUtf8Strict(payload),
      op_return_protocol: determineOpReturnProtocol(payload),
    };
  }

  return { script_type, address, op_return_payload };
}

export function tryGetAddress(script: Buffer): string | null {
  try {
    return bitcoin.address.fromOutputScript(script, MAINNET);
  } catch {
    if (isP2tr(script)) {
      try {
        return bitcoin.address.toBech32(script.slice(2), 1, MAINNET.bech32);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function isP2pkh(script: Buffer): boolean {
  return (
    script.length === 25 &&
    script[0] === OPS.OP_DUP &&
    script[1] === OPS.OP_HASH160 &&
    script[2] === 0x14 &&
    script[23] === OPS.OP_EQUALVERIFY &&
    script[24] === OPS.OP_CHECKSIG
  );
}

export function isP2sh(script: Buffer): boolean {
  return script.length === 23 && script[0] === OPS.OP_HASH160 && script[1] === 0x14 && script[22] === OPS.OP_EQUAL;
}

export function isP2wpkh(script: Buffer): boolean {
  return script.length === 22 && script[0] === OP_0 && script[1] === 0x14;
}

export function isP2wsh(script: Buffer): boolean {
  return script.length === 34 && script[0] === OP_0 && script[1] === 0x20;
}

export function isP2tr(script: Buffer): boolean {
  return script.length === 34 && script[0] === OP_1 && script[1] === 0x20;
}

export function isOpReturnScript(script: Buffer): boolean {
  return script.length > 0 && script[0] === OP_RETURN;
}

export function isP2pk(script: Buffer): boolean {
  return (
    (script.length === 35 && script[0] === 0x21 && script[34] === OP_CHECKSIG) ||
    (script.length === 67 && script[0] === 0x41 && script[66] === OP_CHECKSIG)
  );
}

export function isMultisig(script: Buffer): boolean {
  if (script.length < 3 || script[script.length - 1] !== OP_CHECKMULTISIG) {
    return false;
  }
  const firstByte = script[0]!;
  const nByte = script[script.length - 2]!;
  if (firstByte < OP_1 || firstByte > OP_16 || nByte < OP_1 || nByte > OP_16) {
    return false;
  }
  const m = firstByte - OP_1 + 1;
  const n = nByte - OP_1 + 1;
  if (m > n) {
    return false;
  }
  let offset = 1;
  let pubkeyCount = 0;
  while (offset < script.length - 2) {
    const pushLen = script[offset]!;
    if (pushLen !== 0x21 && pushLen !== 0x41) {
      return false;
    }
    offset += 1 + pushLen;
    pubkeyCount += 1;
  }
  return pubkeyCount === n && offset === script.length - 2;
}

export function getLastDataPush(instructions: ScriptInstruction[]): Buffer | null {
  for (let index = instructions.length - 1; index >= 0; index -= 1) {
    const instruction = instructions[index]!;
    if (instruction.type === 'data') {
      return instruction.data;
    }
  }
  return null;
}

export function isWitnessProgram(script: Buffer, versionOpcode: number, programLength: number): boolean {
  return script.length === 2 + programLength && script[0] === versionOpcode && script[1] === programLength;
}

export function disassembleScript(script: Buffer): string {
  return formatScriptAsm(parseScriptInstructions(script));
}

export function classifyInputScriptType(
  prevoutScriptType: OutputScriptType,
  scriptSigInstructions: ScriptInstruction[],
  witnessBuffers: Buffer[],
): { scriptType: InputScriptType; witnessScriptAsm?: string } {
  const redeemScript = getLastDataPush(scriptSigInstructions);

  switch (prevoutScriptType) {
    case 'p2pkh':
      return { scriptType: 'p2pkh' };
    case 'p2pk':
      return { scriptType: 'p2pk' };
    case 'multisig':
      return { scriptType: 'multisig' };
    case 'p2wpkh':
      return { scriptType: 'p2wpkh' };
    case 'p2wsh': {
      const result: { scriptType: InputScriptType; witnessScriptAsm?: string } = { scriptType: 'p2wsh' };
      if (witnessBuffers.length > 0) {
        result.witnessScriptAsm = disassembleScript(witnessBuffers[witnessBuffers.length - 1]!);
      }
      return result;
    }
    case 'p2tr':
      return { scriptType: witnessBuffers.length >= 2 ? 'p2tr_scriptpath' : 'p2tr_keypath' };
    case 'p2sh':
      if (redeemScript && isWitnessProgram(redeemScript, OP_0, 20)) {
        return { scriptType: 'p2sh-p2wpkh' };
      }
      if (redeemScript && isWitnessProgram(redeemScript, OP_0, 32)) {
        const result: { scriptType: InputScriptType; witnessScriptAsm?: string } = { scriptType: 'p2sh-p2wsh' };
        if (witnessBuffers.length > 0) {
          result.witnessScriptAsm = disassembleScript(witnessBuffers[witnessBuffers.length - 1]!);
        }
        return result;
      }
      return { scriptType: 'unknown' };
    default:
      return { scriptType: 'unknown' };
  }
}

export function buildRelativeTimelock(sequence: number): Vin['relative_timelock'] {
  const disabled = (sequence & 0x80000000) !== 0;
  if (disabled) {
    return { enabled: false };
  }
  const value = sequence & 0x0000ffff;
  if (value === 0) {
    return { enabled: false };
  }
  const isTime = (sequence & 0x00400000) !== 0;
  return { enabled: true, type: isTime ? 'time' : 'blocks', value: isTime ? value * 512 : value };
}

export function buildSegwitSavings(sizeBytes: number, weight: number): SegwitSavings {
  const witnessBytes = Math.max(0, Math.round((4 * sizeBytes - weight) / 3));
  const nonWitnessBytes = Math.max(0, sizeBytes - witnessBytes);
  const weightIfLegacy = sizeBytes * 4;
  return {
    witness_bytes: witnessBytes,
    non_witness_bytes: nonWitnessBytes,
    total_bytes: sizeBytes,
    weight_actual: weight,
    weight_if_legacy: weightIfLegacy,
    savings_pct: weightIfLegacy === 0 ? 0 : roundNumber(((weightIfLegacy - weight) / weightIfLegacy) * 100),
  };
}

export function isCoinbaseInput(input: bitcoin.Transaction['ins'][number]): boolean {
  return input.hash.every((byte: number) => byte === 0) && input.index === 0xffffffff;
}

export function buildResolvedPrevout(prevout: PrevoutInput): ResolvedPrevout {
  const scriptBuffer = Buffer.from(prevout.script_pubkey_hex, 'hex');
  const classification = classifyOutputScript(scriptBuffer, parseScriptInstructions(scriptBuffer), prevout.script_pubkey_hex);
  return {
    value_sats: Number(prevout.value_sats),
    script_pubkey_hex: prevout.script_pubkey_hex,
    script_type: classification.script_type,
    address: classification.address,
  };
}
