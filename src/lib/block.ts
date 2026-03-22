import * as bitcoin from 'bitcoinjs-lib';
import { readFileSync } from 'fs';
import { basename } from 'path';
import { AnalyzeBlockInput, AnalyzeBlockOutput, ChainAnalysisFileReport, ParsedBlockRecord, BlockChainAnalysis, TransactionAnalysis, AnalysisSummary, BlockSummaryRecord, AnalyzeSingleBlockOutput } from '../types';
import { BufferCursor, parseObfuscatedRecords, tryParseUndoPrevoutsForBlock, hash256, bufferToHexReversed, decodeBip34Height, median, readCompactSize, roundNumber } from '../utils';
import { analyzeTransactionWithResolver } from './transaction';
import { buildResolvedPrevout, clearAddressCache, isCoinbaseInput } from './script';
import { buildBlockContext, analyzeTransactionHeuristics, buildAnalysisSummary, emptyScriptTypeDistribution } from './heuristics';
import { HEURISTIC_IDS, SUMMARY_SCRIPT_TYPES } from '../types';

// Wire-format markers for SegWit transaction serialization.
const TX_SEGWIT_MARKER = 0;
const TX_SEGWIT_FLAG = 1;
// Fixed serialized block-header byte length.
const BLOCK_HEADER_SIZE_BYTES = 80;

interface ParseBlockIterationOptions {
  selectedBlockIndex?: number;
}

export function buildBlockChainAnalysis(block: ParsedBlockRecord): BlockChainAnalysis {
  const context = buildBlockContext(block.parsed_transactions);
  const transactions = block.parsed_transactions.map((tx) => analyzeTransactionHeuristics(tx, context));

  return {
    block_hash: block.block_hash,
    block_height: block.block_height,
    tx_count: block.tx_count,
    analysis_summary: buildAnalysisSummary(block.parsed_transactions, transactions),
    transactions,
  };
}

function readTransactionFromCursor(cursor: BufferCursor, payload: Buffer): bitcoin.Transaction {
  const startOffset = cursor.currentOffset;
  cursor.readUInt32LE();

  let hasWitness = false;
  if (cursor.remaining >= 2) {
    const b1 = payload[cursor.currentOffset]!;
    const b2 = payload[cursor.currentOffset + 1]!;
    if (b1 === TX_SEGWIT_MARKER && b2 === TX_SEGWIT_FLAG) {
      hasWitness = true;
      cursor.readSlice(2);
    }
  }

  const vinCount = readCompactSize(cursor);
  for (let j = 0; j < vinCount; j += 1) {
    cursor.readSlice(32);
    cursor.readUInt32LE();
    const scriptLen = readCompactSize(cursor);
    cursor.readSlice(scriptLen);
    cursor.readUInt32LE();
  }

  const voutCount = readCompactSize(cursor);
  for (let j = 0; j < voutCount; j += 1) {
    cursor.readSlice(8);
    const scriptLen = readCompactSize(cursor);
    cursor.readSlice(scriptLen);
  }

  if (hasWitness) {
    for (let j = 0; j < vinCount; j += 1) {
      const witnessCount = readCompactSize(cursor);
      for (let k = 0; k < witnessCount; k += 1) {
        const itemLen = readCompactSize(cursor);
        cursor.readSlice(itemLen);
      }
    }
  }

  cursor.readUInt32LE();

  const txBuf = payload.slice(startOffset, cursor.currentOffset);
  return bitcoin.Transaction.fromBuffer(txBuf);
}

function loadObfuscatedRecordsFromFile(filePath: string, xorFilePath: string, options?: { hasChecksumTrailer?: boolean }): Buffer[] {
  const xorKey = readFileSync(xorFilePath);
  return parseObfuscatedRecords(readFileSync(filePath), xorKey, options);
}

function findCompatibleUndoPrevouts(
  blockTransactions: bitcoin.Transaction[],
  undoRecords: (Buffer | undefined)[],
  usedUndoIndexes: Set<number>,
  blockIndex: number
): { undoPrevoutsByTx: Array<Array<{ value_sats: number; script_pubkey_hex: string }>>; matchedUndoIndex: number } | null {
  if (!usedUndoIndexes.has(blockIndex)) {
    const candidate = undoRecords[blockIndex];
    if (candidate && candidate.length > 0) {
      const parsed = tryParseUndoPrevoutsForBlock(candidate, blockTransactions);
      if (parsed) {
        return { undoPrevoutsByTx: parsed, matchedUndoIndex: blockIndex };
      }
    }
  }

  for (let undoIndex = 0; undoIndex < undoRecords.length; undoIndex += 1) {
    if (undoIndex === blockIndex || usedUndoIndexes.has(undoIndex)) continue;

    const candidate = undoRecords[undoIndex];
    if (!candidate || candidate.length === 0) continue;

    const parsed = tryParseUndoPrevoutsForBlock(candidate, blockTransactions);
    if (parsed) {
      return { undoPrevoutsByTx: parsed, matchedUndoIndex: undoIndex };
    }
  }
  
  return null;
}

function forEachParsedBlock(input: AnalyzeBlockInput, visit: (block: ParsedBlockRecord, totalBlockCount: number) => void, options?: ParseBlockIterationOptions): void {
  const network = input.network ?? 'mainnet';
  const blockPayloads: (Buffer | undefined)[] = loadObfuscatedRecordsFromFile(input.blkFilePath, input.xorFilePath);
  const undoRecords: (Buffer | undefined)[] = loadObfuscatedRecordsFromFile(input.revFilePath, input.xorFilePath, { hasChecksumTrailer: true });

  if (blockPayloads.length === 0) {
    throw new Error(`No blocks found in ${basename(input.blkFilePath)}`);
  }

  const usedUndoIndexes = new Set<number>();
  const selectedBlockIndex = options?.selectedBlockIndex;
  if (selectedBlockIndex !== undefined && (selectedBlockIndex < 0 || selectedBlockIndex >= blockPayloads.length)) {
    throw new Error(`Block index ${selectedBlockIndex} is out of range`);
  }

  const startIndex = selectedBlockIndex ?? 0;
  const endIndex = selectedBlockIndex !== undefined ? selectedBlockIndex + 1 : blockPayloads.length;

  for (let blockIndex = startIndex; blockIndex < endIndex; blockIndex += 1) {
    const payload = blockPayloads[blockIndex]!;
    clearAddressCache();
    const cursor = new BufferCursor(payload);

    const block = new bitcoin.Block();
    block.version = cursor.readUInt32LE();
    block.prevHash = cursor.readSlice(32);
    block.merkleRoot = cursor.readSlice(32);
    block.timestamp = cursor.readUInt32LE();
    block.bits = cursor.readUInt32LE();
    block.nonce = cursor.readUInt32LE();

    const txCount = readCompactSize(cursor);
    block.transactions = [];

    for (let i = 0; i < txCount; i += 1) {
      block.transactions.push(readTransactionFromCursor(cursor, payload));
    }

    const witnessCommit = block.getWitnessCommit();
    if (witnessCommit) {
      block.witnessCommit = witnessCommit;
    }
    if (!block.transactions || block.transactions.length === 0) {
      throw new Error(`Parsed block at index ${blockIndex} has no transactions`);
    }
    if (!block.checkTxRoots()) {
      throw new Error(`Merkle root mismatch for block ${block.getId()}`);
    }

    const undoMatch = findCompatibleUndoPrevouts(block.transactions, undoRecords, usedUndoIndexes, blockIndex);
    if (!undoMatch) {
      throw new Error(`Could not locate compatible undo data for block ${block.getId()}`);
    }
    const { undoPrevoutsByTx, matchedUndoIndex } = undoMatch;
    usedUndoIndexes.add(matchedUndoIndex);

    const parsedTransactions: TransactionAnalysis[] = [];
    const coinbaseTx = block.transactions[0]!;
    if (coinbaseTx.ins.length !== 1 || !isCoinbaseInput(coinbaseTx.ins[0]!)) {
      throw new Error(`Invalid coinbase transaction shape in block ${block.getId()}`);
    }

    parsedTransactions.push(analyzeTransactionWithResolver(coinbaseTx, network, () => undefined, { coinbase: true }));
    for (let txIndex = 1; txIndex < block.transactions.length; txIndex += 1) {
      const undoPrevouts = undoPrevoutsByTx[txIndex - 1]!;
      parsedTransactions.push(
        analyzeTransactionWithResolver(block.transactions[txIndex]!, network, (_, inputIndex) => {
          const prevout = undoPrevouts[inputIndex];
          if (!prevout) {
            return undefined;
          }
          return buildResolvedPrevout({ txid: '', vout: 0, ...prevout });
        }),
      );
    }

    const headerBuffer = blockPayloads[blockIndex]!.slice(0, BLOCK_HEADER_SIZE_BYTES);
    const calculatedHash = bufferToHexReversed(hash256(headerBuffer));
    const totalBlockCount = blockPayloads.length;
    visit({
      block_hash: calculatedHash,
      block_height: decodeBip34Height(Buffer.from(coinbaseTx.ins[0]!.script)),
      timestamp: block.timestamp,
      tx_count: block.transactions.length,
      parsed_transactions: parsedTransactions,
    }, totalBlockCount);

    blockPayloads[blockIndex] = undefined;
    undoRecords[matchedUndoIndex] = undefined;
  }

  clearAddressCache();
}

export function parseBlockRecords(input: AnalyzeBlockInput): ParsedBlockRecord[] {
  const parsedBlocks: ParsedBlockRecord[] = [];
  forEachParsedBlock(input, (block) => {
    parsedBlocks.push(block);
  });

  return parsedBlocks;
}

function readCoinbaseTransaction(payload: Buffer): bitcoin.Transaction {
  // Fast metadata path: parse only coinbase tx to extract BIP34 height for block list/init.
  const cursor = new BufferCursor(payload);
  cursor.readSlice(BLOCK_HEADER_SIZE_BYTES);
  const txCount = readCompactSize(cursor);
  if (txCount === 0) {
    throw new Error('Encountered block with zero transactions');
  }

  return readTransactionFromCursor(cursor, payload);
}

export function parseBlockSummaries(input: AnalyzeBlockInput): BlockSummaryRecord[] {
  const blockPayloads = loadObfuscatedRecordsFromFile(input.blkFilePath, input.xorFilePath);

  if (blockPayloads.length === 0) {
    throw new Error(`No blocks found in ${basename(input.blkFilePath)}`);
  }

  return blockPayloads.map((payload) => {
    const cursor = new BufferCursor(payload);
    cursor.readUInt32LE();
    cursor.readSlice(32);
    cursor.readSlice(32);
    const timestamp = cursor.readUInt32LE();
    cursor.readUInt32LE();
    cursor.readUInt32LE();
    const txCount = readCompactSize(cursor);
    const coinbaseTx = readCoinbaseTransaction(payload);
    if (coinbaseTx.ins.length !== 1 || !isCoinbaseInput(coinbaseTx.ins[0]!)) {
      throw new Error('Invalid coinbase transaction shape while parsing block summary');
    }

    const headerBuffer = payload.slice(0, BLOCK_HEADER_SIZE_BYTES);
    return {
      block_hash: bufferToHexReversed(hash256(headerBuffer)),
      block_height: decodeBip34Height(Buffer.from(coinbaseTx.ins[0]!.script)),
      timestamp,
      tx_count: txCount,
    };
  });
}

export function analyzeSingleBlock(input: AnalyzeBlockInput, blockIndex: number): AnalyzeSingleBlockOutput {
  let parsedBlock: ParsedBlockRecord | null = null;
  let blockCount = 0;
  forEachParsedBlock(
    input,
    (block, count) => {
      parsedBlock = block;
      blockCount = count;
    },
    { selectedBlockIndex: blockIndex },
  );

  if (!parsedBlock) {
    throw new Error(`Could not parse block at index ${blockIndex}`);
  }

  return {
    file: basename(input.blkFilePath),
    block_count: blockCount,
    block_index: blockIndex,
    block: buildBlockChainAnalysis(parsedBlock),
  };
}

function buildFileSummaryFromAggregates(
  totalTransactionsAnalyzed: number,
  flaggedTransactions: number,
  fileScriptTypeDistribution: Record<(typeof SUMMARY_SCRIPT_TYPES)[number], number>,
  feeRates: number[],
): AnalysisSummary {
  if (feeRates.length === 0) {
    return {
      total_transactions_analyzed: totalTransactionsAnalyzed,
      heuristics_applied: [...HEURISTIC_IDS],
      flagged_transactions: flaggedTransactions,
      script_type_distribution: fileScriptTypeDistribution,
      fee_rate_stats: { min_sat_vb: 0, max_sat_vb: 0, median_sat_vb: 0, mean_sat_vb: 0 },
    };
  }

  let minSatVb = feeRates[0]!;
  let maxSatVb = feeRates[0]!;
  let totalFeeRate = 0;
  for (const feeRate of feeRates) {
    if (feeRate < minSatVb) {
      minSatVb = feeRate;
    }
    if (feeRate > maxSatVb) {
      maxSatVb = feeRate;
    }
    totalFeeRate += feeRate;
  }
  const meanSatVb = totalFeeRate / feeRates.length;

  return {
    total_transactions_analyzed: totalTransactionsAnalyzed,
    heuristics_applied: [...HEURISTIC_IDS],
    flagged_transactions: flaggedTransactions,
    script_type_distribution: fileScriptTypeDistribution,
    fee_rate_stats: {
      min_sat_vb: roundNumber(minSatVb),
      max_sat_vb: roundNumber(maxSatVb),
      median_sat_vb: median(feeRates),
      mean_sat_vb: roundNumber(meanSatVb),
    },
  };
}

export function analyzeBlock(input: AnalyzeBlockInput): AnalyzeBlockOutput {
  const blocks: BlockChainAnalysis[] = [];
  const fileScriptTypeDistribution = emptyScriptTypeDistribution();
  const feeRates: number[] = [];
  let totalTransactionsAnalyzed = 0;
  let flaggedTransactions = 0;

  forEachParsedBlock(input, (parsedBlock) => {
    const block = buildBlockChainAnalysis(parsedBlock);
    blocks.push(block);
    totalTransactionsAnalyzed += parsedBlock.tx_count;
    flaggedTransactions += block.analysis_summary.flagged_transactions;

    for (const scriptType of SUMMARY_SCRIPT_TYPES) {
      fileScriptTypeDistribution[scriptType] += block.analysis_summary.script_type_distribution[scriptType];
    }

    for (let i = 1; i < parsedBlock.parsed_transactions.length; i += 1) {
      const tx = parsedBlock.parsed_transactions[i]!;
      feeRates.push(Math.max(0, tx.fee_rate_sat_vb));
    }
  });

  const report: ChainAnalysisFileReport = {
    ok: true,
    mode: 'chain_analysis',
    file: basename(input.blkFilePath),
    block_count: blocks.length,
    analysis_summary: buildFileSummaryFromAggregates(totalTransactionsAnalyzed, flaggedTransactions, fileScriptTypeDistribution, feeRates),
    blocks,
  };

  return {
    report,
  };
}
