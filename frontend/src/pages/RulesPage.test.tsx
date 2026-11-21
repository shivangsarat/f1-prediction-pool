import React from 'react';
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
