// Text edits are stored as innerHTML so links and inline formatting inside the element survive.
// Strip anything that could run code before storing or re-applying it.

const DROP_TAGS = 'script,iframe,object,embed,link,meta,style,base,form,frame,frameset';
const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction', 'srcdoc'];

export function sanitizeHtml(html: string, doc: Document = document): string {
  const tpl = doc.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll(DROP_TAGS).forEach((n) => n.remove());
  tpl.content.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'contenteditable' || name.startsWith('data-glowup')) {
        el.removeAttribute(attr.name);
      } else if (URL_ATTRS.includes(name) && /^\s*(javascript|vbscript|data:text\/html)/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return tpl.innerHTML;
}
