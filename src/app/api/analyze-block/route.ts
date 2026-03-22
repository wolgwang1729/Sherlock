import { NextResponse } from 'next/server';
import { analyzeBlock, analyzeSingleBlock, parseBlockSummaries } from '../../../analyzer';
import { createWriteStream } from 'fs';
import { access, copyFile, mkdtemp, rm } from 'fs/promises';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { AnalysisSummary, BlockChainAnalysis, ChainAnalysisFileReport, HEURISTIC_IDS } from '../../../types';

interface SessionRecord {
  sessionId: string;
  uploadDirPath: string;
  blkFilePath: string;
  revFilePath: string;
  xorFilePath: string;
  file: string;
  blockCount: number;
  blocks: Array<{ block_hash: string; block_height: number; timestamp: number; tx_count: number }>;
  createdAt: number;
  lastAccessedAt: number;
}

const sessionCache = new Map<string, SessionRecord>();
const SESSION_TTL_MS = 30 * 60 * 1000;

function emptySummary(): AnalysisSummary {
  return {
    total_transactions_analyzed: 0,
    heuristics_applied: [...HEURISTIC_IDS],
    flagged_transactions: 0,
    script_type_distribution: {
      p2wpkh: 0,
      p2tr: 0,
      p2sh: 0,
      p2pkh: 0,
      p2wsh: 0,
      op_return: 0,
      unknown: 0,
    },
    fee_rate_stats: {
      min_sat_vb: 0,
      max_sat_vb: 0,
      median_sat_vb: 0,
      mean_sat_vb: 0,
    },
  };
}

async function cleanupSessionById(sessionId: string): Promise<void> {
  const record = sessionCache.get(sessionId);
  if (!record) {
    return;
  }
  sessionCache.delete(sessionId);
  await rm(record.uploadDirPath, { recursive: true, force: true });
}

async function cleanupExpiredSessions(now: number): Promise<void> {
  const expiredSessionIds: string[] = [];
  for (const [sessionId, record] of sessionCache.entries()) {
    if (now - record.lastAccessedAt > SESSION_TTL_MS) {
      expiredSessionIds.push(sessionId);
    }
  }

  await Promise.all(expiredSessionIds.map((sessionId) => cleanupSessionById(sessionId)));
}

function buildSessionReport(record: SessionRecord, loadedBlocks: Map<number, BlockChainAnalysis>): ChainAnalysisFileReport {
  const blocks: BlockChainAnalysis[] = record.blocks.map((meta, index) => {
    const loaded = loadedBlocks.get(index);
    if (loaded) {
      return loaded;
    }
    return {
      block_hash: meta.block_hash,
      block_height: meta.block_height,
      tx_count: meta.tx_count,
      analysis_summary: emptySummary(),
      transactions: [],
    };
  });

  const firstLoaded = blocks.find((block) => block.transactions.length > 0);

  return {
    ok: true,
    mode: 'chain_analysis',
    file: record.file,
    block_count: record.blockCount,
    analysis_summary: firstLoaded?.analysis_summary ?? emptySummary(),
    blocks,
  };
}

async function saveUploadedFiles(formData: FormData): Promise<{ uploadDirPath: string; blkFilePath: string; revFilePath: string; xorFilePath: string; blkFileName: string }> {
  const blkFile = formData.get('blkFile') as File | null;
  const revFile = formData.get('revFile') as File | null;
  const xorFile = formData.get('xorFile') as File | null;

  if (!blkFile || !revFile || !xorFile) {
    throw new Error('Missing blk, rev, or xor files');
  }
  if (blkFile.size === 0 || revFile.size === 0 || xorFile.size === 0) {
    throw new Error('One or more of the provided files are empty');
  }

  const uploadDirPath = await mkdtemp(join(tmpdir(), 'sherlock-upload-'));

  const saveFile = async (file: File) => {
    const path = join(uploadDirPath, basename(file.name));
    const stream = Readable.fromWeb(file.stream() as any);
    const writeStream = createWriteStream(path);
    await pipeline(stream, writeStream);
    return path;
  };

  try {
    const blkFilePath = await saveFile(blkFile);
    const revFilePath = await saveFile(revFile);
    const xorFilePath = await saveFile(xorFile);
    return { uploadDirPath, blkFilePath, revFilePath, xorFilePath, blkFileName: blkFile.name };
  } catch (error) {
    await rm(uploadDirPath, { recursive: true, force: true });
    throw error;
  }
}

async function createInitSession(input: {
  uploadDirPath: string;
  blkFilePath: string;
  revFilePath: string;
  xorFilePath: string;
  blkFileName: string;
}): Promise<NextResponse> {
  const { uploadDirPath, blkFilePath, revFilePath, xorFilePath, blkFileName } = input;
  try {
    const summaries = parseBlockSummaries({ blkFilePath, revFilePath, xorFilePath, network: 'mainnet' });
    const firstBlock = analyzeSingleBlock({ blkFilePath, revFilePath, xorFilePath, network: 'mainnet' }, 0);
    const sessionId = randomUUID();

    const now = Date.now();
    sessionCache.set(sessionId, {
      sessionId,
      uploadDirPath,
      blkFilePath,
      revFilePath,
      xorFilePath,
      file: basename(blkFileName),
      blockCount: summaries.length,
      blocks: summaries,
      createdAt: now,
      lastAccessedAt: now,
    });

    const report = buildSessionReport(sessionCache.get(sessionId)!, new Map([[0, firstBlock.block]]));
    return NextResponse.json({ ok: true, sessionId, report });
  } catch (error) {
    await rm(uploadDirPath, { recursive: true, force: true });
    throw error;
  }
}

async function handleInit(req: Request): Promise<NextResponse> {
  const formData = await req.formData();
  const files = await saveUploadedFiles(formData);
  return createInitSession(files);
}

async function saveFixtureFiles(): Promise<{ uploadDirPath: string; blkFilePath: string; revFilePath: string; xorFilePath: string; blkFileName: string }> {
  const fixtureDir = join(process.cwd(), 'fixtures');
  const fixtureNames = {
    blk: 'blk05051.dat',
    rev: 'rev05051.dat',
    xor: 'xor.dat',
  };

  const fixturePaths = {
    blk: join(fixtureDir, fixtureNames.blk),
    rev: join(fixtureDir, fixtureNames.rev),
    xor: join(fixtureDir, fixtureNames.xor),
  };

  try {
    await Promise.all([
      access(fixturePaths.blk),
      access(fixturePaths.rev),
      access(fixturePaths.xor),
    ]);
  } catch {
    throw new Error('Example fixture files are missing. Expected fixtures/blk05051.dat, fixtures/rev05051.dat, and fixtures/xor.dat');
  }

  const uploadDirPath = await mkdtemp(join(tmpdir(), 'sherlock-upload-'));
  const blkFilePath = join(uploadDirPath, fixtureNames.blk);
  const revFilePath = join(uploadDirPath, fixtureNames.rev);
  const xorFilePath = join(uploadDirPath, fixtureNames.xor);

  try {
    await Promise.all([
      copyFile(fixturePaths.blk, blkFilePath),
      copyFile(fixturePaths.rev, revFilePath),
      copyFile(fixturePaths.xor, xorFilePath),
    ]);
  } catch (error) {
    await rm(uploadDirPath, { recursive: true, force: true });
    throw error;
  }

  return {
    uploadDirPath,
    blkFilePath,
    revFilePath,
    xorFilePath,
    blkFileName: fixtureNames.blk,
  };
}

async function handleInitExample(): Promise<NextResponse> {
  const files = await saveFixtureFiles();
  return createInitSession(files);
}

async function handleBlock(req: Request): Promise<NextResponse> {
  const body = await req.json();
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
  const blockIndexRaw = body?.blockIndex;
  const blockIndex = Number(blockIndexRaw);

  if (!sessionId) {
    return NextResponse.json({ ok: false, error: { code: 'MISSING_SESSION', message: 'sessionId is required' } }, { status: 400 });
  }
  if (!Number.isInteger(blockIndex)) {
    return NextResponse.json({ ok: false, error: { code: 'INVALID_BLOCK_INDEX', message: 'blockIndex must be an integer' } }, { status: 400 });
  }

  const record = sessionCache.get(sessionId);
  if (!record) {
    return NextResponse.json({ ok: false, error: { code: 'INVALID_SESSION', message: 'Session not found or expired' } }, { status: 404 });
  }
  if (blockIndex < 0 || blockIndex >= record.blockCount) {
    return NextResponse.json({ ok: false, error: { code: 'BLOCK_INDEX_OUT_OF_RANGE', message: 'Requested block index is out of range' } }, { status: 400 });
  }

  record.lastAccessedAt = Date.now();
  const result = analyzeSingleBlock(
    {
      blkFilePath: record.blkFilePath,
      revFilePath: record.revFilePath,
      xorFilePath: record.xorFilePath,
      network: 'mainnet',
    },
    blockIndex,
  );

  return NextResponse.json({ ok: true, sessionId, blockIndex, block: result.block });
}

async function handleCleanup(req: Request): Promise<NextResponse> {
  const body = await req.json();
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: { code: 'MISSING_SESSION', message: 'sessionId is required' } }, { status: 400 });
  }

  await cleanupSessionById(sessionId);
  return NextResponse.json({ ok: true });
}

async function handleSession(req: Request): Promise<NextResponse> {
  const body = await req.json();
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';

  if (!sessionId) {
    return NextResponse.json({ ok: false, error: { code: 'MISSING_SESSION', message: 'sessionId is required' } }, { status: 400 });
  }

  const record = sessionCache.get(sessionId);
  if (!record) {
    return NextResponse.json({ ok: false, error: { code: 'INVALID_SESSION', message: 'Session not found or expired' } }, { status: 404 });
  }

  record.lastAccessedAt = Date.now();
  const firstBlock = analyzeSingleBlock(
    {
      blkFilePath: record.blkFilePath,
      revFilePath: record.revFilePath,
      xorFilePath: record.xorFilePath,
      network: 'mainnet',
    },
    0,
  );
  const report = buildSessionReport(record, new Map([[0, firstBlock.block]]));

  return NextResponse.json({ ok: true, sessionId, report });
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await cleanupExpiredSessions(Date.now());
    const action = new URL(req.url).searchParams.get('action');

    if (action === 'init') {
      return await handleInit(req);
    }
    if (action === 'block') {
      return await handleBlock(req);
    }
    if (action === 'cleanup') {
      return await handleCleanup(req);
    }
    if (action === 'session') {
      return await handleSession(req);
    }
    if (action === 'init-example') {
      return await handleInitExample();
    }

    let uploadDirPath: string | null = null;
    const formData = await req.formData();
    const blkFile = formData.get('blkFile') as File | null;
    const revFile = formData.get('revFile') as File | null;
    const xorFile = formData.get('xorFile') as File | null;

    if (!blkFile || !revFile || !xorFile) {
      return NextResponse.json({ ok: false, error: { code: 'MISSING_FILES', message: 'Missing blk, rev, or xor files' } }, { status: 400 });
    }
    if ((blkFile && blkFile.size === 0) || (revFile && revFile.size === 0) || (xorFile && xorFile.size === 0)) {
      return NextResponse.json({ ok: false, error: { code: 'EMPTY_FILES', message: 'One or more of the provided files are empty' } }, { status: 400 });
    }

    uploadDirPath = await mkdtemp(join(tmpdir(), 'sherlock-upload-'));
    try {
      const saveFile = async (file: File) => {
        const path = join(uploadDirPath, basename(file.name));
        const stream = Readable.fromWeb(file.stream() as any);
        const writeStream = createWriteStream(path);
        await pipeline(stream, writeStream);
        return path;
      };

      const blkFilePath = await saveFile(blkFile);
      const revFilePath = await saveFile(revFile);
      const xorFilePath = await saveFile(xorFile);

      const result = analyzeBlock({ blkFilePath, revFilePath, xorFilePath, network: 'mainnet' });
      return new NextResponse(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      await rm(uploadDirPath, { recursive: true, force: true });
    }
  } catch (error: any) {
    if (error?.message === 'Missing blk, rev, or xor files') {
      return NextResponse.json({ ok: false, error: { code: 'MISSING_FILES', message: error.message } }, { status: 400 });
    }
    if (error?.message === 'One or more of the provided files are empty') {
      return NextResponse.json({ ok: false, error: { code: 'EMPTY_FILES', message: error.message } }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: { code: 'PARSE_ERROR', message: error.message } }, { status: 400 });
  }
}
