import type { WallNoteAPI } from '../shared/types';

declare global {
  interface Window { wallnote?: WallNoteAPI }
}
