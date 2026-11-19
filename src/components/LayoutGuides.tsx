import { useEffect, useState } from 'react';
import type { Guides, Rect } from '../../shared/snap-layout';
import { api } from '../api';

export function NativeGuides({ bounds, displayId }: { bounds?: Rect; displayId?: number }) {
  const [lines,setLines]=useState<Guides>({});
  useEffect(()=>api.onLayoutGuides(setLines),[]);
  if(!bounds || displayId!==undefined && displayId!==lines.displayId)return null;
  return <div className="snap-guides" aria-hidden="true">
    {lines.x!==undefined && <i className="snap-line-x" style={{left:Math.max(0,Math.min(bounds.width-2,lines.x-bounds.x))}}/>}
    {lines.y!==undefined && <i className="snap-line-y" style={{top:Math.max(0,Math.min(bounds.height-2,lines.y-bounds.y))}}/>}
  </div>;
}
