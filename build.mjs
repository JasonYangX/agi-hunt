#!/usr/bin/env node
/* ============================================================
 * AGI Hunt — 静态预渲染构建
 *
 * 作用：把 index.html 这份外壳，按路由复制成一份份带完整正文、
 * 独立 title / description / canonical / JSON-LD 的静态 HTML。
 * 每条工具、每个分类、每款开发者工具都有真实可收录的 URL。
 *
 * 特点：
 *   - 零依赖，只用 Node 内置模块（>= 18）
 *   - 数据直接读 assets/js/data.js，元信息直接读 assets/js/seo.js
 *     与浏览器端共用同一份规则，不会出现「页面内是 A、抓取到是 B」
 *   - 产物写在 dist/，源目录保持干净
 *
 * 用法：node build.mjs
 * ============================================================ */
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const SITE = 'https://www.agihunt.cn';

/* ---------------- 载入站点数据（与浏览器同一份文件） ---------------- */
function loadSite() {
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of ['assets/js/data.js', 'assets/js/seo.js']) {
    vm.runInContext(readFileSync(join(ROOT, file), 'utf8'), sandbox, { filename: file });
  }
  if (!sandbox.AGI || !sandbox.AGI_SEO) throw new Error('数据文件加载失败：AGI 或 AGI_SEO 为空');
  return { AGI: sandbox.AGI, SEO: sandbox.AGI_SEO };
}

const { AGI, SEO } = loadSite();
const CATS = AGI.CATEGORIES;
const TOOLS = AGI.TOOLS;
const DEVTOOLS = AGI.DEVTOOLS;
const HUBS = SEO.HUBS || [];
const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));
const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
const HUB_BY_TAG = Object.fromEntries(HUBS.map((h) => [h.tag, h]));

/* ---------------- 深度内容（仅构建期读取，不打包进 dist） ----------------
 * 缺失时整站照常构建，只是工具页少几段正文。 */
function loadContent() {
  const file = join(ROOT, 'content/tools.js');
  if (!existsSync(file)) return {};
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(file, 'utf8'), sandbox, { filename: 'content/tools.js' });
  return sandbox.AGI_CONTENT || {};
}
const CONTENT = loadContent();

/* ---------------- 基础工具 ---------------- */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
const json = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

function hashOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 1000;
  return h;
}
function hueOf(tool) {
  const base = CAT[tool.cat] ? CAT[tool.cat].hue : 220;
  return (base + (hashOf(tool.name) % 36) - 18 + 360) % 360;
}
const priceLabel = (p) => SEO.priceLabel(p);
const catName = (id) => SEO.catName(id);
const platformsText = (t) => SEO.platformLabel(t.platforms);

/* ---------------- 路由元信息 ---------------- */
const ctxOf = {
  home: () => ({ kind: 'home' }),
  category: (cat) => ({ kind: 'category', cat }),
  tool: (tool) => ({ kind: 'tool', tool }),
  devIndex: () => ({ kind: 'devIndex' }),
  dev: (dev) => ({ kind: 'dev', dev }),
  about: () => ({ kind: 'about' }),
  favorites: () => ({ kind: 'favorites' }),
  notfound: () => ({ kind: 'notfound' })
};

/* ---------------- 页面外壳 ---------------- */
const shell = readFileSync(join(ROOT, 'index.html'), 'utf8');
const MAIN_SLOT = '<main id="app" tabindex="-1"></main>';

function renderPage({ ctx, body, noindex = false, structured = [] }) {
  const title = SEO.title(ctx);
  const description = SEO.description(ctx);
  const canonical = SITE + SEO.canonical(ctx);
  const robots = noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large';

  let html = shell
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[\s\S]*?">/, () => `<meta name="description" content="${esc(description)}">`)
    .replace(/<meta property="og:title" content="[\s\S]*?">/, () => `<meta property="og:title" content="${esc(title)}">`)
    .replace(/<meta property="og:description" content="[\s\S]*?">/, () => `<meta property="og:description" content="${esc(description)}">`)
    .replace(/<meta property="og:url" content="[\s\S]*?">/, () => `<meta property="og:url" content="${canonical}">`)
    .replace(/<link rel="canonical" href="[\s\S]*?">/, () => `<link rel="canonical" href="${canonical}">`)
    .replace(/<meta name="robots" content="[\s\S]*?">/, () => `<meta name="robots" content="${robots}">`);

  const ld = structured
    .filter(Boolean)
    .map((o) => `<script type="application/ld+json">${json(o)}</script>`)
    .join('\n');
  if (ld) html = html.replace('</head>', () => `${ld}\n</head>`);

  if (!html.includes(MAIN_SLOT)) throw new Error('index.html 中未找到 <main id="app"> 插槽');
  return html.replace(MAIN_SLOT, () => `<main id="app" tabindex="-1">${body}</main>`);
}

/* ---------------- 结构化数据 ---------------- */
function websiteLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SEO.BRAND,
    alternateName: 'AGI Hunt · AI 工具导航',
    url: SITE + '/',
    inLanguage: 'zh-CN',
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: SITE + '/?q={search_term_string}' },
      'query-input': 'required name=search_term_string'
    }
  };
}

function breadcrumbLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: SITE + it.path
    }))
  };
}

const APP_CATEGORY = {
  image: 'MultimediaApplication',
  design: 'MultimediaApplication',
  video: 'MultimediaApplication',
  audio: 'MultimediaApplication',
  code: 'DeveloperApplication',
  productivity: 'BusinessApplication',
  learn: 'EducationalApplication'
};

function toolLd(t) {
  const node = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: t.name,
    description: t.desc,
    url: t.url,
    applicationCategory: APP_CATEGORY[t.cat] || 'WebApplication',
    operatingSystem: platformsText(t) || 'Web',
    inLanguage: t.lang,
    publisher: { '@type': 'Organization', name: t.vendor }
  };
  if (t.pricing === 'free') {
    node.offers = { '@type': 'Offer', price: '0', priceCurrency: 'CNY', availability: 'https://schema.org/InStock' };
  }
  return node;
}

function devLd(d) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: d.name,
    description: d.desc,
    url: SITE + '/dev/' + d.id + '/',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
    isAccessibleForFree: true
  };
}

function faqLd(c) {
  if (!c || !c.faq || !c.faq.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: c.faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a }
    }))
  };
}

function orgLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SEO.BRAND,
    url: SITE + '/',
    description: '中文 AI 工具索引：按任务分类收录对话、写作、图像、视频、音频、编程、Agent、MCP 等方向的工具，并提供本地运行的开发者工具。'
  };
}

function homeItemListLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'AI 工具分类',
    numberOfItems: CATS.length,
    itemListElement: CATS.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      url: SITE + '/category/' + c.id + '/'
    }))
  };
}

/* ---------------- 版式片段 ---------------- */
function crumbs(items) {
  return (
    '<nav aria-label="面包屑" style="font-size:12px;color:var(--text-3,#868C99);margin-bottom:14px">' +
    items
      .map((it, i) => {
        const sep = i ? '<span style="margin:0 6px">/</span>' : '';
        return it.path
          ? `${sep}<a href="${it.path}" style="color:inherit">${esc(it.name)}</a>`
          : `${sep}<span>${esc(it.name)}</span>`;
      })
      .join('') +
    '</nav>'
  );
}

function pageHead({ eyebrow, h1, lede, extra = '' }) {
  return (
    '<section class="page-head"><div class="container">' +
    '<div class="page-head-copy">' +
    (eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : '') +
    `<h1>${esc(h1)}</h1>` +
    `<p>${esc(lede)}</p>` +
    '</div>' +
    (extra || '') +
    '</div></section>'
  );
}

function catChips(activeId) {
  return (
    '<nav aria-label="按分类浏览" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:20px">' +
    `<a class="chip${!activeId ? ' is-on' : ''}" href="/">全部 ${TOOLS.length}</a>` +
    CATS.map((c) => {
      const n = TOOLS.filter((t) => t.cat === c.id).length;
      return `<a class="chip${activeId === c.id ? ' is-on' : ''}" href="/category/${c.id}/">${esc(c.name)}<span style="opacity:.55;margin-left:6px">${n}</span></a>`;
    }).join('') +
    '</nav>'
  );
}

function card(t) {
  const initial = (t.name || '?').trim().charAt(0).toUpperCase();
  return (
    '<article class="tool-card">' +
    '<div class="tc-top">' +
    `<span class="mono-mark" style="--h:${hueOf(t)}" aria-hidden="true"><span class="logo-initial">${esc(initial)}</span></span>` +
    '<div class="tc-id">' +
    `<h3><a class="tc-title" href="/tool/${t.id}/">${esc(t.name)}</a></h3>` +
    `<div class="vendor">${esc(t.vendor)} · ${esc(catName(t.cat))}</div>` +
    '</div>' +
    '</div>' +
    `<p class="tc-desc">${esc(t.desc)}</p>` +
    '<div class="tc-tags">' + t.tags.slice(0, 3).map((x) => `<span>${esc(x)}</span>`).join('') + '</div>' +
    '<div class="tc-foot">' +
    `<span class="badge badge-${esc(t.pricing)}">${esc(priceLabel(t.pricing))}</span>` +
    `<a class="visit" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">访问官网</a>` +
    '</div>' +
    '</article>'
  );
}

function grid(list) {
  return `<div class="tool-grid">${list.map(card).join('')}</div>`;
}

/* ---------------- 各页面正文 ---------------- */
function homeBody() {
  return (
    '<div class="page-enter">' +
    pageHead({
      eyebrow: 'AI TOOL INDEX · 2026',
      h1: 'AI 工具库',
      lede:
        `AGI Hunt 是一个中文 AI 工具导航：收录 ${TOOLS.length} 个经过筛选的工具与站点，覆盖对话、创作、编程、Agent 技能、MCP 服务与 AI 学习。` +
        '支持关键词、分类、定价与标签交叉检索。',
      extra: catChips(null)
    }) +
    '<section class="section"><div class="container">' +
    `<h2 style="font-size:19px;margin:0 0 16px">全部工具（${TOOLS.length}）</h2>` +
    grid(TOOLS) +
    '</div></section></div>'
  );
}

function categoryBody(cat) {
  const list = TOOLS.filter((t) => t.cat === cat.id);
  const h1Text = SEO.h1({ kind: 'category', cat });
  const copy = (SEO.CAT_SEO && SEO.CAT_SEO[cat.id]) || {};
  return (
    '<div class="page-enter">' +
    '<section class="page-head"><div class="container"><div class="page-head-copy">' +
    crumbs([{ name: 'AI 工具库', path: '/' }, { name: cat.name }]) +
    `<span class="eyebrow">CATEGORY · ${esc(cat.name)}</span>` +
    `<h1>${esc(h1Text)}</h1>` +
    `<p>${esc(cat.desc)}。共 ${list.length} 个工具，可按定价与标签进一步筛选，点击卡片查看详情与官网入口。</p>` +
    '</div>' + catChips(cat.id) + '</div></section>' +
    '<section class="section"><div class="container">' +
    `<h2 style="font-size:19px;margin:0 0 16px">${esc(cat.name)}工具列表（${list.length}）</h2>` +
    grid(list) +
    '</div></section>' +
    (copy.intro || (copy.pick && copy.pick.length)
      ? '<section class="section"><div class="container"><div class="prose">' +
        `<h2>${esc(cat.name)}怎么选</h2>` +
        (copy.intro ? `<p>${esc(copy.intro)}</p>` : '') +
        (copy.pick && copy.pick.length
          ? '<h3>按场景对号入座</h3><ol>' + copy.pick.map((p) => `<li>${esc(p)}</li>`).join('') + '</ol>'
          : '') +
        `<h3>${esc(cat.name)}工具速览</h3>` +
        '<ul>' +
        list
          .map(
            (t) =>
              `<li><a href="/tool/${t.id}/">${esc(t.name)}</a>（${esc(t.vendor)}，${esc(priceLabel(t.pricing))}）— ${esc(t.tagline)}</li>`
          )
          .join('') +
        '</ul>' +
        `<p>以上 ${list.length} 个条目按收录时间排列。定价与平台支持会随时间调整，实际权益以各产品官网为准。</p>` +
        '</div></div></section>'
      : '') +
    '</div>'
  );
}

function toolBody(t) {
  const alt = TOOLS.filter((x) => x.cat === t.cat && x.id !== t.id).slice(0, 6);
  const c = CONTENT[t.id] || {};
  const meta = [
    ['分类', catName(t.cat)],
    ['厂商', t.vendor],
    ['定价', priceLabel(t.pricing)],
    ['平台', platformsText(t)],
    ['语言', { zh: '中文', en: '英文', multi: '多语言' }[t.lang] || t.lang],
    ['收录时间', t.added]
  ];
  const faqHtml = (c.faq || [])
    .map(
      (f) =>
        '<h3>' +
        esc(f.q) +
        '</h3><p>' +
        esc(f.a) +
        '</p>'
    )
    .join('');
  return (
    '<div class="page-enter"><div class="container" style="padding-top:28px">' +
    crumbs([
      { name: 'AI 工具库', path: '/' },
      { name: catName(t.cat), path: `/category/${t.cat}/` },
      { name: t.name }
    ]) +
    '<article class="prose">' +
    `<h1>${esc(t.name)}</h1>` +
    `<p style="font-size:15px;color:var(--text-2,#4B505B)">${esc(t.vendor)} · ${esc(catName(t.cat))} · ${esc(priceLabel(t.pricing))}</p>` +
    `<p><strong>${esc(t.tagline)}</strong></p>` +
    `<p>${esc(t.desc)}</p>` +
    '<p><a class="btn btn-primary" href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">访问 ' + esc(t.name) + ' 官网</a></p>' +
    (c.what ? `<h2>${esc(t.name)} 是做什么的</h2><p>${esc(c.what)}</p>` : '') +
    (c.fit && c.fit.length ? '<h3>适合</h3><ul>' + c.fit.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>' : '') +
    (c.notFit && c.notFit.length ? '<h3>什么情况下别选它</h3><ul>' + c.notFit.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>' : '') +
    (c.price ? `<h3>定价与额度</h3><p>${esc(c.price)}</p>` : '') +
    (c.start && c.start.length ? '<h3>上手步骤</h3><ol>' + c.start.map((x) => `<li>${esc(x)}</li>`).join('') + '</ol>' : '') +
    (c.diff ? `<h3>${esc(t.name)} 和同类怎么选</h3><p>${esc(c.diff)}</p>` : '') +
    (faqHtml ? `<h2>常见问题</h2>${faqHtml}` : '') +
    '<h2>基本信息</h2>' +
    '<dl class="drawer-meta" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 24px">' +
    meta.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('') +
    '</dl>' +
    '<h2>标签</h2>' +
    '<div class="tag-cloud">' +
    t.tags
      .map((tag) => {
        const hub = HUB_BY_TAG[tag];
        return hub
          ? `<a class="chip" href="/tag/${hub.slug}/">${esc(tag)}</a>`
          : `<span class="chip" style="cursor:default">${esc(tag)}</span>`;
      })
      .join('') +
    '</div>' +
    (alt.length
      ? '<h2>同类工具</h2><ul>' +
        alt.map((a) => `<li><a href="/tool/${a.id}/">${esc(a.name)}</a> — ${esc(a.tagline)}</li>`).join('') +
        '</ul>'
      : '') +
    (c.updated
      ? `<p class="mono" style="margin-top:24px;font-size:12px;color:var(--text-3,#868C99)">本页信息最后核对：${esc(c.updated)}</p>`
      : '') +
    `<p style="margin-top:28px"><a href="/category/${t.cat}/">← 返回${esc(catName(t.cat))}全部工具</a></p>` +
    '</article></div></div>'
  );
}

function devIndexBody() {
  return (
    '<div class="page-enter">' +
    pageHead({
      eyebrow: 'DEVELOPER TOOLBOX',
      h1: '开发者工具箱',
      lede: `${DEVTOOLS.length} 款高频小工具，纯前端实现。数据留在本机，断网可用，无需登录。`
    }) +
    '<section class="section"><div class="container">' +
    '<h2 style="font-size:19px;margin:0 0 16px">全部工具</h2>' +
    DEVTOOLS.map(
      (d) =>
        '<article style="padding:16px 0;border-bottom:1px solid var(--line,#E3E3DC)">' +
        `<h3 style="margin:0 0 6px;font-size:16px"><a href="/dev/${d.id}/">${esc(d.name)}</a></h3>` +
        `<p style="margin:0;color:var(--text-2,#4B505B)">${esc(d.desc)}　<span style="opacity:.6">${esc(d.group)}</span></p>` +
        '</article>'
    ).join('') +
    '</div></section></div>'
  );
}

function devBody(d) {
  const others = DEVTOOLS.filter((x) => x.id !== d.id);
  const copy = SEO.DEV_SEO[d.id] || {};
  return (
    '<div class="page-enter"><div class="container" style="padding-top:28px">' +
    crumbs([{ name: '开发者工具箱', path: '/dev/' }, { name: d.name }]) +
    '<article class="prose">' +
    `<h1>${esc(d.name)}</h1>` +
    `<p style="color:var(--text-2,#4B505B)">${esc(d.group)} · 浏览器本地运行</p>` +
    `<p>${esc(d.desc)}。这个工具在浏览器内完成全部计算，输入内容不会上传到服务器，也不写入 localStorage，关闭页面即清除。</p>` +
    (copy.lead ? `<h2>使用说明</h2><p>${esc(copy.lead)}</p>` : '') +
    '<p style="padding:12px 14px;border:1px solid var(--line,#E3E3DC);border-radius:8px;font-size:13px">' +
    '交互面板需要 JavaScript 才能运行；如需断网处理敏感数据，可在首次加载后离线使用。</p>' +
    (copy.use && copy.use.length
      ? '<h2>常见用途</h2><ul>' + copy.use.map((u) => `<li>${esc(u)}</li>`).join('') + '</ul>'
      : '') +
    '<h2>其他开发者工具</h2>' +
    '<ul>' + others.map((x) => `<li><a href="/dev/${x.id}/">${esc(x.name)}</a> — ${esc(x.desc)}</li>`).join('') + '</ul>' +
    '<p style="margin-top:24px"><a href="/dev/">← 返回开发者工具箱</a></p>' +
    '</article></div></div>'
  );
}

/* 合集页：修饰词 × 品类，承接「免费 AI 工具」这类中长尾 */
function tagBody(h) {
  const list = TOOLS.filter((t) => t.tags.indexOf(h.tag) >= 0);
  const title = h.name;
  return (
    '<div class="page-enter">' +
    '<section class="page-head"><div class="container"><div class="page-head-copy">' +
    crumbs([{ name: 'AI 工具库', path: '/' }, { name: title }]) +
    `<span class="eyebrow">COLLECTION · ${esc(h.tag)}</span>` +
    `<h1>${esc(title)}</h1>` +
    `<p>共 ${list.length} 个条目，均标注定价与平台，点击卡片查看详情与官网入口。</p>` +
    '</div>' + catChips(null) + '</div></section>' +
    '<section class="section"><div class="container">' +
    `<h2 style="font-size:19px;margin:0 0 16px">${esc(title)}列表（${list.length}）</h2>` +
    grid(list) +
    '</div></section>' +
    '<section class="section"><div class="container"><div class="prose">' +
    `<h2>关于${esc(title)}</h2>` +
    `<p>${esc(h.intro)}</p>` +
    '</div></div></section>' +
    '</div>'
  );
}

function aboutBody() {
  return (
    '<div class="page-enter">' +
    pageHead({
      eyebrow: 'ABOUT',
      h1: '关于 AGI Hunt',
      lede: '一个不追热点的 AI 工具索引，以及一套不需要联网的开发者工具。'
    }) +
    '<section class="section"><div class="container"><div class="prose">' +
    '<h2>收录标准</h2>' +
    '<p>工具库不追求条目数量。一个条目被收录，通常要同时满足三点：</p>' +
    '<ul>' +
    '<li><strong>可复现的价值</strong>：能说清它解决什么问题，而不是「AI 加持」。</li>' +
    '<li><strong>可持续访问</strong>：有稳定的官网或开放接口，不是一次性 Demo。</li>' +
    '<li><strong>二次使用意愿</strong>：编辑自己会在两周内再打开它。</li>' +
    '</ul>' +
    '<p>分类按<strong>任务</strong>划分而非按模型划分。同一个工具可能同时具备多种能力，此处只标注它最常被使用的场景，避免重复收录。</p>' +
    '<h2>数据说明</h2>' +
    '<p>站点内容集中维护，每条记录包含名称、厂商、分类、简介、链接、标签、定价模式、平台与收录日期。</p>' +
    '<p>定价与功能具有时效性，标注（免费 / 免费增值 / 付费）仅作快速筛选之用，实际权益以官方页面为准。收录不构成推荐或背书。</p>' +
    '<h2>开发者工具</h2>' +
    `<p>${DEVTOOLS.length} 款工具全部在浏览器内完成计算，不上传输入内容，也不加载第三方脚本。</p>` +
    `<p><a href="/">→ 浏览全部 ${TOOLS.length} 个工具</a></p>` +
    '</div></div></section></div>'
  );
}

function favoritesBody() {
  return (
    '<div class="page-enter">' +
    pageHead({
      eyebrow: 'LOCAL ONLY',
      h1: '我的收藏',
      lede: '收藏保存在本机浏览器，不上传、不关联账号，换设备不会同步。'
    }) +
    '<section class="section"><div class="container"><div class="prose">' +
    '<p>这个页面的内容来自浏览器 localStorage，因此无法被搜索引擎索引，也不需要索引。</p>' +
    '<p>在工具卡片右上角点击星标即可收藏；回到工具库继续浏览。</p>' +
    '<p><a class="btn btn-primary" href="/">前往 AI 工具库</a></p>' +
    '</div></div></section></div>'
  );
}

function notFoundBody() {
  return (
    '<div class="page-enter">' +
    pageHead({ eyebrow: '404', h1: '页面不存在', lede: '这个地址可能已经变更，或者链接输入有误。' }) +
    '<section class="section"><div class="container"><div class="prose">' +
    '<p>可以回到 <a href="/">AI 工具库</a> 重新检索，或从 <a href="/dev/">开发者工具箱</a> 继续。</p>' +
    '<h2>常用入口</h2>' +
    '<ul>' + CATS.slice(0, 6).map((c) => `<li><a href="/category/${c.id}/">${esc(c.name)}</a></li>`).join('') + '</ul>' +
    '</div></div></section></div>'
  );
}

/* ---------------- 输出 ---------------- */
function outFile(routePath) {
  return routePath.endsWith('/') ? join(DIST, routePath, 'index.html') : join(DIST, routePath);
}

const pages = [];

function emit(routePath, html) {
  const file = outFile(routePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html, 'utf8');
  pages.push({ path: routePath, html });
  return routePath;
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const written = [];

written.push(emit('/', renderPage({ ctx: ctxOf.home(), body: homeBody(), structured: [websiteLd(), orgLd(), homeItemListLd()] })));

for (const cat of CATS) {
  written.push(
    emit(
      `/category/${cat.id}/`,
      renderPage({
        ctx: ctxOf.category(cat),
        body: categoryBody(cat),
        structured: [
          breadcrumbLd([{ name: 'AI 工具库', path: '/' }, { name: cat.name, path: `/category/${cat.id}/` }]),
          {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: SEO.title(ctxOf.category(cat)),
            description: SEO.description(ctxOf.category(cat)),
            url: SITE + `/category/${cat.id}/`,
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: TOOLS.filter((t) => t.cat === cat.id).length,
              itemListElement: TOOLS.filter((t) => t.cat === cat.id).map((t, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                name: t.name,
                url: SITE + `/tool/${t.id}/`
              }))
            }
          }
        ]
      })
    )
  );
}

/* 合集页：与分类页同级，进入 sitemap 与内链体系 */
for (const h of HUBS) {
  const list = TOOLS.filter((t) => t.tags.indexOf(h.tag) >= 0);
  written.push(
    emit(
      `/tag/${h.slug}/`,
      renderPage({
        ctx: { kind: 'tag', tag: h },
        body: tagBody(h),
        structured: [
          breadcrumbLd([{ name: 'AI 工具库', path: '/' }, { name: h.name, path: `/tag/${h.slug}/` }]),
          {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: SEO.title({ kind: 'tag', tag: h }),
            description: SEO.description({ kind: 'tag', tag: h }),
            url: SITE + `/tag/${h.slug}/`,
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: list.length,
              itemListElement: list.map((t, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                name: t.name,
                url: SITE + `/tool/${t.id}/`
              }))
            }
          }
        ]
      })
    )
  );
}

for (const t of TOOLS) {
  written.push(
    emit(
      `/tool/${t.id}/`,
      renderPage({
        ctx: ctxOf.tool(t),
        body: toolBody(t),
        structured: [
          breadcrumbLd([
            { name: 'AI 工具库', path: '/' },
            { name: catName(t.cat), path: `/category/${t.cat}/` },
            { name: t.name, path: `/tool/${t.id}/` }
          ]),
          toolLd(t),
          faqLd(CONTENT[t.id])
        ]
      })
    )
  );
}

written.push(
  emit('/dev/', renderPage({
    ctx: ctxOf.devIndex(),
    body: devIndexBody(),
    structured: [
      breadcrumbLd([{ name: 'AI 工具库', path: '/' }, { name: '开发者工具箱', path: '/dev/' }]),
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        numberOfItems: DEVTOOLS.length,
        itemListElement: DEVTOOLS.map((d, i) => ({
          '@type': 'ListItem', position: i + 1, name: d.name, url: SITE + `/dev/${d.id}/`
        }))
      }
    ]
  }))
);

for (const d of DEVTOOLS) {
  written.push(
    emit(
      `/dev/${d.id}/`,
      renderPage({
        ctx: ctxOf.dev(d),
        body: devBody(d),
        structured: [
          breadcrumbLd([
            { name: '开发者工具箱', path: '/dev/' },
            { name: d.name, path: `/dev/${d.id}/` }
          ]),
          devLd(d)
        ]
      })
    )
  );
}

written.push(emit('/about/', renderPage({ ctx: ctxOf.about(), body: aboutBody() })));
written.push(emit('/favorites/', renderPage({ ctx: ctxOf.favorites(), body: favoritesBody(), noindex: true })));
written.push(emit('/404.html', renderPage({ ctx: ctxOf.notfound(), body: notFoundBody(), noindex: true })));

/* ---------------- 站点级文件 ---------------- */
/* robots.txt 以仓库根目录的文件为准，构建时原样复制，避免规则两处漂移 */
cpSync(join(ROOT, 'robots.txt'), join(DIST, 'robots.txt'));

/* IndexNow 密钥文件：根目录下 32 位十六进制 .txt 原样放到站点根，供 Bing / Yandex 校验 */
for (const f of readdirSync(ROOT)) {
  if (/^[a-f0-9]{32}\.txt$/.test(f)) cpSync(join(ROOT, f), join(DIST, f));
}

const today = new Date().toISOString().slice(0, 10);

/* 站点级最后更新时间：优先取内容源文件最后一次 git 提交日期，非 git 环境退回文件 mtime。
 * 不使用 today —— 每次构建都把全部 URL 标成「今天更新」，会让 lastmod 变成噪音，
 * 抓取端会直接忽略它。 */
function gitDate(paths) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', ...paths], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch (e) {
    /* 非 git 环境，继续走 mtime */
  }
  let latest = '';
  for (const f of paths) {
    try {
      const d = new Date(statSync(join(ROOT, f)).mtime).toISOString().slice(0, 10);
      if (d > latest) latest = d;
    } catch (e) {
      /* 文件不存在时跳过 */
    }
  }
  return latest || today;
}
const SITE_UPDATED = gitDate(['assets/js/data.js', 'assets/js/seo.js', 'content/tools.js', 'build.mjs']);

function lastmodOf(routePath) {
  const m = /^\/tool\/([^/]+)\/$/.exec(routePath);
  if (m && CONTENT[m[1]] && CONTENT[m[1]].updated) return CONTENT[m[1]].updated;
  return SITE_UPDATED;
}

/* sitemap 与 urls.txt 共用同一份可收录集合：排除 noindex 的 404 与收藏页 */
const indexable = written.filter((p) => p !== '/404.html' && p !== '/favorites/');
const sitemapEntries = indexable
  .map((p) => `  <url><loc>${SITE + p}</loc><lastmod>${lastmodOf(p)}</lastmod></url>`)
  .join('\n');

writeFileSync(
  join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries}\n</urlset>\n`,
  'utf8'
);

/* 纯文本 URL 清单，供站长平台/IndexNow 等批量提交使用，与 sitemap 同源同序 */
writeFileSync(
  join(DIST, 'urls.txt'),
  indexable.map((p) => SITE + p).join('\n') + '\n',
  'utf8'
);

/* 静态资源与域名配置 */
cpSync(join(ROOT, 'assets'), join(DIST, 'assets'), { recursive: true });
try {
  cpSync(join(ROOT, 'CNAME'), join(DIST, 'CNAME'));
} catch (e) {
  /* CNAME 可缺省 */
}

/* ---------------- 构建后自检 ---------------- */
const issues = [];
const thin = [];
const seenTitles = new Map();
const routes = new Set(pages.map((p) => p.path));

for (const page of pages) {
  const title = (page.html.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
  if (!title) issues.push(`${page.path} 缺少 <title>`);
  else if (seenTitles.has(title)) issues.push(`title 重复：${page.path} 与 ${seenTitles.get(title)}`);
  else seenTitles.set(title, page.path);

  if (title && SEO.width(title) > 62) issues.push(`${page.path} 的 title 显示宽度 ${SEO.width(title)}（上限 62，约 31 个汉字）`);

  const h1s = (page.html.match(/<h1[\s>]/g) || []).length;
  if (h1s !== 1) issues.push(`${page.path} 的 h1 数量为 ${h1s}`);

  /* 正文厚度：剥掉标签后数汉字。工具页低于 500 字，很难在「工具名 + 用途」这类词上
   * 超过已有站点；分类页有 intro 与工具速览，底线按 600 字。 */
  const mainHtml = (/<main id="app"[^>]*>([\s\S]*?)<\/main>/.exec(page.html) || [])[1] || '';
  const plain = mainHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const cjk = (plain.match(/[\u4e00-\u9fff]/g) || []).length;
  if (page.path.startsWith('/tool/') && cjk < 500) thin.push({ path: page.path, cjk, need: 500, where: 'content/tools.js' });
  if (page.path.startsWith('/category/') && cjk < 600) thin.push({ path: page.path, cjk, need: 600, where: 'seo.js 的 CAT_SEO.intro' });

  if (!/rel="canonical"/.test(page.html)) issues.push(`${page.path} 缺少 canonical`);
  if (/href="#\//.test(page.html)) issues.push(`${page.path} 仍含 hash 路由链接`);
  if (/href="\/[^"]*\?tags=/.test(page.html)) issues.push(`${page.path} 仍含 ?tags= 参数内链`);

  for (const m of page.html.matchAll(/href="(\/[^"#?]*)"/g)) {
    const href = m[1];
    if (href.startsWith('/assets/')) continue;
    if (!routes.has(href)) issues.push(`${page.path} 链接指向未生成的页面：${href}`);
  }
}

console.log(`构建完成：${pages.length} 个 HTML 页面 · ${CATS.length} 个分类 · ${TOOLS.length} 条工具 · ${DEVTOOLS.length} 款开发工具`);
console.log(`输出目录：${DIST}`);
console.log(`sitemap / urls.txt：${indexable.length} 条 URL · 内容基准日 ${SITE_UPDATED}`);
console.log(`深度内容：${Object.keys(CONTENT).length} / ${TOOLS.length} 条工具页已补齐`);
if (issues.length) {
  console.warn(`\n结构自检发现 ${issues.length} 处问题：`);
  for (const i of issues.slice(0, 20)) console.warn(`  - ${i}`);
  if (issues.length > 20) console.warn(`  ... 其余 ${issues.length - 20} 处省略`);
} else {
  console.log('结构自检通过：title 唯一且不超宽、h1 唯一、canonical 齐备、无参数内链、内链可达');
}
if (thin.length) {
  const toolThin = thin.filter((x) => x.path.startsWith('/tool/'));
  const catThin = thin.filter((x) => x.path.startsWith('/category/'));
  console.log(`内容缺口：工具页 ${toolThin.length} 个、分类页 ${catThin.length} 个待补正文`);
  for (const x of thin.slice(0, 6)) console.log(`  · ${x.path} 当前 ${x.cjk} 字 → 目标 ${x.need} 字（写 ${x.where}）`);
    if (thin.length > 6) console.log(`  · 其余 ${thin.length - 6} 个页面待补，补齐优先级见 docs/seo-strategy.md`);
}
