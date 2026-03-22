import { TransactionAnalysis, HeuristicResult, BlockContext } from '../../types';
import { isCoinbase, sampleArray, compareStringsLexicographically } from '../../utils';

export function detectAddressReuse(tx: TransactionAnalysis, context: BlockContext): HeuristicResult {
  if (isCoinbase(tx)) {
    return { detected: false };
  }

  const inputAddresses = new Set(tx.vin.map((input) => input.address).filter((address): address is string => Boolean(address)));
  const outputAddresses = new Set(tx.vout.map((output) => output.address).filter((address): address is string => Boolean(address)));
  const overlap = [...inputAddresses].filter((address) => outputAddresses.has(address));
  const transactionAddressFrequency = new Map<string, number>();
  for (const input of tx.vin) {
    if (!input.address) continue;
    transactionAddressFrequency.set(input.address, (transactionAddressFrequency.get(input.address) ?? 0) + 1);
  }
  for (const output of tx.vout) {
    if (!output.address) continue;
    transactionAddressFrequency.set(output.address, (transactionAddressFrequency.get(output.address) ?? 0) + 1);
  }

  const blockReuse = [...new Set([...inputAddresses, ...outputAddresses])].filter((address) => {
    const globalCount = context.address_frequency.get(address) ?? 0;
    const transactionCount = transactionAddressFrequency.get(address) ?? 0;
    return globalCount > transactionCount;
  });
  const detected = overlap.length > 0 || blockReuse.length > 0;

  return {
    detected,
    confidence: overlap.length > 0 ? 'high' : detected ? 'medium' : undefined,
    reused_address_count: blockReuse.length,
    within_transaction_count: overlap.length,
    reused_addresses: sampleArray([...blockReuse].sort(compareStringsLexicographically)),
    within_transaction: sampleArray([...overlap].sort(compareStringsLexicographically)),
  };
}
