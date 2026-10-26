// The editor's container: one element on <html> holding a closed Shadow DOM, so the site's CSS
// can't restyle the editor and the editor's CSS can't leak into the site.

import { EDITOR_ATTR } from '../model/selector';
import { EDITOR_CSS } from './styles';

export class ShadowHost {
  readonly el: HTMLElement;
  readonly root: ShadowRoot;
  private toastEl: HTMLElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private doc: Document = document) {
    this.el = doc.createElement('glowup-editor');
    this.el.setAttribute(EDITOR_ATTR, '');
    this.el.style.cssText =
      'all: initial !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; display: block !important;';
    this.root = this.el.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = EDITOR_CSS;
    this.root.appendChild(style);
  }

  /** (Re)attach to the page; some sites rebuild the document. */
  attach(): void {
    if (!this.el.isConnected) this.doc.documentElement.appendChild(this.el);
  }

  /** Take the editor (panel, pins, toasts) out of the picture, e.g. while screenshotting. */
  setHidden(hidden: boolean): void {
    this.el.style.setProperty('display', hidden ? 'none' : 'block', 'important');
  }

  contains(node: EventTarget | null): boolean {
    return node === this.el || (node instanceof Node && this.el.contains(node));
  }

  toast(message: string, opts: { action?: string; onAction?: () => void; sticky?: boolean } = {}): void {
    this.attach();
    this.toastEl?.remove();
    clearTimeout(this.toastTimer);
    const t = this.doc.createElement('div');
    t.className = 'toast';
    const msg = this.doc.createElement('span');
    msg.textContent = message;
    t.appendChild(msg);
    if (opts.action && opts.onAction) {
      const b = this.doc.createElement('button');
      b.textContent = opts.action;
      b.addEventListener('click', () => {
        this.hideToast();
        opts.onAction!();
      });
      t.appendChild(b);
    }
    const close = this.doc.createElement('button');
    close.className = 'x';
    close.textContent = '✕';
    close.title = 'Dismiss';
    close.addEventListener('click', () => this.hideToast());
    t.appendChild(close);
    this.root.appendChild(t);
    this.toastEl = t;
    if (!opts.sticky) this.toastTimer = setTimeout(() => this.hideToast(), 5000);
  }

  hideToast(): void {
    this.toastEl?.remove();
    this.toastEl = null;
  }
}
