import { createRoot } from 'react-dom/client';
import Workspace from './app/workspace';
import './app/globals.css';
import './app/reference-theme.css';
import './app/portal-theme.css';
import './app/red-accents.css';
import './app/training-theme.css';
createRoot(document.getElementById('root')!).render(<Workspace />);
