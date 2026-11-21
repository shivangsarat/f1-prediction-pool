import {useCallback, useEffect, useMemo, useState} from 'react';
import {Activity, ArrowLeft, ChevronRight, Crown, FlagTriangleRight, Info, LogOut, Menu, Shield, Target, Trophy, Users, Wallet, X, BookOpen} from 'lucide-react';
import {get, post} from '../api';
import {Action, Card, Notice, type View} from '../shared/ui';
import {Overview} from './Overview';
import {PicksPage} from './PicksPage';
import {StandingsPage} from './StandingsPage';
import {ChampionshipPage} from './ChampionshipPage';
import {LedgerPage} from './LedgerPage';
import {RulesPage} from './RulesPage';
import {AdminPage} from './AdminPage';
import type {Tournament} from './TournamentLobby';
import {TournamentManagement} from '../components/TournamentManagement';

const NAV = [
  {key: 'overview', label: 'Race HQ', icon: Activity},
  {key: 'picks', label: 'My Predictions', icon: Target},
  {key: 'standings', label: 'Leaderboard', icon: Trophy},
  {key: 'championship', label: 'Championship', icon: Crown},
  {key: 'ledger', label: 'Prize Pool', icon: Wallet},
  {key: 'rules', label: 'Tournament Rules', icon: BookOpen},
  {key: 'admin', label: 'Commissioner', icon: Shield},
] as const;

/** Keep all season, round, roster, prediction, and ledger views within one tournament. */
export function TournamentWorkspace({tournament, user, onExit, onSignOut}: {
  tournament: Tournament; user: any; onExit: () => void; onSignOut: () => Promise<void>;
}) {

  const [seasons, setSeasons] = useState<any[]>([]), [activeId, setActiveId] = useState('');
  const [view, setView] = useState<View>('overview');
  const [weekends, setWeekends] = useState<any[]>([]), [roster, setRoster] = useState<any[]>([]);
  const [rosterLoadedFor, setRosterLoadedFor] = useState('');
  const [standings, setStandings] = useState<any[]>([]), [members, setMembers] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any>(null), [error, setError] = useState('');
  const [toastText, setToastText] = useState(''), [navOpen, setNavOpen] = useState(false);
  const [managedTournament, setManagedTournament] = useState(tournament);
  const commissioner = tournament.role === 'commissioner' || tournament.role === 'operator';
  const season = seasons.find(s => s.id === activeId);
  const activeRoster = rosterLoadedFor === activeId ? roster : [];
  const teams = useMemo(() => [...new Map(activeRoster.map(d => [d.team_id, {id: d.team_id, name: d.team_name}])).values()], [activeRoster]);

  /** Present nonpersistent notifications about server operations. */
  function toast(message: string) {
    setToastText(message)
  }

  /** Load only season records belonging to the opened tournament. */
  const reloadSeasons = useCallback(async () => {

    try {

      const data = await get<any[]>(`/seasons?tournamentId=${tournament.id}`);
      setSeasons(data);
      setActiveId(previous => data.some(s => s.id === previous) ? previous : data[0]?.id ?? '');
    } catch (e) {
      setError((e as Error).message)
    }
  }, [tournament.id]);

  /** Load tournament members for membership display and commissioner transactions. */
  const reloadMembers = useCallback(async () => {

    try {
      setMembers(await get<any[]>(`/tournaments/${tournament.id}/members`))
    }
    catch (e) {
      setError((e as Error).message)
    }
  }, [tournament.id]);

  /** Get current season data; do not share stale results when switching seasons. */
  const refresh = useCallback(async () => {

    if (!activeId) {
      setWeekends([]);
      setRoster([]);
      setRosterLoadedFor('');
      setStandings([]);
      setLedger(null);
      return
    }
    try {

      const [w, r, s, l] = await Promise.all([
        get<any[]>(`/weekends?seasonId=${activeId}`),
        get<any[]>(`/roster?seasonId=${activeId}`),
        get<any[]>(`/standings?seasonId=${activeId}`),
        get(`/ledger?seasonId=${activeId}`),
      ]);
      setWeekends(w);
      setRoster(r);
      setRosterLoadedFor(activeId);
      setStandings(s);
      setLedger(l);
      setError('')
    }
    catch (e) {
      setError((e as Error).message)
    }
  }, [activeId]);

  /** Allow any enrolled player to retry the globally cached season roster import. */
  const retryRoster = useCallback(async (): Promise<void> => {
    if (!activeId) return;
    const synced = await post<{status: string; count: number; added: number; drivers: any[]; message?: string}>(
      '/roster/sync', {seasonId: activeId});
    setRoster(synced.drivers);
    setRosterLoadedFor(activeId);
    toast(synced.count >= 10 ? `${synced.count} drivers ready for this season.` :
      synced.message ?? 'Driver lineup is not available yet; retry after OpenF1 publishes it.');
  }, [activeId]);

  useEffect(() => {
    void reloadSeasons();
    void reloadMembers()
  }, [reloadSeasons, reloadMembers]);
  useEffect(() => {
    void refresh()
  }, [refresh]);

  /** Switch local tournament navigation without changing the server permissions. */
  function navigate(next: View) {
    setView(next);
    setNavOpen(false)
  }

  return <div className="app-shell">
    <aside className={'sidebar ' + (navOpen ? 'open' : '')}>
      <div className="brand"><FlagTriangleRight size={28} /><strong>GRID<span>LOCK</span></strong><button className="nav-close" onClick={() => setNavOpen(false)} aria-label="Close navigation"><X size={20} /></button></div>
      <div className="sidebar-group"><div className="sidebar-caption">{tournament.name}</div>
        <button className="nav-item" onClick={onExit}><ArrowLeft size={18} /> All tournaments</button>
        <nav>{NAV.filter(item => item.key !== 'admin' || commissioner).map(({key, label, icon: Icon}) => <button key={key} className={'nav-item ' + (view === key ? 'active' : '')} onClick={() => navigate(key)}>
          <Icon size={18} />{label}{view === key && <div className="nav-active-dot" />}
        </button>)}</nav>
      </div>
      <div className="sidebar-bottom"><div className="help-card"><Users size={22} /><strong>{tournament.memberCount} members</strong><span>{commissioner ? 'You manage this tournament.' : 'Tournament participant'}</span></div>
        <div className="user-card"><div className="user-avatar">{user.display_name.slice(0, 2).toUpperCase()}</div><div><strong>{user.display_name}</strong><small>{tournament.role}</small></div>
          <button onClick={onSignOut} title="Sign out"><LogOut size={18} /></button></div></div>
    </aside>
    <main className="main"><header className="topbar"><div className="topbar-left"><button className="mobile-menu" onClick={() => setNavOpen(true)} aria-label="Open navigation"><Menu size={22} /></button>
      <span className="breadcrumbs">GRIDLOCK <ChevronRight size={14} /> <b>{tournament.name}</b> <ChevronRight size={14} />{NAV.find(item => item.key === view)?.label}</span></div>
      <div className="topbar-right"><select aria-label="Tournament season" className="season-select" value={activeId} onChange={e => setActiveId(e.target.value)}>
        <option value="" disabled>Select season</option>{seasons.map(s => <option value={s.id} key={s.id}>{s.year} Season</option>)}
      </select><div className="top-avatar">{user.display_name.slice(0, 2).toUpperCase()}</div></div></header>
      <div className="page-content">
        {error && <Notice kind="error">{error}</Notice>}
        {!season && view !== 'admin' ? <Card><div className="welcome-empty"><FlagTriangleRight size={42} /><h2>No season configured yet</h2>
          <p>This tournament is ready. Its commissioner can create a season and configure the driver roster and calendar.</p>
          {commissioner && <Action onClick={() => navigate('admin')}>Open commissioner setup</Action>}
        </div></Card> : <>
          {view === 'overview' && season && <Overview season={season} weekends={weekends} standings={standings} ledger={ledger} user={user} navigate={navigate} />}
          {view === 'picks' && season && <PicksPage season={season} weekends={weekends} drivers={activeRoster} teams={teams} user={user} toast={toast}
            rosterLoaded={rosterLoadedFor === activeId} onRosterRetry={retryRoster} />}
          {view === 'standings' && season && <StandingsPage season={season} standings={standings} weekends={weekends} />}
          {view === 'ledger' && season && <LedgerPage season={season} ledger={ledger} standings={standings} />}
          {view === 'championship' && season && <ChampionshipPage season={season} drivers={activeRoster} teams={teams} user={user} toast={toast} />}
          {view === 'rules' && season && <RulesPage season={season} />}
        </>}
        {view === 'admin' && commissioner && <>
          <TournamentManagement tournament={managedTournament} onChanged={setManagedTournament}/>
          <AdminPage season={season} seasons={seasons} weekends={weekends} users={members.map(m => ({userId: m.id, name: m.display_name}))}
            refresh={() => {
              void refresh();
              void reloadSeasons();
              void reloadMembers()
            }} toast={toast} tournamentId={tournament.id} isOperator={user.role === 'admin'} />
        </>}
        <footer className="footer"><div><FlagTriangleRight size={16} /> GRIDLOCK <span>{managedTournament.name}</span></div><span>Unofficial fan project. Not affiliated with Formula 1 or FIA.</span></footer>
      </div>
    </main>
    {toastText && <div className="toast" role="status"><Info size={18} />{toastText}<button onClick={() => setToastText('')} aria-label="Dismiss"><X size={15} /></button></div>}
  </div>;
}
