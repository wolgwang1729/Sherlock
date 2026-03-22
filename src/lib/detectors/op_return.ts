import { TransactionAnalysis, HeuristicResult } from '../../types';
import { sampleArray, compareStringsLexicographically } from '../../utils';

export function detectOpReturn(tx: TransactionAnalysis): HeuristicResult {
  const opReturnOutputs = tx.vout.filter((output) => output.script_type === 'op_return');
  const protocols = Array.from(
    new Set(opReturnOutputs.map((output) => output.op_return_protocol ?? 'unknown')),
  ).sort(compareStringsLexicographically);

  return {
    detected: opReturnOutputs.length > 0,
    confidence: opReturnOutputs.length > 0 ? 'high' : undefined,
    output_count: opReturnOutputs.length,
    output_indexes: sampleArray(opReturnOutputs.map((output) => output.n)),
    protocols,
  };
}
