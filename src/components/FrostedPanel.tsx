import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Grip, Pin, Settings, X } from 'lucide-react';
import { currentWallpaper } from '../../shared/wallpapers';
import type { AppState, DesktopSurface } from '../../shared/types';
import { api, blurredWallpaperURL, errorMessage, isDesktop, wallpaperURL } from '../api';
import { beginDesktopManipulation } from './desktop-input';
import { NativeGuides } from './LayoutGuides';
import { resizeHandles } from './resize-handles';

export function FrostedPanel({ state, title, widgetKey, icon, children, desktop = false, className = '', style, onClose, actions }: {
  state: AppState; title: string; widgetKey: string; icon?: ReactNode; children: ReactNode; desktop?: boolean; className?: string; style?: CSSProperties; onClose?: () => void; actions?: ReactNode;
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
    const offError=api.onLayoutSaveError(()=>setPinError('布局未能保存，请检查数据目录后重试。'));
    void api.getDesktopSurface().then(next => { if (alive && !revision) setSurface(next); }).catch(() => undefined);
    return () => { alive = false; stop(); offError(); };
  }, [desktop]);
  const current = currentWallpaper(state);
  const sceneStyle = surface ? { left: surface.display.x - surface.bounds.x, top: surface.display.y - surface.bounds.y, width: surface.display.width, height: surface.display.height, backgroundImage: `url("${wallpaperURL(current)}")` } : undefined;
  const panel = <section className={`frost-panel ${desktop ? 'native-panel' : ''} ${topmost ? 'is-topmost' : ''} ${state.settings.glassEnabled === false ? 'solid-panel' : ''} ${className}`} style={style} aria-label={title} onContextMenu={event => { if (!(event.target as Element).closest('input,textarea')) event.preventDefault(); }}>
    {surface && state.settings.glassEnabled !== false && <div className="frost-scene" aria-hidden="true" style={{ ...sceneStyle, backgroundImage: `url("${blurredWallpaperURL(current)}")` }} />}
    <div className="frost-tint" aria-hidden="true" />
    <header className={`frost-header ${desktop ? 'floating-drag' : ''}`} title={desktop ? '拖动标题栏移动并吸附；按住 Alt 开始拖动可自由摆放' : undefined} onPointerDown={event => { if (desktop) beginDesktopManipulation(event, 'move'); }}>
      <div className="frost-title">{desktop && topmost ? <Grip size={15} /> : icon}<h2>{title}</h2></div>
      <div className="frost-header-actions">{actions}<button className={`icon-button widget-pin ${(pinIntent ?? topmost) ? 'active' : ''}`} aria-label={`置顶${title}`} aria-pressed={topmost} aria-busy={pinIntent !== null} aria-disabled={pinIntent !== null} title={pinIntent !== null ? pinIntent ? '正在置顶…' : '正在返回桌面…' : topmost ? '取消置顶，返回图标下方' : '置于所有窗口上方'} onClick={() => void togglePin()}><Pin size={14} /></button>{desktop && <button className="icon-button" aria-label="打开管理面板" title="管理面板" onClick={() => void api.desktopControl('showManager')}><Settings size={15} /></button>}{onClose && <button className="icon-button" aria-label={`收起${title}`} onClick={onClose}><X size={16} /></button>}</div>
    </header>
    {children}
    {pinError && <p className="widget-error" role="alert">{pinError}</p>}
    {desktop && resizeHandles.map(({mode,label})=><button key={mode} tabIndex={-1} className={`module-grip grip-${mode}${mode==='resize'?' desktop-resize-handle':''}`} title={label} aria-label={mode==='resize'?`拖动调整${title}大小`:`${label}：${title}`} onPointerDown={event => beginDesktopManipulation(event, mode)} />)}
    {desktop && <NativeGuides bounds={surface?.bounds}/>}
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
