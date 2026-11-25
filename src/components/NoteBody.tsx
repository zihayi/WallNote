import { useRef, useState, type TextareaHTMLAttributes } from 'react';
import { Copy, ImagePlus, X } from 'lucide-react';
import type { NoteImage } from '../../shared/types';
import { MAX_IMAGE_DATA, MAX_NOTE_IMAGES, MAX_NOTE_IMAGE_DATA } from '../../shared/note-images';
import { api, errorMessage } from '../api';

async function loadImage(file: File): Promise<NoteImage> {
  if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) throw new Error('请选择 PNG、JPEG、WebP、GIF 或 BMP 图片。');
  if (file.size > 20 * 1024 * 1024) throw new Error('单张原图请小于 20 MB。');
  const image = await createImageBitmap(file).catch(() => { throw new Error('这张图片无法读取，请重新选择。'); });
  try {
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > MAX_IMAGE_DATA) dataUrl = canvas.toDataURL('image/webp', .85);
    if (dataUrl.length > MAX_IMAGE_DATA) throw new Error('图片压缩后仍然过大，请裁剪后再插入。');
    return { id: crypto.randomUUID(), name: (file.name || '粘贴的图片').slice(0, 200), dataUrl };
  } finally { image.close(); }
}

export function NoteBody({ content, images = [], disabled = false, onTextChange, onImagesChange, onImportingChange, onError, textareaProps = {} }: {
  content: string; images?: NoteImage[]; disabled?: boolean; onTextChange: (value: string) => void;
  onImagesChange: (images: NoteImage[]) => void | Promise<boolean>; onImportingChange: (busy: boolean) => void;
  onError: (message: string) => void; textareaProps?: TextareaHTMLAttributes<HTMLTextAreaElement>;
}) {
  const importing = useRef(false), [copied, setCopied] = useState('');
  const add = async (files: File[]) => {
    if (disabled || importing.current || !files.length) return;
    importing.current = true; onImportingChange(true);
    try {
      if (images.length + files.length > MAX_NOTE_IMAGES) throw new Error(`每张便签最多插入 ${MAX_NOTE_IMAGES} 张图片。`);
      const added: NoteImage[] = [];
      for (const file of files) added.push(await loadImage(file));
      const next = [...images, ...added];
      if (next.reduce((sum, image) => sum + image.dataUrl.length, 0) > MAX_NOTE_IMAGE_DATA) throw new Error('这张便签的图片总量过大，请先移除部分图片。');
      const saved = await onImagesChange(next);
      if (saved !== false) onError('');
    } catch (cause) { onError(errorMessage(cause)); }
    finally { importing.current = false; onImportingChange(false); }
  };
  return <div className="note-body" onPaste={event => {
    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (files.length) { event.preventDefault(); void add(files); }
  }}>
    <textarea {...textareaProps} aria-label="便签内容" placeholder="输入便签内容，也可粘贴图片" value={content} maxLength={50000} disabled={disabled} onChange={event => onTextChange(event.target.value)} />
    {images.length > 0 && <div className="note-images" aria-label="便签图片">{images.map(image => <figure key={image.id}>
      <img src={image.dataUrl} alt={image.name} draggable={false} />
      <figcaption><span>{image.name}</span><button type="button" className="icon-button" disabled={disabled} aria-label={`复制图片：${image.name}`} title={copied === image.id ? '已复制' : '复制图片'} onClick={() => { void api.copyNoteImage(image.dataUrl).then(() => { setCopied(image.id); onError(''); }).catch(cause => onError(errorMessage(cause))); }}><Copy size={13} /></button><button type="button" className="icon-button danger-hover" disabled={disabled} aria-label={`移除图片：${image.name}`} onClick={() => void onImagesChange(images.filter(item => item.id !== image.id))}><X size={14} /></button></figcaption>
    </figure>)}</div>}
    <label className={`note-image-insert ${disabled ? 'disabled' : ''}`}><ImagePlus size={14} /><span>插入图片</span><input type="file" aria-label="插入便签图片" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" multiple disabled={disabled} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void add(files); }} /><small>{images.length ? `${images.length}/${MAX_NOTE_IMAGES}` : '支持 Ctrl+V 粘贴'}</small></label>
  </div>;
}
