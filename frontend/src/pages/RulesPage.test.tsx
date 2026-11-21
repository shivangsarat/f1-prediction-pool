import {it, expect} from 'vitest';
import {render, screen} from '@testing-library/react';
import {RulesPage} from './RulesPage';

/** The signed-off payout and scoring rules must appear inside the selected tournament. */
it('renders the rules for the selected tournament season', () => {

  render(<RulesPage season={{year: 2027, sprint_mode: 'two-form'}} />);
  expect(screen.getByText(/Season 2027/)).toBeTruthy();
  expect(screen.getByText(/Exact P1, P2 or P3/)).toBeTruthy();
  expect(screen.getByText(/85 points per Grand Prix/)).toBeTruthy();
});

/** Reveal the tournament's active financial contract and optional loss-reduction warning. */
it('renders the selected season poker model and two-layer rake disclosure', () => {
  render(<RulesPage season={{year: 2027, sprint_mode: 'two-form', finance: {
    payoutModel: 'poker', platformRakeBps: 500, creatorRakeBps: 500,
    pokerFloorEnabled: false, pokerItmPct: 30, configLocked: true,
  }}} />);
  expect(screen.getByText(/Casino Poker ladder/)).toBeTruthy();
  expect(screen.getByText(/10.00%/)).toBeTruthy();
  expect(screen.getByText(/loss-reduction; lower paid places may pay below entry/)).toBeTruthy();
});
