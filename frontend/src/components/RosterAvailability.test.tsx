import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {RosterAvailability} from './RosterAvailability';

afterEach(cleanup);

/** Show an automatic-loading state rather than incorrectly blaming the commissioner. */
it('shows season-wide OpenF1 sync while loading', () => {
  render(<RosterAvailability loaded={false} onRetry={vi.fn()}/>);
  expect(screen.getByText(/Loading this season.s drivers and constructors/)).toBeTruthy();
  expect(screen.queryByText(/commissioner must register/)).toBeNull();
  expect(screen.queryByText(/Retry OpenF1 sync/)).toBeNull();
});

/** Every tournament participant may trigger a member-authorized, throttled retry. */
it('allows a retry when OpenF1 does not yet have the lineup', async () => {
  const retry = vi.fn().mockResolvedValue(undefined);
  render(<RosterAvailability loaded={true} onRetry={retry}/>);
  expect(screen.getByText(/not published a complete driver lineup/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: /Retry OpenF1 sync/}));
  await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
});

/** Failed sync attempts keep a retry affordance without losing the visible reason. */
it('reports a failed retry', async () => {
  render(<RosterAvailability loaded={true} onRetry={vi.fn().mockRejectedValue(new Error('Offline'))}/>);
  fireEvent.click(screen.getByRole('button', {name: /Retry OpenF1 sync/}));
  await waitFor(() => expect(screen.getByText('Offline')).toBeTruthy());
});
