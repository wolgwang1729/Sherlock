"use client";

import React, { useState, memo, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, ChevronUp, Copy, ExternalLink, Check, RefreshCw, Box, AlertTriangle, TrendingUp, AlertCircle, CheckCircle2, Wallet, GitMerge, Repeat, Network, ShieldQuestion } from 'lucide-react';
import TransactionVisualizer from './TransactionVisualizer';
import { ChainAnalysisFileReport, Classification, HEURISTIC_IDS, HeuristicId, SummaryScriptType, TransactionChainAnalysis, UiWarning } from '../types';

const StatValueLoader = ({ widthClass = 'w-20' }: { widthClass?: string }) => (
  <div className={`h-8 ${widthClass} rounded-md bg-white/10 animate-pulse`} aria-label="Loading value" />
);

const StatTextLoader = ({ widthClass = 'w-24' }: { widthClass?: string }) => (
  <div className={`h-3 ${widthClass} rounded bg-white/10 animate-pulse`} aria-label="Loading text" />
);

const ScriptDistributionLoader = () => (
  <>
    <div className="h-3 w-full bg-white/10 rounded-full animate-pulse" aria-label="Loading script distribution" />
    <div className="grid grid-cols-2 max-sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 mt-8 max-sm:mt-4 gap-4 max-sm:gap-2">
      {Array.from({ length: 7 }).map((_, index) => (
        <div key={index} className="space-y-2 max-sm:space-y-1">
          <div className="h-3 w-14 max-sm:w-10 rounded bg-white/10 animate-pulse" />
          <div className="h-7 max-sm:h-5 w-16 max-sm:w-12 rounded bg-white/10 animate-pulse" />
        </div>
      ))}
    </div>
  </>
);

const TransactionListLoader = ({ rows = 4 }: { rows?: number }) => (
  <div className="space-y-4" aria-label="Loading transactions">
    {Array.from({ length: rows }).map((_, index) => (
      <div key={index} className="sherlock-card rounded-2xl p-3 max-sm:p-2 border border-border-subtle">
        <div className="flex sm:items-center gap-4 flex-col sm:flex-row">
          <div className="w-11 h-11 rounded-xl bg-white/10 animate-pulse shrink-0" />
          <div className="flex-1 min-w-0 w-full space-y-2">
            <div className="h-4 w-3/4 max-sm:w-[150px] rounded bg-white/10 animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-white/10 animate-pulse" />
          </div>
          <div className="h-5 w-5 rounded bg-white/10 animate-pulse shrink-0" />
        </div>
      </div>
    ))}
  </div>
);

const CLASSIFICATION_FILTERS: Array<{ value: 'all' | Classification; label: string }> = [
  { value: 'all', label: 'All classifications' },
  { value: 'coinjoin', label: 'CoinJoin' },
  { value: 'consolidation', label: 'Consolidation' },
  { value: 'self_transfer', label: 'Self transfer' },
  { value: 'batch_payment', label: 'Batch payment' },
  { value: 'simple_payment', label: 'Simple payment' },
  { value: 'unknown', label: 'Unknown' },
];

const HEURISTIC_FILTERS: Array<{ value: 'all' | 'flagged' | HeuristicId; label: string }> = [
  { value: 'all', label: 'All heuristics' },
  { value: 'flagged', label: 'Flagged only' },
  ...HEURISTIC_IDS.map((heuristic) => ({
    value: heuristic,
    label: heuristic.replace(/_/g, ' '),
  })),
];

function formatWarningLabel(code: string) {
  return code.toLowerCase().replace(/_/g, ' ');
}

function warningChipTone(severity: UiWarning['severity']) {
  if (severity === 'high') {
    return 'bg-red-500/15 border-red-500/30 text-red-300';
  }
  if (severity === 'warn') {
    return 'bg-amber-500/15 border-amber-500/30 text-amber-300';
  }
  return 'bg-zinc-800/70 border-zinc-700 text-zinc-300';
}


function FeeRateDistribution({ feeRates }: { feeRates: number[] }) {
  const buckets = useMemo(() => {
    if (feeRates.length === 0) {
      return [] as Array<{ label: string; count: number }>;
    }

    const maxRate = Math.max(...feeRates);
    const clampedMax = maxRate <= 0 ? 1 : maxRate;
    const edges = [0, 1, 5, 10, 25, 50, clampedMax + 0.01].sort((a, b) => a - b);
    const normalizedEdges = Array.from(new Set(edges));
    if (normalizedEdges.length < 2) {
      normalizedEdges.push(normalizedEdges[0]! + 1);
    }

    const nextBuckets = normalizedEdges.slice(0, -1).map((min, index) => {
      const max = normalizedEdges[index + 1]!;
      const label = index === normalizedEdges.length - 2 ? `${min.toFixed(0)}+` : `${min.toFixed(0)}-${Math.max(min, max - 0.01).toFixed(0)}`;
      return { min, max, label, count: 0 };
    });

    for (const feeRate of feeRates) {
      const bucket = nextBuckets.find((entry, index) => {
        if (index === nextBuckets.length - 1) {
          return feeRate >= entry.min;
        }
        return feeRate >= entry.min && feeRate < entry.max;
      });
      if (bucket) {
        bucket.count += 1;
      }
    }

    return nextBuckets.map(({ label, count }) => ({ label, count }));
  }, [feeRates]);

  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));

  return (
    <div className="sherlock-card rounded-2xl p-6 max-sm:p-3 mb-8 max-sm:mb-4">
      <div className="flex items-center justify-between mb-4 max-sm:mb-2">
        <h3 className="text-xs max-sm:text-[10px] font-bold uppercase tracking-widest text-slate-500">Fee Rate Distribution</h3>
        <span className="text-[10px] max-sm:text-[8px] text-slate-500 font-bold uppercase tracking-wider">sat/vB bins</span>
      </div>

      {buckets.length === 0 ? (
        <p className="text-sm max-sm:text-xs text-slate-500">No fee-rate samples available for this block.</p>
      ) : (
        <div className="grid grid-cols-2 max-sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-6 gap-3 max-sm:gap-2">
          {buckets.map((bucket) => {
            const barHeightPct = (bucket.count / maxCount) * 100;
            return (
              <div key={bucket.label} className="bg-white/2 border border-border-subtle rounded-xl p-3 max-sm:p-2">
                <p className="text-[10px] max-sm:text-[8px] uppercase tracking-wider text-slate-500 font-bold mb-2 max-sm:mb-1">{bucket.label}</p>
                <div className="h-14 max-sm:h-10 bg-white/5 rounded-md relative overflow-hidden">
                  <div className="absolute left-0 right-0 bottom-0 bg-primary/70" style={{ height: `${barHeightPct}%` }} />
                </div>
                <p className="text-sm max-sm:text-xs font-black text-white mt-2 max-sm:mt-1">{bucket.count}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


export default function BlockVisualizer({
  report,
  onRescan,
  isRescanning = false,
  onLoadBlock,
  loadingBlockIndex,
}: {
  report: ChainAnalysisFileReport;
  onRescan?: () => void;
  isRescanning?: boolean;
  onLoadBlock?: (blockIndex: number) => void;
  loadingBlockIndex?: number | null;
}) {
  const [selectedBlockIdx, setSelectedBlockIdx] = useState(0);
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [visibleTxCount, setVisibleTxCount] = useState(50);
  const [classificationFilter, setClassificationFilter] = useState<'all' | Classification>('all');
  const [heuristicFilter, setHeuristicFilter] = useState<'all' | 'flagged' | HeuristicId>('all');

  useEffect(() => {
    setVisibleTxCount(50);
    setClassificationFilter('all');
    setHeuristicFilter('all');
    setExpandedTxId(null);
  }, [selectedBlockIdx]);

  useEffect(() => {
    onLoadBlock?.(selectedBlockIdx);
  }, [selectedBlockIdx, onLoadBlock]);

  const formatStats = (val: number) => {
    return isNaN(val) ? '0' : new Intl.NumberFormat().format(val);
  };

  if (!report || !report.blocks || report.blocks.length === 0) {
    return <div className="text-white p-8">No block data available.</div>;
  }

  const selectedBlock = report.blocks[selectedBlockIdx]!;
  const { analysis_summary, transactions } = selectedBlock;
  const hasPendingTransactions = selectedBlock.transactions.length === 0 && selectedBlock.tx_count > 0;
  const isSelectedBlockLoading =
    loadingBlockIndex === selectedBlockIdx ||
    hasPendingTransactions;
  const feeStats = analysis_summary?.fee_rate_stats || { min_sat_vb: 0, max_sat_vb: 0, median_sat_vb: 0, mean_sat_vb: 0 };
  const scripts = analysis_summary?.script_type_distribution || ({} as Record<SummaryScriptType, number>);
  const txFeeRates = (transactions || [])
    .map((tx) => tx.fee_rate_sat_vb)
    .filter((rate): rate is number => typeof rate === 'number' && Number.isFinite(rate) && rate >= 0);

  const filteredTransactions = useMemo(() => {
    return (transactions || []).filter((tx) => {
      const matchesClassification = classificationFilter === 'all' || tx.classification === classificationFilter;
      if (!matchesClassification) {
        return false;
      }

      if (heuristicFilter === 'all') {
        return true;
      }
      if (heuristicFilter === 'flagged') {
        return Object.values(tx.heuristics || {}).some((heuristic) => heuristic.detected);
      }
      return Boolean(tx.heuristics?.[heuristicFilter]?.detected);
    });
  }, [transactions, classificationFilter, heuristicFilter]);

  const patternCounts = useMemo(() => {
    const allTx = transactions || [];
    const coinjoin = allTx.filter((tx) => tx.classification === 'coinjoin').length;
    const consolidation = allTx.filter((tx) => tx.classification === 'consolidation').length;
    const self_transfer = allTx.filter((tx) => tx.classification === 'self_transfer').length;
    const batch_payment = allTx.filter((tx) => tx.classification === 'batch_payment').length;
    const simple_payment = allTx.filter((tx) => tx.classification === 'simple_payment').length;
    const unknown = allTx.filter((tx) => tx.classification === 'unknown').length;
    return { coinjoin, consolidation, self_transfer, batch_payment, simple_payment, unknown };
  }, [transactions]);

  // Script Diversity Calculation (normalized Shannon entropy: 0-100)
  const totalScripts = Object.values(scripts).reduce((acc: number, val: number) => acc + val, 0);
  const p2wpkhCount = scripts['p2wpkh'] || 0;
  const p2trCount = scripts['p2tr'] || 0;
  const p2shCount = scripts['p2sh'] || 0;
  const p2pkhCount = scripts['p2pkh'] || 0;
  const p2wshCount = scripts['p2wsh'] || 0;
  const opReturnCount = scripts['op_return'] || 0;
  const unknownCount = scripts['unknown'] || 0;

  const getPercentage = (count: number) => totalScripts > 0 ? (count / totalScripts) * 100 : 0;
  const scriptCounts = Object.values(scripts).filter((count): count is number => typeof count === 'number' && count > 0);
  const uniqueScriptTypes = scriptCounts.length;
  const entropy = scriptCounts.reduce((acc, count) => {
    const p = count / totalScripts;
    return acc - p * Math.log2(p);
  }, 0);
  const maxEntropy = uniqueScriptTypes > 1 ? Math.log2(uniqueScriptTypes) : 0;
  const diversityScore = maxEntropy > 0 ? Math.round((entropy / maxEntropy) * 100) : 0;

  return (
    <div className="flex flex-col bg-background-dark text-slate-100 rounded-3xl overflow-hidden border border-border-subtle shadow-2xl w-full h-auto md:h-[85vh]">

      <div className="flex flex-1 overflow-hidden flex-col lg:flex-row">
        {/* Sidebar Navigation */}
        <aside className="w-full lg:w-72 border-b lg:border-b-0 lg:border-r border-border-subtle flex flex-col bg-background-dark overflow-hidden shrink-0 max-h-72 max-sm:max-h-48 lg:max-h-none">
          <div className="p-5 border-b border-border-subtle">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 truncate max-w-35" title={report.file}>Source: {report.file}</span>
              <span className="bg-primary/10 text-primary text-[10px] px-2 py-0.5 rounded font-bold">{report.block_count} BLOCKS</span>
            </div>
            <button
              onClick={onRescan}
              disabled={!onRescan || isRescanning}
              className="w-full flex items-center justify-center gap-2 bg-primary text-white py-2.5 rounded-xl text-sm font-bold hover:brightness-110 transition-all shadow-[0_4px_12px_rgba(59,73,255,0.2)] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`size-4 ${isRescanning ? 'animate-spin' : ''}`} />
              {isRescanning ? 'Re-scanning...' : 'Re-scan .dat'}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {report.blocks.map((b, index: number) => {
              const isSelected = index === selectedBlockIdx;
              const hasFlags = b.analysis_summary?.flagged_transactions > 0;

              if (isSelected) {
                return (
                  <div key={index} className="flex items-center gap-3 p-3 rounded-xl bg-primary/10 border border-primary/30 cursor-default">
                    <Box className="size-5 text-primary" />
                    <div className="flex-1">
                      <p className="text-sm font-bold text-white">Block {formatStats(b.block_height)}</p>
                      <p className="text-[10px] text-primary font-bold">{formatStats(b.tx_count)} Transactions</p>
                    </div>
                    {hasFlags && <AlertTriangle className="size-4 text-amber-500" />}
                  </div>
                );
              }

              return (
                <div key={index} onClick={() => { setSelectedBlockIdx(index); setExpandedTxId(null); }} className="group flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 cursor-pointer transition-all relative">
                  <Box className="size-5 text-slate-500 group-hover:text-primary" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-300">Block {formatStats(b.block_height)}</p>
                    <p className="text-[10px] text-slate-600 font-medium">{formatStats(b.tx_count)} Transactions</p>
                  </div>
                  {loadingBlockIndex === index && <RefreshCw className="size-3 text-slate-400 animate-spin" />}

                </div>
              );
            })}
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto bg-background-dark p-4 sm:p-6 lg:p-8 max-sm:p-3 relative">
          {/* Header Section */}
          <div className="flex flex-wrap items-center justify-between gap-6 mb-10">
            <div>
              <h1 className="text-3xl sm:text-4xl max-sm:text-2xl font-black tracking-tight text-white">Block #{formatStats(selectedBlock.block_height)}</h1>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <div className="px-4 py-2 bg-surface-dark border border-border-subtle rounded-xl flex items-center gap-2 h-fit min-w-0 max-w-full">
                <span className="text-slate-400 font-mono text-sm truncate max-w-48 sm:max-w-[20rem]">{selectedBlock.block_hash.substring(0, 10)}...{selectedBlock.block_hash.slice(-10)}</span>
                <button className="text-slate-500 hover:text-primary transition-colors cursor-pointer flex items-center" onClick={() => navigator.clipboard.writeText(selectedBlock.block_hash)} title="Copy hash">
                  <Copy className="size-4" />
                </button>
              </div>
              <a
                href={`https://mempool.space/block/${selectedBlock.block_hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-surface-dark border border-border-subtle rounded-xl flex items-center justify-center gap-2 hover:border-primary/50 text-slate-400 hover:text-primary transition-all text-sm font-semibold h-fit"
              >
                <ExternalLink className="size-4" />
                <span>Mempool</span>
              </a>
            </div>
          </div>

          {/* Block Summary Cards */}
          <div className="grid grid-cols-1 max-sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-5 max-sm:gap-3 mb-8">
            <div className="sherlock-card p-6 max-sm:p-3 rounded-2xl flex flex-col gap-1 group hover:border-primary/30 transition-colors">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest max-sm:text-[8px]">Total Transactions</p>
              {isSelectedBlockLoading ? (
                <>
                  <StatValueLoader widthClass="w-24 max-sm:w-16 max-sm:h-6" />
                  <StatTextLoader widthClass="w-28" />
                </>
              ) : (
                <>
                  <p className="text-2xl max-sm:text-lg font-black text-white">{formatStats(analysis_summary?.total_transactions_analyzed)}</p>
                  <p className="text-xs max-sm:text-[10px] text-emerald-500 font-bold flex items-center gap-1">
                    <TrendingUp className="size-4 max-sm:size-3" /> Analyzed
                  </p>
                </>
              )}
            </div>
            <div className={isSelectedBlockLoading ? "sherlock-card p-6 max-sm:p-3 rounded-2xl flex flex-col gap-1 group hover:border-primary/30 transition-colors" : analysis_summary?.flagged_transactions > 0 ? "bg-red-500/5 border border-red-500/20 p-6 max-sm:p-3 rounded-2xl flex flex-col gap-1 relative overflow-hidden group" : "sherlock-card p-6 max-sm:p-3 rounded-2xl flex flex-col gap-1 group hover:border-primary/30 transition-colors"}>
              {!isSelectedBlockLoading && analysis_summary?.flagged_transactions > 0 && (
                <div className="absolute -top-2 -right-2 p-2 opacity-5">
                  <AlertTriangle className="size-20 max-sm:size-12 text-red-500" />
                </div>
              )}
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest max-sm:text-[8px]">Flagged Activity</p>
              {isSelectedBlockLoading ? (
                <>
                  <StatValueLoader widthClass="w-16 max-sm:w-12 max-sm:h-6" />
                  <StatTextLoader widthClass="w-36" />
                </>
              ) : (
                <>
                  <p className={`text-2xl max-sm:text-lg font-black ${analysis_summary?.flagged_transactions > 0 ? 'text-red-500' : 'text-white'}`}>{formatStats(analysis_summary?.flagged_transactions)}</p>
                  {analysis_summary?.flagged_transactions > 0 ? (
                    <p className="text-xs max-sm:text-[10px] text-red-400 font-bold flex items-center gap-1 max-sm:flex-wrap">
                      <AlertCircle className="size-4 max-sm:size-3 shrink-0" /> <span className="max-sm:truncate w-full block">Flagged Txs</span>
                    </p>
                  ) : (
                    <p className="text-xs max-sm:text-[10px] text-emerald-500 font-bold flex items-center gap-1 max-sm:flex-wrap">
                      <CheckCircle2 className="size-4 max-sm:size-3 shrink-0" /> <span className="max-sm:truncate w-full block">No Flagged</span>
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="sherlock-card p-6 max-sm:p-3 rounded-2xl flex flex-col gap-1 group hover:border-primary/30 transition-colors">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest max-sm:text-[8px]">Median Fee Rate</p>
              {isSelectedBlockLoading ? (
                <>
                  <StatValueLoader widthClass="w-28 max-sm:w-20 max-sm:h-6" />
                  <StatTextLoader widthClass="w-24" />
                </>
              ) : (
                <>
                  <p className="text-2xl max-sm:text-lg font-black text-white">{formatStats(feeStats.median_sat_vb)} <span className="text-xs max-sm:text-[10px] font-medium text-slate-500">sat/vB</span></p>
                  <p className="text-xs max-sm:text-[10px] text-slate-400 font-bold flex items-center gap-1">
                    Max: {formatStats(feeStats.max_sat_vb)} s/vB
                  </p>
                </>
              )}
            </div>
            <div className="sherlock-card p-6 max-sm:p-3 rounded-2xl flex flex-col gap-1 group hover:border-primary/30 transition-colors">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest max-sm:text-[8px]">Script Diversity</p>
              {isSelectedBlockLoading ? (
                <>
                  <StatValueLoader widthClass="w-24 max-sm:w-16 max-sm:h-6" />
                  <div className="w-full bg-white/10 h-1.5 rounded-full mt-2 overflow-hidden animate-pulse" />
                </>
              ) : (
                <>
                  <p className="text-2xl max-sm:text-lg font-black text-white">{diversityScore}% <span className="text-xs max-sm:text-[10px] font-medium text-slate-500">Modern</span></p>
                  <div className="w-full bg-white/5 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div className="bg-primary h-full rounded-full" style={{ width: `${diversityScore}%` }}></div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Visualization Section */}
          <div className="sherlock-card rounded-2xl p-6 max-sm:p-3 mb-10 max-sm:mb-6">
            <div className="flex flex-col gap-4 max-sm:gap-2 md:flex-row md:items-center md:justify-between mb-8 max-sm:mb-4">
              <h3 className="text-xs max-sm:text-[10px] font-bold uppercase tracking-widest text-slate-500">Script Distribution Analysis</h3>
              <div className="hidden md:flex flex-wrap gap-4">
                <div className="flex items-center gap-1.5">
                  <div className="size-2.5 rounded-full bg-primary shadow-[0_0_8px_rgba(59,73,255,0.4)]"></div>
                  <span className="text-[10px] font-bold text-slate-300">P2WPKH</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="size-2.5 rounded-full bg-cyan-400"></div>
                  <span className="text-[10px] font-bold text-slate-300">P2TR</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="size-2.5 rounded-full bg-purple-500"></div>
                  <span className="text-[10px] font-bold text-slate-300">P2SH</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="size-2.5 rounded-full bg-pink-500"></div>
                  <span className="text-[10px] font-bold text-slate-300">P2PKH</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="size-2.5 rounded-full bg-emerald-400"></div>
                  <span className="text-[10px] font-bold text-slate-300">P2WSH</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="size-2.5 rounded-full bg-amber-500"></div>
                  <span className="text-[10px] font-bold text-slate-300">OP_RETURN</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="size-2.5 rounded-full bg-slate-500"></div>
                  <span className="text-[10px] font-bold text-slate-300">Unknown</span>
                </div>
              </div>
            </div>
            {isSelectedBlockLoading ? (
              <ScriptDistributionLoader />
            ) : (
              <>
                <div className="h-3 w-full bg-white/5 rounded-full flex overflow-hidden">
                  <div className="bg-primary h-full" style={{ width: `${getPercentage(p2wpkhCount)}%` }} title={`P2WPKH: ${getPercentage(p2wpkhCount).toFixed(1)}%`}></div>
                  <div className="bg-cyan-400 h-full" style={{ width: `${getPercentage(p2trCount)}%` }} title={`P2TR: ${getPercentage(p2trCount).toFixed(1)}%`}></div>
                  <div className="bg-purple-500 h-full" style={{ width: `${getPercentage(p2shCount)}%` }} title={`P2SH: ${getPercentage(p2shCount).toFixed(1)}%`}></div>
                  <div className="bg-pink-500 h-full" style={{ width: `${getPercentage(p2pkhCount)}%` }} title={`P2PKH: ${getPercentage(p2pkhCount).toFixed(1)}%`}></div>
                  <div className="bg-emerald-400 h-full" style={{ width: `${getPercentage(p2wshCount)}%` }} title={`P2WSH: ${getPercentage(p2wshCount).toFixed(1)}%`}></div>
                  <div className="bg-amber-500 h-full" style={{ width: `${getPercentage(opReturnCount)}%` }} title={`OP_RETURN: ${getPercentage(opReturnCount).toFixed(1)}%`}></div>
                  <div className="bg-slate-500 h-full" style={{ width: `${getPercentage(unknownCount)}%` }} title={`Unknown: ${getPercentage(unknownCount).toFixed(1)}%`}></div>
                </div>
                <div className="grid grid-cols-2 max-sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 mt-8 max-sm:mt-4 gap-4 max-sm:gap-2">
                  <div>
                    <p className="text-[10px] max-sm:text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-1 max-sm:mb-0.5 truncate">P2WPKH</p>
                    <p className="text-xl max-sm:text-base font-black text-primary">{getPercentage(p2wpkhCount).toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] max-sm:text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-1 max-sm:mb-0.5 truncate">P2TR</p>
                    <p className="text-xl max-sm:text-base font-black text-cyan-400">{getPercentage(p2trCount).toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] max-sm:text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-1 max-sm:mb-0.5 truncate">P2SH</p>
                    <p className="text-xl max-sm:text-base font-black text-purple-500">{getPercentage(p2shCount).toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] max-sm:text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-1 max-sm:mb-0.5 truncate">P2PKH</p>
                    <p className="text-xl max-sm:text-base font-black text-pink-500">{getPercentage(p2pkhCount).toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] max-sm:text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-1 max-sm:mb-0.5 truncate">P2WSH</p>
                    <p className="text-xl max-sm:text-base font-black text-emerald-400">{getPercentage(p2wshCount).toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] max-sm:text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-1 max-sm:mb-0.5 truncate">OP_RETURN</p>
                    <p className="text-xl max-sm:text-base font-black text-amber-500">{getPercentage(opReturnCount).toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] max-sm:text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-1 max-sm:mb-0.5 truncate">Unknown</p>
                    <p className="text-xl max-sm:text-base font-black text-slate-400">{getPercentage(unknownCount).toFixed(1)}%</p>
                  </div>
                </div>
              </>
            )}
          </div>

          {!isSelectedBlockLoading && <FeeRateDistribution feeRates={txFeeRates} />}

          {/* Transaction Explorer */}
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xl font-black text-white tracking-tight">Transaction Explorer</h3>
              {!isSelectedBlockLoading && (
                <div className="flex flex-wrap items-center gap-2 ml-auto justify-end">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-bold uppercase tracking-wider">CoinJoin {patternCounts.coinjoin}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-bold uppercase tracking-wider">Consolidation {patternCounts.consolidation}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-bold uppercase tracking-wider">Self Transfer {patternCounts.self_transfer}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold uppercase tracking-wider">Batch Payment {patternCounts.batch_payment}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold uppercase tracking-wider">Simple Payment {patternCounts.simple_payment}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-700/60 text-zinc-200 font-bold uppercase tracking-wider">Unknown {patternCounts.unknown}</span>
                </div>
              )}
            </div>

            {!isSelectedBlockLoading && (
              <div className="sherlock-card rounded-2xl p-4 flex flex-col md:flex-row gap-3 md:items-center">
                <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">Classification</label>
                <select
                  value={classificationFilter}
                  onChange={(event) => {
                    setClassificationFilter(event.target.value as 'all' | Classification);
                    setVisibleTxCount(50);
                    setExpandedTxId(null);
                  }}
                  className="bg-surface-dark border border-border-subtle rounded-lg px-3 py-2 text-sm max-sm:text-xs text-slate-200 w-full md:w-auto"
                >
                  {CLASSIFICATION_FILTERS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>

                <label className="text-xs text-slate-400 font-bold uppercase tracking-wider md:ml-4">Heuristic</label>
                <select
                  value={heuristicFilter}
                  onChange={(event) => {
                    setHeuristicFilter(event.target.value as 'all' | 'flagged' | HeuristicId);
                    setVisibleTxCount(50);
                    setExpandedTxId(null);
                  }}
                  className="bg-surface-dark border border-border-subtle rounded-lg px-3 py-2 text-sm max-sm:text-xs text-slate-200 w-full md:w-auto"
                >
                  {HEURISTIC_FILTERS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>

                <span className="md:ml-auto text-xs text-slate-400 font-semibold">
                  Showing {filteredTransactions.length} / {transactions?.length ?? 0}
                </span>
              </div>
            )}

            {isSelectedBlockLoading ? (
              <TransactionListLoader />
            ) : (
              <>
                {/* Transaction List */}
                <div className="space-y-4">
                  {filteredTransactions.slice(0, visibleTxCount).map((tx: TransactionChainAnalysis, idx: number) => (
                    <TransactionItem
                      key={tx.txid || idx}
                      tx={tx}
                      isExpanded={expandedTxId === tx.txid}
                      onToggle={() => setExpandedTxId(expandedTxId === tx.txid ? null : tx.txid)}
                    />
                  ))}
                </div>

                {filteredTransactions.length === 0 && (
                  <div className="sherlock-card rounded-2xl p-5 border border-border-subtle">
                    <p className="text-sm text-slate-400">No transactions match the selected filters.</p>
                  </div>
                )}

                {visibleTxCount < filteredTransactions.length && (
                  <div className="flex justify-center pt-6 pb-2">
                    <button
                      onClick={() => setVisibleTxCount(prev => prev + 50)}
                      className="px-6 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl text-sm font-semibold transition-all border border-white/10 hover:border-white/20 cursor-pointer"
                    >
                      Load More Transactions ({filteredTransactions.length - visibleTxCount} remaining)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

const ActionToolbar = ({ txid }: { txid: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(txid);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openMempool = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(`https://mempool.space/tx/${txid}`, '_blank');
  };

  return (
    <div className="flex items-center gap-1 bg-zinc-900/90 backdrop-blur-xl border border-white/10 rounded-xl p-1 shadow-[0_8px_32px_rgba(0,0,0,0.5)] opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-1 group-hover:translate-y-0 z-50">
      <button
        onClick={handleCopy}
        className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-white flex items-center justify-center"
        title="Copy TXID"
      >
        {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
      </button>
      <div className="w-1px h-4 bg-white/5 mx-0.5" />
      <button
        onClick={openMempool}
        className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-slate-400 hover:text-white flex items-center justify-center"
        title="View on Mempool.space"
      >
        <ExternalLink className="size-4" />
      </button>
    </div>
  );
};

const TransactionItem = memo(({ tx, isExpanded, onToggle }: { tx: TransactionChainAnalysis, isExpanded: boolean, onToggle: () => void }) => {
  const itemRef = useRef<HTMLDivElement | null>(null);
  const flaggedCount = Object.values(tx.heuristics || {}).filter((h) => h.detected).length;
  const riskLevel = flaggedCount >= 3 ? 'High Risk' : flaggedCount > 0 ? 'Low Risk' : null;
  const warningChips = (tx.warnings ?? []).slice(0, 3);
  const hasRbf = Boolean(tx.rbf_signaling);
  const hasLocktime = tx.locktime_type && tx.locktime_type !== 'none';
  const hasOpReturn = Boolean(tx.has_op_return);

  let icon = <Wallet className="size-5" />;
  let badgeClass = 'bg-zinc-800 text-zinc-300';
  let cardClass = 'sherlock-card rounded-2xl cursor-pointer transition-all group hover:border-primary/40';
  let iconBg = 'bg-zinc-800/50 border border-zinc-700/50 text-slate-300';

  let classificationName = 'Unknown';
  if (tx.is_coinbase) {
    classificationName = 'Coinbase';
    badgeClass = 'bg-yellow-500/20 text-yellow-400';
    iconBg = 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400';
    cardClass += ' border-l-4 border-l-yellow-500 bg-yellow-500/[0.02] hover:bg-yellow-500/[0.04]';
  } else if (tx.classification) {
    classificationName = tx.classification.split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  if (!tx.is_coinbase) {
    if (riskLevel === 'High Risk' || tx.classification === 'coinjoin') {
    icon = <AlertTriangle className="size-5" />;
    badgeClass = 'bg-red-500/20 text-red-500';
    cardClass = 'sherlock-card border-l-4 border-l-red-500 bg-red-500/[0.02] rounded-2xl cursor-pointer hover:bg-red-500/[0.04] transition-all group';
    iconBg = 'bg-red-500/10 border border-red-500/20 text-red-500';
  } else if (tx.classification === 'consolidation') {
    icon = <GitMerge className="size-5" />;
    badgeClass = 'bg-purple-500/20 text-purple-400';
    iconBg = 'bg-purple-500/10 border border-purple-500/20 text-purple-400';
  } else if (tx.classification === 'simple_payment') {
    icon = <Wallet className="size-5" />;
    badgeClass = 'bg-emerald-500/20 text-emerald-400';
    iconBg = 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400';
  } else if (tx.classification === 'self_transfer') {
    icon = <Repeat className="size-5" />;
    badgeClass = 'bg-blue-500/20 text-blue-400';
    iconBg = 'bg-blue-500/10 border border-blue-500/20 text-blue-400';
  } else if (tx.classification === 'batch_payment') {
    icon = <Network className="size-5" />;
    badgeClass = 'bg-indigo-500/20 text-indigo-400';
    iconBg = 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-400';
  } else if (!tx.is_coinbase) {
    icon = <ShieldQuestion className="size-5" />;
    badgeClass = 'bg-zinc-800 text-zinc-300';
    iconBg = 'bg-zinc-800/80 border border-zinc-700 text-zinc-400 shadow-[inset_0_1px_4px_rgba(0,0,0,0.5)]';
  }
}

  useEffect(() => {
    if (!isExpanded) {
      return;
    }

    const ensureVisible = () => {
      const item = itemRef.current;
      if (!item) {
        return;
      }

      const scrollContainer = item.closest('main') as HTMLElement | null;

      if (!scrollContainer) {
        item.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest',
        });
        return;
      }

      const itemRect = item.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const topPadding = 24;
      const bottomPadding = 24;

      const isAbove = itemRect.top < containerRect.top + topPadding;
      const isBelow = itemRect.bottom > containerRect.bottom - bottomPadding;

      if (isAbove || isBelow) {
        const targetTop = scrollContainer.scrollTop + (itemRect.top - containerRect.top) - topPadding;
        scrollContainer.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
      }
    };

    const animationFrame = window.requestAnimationFrame(ensureVisible);
    const settleTimer = window.setTimeout(ensureVisible, 350);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(settleTimer);
    };
  }, [isExpanded]);

  return (
    <div ref={itemRef} className={`${cardClass} relative scroll-mt-6`}>
      <div className="p-3 max-sm:p-2" onClick={onToggle}>
        <div className="flex sm:items-center gap-4 flex-col sm:flex-row">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
            {tx.is_coinbase ? <Box className="size-5" /> : icon}
          </div>
          <div className="flex-1 min-w-0 w-full">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <p className="text-sm font-bold font-mono text-white truncate max-w-48 sm:max-w-md max-sm:max-w-[150px]">{tx.txid}</p>
              <div className="flex items-center gap-2">
                {riskLevel && (
                  <span className={`${riskLevel === 'High Risk' ? 'bg-red-500 text-white' : 'bg-orange-500/20 text-orange-400'} text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider whitespace-nowrap`}>
                    {riskLevel}
                  </span>
                )}
                <span className={`${badgeClass} text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider whitespace-nowrap`}>
                  {classificationName}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2 max-sm:overflow-x-auto max-sm:flex-nowrap max-sm:scrollbar-hide">
              {hasRbf && (
                <span className="text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  RBF
                </span>
              )}
              {hasLocktime && (
                <span className="text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider bg-blue-500/15 text-blue-300 border border-blue-500/30">
                  Locktime
                </span>
              )}
              {hasOpReturn && (
                <span className="text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider bg-purple-500/15 text-purple-300 border border-purple-500/30">
                  OP_RETURN
                </span>
              )}
              {warningChips.map((warning) => (
                <span
                  key={`${tx.txid}-${warning.code}`}
                  className={`text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider border ${warningChipTone(warning.severity)}`}
                  title={warning.code}
                >
                  {formatWarningLabel(warning.code)}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4 shrink-0 self-center">
            <div className="hidden md:block">
              <ActionToolbar txid={tx.txid} />
            </div>
            <div className="text-slate-600 group-hover:text-slate-400 transition-transform duration-300">
              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </div>
          </div>
        </div>
      </div>

      {/* Animated Expansion Wrapper */}
      <div
        className={`grid transition-all duration-500 ease-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
      >
        <div className={isExpanded ? '' : 'overflow-hidden'}>
          <div className="p-2 border-t border-border-subtle bg-background-dark/50">
            <TransactionVisualizer tx={tx} />
          </div>
        </div>
      </div>
    </div>
  );
});

TransactionItem.displayName = 'TransactionItem';
