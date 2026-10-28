/* Editor shell: live preview, persistence, copy to WeChat. */
(function () {
  'use strict';

  var STORAGE_KEY = 'wechat-md-editor:draft';
  var SETTINGS_KEY = 'wechat-md-editor:settings';

  var el = {
    editor: document.getElementById('editor'),
    preview: document.getElementById('preview'),
    stage: document.getElementById('stage'),
    counter: document.getElementById('counter'),
    stats: document.getElementById('stats'),
    hint: document.getElementById('hint'),
    fontSize: document.getElementById('fontSize'),
    accent: document.getElementById('accent'),
    linkMode: document.getElementById('linkMode'),
    hideH1: document.getElementById('hideH1'),
    followScroll: document.getElementById('followScroll'),
    copyBtn: document.getElementById('copyBtn'),
    loadSample: document.getElementById('loadSample'),
    importBtn: document.getElementById('importBtn'),
    exportBtn: document.getElementById('exportBtn'),
    fileInput: document.getElementById('fileInput'),
    toast: document.getElementById('toast')
  };

  var SAMPLE = [
    '# 用 Markdown 写公众号',
    '',
    '把左侧当草稿纸，右边就是文章在手机上的样子。写完点**复制到公众号**，',
    '正文会带着样式一起粘过去。',
    '',
    '## 为什么不用现成的排版工具',
    '',
    '公众号编辑器会丢掉 `<style>` 和 class，所以这里所有样式都写成内联属性，',
    '粘过去不会被还原成白底黑字。',
    '',
    '### 三条约定',
    '',
    '1. 章节用二级标题，左侧竖线是视觉锚点',
    '2. 图片位置留一行普通文字，到公众号里再上传替换',
    '3. 链接转成文末编号，正文里不出现长网址',
    '',
    '> 短句多分段，手机上更好读。',
    '',
    '## 图片占位',
    '',
    '![封面：山路上的清晨](cover.png)',
    '',
    '## 代码与表格',
    '',
    '```js',
    'const copy = (html) => navigator.clipboard.write([',
    '  new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }) })',
    ']);',
    '```',
    '',
    '| 语法 | 效果 |',
    '|:--|:--|',
    '| `**粗体**` | 强调重点 |',
    '| `> 引用` | 弱化背景信息 |',
    '',
    '## 参考',
    '',
    '例如这份 [Markdown 语法说明](https://commonmark.org/help/) 和 [marked 文档](https://marked.js.org/)。',
    '',
    '---',
    '',
    '完。'
  ].join('\n');

  var settings = loadSettings();
  var timer = null;
  var lastResult = { html: '', links: 0, images: 0, blocks: [] };
  var lineCache = { text: null, width: 0, lines: [] };
  var mirror = null;
  var syncFrame = null;
  function loadSettings() {
    var fallback = {
      fontSize: '16', accent: '#2f6f55', linkMode: 'footnote', hideH1: false, followScroll: true
    };
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? Object.assign(fallback, JSON.parse(raw)) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) { /* storage may be unavailable; ignore */ }
  }

  function options() {
    return {
      fontSize: parseInt(settings.fontSize, 10) || 16,
      accent: settings.accent || '#2f6f55',
      linkMode: settings.linkMode || 'footnote',
      hideH1: !!settings.hideH1
    };
  }

  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () {
      el.toast.classList.remove('show');
    }, 1800);
  }

  function update() {
    var md = el.editor.value;
    var result = MdWx.render(md, options());
    lastResult = result;
    el.preview.innerHTML = result.html;

    el.counter.textContent = md.length + ' 字';

    var bits = [];
    if (result.links) bits.push(result.links + ' 个链接');
    if (result.images) bits.push(result.images + ' 张图占位');
    el.stats.textContent = bits.join(' · ');

    var notes = [];
    if (settings.hideH1 && /^#\s+\S/m.test(md)) {
      notes.push('一级标题已隐藏，公众号标题在编辑器里单独填写。');
    }
    if (result.images) {
      notes.push('图片位置写成了［说明 · 文件名］这一行普通文字，粘贴后删掉这行、在原处上传图片即可。');
    }
    if (result.links && settings.linkMode === 'footnote') {
      notes.push('链接已去掉 https:// 并集中到文末「参考链接」。');
    }
    el.hint.hidden = notes.length === 0;
    el.hint.innerHTML = notes.length ? '<b>提示</b><span>' + notes.join(' ') + '</span>' : '';

    try {
      localStorage.setItem(STORAGE_KEY, md);
    } catch (e) { /* ignore quota errors */ }

    requestSync();
  }

  function scheduleUpdate() {
    clearTimeout(timer);
    timer = setTimeout(update, 120);
  }

  /*
   * Scroll sync.
   *
   * The preview is laid out at phone width, so its height has no fixed ratio to
   * the textarea's. Instead of scaling by percentage, each top-level source
   * block is mapped to its preview element, and the scroll position is
   * interpolated between block starts. A hidden mirror of the textarea measures
   * where every source line actually sits after wrapping.
   */
  function ensureMirror() {
    if (mirror) return mirror;
    mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    mirror.style.cssText = 'position:absolute;top:0;left:-9999px;visibility:hidden;' +
      'pointer-events:none;z-index:-1;';
    document.body.appendChild(mirror);
    return mirror;
  }

  var MIRROR_PROPS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
    'wordSpacing', 'textTransform', 'textIndent', 'paddingTop', 'paddingRight',
    'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth',
    'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'tabSize', 'textRendering'
  ];

  function measureLines(text, width) {
    if (lineCache.text === text && lineCache.width === width) return lineCache.lines;

    var box = ensureMirror();
    var cs = getComputedStyle(el.editor);
    MIRROR_PROPS.forEach(function (prop) {
      box.style[prop] = cs[prop];
    });
    box.style.width = width + 'px';
    box.style.height = 'auto';
    box.style.overflow = 'hidden';
    box.style.whiteSpace = 'pre-wrap';
    box.style.wordBreak = 'break-word';
    box.style.overflowWrap = 'break-word';

    box.textContent = '';
    var frag = document.createDocumentFragment();
    text.split('\n').forEach(function (line) {
      var row = document.createElement('div');
      // A zero-width space gives empty lines the same height as a real line.
      row.textContent = line === '' ? '\u200b' : line;
      frag.appendChild(row);
    });
    box.appendChild(frag);

    var lines = [];
    for (var i = 0; i < box.children.length; i++) {
      var row = box.children[i];
      lines.push({ top: row.offsetTop, height: row.offsetHeight });
    }

    // Release the thousands of probe nodes; only the measurements are kept.
    box.textContent = '';

    lineCache = { text: text, width: width, lines: lines };
    return lines;
  }

  function lineAtY(lines, y) {
    if (!lines.length) return 0;
    var lo = 0;
    var hi = lines.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (lines[mid].top + lines[mid].height > y) hi = mid;
      else lo = mid + 1;
    }
    var row = lines[lo];
    var frac = (y - row.top) / Math.max(1, row.height);
    return lo + Math.min(1, Math.max(0, frac));
  }

  // Top-level preview elements, grouped by the source block they came from.
  function blockAnchors() {
    var blocks = lastResult.blocks || [];
    var root = el.preview.firstElementChild;
    var children = root ? root.children : [];
    var anchors = [];
    var index = 0;

    for (var i = 0; i < blocks.length; i++) {
      var node = children[index];
      index += blocks[i].count || 1;
      if (!node) break;
      anchors.push({ line: blocks[i].line, node: node });
    }
    return anchors;
  }

  function contentTop(node) {
    var stageRect = el.stage.getBoundingClientRect();
    return node.getBoundingClientRect().top - stageRect.top + el.stage.scrollTop;
  }

  function syncPreviewFromEditor() {
    if (!settings.followScroll) return;
    var blocks = lastResult.blocks || [];
    if (!blocks.length) return;

    var lines = measureLines(el.editor.value, el.editor.clientWidth);
    if (!lines.length) return;

    var anchors = blockAnchors();
    if (!anchors.length) return;

    var current = lineAtY(lines, el.editor.scrollTop);
    var i = 0;
    while (i + 1 < blocks.length && blocks[i + 1].line <= current) i++;

    var startLine = blocks[i].line;
    var endLine = i + 1 < blocks.length ? blocks[i + 1].line : lines.length;
    var span = endLine - startLine;
    var fraction = span > 0 ? Math.min(1, Math.max(0, (current - startLine) / span)) : 0;

    var max = el.stage.scrollHeight - el.stage.clientHeight;
    var editorMax = el.editor.scrollHeight - el.editor.clientHeight;
    // The editor viewport shows many lines at once, so its last scrollable
    // position never reaches the final line. Pin both ends explicitly.
    if (editorMax > 0 && el.editor.scrollTop >= editorMax - 2) {
      if (Math.abs(el.stage.scrollTop - max) < 1) return;
      el.stage.scrollTop = max;
      return;
    }
    if (el.editor.scrollTop <= 0) {
      if (el.stage.scrollTop < 1) return;
      el.stage.scrollTop = 0;
      return;
    }

    // Offsets are measured from the first block so that both ends line up.
    var origin = contentTop(anchors[0].node);
    var fromTop = contentTop(anchors[i].node) - origin;
    var toTop = i + 1 < anchors.length
      ? contentTop(anchors[i + 1].node) - origin
      : Math.max(fromTop, max);

    var target = fromTop + fraction * (toTop - fromTop);
    target = Math.max(0, Math.min(target, max));
    if (Math.abs(target - el.stage.scrollTop) < 1) return;
    el.stage.scrollTop = target;
  }

  function requestSync() {
    if (syncFrame) return;
    syncFrame = requestAnimationFrame(function () {
      syncFrame = null;
      syncPreviewFromEditor();
    });
  }

  function blockText(node, out) {
    var BLOCK = /^(P|H1|H2|H3|H4|H5|H6|SECTION|DIV|BLOCKQUOTE|PRE|LI|UL|OL|TABLE|TR|HR)$/;
    if (node.nodeType === 3) {
      out.push(node.nodeValue.replace(/\s+/g, ' '));
      return;
    }
    if (node.nodeType !== 1) return;

    var tag = node.tagName;
    if (tag === 'BR') {
      out.push('\n');
      return;
    }
    if (tag === 'CODE' && node.parentNode && node.parentNode.tagName === 'PRE') {
      out.push('\n' + node.textContent + '\n');
      return;
    }
    if (tag === 'TD' || tag === 'TH') {
      if (out.length && out[out.length - 1] !== '\n') out.push(' | ');
      out.push(node.textContent.trim());
      return;
    }
    if (tag === 'LI') {
      out.push('\n');
      node.childNodes.forEach(function (child) {
        blockText(child, out);
      });
      return;
    }

    var isBlock = BLOCK.test(tag);
    if (isBlock) out.push('\n');
    if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') {
      out.push('\n');
    }
    Array.prototype.forEach.call(node.childNodes, function (child) {
      blockText(child, out);
    });
    if (isBlock) out.push('\n');
  }

  function htmlToPlain(html) {
    var holder = document.createElement('div');
    holder.innerHTML = html;
    var out = [];
    blockText(holder, out);
    return out.join('')
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .map(function (line) {
        return line.replace(/[ \t]+/g, ' ').trim();
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function copyResultHtml() {
    var result = MdWx.render(el.editor.value, options());
    lastResult = result;
    var html = result.html;
    var plain = htmlToPlain(html);

    if (navigator.clipboard && window.ClipboardItem) {
      var item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' })
      });
      return navigator.clipboard.write([item]).then(function () {
        return 'rich';
      }).catch(function () {
        return fallbackCopy(html);
      });
    }
    return Promise.resolve(fallbackCopy(html));
  }

  function fallbackCopy(html) {
    var holder = document.createElement('div');
    holder.setAttribute('contenteditable', 'true');
    holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:600px;opacity:0;';
    holder.innerHTML = html;
    document.body.appendChild(holder);

    var range = document.createRange();
    range.selectNodeContents(holder);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    sel.removeAllRanges();
    document.body.removeChild(holder);
    return ok ? 'rich' : 'failed';
  }

  el.editor.addEventListener('input', scheduleUpdate);

  el.fontSize.addEventListener('change', function () {
    settings.fontSize = el.fontSize.value;
    saveSettings();
    update();
  });

  el.accent.addEventListener('input', function () {
    settings.accent = el.accent.value;
    saveSettings();
    update();
  });

  el.linkMode.addEventListener('change', function () {
    settings.linkMode = el.linkMode.value;
    saveSettings();
    update();
  });

  el.hideH1.addEventListener('change', function () {
    settings.hideH1 = el.hideH1.checked;
    saveSettings();
    update();
  });

  el.followScroll.addEventListener('change', function () {
    settings.followScroll = el.followScroll.checked;
    saveSettings();
    if (settings.followScroll) requestSync();
  });

  el.editor.addEventListener('scroll', requestSync, { passive: true });
  window.addEventListener('resize', function () {
    lineCache = { text: null, width: 0, lines: [] };
    requestSync();
  });

  el.copyBtn.addEventListener('click', function () {
    el.copyBtn.disabled = true;
    copyResultHtml().then(function (how) {
      el.copyBtn.disabled = false;
      if (how === 'failed') {
        toast('复制失败，请手动选中预览内容复制');
        return;
      }
      toast('已复制，去公众号正文里粘贴');
    });
  });

  el.loadSample.addEventListener('click', function () {
    if (el.editor.value.trim() && !window.confirm('载入示例会覆盖当前内容，继续？')) return;
    el.editor.value = SAMPLE;
    update();
  });

  el.importBtn.addEventListener('click', function () {
    el.fileInput.click();
  });

  el.fileInput.addEventListener('change', function () {
    var file = el.fileInput.files && el.fileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      el.editor.value = String(reader.result || '');
      update();
      toast('已导入 ' + file.name);
    };
    reader.readAsText(file, 'utf-8');
    el.fileInput.value = '';
  });

  el.exportBtn.addEventListener('click', function () {
    var blob = new Blob([el.editor.value], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var firstLine = el.editor.value.split('\n').find(function (line) {
      return line.trim();
    }) || 'article';
    var name = firstLine.replace(/^#+\s*/, '').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || 'article';
    a.href = url;
    a.download = name + '.md';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      el.copyBtn.click();
    }
  });

  el.fontSize.value = settings.fontSize;
  el.accent.value = settings.accent;
  el.linkMode.value = settings.linkMode;
  el.hideH1.checked = !!settings.hideH1;
  el.followScroll.checked = settings.followScroll !== false;

  var saved = '';
  try {
    saved = localStorage.getItem(STORAGE_KEY) || '';
  } catch (e) { /* ignore */ }

  el.editor.value = saved || SAMPLE;
  update();
})();
