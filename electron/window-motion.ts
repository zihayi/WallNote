import { systemPreferences, type BrowserWindow } from 'electron';

// Only the opaque management window uses HWND opacity. WorkerW children need their
// wallpaper underlay to stay opaque; their card is animated inside the renderer instead.
export class ManagerMotion {
  private cancel?: () => void;
  private ready = false;
  private wanted: boolean;

  constructor(private win: BrowserWindow, initiallyVisible: boolean, private hidden: () => void) {
    this.wanted = initiallyVisible;
    win.once('ready-to-show', () => { this.ready = true; if (this.wanted) this.show(); });
    win.once('closed', () => this.cancel?.());
  }

  private animationsEnabled() {
    const { shouldRenderRichAnimation, prefersReducedMotion } = systemPreferences.getAnimationSettings();
    return shouldRenderRichAnimation && !prefersReducedMotion;
  }

  private fade(to: number): Promise<boolean> {
    this.cancel?.();
    const win = this.win, from = win.getOpacity(), distance = Math.abs(to - from);
    if (distance < 0.01 || !this.animationsEnabled()) { win.setOpacity(to); return Promise.resolve(true); }
    const duration = (to ? 145 : 105) * distance, start = performance.now();
    return new Promise(resolve => {
      const timer = setInterval(() => {
        if (win.isDestroyed()) { this.cancel?.(); return; }
        const t = Math.min(1, (performance.now() - start) / duration);
        win.setOpacity(from + (to - from) * (1 - (1 - t) ** 2));
        if (t === 1) { clearInterval(timer); this.cancel = undefined; resolve(true); }
      }, 16);
      this.cancel = () => { clearInterval(timer); this.cancel = undefined; resolve(false); };
    });
  }

  show() {
    this.wanted = true;
    if (!this.ready || this.win.isDestroyed()) return;
    if (this.win.isMinimized()) this.win.restore();
    if (!this.win.isVisible() && this.animationsEnabled()) this.win.setOpacity(0);
    this.win.show(); this.win.focus();
    void this.fade(1);
  }

  async hide(): Promise<boolean> {
    this.wanted = false;
    if (this.win.isDestroyed()) return false;
    if (this.win.isVisible() && !this.win.isMinimized() && !await this.fade(0)) return false;
    if (this.wanted || this.win.isDestroyed()) return false;
    this.win.hide(); this.win.setOpacity(1); this.hidden();
    return true;
  }
}

export async function finishWidgetExit(win: BrowserWindow) {
  if (win.isDestroyed() || win.webContents.isCrashed()) return;
  // Wait for the actual card animation (zero wait for reduced motion). A suspended or
  // unresponsive renderer must never hold up native window teardown or other widgets.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const animation = win.webContents.executeJavaScript(`(() => {
    document.documentElement.dataset.widgetMotion = 'leaving';
    const exit = document.querySelector('.native-panel')?.getAnimations().find(a => a.animationName === 'widget-leave');
    return exit?.finished.then(() => true, () => false) ?? true;
  })()`).catch(() => false);
  try { await Promise.race([animation, new Promise<void>(resolve => { timer = setTimeout(resolve, 190); })]); }
  finally { clearTimeout(timer); }
}
