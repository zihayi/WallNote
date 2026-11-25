import type { AppState } from '../../shared/types';
import { visibleModule, type ModuleId } from '../../shared/modules';
import { currentWallpaper, wallpaperURL } from '../../shared/wallpapers';
import { ModulePanel } from '../module-views';
import { SpatialPreview } from './LayoutStudio';

export function PlannerWorkspace({ state, standalone = false }: { state: AppState; standalone?: boolean }) {
  const wallpaper=currentWallpaper(state,!standalone);
  const panel=(id:ModuleId|null)=>id ? <ModulePanel id={id} state={state} showPhoneLink={false}/> : <div className="workspace-empty-slot" aria-label="空模块位置"/>;
  const custom=!!(state.settings.canvasModules||state.settings.dockFrames)||state.settings.moduleDisplayId!==undefined;
  return <div className={`planner-workspace ${standalone ? 'standalone-workspace' : ''} ${custom?'spatial-workspace':''}`} style={{ backgroundImage: `url("${wallpaperURL(wallpaper)}")` }}>
    {custom ? <SpatialPreview state={state} panel={panel} standalone={standalone}/> : <div className="planner-workspace-grid">{panel(visibleModule(state.settings,'left'))}{panel(visibleModule(state.settings,'center'))}<div className="workspace-right">{panel(visibleModule(state.settings,'upper'))}{panel(visibleModule(state.settings,'lower'))}</div></div>}
  </div>;
}
