import type { CSSProperties } from 'react';
import { Check, Palette } from 'lucide-react';
import { noteColors } from '../../shared/state';
import type { Note, NoteColor } from '../../shared/types';

export const colorLabels: Record<NoteColor, string> = { butter: '奶油黄', lavender: '浅薰衣草', mint: '薄荷绿', rose: '蔷薇粉', sky: '天空蓝' };
const backgrounds: Record<NoteColor, string> = { butter: '#faf3dc', lavender: '#efedf8', mint: '#eaf2e7', rose: '#f9eae8', sky: '#e8f0f7' };
type Appearance = Pick<Note, 'color' | 'backgroundColor'>;

export function noteStyle(note: Appearance): CSSProperties {
  const background = note.backgroundColor || backgrounds[note.color];
  if (!note.backgroundColor) return { '--note-background': background } as CSSProperties;
  const channels = [1, 3, 5].map(start => parseInt(background.slice(start, start + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  const light = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179;
  const ink = light ? '#142018' : '#ffffff';
  return { '--note-background': background, '--note-ink': ink, '--note-text': ink, '--note-muted': `${ink}cc`, '--note-line': `${ink}33`, '--note-control': light ? '#ffffff88' : '#00000044', '--frost-fill': `linear-gradient(135deg, ${background}f5, ${background}eb)` } as CSSProperties;
}

export function NoteColorPicker({ note, disabled = false, onChange }: { note: Appearance; disabled?: boolean; onChange: (changes: Appearance) => void }) {
  return <div className="color-picker note-color-picker" role="group" aria-label="便签背景颜色">
    {noteColors.map(color => <button type="button" key={color} disabled={disabled} className={`color-dot ${color}`} aria-label={colorLabels[color]} title={colorLabels[color]} aria-pressed={!note.backgroundColor && note.color === color} onClick={() => onChange({ color, backgroundColor: null })}>{!note.backgroundColor && note.color === color && <Check size={13} />}</button>)}
    <label className={`custom-color-control ${note.backgroundColor ? 'active' : ''}`} title="自定义背景颜色"><Palette size={15} /><input type="color" aria-label="自定义便签背景色" disabled={disabled} value={note.backgroundColor || backgrounds[note.color]} onChange={event => onChange({ color: note.color, backgroundColor: event.target.value })} /></label>
  </div>;
}
