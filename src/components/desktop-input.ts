import type { PointerEvent } from 'react';
import { api } from '../api';

export function beginDesktopManipulation(event: PointerEvent<HTMLElement>, mode: 'move' | 'resize') {
  if (event.button !== 0 || (mode === 'move' && (event.target as HTMLElement).closest('button'))) return;
  event.preventDefault();
  const element = event.currentTarget;
  element.setPointerCapture(event.pointerId);
  const finish = () => {
    element.removeEventListener('pointerup', finish);
    element.removeEventListener('pointercancel', finish);
    element.removeEventListener('lostpointercapture', finish);
    api.finishDesktopManipulation();
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  };
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
  element.addEventListener('lostpointercapture', finish);
  api.manipulateDesktopWidget(mode);
}
