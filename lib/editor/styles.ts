// CSS for everything inside the editor's Shadow DOM.
export const EDITOR_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.panel, .toast, .box-label {
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #1f2330;
  -webkit-font-smoothing: antialiased;
}
button, input, select, textarea { font: inherit; color: inherit; }

.hover-box, .select-box {
  position: fixed; pointer-events: none; display: none;
  border-radius: 2px;
}
.hover-box { outline: 2px dashed #8b5cf6; background: rgba(139, 92, 246, 0.08); }
.select-box { outline: 2px solid #6d28d9; box-shadow: 0 0 0 4px rgba(109, 40, 217, 0.18); }
.select-box.editing { outline-color: #059669; box-shadow: 0 0 0 4px rgba(5, 150, 105, 0.2); }
.box-label {
  position: absolute; left: -2px; top: -22px; height: 20px; padding: 0 6px;
  background: #6d28d9; color: #fff; font-size: 11px; line-height: 20px; border-radius: 3px 3px 0 0;
  white-space: nowrap;
}
.select-box.below .box-label { top: auto; bottom: -22px; border-radius: 0 0 3px 3px; }
.select-box.editing .box-label { background: #059669; }

.panel {
  position: fixed; top: 12px; right: 12px; width: 304px; max-height: calc(100vh - 24px);
  display: flex; flex-direction: column;
  background: #fff; border: 1px solid #d9dbe3; border-radius: 10px;
  box-shadow: 0 12px 32px rgba(15, 18, 30, 0.18), 0 2px 6px rgba(15, 18, 30, 0.08);
  overflow: hidden;
}
.panel.left { right: auto; left: 12px; }
.panel.min .body, .panel.min .status { display: none; }

.bar { display: flex; align-items: center; gap: 4px; padding: 8px; border-bottom: 1px solid #eceef3; background: #fafafc; }
.logo { font-weight: 650; margin-right: auto; white-space: nowrap; }
.logo b { color: #6d28d9; }
.icon { width: 28px; height: 28px; border: 0; background: transparent; border-radius: 6px; cursor: pointer; font-size: 15px; line-height: 1; }
.icon:hover:not(:disabled) { background: #eceef3; }
.icon:disabled { opacity: 0.35; cursor: default; }

.seg { display: inline-flex; background: #eceef3; border-radius: 7px; padding: 2px; }
.seg button { border: 0; background: transparent; padding: 3px 8px; border-radius: 5px; cursor: pointer; font-size: 12px; }
.seg button.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.12); font-weight: 600; }

.body { overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px; }
.hint { color: #5c6275; margin: 0; }
.notice { background: #fff7e6; border: 1px solid #f3d9a4; border-radius: 8px; padding: 8px; }
.failed { background: #fdf0f0; border: 1px solid #f0c4c4; border-radius: 8px; padding: 8px; }
.failed ul { margin: 6px 0; padding-left: 18px; color: #5c3b3b; }
.failed .row { display: flex; gap: 6px; }

.crumbs { display: flex; flex-wrap: wrap; gap: 2px; align-items: center; font-size: 12px; }
.crumbs button { border: 0; background: #f1f2f6; border-radius: 4px; padding: 2px 6px; cursor: pointer; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crumbs button:hover { background: #e4e1f7; }
.crumbs button.cur { background: #6d28d9; color: #fff; }
.crumbs .sep { color: #9aa0b2; }

.actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.btn { border: 1px solid #d9dbe3; background: #fff; border-radius: 7px; padding: 6px 8px; cursor: pointer; white-space: nowrap; }
.btn:hover:not(:disabled) { border-color: #6d28d9; color: #6d28d9; }
.btn:disabled { opacity: 0.4; cursor: default; }
.btn.small { padding: 3px 8px; font-size: 12px; }
.btn.primary { background: #6d28d9; border-color: #6d28d9; color: #fff; }
.btn.primary:hover:not(:disabled) { background: #5b21b6; border-color: #5b21b6; color: #fff; }

.group { border-top: 1px solid #eceef3; padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.group h4 { margin: 0; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #7a8094; }
.field { display: grid; grid-template-columns: 92px 1fr; align-items: center; gap: 6px; }
.field > span { color: #3f4456; }
.field .ctl { display: flex; gap: 4px; align-items: center; min-width: 0; }
input[type=number], input[type=text], select {
  width: 100%; min-width: 0; height: 28px; padding: 0 6px; border: 1px solid #d9dbe3; border-radius: 6px; background: #fff;
}
input[type=color] { width: 44px; height: 28px; padding: 2px; border: 1px solid #d9dbe3; border-radius: 6px; background: #fff; cursor: pointer; }
.quad { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.quad input { padding: 0 3px; text-align: center; }
.unit { color: #7a8094; font-size: 11px; }
.align { display: inline-flex; gap: 4px; }
.align button { width: 32px; height: 28px; }
.align button.on { border-color: #6d28d9; color: #6d28d9; background: #f4f0fd; }

details.changes summary { cursor: pointer; color: #3f4456; }
details.changes ol { margin: 6px 0 0; padding-left: 20px; max-height: 160px; overflow: auto; color: #3f4456; }
details.changes li.failed-op { color: #b42318; }

.status { padding: 6px 10px; border-top: 1px solid #eceef3; color: #5c6275; font-size: 12px; background: #fafafc; display: flex; justify-content: space-between; }

.tabs { display: flex; gap: 2px; padding: 0 8px; border-bottom: 1px solid #eceef3; background: #fafafc; }
.tabs button { border: 0; background: transparent; padding: 7px 10px; cursor: pointer; color: #5c6275; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tabs button.on { color: #1f2330; font-weight: 600; border-bottom-color: #6d28d9; }
.tabs .notes-n:not(:empty) { display: inline-block; min-width: 16px; padding: 0 4px; border-radius: 8px; background: #6d28d9; color: #fff; font-size: 10px; line-height: 16px; text-align: center; }
.panel.min .tabs { display: none; }
.tab { display: flex; flex-direction: column; gap: 10px; }

textarea { width: 100%; min-height: 44px; padding: 5px 6px; border: 1px solid #d9dbe3; border-radius: 6px; background: #fff; resize: vertical; line-height: 1.35; }
input:focus, select:focus, textarea:focus { outline: 2px solid rgba(109, 40, 217, 0.35); outline-offset: 0; border-color: #6d28d9; }
.check { display: flex; align-items: center; gap: 6px; cursor: pointer; color: #3f4456; }
.stack { display: flex; flex-direction: column; gap: 3px; }
.stack > span { color: #3f4456; font-size: 12px; }
.link { border: 0; background: transparent; padding: 0; color: #6d28d9; cursor: pointer; font-size: 12px; align-self: flex-start; }
.link:hover { text-decoration: underline; }

.brand-box { display: flex; flex-direction: column; gap: 6px; background: #fafafc; border: 1px solid #eceef3; border-radius: 8px; padding: 8px; }
.brand-head { display: flex; justify-content: space-between; align-items: center; }
.brand-box h4, .presets h4 { margin: 0; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #7a8094; }
.dots { display: inline-flex; flex-wrap: wrap; gap: 3px; }
.dot { width: 16px; height: 16px; border-radius: 50%; border: 1px solid rgba(0,0,0,.15); padding: 0; cursor: pointer; }
.dot:hover { transform: scale(1.15); }
.presets { display: flex; flex-direction: column; gap: 6px; }
.presets h4 { margin-top: 4px; }
.preset { border: 1px solid #d9dbe3; border-radius: 8px; overflow: hidden; }
.preset.open { border-color: #6d28d9; }
.preset-head { display: flex; flex-direction: column; gap: 1px; width: 100%; border: 0; background: #fff; padding: 7px 9px; text-align: left; cursor: pointer; }
.preset-head:hover { background: #f7f5fd; }
.pname { font-weight: 600; }
.psum { color: #5c6275; font-size: 12px; }
.preset-form { display: flex; flex-direction: column; gap: 7px; padding: 8px 9px 10px; border-top: 1px solid #eceef3; background: #fcfbff; }
.preset-form .add { align-self: stretch; }

details.changes li { margin-bottom: 2px; }
.note-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 4px; border: 0; border-radius: 9px; background: #6d28d9; color: #fff; font-size: 11px; font-weight: 700; cursor: pointer; vertical-align: 1px; }
.notes-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.note { display: flex; gap: 8px; align-items: flex-start; }
.note .num { flex: none; display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: #6d28d9; color: #fff; font-weight: 700; font-size: 12px; }
.note-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.note-for { color: #5c6275; font-size: 12px; }

.pins { position: fixed; inset: 0; width: 0; height: 0; }
.pin {
  position: fixed; display: none; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0; border-radius: 50%;
  background: #6d28d9; color: #fff; border: 2px solid #fff;
  font: 700 12px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 2px 6px rgba(0,0,0,.35); cursor: pointer;
}
.pin:hover { transform: scale(1.12); }

.tab-export h4 { margin: 6px 0 0; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #7a8094; }
.tab-export .btn { text-align: center; }
.radios { display: flex; gap: 12px; }
.radios label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.row2 .btn { padding: 6px 4px; }
.exp-status:empty { display: none; }
.exp-preview { width: 100%; height: auto; border: 1px solid #d9dbe3; border-radius: 6px; }

.hidden { display: none !important; }

.toast {
  position: fixed; left: 16px; bottom: 16px; max-width: 420px;
  display: flex; align-items: center; gap: 10px;
  background: #1f2330; color: #fff; padding: 10px 12px; border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.25);
}
.toast button { border: 0; background: #6d28d9; color: #fff; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.toast button.x { background: transparent; padding: 2px 4px; opacity: .7; }
`;
