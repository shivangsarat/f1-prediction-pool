import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {TournamentCatalogue} from './TournamentCatalogue';
import {get} from '../api';

vi.mock('../api', () => ({get: vi.fn()}));
afterEach(() => {cleanup(); vi.clearAllMocks();});

/** Public catalogue displays public entries without disclosing private invitations. */
it('shows public competition cards and allows a participant to request joining', async () => {
  vi.mocked(get).mockResolvedValue([{id: 'pub', name: 'Open Championship', description: 'Join us', visibility: 'public', status: 'active', memberCount: 11}]);
  const join = vi.fn().mockResolvedValue(undefined);
  render(<TournamentCatalogue signedIn={true} onJoin={join} onBack={vi.fn()}/>);
  expect(await screen.findByText('Open Championship')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: /Join tournament/i}));
  await waitFor(() => expect(join).toHaveBeenCalledWith(expect.objectContaining({id: 'pub'})));
});

/** A guest sees sign-up rather than being silently joined to a public pool. */
it('routes a guest to registration before joining a public pool', async () => {
  vi.mocked(get).mockResolvedValue([{id: 'pub2', name: 'Guest League', visibility: 'public', status: 'active', description: '', memberCount: 1}]);
  const join = vi.fn().mockResolvedValue(undefined);
  render(<TournamentCatalogue signedIn={false} onJoin={join} onBack={vi.fn()}/>);
  expect(await screen.findByText('Guest League')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: /Sign up to join/i}));
  await waitFor(() => expect(join).toHaveBeenCalledTimes(1));
});

/** The catalogue search sends an encoded, bounded query to the API. */
it('searches for public competitions', async () => {
  vi.mocked(get).mockResolvedValue([]);
  render(<TournamentCatalogue signedIn={false} onJoin={vi.fn()} onBack={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText('Search public tournaments'), {target: {value: 'monaco'}});
  await waitFor(() => expect(get).toHaveBeenCalledWith('/catalogue?q=monaco'));
});

/** Full and mid-season catalogue filters request only the selected public scope. */
it('filters public catalogue by mid-season scope', async () => {
  vi.mocked(get).mockResolvedValue([]);
  render(<TournamentCatalogue signedIn={false} onJoin={vi.fn()} onBack={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText('Filter tournament scope'), {target:{value:'mid'}});
  await waitFor(() => expect(get).toHaveBeenCalledWith('/catalogue?q=&scope=mid'));
});
