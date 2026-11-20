import type { AppState, Wallpaper } from './types';

const art = (id:string, name:string, subject:string, category:'nature'|'abstract', colors:string[]):Wallpaper =>
  ({id,name,description:`${subject} · 1920 × 1080`,category,file:`${id}.jpg`,colors});
export const builtInWallpapers:Wallpaper[] = [
  art('mist','山野来信','绿色山丘','nature',['#59786d','#a2b4a3','#dbe1ce']),
  art('coast','海边散步','海岸风景','nature',['#80b7c3','#d5e6df','#e9d6b5']),
  art('dusk','日落之前','日落山景','nature',['#b88b99','#e9bbad','#685d84']),
  art('dunes','风的形状','沙丘风景','nature',['#cb9975','#e7c8a7','#9d6d57']),
  art('bloom','柔光之间','渐变色彩','abstract',['#c0b6db','#efcfc5','#a1b7d1']),
  art('sage','一叶清晨','绿色植物','abstract',['#97aa8d','#dfe3c9','#617d6c']),
  art('headland','岬角灯塔','海风与白塔','nature',['#466474','#9cb7b7','#dca489']),
  art('snowline','雪线','雪峰与冷杉','nature',['#33495b','#91a5b7','#e8e8dc']),
  art('bamboo','竹间月','月夜竹影','nature',['#192f36','#45615d','#e9d6ac']),
  art('terraces','秋日梯田','秋收时的田埂','nature',['#8e713b','#c5ac69','#e8dcb8']),
  art('print','套色习作','纸上几何','abstract',['#bd5943','#233d49','#f1e6cb']),
  art('contours','潮汐线','靛蓝曲线','abstract',['#233b5b','#64899c','#aac6c4']),
];

export const allWallpapers = (state:AppState) => [...builtInWallpapers,...state.wallpapers];
export function currentWallpaper(state:AppState, preview=false) {
  const find=(id:string|null)=>builtInWallpapers.find(w=>w.id===id) ?? state.wallpapers.find(w=>w.id===id);
  return (!preview && find(state.appliedWallpaperId)) || find(state.selectedWallpaperId) || builtInWallpapers[0];
}
export function wallpaperURL(w:Wallpaper) { return w.category==='imported'?`wallnote://image/${w.id}`:`./wallpapers/${w.file}`; }
export function thumbnailURL(w:Wallpaper) { return w.category==='imported'?wallpaperURL(w):`./wallpapers/${w.id}-thumb.jpg`; }
