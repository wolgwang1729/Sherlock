import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import { parseBlockRecords, buildBlockChainAnalysis, analyzeBlock } from '../lib/block';
import { makeParsedBlock, makeTx, makeInput, makeOutput, encodeObfuscatedRecord, encodeUndoBlock, P2WPKH_SCRIPT_HEX, hexBuffer, makeBitcoinTransaction, makeCoinbaseTransaction } from './helpers';
import * as bitcoin from 'bitcoinjs-lib';

vi.mock('fs');

function encodeHeightScript(height: number): Buffer {
  const script = Buffer.alloc(3);
  script[0] = 0x02;
  script.writeUInt16LE(height, 1);
  return script;
}

function buildEncodedBlockFixtures(options?: {
  invalidCoinbase?: boolean;
  incompatibleUndo?: boolean;
  coinbaseOnly?: boolean;
  spendInputCount?: number;
  height?: number;
  witness?: boolean;
}) {
  const height = options?.height ?? 10000;
  const coinbaseTx = options?.invalidCoinbase
    ? makeBitcoinTransaction({
        version: 1,
        inputs: [
          { hashByte: 0, index: 0xffffffff, script: encodeHeightScript(height) },
          { hashByte: 4, index: 1, script: Buffer.from([0x51]) },
        ],
        outputs: [{ script: hexBuffer(P2WPKH_SCRIPT_HEX), value: BigInt(5_000_000_000) }],
      })
    : makeCoinbaseTransaction({
        script: encodeHeightScript(height),
        outputs: [{ script: hexBuffer(P2WPKH_SCRIPT_HEX), value: BigInt(5_000_000_000) }],
      });
  const spendInputCount = options?.spendInputCount ?? 1;
  const transactions = [coinbaseTx];
  const undoGroups: Array<Array<{ value_sats: number; script_pubkey_hex: string }>> = [];

  if (!options?.coinbaseOnly) {
    const inputs = Array.from({ length: spendInputCount }, (_, index) => ({
      hashByte: 9 + index,
      index,
      witness: options?.witness && index === 0 ? [Buffer.alloc(71, 0x30)] : undefined,
    }));
    const spendTx = makeBitcoinTransaction({
      inputs,
      outputs: [{ script: hexBuffer(P2WPKH_SCRIPT_HEX), value: BigInt(4_999_990_000) }],
    });
    transactions.push(spendTx);
    undoGroups.push(
      options?.incompatibleUndo
        ? Array.from({ length: spendInputCount + 1 }, () => ({ value_sats: 100_000, script_pubkey_hex: P2WPKH_SCRIPT_HEX }))
        : Array.from({ length: spendInputCount }, () => ({ value_sats: 5_000_000_000, script_pubkey_hex: P2WPKH_SCRIPT_HEX })),
    );
  }

  const block = new bitcoin.Block();
  block.version = 2;
  block.prevHash = Buffer.alloc(32, 1);
  block.timestamp = 1_700_000_123;
  block.bits = 0x1d00ffff;
  block.nonce = 42;
  block.transactions = transactions;
  block.merkleRoot = Buffer.from(bitcoin.Block.calculateMerkleRoot(block.transactions));

  const blockPayload = Buffer.from(block.toBuffer());
  const undoPayload = encodeUndoBlock(undoGroups);

  return {
    blk: encodeObfuscatedRecord(blockPayload, Buffer.alloc(8)),
    rev: encodeObfuscatedRecord(undoPayload.slice(0, -32), Buffer.alloc(8), { checksumTrailer: undoPayload.slice(-32) }),
    xor: Buffer.alloc(8),
  };
}

describe('block parsing', () => {
  it('builds block chain analysis correctly', () => {
    const tx = makeTx();
    const blockRecord = makeParsedBlock({ parsed_transactions: [tx] });
    const analysis = buildBlockChainAnalysis(blockRecord);

    expect(analysis.block_hash).toBe(blockRecord.block_hash);
    expect(analysis.tx_count).toBe(1);
    expect(analysis.transactions).toHaveLength(1);
    expect(analysis.analysis_summary.total_transactions_analyzed).toBe(1);
  });

  it('fails to parse blocks when block payload is missing', () => {
    vi.mocked(fs.readFileSync).mockImplementation(((path: any) => {
      if (path === 'xor.dat') return Buffer.alloc(8);
      if (path === 'blk00000.dat') return Buffer.alloc(10); // Too small
      return Buffer.alloc(0);
    }) as any);
    
    expect(() => parseBlockRecords({
      blkFilePath: 'blk00000.dat',
      revFilePath: 'rev00000.dat',
      xorFilePath: 'xor.dat'
    })).toThrow();
  });

  it('parses block records and analyzes a valid obfuscated block file', () => {
    const fixtures = buildEncodedBlockFixtures();
    vi.mocked(fs.readFileSync).mockImplementation(((path: any) => {
      if (path === 'xor.dat') return fixtures.xor;
      if (path === 'blk00000.dat') return fixtures.blk;
      if (path === 'rev00000.dat') return fixtures.rev;
      return Buffer.alloc(0);
    }) as any);

    const parsedBlocks = parseBlockRecords({
      blkFilePath: 'blk00000.dat',
      revFilePath: 'rev00000.dat',
      xorFilePath: 'xor.dat',
    });
    const analyzed = analyzeBlock({
      blkFilePath: 'blk00000.dat',
      revFilePath: 'rev00000.dat',
      xorFilePath: 'xor.dat',
    });

    expect(parsedBlocks).toHaveLength(1);
    expect(parsedBlocks[0]).toMatchObject({ block_height: 10000, tx_count: 2 });
    expect(parsedBlocks[0]?.parsed_transactions).toHaveLength(2);
    expect(parsedBlocks[0]?.parsed_transactions[1]).toMatchObject({ total_input_sats: 1, vin: [{ prevout_script_type: 'p2wpkh' }] });
    expect(analyzed.report.block_count).toBe(1);
    expect(analyzed.report.analysis_summary.total_transactions_analyzed).toBe(2);
    expect(analyzed.report.blocks[0]?.transactions).toHaveLength(2);
  });

  it('analyzes multiple blocks with reordered undo data and clears later transaction details', () => {
    const first = buildEncodedBlockFixtures({ height: 10010, spendInputCount: 1 });
    const second = buildEncodedBlockFixtures({ height: 10011, spendInputCount: 2 });

    vi.mocked(fs.readFileSync).mockImplementation(((path: any) => {
      if (path === 'xor.dat') return Buffer.alloc(8);
      if (path === 'C:/tmp/blkcombo.dat') return Buffer.concat([first.blk, second.blk]);
      if (path === 'revcombo.dat') return Buffer.concat([second.rev, first.rev]);
      return Buffer.alloc(0);
    }) as any);

    const analyzed = analyzeBlock({
      blkFilePath: 'C:/tmp/blkcombo.dat',
      revFilePath: 'revcombo.dat',
      xorFilePath: 'xor.dat',
    });

    expect(analyzed.report.file).toBe('blkcombo.dat');
    expect(analyzed.report.block_count).toBe(2);
    expect(analyzed.report.analysis_summary.total_transactions_analyzed).toBe(4);
    expect(analyzed.report.blocks[0]?.transactions).toHaveLength(2);
    expect(analyzed.report.blocks[1]?.transactions).toHaveLength(2);
  });

  it('reports zero fee stats when a parsed file contains only coinbase transactions', () => {
    const first = buildEncodedBlockFixtures({ height: 10020, coinbaseOnly: true });
    const second = buildEncodedBlockFixtures({ height: 10021, coinbaseOnly: true });

    vi.mocked(fs.readFileSync).mockImplementation(((path: any) => {
      if (path === 'xor.dat') return Buffer.alloc(8);
      if (path === 'blk-coinbase.dat') return Buffer.concat([first.blk, second.blk]);
      if (path === 'rev-coinbase.dat') return Buffer.concat([first.rev, second.rev]);
      return Buffer.alloc(0);
    }) as any);

    const analyzed = analyzeBlock({
      blkFilePath: 'blk-coinbase.dat',
      revFilePath: 'rev-coinbase.dat',
      xorFilePath: 'xor.dat',
    });

    expect(analyzed.report.analysis_summary.fee_rate_stats).toEqual({ min_sat_vb: 0, max_sat_vb: 0, median_sat_vb: 0, mean_sat_vb: 0 });
    expect(analyzed.report.analysis_summary.total_transactions_analyzed).toBe(2);
  });

  it('fails when a parsed block has an invalid coinbase transaction shape', () => {
    const fixtures = buildEncodedBlockFixtures({ invalidCoinbase: true });
    vi.mocked(fs.readFileSync).mockImplementation(((path: any) => {
      if (path === 'xor.dat') return fixtures.xor;
      if (path === 'blk00000.dat') return fixtures.blk;
      if (path === 'rev00000.dat') return fixtures.rev;
      return Buffer.alloc(0);
    }) as any);

    expect(() => parseBlockRecords({
      blkFilePath: 'blk00000.dat',
      revFilePath: 'rev00000.dat',
      xorFilePath: 'xor.dat',
    })).toThrow('Invalid coinbase transaction shape');
  });

  it('fails when no compatible undo data can be matched to the block', () => {
    const fixtures = buildEncodedBlockFixtures({ incompatibleUndo: true });
    vi.mocked(fs.readFileSync).mockImplementation(((path: any) => {
      if (path === 'xor.dat') return fixtures.xor;
      if (path === 'blk00000.dat') return fixtures.blk;
      if (path === 'rev00000.dat') return fixtures.rev;
      return Buffer.alloc(0);
    }) as any);

    expect(() => analyzeBlock({
      blkFilePath: 'blk00000.dat',
      revFilePath: 'rev00000.dat',
      xorFilePath: 'xor.dat',
    })).toThrow('Could not locate compatible undo data');
  });
});
