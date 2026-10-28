// Contrast audit of the rendered preview: text color ratios and block rhythm.
import { PAGE, connect } from './cdp.mjs';

const { ws, send, evaluate } = await connect();

await send('Page.navigate', { url: PAGE });
await new Promise((r) => setTimeout(r, 1200));
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false
});
await evaluate(`(() => {
  try {
    localStorage.removeItem('wechat-md-editor:draft');
    localStorage.removeItem('wechat-md-editor:settings');
  } catch (e) {}
})()`);
await send('Page.reload');
await new Promise((r) => setTimeout(r, 1400));

const audit = await evaluate(`(() => {
  const parse = (c) => {
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return [0, 0, 0, 1];
    const p = m[1].split(',').map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (fg, bg) => {
    const a = lum(parse(fg)), b = lum(parse(bg));
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
  };
  const bgOf = (n) => {
    let cur = n;
    while (cur && cur !== document.documentElement) {
      const c = getComputedStyle(cur).backgroundColor;
      if (parse(c)[3] > 0.1) return c;
      cur = cur.parentElement;
    }
    return 'rgb(255,255,255)';
  };

  const seen = new Map();
  const samples = [];
  document.querySelectorAll('#preview *').forEach(n => {
    const txt = (n.textContent || '').trim();
    if (!txt) return;
    // leaf-ish nodes only, so each text style is sampled once
    if ([...n.children].some(c => (c.textContent || '').trim() === txt)) return;
    const cs = getComputedStyle(n);
    const key = cs.color + '|' + cs.fontSize + '|' + cs.fontWeight;
    if (seen.has(key)) return;
    seen.set(key, true);
    samples.push({
      text: txt.slice(0, 22),
      tag: n.tagName,
      color: cs.color,
      bg: bgOf(n),
      size: cs.fontSize,
      weight: cs.fontWeight,
      ratio: ratio(cs.color, bgOf(n))
    });
  });

  const card = document.getElementById('preview');
  const sections = [...(card.firstElementChild || card).children];
  const gapList = [];
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1].getBoundingClientRect();
    const b = sections[i].getBoundingClientRect();
    gapList.push(Math.round(b.top - a.bottom));
  }

  return {
    samples,
    gapList,
    lowContrast: samples
      .filter(s => s.ratio < 3)
      .map(s => ({ text: s.text, ratio: s.ratio, size: s.size, color: s.color })),
    tinyText: samples
      .filter(s => parseFloat(s.size) < 12)
      .map(s => ({ text: s.text, size: s.size })),
    cardWidth: Math.round(card.getBoundingClientRect().width)
  };
})()`);

console.log(JSON.stringify(audit, null, 2));
ws.close();
