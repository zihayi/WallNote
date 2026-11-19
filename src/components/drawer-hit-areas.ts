import { useLayoutEffect, type RefObject } from 'react';
import { api } from '../api';
import type { DrawerHitArea } from '../../shared/drawer';

/** Explorer still owns the wallpaper surface. Publish only visible tile geometry,
 * never file paths or labels. Fractions keep clipping and native DPI in agreement. */
export function useDrawerHitAreas(list: RefObject<HTMLDivElement | null>, desktop: boolean, revision: unknown, tab: string, limit: number) {
  useLayoutEffect(()=>{
    const el=list.current;
    if(!desktop || !el)return;
    let frame=0;
    const publish=()=>{
      frame=0;const clip=el.getBoundingClientRect(),w=window.innerWidth,h=window.innerHeight,areas:DrawerHitArea[]=[];
      if(w>0&&h>0)for(const tile of el.querySelectorAll('.drawer-tile')){
        const b=tile.getBoundingClientRect(),x=Math.max(0,clip.left,b.left),y=Math.max(0,clip.top,b.top),right=Math.min(w,clip.right,b.right),bottom=Math.min(h,clip.bottom,b.bottom);
        if(b.top>=clip.bottom || areas.length>=1024)break;
        if(right>x&&bottom>y)areas.push({x:x/w,y:y/h,width:(right-x)/w,height:(bottom-y)/h});
      }
      api.drawerHitAreas(areas);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(publish);};
    const observer=new ResizeObserver(schedule);observer.observe(el);if(el.firstElementChild)observer.observe(el.firstElementChild);
    el.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);publish();
    return ()=>{cancelAnimationFrame(frame);observer.disconnect();el.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);api.drawerHitAreas([]);};
  },[list,desktop,revision,tab,limit]);
}
