// End-to-end smoke check of the page: no console errors, clean inline HTML,
// live update on typing, no overflow at three widths, clipboard write.
// Usage: node test/cdp-check.mjs
import { PAGE, connect } from './cdp.mjs';

const { ws, send, evaluate } = await connect();

const events = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') {
    events.push(m);
  }
});

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
try {
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
} catch (e) { /* older builds */ }
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
});
await send('Page.navigate', { url: PAGE });
await new Promise((r) => setTimeout(r, 1200));

const report = {};

report.pageErrors = events
  .filter((e) => e.method === 'Runtime.exceptionThrown')
  .map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
report.console = events
  .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
  .map((e) => e.params.args.map((a) => a.value ?? a.description).join(' '));

report.loaded = await evaluate('typeof MdWx === "object" && typeof marked === "object"');

// Hygiene of the produced inline HTML.
report.renderChecks = await evaluate(`(() => {
  const result = MdWx.render(document.getElementById('editor').value, MdWx.defaults);
  const html = result.html;
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const all = [...holder.querySelectorAll('*')];
  return {
    links: result.links,
    images: result.images,
    footnotes: result.footnotes.length,
    hasScript: /<script/i.test(html),
    hasStyleTag: /<style/i.test(html),
    hasClass: /\\sclass=/.test(html),
    hasHref: /href=/.test(html),
    hasHttpText: /https?:\\/\\//.test(holder.textContent),
    sectionInsideP: holder.querySelectorAll('p section').length,
    divInsideP: holder.querySelectorAll('p div').length,
    blockInsideP: holder.querySelectorAll('p p, p table, p blockquote, p pre, p h1, p h2, p h3').length,
    unstyled: all.filter(n => !n.getAttribute('style') && n.tagName !== 'BR').map(n => n.tagName).slice(0, 10)
  };
})()`);

// Live update while typing.
report.typing = await evaluate(`(async () => {
  const ta = document.getElementById('editor');
  ta.value = '## 新章节\\n\\n这是**新**内容 [链接](https://example.com/path)。\\n\\n![说明](a.png)';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  const preview = document.getElementById('preview');
  const text = preview.textContent;
  return {
    text: text.replace(/\\s+/g, ' ').trim().slice(0, 120),
    headingBar: /新章节/.test(text) && !!preview.querySelector('section[style*="border-left"]'),
    placeholder: /［说明 · a\\.png］/.test(text),
    stats: document.getElementById('stats').textContent,
    hintShown: !document.getElementById('hint').hidden
  };
})()`);

async function layoutCheck(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false
  });
  await new Promise((r) => setTimeout(r, 350));
  return evaluate(`(() => {
    const card = document.getElementById('preview');
    const cardBox = card.getBoundingClientRect();
    const offenders = [];
    card.querySelectorAll('*').forEach(n => {
      const b = n.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) return;
      if (b.right > cardBox.right + 1.5 || b.left < cardBox.left - 1.5) {
        offenders.push({
          tag: n.tagName,
          text: (n.textContent || '').trim().slice(0, 24),
          right: Math.round(b.right - cardBox.left)
        });
      }
    });
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      cardWidth: Math.round(cardBox.width),
      offenders: offenders.slice(0, 8)
    };
  })()`);
}

report.layoutDesktop = await layoutCheck(1440, 900);
report.layoutNarrow = await layoutCheck(820, 900);
report.layoutMobile = await layoutCheck(390, 800);

// Heading hierarchy: the section bar must be visually stronger than body text.
// Restore the sample first, since the typing test replaced the document.
report.hierarchy = await evaluate(`(async () => {
  try { localStorage.removeItem('wechat-md-editor:draft'); } catch (e) {}
  location.reload();
  return 'reloading';
})()`);
await new Promise((r) => setTimeout(r, 1500));

report.hierarchy = await evaluate(`(() => {
  const p = document.querySelector('#preview p');
  const heads = [...document.querySelectorAll('#preview > section > section')];
  const h2 = heads.find(n => getComputedStyle(n).borderLeftWidth !== '0px' && n.querySelector('span'));
  if (!p || !h2) return { error: 'missing p or heading bar' };
  const cs = (n) => getComputedStyle(n);
  const span = h2.querySelector('span');
  return {
    body: parseFloat(cs(p).fontSize),
    h2: parseFloat(cs(span).fontSize),
    h2Weight: cs(span).fontWeight,
    h2BorderLeft: cs(h2).borderLeftWidth + ' ' + cs(h2).borderLeftColor,
    h2MarginTop: cs(h2).marginTop
  };
})()`);

// A file:// page reports its origin as "null", which the permission API rejects,
// so fall back to the scheme-level origin it accepts.
const parsed = new URL(PAGE);
const origin = parsed.protocol === 'file:' ? 'file://' : parsed.origin;
try {
  await send('Browser.grantPermissions', {
    origin,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
  });
} catch (e) {
  report.grantError = String(e.message).slice(0, 200);
}

report.clipboard = await evaluate(`(async () => {
  document.getElementById('copyBtn').click();
  await new Promise(r => setTimeout(r, 600));
  const out = { toast: document.getElementById('toast').textContent };
  try {
    const items = await navigator.clipboard.read();
    out.types = items.flatMap(i => i.types);
    for (const item of items) {
      if (item.types.includes('text/html')) {
        const html = await (await item.getType('text/html')).text();
        out.htmlLen = html.length;
        out.htmlHasStyle = /style="/.test(html);
        out.htmlHasHttp = /https?:\\/\\//.test(html);
      }
      if (item.types.includes('text/plain')) {
        out.plainLen = (await (await item.getType('text/plain')).text()).length;
      }
    }
  } catch (e) {
    out.readError = String(e.message).slice(0, 200);
  }
  return out;
})()`);

console.log(JSON.stringify(report, null, 1));
ws.close();
