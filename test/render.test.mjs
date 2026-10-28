// Regression tests for the renderer. Run: node test/render.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MdWx = require('../src/renderer.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('ok   ' + name);
  } catch (err) {
    console.error('FAIL ' + name);
    console.error(err.message);
    process.exitCode = 1;
  }
}

const render = (md, opts) => MdWx.render(md, opts);
const text = (input) => String(typeof input === 'string' ? input : input.html).replace(/<[^>]+>/g, '');

test('footnote mode leaves no anchors and no protocol in text', () => {
  const r = render('看 [文档](https://example.com/a?b=1) 和 http://example.com/b');
  assert.equal(/href=/.test(r.html), false, 'href must be stripped');
  assert.equal(/https?:\/\//.test(text(r.html)), false, 'protocol must be stripped');
  assert.equal(r.links, 2);
  assert.equal(r.footnotes.length, 2);
});

test('repeated link target shares one footnote index', () => {
  const r = render('[a](https://x.com/1) [b](https://x.com/1)');
  assert.equal(r.footnotes.length, 1);
  assert.equal(r.links, 2);
  assert.equal((r.html.match(/\[1\]/g) || []).length, 3, 'two refs plus one footnote entry');
});

test('inline mode does not repeat an autolink as a parenthetical', () => {
  const r = render('见 https://example.com/p', { linkMode: 'inline' });
  assert.equal(r.html.includes('（example.com/p）'), false);
  assert.equal(text(r.html).includes('example.com/p'), true);
});

test('keep mode emits anchors with untouched urls', () => {
  const r = render('[a](https://example.com/x)', { linkMode: 'keep' });
  assert.match(r.html, /<a href="https:\/\/example\.com\/x"/);
});

test('no <style> tags or class attributes survive (WeChat drops them)', () => {
  const r = render(readFileSync(new URL('./fixture.md', import.meta.url), 'utf8'));
  assert.equal(/<style/i.test(r.html), false);
  assert.equal(/\sclass=/i.test(r.html), false);
});

test('every element carries an inline style', () => {
  const r = render(readFileSync(new URL('./fixture.md', import.meta.url), 'utf8'));
  const tags = r.html.match(/<(?!\/)[a-z][^>]*>/gi) || [];
  const missing = tags.filter((t) => !/ style="/.test(t) && !/^<br/i.test(t));
  assert.deepEqual(missing, []);
});

test('headings become styled sections, not h1-h6', () => {
  const r = render('# 一\n\n## 二\n\n### 三');
  assert.equal(/<h[1-6][\s>]/i.test(r.html), false);
  assert.equal((r.html.match(/font-weight:bold/g) || []).length >= 3, true);
});

test('hideH1 drops the top level heading only', () => {
  const r = render('# 一\n\n## 二', { hideH1: true });
  assert.equal(r.html.includes('一'), false);
  assert.equal(r.html.includes('二'), true);
});

test('images become one plain line naming the alt text and source file', () => {
  const r = render('![封面图](cover.png)');
  assert.equal(/<img/i.test(r.html), false);
  assert.equal(r.images, 1);
  assert.match(r.html, /［封面图 · cover\.png］/);
  assert.equal(/color:#c0392b|font-weight:bold[^;]*;color/.test(r.html), false, 'no red bold styling');
  assert.equal(r.html.includes('border:1px dashed'), false, 'placeholder must stay plain');
});

test('an image with no alt still names the file', () => {
  assert.match(render('![](assets/a.png)').html, /［图片 · assets\/a\.png］/);
});

test('protocol is stripped from the placeholder path', () => {
  assert.match(render('![](https://cdn.example.com/a.png)').html, /［图片 · cdn\.example\.com\/a\.png］/);
});

test('a standalone image paragraph becomes its own plain line', () => {
  const r = render('前面文字\n\n![](a.png)\n\n后面文字');
  assert.match(r.html, /<p style="margin:0 0 18px;[^"]*">［图片 · a\.png］<\/p>/);
  assert.equal(r.html.includes('前面文字'), true);
  assert.equal(r.html.includes('后面文字'), true);
});

test('an image inside a sentence stays inline instead of splitting it', () => {
  const r = render('前中后 ![](a.png) 结尾');
  assert.equal((r.html.match(/<p /g) || []).length, 1, 'the sentence keeps one paragraph');
  assert.match(r.html, /前中后 ［图片 · a\.png］结尾/);
});

test('code blocks keep indentation, escape markup and survive empty input', () => {
  const r = render('```js\nif (a < b) {\n  return "x";\n}\n```');
  assert.match(r.html, /if \(a &lt; b\)/);
  assert.equal(r.html.includes('  return'), true, 'leading spaces kept as nbsp');
  assert.equal(/<pre/i.test(r.html), false);
});

test('raw html is escaped or dropped, never executed', () => {
  const r = render('<script>alert(1)</script>\n\n段落 <img src=x onerror=1> 与 <b>允许</b>');
  assert.equal(/<script/i.test(r.html), false);
  assert.equal(/onerror/.test(r.html), true, 'text may mention it, but escaped');
  assert.equal(r.html.includes('<b>允许</b>'), true, 'b is on the allow list');
});

test('tables keep alignment and inline cell markup', () => {
  const r = render('| 左 | 中 |\n|:--|:-:|\n| **粗** | `c` |');
  assert.match(r.html, /text-align:center/);
  assert.match(r.html, /<strong style="font-weight:bold;">粗<\/strong>/);
  assert.match(r.html, /<table/);
  assert.equal(/<td[^>]*>\s*<td/.test(r.html), false);
});

test('nested lists indent each level', () => {
  const r = render('- a\n  - b\n    - c');
  const paddings = [...r.html.matchAll(/padding-left:16px/g)];
  assert.equal(paddings.length, 2, 'two nested levels add padding');
});

test('task list items render checkbox glyphs', () => {
  const r = render('- [x] 完成\n- [ ] 待办');
  assert.match(r.html, /☑/);
  assert.match(r.html, /☐/);
});

test('soft-wrapped Chinese lines join without a space, latin keeps one', () => {
  assert.equal(text(render('中文一行\n中文二行')).trim(), '中文一行中文二行');
  assert.equal(text(render('latin one\nlatin two')).trim(), 'latin one latin two');
  assert.match(render('a\nb', { breaks: true }).html, /<br>/);
});

test('crlf input renders the same as lf input', () => {
  const lf = render('# 标题\n\n- a\n- b');
  const crlf = render('# 标题\r\n\r\n- a\r\n- b');
  assert.equal(crlf.html, lf.html);
});

test('empty and whitespace-only input produce an empty shell', () => {
  assert.equal(text(render('').html).trim(), '');
  assert.equal(text(render('   \n\n ')).trim(), '');
});

test('the accent color option drives heading bars', () => {
  const r = render('## 标题', { accent: '#8c3f2f' });
  assert.match(r.html, /border-left:4px solid #8c3f2f/);
});

test('long unbroken urls do not force horizontal scroll', () => {
  const r = render('[a](https://example.com/' + 'x'.repeat(200) + ')');
  assert.match(r.html, /word-break:break-all/);
});

console.log('\n' + passed + ' checks passed' + (process.exitCode ? ', with failures' : ''));
