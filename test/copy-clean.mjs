// Checks that the clipboard payload equals the rendered HTML: no sync markers,
// no mirror text, nothing hidden.
import { PAGE, connect } from './cdp.mjs';

const { ws, send, evaluate } = await connect();

await send('Page.enable');
await send('Page.bringToFront');
try {
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
} catch (e) { /* older builds */ }
await send('Browser.grantPermissions', {
  origin: 'file://',
  permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
}).catch(() => {});

await send('Page.navigate', { url: PAGE });
await new Promise((r) => setTimeout(r, 1400));
await evaluate(`(() => { try { localStorage.clear(); } catch (e) {} })()`);
await send('Page.reload');
await new Promise((r) => setTimeout(r, 1500));

// Scroll first, so the sync machinery has run before copying.
await evaluate(`(async () => {
  const ta = document.getElementById('editor');
  for (const f of [0.3, 0.6, 0.9]) {
    ta.scrollTop = Math.round((ta.scrollHeight - ta.clientHeight) * f);
    ta.dispatchEvent(new Event('scroll'));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
})()`);

const out = await evaluate(`(async () => {
  const rendered = MdWx.render(document.getElementById('editor').value, {
    fontSize: 16, accent: '#2f6f55', linkMode: 'footnote', hideH1: false
  }).html;
  document.getElementById('copyBtn').click();
  await new Promise(r => setTimeout(r, 800));

  let copied = '';
  for (const item of await navigator.clipboard.read()) {
    if (item.types.includes('text/html')) {
      copied = await (await item.getType('text/html')).text();
    }
  }

  // The clipboard returns DOM-serialized HTML: entity spelling changes but the
  // parse tree does not. Compare structure, text and attributes instead.
  const parse = (html) => {
    const d = document.createElement('div');
    d.innerHTML = html;
    const nodes = [...d.querySelectorAll('*')];
    return {
      tags: nodes.map(n => n.tagName).join(','),
      text: d.textContent,
      styles: nodes.map(n => n.getAttribute('style') || '').join('|')
    };
  };
  const before = parse(rendered);
  const after = parse(copied);

  const holder = document.createElement('div');
  holder.innerHTML = copied;
  const attrs = new Set();
  holder.querySelectorAll('*').forEach(n => {
    for (const a of n.attributes) attrs.add(a.name);
  });

  return {
    identicalToRender: before.tags === after.tags && before.styles === after.styles &&
      before.text === after.text,
    sameText: before.text === after.text,
    tagSequenceEqual: before.tags === after.tags,
    copiedLen: copied.length,
    renderedLen: rendered.length,
    attributes: [...attrs].sort(),
    containsDataLine: /data-line/.test(copied),
    containsAria: /aria-/.test(copied),
    containsHidden: /display:\\s*none|visibility:\\s*hidden/.test(copied),
    mirrorTextLeaked: copied.includes('\\u200b'),
    previewHtmlMatchesClipboard: document.getElementById('preview').innerHTML === copied,
    toast: document.getElementById('toast').textContent
  };
})()`);

console.log(JSON.stringify(out, null, 1));
ws.close();
