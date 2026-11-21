import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {InvitationsPanel} from './InvitationsPanel';
import {get, post} from '../api';

vi.mock('../api', () => ({get: vi.fn(), post: vi.fn()}));
afterEach(() => {cleanup(); vi.clearAllMocks();});

/** A participant accepts only invitations addressed to their own account. */
it('accepts an invitation and opens the new tournament', async () => {
  vi.mocked(get).mockResolvedValue([{id: 'i1', tournament_id: 't1', name: 'Friends Sprint', created_at: '2026-01-01T00:00:00Z'}]);
  vi.mocked(post).mockResolvedValue({id: 't1', name: 'Friends Sprint', role: 'player'});
  const accepted = vi.fn().mockResolvedValue(undefined);
  render(<InvitationsPanel onAccepted={accepted}/>);
  expect(await screen.findByText('Friends Sprint')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: /Accept/i}));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/invitations/i1/respond', {action: 'accept'}));
  expect(accepted).toHaveBeenCalled();
});

/** Declining a targeted invitation must not create a membership. */
it('declines invitations without opening a tournament', async () => {
  vi.mocked(get).mockResolvedValue([{id: 'i2', tournament_id: 't2', name: 'Another Race', created_at: '2026-01-01T00:00:00Z'}]);
  vi.mocked(post).mockResolvedValue({status: 'declined'});
  const accepted = vi.fn();
  render(<InvitationsPanel onAccepted={accepted}/>);
  expect(await screen.findByText('Another Race')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: /Decline/i}));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/invitations/i2/respond', {action: 'decline'}));
  expect(accepted).not.toHaveBeenCalled();
});
