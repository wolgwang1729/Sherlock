import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';

describe('CLI integration', () => {
  const workspaceRoot = path.resolve(__dirname, '../..');
  const tsxCliPath = path.join(workspaceRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

  it('returns JSON error for missing input files', () => {
    const result = spawnSync(
      process.execPath,
      [tsxCliPath, 'src/cli.ts', '--block', 'missing.blk', 'missing.rev', 'missing.xor'],
      {
        cwd: workspaceRoot,
        encoding: 'utf-8',
      },
    );

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed).toMatchObject({ ok: false, error: { code: 'FILE_NOT_FOUND' } });
  });

  it('returns ANALYSIS_ERROR when files exist but are invalid block data', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'sherlock-cli-test-'));
    const blkPath = path.join(tempDir, 'blk.dat');
    const revPath = path.join(tempDir, 'rev.dat');
    const xorPath = path.join(tempDir, 'xor.dat');

    writeFileSync(blkPath, Buffer.from('not-a-valid-block'));
    writeFileSync(revPath, Buffer.from('not-a-valid-undo'));
    writeFileSync(xorPath, Buffer.alloc(8, 0));

    const result = spawnSync(
      process.execPath,
      [tsxCliPath, 'src/cli.ts', '--block', blkPath, revPath, xorPath],
      {
        cwd: workspaceRoot,
        encoding: 'utf-8',
      },
    );

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed).toMatchObject({ ok: false, error: { code: 'ANALYSIS_ERROR' } });

    rmSync(tempDir, { recursive: true, force: true });
  });
});
