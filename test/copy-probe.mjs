// Copy paths: async clipboard, execCommand fallback, shortcut, large document.
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
}).catch((e) => console.log('grant skipped:', String(e.message).slice(0, 80)));

await send('Page.navigate', { url: PAGE });
await new Promise((r) => setTimeout(r, 1400));

const out = {};

out.async = await evaluate(`(async () => {
  document.getElementById('copyBtn').click();
  await new Promise(r => setTimeout(r, 700));
  const out = { toast: document.getElementById('toast').textContent };
  try {
    const items = await navigator.clipboard.read();
    out.types = items.flatMap(i => i.types);
    for (const item of items) {
      if (item.types.includes('text/html')) {
        out.html = await (await item.getType('text/html')).text();
      }
    }
  } catch (e) { out.readError = e.message; }
  return out;
})()`);

out.fallback = await evaluate(`(async () => {
  const realClipboard = navigator.clipboard;
  try {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  } catch (e) { return { error: 'cannot override: ' + e.message }; }
  document.getElementById('copyBtn').click();
  await new Promise(r => setTimeout(r, 500));
  const toast = document.getElementById('toast').textContent;
  Object.defineProperty(navigator, 'clipboard', { value: realClipboard, configurable: true });
  return { toast, fallbackPathTaken: toast.indexOf('复制失败') === -1 };
})()`);

out.shortcut = await evaluate(`(async () => {
  document.getElementById('toast').textContent = '';
  document.getElementById('editor').focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
  await new Promise(r => setTimeout(r, 700));
  return document.getElementById('toast').textContent;
})()`);

out.bigDoc = await evaluate(`(async () => {
  const chunk = '## 小节\\n\\n正文段落 **加粗** [链接](https://example.com/x)。\\n\\n';
  const ta = document.getElementById('editor');
  ta.value = '# 大文档\\n\\n' + chunk.repeat(300);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 900));
  document.getElementById('copyBtn').click();
  await new Promise(r => setTimeout(r, 1200));
  return {
    toast: document.getElementById('toast').textContent,
    previewKB: Math.round(document.getElementById('preview').innerHTML.length / 1024)
  };
})()`);

console.log(JSON.stringify(out, null, 1));
ws.close();
