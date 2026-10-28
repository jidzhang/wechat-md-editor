/*
 * Markdown -> WeChat article HTML renderer.
 * All styles are inline because the WeChat editor drops <style> blocks.
 * Works in the browser (window.MdWx) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MdWx = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULTS = {
    accent: '#2f6f55',
    fontSize: 16,
    linkMode: 'footnote', // footnote | inline | keep
    breaks: false,
    hideH1: false
  };

  var MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";

  function getMarked() {
    if (typeof globalThis !== 'undefined' && globalThis.marked) return globalThis.marked;
    if (typeof require === 'function') return require('../vendor/marked.umd.js');
    throw new Error('marked is not loaded');
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var CJK = '[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]';

  // A hard-wrapped Chinese line should not turn into a visible space in HTML,
  // which collapses newlines into one. Latin text still needs that space.
  function softBreak(text, breaks) {
    if (breaks) return text;
    return String(text).replace(new RegExp('(' + CJK + ')?\\n(' + CJK + ')?', 'g'), function (m, before, after) {
      return before && after ? before + after : (before || '') + ' ' + (after || '');
    }).replace(/^[ \t]+/gm, '');
  }

  function stripProtocol(url) {
    return String(url || '').replace(/^https?:\/\//i, '');
  }

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return [47, 111, 85];
    var v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  // Blend a color toward white. ratio 0 = original, 1 = white.
  function tint(hex, ratio) {
    var rgb = hexToRgb(hex);
    var out = rgb.map(function (c) {
      return Math.round(c + (255 - c) * ratio);
    });
    return '#' + out.map(function (c) {
      return ('0' + c.toString(16)).slice(-2);
    }).join('');
  }

  function isSafeInlineTag(raw) {
    var tag = String(raw || '').trim();
    if (/^<br\s*\/?>$/i.test(tag)) return '<br>';
    var m = /^<(\/?)(b|strong|i|em|u|sup|sub|code)>$/i.exec(tag);
    if (!m) return null;
    return '<' + m[1] + m[2].toLowerCase() + '>';
  }

  function addFootnote(ctx, href, label) {
    if (Object.prototype.hasOwnProperty.call(ctx.noteIndex, href)) {
      return ctx.noteIndex[href];
    }
    var n = ctx.footnotes.length + 1;
    ctx.noteIndex[href] = n;
    ctx.footnotes.push({ n: n, href: href, label: label || '' });
    return n;
  }

  function codeSpan(text) {
    return (
      '<code style="font-family:' + MONO + ';font-size:0.92em;background:#f4f4f0;' +
      'border:1px solid #eaeae4;border-radius:3px;padding:1px 5px;color:#9c4a3f;' +
      'word-break:break-all;">' + esc(text) + '</code>'
    );
  }

  // Images are replaced by one plain text line naming the alt text and file.
  // No color or bold: the line is edited by hand in the WeChat editor, and
  // plain text cannot drag odd formatting into the surrounding paragraphs.
  function imagePlaceholder(token, ctx, inlineMode) {
    ctx.images += 1;
    var alt = (token.text || '').trim();
    var src = stripProtocol(String(token.href || '').trim());
    var hasAlt = alt && alt !== String(token.href || '');
    var parts = [hasAlt ? alt : '图片'];
    if (src) parts.push(src);
    var label = '［' + esc(parts.join(' · ')) + '］';

    if (inlineMode) return label;

    return '<p style="' + paraStyle(ctx, 0) + '">' + label + '</p>';
  }

  function linkToken(token, ctx) {
    ctx.links += 1;
    var accent = ctx.o.accent;
    var href = token.href || '';
    var rawLabel = String(token.text || '');
    // A link whose visible text is itself a URL should not show the protocol either.
    var label = /^https?:\/\//i.test(rawLabel)
      ? esc(stripProtocol(rawLabel))
      : (token.autolink ? esc(stripProtocol(href)) : inline(token.tokens, ctx) || esc(rawLabel || href));

    if (ctx.o.linkMode === 'keep') {
      return '<a href="' + esc(href) + '" style="color:' + accent + ';text-decoration:none;">' + label + '</a>';
    }
    if (ctx.o.linkMode === 'inline') {
      var short = stripProtocol(href);
      // Autolinks already read as the URL, so a trailing parenthetical would repeat it.
      if (rawLabel === href || rawLabel === short) return label;
      return label +
        '<span style="color:#7d7d76;font-size:0.86em;word-break:break-all;">（' + esc(short) + '）</span>';
    }
    var n = addFootnote(ctx, href, rawLabel);
    return '<span style="color:' + accent + ';">' + label + '</span>' +
      '<sup style="font-size:0.8em;line-height:1;color:' + accent + ';">[' + n + ']</sup>';
  }

  function inlineToken(token, ctx) {
    if (!token) return '';
    switch (token.type) {
      case 'text':
        if (token.tokens && token.tokens.length) return inline(token.tokens, ctx);
        return esc(softBreak(token.text, ctx.o.breaks));
      case 'escape':
        return esc(token.text);
      case 'strong':
        return '<strong style="font-weight:bold;">' + inline(token.tokens, ctx) + '</strong>';
      case 'em':
        return '<em style="font-style:italic;">' + inline(token.tokens, ctx) + '</em>';
      case 'del':
        return '<del style="color:#8d8d86;">' + inline(token.tokens, ctx) + '</del>';
      case 'codespan':
        return codeSpan(token.text);
      case 'br':
        return '<br>';
      case 'link':
        return linkToken(token, ctx);
      case 'image':
        return imagePlaceholder(token, ctx, true);
      case 'checkbox':
        return token.checked ? '☑&nbsp;' : '☐&nbsp;';
      case 'html':
        return isSafeInlineTag(token.text) || esc(token.text);
      default:
        return token.tokens ? inline(token.tokens, ctx) : esc(token.text || token.raw || '');
    }
  }

  function inline(tokens, ctx) {
    if (!tokens || !tokens.length) return '';
    return tokens.map(function (t) {
      return inlineToken(t, ctx);
    }).join('');
  }

  function paraStyle(ctx, nested) {
    var size = ctx.quote ? ctx.o.fontSize - 1 : ctx.o.fontSize;
    return 'margin:0 0 ' + (nested ? 10 : 18) + 'px;font-size:' + size + 'px;' +
      'line-height:1.85;color:' + (ctx.quote ? '#5f5f59' : '#3b3b3b') +
      ';letter-spacing:0.3px;word-break:break-word;';
  }

  // A standalone image becomes its own red placeholder line; an image inside a
  // sentence stays inline so the surrounding text is not split apart.
  function paragraph(token, ctx, depth) {
    var tokens = token.tokens || [];
    var images = tokens.filter(function (t) {
      return t.type === 'image';
    });
    if (!images.length) {
      return '<p style="' + paraStyle(ctx, depth) + '">' + inline(tokens, ctx) + '</p>';
    }

    var textOnly = tokens.filter(function (t) {
      return !(t.type === 'image' || (t.type === 'text' && !String(t.text || '').trim()));
    });
    if (!textOnly.length) {
      return images.map(function (t) {
        return imagePlaceholder(t, ctx);
      }).join('');
    }
    return '<p style="' + paraStyle(ctx, depth) + '">' + inline(tokens, ctx) + '</p>';
  }

  // Headings are rendered as <section> + inline font styles on purpose:
  // the WeChat editor re-applies its own heading styles and sometimes drops
  // h1-h6 outright, while a styled section survives a paste unchanged.
  function heading(token, ctx) {
    var base = ctx.o.fontSize;
    var text = inline(token.tokens, ctx);
    var d = token.depth;

    if (d === 1) {
      if (ctx.o.hideH1) return '';
      return '<section style="margin:8px 0 26px;text-align:center;">' +
        '<span style="font-size:' + (base + 6) + 'px;line-height:1.5;font-weight:bold;' +
        'color:#161616;letter-spacing:0.5px;">' + text + '</span></section>';
    }
    if (d === 2) {
      return '<section style="margin:36px 0 16px;padding:1px 0 1px 12px;border-left:4px solid ' +
        ctx.o.accent + ';">' +
        '<span style="font-size:' + (base + 3) + 'px;line-height:1.55;font-weight:bold;' +
        'color:#161616;letter-spacing:0.3px;">' + text + '</span></section>';
    }
    if (d === 3) {
      return '<section style="margin:28px 0 12px;">' +
        '<span style="font-size:' + (base + 1) + 'px;line-height:1.6;font-weight:bold;' +
        'color:#1f1f1f;">' + text + '</span></section>';
    }
    return '<section style="margin:24px 0 10px;">' +
      '<span style="font-size:' + base + 'px;line-height:1.6;font-weight:bold;' +
      'color:#4a4a45;">' + text + '</span></section>';
  }

  function blockquote(token, ctx, depth) {
    var inner = (token.tokens || []).map(function (t) {
      var prev = ctx.quote;
      ctx.quote = true;
      var out = block(t, ctx, depth + 1);
      ctx.quote = prev;
      return out;
    }).join('');
    return '<blockquote style="margin:0 0 20px;padding:12px 16px 2px;border-left:3px solid ' +
      tint(ctx.o.accent, 0.5) + ';background:#fafaf7;color:#5f5f59;font-size:' +
      (ctx.o.fontSize - 1) + 'px;line-height:1.8;">' + inner + '</blockquote>';
  }

  function listBlock(token, ctx, depth) {
    var ordered = !!token.ordered;
    var num = ordered ? (parseInt(token.start, 10) || 1) : 1;
    var inner = (token.items || []).map(function (item) {
      var marker = ordered ? (num++) + '.' : '•';
      return listItem(item, ctx, depth, ordered, marker);
    }).join('');
    return '<section style="margin:0 0 ' + (depth ? 10 : 18) + 'px;' +
      (depth ? 'padding-left:16px;text-indent:0;' : '') + '">' + inner + '</section>';
  }

  function listItem(item, ctx, depth, ordered, marker) {
    var parts = [];
    var buf = [];

    function flush() {
      if (buf.length) {
        parts.push({ kind: 'inline', tokens: buf });
        buf = [];
      }
    }

    (item.tokens || []).forEach(function (t) {
      if (t.type === 'checkbox') return;
      if (t.type === 'space') return;
      if (t.type === 'list') {
        flush();
        parts.push({ kind: 'block', html: listBlock(t, ctx, depth + 1) });
        return;
      }
      if (t.type === 'paragraph') {
        flush();
        parts.push({ kind: 'inline', tokens: t.tokens || [] });
        return;
      }
      if (t.type === 'text') {
        buf.push(t);
        return;
      }
      flush();
      parts.push({ kind: 'block', html: block(t, ctx, depth + 1) });
    });
    flush();

    var markerWidth = ordered ? '1.7em' : '1.3em';
    var check = item.task ? (item.checked ? '☑&nbsp;' : '☐&nbsp;') : '';
    var first = true;
    var body = '';

    parts.forEach(function (p) {
      if (p.kind === 'inline') {
        var content = inline(p.tokens, ctx);
        if (first) {
          body += '<span style="display:inline-block;width:' + markerWidth +
            ';text-indent:0;color:#8c8c85;">' + marker + '</span>' + check + content;
          first = false;
        } else {
          body += '<section style="text-indent:0;">' + content + '</section>';
        }
      } else {
        if (first) {
          body += '<span style="display:inline-block;width:' + markerWidth +
            ';text-indent:0;color:#8c8c85;">' + marker + '</span>';
          first = false;
        }
        body += '<section style="text-indent:0;">' + p.html + '</section>';
      }
    });

    return '<section style="margin:0 0 8px;padding-left:' + markerWidth + ';text-indent:-' + markerWidth +
      ';font-size:' + ctx.o.fontSize + 'px;line-height:1.85;color:#3b3b3b;word-break:break-word;">' +
      body + '</section>';
  }

  function codeBlock(token, ctx) {
    var size = Math.max(12, ctx.o.fontSize - 3);
    var lines = String(token.text || '').replace(/\t/g, '    ').split('\n');
    var body = lines.map(function (line) {
      var safe = line.replace(/ /g, '\u00a0');
      return '<section style="margin:0;font-family:' + MONO + ';font-size:' + size +
        'px;line-height:1.75;white-space:pre-wrap;word-break:break-all;color:#3a3a36;">' +
        (safe ? esc(safe) : '&nbsp;') + '</section>';
    }).join('');

    var lang = String(token.lang || '').trim().split(/\s+/)[0];
    var label = lang
      ? '<section style="padding:7px 14px;border-bottom:1px solid #eaeae4;font-size:12px;' +
        'line-height:1.6;color:#8c8c85;letter-spacing:0.5px;">' + esc(lang) + '</section>'
      : '';

    return '<section style="margin:0 0 20px;background:#f7f7f3;border:1px solid #eaeae4;' +
      'border-radius:6px;">' + label +
      '<section style="padding:12px 14px;">' + body + '</section></section>';
  }

  function tableBlock(token, ctx) {
    var base = ctx.o.fontSize;
    var align = token.align || [];
    var cellSize = Math.max(12, base - 2);

    function cell(t, i, isHead) {
      var a = (t.align || align[i] || 'left');
      var style = 'border:1px solid #e4e4de;padding:8px 10px;vertical-align:top;' +
        'word-break:break-word;font-size:' + cellSize + 'px;line-height:1.7;text-align:' + a + ';' +
        (isHead ? 'background:#f7f7f3;font-weight:bold;color:#222;' : 'color:#3b3b3b;');
      return '<' + (isHead ? 'th' : 'td') + ' style="' + style + '">' +
        inline(t.tokens, ctx) + '</' + (isHead ? 'th' : 'td') + '>';
    }

    var head = '<tr style="background:#f7f7f3;">' + (token.header || []).map(function (t, i) {
      return cell(t, i, true);
    }).join('') + '</tr>';

    var rows = (token.rows || []).map(function (row) {
      return '<tr style="background:#ffffff;">' + row.map(function (t, i) {
        return cell(t, i, false);
      }).join('') + '</tr>';
    }).join('');

    return '<section style="margin:0 0 20px;">' +
      '<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;' +
      'table-layout:fixed;font-size:' + cellSize + 'px;margin:0;">' +
      '<thead style="background:#f7f7f3;">' + head + '</thead>' +
      '<tbody style="background:#ffffff;">' + rows + '</tbody></table></section>';
  }

  function footnotesBlock(ctx) {
    var items = ctx.footnotes.map(function (f) {
      var short = stripProtocol(f.href);
      var label = f.label && f.label !== f.href && f.label !== short ? esc(f.label) + '：' : '';
      return '<p style="margin:0 0 6px;padding-left:1.9em;text-indent:-1.9em;font-size:13px;' +
        'line-height:1.75;color:#75756e;word-break:break-all;">[' + f.n + '] ' + label +
        esc(short) + '</p>';
    }).join('');

    return '<section style="margin:36px 0 0;padding-top:16px;border-top:1px solid #e8e8e1;">' +
      '<p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#8c8c85;' +
      'letter-spacing:1px;">参考链接</p>' + items + '</section>';
  }

  function block(token, ctx, depth) {
    if (!token) return '';
    switch (token.type) {
      case 'space':
        return '';
      case 'heading':
        return heading(token, ctx);
      case 'paragraph':
        return paragraph(token, ctx, depth);
      case 'text':
        return '<p style="' + paraStyle(ctx, depth) + '">' +
          inline(token.tokens || [{ type: 'text', text: token.text }], ctx) + '</p>';
      case 'blockquote':
        return blockquote(token, ctx, depth);
      case 'list':
        return listBlock(token, ctx, depth);
      case 'code':
        return codeBlock(token, ctx);
      case 'table':
        return tableBlock(token, ctx);
      case 'hr':
        return '<section style="margin:28px 0;border-top:1px solid #e6e6df;"></section>';
      case 'html':
        return '';
      default:
        return '';
    }
  }

  // Count the top-level elements a block produced, so the editor UI can walk
  // preview children in step with the block list.
  var VOID_TAG = /^(br|hr|img|input|meta|link)$/i;

  function topLevelCount(html) {
    var re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
    var depth = 0;
    var count = 0;
    var m;
    while ((m = re.exec(html))) {
      var closing = m[1] === '/';
      var name = m[2];
      var selfClosing = /\/\s*$/.test(m[3]) || VOID_TAG.test(name);
      if (closing) {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth === 0) count += 1;
      if (!selfClosing) depth += 1;
    }
    return count;
  }

  function render(markdown, options) {
    var o = Object.assign({}, DEFAULTS, options || {});
    var ctx = { o: o, footnotes: [], noteIndex: {}, links: 0, images: 0 };
    var lib = getMarked();
    var blocks = [];
    var line = 0;

    try {
      var tokens = lib.lexer(String(markdown == null ? '' : markdown), {
        gfm: true,
        breaks: !!o.breaks
      });
      tokens.forEach(function (t) {
        var html = block(t, ctx, 0);
        if (html) blocks.push({ line: line, html: html });
        line += (String(t.raw || '').match(/\n/g) || []).length;
      });
    } catch (err) {
      blocks.push({
        line: 0,
        html: '<p style="' + paraStyle(ctx, 0) + 'color:#a3423a;">解析失败：' +
          esc(err && err.message ? err.message : err) + '</p>'
      });
    }

    if (o.linkMode === 'footnote' && ctx.footnotes.length) {
      blocks.push({ line: line, html: footnotesBlock(ctx) });
    }

    var body = blocks.map(function (b) {
      return b.html;
    }).join('');

    var html = '<section style="font-size:' + o.fontSize + 'px;line-height:1.85;color:#3b3b3b;' +
      'letter-spacing:0.3px;text-align:left;word-break:break-word;">' + body + '</section>';

    return {
      html: html,
      // Source line and preview element count of each top-level block. Used
      // only by the editor UI for scroll sync; the HTML itself is untouched,
      // so what is copied is exactly what is previewed.
      blocks: blocks.map(function (b) {
        return { line: b.line, count: topLevelCount(b.html) };
      }),
      footnotes: ctx.footnotes.slice(),
      links: ctx.links,
      images: ctx.images
    };
  }

  return {
    render: render,
    defaults: DEFAULTS,
    stripProtocol: stripProtocol
  };
});
