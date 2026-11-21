import React, {useCallback, useEffect, useState} from 'react';
import {FlagTriangleRight} from 'lucide-react';
import {get, post} from './api';
import {AuthScreen} from './pages/AuthScreen';
import {TournamentLobby, type Tournament} from './pages/TournamentLobby';
import {TournamentWorkspace} from './pages/TournamentWorkspace';

/** Manage the authenticated session and route into one explicitly chosen tournament. */
export function App() {

  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [active, setActive] = useState<Tournament | null>(null);
  const [error, setError] = useState('');

  /** Reload tournaments from the server so membership changes are authoritative. */
  const refresh = useCallback(async () => {

    try {
      setTournaments(await get<Tournament[]>('/tournaments'));
      setError('')
    }
    catch (e) {
      setError((e as Error).message)
    }
  }, []);

  /** Validate the HttpOnly session cookie instead of retaining an auth token in JavaScript. */
  useEffect(() => {

    get('/auth/me').then(setUser).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  /** Fetch accessible tournaments after login or registration. */
  useEffect(() => {
    if (user) void refresh(); else setTournaments([])
  }, [user, refresh]);

  /** Revoke the server session, then remove all tournament-scoped application state. */
  async function signOut() {

    try {
      await post('/auth/logout', {})
    } finally {
      setUser(null);
      setActive(null);
      setTournaments([])
    }
  }

  if (loading) return <div className="splash"><FlagTriangleRight size={40} /><strong>GRIDLOCK</strong><span>Loading race control...</span></div>;
  if (!user) return <AuthScreen onLogin={data => setUser(data.user)} />;
  if (active) return <TournamentWorkspace key={active.id} tournament={active} user={user} onExit={() => {
    setActive(null);
    void refresh()
  }} onSignOut={signOut} />;
  return <>{error && <div className="notice error">{error}</div>}<TournamentLobby user={user} tournaments={tournaments} onRefresh={refresh} onOpen={setActive} onSignOut={signOut} /></>;
}
