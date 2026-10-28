// Sanity checks for the page: storage, defaults, hints, CRLF, render speed.
import { PAGE, connect } from './cdp.mjs';

const { ws, send, evaluate } = await connect();

await send('Page.navigate', { url: PAGE });
await new Promise((r) => setTimeout(r, 1300));

const out = {};

out.storage = await evaluate(`(() => {
  try {
    localStorage.setItem('probe', '1');
    return localStorage.getItem('probe') === '1';
  } catch (e) { return 'error: ' + e.message; }
})()`);

out.keys = await evaluate(`(() => {
  localStorage.setItem('wechat-md-editor:probe', 'ok');
  const names = Object.keys(localStorage);
  names.forEach(n => { if (n.startsWith('wechat-md-editor:probe')) localStorage.removeItem(n); });
  return names;
})()`);

out.defaults = await evaluate(`({
  hideH1: document.getElementById('hideH1').checked,
  followScroll: document.getElementById('followScroll').checked,
  font: document.getElementById('fontSize').value,
  mode: document.getElementById('linkMode').value
})`);

out.hint = await evaluate(
  `document.getElementById('hint').hidden ? '(hidden)' : document.getElementById('hint').textContent.trim()`
);

out.firstBlocks = await evaluate(`(() => {
  const root = document.querySelector('#preview > section');
  return [...root.children].slice(0, 4)
    .map(n => ({ tag: n.tagName, text: (n.textContent || '').trim().slice(0, 14) }));
})()`);

const crlf = '## 标题\r\n\r\n第一段 **粗**\r\n继续\r\n\r\n- a\r\n- b';
out.crlf = await evaluate(`(() => {
  const r = MdWx.render(${JSON.stringify(crlf)}, {});
  return {
    images: r.images,
    links: r.links,
    hasHeading: r.html.indexOf('标题') !== -1,
    bullets: (r.html.match(/•/g) || []).length
  };
})()`);

const chunk = '## 小节\n\n这是正文段落，包含 **加粗** 和 [链接](https://example.com/x) 以及 `code`。\n\n' +
  '- 列表一\n- 列表二\n\n> 引用一句\n\n';
const longDoc = '# 大文档\n\n' + chunk.repeat(300);
out.perf = await evaluate(`(() => {
  const t0 = performance.now();
  const r = MdWx.render(${JSON.stringify(longDoc)}, {});
  return {
    ms: Math.round(performance.now() - t0),
    htmlKB: Math.round(r.html.length / 1024),
    links: r.links,
    notes: r.footnotes.length
  };
})()`);

console.log(JSON.stringify(out, null, 1));
ws.close();
