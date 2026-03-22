import { OutputScriptType, SummaryScriptType, SUMMARY_SCRIPT_TYPES, TransactionAnalysis } from '../../types';

const DUST_FEE_RATE_SAT_PER_VBYTE = 3;

export function normalizeSummaryScriptType(scriptType: OutputScriptType): SummaryScriptType {
  switch (scriptType) {
    case 'p2wpkh':
    case 'p2tr':
    case 'p2sh':
    case 'p2pkh':
    case 'p2wsh':
    case 'op_return':
      return scriptType;
    default:
      return 'unknown';
  }
}

export function getDustLimitByScriptType(scriptType: OutputScriptType): number {
  const feeRate = DUST_FEE_RATE_SAT_PER_VBYTE;

  switch (scriptType) {
    case 'p2wpkh':
      return Math.ceil(29 * feeRate);
    case 'p2tr':
      return Math.ceil(33 * feeRate);
    case 'p2pkh':
      return Math.ceil(54 * feeRate);
    case 'p2sh':
      return Math.ceil(32 * feeRate);
    case 'p2wsh':
      return Math.ceil(43 * feeRate);
    default:
      return Math.ceil(54 * feeRate);
  }
}

export function isOwnershipCompatible(inputSpendType: string, outputSummaryType: SummaryScriptType): boolean {
  if (inputSpendType === 'p2sh-p2wpkh' && outputSummaryType === 'p2wpkh') return true;
  if (inputSpendType === 'p2sh-p2wsh' && outputSummaryType === 'p2wsh') return true;
  if ((inputSpendType === 'p2tr_keypath' || inputSpendType === 'p2tr_scriptpath') && outputSummaryType === 'p2tr') return true;
  return false;
}

export function deriveInputOwnershipTypes(vin: TransactionAnalysis['vin']): Set<SummaryScriptType> {
  const ownershipTypes = new Set<SummaryScriptType>();

  for (const input of vin) {
    ownershipTypes.add(normalizeSummaryScriptType(input.prevout_script_type));
    for (const scriptType of SUMMARY_SCRIPT_TYPES) {
      if (isOwnershipCompatible(input.script_type, scriptType)) {
        ownershipTypes.add(scriptType);
      }
    }
  }

  return ownershipTypes;
}
