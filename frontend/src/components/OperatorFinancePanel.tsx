import {useEffect, useState} from 'react';
import {ShieldCheck, Save} from 'lucide-react';
import {get, patch} from '../api';
import {Card, Notice, Action, FieldHelp} from '../shared/ui';
import {formatBps} from './FinancialTerms';

/** Global hosting controls are writable only by the authenticated platform operator. */
export type PlatformPolicy = {
  platformRakeEnabled: boolean;
  platformRakeBps: number;
  allowTournamentHouseRake: boolean;
  allowPublicMidseason: boolean;
  maxActiveOwnedPools: number;
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
    <h3><ShieldCheck size={19}/> Platform-wide fees and tournament limits</h3>
    <p className="muted">Controls the hosting fee across unlocked seasons. Tournament creators may charge their own fee only when explicitly permitted.</p>
    {policy && <div className="form-grid">
      <label className="check-line"><input type="checkbox" checked={policy.platformRakeEnabled} onChange={event => setPolicy({...policy, platformRakeEnabled: event.target.checked})}/> Charge a platform hosting fee <FieldHelp label="Charge a platform hosting fee" detail="Switch on the global operator fee. It is deducted from net collected entry fees in unlocked pools only."/></label>
      <label className="input-label">Platform fee (basis points; 100 = 1%)<FieldHelp label="Platform fee (basis points; 100 = 1%)" detail="Fee percentage in basis points: 100 = 1%, 500 = 5%. Combined operator and creator fees cannot exceed 15%."/><input type="number" min="0" max="1500" step="50" value={policy.platformRakeBps} onChange={event => setPolicy({...policy, platformRakeBps: Number(event.target.value)})}/></label>
      <label className="check-line"><input type="checkbox" checked={policy.allowTournamentHouseRake} onChange={event => setPolicy({...policy, allowTournamentHouseRake: event.target.checked})}/> Allow tournament creator fees <FieldHelp label="Allow tournament creator fees" detail="Permit commissioners to configure an additional fee from their own pool; combined fees stay capped at 15%."/></label>
      <label className="check-line"><input type="checkbox" checked={policy.allowPublicMidseason} onChange={event => setPolicy({...policy, allowPublicMidseason: event.target.checked})}/> Allow public mid-season pools <FieldHelp label="Allow public mid-season pools" detail="If disabled, users can still create invite-only mid-season pools but cannot list new public ones."/></label>
      <label className="input-label">Maximum active pools per creator<FieldHelp label="Maximum active pools per creator" detail="Maximum number of active tournaments an ordinary user may own. Archived pools do not count; global operators are exempt."/><input aria-label="Maximum active owned tournaments" type="number" min="1" max="20" value={policy.maxActiveOwnedPools} onChange={event => setPolicy({...policy, maxActiveOwnedPools: Number(event.target.value)})}/></label>
      <Notice>Restricting public mid-season creation protects catalogue clarity and shared email quotas. Invite-only friend pools remain available within the per-user ownership cap.</Notice>
      <p>Active operator fee: <strong>{formatBps(policy.platformRakeEnabled ? policy.platformRakeBps : 0)}</strong> · Creator headroom: <strong>{formatBps(1500 - (policy.platformRakeEnabled ? policy.platformRakeBps : 0))}</strong></p>
      <Action disabled={busy || policy.platformRakeBps < 0 || policy.platformRakeBps > 1500 || policy.maxActiveOwnedPools < 1 || policy.maxActiveOwnedPools > 20} onClick={() => void save()}><Save size={15}/> Save platform settings</Action>
    </div>}
    <Notice>Changes apply only to new or unlocked seasons. Round-1 locked seasons retain their original operator and creator rake. Combined rake can never exceed 15%.</Notice>
    {saved && <Notice kind="success">Global financial policy saved.</Notice>}
    {error && <Notice kind="error">{error}</Notice>}
  </Card>;
}
