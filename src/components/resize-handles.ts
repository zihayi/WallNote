import type { DragMode } from '../../shared/snap-layout';
export const resizeHandles: {mode:Exclude<DragMode,'move'>;label:string}[] = [
  {mode:'n',label:'拖动上边缘'},{mode:'s',label:'拖动下边缘'},{mode:'w',label:'拖动左边缘'},{mode:'e',label:'拖动右边缘'},
  {mode:'nw',label:'拖动左上角'},{mode:'ne',label:'拖动右上角'},{mode:'sw',label:'拖动左下角'},{mode:'resize',label:'拖动右下角'},
];
