import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './planner.css';

const query = new URLSearchParams(location.search);
if (window.wallnote && (query.has('widget') || query.has('note'))) document.documentElement.dataset.widgetMotion ??= 'staged';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
