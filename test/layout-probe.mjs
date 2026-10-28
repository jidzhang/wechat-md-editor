// Layout audit for the editor shell: header fit and column split by width.
import { PAGE, connect } from './cdp.mjs';

const { ws, send, evaluate } = await connect();

await send('Page.navigate', { url: PAGE });
await new Promise((r) => setTimeout(r, 1200));
await evaluate(`(() => { try { localStorage.clear(); } catch (e) {} })()`);
await send('Page.reload');
await new Promise((r) => setTimeout(r, 1400));

const sizes = [
  { label: 'desktop-1440', width: 1440, height: 900, mobile: false },
  { label: 'laptop-1100', width: 1100, height: 800, mobile: false },
  { label: 'tablet-900', width: 900, height: 800, mobile: false },
  { label: 'tablet-780', width: 780, height: 900, mobile: false },
  { label: 'phone-390', width: 390, height: 844, mobile: true }
];

const report = {};
for (const s of sizes) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: s.width, height: s.height, deviceScaleFactor: 1, mobile: s.mobile
  });
  await new Promise((r) => setTimeout(r, 350));
  report[s.label] = await evaluate(`(() => {
    const gone = (n) => !n || n.getBoundingClientRect().width === 0;
    const header = document.querySelector('header');
    const tools = document.querySelector('.tools');
    const copyBtn = document.getElementById('copyBtn');
    const head = header.getBoundingClientRect();

    const items = [...document.querySelectorAll('header button, header select, header input, .brand')];
    const overlaps = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i].getBoundingClientRect();
        const b = items[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 1 && oy > 1) {
          overlaps.push([
            items[i].textContent.trim().slice(0, 8) || items[i].id,
            items[j].textContent.trim().slice(0, 8) || items[j].id
          ]);
        }
      }
    }

    return {
      docScrollX: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      headerHeight: Math.round(head.height),
      brandText: document.querySelector('.brand').firstChild.textContent.trim(),
      copyVisible: !gone(copyBtn) && copyBtn.getBoundingClientRect().right <= head.right + 1,
      toolsInHeader: tools.getBoundingClientRect().right <= head.right + 1,
      headerOverlaps: overlaps,
      editorVisible: !gone(document.getElementById('editor')),
      previewVisible: !gone(document.getElementById('preview')),
      mainCols: getComputedStyle(document.querySelector('main')).gridTemplateColumns
    };
  })()`);
}

console.log(JSON.stringify(report, null, 1));
ws.close();
