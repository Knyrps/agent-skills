// Small Markdown renderer for agent replies in the panel. It builds DOM nodes and never parses HTML, so
// nothing the agent writes can run or style itself. Supports paragraphs, headings, lists, quotes, fenced
// and inline code, bold, italic and http(s) links.
import { css } from 'lit';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
};

function inline(text: string, into: HTMLElement): void {
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let at = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > at) into.append(text.slice(at, m.index));
    if (m[1]) { const c = node('code'); c.textContent = m[1].slice(1, -1); into.append(c); }
    else if (m[2]) { const b = node('strong'); inline(m[2].slice(2, -2), b); into.append(b); }
    else if (m[3]) { const i = node('em'); inline(m[3].slice(1, -1), i); into.append(i); }
    else { const a = node('a'); a.href = m[5]!; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = m[4]!; into.append(a); }
    at = re.lastIndex;
  }
  if (at < text.length) into.append(text.slice(at));
}

export function markdown(src: string): HTMLDivElement {
  const root = node('div', 'md');
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  let para: string[] = [], list: HTMLElement | null = null;
  const flush = () => {
    if (para.length) { const p = node('p'); inline(para.join(' '), p); root.append(p); para = []; }
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*```/.test(l)) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i]!)) code.push(lines[i]!);
      const pre = node('pre'), c = node('code'); c.textContent = code.join('\n'); pre.append(c); root.append(pre);
      continue;
    }
    if (!l.trim()) { flush(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) { flush(); const e = node('div', `h h${h[1]!.length}`); inline(h[2]!, e); root.append(e); continue; }
    const q = /^>\s?(.*)$/.exec(l);
    if (q) { flush(); const e = node('blockquote'); inline(q[1]!, e); root.append(e); continue; }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (li) {
      if (para.length) { const keep: HTMLElement | null = list; flush(); list = keep; }
      const tag = /\d/.test(li[1]!) ? 'ol' : 'ul';
      if (!list || (list as HTMLElement).tagName.toLowerCase() !== tag) { list = node(tag); root.append(list); }
      const e = node('li'); inline(li[2]!, e); (list as HTMLElement).append(e);
      continue;
    }
    const open = list as HTMLElement | null;
    if (open?.lastElementChild && /^\s{2,}\S/.test(l)) { open.lastElementChild.append(' '); inline(l.trim(), open.lastElementChild as HTMLElement); continue; }
    list = null;
    para.push(l.trim());
  }
  flush();
  return root;
}

/** How a rendered reply looks. Used by the agent message. */
export const markdownStyles = css`
  .md { overflow-wrap: anywhere; }
  .md > :first-child { margin-top: 0; }
  .md > :last-child { margin-bottom: 0; }
  .md p { margin: 0 0 8px; }
  .md ul, .md ol { margin: 0 0 8px; padding-left: 22px; }
  .md li { margin: 2px 0; }
  .md .h { margin: 12px 0 4px; font-weight: 500; }
  .md .h1 { font-size: 20px; line-height: 28px; }
  .md .h2 { font-size: 18px; line-height: 26px; }
  .md .h3 { font-size: 16px; line-height: 24px; }
  .md blockquote { margin: 0 0 8px; padding: 2px 0 2px 12px; border-left: 3px solid var(--md-sys-color-outline-variant); color: var(--md-sys-color-on-surface-variant); }
  .md code { font: 13px/20px ui-monospace, Consolas, monospace; padding: 1px 6px; border-radius: 6px; background: var(--md-sys-color-surface-container-highest); }
  .md pre { margin: 0 0 8px; padding: 10px 12px; border-radius: 12px; overflow-x: auto; background: var(--md-sys-color-surface-container-highest); }
  .md pre code { padding: 0; background: none; white-space: pre; }
  .md a { color: var(--md-sys-color-primary); text-underline-offset: 2px; }
`;
