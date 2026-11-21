import {useCallback, useEffect, useState} from 'react';
import {RefreshCw, ShieldCheck, Trophy, Users} from 'lucide-react';
import {get, put} from '../api';
import {Card, SectionHeading, Pill, Select, Action, type Form} from '../shared/ui';
import {PredictionEditor} from './PredictionEditor';
import {RosterAvailability} from '../components/RosterAvailability';
/** Manage blind race predictions and reveal published peer picks for one tournament. */
export function PicksPage({season, weekends, drivers, teams, user, toast, rosterLoaded, onRosterRetry}: {season: any; weekends: any[]; drivers: any[]; teams: any[]; user: any; toast: (s: string) => void; rosterLoaded: boolean; onRosterRetry: () => Promise<void>}) {

  const [activeId, setActiveId] = useState(''), [data, setData] = useState<any>(null), [revealed, setRevealed] = useState<any[]>([]), [weekly, setWeekly] = useState<any[]>([]), [loading, setLoading] = useState(false);
  useEffect(() => {
    setActiveId(weekends.find(w => !w.qualifyingLocked)?.id ?? weekends[0]?.id ?? '')
  }, [season.id, weekends.length]);
  const active = weekends.find(w => w.id === activeId);
  const forms: Form[] = active?.is_sprint ? (season.sprint_mode === 'one-form' ? ['unified'] : ['sprint', 'gp']) : ['gp'];
  const [form, setForm] = useState<Form>('gp');
  useEffect(() => {
    setForm(forms[0] ?? 'gp')
  }, [activeId, season.sprint_mode]);
  const refresh = useCallback(async () => {
    if (!activeId) return;
    setLoading(true);
    try {
      const [d, r, l] = await Promise.all([get(`/weekends/${activeId}`), get(`/weekends/${activeId}/picks`), get(`/weekends/${activeId}/leaderboard`)]);
      setData(d);
      setRevealed(r);
      setWeekly(l)
    } catch (e: any) {
      toast(e.message)
    } finally {
      setLoading(false)
    }
  }, [activeId]);
  useEffect(() => {
    refresh()
  }, [refresh]);
  const selected = data?.mySubmissions?.find((s: any) => s.form === form);
  const cutoff = active ? (form === 'sprint' || form === 'unified' ? active.sprint_qualifying_at : active.qualifying_at) : '';
  return <><SectionHeading eyebrow="PREDICT THE GRID" title="My Predictions" detail="Pick your finish order, bonus props, and Sprint calls. Latest revision counts until the server-side lock." right={<Select value={activeId} onChange={setActiveId} options={weekends.map(w => ({value: w.id, label: `R${w.round} · ${w.name}`}))} />} />{!active ? <Card><div className="empty">The commissioner needs to publish a race calendar before picks can open.</div></Card> : <div className="two-col picks-layout"><Card><div className="form-tab-header"><div><div className="eyebrow">ROUND {active.round} · {active.is_sprint ? 'SPRINT WEEKEND' : 'GRAND PRIX'}</div><h3>{active.name}</h3></div><Pill tone="amber">{active.is_sprint ? '96 pts max' : '85 pts max'}</Pill></div><div className="tabs">{forms.map(f => <button key={f} className={form === f ? 'active' : ''} onClick={() => setForm(f)}>{f === 'sprint' ? 'Form A · Sprint' : f === 'gp' && active.is_sprint ? 'Form B · GP' : f === 'unified' ? 'Unified ballot' : 'Grand Prix ballot'}</button>)}</div>{drivers.length < 10 ? <RosterAvailability loaded={rosterLoaded} onRetry={onRosterRetry}/> : <PredictionEditor key={activeId + form + String(selected?.version ?? 0)} kind={form} existing={selected} drivers={drivers} teams={teams} deadline={cutoff} onSave={async (f, p) => {
    await put(`/weekends/${activeId}/picks/${f}`, p);
    toast('Prediction saved. Your revision is secured.');
    refresh()
  }} />}</Card><div className="stack"><Card><div className="card-heading"><div><div className="eyebrow">BLIND PICK INTEGRITY</div><h3>Submission status</h3></div><ShieldCheck size={22} /></div>{forms.map(f => {
    const lock = f === 'gp' ? active.qualifying_at : active.sprint_qualifying_at;
    const own = data?.mySubmissions?.find((p: any) => p.form === f);
    return <div className="status-line" key={f}><span>{f === 'sprint' ? 'Sprint picks' : f === 'unified' ? 'Combined picks' : 'Grand Prix picks'}</span><Pill tone={own ? 'green' : new Date(lock).getTime() <= Date.now() ? 'red' : 'amber'}>{own ? 'Submitted' : Date.now() >= Date.parse(lock) ? 'Missed' : 'Pending'}</Pill></div>
  })}<div className="card-note">All other players’ forms are sealed until the relevant qualifying session begins. No retroactive edits are permitted.</div></Card><Card><div className="card-heading"><div><div className="eyebrow">POST-LOCK REVEAL</div><h3>Paddock picks</h3></div><Users size={20} /></div>{revealed.filter(r => r.user_id !== user.id).length ? revealed.filter(r => r.user_id !== user.id).map(r => <div key={r.id} className="revealed"><strong>{r.displayName}</strong><Pill>{r.form.toUpperCase()}</Pill><div className="muted small">{r.payload.top10?.slice(0, 3).map((id: string) => drivers.find(d => d.id === id)?.code ?? id).join(' · ') ?? 'Sprint props'}</div></div>) : <div className="empty small">Other participants' predictions are hidden until their session locks.</div>}<Action kind="ghost" onClick={refresh}><RefreshCw size={15} /> Refresh</Action></Card>{weekly.length > 0 && <Card><div className="card-heading"><h3>Round leaderboard</h3><Trophy size={18} /></div>{weekly.slice(0, 8).map((r: any) => <div className="status-line" key={r.userId}><strong>#{r.rank} · {r.name}</strong><strong>{r.total} pts</strong></div>)}</Card>}{data?.score && <Card><div className="card-heading"><h3>Your published score</h3><Trophy size={18} /></div><div className="big-score">{data.score.points} <small>points</small></div><p className="muted">Exact podiums: {data.score.exact_podiums} · Props: {data.score.prop_points}</p></Card>}</div></div>}</>
}
