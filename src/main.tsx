const query = new URLSearchParams(location.search);
const view=query.has('wallpaper')?'wallpaper':query.has('workspace')?'workspace':query.has('widget')||query.has('note')?'widget':window.wallnote&&query.get('editor')==='event'?'event-editor':'manager';
const root=document.getElementById('root')!;
document.documentElement.dataset.view=view;
if(window.wallnote && view==='widget')document.documentElement.dataset.widgetMotion??='staged';
const ready=view==='wallpaper'?import('./wallpaper').then(m=>m.showWallpaper(root,Number(query.get('display')))):import('./render').then(m=>m.render(root,view));
void ready.catch(error=>{console.error(error);root.textContent='加载失败，请重新打开 WallNote。';});
