import {useEffect, useState} from 'react';
import {Check, Mail, X} from 'lucide-react';
import {get, post} from '../api';
import {Action, Card, Notice} from '../shared/ui';
import type {Tournament} from '../pages/TournamentLobby';

/** An invitation is visible only to the invited account, not every tournament participant. */
type Invitation = {id: string; tournament_id: string; name: string; created_at: string};

/** Display incoming in-app invitations with explicit accept/decline decisions. */
export function InvitationsPanel({onAccepted}: {onAccepted: (t: Tournament) => Promise<void>}) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /** Refresh invitations after opening the lobby. */
  useEffect(() => {void get<Invitation[]>('/invitations').then(setInvitations).catch(e => setError(e.message));}, []);

  /** Accept/decline an invitation without exposing invitation details to others. */
  async function respond(invite: Invitation, action: 'accept' | 'decline') {
    setBusy(true);
    try {
      const joined = await post<Tournament | {status: string}>(`/invitations/${invite.id}/respond`, {action});
      setInvitations(previous => previous.filter(item => item.id !== invite.id));
      if (action === 'accept') await onAccepted(joined as Tournament);
    } catch (e) {setError((e as Error).message);}
    finally {setBusy(false);}
  }

  if (!invitations.length && !error) return null;
  return <Card><h2><Mail size={19} /> Tournament invitations</h2>
    {error && <Notice kind="error">{error}</Notice>}
    {invitations.map(invite => <div className="invitation-row" key={invite.id}>
      <span>{invite.name}</span>
      <Action disabled={busy} onClick={() => void respond(invite, 'accept')}><Check size={15}/> Accept</Action>
      <Action kind="ghost" disabled={busy} onClick={() => void respond(invite, 'decline')}><X size={15}/> Decline</Action>
    </div>)}
  </Card>;
}
