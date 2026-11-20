import { lazy, Suspense } from 'react';
import { isModule } from '../shared/snap-layout';
import { useAppState } from './use-app-state';
import { ModulePanel } from './module-views';

const Workspace=lazy(()=>import('./components/Desktop').then(m=>({default:m.PlannerWorkspace})));
export default function DesktopView() {
  const {state,loadError}=useAppState();
  if(loadError)return <p role="alert">{loadError}</p>;
  if(!state)return null;
  const params=new URLSearchParams(location.search);
  if(params.has('workspace'))return <Suspense fallback={null}><Workspace state={state} standalone/></Suspense>;
  const noteId=params.get('note')??undefined;
  const id=noteId||params.get('widget')==='notes-empty'?'notes':params.get('widget');
  return isModule(id)?<ModulePanel id={id} noteId={noteId} state={state} desktop/>:<p role="alert">找不到这个模块</p>;
}
