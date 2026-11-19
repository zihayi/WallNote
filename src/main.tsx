import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { DesktopEventEditor } from './components/DesktopEventEditor';
import './styles.css';
import './planner.css';

const query = new URLSearchParams(location.search);
if (window.wallnote && (query.has('widget') || query.has('note'))) document.documentElement.dataset.widgetMotion ??= 'staged';
const eventWindow = !!window.wallnote && query.get('editor') === 'event';
if (eventWindow) document.documentElement.dataset.view = 'event-editor';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{eventWindow ? <DesktopEventEditor /> : <App />}</React.StrictMode>);
