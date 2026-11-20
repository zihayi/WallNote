import { modules } from '../shared/modules';
import type { Action } from '../shared/types';
import type { RendererView } from '../shared/renderer-state';

// New panels get pin/close only. Domain edits must be granted explicitly.
export function widgetAllows(kind:Exclude<RendererView,'main'>,key:string,action:Action):boolean {
  if(kind==='wallpaper')return false;
  const id=kind==='note'||kind==='notes-empty'?'notes':kind;
  if(action.type==='widget:topmost')return action.key===id;
  if(kind==='note')return action.type==='note:selectDesktop' || (action.type==='note:update' && action.id===key.slice(5));
  if(action.type==='settings:update'){
    const flag=modules[id].flag;
    return Object.keys(action.changes).length===1 && action.changes[flag]===false;
  }
  if(kind==='calendar'||kind==='schedule')return action.type==='calendar:select'||action.type.startsWith('event:');
  if(kind==='tasks')return action.type.startsWith('task:');
  return kind==='notes-empty' && action.type==='note:add';
}
