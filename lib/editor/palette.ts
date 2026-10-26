// Command palette (Ctrl/Cmd+K) for every editor action, and the shortcut cheat sheet ("?").
// SPEC.md 6A: easy for beginners (everything is also a visible button), fast for pros.

export interface Command {
  id: string;
  title: string;
  group: string;
  /** Shortcut shown next to it, e.g. "Ctrl+Z". */
  keys?: string;
  enabled?(): boolean;
  run(): void;
}

/** Shortcuts that are gestures rather than commands, for the cheat sheet. */
const GESTURES: [string, string][] = [
  ['Click', 'Select an element'],
  ['Shift+click', 'Add or remove an element from the selection'],
  ['Double-click', 'Edit text'],
  ['Drag a corner / edge handle', 'Resize (Shift keeps the aspect ratio)'],
  ['Alt+drag a spacing band', 'Change padding or margin (or turn on Spacing mode)'],
  ['Hover another element', 'Measure the distance to the selected one'],
  ['Hold Alt+Shift and hover', 'See an element’s spacing without selecting it'],
  ['Drag a number label', 'Scrub the value left / right'],
];

/** Words in the query must all appear in the title; titles starting with the query come first. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  const words = q.split(/\s+/);
  return commands
    .filter((c) => {
      const t = `${c.title} ${c.group}`.toLowerCase();
      return words.every((w) => t.includes(w));
    })
    .sort((a, b) => Number(b.title.toLowerCase().startsWith(q)) - Number(a.title.toLowerCase().startsWith(q)));
}

export class CommandPalette {
  private box: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private shown: Command[] = [];
  private index = 0;

  constructor(
    private doc: Document,
    parent: HTMLElement,
    private commands: () => Command[],
  ) {
    this.box = doc.createElement('div');
    this.box.className = 'palette hidden';
    this.box.innerHTML = `<div class="palette-card" role="dialog" aria-label="Command palette">
      <input type="text" placeholder="Type a command…  (Esc to close)" aria-label="Command">
      <ul role="listbox"></ul>
    </div>`;
    parent.appendChild(this.box);
    this.input = this.box.querySelector('input')!;
    this.list = this.box.querySelector('ul')!;
    this.input.addEventListener('input', () => {
      this.index = 0;
      this.render();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = this.shown.length || 1;
        this.index = (this.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        this.render();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.runAt(this.index);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.box.addEventListener('pointerdown', (e) => {
      if (e.target === this.box) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.box.classList.contains('hidden');
  }

  open(): void {
    this.box.classList.remove('hidden');
    this.input.value = '';
    this.index = 0;
    this.render();
    this.input.focus();
  }

  close(): void {
    this.box.classList.add('hidden');
    this.input.blur();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private runAt(i: number): void {
    const c = this.shown[i];
    if (!c || (c.enabled && !c.enabled())) return;
    this.close();
    c.run();
  }

  private render(): void {
    this.shown = filterCommands(this.commands(), this.input.value);
    this.list.replaceChildren(
      ...this.shown.map((c, i) => {
        const li = this.doc.createElement('li');
        li.setAttribute('role', 'option');
        const off = c.enabled && !c.enabled();
        li.className = `${i === this.index ? 'on' : ''}${off ? ' off' : ''}`;
        const t = this.doc.createElement('span');
        t.textContent = c.title;
        const g = this.doc.createElement('span');
        g.className = 'grp';
        g.textContent = c.group;
        li.append(t, g);
        if (c.keys) {
          const k = this.doc.createElement('kbd');
          k.textContent = c.keys;
          li.append(k);
        }
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.runAt(i);
        });
        return li;
      }),
    );
    if (!this.shown.length) {
      const li = this.doc.createElement('li');
      li.className = 'off';
      li.textContent = 'No matching command';
      this.list.append(li);
    }
    this.list.children[this.index]?.scrollIntoView({ block: 'nearest' });
  }
}

export class CheatSheet {
  private box: HTMLElement;

  constructor(
    private doc: Document,
    parent: HTMLElement,
    private commands: () => Command[],
  ) {
    this.box = doc.createElement('div');
    this.box.className = 'cheats hidden';
    parent.appendChild(this.box);
    this.box.addEventListener('pointerdown', () => this.close());
  }

  get isOpen(): boolean {
    return !this.box.classList.contains('hidden');
  }

  close(): void {
    this.box.classList.add('hidden');
  }

  toggle(): void {
    if (this.isOpen) return this.close();
    const card = this.doc.createElement('div');
    card.className = 'cheats-card';
    const h = this.doc.createElement('h3');
    h.textContent = 'Keyboard shortcuts';
    const hint = this.doc.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Ctrl+K (⌘K on Mac) runs any action by name. Press ? or Esc to close.';
    const dl = this.doc.createElement('dl');
    const rows: [string, string][] = [...this.commands().filter((c) => c.keys).map((c) => [c.keys!, c.title] as [string, string]), ...GESTURES];
    for (const [k, t] of rows) {
      const dt = this.doc.createElement('dt');
      dt.textContent = k;
      const dd = this.doc.createElement('dd');
      dd.textContent = t;
      dl.append(dt, dd);
    }
    card.append(h, hint, dl);
    this.box.replaceChildren(card);
    this.box.classList.remove('hidden');
  }
}
