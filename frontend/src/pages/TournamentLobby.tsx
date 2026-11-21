import React, {useState} from 'react';
import {ArrowRight, Check, FlagTriangleRight, LogOut, Plus, Shield, Users} from 'lucide-react';
import {post} from '../api';
import {Action, Card, Notice, TextInput} from '../shared/ui';

/** Describe a tournament visible to a user through an explicit membership record. */
export type Tournament = {
  id: string;
  name: string;
  description: string;
  role: 'commissioner' | 'player';
  memberCount: number;
  created_at?: string;
};

/** Display all joined prediction pools and offer independent create/join actions. */
export function TournamentLobby({user, tournaments, onRefresh, onOpen, onSignOut}: {
  user: {display_name: string};
  tournaments: Tournament[];
  onRefresh: () => Promise<void>;
  onOpen: (t: Tournament) => void;
  onSignOut: () => void;
}) {

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [invite, setInvite] = useState('');
  const [newCode, setNewCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** Create a private tournament and show its one-time invitation code. */
  async function create(event: React.FormEvent) {

    event.preventDefault();
    setBusy(true);
    setError('');
    try {

      const created = await post<Tournament & {inviteCode: string}>('/tournaments', {name, description});
      setName('');
      setDescription('');
      setNewCode(created.inviteCode);
      await onRefresh();
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Join an existing tournament with a commissioner-issued invitation. */
  async function join(event: React.FormEvent) {

    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/tournaments/join', {inviteCode: invite.trim()});
      setInvite('');
      await onRefresh()
    }
    catch (error) {
      setError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return <div className="tournament-lobby">
    <header className="lobby-header">
      <div className="brand"><FlagTriangleRight size={28} /><strong>GRID<span>LOCK</span></strong></div>
      <div className="lobby-user"><span>{user.display_name}</span><Action kind="ghost" onClick={onSignOut}><LogOut size={17} /> Sign out</Action></div>
    </header>
    <main className="lobby-main">
      <div className="eyebrow">YOUR PADDOCK</div>
      <h1>Prediction tournaments</h1>
      <p className="muted">Organize parallel prediction pools. Each tournament has its own members, season, picks, standings, commissioner, and prize ledger.</p>
      {error && <Notice kind="error">{error}</Notice>}
      <section className="lobby-tournaments" aria-label="My tournaments">
        {tournaments.length ? tournaments.map(t => <button className="tournament-tile" key={t.id} onClick={() => onOpen(t)}>
          <div className="tile-icon"><FlagTriangleRight size={26} /></div><span className="eyebrow">{t.role === 'commissioner' ? 'COMMISSIONER' : 'PARTICIPANT'} ACCESS</span>
          <h2>{t.name}</h2><p>{t.description || 'F1 race weekend prediction pool'}</p>
          <div className="tile-bottom"><span><Users size={15} />{t.memberCount} members</span><span>Enter tournament <ArrowRight size={16} /></span></div>
        </button>) : <Card><div className="welcome-empty"><FlagTriangleRight size={36} /><h2>No tournaments yet</h2><p>Create your own pool or join an existing one with an invitation code.</p></div></Card>}
      </section>
      <div className="lobby-forms">
        <Card><form onSubmit={create}><h2><Plus size={20} /> Create a tournament</h2><p className="muted">You automatically become its commissioner.</p>
          <TextInput label="TOURNAMENT NAME" value={name} onChange={setName} placeholder="2027 Friends Championship" />
          <TextInput label="DESCRIPTION (OPTIONAL)" value={description} onChange={setDescription} placeholder="Weekend prediction challenge" />
          <Action type="submit" disabled={busy || name.trim().length < 3}>Create tournament <ArrowRight size={16} /></Action>
        </form></Card>
        <Card><form onSubmit={join}><h2><Shield size={20} /> Join a tournament</h2><p className="muted">Ask the tournament commissioner for their invitation code.</p>
          <TextInput label="INVITATION CODE" value={invite} onChange={setInvite} placeholder="Paste invite code" />
          <Action type="submit" disabled={busy || invite.trim().length < 20}>Join tournament <ArrowRight size={16} /></Action>
        </form></Card>
      </div>
      {newCode && <Card><Notice kind="success"><Check size={16} /> Tournament created. Save this invitation code now; the server stores only its hash.</Notice>
        <div className="invite-reveal"><code>{newCode}</code><Action kind="outline" onClick={() => navigator.clipboard.writeText(newCode)}>Copy code</Action><Action kind="ghost" onClick={() => setNewCode('')}>Dismiss</Action></div>
      </Card>}
    </main>
  </div>;
}
