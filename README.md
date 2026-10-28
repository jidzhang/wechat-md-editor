# 公众号编辑器（wechat-md-editor）

一个单页工具：左边写 Markdown，右边是手机宽度预览，点「复制到公众号」把带样式的正文粘到微信公众平台编辑器里。不需要构建、不联网、不依赖后端。

**纯静态站点。** 三个 `<script>` 全是相对路径，没有 fetch、没有动态 import、没有 CDN 外链，运行时不需要 Node/npm，也不需要任何后端接口。任何静态服务器都能直接跑，包括 Caddy、Nginx、GitHub Pages、对象存储。

## 部署

仓库根目录就是站点根目录，指过去即可——**没有构建步骤，不要去找 `dist`，也不要 `npm install`**（`package.json` 里没有依赖，仅用于 `npm test` 和 `npm run serve`）。

### Caddy

仓库里带了 `Caddyfile`，把域名和路径换成你的：

```caddyfile
example.com {
	root * /var/www/wechat-md-editor
	encode zstd gzip

	header {
		X-Content-Type-Options "nosniff"
		X-Frame-Options "SAMEORIGIN"
		Referrer-Policy "no-referrer"
	}

	@nocache path / /index.html /src/* /vendor/*
	header @nocache Cache-Control "no-cache"

	file_server
	respond /api/* 404
}
```

```sh
caddy validate --config Caddyfile --adapter caddyfile   # 先校验
caddy run --config Caddyfile --adapter caddyfile          # 前台试跑
```

Caddy 会自动申请并续期 HTTPS 证书。本地不想走 TLS 试跑时，把站点地址改成 `http://localhost:8080`，并在文件顶部加：

```caddyfile
{
	admin off
	auto_https off
}
```

注意：`@nocache` 用的是 `path` 匹配器，写 `*.html` 这种通配是无效的，必须逐个列举或用通配前缀（`/src/*`）。这一点我踩过。

### Nginx

```nginx
server {
    listen 80;
    root /var/www/wechat-md-editor;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* ^/(src|vendor)/ {
        add_header Cache-Control "no-cache";
    }

    location /api/ { return 404; }

    gzip on;
    gzip_types text/css application/javascript text/html;
}
```

### GitHub Pages

把仓库根目录设为发布源即可。仓库里已带一个空的 `.nojekyll`，避免 Jekyll 处理以 `_` 开头的路径。

### 部署后自检

```sh
curl -I https://你的域名/                    # 200，Content-Type: text/html
curl -I https://你的域名/vendor/marked.umd.js # 200，text/javascript，gzip
curl -I https://你的域名/src/app.js           # 200
```

三个都 200 且没有 404，就说明路径映射正确。若 `/vendor/marked.umd.js` 404，是 `root` 指错了层级（要指向含 `index.html` 的那层）。

## 用法

双击 `index.html` 用浏览器打开（Chrome / Edge），或访问部署好的地址。内容是本地草稿，会自动存在浏览器里。

1. 在左侧写或粘贴 Markdown。
2. 右侧按手机宽度（375px）实时预览。
3. 点 **复制到公众号**（或 `Ctrl/Cmd + Enter`）。
4. 到公众号后台新建图文 → 正文区域粘贴（不要粘到标题框）。

图片会渲染成一行普通正文，形如 `［封面图 · cover.png］`：前面的词来自 `![]()` 里的描述，后面的是原文里的文件名，方便你回头找到本地图片。之所以不加颜色加粗，是因为这行要你在公众号后台手动删改，普通文字最不容易把格式带到上下文。粘贴过去后删掉这行，在原处用公众号自己的「图片」按钮上传即可——公众号不接受外链图片，这一步没法绕过。

## 针对公众号的几处处理

| 问题 | 处理 |
| --- | --- |
| 公众号会丢掉 `<style>` 和 `class` | 所有样式写成内联 `style`，粘过去不掉色 |
| 公众号会重置 `h1`~`h6` 的样式 | 标题用带内联样式的 `section` + `span` 渲染 |
| 剪贴板里带 `href` 容易被过滤 | 链接默认转成文末编号，正文只留序号 |
| `https://` / `http://` 太长且不可点 | 文字和文末链接都去掉协议头 |
| 外链图片在公众号里加载不出来 | 一律换成一行带文件名的普通文字提示 |
| 中英文混排、手机窄屏 | 正文 16px、行高 1.85、`word-break` 兜底，长网址不撑破排版 |

三个链接模式：

- **文末编号**（默认）：正文标 `[1]`，文末统一列「参考链接」，最干净。
- **括号内联**：正文里直接跟 `（example.com/path）`。
- **保留可点**：输出 `<a href>`。公众号正文里的外链只有白名单域名能点，其余会被转成纯文本，所以这个模式不建议作为默认。

## 滚动跟随

左侧编辑器滚动时，右侧预览会跟到大致对应的位置，不必手动找。实现方式不是按百分比缩放：渲染结果会附带一张「顶层块 → 源码行号」的对照表，前端用一个不可见的镜像层测出每行在 textarea 里的真实位置（考虑自动换行），滚动时在相邻两个块之间插值定位。所以两侧高度差再大，同步位置也不会跑偏；首尾都做了吸附。

这张对照表只存在于 JS 内存里，**HTML 本身没有任何附加属性或隐藏元素**，复制出去的和预览里看到的完全一致。右上角「跟随滚动」可以关掉，比如你要一边改一处、一边盯住另一处。

## 章节为什么明显

二级标题是左侧 4px 主色竖线 + 加大加粗，三级标题只是加粗小标题，靠字号和留白分层。手机上看，滚动时竖线是最容易抓住的视觉锚点。主色可以在右上角改。

## 文件

```
index.html            页面（编辑器 + 预览 + 工具栏）
src/renderer.js       Markdown → 内联样式 HTML（浏览器和 Node 都能用）
src/app.js            页面交互：实时预览、复制、导入导出、草稿保存、滚动跟随
vendor/marked.umd.js  Markdown 解析器（marked v18.1.2，MIT）
Caddyfile             部署配置样例（根目录静态发布）
test/                 回归测试与浏览器验收脚本
```

## 测试

纯 Node、不需要浏览器：

```sh
npm test          # 等同于 node test/render.test.mjs
```

覆盖：链接去协议与编号、标题不输出 `h1`~`h6`、图片转普通文字提示（含文件名）、代码块缩进与转义、表格对齐、嵌套列表缩进、任务列表、CRLF 输入、软换行合并、空文档等 23 项。

浏览器侧验收需要一个静态服务和一个无头浏览器。脚本里的页面路径按脚本自身位置推导，换目录或改仓库名都不用改代码：

```sh
python -m http.server 8788 --bind 127.0.0.1

# 另一个终端（Edge 路径按你的机器改）
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  --headless=new --remote-debugging-port=9377 \
  --user-data-dir=test/edge-profile about:blank

node test/cdp-check.mjs        # 渲染结构、布局溢出、剪贴板写入
node test/contrast-probe.mjs   # 正文对比度与块间距
node test/layout-probe.mjs     # 1440→390 五个宽度的工具栏与分栏布局
node test/copy-probe.mjs       # 异步剪贴板、execCommand 回退、快捷键、大文档
node test/scroll-probe.mjs     # 滚动跟随：首尾吸附、单调性、可关闭
node test/scroll-align.mjs     # 交叉验证：预览顶部显示的章节与编辑器顶部章节一致
node test/copy-clean.mjs       # 复制内容与预览结构/样式/文本一致，无同步标记泄漏
node test/style-probe.mjs      # 计算样式快照：字号、行高、边距、边框
node test/final-check.mjs      # 存储、默认值、提示、CRLF、渲染耗时
node test/shot.mjs             # 截图（写到 test/shot-*.png）
```

CDP 端口默认 `9377`，可用环境变量 `CDP_PORT` 覆盖；页面地址默认是本地 `index.html` 的 `file://` URL，可用 `PAGE_URL` 覆盖成 http 地址。

## 为什么没直接用现成开源项目

调研过的几个：

- **doocs/md**（13k stars）：功能最全，支持公式、Mermaid、图床、AI 助手，但依赖 pnpm 构建，界面偏重，主题是成套预设，想要"简洁朴素 + 章节明显"得自己改主题。
- **lyricat/wechat-format**（4.6k stars）：思路对（链接转参考文献、修 `ul`/`ol` 被重置的问题），**但已停止维护**，作者指向了商业产品。
- **mdnice/markdown-nice**（4.7k stars）：GPL-3.0，样式偏花哨。

所以这里的做法是：解析交给 MIT 的 marked（本地 vendored，离线可用），渲染器和页面自己写，样式按需定制，总共约 800 行，随时能改。

## 数据存放

草稿和界面设置存在浏览器 localStorage，键名是 `wechat-md-editor:draft` 和 `wechat-md-editor:settings`。换浏览器或清理站点数据会丢失，重要稿件建议用「导出」存成 `.md`。

## 已知限制

- 不做代码语法高亮（公众号里高亮容易掉色，纯灰底更稳）。
- 不做数学公式和 Mermaid。
- 不支持粘贴图片，图片走「文字提示 + 后台手动上传」的流程。
- 表格在极窄屏（<340px）会横向挤压，公众号里通常够用。
- 项目名与微信公众平台自带的编辑器同名，是本仓库的英文名 `wechat-md-editor` 的直译；不是官方工具。
- 草稿存在浏览器 localStorage，换浏览器/设备或清理站点数据会丢；不跨设备同步。重要稿件用「导出」存 `.md`。
- 依赖 `navigator.clipboard` 写富文本。首次复制时浏览器可能弹出剪贴板权限询问；`http://` 非本机地址不是安全上下文，该 API 不可用时会自动回退到 `execCommand`，功能仍可用但样式保真度略低。**所以线上务必走 HTTPS**（Caddy 默认就会）。

## 许可

MIT。`vendor/marked.umd.js` 是 marked 原样副本，遵循其 MIT 许可（见 `vendor/LICENSE-marked.txt`）。
