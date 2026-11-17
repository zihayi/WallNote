import { useEffect, useState, type ReactNode } from 'react';
import { Grip, Settings, X } from 'lucide-react';
import { allWallpapers } from '../../shared/state';
import type { AppState, DesktopSurface } from '../../shared/types';
import { api, isDesktop, wallpaperURL } from '../api';
import { beginDesktopManipulation } from './desktop-input';

export function FrostedPanel({ state, title, icon, children, desktop = false, className = '', onClose, actions }: {
  state: AppState; title: string; icon?: ReactNode; children: ReactNode; desktop?: boolean; className?: string; onClose?: () => void; actions?: ReactNode;
}) {
  const [surface, setSurface] = useState<DesktopSurface | null>(null);
  useEffect(() => {
    if (!desktop || !isDesktop) return;
    let alive = true;
    let revision = 0;
    const stop = api.onDesktopSurface(next => { revision += 1; if (alive) setSurface(next); });
    void api.getDesktopSurface().then(next => { if (alive && !revision) setSurface(next); }).catch(() => undefined);
    return () => { alive = false; stop(); };
  }, [desktop]);
  const wallpapers = allWallpapers(state);
  const current = wallpapers.find(w => w.id === state.appliedWallpaperId) ?? wallpapers.find(w => w.id === state.selectedWallpaperId) ?? wallpapers[0];
  return <section className={`frost-panel ${desktop ? 'native-panel' : ''} ${state.settings.glassEnabled === false ? 'solid-panel' : ''} ${className}`} aria-label={title} onPointerDownCapture={() => { if (desktop) api.focusDesktopWidget(); }}>
    {surface && state.settings.glassEnabled !== false && <div className="frost-scene" aria-hidden="true" style={{ left: surface.display.x - surface.bounds.x, top: surface.display.y - surface.bounds.y, width: surface.display.width, height: surface.display.height, backgroundImage: `url("${wallpaperURL(current)}")` }} />}
    <div className="frost-tint" aria-hidden="true" />
    <header className={`frost-header ${desktop ? 'floating-drag' : ''}`} onPointerDown={event => { if (desktop) beginDesktopManipulation(event, 'move'); }}>
      <div className="frost-title">{desktop ? <Grip size={15} /> : icon}<h2>{title}</h2></div>
      <div className="frost-header-actions">{actions}{desktop && <button className="icon-button" aria-label="打开管理面板" title="管理面板" onClick={() => void api.desktopControl('showManager')}><Settings size={15} /></button>}{onClose && <button className="icon-button" aria-label={`收起${title}`} onClick={onClose}><X size={16} /></button>}</div>
    </header>
    {children}
    {desktop && <button className="desktop-resize-handle" aria-label={`拖动调整${title}大小`} onPointerDown={event => beginDesktopManipulation(event, 'resize')} />}
  </section>;
}
