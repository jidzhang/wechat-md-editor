// Computed-style snapshot of the preview: what the article actually becomes.
import { PAGE, connect } from './cdp.mjs';

const { ws, send, evaluate } = await connect();

await send('Page.enable');
await send('Page.navigate', { url: PAGE });
await new Promise((r) => setTimeout(r, 1500));
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 980, deviceScaleFactor: 1, mobile: false
});
await evaluate(`(() => {
  try {
    localStorage.removeItem('wechat-md-editor:draft');
    localStorage.removeItem('wechat-md-editor:settings');
  } catch (e) {}
})()`);
await send('Page.reload');
await new Promise((r) => setTimeout(r, 1500));

const report = {};
report.styles = await evaluate(`(() => {
  const q = (s) => document.querySelector('#preview ' + s);
  const info = (n) => {
    if (!n) return null;
    const c = getComputedStyle(n);
    return {
      tag: n.tagName,
      text: (n.textContent || '').trim().slice(0, 16),
      fontSize: c.fontSize,
      lineHeight: c.lineHeight,
      color: c.color,
      marginTop: c.marginTop,
      marginBottom: c.marginBottom,
      paddingLeft: c.paddingLeft,
      borderLeft: c.borderLeftWidth + ' ' + c.borderLeftColor
    };
  };
  const heads = [...document.querySelectorAll('#preview > section > section')];
  return {
    headingSections: heads.length,
    h1: info(heads[0] && heads[0].querySelector('span')),
    h2: info(heads[1] && heads[1].querySelector('span')),
    h2Wrap: info(heads[1]),
    p: info(q('p')),
    quote: info(q('blockquote')),
    quoteP: info(q('blockquote p')),
    table: info(q('table')),
    th: info(q('th')),
    td: info(q('td')),
    preLine: info(q('section section section section')),
    hr: [...document.querySelectorAll('#preview section')].filter(n => {
      const c = getComputedStyle(n);
      return c.borderTopWidth !== '0px' && !n.textContent.trim();
    }).length
  };
})()`);

report.structure = await evaluate(`(() => {
  const pv = document.getElementById('preview');
  return {
    hTags: pv.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
    boldSpans: pv.querySelectorAll('span[style*="font-weight:bold"]').length,
    li: pv.querySelectorAll('li').length,
    nestedSections: pv.querySelectorAll('section section section').length,
    pInsideP: pv.querySelectorAll('p p').length,
    sectionInsideP: pv.querySelectorAll('p section').length,
    tableInsideP: pv.querySelectorAll('p table').length
  };
})()`);

report.overflow = await evaluate(`(() => {
  const card = document.getElementById('preview');
  const box = card.getBoundingClientRect();
  const bad = [];
  card.querySelectorAll('*').forEach(n => {
    const b = n.getBoundingClientRect();
    if (!b.width && !b.height) return;
    if (b.right > box.right + 1.5) {
      bad.push({ tag: n.tagName, over: Math.round(b.right - box.right), text: (n.textContent || '').trim().slice(0, 20) });
    }
  });
  return { cardWidth: Math.round(box.width), bad: bad.slice(0, 6) };
})()`);

await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 800, deviceScaleFactor: 2, mobile: true
});
await new Promise((r) => setTimeout(r, 500));
report.overflowMobile = await evaluate(`(() => {
  const card = document.getElementById('preview');
  const box = card.getBoundingClientRect();
  const bad = [];
  card.querySelectorAll('*').forEach(n => {
    const b = n.getBoundingClientRect();
    if (!b.width && !b.height) return;
    if (b.right > box.right + 1.5) {
      bad.push({ tag: n.tagName, over: Math.round(b.right - box.right), text: (n.textContent || '').trim().slice(0, 20) });
    }
  });
  return {
    cardWidth: Math.round(box.width),
    docWidth: document.documentElement.scrollWidth,
    bad: bad.slice(0, 6)
  };
})()`);

console.log(JSON.stringify(report, null, 1));
ws.close();
