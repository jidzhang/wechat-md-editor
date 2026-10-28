// Captures screenshots of the editor page through CDP.
// Usage: node test/shot.mjs [outPrefix]
import { writeFileSync } from 'node:fs';
import { PAGE, connect } from './cdp.mjs';

const prefix = process.argv[2] || 'test/shot';
const { ws, send, evaluate } = await connect();

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 980, deviceScaleFactor: 2, mobile: false
});
await send('Page.navigate', { url: PAGE });
await new Promise((r) => setTimeout(r, 1500));

// Load the built-in sample so the shots cover headings, code, table, links, image.
await evaluate(`(() => {
  window.confirm = () => true;
  try { localStorage.removeItem('wechat-md-editor:draft'); } catch (e) {}
  document.getElementById('editor').value = '';
  document.getElementById('loadSample').click();
})()`);
await new Promise((r) => setTimeout(r, 700));

const full = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${prefix}-page.png`, Buffer.from(full.data, 'base64'));

const box = await evaluate(`(() => {
  const r = document.getElementById('preview').getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
})()`);
const clip = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
  clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 900), scale: 2 }
});
writeFileSync(`${prefix}-phone-top.png`, Buffer.from(clip.data, 'base64'));

const rest = await evaluate(`(() => {
  const r = document.getElementById('preview').getBoundingClientRect();
  return { y: r.y + 900, height: Math.min(window.innerHeight, r.height - 900) };
})()`);
const clip2 = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
  clip: { x: box.x, y: rest.y, width: box.width, height: Math.max(200, rest.height), scale: 2 }
});
writeFileSync(`${prefix}-phone-bottom.png`, Buffer.from(clip2.data, 'base64'));

await send('Emulation.setDeviceMetricsOverride', {
  width: 430, height: 900, deviceScaleFactor: 2, mobile: true
});
await new Promise((r) => setTimeout(r, 500));
const mobile = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${prefix}-mobile.png`, Buffer.from(mobile.data, 'base64'));

console.log(JSON.stringify({
  box,
  files: [
    `${prefix}-page.png`,
    `${prefix}-phone-top.png`,
    `${prefix}-phone-bottom.png`,
    `${prefix}-mobile.png`
  ]
}, null, 2));
ws.close();
