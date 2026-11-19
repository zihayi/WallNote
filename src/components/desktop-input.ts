import type { PointerEvent } from 'react';
import { api } from '../api';
import type { DragMode } from '../../shared/snap-layout';

export function beginDesktopManipulation(event: PointerEvent<HTMLElement>, mode: DragMode) {
  if (!event.isPrimary || event.button !== 0 || (mode === 'move' && (event.target as Element).closest('button,input,select,textarea,a,[contenteditable=true]'))) return;
  event.preventDefault();
  const element = event.currentTarget;
  const id=event.pointerId;
  element.setPointerCapture(id);
  const finish = (cancel: boolean) => {
    element.removeEventListener('pointerup', up);
    element.removeEventListener('pointercancel', lost);
    element.removeEventListener('lostpointercapture', lost);
    window.removeEventListener('keydown', key);
    api.finishDesktopManipulation(cancel);
    if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
  };
  const up=(e:globalThis.PointerEvent)=>{if(e.pointerId===id)finish(false);};
  const lost=(e:globalThis.PointerEvent)=>{if(e.pointerId===id)finish(true);};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();finish(true);}};
  element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', lost);
  element.addEventListener('lostpointercapture', lost);
  window.addEventListener('keydown', key);
  api.manipulateDesktopWidget(mode, {x:event.clientX,y:event.clientY}, event.altKey);
}
