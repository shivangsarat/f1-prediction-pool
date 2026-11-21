import {useEffect, useState} from 'react';
import {ShieldCheck, Save} from 'lucide-react';
import {get, patch} from '../api';
import {Card, Notice, Action} from '../shared/ui';
import {formatBps} from './FinancialTerms';

/** Global hosting controls are writable only by the authenticated platform operator. */
export type PlatformPolicy = {
  platformRakeEnabled: boolean;
  platformRakeBps: number;
  allowTournamentHouseRake: boolean;
};

/** Admin-only global operator controls, separate from individual season configuration. */
export function OperatorFinancePanel() {
  const [policy, setPolicy] = useState<PlatformPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  /** Load persistent policy without ever exposing the operator's email secrets. */
  useEffect(() => {void get<PlatformPolicy>('/operator/finance').then(setPolicy).catch((e: Error) => setError(e.message));}, []);

  /** Save explicit policy changes; locked seasons retain snapshotted values on the server. */
  async function save() {
    if (!policy) return;
    setBusy(true); setError(''); setSaved(false);
    try {setPolicy(await patch<PlatformPolicy>('/operator/finance', policy)); setSaved(true);}
    catch (e) {setError((e as Error).message);}
    finally {setBusy(false);}
  }

  return <Card>
    <h3><ShieldCheck size={19}/> Global operator · house rake policy</h3>
    <p className="muted">Controls the hosting fee across unlocked seasons. Tournament creators may charge their own fee only when explicitly permitted.</p>
    {policy && <div className="form-grid">
      <label className="check-line"><input type="checkbox" checked={policy.platformRakeEnabled} onChange={event => setPolicy({...policy, platformRakeEnabled: event.target.checked})}/> Collect operator hosting fee</label>
      <label className="input-label">HOSTING FEE (BASIS POINTS, 100 = 1%)<input type="number" min="0" max="1500" step="50" value={policy.platformRakeBps} onChange={event => setPolicy({...policy, platformRakeBps: Number(event.target.value)})}/></label>
      <label className="check-line"><input type="checkbox" checked={policy.allowTournamentHouseRake} onChange={event => setPolicy({...policy, allowTournamentHouseRake: event.target.checked})}/> Allow creators to charge tournament rake</label>
      <p>Active operator fee: <strong>{formatBps(policy.platformRakeEnabled ? policy.platformRakeBps : 0)}</strong> · Creator headroom: <strong>{formatBps(1500 - (policy.platformRakeEnabled ? policy.platformRakeBps : 0))}</strong></p>
      <Action disabled={busy || policy.platformRakeBps < 0 || policy.platformRakeBps > 1500} onClick={() => void save()}><Save size={15}/> Save operator policy</Action>
    </div>}
    <Notice>Changes apply only to new or unlocked seasons. Round-1 locked seasons retain their original operator and creator rake. Combined rake can never exceed 15%.</Notice>
    {saved && <Notice kind="success">Global financial policy saved.</Notice>}
    {error && <Notice kind="error">{error}</Notice>}
  </Card>;
}
