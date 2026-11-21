import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {OperatorMailPanel} from './OperatorMailPanel';
import {get, post} from '../api';
vi.mock('../api', () => ({get: vi.fn(), post: vi.fn()}));
afterEach(() => {cleanup(); vi.clearAllMocks();});

/** Reconciliation is operator-controlled and invokes the protected endpoint. */
it('shows counts and runs a bounded mail reconciliation', async () => {
  vi.mocked(get).mockResolvedValue({provider: 'gmail', pending: 3, delivered: 10});
  vi.mocked(post).mockResolvedValue({queued: 2, delivery: {sent: 2, failed: 0}});
  render(<OperatorMailPanel/>);
  expect(await screen.findByText(/3 queued/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: /Reconcile notification queue/i}));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/mail/sync', {}));
});
