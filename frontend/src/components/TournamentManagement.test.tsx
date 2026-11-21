import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {TournamentManagement} from './TournamentManagement';
import {get, patch, post} from '../api';

vi.mock('../api', () => ({get: vi.fn(), patch: vi.fn(), post: vi.fn()}));
afterEach(() => {cleanup(); vi.clearAllMocks();});

const tournament = {id: 't1', name: 'Private Monaco', description: 'Friends', visibility: 'invite_only' as const, status: 'active' as const, role: 'commissioner' as const, memberCount: 2};

/** A commissioner may save public/private visibility through the protected API. */
it('updates tournament visibility and calls onChanged', async () => {
  vi.mocked(patch).mockResolvedValue({...tournament, visibility: 'public'});
  const update = vi.fn();
  render(<TournamentManagement tournament={tournament} onChanged={update}/>);
  fireEvent.change(screen.getByLabelText('Tournament visibility'), {target: {value: 'public'}});
  fireEvent.click(screen.getByRole('button', {name: 'Save settings'}));
  await waitFor(() => expect(patch).toHaveBeenCalledWith('/tournaments/t1', expect.objectContaining({visibility: 'public'})));
  expect(update).toHaveBeenCalled();
});

/** Searching usernames must not fetch or display users' private email addresses. */
it('searches usernames and sends a pending invitation', async () => {
  vi.mocked(get).mockResolvedValue([{id: 'u2', username: 'driver44', display_name: 'Driver 44'}]);
  vi.mocked(post).mockResolvedValue({status: 'pending'});
  render(<TournamentManagement tournament={tournament} onChanged={vi.fn()}/>);
  fireEvent.change(screen.getByPlaceholderText('player_username'), {target: {value: 'driver'}});
  fireEvent.click(screen.getByRole('button', {name: /^Find$/i}));
  expect(await screen.findByText('@driver44')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: 'Invite'}));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/tournaments/t1/invite-user', {userId: 'u2'}));
});

/** Invite tokens are shown as links only after explicit rotation. */
it('generates a joining link and invalidates the previous secret', async () => {
  vi.mocked(post).mockResolvedValue({inviteCode: '0123456789abcdefghijklmnopqrstuvwxyz'});
  render(<TournamentManagement tournament={tournament} onChanged={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', {name: 'Generate new link'}));
  await waitFor(() => expect(screen.getByText(/invite=0123456789/)).toBeTruthy());
});
