import {useCallback, useEffect, useState} from 'react';
import {FlagTriangleRight} from 'lucide-react';
import {get, post} from './api';
import {AuthScreen} from './pages/AuthScreen';
import {TournamentCatalogue, type PublicTournament} from './pages/TournamentCatalogue';
import {TournamentLobby, type Tournament} from './pages/TournamentLobby';
import {TournamentWorkspace} from './pages/TournamentWorkspace';
import {Notice} from './shared/ui';

/** Parse an invitation deep link, retaining it in the address bar until login succeeds. */
export function invitationFromUrl(): string | null {
  const value = new URLSearchParams(window.location.search).get('invite');
  return value && /^[A-Za-z0-9_-]{32}$/.test(value) ? value : null;
}

/** Remove a consumed deep-link parameter without navigating away or losing other URL state. */
function removeUrlParameter(key: string): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(key);
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/** Authenticate once and then navigate between catalogue, lobby, and scoped workspaces. */
export function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [active, setActive] = useState<Tournament | null>(null);
  const [catalogue, setCatalogue] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [invitation, setInvitation] = useState(invitationFromUrl);
  const [pendingPublic, setPendingPublic] = useState(new URLSearchParams(window.location.search).get('public'));

  /** Reload only the caller's tournament memberships, except for a global operator. */
  const refresh = useCallback(async () => {
    try {setTournaments(await get<Tournament[]>('/tournaments')); setError('');}
    catch (e) {setError((e as Error).message);}
  }, []);

  /** Validate the durable HttpOnly session and, optionally, a received email verification link. */
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('verify');
    const verify = token ? get<{verified: boolean}>(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(() => setNotice('Email verified. Official tournament notifications can now be delivered.'))
      .catch(() => setNotice('The verification link is invalid or has expired.'))
      .finally(() => removeUrlParameter('verify')) : Promise.resolve();
    verify.finally(() => get('/auth/me').then(setUser).catch(() => setUser(null)).finally(() => setLoading(false)));
  }, []);

  /** After login, process any public or secret joining deep link and open its tournament directly. */
  useEffect(() => {
    if (!user) {setTournaments([]); return;}
    let cancelled = false;
    const enter = async () => {
      try {
        const list = await get<Tournament[]>('/tournaments');
        if (cancelled) return;
        setTournaments(list);
        if (invitation) {
          const joined = await post<Tournament>('/tournaments/join', {inviteCode: invitation});
          if (cancelled) return;
          setActive(joined); setInvitation(null); removeUrlParameter('invite');
          void refresh(); return;
        }
        if (pendingPublic) {
          const joined = await post<Tournament>('/tournaments/join-public', {tournamentId: pendingPublic});
          if (cancelled) return;
          setActive(joined); setPendingPublic(null); removeUrlParameter('public');
          void refresh(); return;
        }
        const requestedId = new URLSearchParams(window.location.search).get('tournament');
        const requested = list.find(t => t.id === requestedId);
        if (requested) setActive(requested);
      } catch (e) {if (!cancelled) setError((e as Error).message);}
    };
    void enter();
    return () => {cancelled = true;};
  }, [user, invitation, pendingPublic, refresh]);

  /** Sign out from the server and discard all tournament-specific client data. */
  async function signOut() {
    try {await post('/auth/logout', {});} finally {
      setUser(null); setActive(null); setTournaments([]); setCatalogue(false);
    }
  }

  /** Enter a public tournament, or preserve the target across login/registration. */
  async function joinPublic(tournament: PublicTournament) {
    if (!user) {
      const url = new URL(window.location.href);
      url.searchParams.set('public', tournament.id);
      window.history.replaceState(null, '', url.pathname + url.search);
      setPendingPublic(tournament.id);
      setCatalogue(false);
      return;
    }
    const joined = await post<Tournament>('/tournaments/join-public', {tournamentId: tournament.id});
    setActive(joined); setCatalogue(false);
    await refresh();
  }

  /** Make the currently opened competition addressable through non-secret email links. */
  function openTournament(tournament: Tournament) {
    setActive(tournament);
    const url = new URL(window.location.href);
    url.searchParams.set('tournament', tournament.id);
    window.history.replaceState(null, '', url.pathname + url.search);
  }

  /** Return from a tournament without retaining its sensitive state. */
  function exitTournament() {
    setActive(null); removeUrlParameter('tournament'); void refresh();
  }

  if (loading) return <div className="splash"><FlagTriangleRight size={40}/><strong>GRIDLOCK</strong><span>Loading race control…</span></div>;
  if (catalogue) return <TournamentCatalogue signedIn={!!user} onJoin={joinPublic} onBack={() => setCatalogue(false)}/>;
  if (!user) return <><AuthScreen invitation={!!invitation || !!pendingPublic} onBrowse={() => setCatalogue(true)} onLogin={data => setUser(data.user)}/>{notice && <div className="floating-notice"><Notice>{notice}</Notice></div>}</>;
  if (active) return <TournamentWorkspace key={active.id} tournament={active} user={user} onExit={exitTournament} onSignOut={signOut}/>;
  return <>{(error || notice) && <div className="floating-notice"><Notice kind={error ? 'error' : 'success'}>{error || notice}</Notice></div>}
    <TournamentLobby user={user} tournaments={tournaments} onRefresh={refresh} onOpen={openTournament} onSignOut={signOut} onCatalogue={() => setCatalogue(true)}/>
  </>;
}
