import {useEffect, useState} from 'react';
import {Bell, MailCheck} from 'lucide-react';
import {get, patch, post} from '../api';
import {Action, Card, Notice, FieldHelp} from '../shared/ui';

/** Allow the current account to verify its email and opt out of event notifications. */
export function NotificationSettings() {
  const [verified, setVerified] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [available, setAvailable] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  /** Read the user's private notification preferences and public delivery availability. */
  useEffect(() => {
    void Promise.all([get<{emailVerified: boolean; notificationOptIn: boolean}>('/auth/me'), get<{available: boolean}>('/email/capabilities')])
      .then(([user, email]) => {setVerified(user.emailVerified); setEnabled(user.notificationOptIn); setAvailable(email.available);})
      .catch(e => setError(e.message));
  }, []);

  /** Request a short-lived one-time verification email with abuse protection on the server. */
  async function verify() {
    try {await post('/account/verification-email', {}); setMessage('Verification email queued. Check your inbox.'); setError('');}
    catch (e) {setError((e as Error).message);}
  }

  /** Persist each account's event-email preference without affecting its pool memberships. */
  async function update(checked: boolean) {
    try {await patch('/account/notifications', {enabled: checked}); setEnabled(checked); setMessage('Notification preference saved.'); setError('');}
    catch (e) {setError((e as Error).message);}
  }

  return <Card><h3><Bell size={18}/> Official notifications</h3>
    <p className="muted">Receipts, invitations, deadline reveals, published results, and final standings are sent to verified emails when a mail provider is configured.</p>
    {!available && <Notice>Email sending is not configured by the platform operator yet. All tournament features still work without it.</Notice>}
    {available && !verified && <div className="invitation-row"><span>Verify your email to receive official notifications.</span><Action kind="outline" onClick={() => void verify()}><MailCheck size={15}/> Verify email</Action></div>}
    <label className="notification-opt-in"><input type="checkbox" checked={enabled} onChange={e => void update(e.target.checked)}/> Email me tournament updates <FieldHelp label="Email me tournament updates" detail="Receive opt-in messages about invitations, submissions, locks, race results and standings after verifying your email. Turning it off does not affect gameplay."/></label>
    {error && <Notice kind="error">{error}</Notice>}
    {message && <Notice kind="success">{message}</Notice>}
  </Card>;
}
