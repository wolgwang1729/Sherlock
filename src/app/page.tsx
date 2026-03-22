"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import BlockVisualizer from '../components/BlockVisualizer';
import { ArrowRight, ScanSearch, Loader2 } from 'lucide-react';
import { ChainAnalysisFileReport } from '../types';

const isDatFile = (file: File) => /\.dat$/i.test(file.name);
const INITIAL_FORM_LOADING_MS = 2000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function DashboardSkeleton() {
  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
      {/* Top Navigation / Brand */}
      <div className="flex justify-between items-center">
        <button className="text-sm font-medium text-zinc-400 flex items-center gap-2 px-4 py-2 rounded-full border border-zinc-800 cursor-not-allowed opacity-50">
          &larr; Analyze another
        </button>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl md:text-3xl font-extrabold text-transparent bg-clip-text bg-linear-to-br from-white to-zinc-500 tracking-tight">
            Sherlock
          </h1>
          <img
            src="/logo.png"
            alt="Sherlock logo"
            className="w-10 h-10 md:w-12 md:h-12 rounded-full ring-1 ring-white/15"
          />
        </div>
      </div>

      <div className="flex flex-col bg-background-dark text-slate-100 rounded-3xl overflow-hidden border border-border-subtle shadow-2xl h-[85vh] w-full">
        <div className="flex flex-1 overflow-hidden">

          {/* SIDEBAR SKELETON */}
          <aside className="w-72 border-r border-border-subtle flex flex-col bg-background-dark overflow-hidden shrink-0">
            <div className="p-5 border-b border-border-subtle">
              <div className="flex items-center justify-between mb-4">
                {/* Source & Block Count Badges */}
                <div className="h-3 w-24 bg-white/10 rounded animate-pulse" />
                <div className="h-4 w-16 bg-primary/20 rounded animate-pulse" />
              </div>
              {/* Rescan Button Skeleton */}
              <div className="w-full h-10 rounded-xl bg-white/10 animate-pulse" />
            </div>
            {/* Block List Skeletons */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="flex items-center gap-3 p-3 rounded-xl border border-transparent">
                  <div className="size-5 rounded bg-white/10 animate-pulse shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-20 bg-white/10 rounded animate-pulse" />
                    <div className="h-3 w-24 bg-white/10 rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* MAIN CONTENT SKELETON */}
          <main className="flex-1 overflow-y-auto bg-background-dark p-8 relative">

            {/* Header Section */}
            <div className="flex flex-wrap items-center justify-between gap-6 mb-10">
              <div>
                <h1 className="text-4xl font-black tracking-tight text-white/70 animate-pulse">
                  Loading Block...
                </h1>
              </div>
              <div className="flex gap-3">
                {/* Block Hash Button Placeholder */}
                <div className="h-10 w-56 rounded-xl bg-surface-dark border border-border-subtle animate-pulse" />
                {/* Mempool Button Placeholder */}
                <div className="h-10 w-28 rounded-xl bg-surface-dark border border-border-subtle animate-pulse" />
              </div>
            </div>

            {/* Block Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="sherlock-card p-6 rounded-2xl flex flex-col gap-1 border border-border-subtle bg-white/2">
                  <div className="h-3 w-24 bg-white/10 rounded animate-pulse mb-2" />
                  <div className="h-8 w-20 bg-white/20 rounded animate-pulse" />
                  <div className="h-3 w-32 bg-white/10 rounded animate-pulse mt-1" />
                </div>
              ))}
            </div>

            {/* Script Distribution Visualization Section */}
            <div className="sherlock-card rounded-2xl p-6 mb-10">
              <div className="flex items-center justify-between mb-8">
                <div className="h-3 w-40 bg-white/10 rounded animate-pulse" />
                <div className="hidden md:flex flex-wrap gap-4">
                  {/* Legend Skeletons */}
                  {Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="flex items-center gap-1.5">
                      <div className="size-2.5 rounded-full bg-white/10 animate-pulse" />
                      <div className="h-3 w-12 bg-white/10 rounded animate-pulse" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Segmented Bar Skeleton */}
              <div className="h-3 w-full bg-white/5 rounded-full flex overflow-hidden gap-0.5 animate-pulse">
                <div className="bg-white/10 h-full w-[35%]" />
                <div className="bg-white/10 h-full w-[25%]" />
                <div className="bg-white/10 h-full w-[15%]" />
                <div className="bg-white/10 h-full w-[10%]" />
                <div className="bg-white/10 h-full w-[8%]" />
                <div className="bg-white/10 h-full w-[5%]" />
                <div className="bg-white/10 h-full w-[2%]" />
              </div>

              {/* Stat Values Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 mt-8 gap-4">
                {Array.from({ length: 7 }).map((_, index) => (
                  <div key={index} className="space-y-2">
                    <div className="h-3 w-14 rounded bg-white/10 animate-pulse" />
                    <div className="h-7 w-16 rounded bg-white/10 animate-pulse" />
                  </div>
                ))}
              </div>
            </div>

            {/* Transaction Explorer */}
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-start">
                <h3 className="text-xl font-black text-white/80 tracking-tight animate-pulse">
                  Transaction Explorer
                </h3>
              </div>

              <div className="space-y-4">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="sherlock-card rounded-2xl p-3 border border-border-subtle">
                    <div className="flex sm:items-center gap-4 flex-col sm:flex-row">

                      {/* Icon Placeholder */}
                      <div className="w-11 h-11 rounded-xl bg-white/10 animate-pulse shrink-0" />

                      <div className="flex-1 min-w-0 w-full">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          {/* TXID Placeholder */}
                          <div className="h-4 w-48 sm:w-64 rounded bg-white/20 animate-pulse" />

                          {/* Badges Placeholder */}
                          <div className="flex items-center gap-2">
                            <div className="h-5 w-16 rounded-full bg-white/10 animate-pulse" />
                            <div className="h-5 w-24 rounded-full bg-white/10 animate-pulse" />
                          </div>
                        </div>
                      </div>

                      {/* Action Icons Placeholder */}
                      <div className="flex items-center gap-4 shrink-0 self-center">
                        <div className="hidden md:flex items-center gap-2">
                          <div className="h-6 w-6 rounded bg-white/10 animate-pulse" />
                          <div className="h-6 w-6 rounded bg-white/10 animate-pulse" />
                        </div>
                        {/* Chevron Placeholder */}
                        <div className="h-5 w-5 rounded bg-white/10 animate-pulse" />
                      </div>

                    </div>
                  </div>
                ))}
              </div>
            </div>

          </main>
        </div>
      </div>
    </div>
  );
}

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionFromUrl = searchParams.get('session');
  const [blkFile, setBlkFile] = useState<File | null>(null);
  const [revFile, setRevFile] = useState<File | null>(null);
  const [xorFile, setXorFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [initializingDashboard, setInitializingDashboard] = useState(Boolean(sessionFromUrl));
  const [loadingBlockIndex, setLoadingBlockIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChainAnalysisFileReport | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const restoredSessionRef = useRef<string | null>(null);

  const setSessionInUrl = useCallback((nextSessionId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextSessionId) {
      params.set('session', nextSessionId);
    } else {
      params.delete('session');
    }
    const nextQuery = params.toString();
    router.replace(nextQuery ? `/?${nextQuery}` : '/', { scroll: false });
  }, [router, searchParams]);

  const mergeBlock = useCallback((blockIndex: number, blockData: ChainAnalysisFileReport['blocks'][number]) => {
    setResult((prev) => {
      if (!prev) {
        return prev;
      }
      const nextBlocks = [...prev.blocks];
      nextBlocks[blockIndex] = blockData;
      return {
        ...prev,
        blocks: nextBlocks,
      };
    });
  }, []);

  const handleLoadBlock = useCallback(async (blockIndex: number) => {
    if (!sessionId || !result) {
      return;
    }

    const currentBlock = result.blocks[blockIndex];
    if (currentBlock && currentBlock.transactions.length > 0) {
      return;
    }

    try {
      setLoadingBlockIndex(blockIndex);
      const res = await fetch('/api/analyze-block?action=block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, blockIndex }),
      });
      const data = await res.json();
      if (data.ok === false) {
        throw new Error(data.error?.message || 'Block analysis failed');
      }
      mergeBlock(blockIndex, data.block);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingBlockIndex(null);
    }
  }, [sessionId, result, mergeBlock]);

  const cleanupSession = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    try {
      await fetch('/api/analyze-block?action=cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch (e) {
    } finally {
      setSessionId(null);
    }
  }, [sessionId]);

  const handleBlockSubmit = useCallback(async (options?: { preserveExisting?: boolean }) => {
    try {
      if (!blkFile || !revFile || !xorFile) {
        throw new Error('Please select blk*.dat, rev*.dat, and xor.dat files.');
      }
      if (!isDatFile(blkFile) || !isDatFile(revFile) || (xorFile && !isDatFile(xorFile))) {
        throw new Error('Only .dat files are supported.');
      }
      if (blkFile.size === 0 || revFile.size === 0 || (xorFile && xorFile.size === 0)) {
        throw new Error('One or more selected files are empty.');
      }

      if (blkFile && !isDatFile(blkFile)) {
        throw new Error('Only .dat files are supported.');
      }
      if (revFile && !isDatFile(revFile)) {
        throw new Error('Only .dat files are supported.');
      }
      if (xorFile && !isDatFile(xorFile)) {
        throw new Error('Only .dat files are supported.');
      }
      setLoading(true);
      setError(null);
      const shouldShowInitializingDashboard = !options?.preserveExisting;
      await cleanupSession();
      if (!options?.preserveExisting) {
        setResult(null);
      }

      const formData = new FormData();
      if (blkFile) formData.append('blkFile', blkFile);
      if (revFile) formData.append('revFile', revFile);
      if (xorFile) formData.append('xorFile', xorFile);

      const initRequest = fetch('/api/analyze-block?action=init', {
        method: 'POST',
        body: formData
      });

      if (shouldShowInitializingDashboard) {
        const finishedDuringInitialPhase = await Promise.race([
          initRequest.then(() => true),
          wait(INITIAL_FORM_LOADING_MS).then(() => false),
        ]);
        if (!finishedDuringInitialPhase) {
          setInitializingDashboard(true);
        }
      }

      const res = await initRequest;
      const data = await res.json();
      if (data.ok === false) {
        throw new Error(data.error?.message || 'Analysis failed');
      }
      const nextSessionId = data.sessionId ?? null;
      setSessionId(nextSessionId);
      setSessionInUrl(nextSessionId);
      setResult(data.report);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setInitializingDashboard(false);
      setLoading(false);
    }
  }, [blkFile, revFile, xorFile, cleanupSession, setSessionInUrl]);

  const handleAnalyzeAnother = useCallback(async () => {
    restoredSessionRef.current = sessionFromUrl;
    setSessionInUrl(null);
    await cleanupSession();
    setResult(null);
    setError(null);
    setInitializingDashboard(false);
    setLoadingBlockIndex(null);
  }, [cleanupSession, sessionFromUrl, setSessionInUrl]);

  useEffect(() => {
    if (!sessionFromUrl || restoredSessionRef.current === sessionFromUrl || sessionId || result || loading) {
      return;
    }

    restoredSessionRef.current = sessionFromUrl;
    const restore = async () => {
      try {
        setError(null);
        setLoading(true);
        setInitializingDashboard(true);

        const res = await fetch('/api/analyze-block?action=session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionFromUrl }),
        });
        const data = await res.json();
        if (data.ok === false) {
          throw new Error(data.error?.message || 'Failed to restore session');
        }

        setSessionId(data.sessionId ?? null);
        setResult(data.report);
      } catch (err: any) {
        setError(err.message);
        setSessionInUrl(null);
      } finally {
        setInitializingDashboard(false);
        setLoading(false);
      }
    };

    void restore();
  }, [searchParams, loading, result, sessionId, setSessionInUrl]);

  return (
    <main className="min-h-screen p-8 lg:p-6 pb-24 bg-zinc-950 flex flex-col items-center justify-center">
      <div className={`w-full max-w-7xl mx-auto flex flex-col ${!result ? 'min-h-[80vh] justify-center' : ''}`}>

        {!result && !initializingDashboard && !sessionFromUrl && (
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-center gap-10 xl:gap-16 w-full">

            {/* Left side: Premium Image Presentation */}
            <div className="flex-1 w-full lg:w-1/2 flex items-center justify-center p-4 animate-in fade-in slide-in-from-left-8 duration-700">
              <div className="relative w-full max-w-xl aspect-4/3 rounded-4xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] ring-1 ring-white/10 group">
                <img
                  src="/sherlock-bg.jpg.png"
                  alt="Sherlock and Bitcoin"
                  className="w-full h-full object-cover transition-transform duration-1000"
                />
                <div className="absolute inset-0 bg-linear-to-tr from-zinc-950/90 via-zinc-900/40 to-transparent pointer-events-none" />
                <div className="absolute bottom-6 left-6 right-6">
                  <h2 className="text-3xl font-bold text-white drop-shadow-md">Investigate the Chain</h2>
                  <p className="text-zinc-300 font-medium drop-shadow-md mt-1">Uncover hidden heuristic patterns</p>
                </div>
              </div>
            </div>

            {/* Right side: Form Interface */}
            <div className="flex-1 w-full lg:w-1/2 flex flex-col lg:items-start text-center lg:text-left animate-in fade-in slide-in-from-right-8 duration-700 delay-150">
              <header className="mb-8 px-4 lg:px-0">
                <div className="flex items-center justify-center lg:justify-start gap-4 mb-4">

                  <h1 className="text-5xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-linear-to-br from-white to-zinc-500 tracking-tight">
                    Sherlock
                  </h1>
                  <img
                    src="/logo.png"
                    alt="Sherlock logo"
                    className="w-14 h-14 md:w-16 md:h-16 rounded-full ring-1 ring-white/15"
                  />
                </div>
                <p className="text-lg text-zinc-400 max-w-md mx-auto lg:mx-0">
                  A visual explorer for Bitcoin block chain analysis. Upload your .dat files to get started.
                </p>
              </header>

              <div className="w-full max-w-md mx-auto lg:mx-0 bg-zinc-900/40 backdrop-blur-xl border border-zinc-800 rounded-3xl p-6 lg:p-8 shadow-2xl">
                <div className="space-y-5">
                  <div className="space-y-2 text-left">
                    <label className="block text-sm font-medium text-zinc-300">blk*.dat file</label>
                    <input type="file" accept=".dat" onChange={e => setBlkFile(e.target.files?.[0] || null)} className="w-full text-sm text-zinc-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-zinc-800 file:text-zinc-300 hover:file:bg-zinc-700 cursor-pointer" />
                  </div>
                  <div className="space-y-2 text-left">
                    <label className="block text-sm font-medium text-zinc-300">rev*.dat file</label>
                    <input type="file" accept=".dat" onChange={e => setRevFile(e.target.files?.[0] || null)} className="w-full text-sm text-zinc-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-zinc-800 file:text-zinc-300 hover:file:bg-zinc-700 cursor-pointer" />
                  </div>
                  <div className="space-y-2 text-left">
                    <label className="block text-sm font-medium text-zinc-300">xor*.dat file</label>
                    <input type="file" accept=".dat" onChange={e => setXorFile(e.target.files?.[0] || null)} className="w-full text-sm text-zinc-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-zinc-800 file:text-zinc-300 hover:file:bg-zinc-700 cursor-pointer" />
                  </div>
                  <button
                    onClick={() => handleBlockSubmit()}
                    disabled={loading || !blkFile || !revFile || !xorFile || (blkFile !== null && !isDatFile(blkFile)) || (revFile !== null && !isDatFile(revFile)) || (xorFile !== null && !isDatFile(xorFile))}
                    title={loading ? "Analyzing..." : ((blkFile && !isDatFile(blkFile)) || (revFile && !isDatFile(revFile)) || (xorFile && !isDatFile(xorFile))) ? "Only .dat files are supported." : undefined}
                    className="cursor-pointer w-full mt-4 py-4 rounded-xl bg-linear-to-r from-blue-600 to-indigo-600 text-white font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-[0.99] shadow-lg shadow-blue-900/20"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><ArrowRight className="w-5 h-5" /> Analyze Block Data</>}
                  </button>
                </div>

                {error && (
                  <div className="mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm animate-in fade-in slide-in-from-bottom-2 duration-300 text-left">
                    {error}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {initializingDashboard && !result && <DashboardSkeleton />}

        {/* Results */}
        {result && (
          <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
            <div className="flex justify-between items-center">
              <button onClick={handleAnalyzeAnother} className="cursor-pointer text-sm font-medium text-zinc-400 hover:text-white flex items-center gap-2 transition-all px-4 py-2 rounded-full border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/50 backdrop-blur-sm">
                &larr; Analyze another
              </button>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl md:text-3xl font-extrabold text-transparent bg-clip-text bg-linear-to-br from-white to-zinc-500 tracking-tight">
                  Sherlock
                </h1>
                <img
                  src="/logo.png"
                  alt="Sherlock logo"
                  className="w-10 h-10 md:w-12 md:h-12 rounded-full ring-1 ring-white/15"
                />
              </div>
            </div>
            <BlockVisualizer
              report={result}
              onRescan={() => handleBlockSubmit({ preserveExisting: true })}
              isRescanning={loading}
              onLoadBlock={handleLoadBlock}
              loadingBlockIndex={loadingBlockIndex}
            />
          </div>
        )}

      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}
