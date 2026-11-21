import {afterEach, expect, it} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import {FinancialTerms, formatBps} from './FinancialTerms';

afterEach(cleanup);

/** Verify basis-point disclosure is human-readable and precision-safe. */
it('converts basis points to a percentage', () => {
  expect(formatBps(1500)).toBe('15.00%');
  expect(formatBps(75)).toBe('0.75%');
});

/** Warn prospective participants when a tournament has no published financial terms. */
it('discloses missing season settings', () => {
  render(<FinancialTerms terms={null} />);
  expect(screen.getByText(/have not been configured/)).toBeTruthy();
});

/** Show the payout model, both house percentages and loss-reduction risk before joining. */
it('shows poker terms with exact itemized fees and floor-off warning', () => {
  render(<FinancialTerms terms={{
    configured: true,
    payoutModel: 'poker',
    platformRakeBps: 500,
    creatorRakeBps: 250,
    totalRakeBps: 750,
    pokerFloorEnabled: false,
    pokerItmPct: 40,
    configLocked: false,
    warning: 'Settings freeze at Round 1',
  }} />);
  expect(screen.getByText(/Casino Poker ladder/)).toBeTruthy();
  expect(screen.getByText(/7.50%/)).toBeTruthy();
  expect(screen.getByText(/loss-reduction; lower paid places may pay below entry/)).toBeTruthy();
  expect(screen.getByText(/Settings freeze at Round 1/)).toBeTruthy();
});
