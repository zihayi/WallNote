import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './planner.css';
import './components/layout-studio.css';

export async function render(root:HTMLElement,view:string) {
  const View=view==='manager'?(await import('./App')).default:view==='event-editor'?(await import('./components/DesktopEventEditor')).DesktopEventEditor:(await import('./DesktopView')).default;
  createRoot(root).render(<StrictMode><View/></StrictMode>);
}
