import React from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {TournamentLobby} from './TournamentLobby';
import {post} from '../api';

vi.mock('../api', () => ({post: vi.fn()}));
const mockPost = vi.mocked(post);
const tournament = {id: 'a', name: 'Paddock Championship', description: 'Friends league', role: 'commissioner' as const, memberCount: 4};

/** Validate that existing tournament cards navigate to the selected tournament. */
describe('TournamentLobby', () => {

  beforeEach(() => vi.clearAllMocks());
  it('shows accessible tournaments and navigates on selection', () => {

    const open = vi.fn();
    render(<TournamentLobby user={{display_name: 'Alex'}} tournaments={[tournament]} onOpen={open} onSignOut={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText('Paddock Championship')).toBeTruthy();
    fireEvent.click(screen.getByText('Paddock Championship'));
    expect(open).toHaveBeenCalledWith(tournament);
  });

  /** Verify tournament creation submits a name/description and discloses the one-time invite. */
  it('creates a tournament with an invitation code', async () => {

    mockPost.mockResolvedValue({id: 'new', inviteCode: 'one-time-code', name: 'New Racers'});
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<TournamentLobby user={{display_name: 'Alex'}} tournaments={[]} onOpen={vi.fn()} onSignOut={vi.fn()} onRefresh={refresh} />);
    fireEvent.change(screen.getByPlaceholderText('2027 Friends Championship'), {target: {value: 'New Racers'}});
    fireEvent.change(screen.getByPlaceholderText('Weekend prediction challenge'), {target: {value: 'For colleagues'}});
    fireEvent.click(screen.getByRole('button', {name: /Create tournament/i}));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/tournaments', {name: 'New Racers', description: 'For colleagues'}));
    expect(await screen.findByText('one-time-code')).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  /** Verify the invitation code is required before joining an existing pool. */
  it('joins with a commissioner-issued code', async () => {

    mockPost.mockResolvedValue({id: 'joined'});
    render(<TournamentLobby user={{display_name: 'Alex'}} tournaments={[]} onOpen={vi.fn()} onSignOut={vi.fn()} onRefresh={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.change(screen.getByPlaceholderText('Paste invite code'), {target: {value: '12345678901234567890123'}});
    fireEvent.click(screen.getByRole('button', {name: /Join tournament/i}));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/tournaments/join', {inviteCode: '12345678901234567890123'}));
  });
});
