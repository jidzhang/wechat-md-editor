// Independent cross-check: the preview block at the top of the viewport should
// be the section that is at the top of the editor.
import { PAGE, connect } from './cdp.mjs';

const { ws, send, evaluate } = await connect();

await send('Page.enable');
await send('Page.navigate', { url: PAGE });
await new Promise((r) => setTimeout(r, 1400));
await evaluate(`(() => { try { localStorage.clear(); } catch (e) {} })()`);
await send('Page.reload');
await new Promise((r) => setTimeout(r, 1500));

// Every section is exactly 6 source lines, so the expected one is computable.
await evaluate(`(() => {
  const ta = document.getElementById('editor');
  const rows = [];
  for (let i = 0; i < 40; i++) {
    rows.push('## 第 ' + i + ' 节');
    rows.push('');
    rows.push('这是第 ' + i + ' 节的正文。');
    rows.push('');
    rows.push('- 条目 A' + i);
    rows.push('- 条目 B' + i);
  }
  ta.value = rows.join('\\n');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await new Promise((r) => setTimeout(r, 800));

const result = await evaluate(`(async () => {
  const ta = document.getElementById('editor');
  const stage = document.getElementById('stage');
  const preview = document.getElementById('preview');
  const lines = ta.value.split('\\n');

  // Independent measurement of where each source line sits in the textarea.
  const probe = document.createElement('textarea');
  const cs = getComputedStyle(ta);
  ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
    'paddingTop', 'paddingLeft', 'paddingRight', 'borderTopWidth', 'borderLeftWidth', 'boxSizing']
    .forEach(p => { probe.style[p] = cs[p]; });
  probe.style.position = 'absolute';
  probe.style.left = '-99999px';
  probe.style.width = ta.clientWidth + 'px';
  probe.style.height = ta.scrollHeight + 'px';
  probe.style.overflow = 'hidden';
  probe.style.whiteSpace = 'pre-wrap';
  document.body.appendChild(probe);
  const lineHeight = probe.scrollHeight / lines.length;
  probe.remove();

  const samples = [];
  const max = ta.scrollHeight - ta.clientHeight;
  for (const frac of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) {
    ta.scrollTop = Math.round(max * frac);
    ta.dispatchEvent(new Event('scroll'));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const topLine = Math.round(ta.scrollTop / lineHeight);
    const expectedSection = Math.floor(topLine / 6);

    const stageRect = stage.getBoundingClientRect();
    let shown = '';
    for (const n of preview.firstElementChild.children) {
      if (n.getBoundingClientRect().bottom > stageRect.top + 4) {
        shown = (n.textContent || '').trim();
        break;
      }
    }
    const m = shown.match(/第 (\\d+) 节/);
    const shownSection = m ? Number(m[1]) : null;
    samples.push({
      frac,
      topSourceLine: topLine,
      expectedSection,
      shownSection,
      shown: shown.slice(0, 16),
      delta: shownSection === null ? null : shownSection - expectedSection
    });
  }
  return { lineHeight: Math.round(lineHeight * 100) / 100, totalLines: lines.length, samples };
})()`);

console.log(JSON.stringify(result, null, 1));
ws.close();
