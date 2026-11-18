import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Grip, Pin, Settings, X } from 'lucide-react';
import { allWallpapers } from '../../shared/state';
import type { AppState, DesktopSurface } from '../../shared/types';
import { api, blurredWallpaperURL, errorMessage, isDesktop, wallpaperURL } from '../api';
import { beginDesktopManipulation } from './desktop-input';

export function FrostedPanel({ state, title, widgetKey, icon, children, desktop = false, className = '', onClose, actions }: {
  state: AppState; title: string; widgetKey: string; icon?: ReactNode; children: ReactNode; desktop?: boolean; className?: string; onClose?: () => void; actions?: ReactNode;
}) {
  const [surface, setSurface] = useState<DesktopSurface | null>(null);
  const [pinIntent, setPinIntent] = useState<boolean | null>(null);
  const changing = useRef(false);
  const [pinError, setPinError] = useState('');
  const topmost = surface?.topmost ?? (state.settings.topmostWidgets ?? []).includes(widgetKey);
  const togglePin = async () => {
    if (changing.current) return;
    changing.current = true; setPinIntent(!topmost);
    try { await api.dispatch({ type: 'widget:topmost', key: widgetKey, enabled: !topmost }); setPinError(''); }
    catch (error) { setPinError(errorMessage(error)); }
    finally { changing.current = false; setPinIntent(null); }
  };
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
  const sceneStyle = surface ? { left: surface.display.x - surface.bounds.x, top: surface.display.y - surface.bounds.y, width: surface.display.width, height: surface.display.height, backgroundImage: `url("${wallpaperURL(current)}")` } : undefined;
  const panel = <section className={`frost-panel ${desktop ? 'native-panel' : ''} ${topmost ? 'is-topmost' : ''} ${state.settings.glassEnabled === false ? 'solid-panel' : ''} ${className}`} aria-label={title} onPointerDownCapture={() => { if (desktop) api.focusDesktopWidget(); }}>
    {surface && state.settings.glassEnabled !== false && <div className="frost-scene" aria-hidden="true" style={{ ...sceneStyle, backgroundImage: `url("${blurredWallpaperURL(current)}")` }} />}
    <div className="frost-tint" aria-hidden="true" />
    <header className={`frost-header ${desktop ? 'floating-drag' : ''}`} title={desktop ? topmost ? '拖动以移动组件' : '点击图钉置顶后可移动和调整大小' : undefined} onPointerDown={event => { if (desktop && topmost) beginDesktopManipulation(event, 'move'); }}>
      <div className="frost-title">{desktop && topmost ? <Grip size={15} /> : icon}<h2>{title}</h2></div>
      <div className="frost-header-actions">{actions}<button className={`icon-button widget-pin ${(pinIntent ?? topmost) ? 'active' : ''}`} aria-label={`置顶${title}`} aria-pressed={topmost} aria-busy={pinIntent !== null} aria-disabled={pinIntent !== null} title={pinIntent !== null ? pinIntent ? '正在置顶…' : '正在返回桌面…' : topmost ? '取消置顶，返回图标下方' : '置于所有窗口上方'} onClick={() => void togglePin()}><Pin size={14} /></button>{desktop && <button className="icon-button" aria-label="打开管理面板" title="管理面板" onClick={() => void api.desktopControl('showManager')}><Settings size={15} /></button>}{onClose && <button className="icon-button" aria-label={`收起${title}`} onClick={onClose}><X size={16} /></button>}</div>
    </header>
    {children}
    {pinError && <p className="widget-error" role="alert">{pinError}</p>}
    {desktop && topmost && <button className="desktop-resize-handle" aria-label={`拖动调整${title}大小`} onPointerDown={event => beginDesktopManipulation(event, 'resize')} />}
  </section>;
  if (!desktop) return panel;
  // WorkerW child windows can flatten per-pixel alpha into a rectangular surface. In that
  // layer, paint the matching, unblurred wallpaper underneath the rounded card. This keeps
  // the edge anti-aliased without depending on child-window alpha or a jagged GDI region.
  // Floating windows additionally clip the native HWND to this silhouette. Surface metadata follows the native layer,
  // so a pin/unpin transition cannot briefly use the wrong composition mode.
  const embedded = surface ? !surface.topmost : !topmost;
  return <div className={`native-widget-root ${embedded ? 'desktop-composite' : 'floating-composite'}`}>
    {embedded && surface && <div className="desktop-corner-underlay" aria-hidden="true"><div className="desktop-corner-scene" style={sceneStyle} /></div>}
    {panel}
  </div>;
}
