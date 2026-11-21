import {createRoot} from 'react-dom/client';
import {App} from './App';
import './styles.css';

/** Mount the Gridlock application once into the standalone frontend document. */
createRoot(document.getElementById('root')!).render(<App />);
