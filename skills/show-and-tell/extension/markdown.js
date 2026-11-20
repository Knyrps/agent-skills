// Small Markdown renderer for agent replies in the panel. It builds DOM nodes and never parses HTML, so
// nothing the agent writes can run or style itself. Supports paragraphs, headings, lists, quotes, fenced
// and inline code, bold, italic and http(s) links.

const node = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

function inline(text, into) {
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let at = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > at) into.append(text.slice(at, m.index));
    if (m[1]) { const c = node('code'); c.textContent = m[1].slice(1, -1); into.append(c); }
    else if (m[2]) { const b = node('strong'); inline(m[2].slice(2, -2), b); into.append(b); }
    else if (m[3]) { const i = node('em'); inline(m[3].slice(1, -1), i); into.append(i); }
    else { const a = node('a'); a.href = m[5]; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = m[4]; into.append(a); }
    at = re.lastIndex;
  }
  if (at < text.length) into.append(text.slice(at));
}

export function markdown(src) {
  const root = node('div', 'md');
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  let para = [], list = null;
  const flush = () => {
    if (para.length) { const p = node('p'); inline(para.join(' '), p); root.append(p); para = []; }
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = /^\s*```/.exec(l);
    if (fence) {
      flush();
      const code = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      const pre = node('pre'), c = node('code'); c.textContent = code.join('\n'); pre.append(c); root.append(pre);
      continue;
    }
    if (!l.trim()) { flush(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) { flush(); const e = node('div', `h h${h[1].length}`); inline(h[2], e); root.append(e); continue; }
    const q = /^>\s?(.*)$/.exec(l);
    if (q) { flush(); const e = node('blockquote'); inline(q[1], e); root.append(e); continue; }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (li) {
      if (para.length) { const keep = list; flush(); list = keep; }
      const tag = /\d/.test(li[1]) ? 'ol' : 'ul';
      if (!list || list.tagName.toLowerCase() !== tag) { list = node(tag); root.append(list); }
      const e = node('li'); inline(li[2], e); list.append(e);
      continue;
    }
    if (list && /^\s{2,}\S/.test(l)) { list.lastChild.append(' '); inline(l.trim(), list.lastChild); continue; }
    list = null;
    para.push(l.trim());
  }
  flush();
  return root;
}
