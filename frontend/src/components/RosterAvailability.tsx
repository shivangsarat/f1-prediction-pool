import {useState} from 'react';
import {Info, RefreshCw} from 'lucide-react';
import {Action} from '../shared/ui';

/**
 * Explain an OpenF1 driver's-roster delay without requiring commissioner setup.
 * A participant can retry, while the backend owns throttling and the UTC lock.
 */
export function RosterAvailability({loaded, onRetry}: {loaded: boolean; onRetry: () => Promise<void>}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');

  /** Ask the backend to refresh the season roster without bypassing rate limits. */
  async function retry() {
    setRetrying(true);
    setError('');
    try {
      await onRetry();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  return <div className="empty roster-availability" role="status">
    <Info size={24}/>
    {loaded ? <>
      <p>OpenF1 has not published a complete driver lineup for this season yet.</p>
      <p className="muted small">GRIDLOCK checks automatically when the tournament is opened. Once the lineup is available, the drivers and constructors appear here. Existing predictions are preserved.</p>
      <Action kind="outline" disabled={retrying} loading={retrying} onClick={() => void retry()}><RefreshCw size={16}/> Retry OpenF1 sync</Action>
      {error && <p className="muted small">{error}</p>}
    </> : <p>Loading this season’s drivers and constructors from OpenF1…</p>}
  </div>;
}
