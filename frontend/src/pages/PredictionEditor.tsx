import {useEffect, useMemo, useState} from 'react';
import {ArrowDown, ArrowUp, CheckCircle2, Clock, LockKeyhole, Save, ShieldCheck, Wifi} from 'lucide-react';
import {get, date} from '../api';
import {Pill, Notice, Select, Action, FieldHelp, useCountdown, mkDefault, emptySprint, type Form} from '../shared/ui';
/** Render reusable GP, Sprint and combined forms with driver validation and deadline status. */
export function PredictionEditor({kind, existing, drivers, teams, deadline, onSave}: {kind: Form; existing: any; drivers: any[]; teams: any[]; deadline: string; onSave: (form: Form, p: any) => Promise<void>}) {

  const defaults = useMemo(() => mkDefault(drivers), [drivers]);
  const [grid, setGrid] = useState<string[]>([]), [props, setProps] = useState<any>({}), [sprint, setSprint] = useState<any>({}), [saving, setSaving] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const payload = existing?.payload;
    setGrid(payload?.top10 ?? defaults.top10);
    setProps(payload?.props ?? (kind === 'sprint' ? emptySprint(drivers, teams) : defaults.props));
    setSprint(payload?.sprint ?? emptySprint(drivers, teams));
    setError('')
  }, [existing?.version, kind, drivers.length, teams.length]);
  const countdown = useCountdown(deadline), readOnly = countdown.closed;
  const [dragged, setDragged] = useState<number | null>(null);
  const driverMap = new Map(drivers.map(d => [d.id, d]));
  const driverOptions = drivers.map(d => ({value: d.id, label: `${d.code} — ${d.name}`}));
  const teamOptions = teams.map(t => ({value: t.id, label: t.name}));
  /**
 * Reorder one driver in the predicted finishing grid.
 * @param i - Input to this operation.
 * @param j - Input to this operation.
 */
  function move(i: number, j: number) {
    if (readOnly || j < 0 || j >= grid.length) return;
    const next = [...grid];
    [next[i], next[j]] = [next[j], next[i]];
    setGrid(next)
  }
  /**
 * Replace one predicted driver while preserving unique top-ten selections.
 * @param i - Input to this operation.
 * @param v - Input to this operation.
 */
  function changeDriver(i: number, v: string) {
    const j = grid.indexOf(v);
    if (j >= 0) move(i, j); else {
      const next = [...grid];
      next[i] = v;
      setGrid(next)
    }
  }
  /**
 * Validate and submit the participant’s form or authentication request.
 */
  async function submit() {
    setError('');
    setSaving(true);
    try {
      let payload: any;
      if (kind === 'sprint') payload = {props}; else payload = {top10: grid, props};
      if (kind === 'unified') payload.sprint = sprint;
      await onSave(kind, payload)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }
  const sprintProps = kind === 'sprint' ? props : sprint;
  const podium = ['P1', 'P2', 'P3'];
  return <div className="editor"><div className="editor-bar"><div className="lock"><Clock size={17} /><div><div className="muted small">PICKS {readOnly ? 'CLOSED' : 'LOCK IN'}</div><div className={readOnly ? 'timer closed' : 'timer'}>{countdown.text}</div></div></div><div className="deadline">Deadline<br /><strong>{date(deadline)}</strong></div><Pill tone={readOnly ? 'red' : 'green'}>{readOnly ? <><LockKeyhole size={12} /> Locked</> : <><Wifi size={12} /> Open for picks</>}</Pill></div>
    {kind !== 'sprint' && <><div className="mini-heading"><div><h3>Race finishing order</h3><p>Place ten unique drivers. Drag or use the arrows to reorder.</p></div><Pill>65 points available</Pill></div><div className="driver-grid">{grid.map((driverId, i) => {
      const d = driverMap.get(driverId);
      return <div key={i} className={'driver-row ' + (i < 3 ? 'podium' : '')} draggable={!readOnly} onDragStart={() => setDragged(i)} onDragOver={e => e.preventDefault()} onDrop={() => {
        if (dragged !== null) move(dragged, i);
        setDragged(null)
      }}><span className="position">{String(i + 1).padStart(2, '0')}</span><span className="team-bar" style={{background: d?.color ?? '#f45157'}} /><div className="driver-select"><Select value={driverId} onChange={v => changeDriver(i, v)} options={driverOptions} disabled={readOnly} /><span>{d?.team_name ?? 'Team not set'}</span></div><div className="move-buttons"><button title="Move up" disabled={readOnly || i === 0} onClick={() => move(i, i - 1)}><ArrowUp size={14} /></button><button title="Move down" disabled={readOnly || i === grid.length - 1} onClick={() => move(i, i + 1)}><ArrowDown size={14} /></button></div><span className="row-points">{i < 3 ? '+10' : '+5'}<small>exact</small></span></div>
    })}</div>
      <div className="mini-heading prop-heading"><div><h3>Race prop predictions</h3><p>Three bonus categories for race weekend.</p></div><Pill>20 points available</Pill></div><div className="prop-grid"><label>POLE POSITION<FieldHelp label="POLE POSITION" detail="Pick the driver who will set the fastest official Q3 lap, not necessarily the grid starter after penalties."/><Select value={props.pole ?? ''} onChange={v => setProps({...props, pole: v})} options={driverOptions} disabled={readOnly} /><small>Fastest official Q3 qualifier · +5</small></label><label>FASTEST RACE LAP<FieldHelp label="FASTEST RACE LAP" detail="Pick who will record the official fastest lap among classified race drivers."/><Select value={props.fastestLap ?? ''} onChange={v => setProps({...props, fastestLap: v})} options={driverOptions} disabled={readOnly} /><small>Fastest classified driver · +5</small></label><label>FIRST DNF<FieldHelp label="FIRST DNF" detail="Pick the first driver officially classified as retired or not classified; tied first retirements can score."/><Select value={props.firstDnf ?? ''} onChange={v => setProps({...props, firstDnf: v})} options={driverOptions} disabled={readOnly} /><small>First official retired / NC driver · +10</small></label></div></>}
    {(kind === 'sprint' || kind === 'unified') && <><div className="mini-heading prop-heading"><div><h3>Sprint predictions</h3><p>Three picks resolved from the Sprint session.</p></div><Pill>11 points available</Pill></div><div className="prop-grid"><label>SPRINT RACE WINNER<FieldHelp label="SPRINT RACE WINNER" detail="Pick the official winner of the Sprint session."/><Select value={sprintProps.winner ?? ''} onChange={v => kind === 'sprint' ? setProps({...props, winner: v}) : setSprint({...sprint, winner: v})} options={driverOptions} disabled={readOnly} /><small>Winner of Sprint · +5</small></label><label>TOP SPRINT CONSTRUCTOR<FieldHelp label="TOP SPRINT CONSTRUCTOR" detail="Pick the constructor scoring the most combined Sprint points."/><Select value={sprintProps.teamMostPoints ?? ''} onChange={v => kind === 'sprint' ? setProps({...props, teamMostPoints: v}) : setSprint({...sprint, teamMostPoints: v})} options={teamOptions} disabled={readOnly} /><small>Most combined Sprint points · +3</small></label><label>MOST PLACES GAINED<FieldHelp label="MOST PLACES GAINED" detail="Pick the driver who gains the most positions from their Sprint starting grid to the finish."/><Select value={sprintProps.mostGained ?? ''} onChange={v => kind === 'sprint' ? setProps({...props, mostGained: v}) : setSprint({...sprint, mostGained: v})} options={driverOptions} disabled={readOnly} /><small>Starting grid vs finishing place · +3</small></label></div></>}
    {error && <Notice kind="error">{error}</Notice>}<div className="editor-footer"><span><ShieldCheck size={16} /> Your choices are hidden from other players until the lock.</span><Action disabled={readOnly || drivers.length < 10} loading={saving} onClick={submit}><Save size={16} /> {existing ? 'Save new revision' : 'Submit predictions'}</Action></div>{existing && <p className="saved-note"><CheckCircle2 size={15} /> Revision {existing.version} saved {date(existing.submitted_at)}</p>}
  </div>;
}
