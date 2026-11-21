import {Info} from 'lucide-react';

/** Safe, server-derived monetary disclosure shared by discovery, invitations, and tournament pages. */
export interface TournamentFinanceTerms {
  configured: boolean;
  seasonId?: string;
  year?: number;
  currency?: string;
  baseEntryCents?: number;
  payoutModel?: 'adaptive-3tier' | 'poker';
  platformRakeBps?: number;
  creatorRakeBps?: number;
  totalRakeBps?: number;
  pokerFloorEnabled?: boolean | null;
  pokerItmPct?: number | null;
  configLocked?: boolean;
  warning: string;
}

/** Format integer basis points into a percentage without rounding input values. */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** Explain the current payout engine, both rake layers, floor semantics, and Round-1 lock caveat. */
export function FinancialTerms({terms, compact = false}: {terms?: TournamentFinanceTerms | null; compact?: boolean}) {
  if (!terms?.configured) return <p className="financial-caveat"><Info size={14}/> Financial terms have not been configured. Confirm before joining or paying.</p>;
  return <div className="financial-terms" aria-label="Current tournament financial terms">
    <strong>Prize model: {terms.payoutModel === 'poker' ? 'Casino Poker ladder' : 'Adaptive 3-Tier'}</strong>
    <span>House rake: {formatBps(terms.totalRakeBps ?? 0)} ({formatBps(terms.platformRakeBps ?? 0)} operator + {formatBps(terms.creatorRakeBps ?? 0)} creator)</span>
    {terms.payoutModel === 'poker' && <span>Floor: {terms.pokerFloorEnabled ? 'ON · full-entry minimum for paid places' : 'OFF · loss-reduction; lower paid places may pay below entry'}</span>}
    {!compact && terms.payoutModel === 'poker' && <span>Target paid field: {terms.pokerItmPct}% · 25% entry dust guard in Floor-OFF mode</span>}
    <small className="financial-caveat">{terms.configLocked ? 'Financial settings locked at Round 1.' : terms.warning}</small>
  </div>;
}
