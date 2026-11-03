/* ============================================================
 * AGI Hunt — SEO 元数据
 * 站点内每一条 URL 的 title / description / canonical 都由此计算。
 * 浏览器端（app.js）与构建期（build.mjs）共用同一份规则，
 * 避免预渲染页面与客户端导航出现元信息漂移。
 * ============================================================ */
(function (root) {
  'use strict';

  var SITE = 'https://www.agihunt.cn';
  var BRAND = 'AGI Hunt';

  var PRICE = { free: '免费', freemium: '免费增值', paid: '付费' };
  var PLATFORM = {
    web: 'Web', mac: 'macOS', win: 'Windows', ios: 'iOS',
    android: 'Android', api: 'API', self: '自托管'
  };

  function priceLabel(p) { return PRICE[p] || p || ''; }
  function platformLabel(list) {
    return (list || []).map(function (p) { return PLATFORM[p] || p; }).join('、');
  }
  function catName(id) {
    var cats = (root.AGI && root.AGI.CATEGORIES) || [];
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i].name;
    return '';
  }
  function tools() { return (root.AGI && root.AGI.TOOLS) || []; }
  function devtools() { return (root.AGI && root.AGI.DEVTOOLS) || []; }

  /* 规范路径：始终以 / 结尾，与静态目录结构一致 */
  function canonical(ctx) {
    ctx = ctx || { kind: 'home' };
    switch (ctx.kind) {
      case 'category': return '/category/' + ctx.cat.id + '/';
      case 'tool': return '/tool/' + ctx.tool.id + '/';
      case 'dev': return '/dev/' + ctx.dev.id + '/';
      case 'devIndex': return '/dev/';
      case 'about': return '/about/';
      case 'favorites': return '/favorites/';
      case 'notfound': return '/404.html';
      default: return '/';
    }
  }

  function title(ctx) {
    ctx = ctx || { kind: 'home' };
    switch (ctx.kind) {
      case 'category': {
        var n = tools().filter(function (t) { return t.cat === ctx.cat.id; }).length;
        return ctx.cat.name + ' AI 工具推荐 · ' + n + ' 个可用选择 — ' + BRAND;
      }
      case 'tool':
        return ctx.tool.name + ' 是什么？' + ctx.tool.tagline + ' — ' + BRAND;
      case 'dev':
        return ctx.dev.name + '在线工具 · ' + ctx.dev.desc + ' — ' + BRAND;
      case 'devIndex':
        return '开发者工具箱 · ' + devtools().length + ' 款本地运行的在线工具 — ' + BRAND;
      case 'about':
        return '关于 ' + BRAND + ' · 收录标准、数据说明与技术栈';
      case 'favorites':
        return '我的收藏 — ' + BRAND;
      case 'notfound':
        return '页面不存在 — ' + BRAND;
      default:
        return 'AI 工具导航 · ' + tools().length + ' 个精选 AI 工具与 ' + devtools().length + ' 款开发者工具 — ' + BRAND;
    }
  }

  function description(ctx) {
    ctx = ctx || { kind: 'home' };
    switch (ctx.kind) {
      case 'category': {
        var list = tools().filter(function (t) { return t.cat === ctx.cat.id; });
        var names = list.slice(0, 5).map(function (t) { return t.name; }).join('、');
        return ctx.cat.desc + '。收录 ' + list.length + ' 个' + ctx.cat.name +
          '方向的工具，如 ' + names + ' 等；可按定价与标签进一步筛选，附官网直达入口。';
      }
      case 'tool': {
        var t = ctx.tool;
        return t.desc + ' 分类：' + catName(t.cat) + '；定价：' + priceLabel(t.pricing) +
          '；平台：' + platformLabel(t.platforms) + '；收录于 ' + t.added + '。';
      }
      case 'dev':
        return ctx.dev.desc + '。纯浏览器实现，无需登录与上传，输入内容不离开本机，断网可用。';
      case 'devIndex':
        return devtools().length + ' 款高频开发者工具：' + devtools().map(function (d) { return d.name; }).join('、') +
          '。全部在浏览器本地运行，不上传输入内容，无需登录。';
      case 'about':
        return 'AGI Hunt 的收录标准、数据来源说明、开发者工具实现方式与键盘快捷键。';
      case 'favorites':
        return '保存在本机浏览器中的 AI 工具收藏列表，不上传、不关联账号。';
      case 'notfound':
        return '请求的页面不存在，可返回 AI 工具库继续浏览。';
      default: {
        var cats = (root.AGI && root.AGI.CATEGORIES) || [];
        return 'AGI Hunt 收录 ' + tools().length + ' 个经过筛选的 AI 工具与站点，按对话、写作、图像、视频、编程、' +
          'Agent 技能、MCP 与 AI 学习等 ' + cats.length + ' 个场景分类检索；另附 ' + devtools().length +
          ' 款纯前端开发者工具，数据不出本机。';
      }
    }
  }

  root.AGI_SEO = {
    SITE: SITE,
    BRAND: BRAND,
    canonical: canonical,
    title: title,
    description: description,
    priceLabel: priceLabel,
    platformLabel: platformLabel,
    catName: catName
  };
})(typeof window !== 'undefined' ? window : globalThis);
