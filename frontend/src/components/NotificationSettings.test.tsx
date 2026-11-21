import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {NotificationSettings} from './NotificationSettings';
import {get, patch, post} from '../api';

vi.mock('../api', () => ({get: vi.fn(), patch: vi.fn(), post: vi.fn()}));
afterEach(() => {cleanup(); vi.clearAllMocks();});

/** Email opt-out is persisted per user rather than disabling other participants' alerts. */
it('updates personal notifications setting', async () => {
  vi.mocked(get).mockImplementation((path: string) => Promise.resolve(path === '/auth/me' ? {emailVerified: true, notificationOptIn: true} : {available: true}));
  vi.mocked(patch).mockResolvedValue({enabled: false});
  render(<NotificationSettings/>);
  expect(await screen.findByRole('checkbox', {name: /Receive tournament updates/i})).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() => expect(patch).toHaveBeenCalledWith('/account/notifications', {enabled: false}));
});

/** Accounts without a verified inbox may request one-time confirmation mail. */
it('shows a verification action for an unverified account', async () => {
  vi.mocked(get).mockImplementation((path: string) => Promise.resolve(path === '/auth/me' ? {emailVerified: false, notificationOptIn: true} : {available: true}));
  vi.mocked(post).mockResolvedValue({queued: true});
  render(<NotificationSettings/>);
  fireEvent.click(await screen.findByRole('button', {name: /Verify email/i}));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/account/verification-email', {}));
});
