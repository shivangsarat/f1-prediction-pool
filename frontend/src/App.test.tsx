import {afterEach, it, expect, vi} from 'vitest';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import {App} from './App';
import {get} from './api';

vi.mock('./api', () => ({get: vi.fn(), post: vi.fn()}));
vi.mock('./pages/TournamentWorkspace', () => ({TournamentWorkspace: ({tournament}: {tournament: {name: string}}) => <div>Workspace for {tournament.name}</div>}));
afterEach(cleanup);
const mockGet = vi.mocked(get);

/** Authenticated participants see the tournament lobby before any season or picks. */
it('loads the tournament lobby as the logged-in home screen', async () => {

  mockGet.mockImplementation((path: string) => Promise.resolve(path === '/auth/me' ? {id: 'user', display_name: 'Alex'} : []));
  render(<App />);
  expect(await screen.findByText('Prediction tournaments')).toBeTruthy();
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/tournaments'));
});

/** Logged-out users cannot see tournament data. */
it('shows authentication when the session is invalid', async () => {

  mockGet.mockRejectedValueOnce(new Error('Unauthorized'));
  render(<App />);
  expect(await screen.findByText('Welcome back.')).toBeTruthy();
});
