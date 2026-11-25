import { useEffect, useRef, useState } from 'react';
import { Monitor } from 'lucide-react';
import { displayName, groupDisplayId } from '../../shared/display-switch';
import type { LayoutDisplay } from '../../shared/snap-layout';
import type { AppState } from '../../shared/types';
import { api, errorMessage } from '../api';

export function useDisplays() {
  const [displays,set]=useState<LayoutDisplay[]>([]), [error,fail]=useState('');
  useEffect(()=>{
    let live=true,revision=0;
    const receive=(d:LayoutDisplay[])=>{set(d);fail('');};
    const refresh=()=>{
      const n=++revision;
      void api.getLayoutDisplays().then(d=>{if(live && n===revision)receive(d);}).catch(e=>{if(live && n===revision)fail(errorMessage(e));});
    };
    const off=api.onLayoutDisplaysChange(d=>{revision++;if(live)receive(d);});
    refresh();window.addEventListener('focus',refresh);
    return()=>{live=false;off();window.removeEventListener('focus',refresh);};
  },[]);
  return {displays,error};
}

/** Unlike the layout canvas' preview picker, this moves the real desktop windows. */
export function DisplaySwitch({settings,onError}:{settings:AppState['settings'];onError:(message:string)=>void}) {
  const {displays,error}=useDisplays();
  const [pending,setPending]=useState<number|null>(null),busy=useRef(false);
  async function move(id:number){
    if(busy.current)return;
    busy.current=true;setPending(id);
    try {await api.switchModuleDisplay(id);} catch(e){onError(errorMessage(e));}
    finally{busy.current=false;setPending(null);}
  }
  if(error)return <span role="alert" className="widget-error">{error}</span>;
  if(displays.length<2)return null;
  const current=groupDisplayId(settings,displays);
  return <label className="screen-switch" title="将整组桌面组件移到所选屏幕"><Monitor size={15}/>切换屏幕
    <select aria-label="切换组件屏幕" value={pending??current??''} disabled={pending!==null} onChange={e=>void move(Number(e.target.value))}>
      {current===null && <option value="" disabled>分布在多个屏幕</option>}
      {displays.map((d,i)=><option key={d.id} value={d.id}>{displayName(d,i)}</option>)}
    </select>
  </label>;
}
