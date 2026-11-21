import {useEffect, useState} from 'react';
import {Mail, RefreshCw} from 'lucide-react';
import {get, post} from '../api';
import {Action, Card, Notice} from '../shared/ui';

/** Aggregate outbox data returned only to the platform-wide operator. */
type MailStats = {provider: string; pending: number; delivered: number};

/** Operator-only mail health and safe manual catch-up after server downtime. */
export function OperatorMailPanel() {
  const [stats, setStats] = useState<MailStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  /** Load delivery counts without revealing any participant addresses. */
  async function refresh() {
    try {setStats(await get<MailStats>('/admin/mail')); setError('');}
    catch (e) {setError((e as Error).message);}
  }

  /** Initialize global outbox status once the operator opens the lobby. */
  useEffect(() => {void refresh();}, []);

  /** Reconcile recent locked sessions and attempt a bounded batch of queued emails. */
  async function sync() {
    setBusy(true); setMessage('');
    try {
      const result = await post<{queued: number; delivery: {sent: number; failed: number}}>('/admin/mail/sync', {});
      setMessage(`New notifications queued: ${result.queued}; delivered: ${result.delivery.sent}; retrying: ${result.delivery.failed}.`);
      await refresh();
    } catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }

  return <Card><h3><Mail size={18}/> Platform email delivery</h3>
    <p className="muted">Mail credentials and recipient addresses remain server-side. Only the global operator can trigger reconciliation.</p>
    <p>{stats ? `Provider: ${stats.provider} · ${stats.pending} queued · ${stats.delivered} delivered` : 'Loading provider status…'}</p>
    <Action disabled={busy || !stats || stats.provider === 'none'} onClick={() => void sync()}><RefreshCw size={16}/> Reconcile notification queue</Action>
    {stats?.provider === 'none' && <Notice>Set MAIL_PROVIDER and credentials in backend environment to enable official emails.</Notice>}
    {error && <Notice kind="error">{error}</Notice>}
    {message && <Notice kind="success">{message}</Notice>}
  </Card>;
}
