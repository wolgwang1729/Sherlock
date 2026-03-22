import * as analyzer from '../analyzer';
import { basename } from 'path';
import { GET } from '../app/api/health/route';
import { POST } from '../app/api/analyze-block/route';

describe('API routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns healthy status from health route', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('returns 400 when required upload files are missing', async () => {
    const form = new FormData();
    form.append('blkFile', new File([Buffer.from('x')], 'blk.dat'));

    const response = await POST(new Request('http://localhost/api/analyze-block', { method: 'POST', body: form }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'MISSING_FILES' } });
  });

  it('returns 400 when one uploaded file is empty', async () => {
    const form = new FormData();
    form.append('blkFile', new File([Buffer.from('blk')], 'blk.dat'));
    form.append('revFile', new File([Buffer.alloc(0)], 'rev.dat'));
    form.append('xorFile', new File([Buffer.from('xor')], 'xor.dat'));

    const response = await POST(new Request('http://localhost/api/analyze-block', { method: 'POST', body: form }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'EMPTY_FILES' } });
  });

  it('returns parsed analysis payload for valid upload flow', async () => {
    const analyzeSpy = vi.spyOn(analyzer, 'analyzeBlock').mockReturnValue({
      report: {
        ok: true,
        mode: 'chain_analysis',
        file: 'blk04330.dat',
        block_count: 1,
        analysis_summary: {
          total_transactions_analyzed: 1,
          heuristics_applied: ['cioh'],
          flagged_transactions: 0,
          script_type_distribution: { p2wpkh: 0, p2tr: 0, p2sh: 0, p2pkh: 0, p2wsh: 0, op_return: 0, unknown: 0 },
          fee_rate_stats: { min_sat_vb: 0, max_sat_vb: 0, median_sat_vb: 0, mean_sat_vb: 0 },
        },
        blocks: [],
      },
    } as any);

    const form = new FormData();
    form.append('blkFile', new File([Buffer.from('blk')], 'blk05051.dat'));
    form.append('revFile', new File([Buffer.from('rev')], 'rev05051.dat'));
    form.append('xorFile', new File([Buffer.from('xor')], 'xor.dat'));

    const response = await POST(new Request('http://localhost/api/analyze-block', { method: 'POST', body: form }));
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload).toMatchObject({
      report: {
        ok: true,
        mode: 'chain_analysis',
      },
    });
    expect(analyzeSpy).toHaveBeenCalledOnce();
    expect(analyzeSpy).toHaveBeenCalledWith(expect.objectContaining({
      blkFilePath: expect.any(String),
      revFilePath: expect.any(String),
      xorFilePath: expect.any(String),
      network: 'mainnet',
    }));

    const analyzeArgs = analyzeSpy.mock.calls[0]?.[0];
    expect(analyzeArgs).toBeDefined();
    expect(basename(analyzeArgs.blkFilePath)).toBe('blk05051.dat');
    expect(basename(analyzeArgs.revFilePath)).toBe('rev05051.dat');
    expect(basename(analyzeArgs.xorFilePath)).toBe('xor.dat');
  });

  it('returns parse error details when analysis throws', async () => {
    vi.spyOn(analyzer, 'analyzeBlock').mockImplementation(() => {
      throw new Error('bad block payload');
    });

    const form = new FormData();
    form.append('blkFile', new File([Buffer.from('blk')], 'blk.dat'));
    form.append('revFile', new File([Buffer.from('rev')], 'rev.dat'));
    form.append('xorFile', new File([Buffer.from('xor')], 'xor.dat'));

    const response = await POST(new Request('http://localhost/api/analyze-block', { method: 'POST', body: form }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'PARSE_ERROR', message: 'bad block payload' },
    });
  });

  it('restores analysis session report from session id', async () => {
    vi.spyOn(analyzer, 'parseBlockSummaries').mockReturnValue([
      {
        block_hash: '0000abc',
        block_height: 123,
        timestamp: 1700000000,
        tx_count: 1,
      },
    ] as any);

    vi.spyOn(analyzer, 'analyzeSingleBlock').mockReturnValue({
      file: 'blk05051.dat',
      block_count: 1,
      block_index: 0,
      block: {
        block_hash: '0000abc',
        block_height: 123,
        tx_count: 1,
        analysis_summary: {
          total_transactions_analyzed: 1,
          heuristics_applied: ['cioh'],
          flagged_transactions: 0,
          script_type_distribution: { p2wpkh: 0, p2tr: 0, p2sh: 0, p2pkh: 0, p2wsh: 0, op_return: 0, unknown: 0 },
          fee_rate_stats: { min_sat_vb: 0, max_sat_vb: 0, median_sat_vb: 0, mean_sat_vb: 0 },
        },
        transactions: [],
      },
    } as any);

    const form = new FormData();
    form.append('blkFile', new File([Buffer.from('blk')], 'blk05051.dat'));
    form.append('revFile', new File([Buffer.from('rev')], 'rev05051.dat'));
    form.append('xorFile', new File([Buffer.from('xor')], 'xor.dat'));

    const initResponse = await POST(new Request('http://localhost/api/analyze-block?action=init', { method: 'POST', body: form }));
    expect(initResponse.status).toBe(200);
    const initPayload = await initResponse.json();
    expect(initPayload).toMatchObject({ ok: true, sessionId: expect.any(String) });

    const sessionResponse = await POST(
      new Request('http://localhost/api/analyze-block?action=session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: initPayload.sessionId }),
      }),
    );

    expect(sessionResponse.status).toBe(200);
    await expect(sessionResponse.json()).resolves.toMatchObject({
      ok: true,
      sessionId: initPayload.sessionId,
      report: {
        ok: true,
        mode: 'chain_analysis',
        block_count: 1,
      },
    });
  });
});
