import * as bitcoin from 'bitcoinjs-lib';
import { TransactionAnalysis, ResolvedPrevout, Vin, Vout, Warning } from '../types';
import { isCoinbaseInput, parseScriptInstructions, classifyInputScriptType, formatScriptAsm, buildRelativeTimelock, buildSegwitSavings, classifyOutputScript, buildResolvedPrevout } from './script';
import { roundNumber } from '../utils';

// Policy-level RBF signaling cutoff for sequence values.
const RBF_SIGNAL_SEQUENCE_CUTOFF = 0xfffffffe;
// Conservative warning thresholds for anomalous fee behavior.
const HIGH_FEE_WARNING_MIN_SATS = 1_000_000;
const HIGH_FEE_RATE_WARNING_MIN_SAT_VB = 200;
// Dust warning threshold used for generic output hygiene checks.
const DUST_OUTPUT_WARNING_MAX_SATS = 546;
// Consensus locktime boundary between block height and UNIX timestamp modes.
const LOCKTIME_UNIX_TIMESTAMP_THRESHOLD = 500000000;

export function analyzeTransactionWithResolver(
  tx: bitcoin.Transaction,
  network: string,
  resolvePrevout: (input: bitcoin.Transaction['ins'][number], inputIndex: number) => ResolvedPrevout | undefined,
  options?: { coinbase?: boolean },
): TransactionAnalysis {
  const txid = tx.getId();
  const segwit = tx.hasWitnesses();
  const wtxid = segwit ? Buffer.from(tx.getHash(true)).reverse().toString('hex') : null;
  const vbytes = Math.ceil(tx.weight() / 4);
  const isCoinbaseTx = options?.coinbase === true || (tx.ins.length > 0 && isCoinbaseInput(tx.ins[0]!));

  let totalInputSats = 0;
  let rbfSignaling = false;
  const vin: Vin[] = [];
  
  for (let index = 0; index < tx.ins.length; index += 1) {
    const input = tx.ins[index]!;
    // Use the buffers directly to avoid deep memory copies
    const scriptSigBuffer = input.script as unknown as Buffer; 
    const witnessBuffers = input.witness as unknown as Buffer[]; 
    const scriptSigInstructions = parseScriptInstructions(scriptSigBuffer);
    const prevout = isCoinbaseTx ? undefined : resolvePrevout(input, index);

    if (!isCoinbaseTx && !prevout) {
      throw new Error(`Missing prevout for input ${index}: ${Buffer.from(input.hash).toString('hex')}:${input.index}`);
    }

    const resolvedPrevout =
      prevout ??
      ({ value_sats: 0, script_pubkey_hex: '', script_type: 'unknown', address: null } satisfies ResolvedPrevout);

    totalInputSats += resolvedPrevout.value_sats;

    if (input.sequence < RBF_SIGNAL_SEQUENCE_CUTOFF) {
      rbfSignaling = true;
    }

    const inputClassification = classifyInputScriptType(resolvedPrevout.script_type, scriptSigInstructions, witnessBuffers);
    const vinEntry: Vin = {
      txid: Buffer.from(input.hash).reverse().toString('hex'), // Buffer.from needed here because reverse() mutates
      vout: input.index,
      sequence: input.sequence,
      script_sig_hex: scriptSigBuffer.toString('hex'),
      script_asm: formatScriptAsm(scriptSigInstructions),
      witness: witnessBuffers.map((item) => item.toString('hex')),
      script_type: inputClassification.scriptType,
      prevout_script_type: resolvedPrevout.script_type,
      address: resolvedPrevout.address,
      prevout: {
        value_sats: resolvedPrevout.value_sats,
        script_pubkey_hex: resolvedPrevout.script_pubkey_hex,
      },
      relative_timelock: buildRelativeTimelock(input.sequence),
    };

    if (inputClassification.witnessScriptAsm) {
      vinEntry.witness_script_asm = inputClassification.witnessScriptAsm;
    }
    if (isCoinbaseTx) {
      vinEntry.coinbase = true;
    }
    vin.push(vinEntry);
  }

  let totalOutputSats = 0;
  let hasDust = false;
  let hasUnknownScript = false;
  
  const vout: Vout[] = tx.outs.map((output, idx) => {
    totalOutputSats += Number(output.value);
    
    // Use the buffer directly
    const scriptBuffer = output.script as unknown as Buffer;
    const scriptHex = scriptBuffer.toString('hex');
    const instructions = parseScriptInstructions(scriptBuffer);
    const classification = classifyOutputScript(scriptBuffer, instructions, scriptHex);

    const entry: Vout = {
      n: idx,
      value_sats: Number(output.value),
      script_pubkey_hex: scriptHex,
      script_asm: formatScriptAsm(instructions),
      script_type: classification.script_type,
      address: classification.address,
    };

    if (classification.script_type === 'op_return' && classification.op_return_payload) {
      entry.op_return_data_hex = classification.op_return_payload.data_hex;
      entry.op_return_data_utf8 = classification.op_return_payload.data_utf8;
      entry.op_return_protocol = classification.op_return_payload.op_return_protocol;
    } else if (entry.value_sats < DUST_OUTPUT_WARNING_MAX_SATS) {
      hasDust = true;
    }

    if (classification.script_type === 'unknown') {
      hasUnknownScript = true;
    }

    return entry;
  });

  if (isCoinbaseTx) {
    totalInputSats = totalOutputSats;
  }

  const feeSats = totalInputSats - totalOutputSats;
  const feeRateSatVb = roundNumber(vbytes === 0 ? 0 : feeSats / vbytes);
  
  const warnings: Warning[] = [];
  if (rbfSignaling) warnings.push({ code: 'RBF_SIGNALING' });
  if (feeSats > HIGH_FEE_WARNING_MIN_SATS || feeRateSatVb > HIGH_FEE_RATE_WARNING_MIN_SAT_VB) warnings.push({ code: 'HIGH_FEE' });
  if (hasDust) warnings.push({ code: 'DUST_OUTPUT' });
  if (hasUnknownScript) warnings.push({ code: 'UNKNOWN_OUTPUT_SCRIPT' });

  return {
    ok: true,
    network,
    segwit,
    txid,
    wtxid,
    version: tx.version,
    locktime: tx.locktime,
    size_bytes: tx.byteLength(),
    weight: tx.weight(),
    vbytes,
    total_input_sats: totalInputSats,
    total_output_sats: totalOutputSats,
    fee_sats: feeSats,
    fee_rate_sat_vb: feeRateSatVb,
    rbf_signaling: rbfSignaling,
    locktime_type: tx.locktime === 0 ? 'none' : tx.locktime < LOCKTIME_UNIX_TIMESTAMP_THRESHOLD ? 'block_height' : 'unix_timestamp',
    locktime_value: tx.locktime,
    segwit_savings: segwit ? buildSegwitSavings(tx.byteLength(), tx.weight()) : null,
    vin,
    vout,
    warnings,
  };
}
