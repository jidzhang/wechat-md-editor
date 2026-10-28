// Scroll following: end pinning, monotonicity, toggle off, mirror cleanup.
import { PAGE, connect } from './cdp.mjs';

const { ws, send, evaluate } = await connect();

await send('Page.enable');
await send('Page.navigate', { url: PAGE });
await new Promise((r) => setTimeout(r, 1400));
await evaluate(`(() => { try { localStorage.clear(); } catch (e) {} })()`);
await send('Page.reload');
await new Promise((r) => setTimeout(r, 1500));

const out = {};

out.setup = await evaluate(`(() => {
  const ta = document.getElementById('editor');
  const rows = [];
  for (let i = 0; i < 40; i++) {
    rows.push('## 第 ' + i + ' 节');
    rows.push('');
    rows.push('这是第 ' + i + ' 节的正文，用来把文档撑长，检查滚动跟随是否按块推进。');
    rows.push('');
    rows.push('- 条目 A' + i);
    rows.push('- 条目 B' + i);
    rows.push('');
  }
  ta.value = rows.join('\\n');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return { chars: ta.value.length };
})()`);
await new Promise((r) => setTimeout(r, 700));

out.copyClean = await evaluate(`(() => {
  const r = MdWx.render(document.getElementById('editor').value, {});
  return {
    hasDataLine: /data-line/.test(r.html),
    hasHidden: /display:\\s*none|visibility:\\s*hidden|aria-hidden/.test(r.html),
    hasSyncAttr: /data-sync/.test(r.html),
    htmlLen: r.html.length
  };
})()`);

async function step(frac) {
  return evaluate(`(async () => {
    const ta = document.getElementById('editor');
    const stage = document.getElementById('stage');
    ta.scrollTop = Math.round((ta.scrollHeight - ta.clientHeight) * ${frac});
    ta.dispatchEvent(new Event('scroll'));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const root = document.getElementById('preview').firstElementChild;
    const blocks = [...root.children];
    const stageRect = stage.getBoundingClientRect();
    let best = null;
    blocks.forEach((n, i) => {
      const d = Math.abs(n.getBoundingClientRect().top - stageRect.top);
      if (!best || d < best.d) best = { i, d, text: (n.textContent || '').trim().slice(0, 14) };
    });
    return {
      editorFrac: ${frac},
      editorScrollTop: ta.scrollTop,
      stageScrollTop: Math.round(stage.scrollTop),
      stageMax: Math.round(stage.scrollHeight - stage.clientHeight),
      nearestBlock: best && best.text,
      blockCount: blocks.length
    };
  })()`);
}

out.steps = [];
for (const f of [0, 0.15, 0.35, 0.55, 0.75, 0.9, 1]) {
  out.steps.push(await step(f));
}

out.monotonic = out.steps.every((s, i) => i === 0 || s.stageScrollTop >= out.steps[i - 1].stageScrollTop - 1);
out.startsAtTop = out.steps[0].stageScrollTop < 8;
out.reachesBottom = await evaluate(`(() => {
  const stage = document.getElementById('stage');
  return Math.abs((stage.scrollHeight - stage.clientHeight) - stage.scrollTop) < 2;
})()`);

out.frozen = await evaluate(`(async () => {
  const box = document.getElementById('followScroll');
  box.checked = false;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  const stage = document.getElementById('stage');
  const before = stage.scrollTop;
  const ta = document.getElementById('editor');
  ta.scrollTop = 0;
  ta.dispatchEvent(new Event('scroll'));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const after = stage.scrollTop;
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  return { before: Math.round(before), after: Math.round(after), unchanged: Math.abs(before - after) < 2 };
})()`);

out.mirrorHidden = await evaluate(`(() => {
  const m = [...document.body.children].find(n => n.getAttribute('aria-hidden') === 'true');
  if (!m) return 'none';
  const cs = getComputedStyle(m);
  return {
    visibility: cs.visibility,
    left: cs.left,
    childCount: m.children.length
  };
})()`);

console.log(JSON.stringify(out, null, 1));
ws.close();
