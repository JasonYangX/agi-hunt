/* ============================================================
 * AGI Hunt — 应用层
 * 路由 / 检索 / 筛选 / 收藏 / 详情抽屉 / 命令面板
 * 构建期预渲染静态页，运行期由浏览器接管交互。
 * ============================================================ */
(function () {
  'use strict';

  var CATS = AGI.CATEGORIES;
  var TOOLS = AGI.TOOLS;
  var DEVTOOLS = AGI.DEVTOOLS;

  var app = document.getElementById('app');
  var drawer = document.getElementById('drawer');
  var drawerBackdrop = document.getElementById('drawer-backdrop');
  var paletteBackdrop = document.getElementById('palette-backdrop');
  var paletteInput = document.getElementById('palette-input');
  var paletteResults = document.getElementById('palette-results');
  var toastRoot = document.getElementById('toast-root');
  var filterScrim = document.getElementById('filter-scrim');
  var mobileNav = document.getElementById('mobile-nav');

  var CAT_BY_ID = {};
  CATS.forEach(function (c) { CAT_BY_ID[c.id] = c; });
  var TOOL_BY_ID = {};
  TOOLS.forEach(function (t) { TOOL_BY_ID[t.id] = t; });
  var DEV_BY_ID = {};
  DEVTOOLS.forEach(function (d) { DEV_BY_ID[d.id] = d; });

  var SEO = window.AGI_SEO || null;

  var FAV_KEY = 'agihunt:favorites';
  var THEME_KEY = 'agihunt:theme';
  var DRAWER_KEY = 'agihunt:filters:drawer';
  var DEVNAV_KEY = 'agihunt:devnav:drawer';

  var favorites = loadFavorites();
  var state = {
    query: '', cat: 'all', pricing: 'all', tags: [], sort: 'recommended', view: 'grid',
    drawerPushed: false, lastPath: null
  };
  var palette = { open: false, items: [], active: 0 };
  var lastFocused = null;
  var LOGO_OK = new Set();
  var LOGO_FAIL = new Set();

  /* ---------------- 基础工具 ---------------- */
  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function loadFavorites() {
    try {
      var raw = localStorage.getItem(FAV_KEY);
      if (!raw) return new Set();
      var arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (e) { return new Set(); }
  }
  function saveFavorites() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(favorites))); } catch (e) {}
  }

  /* 左侧筛选栏：默认展开，用户收起后跨页面记住（像抽屉一样滑出） */
  function loadDrawerOpen() {
    try { return localStorage.getItem(DRAWER_KEY) !== 'closed'; } catch (e) { return true; }
  }
  var drawerOpen = loadDrawerOpen();
  function saveDrawerState() {
    try { localStorage.setItem(DRAWER_KEY, drawerOpen ? 'open' : 'closed'); } catch (e) {}
  }

  /* 开发者工具页左侧工具列表：同一套抽屉交互，状态独立记忆 */
  function loadDevNavOpen() {
    try { return localStorage.getItem(DEVNAV_KEY) !== 'closed'; } catch (e) { return true; }
  }
  var devNavOpen = loadDevNavOpen();
  function saveDevNavState() {
    try { localStorage.setItem(DEVNAV_KEY, devNavOpen ? 'open' : 'closed'); } catch (e) {}
  }

  /* 抽屉开关按钮：首页筛选栏与开发者工具列表共用 */
  function drawerToggleHtml(attr, controls, label, open, extraCls) {
    return '<button type="button" class="btn btn-ghost btn-sm sidebar-toggle' + (extraCls ? ' ' + extraCls : '') + '" ' + attr +
      ' aria-expanded="' + String(open) + '" aria-controls="' + controls + '" aria-label="' + esc(label) + '"' +
      ' title="' + (open ? '收起' : '展开') + esc(label) + '">' +
      '<svg class="st-ico" aria-hidden="true"><use href="#i-panel"/></svg>' +
      '<span>' + esc(label) + '</span>' +
      '<svg class="st-chev" aria-hidden="true"><use href="#i-chevron"/></svg>' +
      '</button>';
  }

  function toast(msg) {
    if (!toastRoot) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<svg aria-hidden="true"><use href="#i-check"/></svg><span>' + esc(msg) + '</span>';
    toastRoot.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }, 1800);
  }
  AGI.toast = toast;

  function hash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 1000;
    return h;
  }
  function catHue(catId) {
    var c = CAT_BY_ID[catId];
    return c ? c.hue : 220;
  }
  function hostOf(url) {
    try {
      var u = new URL(url);
      return u.hostname || '';
    } catch (e) { return ''; }
  }
  function catIcon(catId, sizeClass) {
    var c = CAT_BY_ID[catId];
    var cls = 'cat-ico' + (sizeClass ? ' ' + sizeClass : '');
    if (!c) {
      return '<span class="' + cls + '" style="--h:220" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24"><use href="#i-grid"/></svg></span>';
    }
    return '<span class="' + cls + '" style="--h:' + c.hue + '" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24">' + c.icon + '</svg></span>';
  }

  function logo(tool, size) {
    var h = (catHue(tool.cat) + (hash(tool.name) % 36) - 18 + 360) % 360;
    var initial = (tool.name || '?').trim().charAt(0).toUpperCase();
    var host = tool.logoHost || hostOf(tool.url);
    var known = host && LOGO_OK.has(host);
    var failed = host && LOGO_FAIL.has(host);
    var cls = 'mono-mark' + (size ? ' is-' + size : '');
    return '<span class="' + cls + '" style="--h:' + h + '" aria-hidden="true">' +
      '<span class="logo-initial">' + esc(initial) + '</span>' +
      (host && !failed
        ? '<img class="tool-logo' + (known ? ' is-loaded' : '') + '" src="https://' + host + '/apple-touch-icon.png" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-logo data-host="' + esc(host) + '" data-step="0">'
        : '') +
      '</span>';
  }
  function priceLabel(p) {
    return p === 'free' ? '免费' : p === 'paid' ? '付费' : '免费增值';
  }

  /* ---------------- 检索与排序 ---------------- */
  function catName(id) { return CAT_BY_ID[id] ? CAT_BY_ID[id].name : ''; }

  function scoreTool(t, q) {
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    var s = 0;
    for (var i = 0; i < terms.length; i++) {
      var term = terms[i];
      var hit = 0;
      if (t.name.toLowerCase().indexOf(term) >= 0) hit = Math.max(hit, 10);
      if (t.vendor.toLowerCase().indexOf(term) >= 0) hit = Math.max(hit, 6);
      if (t.tags.join(' ').toLowerCase().indexOf(term) >= 0) hit = Math.max(hit, 5);
      if (t.tagline.toLowerCase().indexOf(term) >= 0) hit = Math.max(hit, 4);
      if (catName(t.cat).toLowerCase().indexOf(term) >= 0) hit = Math.max(hit, 3);
      if (t.desc.toLowerCase().indexOf(term) >= 0) hit = Math.max(hit, 2);
      if (!hit) return 0;
      s += hit;
    }
    return s;
  }

  function filteredTools() {
    var q = state.query.trim();
    var list = TOOLS.filter(function (t) {
      if (state.cat !== 'all' && t.cat !== state.cat) return false;
      if (state.pricing !== 'all' && t.pricing !== state.pricing) return false;
      if (state.tags.length && !state.tags.every(function (tag) { return t.tags.indexOf(tag) >= 0; })) return false;
      return true;
    });
    if (q) {
      list = list.map(function (t) { return { t: t, s: scoreTool(t, q) }; })
        .filter(function (x) { return x.s > 0; })
        .sort(function (a, b) { return b.s - a.s || a.t.name.localeCompare(b.t.name); })
        .map(function (x) { return x.t; });
    } else if (state.sort === 'newest') {
      list.sort(function (a, b) { return b.added.localeCompare(a.added); });
    } else if (state.sort === 'name') {
      list.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh-CN'); });
    } else {
      list.sort(function (a, b) {
        if (!!b.featured !== !!a.featured) return b.featured ? 1 : -1;
        return b.added.localeCompare(a.added);
      });
    }
    return list;
  }

  /* ---------------- 组件模板 ---------------- */
  function toolCard(t) {
    var fav = favorites.has(t.id);
    return '' +
      '<article class="tool-card" data-tool="' + t.id + '">' +
        '<div class="tc-top">' +
          logo(t) +
          '<div class="tc-id">' +
            '<h3><a class="tc-title" href="/tool/' + t.id + '/" data-tool="' + t.id + '">' + esc(t.name) + '</a>' +
              (t.featured ? '<span title="编辑精选" style="color:var(--accent);font-size:11px">●</span>' : '') + '</h3>' +
            '<div class="vendor">' + esc(t.vendor) + ' · ' + esc(catName(t.cat)) + '</div>' +
          '</div>' +
          '<button type="button" class="fav-btn' + (fav ? ' is-on' : '') + '" data-fav="' + t.id + '" aria-label="' + (fav ? '取消收藏' : '收藏') + '" aria-pressed="' + fav + '">' +
            '<svg aria-hidden="true"><use href="#i-star"/></svg>' +
          '</button>' +
        '</div>' +
        '<p class="tc-desc">' + esc(t.desc) + '</p>' +
        '<div class="tc-tags">' + t.tags.slice(0, 3).map(function (tag) { return '<span>' + esc(tag) + '</span>'; }).join('') + '</div>' +
        '<div class="tc-foot">' +
          '<span class="badge badge-' + t.pricing + '">' + priceLabel(t.pricing) + '</span>' +
          '<a class="visit" href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer" data-visit>访问官网' +
            '<svg aria-hidden="true"><use href="#i-external"/></svg></a>' +
        '</div>' +
      '</article>';
  }

  /* ---------------- 工具库（站点首页） ---------------- */
  function applyParams(params) {
    state.cat = params.get('cat') || 'all';
    if (!CAT_BY_ID[state.cat]) state.cat = 'all';
    state.pricing = params.get('price') || 'all';
    if (['free', 'freemium', 'paid'].indexOf(state.pricing) < 0) state.pricing = 'all';
    state.tags = (params.get('tags') || '').split(',').filter(Boolean);
    state.query = params.get('q') || '';
    state.sort = params.get('sort') || 'recommended';
    if (['recommended', 'newest', 'name'].indexOf(state.sort) < 0) state.sort = 'recommended';
  }

  function countBy(fn) {
    var n = 0;
    TOOLS.forEach(function (t) { if (fn(t)) n++; });
    return n;
  }

  function renderTools(cat) {
    var topTags = ['对话', '开源', '中文', 'API', '本地部署', '视频生成', '多模态', '语音', '免费', '企业', '学术'];
    var list = filteredTools();
    var catCount = cat ? TOOLS.filter(function (t) { return t.cat === cat.id; }).length : 0;
    var eyebrow = cat ? 'CATEGORY · ' + cat.name : 'AI TOOL INDEX · 2026';
    var heading = cat ? ((SEO && SEO.h1 ? SEO.h1({ kind: 'category', cat: cat }) : '') || cat.name + ' AI 工具') : 'AI 工具库';
    var lede = cat
      ? cat.desc + '。共 ' + catCount + ' 个工具，可按定价与标签进一步筛选，点击卡片查看详情与官网入口。'
      : 'AGI Hunt 是一个中文 AI 工具导航：收录 ' + TOOLS.length + ' 个经过筛选的工具与站点，覆盖对话、创作、编程、Agent 技能、MCP 服务与 AI 学习。支持关键词、分类、定价与标签交叉检索。';

    app.innerHTML = '' +
      '<div class="page-enter">' +
      '<section class="page-head"><div class="container">' +
        '<div class="page-head-top">' +
          '<div class="page-head-copy">' +
            '<span class="eyebrow">' + esc(eyebrow) + '</span>' +
            '<h1>' + esc(heading) + '</h1>' +
            '<p>' + esc(lede) + '</p>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
            '<div class="search-inline">' +
              '<svg aria-hidden="true"><use href="#i-search"/></svg>' +
              '<input type="search" id="tools-search" placeholder="搜索工具、场景或标签…" value="' + esc(state.query) + '" autocomplete="off" aria-label="搜索工具">' +
            '</div>' +
            '<button type="button" class="btn btn-ghost filter-toggle" data-open-filters>' +
              '<svg style="width:15px;height:15px" aria-hidden="true"><use href="#i-filter"/></svg> 筛选</button>' +
          '</div>' +
        '</div>' +
        '<nav aria-label="按分类浏览" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:20px">' +
          '<a class="chip' + (state.cat === 'all' ? ' is-on' : '') + '" href="/">全部 ' + TOOLS.length + '</a>' +
          CATS.map(function (c) {
            return '<a class="chip' + (state.cat === c.id ? ' is-on' : '') + '" href="/category/' + c.id + '/">' +
              esc(c.name) + '<span style="opacity:.55;margin-left:6px">' + countBy(function (t) { return t.cat === c.id; }) + '</span></a>';
          }).join('') +
        '</nav>' +
      '</div></section>' +

      '<div class="container"><div class="browse' + (drawerOpen ? '' : ' is-collapsed') + '" id="browse">' +
        '<div class="filters-col">' +
        '<aside class="filters" id="filters" aria-label="筛选条件">' +
          '<div class="filter-sheet-head"><h3>筛选</h3>' +
            '<button type="button" class="icon-btn" data-close-filters aria-label="关闭筛选"><svg aria-hidden="true"><use href="#i-close"/></svg></button></div>' +
          '<div class="filter-group">' +
            '<div class="filter-title"><span>分类</span><button type="button" data-reset>重置</button></div>' +
            '<div class="filter-list">' +
              '<button type="button" class="filter-item' + (state.cat === 'all' ? ' is-on' : '') + '" data-cat-filter="all">' + catIcon('all') + '全部工具<span class="n">' + TOOLS.length + '</span></button>' +
              CATS.map(function (c) {
                return '<button type="button" class="filter-item' + (state.cat === c.id ? ' is-on' : '') + '" data-cat-filter="' + c.id + '">' +
                  catIcon(c.id) + esc(c.name) +
                  '<span class="n">' + countBy(function (t) { return t.cat === c.id; }) + '</span></button>';
              }).join('') +
            '</div>' +
          '</div>' +
          '<div class="filter-group">' +
            '<div class="filter-title"><span>定价</span></div>' +
            '<div class="price-list">' +
              '<button type="button" class="price-item' + (state.pricing === 'all' ? ' is-on' : '') + '" data-price="all"><span class="box"></span>不限</button>' +
              '<button type="button" class="price-item' + (state.pricing === 'free' ? ' is-on' : '') + '" data-price="free"><span class="box"></span>免费</button>' +
              '<button type="button" class="price-item' + (state.pricing === 'freemium' ? ' is-on' : '') + '" data-price="freemium"><span class="box"></span>免费增值</button>' +
              '<button type="button" class="price-item' + (state.pricing === 'paid' ? ' is-on' : '') + '" data-price="paid"><span class="box"></span>付费</button>' +
            '</div>' +
          '</div>' +
          '<div class="filter-group">' +
            '<div class="filter-title"><span>标签</span></div>' +
            '<div class="filter-links">' +
              topTags.map(function (tag) {
                return '<button type="button" class="chip' + (state.tags.indexOf(tag) >= 0 ? ' is-on' : '') + '" data-tag="' + esc(tag) + '">' + esc(tag) + '</button>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</aside>' +
        '</div>' +

        '<div class="results">' +
          '<div class="results-bar">' +
            drawerToggleHtml('data-toggle-sidebar', 'filters', '筛选', drawerOpen) +
            '<span class="results-count" id="results-count">找到 <b>' + list.length + '</b> 个工具</span>' +
            '<span class="spacer"></span>' +
            '<div class="select-wrap">' +
              '<select id="sort-select" aria-label="排序方式">' +
                '<option value="recommended"' + (state.sort === 'recommended' ? ' selected' : '') + '>推荐排序</option>' +
                '<option value="newest"' + (state.sort === 'newest' ? ' selected' : '') + '>最近收录</option>' +
                '<option value="name"' + (state.sort === 'name' ? ' selected' : '') + '>名称 A–Z</option>' +
              '</select>' +
            '</div>' +
            '<div class="view-toggle" role="group" aria-label="视图切换">' +
              '<button type="button" data-view="grid" class="' + (state.view === 'grid' ? 'is-on' : '') + '" aria-label="卡片视图" aria-pressed="' + (state.view === 'grid') + '"><svg aria-hidden="true"><use href="#i-grid"/></svg></button>' +
              '<button type="button" data-view="list" class="' + (state.view === 'list' ? 'is-on' : '') + '" aria-label="列表视图" aria-pressed="' + (state.view === 'list') + '"><svg aria-hidden="true"><use href="#i-list"/></svg></button>' +
            '</div>' +
          '</div>' +
          '<div class="active-filters" id="active-filters"></div>' +
          '<div id="results-area"></div>' +
        '</div>' +
      '</div></div>' +
      '</div>';

    renderResultsArea();
  }

  function activeFilterChips() {
    var chips = [];
    if (state.query) chips.push({ type: 'q', label: '“' + state.query + '”' });
    if (state.cat !== 'all') chips.push({ type: 'cat', label: catName(state.cat), cat: state.cat });
    if (state.pricing !== 'all') chips.push({ type: 'price', label: priceLabel(state.pricing) });
    state.tags.forEach(function (tag) { chips.push({ type: 'tag', label: tag, value: tag }); });
    return chips;
  }

  function renderResultsArea() {
    var area = $('#results-area');
    if (!area) return;
    var list = filteredTools();

    $('#results-count').innerHTML = '找到 <b>' + list.length + '</b> 个工具';

    var chips = activeFilterChips();
    var chipsEl = $('#active-filters');
    if (chipsEl) {
      chipsEl.innerHTML = chips.length
        ? chips.map(function (c) {
            return '<button type="button" class="chip" data-remove-filter="' + c.type + '"' + (c.value ? ' data-value="' + esc(c.value) + '"' : '') + '>' +
              (c.cat ? catIcon(c.cat, 'is-xs') : '') + esc(c.label) + ' <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 6 12 12M18 6 6 18"/></svg></button>';
          }).join('') + '<button type="button" class="chip" data-reset style="border-style:dashed">清空条件</button>'
        : '';
    }

    if (!list.length) {
      area.innerHTML = '<div class="empty">' +
        '<svg aria-hidden="true"><use href="#i-empty"/></svg>' +
        '<h3>没有匹配的工具</h3>' +
        '<p>试着减少标签组合，或换一个更宽泛的关键词。当前是「与」逻辑，标签越多结果越窄。</p>' +
        '<button type="button" class="btn btn-ghost" data-reset>清空全部条件</button>' +
        '</div>';
    } else {
      area.innerHTML = '<div class="tool-grid' + (state.view === 'list' ? ' is-list' : '') + ' stagger">' + list.map(toolCard).join('') + '</div>';
    }

    $$('#filters [data-cat-filter]').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-cat-filter') === state.cat);
    });
    $$('#filters [data-price]').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-price') === state.pricing);
    });
    $$('#filters [data-tag]').forEach(function (b) {
      b.classList.toggle('is-on', state.tags.indexOf(b.getAttribute('data-tag')) >= 0);
    });
    var sel = $('#sort-select');
    if (sel) sel.value = state.sort;
  }

  /* 分类进入路径而非查询参数，避免 /?cat=chat 与 /category/chat/ 形成重复页 */
  function toolsPath() {
    return state.cat === 'all' ? '/' : '/category/' + state.cat + '/';
  }

  function isListPath() {
    var p = location.pathname;
    return p === '/' || p.indexOf('/category/') === 0;
  }

  function listUrl() {
    var p = new URLSearchParams();
    if (state.query) p.set('q', state.query);
    if (state.pricing !== 'all') p.set('price', state.pricing);
    if (state.tags.length) p.set('tags', state.tags.join(','));
    if (state.sort !== 'recommended') p.set('sort', state.sort);
    var qs = p.toString();
    return toolsPath() + (qs ? '?' + qs : '');
  }

  function syncToolsUrl() {
    if (!isListPath()) return;
    var next = listUrl();
    if (location.pathname + location.search !== next) {
      try { history.replaceState(history.state, '', next); } catch (e) {}
    }
  }

  function resetFilters(keepQuery) {
    state.cat = 'all';
    state.pricing = 'all';
    state.tags = [];
    if (!keepQuery) state.query = '';
    var input = $('#tools-search');
    if (input) input.value = state.query;
    if (location.pathname.indexOf('/category/') === 0) {
      navigate(listUrl());
      return;
    }
    renderResultsArea();
    syncToolsUrl();
  }

  function closeFilterSheet() {
    var f = $('#filters');
    if (f) f.classList.remove('is-open');
    filterScrim.classList.remove('is-open');
    document.body.classList.remove('no-scroll');
  }

  /* ---------------- 收藏页 ---------------- */
  function renderFavorites() {
    var list = TOOLS.filter(function (t) { return favorites.has(t.id); });
    app.innerHTML = '' +
      '<div class="page-enter">' +
      '<section class="page-head"><div class="container">' +
        '<div class="page-head-top"><div><h1>我的收藏</h1><p>保存在本机浏览器，不上传、不关联账号。换设备不会同步。</p></div>' +
        '<a class="btn btn-ghost" href="/">去工具库看看</a></div>' +
      '</div></section>' +
      '<section class="section"><div class="container">' +
        (list.length
          ? '<div class="tool-grid stagger">' + list.map(toolCard).join('') + '</div>'
          : '<div class="empty"><svg aria-hidden="true"><use href="#i-star"/></svg><h3>还没有收藏</h3>' +
            '<p>在工具卡片右上角点击星标，即可把常用工具固定在这里。</p>' +
            '<a class="btn btn-primary" href="/">浏览工具库</a></div>') +
      '</div></section></div>';
  }

  /* ---------------- 开发者工具页 ---------------- */
  function renderDevIndex() {
    app.innerHTML = '' +
      '<div class="page-enter">' +
      '<section class="page-head"><div class="container">' +
        '<div class="page-head-top"><div><h1>开发者工具箱</h1>' +
          '<p>' + DEVTOOLS.length + ' 款高频小工具，纯前端实现。数据留在本机，断网可用，无需登录。</p></div>' +
          '<span class="badge badge-free" style="height:26px">LOCAL ONLY</span>' +
        '</div>' +
      '</div></section>' +
      '<section class="section"><div class="container">' +
        '<div class="tool-grid stagger">' +
        DEVTOOLS.map(function (d) {
          return '<a class="tool-card" href="/dev/' + d.id + '/" style="text-decoration:none;color:inherit">' +
            '<div class="tc-top"><span class="mono-mark" style="--h:232" aria-hidden="true">' +
              '<span class="logo-initial">' + esc(d.badge) + '</span></span>' +
              '<div class="tc-id"><h3>' + esc(d.name) + '</h3>' +
                '<div class="vendor">' + esc(d.group) + '</div></div></div>' +
            '<p class="tc-desc">' + esc(d.desc) + '</p>' +
            '</a>';
        }).join('') +
        '</div>' +
      '</div></section></div>';
  }

  function renderDevPage(id) {
    var groups = [];
    DEVTOOLS.forEach(function (d) {
      var g = groups.filter(function (x) { return x.name === d.group; })[0];
      if (!g) { g = { name: d.group, items: [] }; groups.push(g); }
      g.items.push(d);
    });
    var current = DEVTOOLS.filter(function (d) { return d.id === id; })[0] || DEVTOOLS[0];

    app.innerHTML = '' +
      '<div class="page-enter">' +
      '<section class="page-head"><div class="container">' +
        '<div class="page-head-top"><div>' +
          '<span class="eyebrow">DEVELOPER TOOLBOX</span>' +
          '<h1>' + esc(current.name) + '</h1>' +
          '<p>' + esc(current.desc) + '。纯前端实现，数据留在本机，断网可用。</p></div>' +
          '<span class="badge badge-free" style="height:26px">LOCAL ONLY</span>' +
        '</div>' +
      '</div></section>' +
      '<div class="container"><div class="dev-shell' + (devNavOpen ? '' : ' is-collapsed') + '" id="dev-shell">' +
        '<div class="dev-nav-col">' +
        '<aside class="dev-nav" id="dev-nav" aria-label="工具列表">' +
          groups.map(function (g) {
            return '<div class="dev-nav-group"><p class="dev-nav-title">' + esc(g.name) + '</p>' +
              g.items.map(function (d) {
                return '<a class="dev-nav-item' + (d.id === current.id ? ' is-on' : '') + '" href="/dev/' + d.id + '/"' +
                  (d.id === current.id ? ' aria-current="page"' : '') + '>' +
                  '<span class="b">' + esc(d.badge) + '</span><span class="name">' + esc(d.name) + '</span></a>';
              }).join('') + '</div>';
          }).join('') +
          '<div class="dev-note">所有转换均在浏览器内完成，不发起网络请求。涉及敏感数据时可断网使用。</div>' +
        '</aside>' +
        '</div>' +
        '<div class="dev-panel" id="dev-panel"></div>' +
      '</div></div></div>';

    var panel = $('#dev-panel');
    AGI.Dev.mount(current.id, panel);
    var head = $('.dev-panel-head', panel);
    if (head) head.insertAdjacentHTML('beforeend', drawerToggleHtml('data-toggle-dev-nav', 'dev-nav', '工具列表', devNavOpen, 'dev-nav-toggle'));

    /* 工具页正文：说明与常见用途，与 build.mjs 的 devBody 保持一致 */
    var dvCopy = (SEO && SEO.DEV_SEO && SEO.DEV_SEO[current.id]) || {};
    if (dvCopy.lead || (dvCopy.use && dvCopy.use.length)) {
      var dvExtra = '<section class="section"><div class="container"><div class="prose">' +
        (dvCopy.lead ? '<h2>使用说明</h2><p>' + esc(dvCopy.lead) + '</p>' : '') +
        (dvCopy.use && dvCopy.use.length
          ? '<h2>常见用途</h2><ul>' + dvCopy.use.map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ul>'
          : '') +
        '</div></div></section>';
      var dvRoot = $('.page-enter', app);
      if (dvRoot) dvRoot.insertAdjacentHTML('beforeend', dvExtra);
    }
  }

  /* ---------------- 关于页 ---------------- */
  function renderAbout() {
    app.innerHTML = '' +
      '<div class="page-enter">' +
      '<section class="page-head"><div class="container">' +
        '<div class="page-head-top"><div><h1>关于 AGI Hunt</h1><p>一个不追热点的 AI 工具索引，以及一套不需要联网的开发者工具。</p></div></div>' +
      '</div></section>' +
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
        '<p>工具图标优先读取各站点自身的 apple-touch-icon 或 favicon，不经过第三方图标服务；不可用时回退为由名称与分类色生成的首字色块。</p>' +
        '<p>定价与功能具有时效性，标注（免费 / 免费增值 / 付费）仅作快速筛选之用，实际权益以官方页面为准。收录不构成推荐或背书。</p>' +

        '<h2>开发者工具</h2>' +
        '<p>' + DEVTOOLS.length + ' 款工具全部在浏览器内完成计算，不上传输入内容，也不加载第三方脚本。</p>' +
        '<div class="info-grid">' +
          '<div class="info-card"><h3>打开即用</h3><p>无需安装客户端或浏览器扩展。</p></div>' +
          '<div class="info-card"><h3>零上传</h3><p>输入内容只存在于当前标签页，刷新即清除。</p></div>' +
          '<div class="info-card"><h3>可离线</h3><p>首次加载后可保存为本地页面，断网仍可使用工具箱。</p></div>' +
        '</div>' +

        '<h2>快捷键</h2>' +
        '<ul>' +
          '<li><code>⌘ K</code> / <code>Ctrl K</code>：唤起全局搜索</li>' +
          '<li><code>/</code>：聚焦首页搜索框，其他页面唤起全局搜索</li>' +
          '<li><code>Esc</code>：关闭抽屉、面板或搜索</li>' +
          '<li><code>↑ ↓</code> + <code>Enter</code>：在搜索结果中导航</li>' +
        '</ul>' +
      '</div></div></section></div>';
  }

  /* ---------------- 404 ---------------- */
  function renderNotFound() {
    app.innerHTML = '' +
      '<div class="page-enter">' +
      '<section class="page-head"><div class="container">' +
        '<div class="page-head-top"><div><h1>页面不存在</h1>' +
        '<p>这个地址可能已经变更，或者链接输入有误。</p></div></div>' +
      '</div></section>' +
      '<section class="section"><div class="container">' +
        '<div class="empty"><svg aria-hidden="true"><use href="#i-empty"/></svg>' +
        '<h3>没有找到这个页面</h3><p>可以回到工具库重新检索，或从开发者工具箱继续。</p>' +
        '<a class="btn btn-primary" href="/">返回 AI 工具库</a></div>' +
      '</div></section></div>';
  }

  /* ---------------- 工具详情页（与 build.mjs 的 toolBody 保持同构） ----------------
   * 直接访问 /tool/:id/ 时渲染完整文章，而不是用全站卡片列表覆盖正文；
   * 卡片点击仍走抽屉预览，抓取器读到的是这里与预渲染一致的 H1 / 正文 / 内链。
   */
  function renderToolPage(t) {
    var alt = TOOLS.filter(function (x) { return x.cat === t.cat && x.id !== t.id; }).slice(0, 6);
    var meta = [
      ['分类', catName(t.cat)],
      ['厂商', t.vendor],
      ['定价', priceLabel(t.pricing)],
      ['平台', SEO ? SEO.platformLabel(t.platforms) : (t.platforms || []).join('、')],
      ['语言', { zh: '中文', en: '英文', multi: '多语言' }[t.lang] || t.lang],
      ['收录时间', t.added]
    ];

    app.innerHTML = '' +
      '<div class="page-enter"><div class="container" style="padding-top:28px">' +
      '<nav aria-label="面包屑" style="font-size:12px;color:var(--text-3,#868C99);margin-bottom:14px">' +
        '<a href="/" style="color:inherit">AI 工具库</a><span style="margin:0 6px">/</span>' +
        '<a href="/category/' + t.cat + '/" style="color:inherit">' + esc(catName(t.cat)) + '</a>' +
        '<span style="margin:0 6px">/</span><span>' + esc(t.name) + '</span>' +
      '</nav>' +
      '<article class="prose">' +
        '<h1>' + esc(t.name) + '</h1>' +
        '<p style="font-size:15px;color:var(--text-2,#4B505B)">' + esc(t.vendor) + ' · ' + esc(catName(t.cat)) + ' · ' + esc(priceLabel(t.pricing)) + '</p>' +
        '<p><strong>' + esc(t.tagline) + '</strong></p>' +
        '<p>' + esc(t.desc) + '</p>' +
        '<p><a class="btn btn-primary" href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">访问 ' + esc(t.name) + ' 官网</a></p>' +
        '<h2>基本信息</h2>' +
        '<dl class="drawer-meta" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 24px">' +
          meta.map(function (kv) { return '<div><dt>' + esc(kv[0]) + '</dt><dd>' + esc(kv[1]) + '</dd></div>'; }).join('') +
        '</dl>' +
        '<h2>标签</h2>' +
        '<div class="tag-cloud">' +
          t.tags.map(function (tag) { return '<a class="chip" href="/category/' + t.cat + '/?tags=' + encodeURIComponent(tag) + '">' + esc(tag) + '</a>'; }).join('') +
        '</div>' +
        (alt.length
          ? '<h2>同类工具</h2><ul>' + alt.map(function (a) {
              return '<li><a href="/tool/' + a.id + '/">' + esc(a.name) + '</a> — ' + esc(a.tagline) + '</li>';
            }).join('') + '</ul>'
          : '') +
        '<p style="margin-top:28px"><a href="/category/' + t.cat + '/">← 返回' + esc(catName(t.cat)) + '全部工具</a></p>' +
      '</article></div></div>';
  }

  /* ---------------- 合集页（/tag/:slug/） ---------------- */
  function renderTagPage(hub) {
    var list = TOOLS.filter(function (t) { return t.tags.indexOf(hub.tag) >= 0; });
    app.innerHTML = '' +
      '<div class="page-enter">' +
      '<section class="page-head"><div class="container"><div class="page-head-copy">' +
        '<nav aria-label="面包屑" style="font-size:12px;color:var(--text-3,#868C99);margin-bottom:14px">' +
          '<a href="/" style="color:inherit">AI 工具库</a><span style="margin:0 6px">/</span><span>' + esc(hub.name) + '</span>' +
        '</nav>' +
        '<span class="eyebrow">COLLECTION · ' + esc(hub.tag) + '</span>' +
        '<h1>' + esc(hub.name) + '</h1>' +
        '<p>共 ' + list.length + ' 个条目，均标注定价与平台，点击卡片查看详情与官网入口。</p>' +
      '</div>' +
      '<nav aria-label="按分类浏览" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:20px">' +
        '<a class="chip" href="/">全部 ' + TOOLS.length + '</a>' +
        CATS.map(function (c) {
          return '<a class="chip" href="/category/' + c.id + '/">' + esc(c.name) +
            '<span style="opacity:.55;margin-left:6px">' + countBy(function (t) { return t.cat === c.id; }) + '</span></a>';
        }).join('') +
      '</nav></div></section>' +
      '<section class="section"><div class="container">' +
        '<h2 style="font-size:19px;margin:0 0 16px">' + esc(hub.name) + '列表（' + list.length + '）</h2>' +
        '<div class="tool-grid">' + list.map(toolCard).join('') + '</div>' +
      '</div></section>' +
      '<section class="section"><div class="container"><div class="prose">' +
        '<h2>关于' + esc(hub.name) + '</h2><p>' + esc(hub.intro) + '</p>' +
      '</div></div></section></div>';
  }

  /* ---------------- 详情抽屉 ---------------- */
  function openTool(id, push) {
    var t = TOOL_BY_ID[id];
    if (!t) return;
    var alt = TOOLS.filter(function (x) { return x.cat === t.cat && x.id !== t.id; }).slice(0, 4);
    var fav = favorites.has(t.id);
    var platforms = { web: 'Web', mac: 'macOS', win: 'Windows', ios: 'iOS', android: 'Android', api: 'API', self: '自托管' };

    drawer.innerHTML = '' +
      '<div class="drawer-head">' +
        '<span class="label">TOOL · ' + esc(catName(t.cat)) + '</span>' +
        '<button type="button" class="icon-btn" data-close-drawer aria-label="关闭详情"><svg aria-hidden="true"><use href="#i-close"/></svg></button>' +
      '</div>' +
      '<div class="drawer-body">' +
        '<div class="drawer-hero">' + logo(t, 'lg') +
          '<div><h2>' + esc(t.name) + '</h2><div class="vendor">' + esc(t.vendor) + '</div></div>' +
        '</div>' +
        '<p class="drawer-tagline">' + esc(t.tagline) + '</p>' +
        '<p class="drawer-desc">' + esc(t.desc) + '</p>' +
        '<dl class="drawer-meta">' +
          '<div><dt>分类</dt><dd>' + catIcon(t.cat, 'is-inline') + esc(catName(t.cat)) + '</dd></div>' +
          '<div><dt>定价</dt><dd>' + priceLabel(t.pricing) + '</dd></div>' +
          '<div><dt>平台</dt><dd>' + (t.platforms || []).map(function (p) { return platforms[p] || p; }).join(' · ') + '</dd></div>' +
          '<div><dt>收录时间</dt><dd>' + esc(t.added) + '</dd></div>' +
        '</dl>' +
        '<div class="drawer-actions">' +
          '<a class="btn btn-primary" href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">访问官网 <svg style="width:15px;height:15px" aria-hidden="true"><use href="#i-external"/></svg></a>' +
          '<button type="button" class="btn btn-ghost" data-fav="' + t.id + '" aria-pressed="' + fav + '">' +
            '<svg style="width:15px;height:15px" fill="none" stroke="currentColor" aria-hidden="true"><use href="#i-star"/></svg>' + (fav ? '已收藏' : '收藏') + '</button>' +
        '</div>' +
        '<div class="drawer-sub"><h4>标签</h4><div class="tag-cloud">' +
          t.tags.map(function (tag) { return '<a class="chip" href="/category/' + t.cat + '/?tags=' + encodeURIComponent(tag) + '">' + esc(tag) + '</a>'; }).join('') +
        '</div></div>' +
        (alt.length ? '<div class="drawer-sub"><h4>同类工具</h4><div class="alt-list">' +
          alt.map(function (a) {
            return '<button type="button" class="alt-item" data-tool="' + a.id + '">' + logo(a, 'sm') +
              '<span><span class="t">' + esc(a.name) + '</span><br><span class="v">' + esc(a.vendor) + ' · ' + priceLabel(a.pricing) + '</span></span>' +
              '<svg aria-hidden="true"><use href="#i-arrow"/></svg></button>';
          }).join('') + '</div></div>' : '') +
      '</div>';

    lastFocused = document.activeElement;
    requestAnimationFrame(function () {
      drawer.classList.add('is-open');
      drawerBackdrop.classList.add('is-open');
      drawer.setAttribute('aria-hidden', 'false');
      document.body.classList.add('no-scroll');
      var btn = $('[data-close-drawer]', drawer);
      if (btn) btn.focus({ preventScroll: true });
    });

    if (push) {
      try {
        var detailPath = '/tool/' + id + '/';
        if (location.pathname.indexOf('/tool/') === 0) {
          history.replaceState({ drawer: id }, '', detailPath);
        } else {
          history.pushState({ drawer: id }, '', detailPath);
          state.drawerPushed = true;
        }
        applyMeta({ kind: 'tool', tool: t });
      } catch (e) {}
    }
  }

  function hideDrawer() {
    if (!drawer.classList.contains('is-open')) return;
    drawer.classList.remove('is-open');
    drawerBackdrop.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    if (!palette.open && !$('.filters.is-open')) document.body.classList.remove('no-scroll');
    if (lastFocused && lastFocused.focus) {
      try { lastFocused.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function closeDrawer() {
    if (!drawer.classList.contains('is-open')) return;
    hideDrawer();
    if (state.drawerPushed) {
      state.drawerPushed = false;
      history.back();
    } else if (location.pathname.indexOf('/tool/') === 0) {
      try { history.replaceState(null, '', '/'); } catch (e) {}
      route();
    }
  }

  /* ---------------- 命令面板 ---------------- */
  function buildPaletteItems(q) {
    var items = [];
    var query = q.trim().toLowerCase();
    var tools = TOOLS.map(function (t) {
      return { kind: 'tool', id: t.id, title: t.name, sub: t.vendor + ' · ' + catName(t.cat), badge: priceLabel(t.pricing), score: query ? scoreTool(t, query) : (t.featured ? 2 : 0) };
    }).filter(function (x) { return !query || x.score > 0; }).sort(function (a, b) { return b.score - a.score; }).slice(0, query ? 8 : 5);
    items = items.concat(tools);

    var devs = DEVTOOLS.filter(function (d) {
      if (!query) return true;
      return (d.name + d.desc + d.group).toLowerCase().indexOf(query) >= 0;
    }).slice(0, query ? 5 : 4).map(function (d) {
      return { kind: 'dev', id: d.id, title: d.name, sub: d.desc, badge: '工具' };
    });
    items = items.concat(devs);

    if (query) {
      var cats = CATS.filter(function (c) { return (c.name + c.desc).toLowerCase().indexOf(query) >= 0; })
        .slice(0, 3).map(function (c) {
          return { kind: 'cat', id: c.id, title: c.name, sub: c.desc, badge: '分类' };
        });
      items = items.concat(cats);
    }
    return items;
  }

  function renderPalette() {
    if (!palette.items.length) {
      paletteResults.innerHTML = '<div class="palette-empty">没有找到相关内容，试试「视频」「开源」或「JSON」。</div>';
      return;
    }
    var kindLabel = { tool: '工具', dev: '开发工具', cat: '分类' };
    var html = '', lastKind = null;
    palette.items.forEach(function (item, i) {
      if (item.kind !== lastKind) {
        html += '<div class="palette-group-label">' + (kindLabel[item.kind] || '') + '</div>';
        lastKind = item.kind;
      }
      var mark;
      if (item.kind === 'tool' && TOOL_BY_ID[item.id]) {
        mark = logo(TOOL_BY_ID[item.id], 'sm');
      } else if (item.kind === 'cat') {
        var cat = CAT_BY_ID[item.id];
        mark = '<span class="mono-mark is-sm is-cat" style="--h:' + (cat ? cat.hue : 220) + '">' + catIcon(item.id) + '</span>';
      } else {
        mark = '<span class="mono-mark is-sm" style="--h:232">⌘</span>';
      }
      html += '<button type="button" class="palette-item' + (i === palette.active ? ' is-active' : '') + '" data-palette-index="' + i + '">' +
        mark +
        '<span class="pi-main"><strong>' + esc(item.title) + '</strong><span>' + esc(item.sub) + '</span></span>' +
        '<span class="pi-kind">' + esc(item.badge) + '</span></button>';
    });
    paletteResults.innerHTML = html;
    var activeEl = $('.palette-item.is-active', paletteResults);
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function openPalette() {
    palette.open = true;
    paletteInput.value = '';
    palette.active = 0;
    palette.items = buildPaletteItems('');
    renderPalette();
    paletteBackdrop.classList.add('is-open');
    document.body.classList.add('no-scroll');
    setTimeout(function () { paletteInput.focus(); }, 20);
  }

  function closePalette() {
    if (!palette.open) return;
    palette.open = false;
    paletteBackdrop.classList.remove('is-open');
    if (!drawer.classList.contains('is-open')) document.body.classList.remove('no-scroll');
  }

  function activatePalette(index) {
    var item = palette.items[index];
    if (!item) return;
    closePalette();
    if (item.kind === 'tool') openTool(item.id, true);
    else if (item.kind === 'dev') navigate('/dev/' + item.id + '/');
    else if (item.kind === 'cat') navigate('/category/' + item.id + '/');
  }

  /* ---------------- 路由 ----------------
   * 每条工具 / 分类 / 开发工具都有独立 URL（History API + 目录化静态页），
   * 未执行 JS 的抓取器读取的是 build.mjs 预渲染的同路径 HTML。
   */
  function resolveRoute() {
    var segs = location.pathname.split('/').filter(Boolean);
    var params = new URLSearchParams(location.search);
    var head = segs[0] || '';

    if (!head || head === 'index.html') return { kind: 'home', params: params, segs: segs };
    if (head === 'category' && CAT_BY_ID[segs[1]]) {
      return { kind: 'category', cat: CAT_BY_ID[segs[1]], params: params, segs: segs };
    }
    if (head === 'tool' && TOOL_BY_ID[segs[1]]) {
      return { kind: 'tool', tool: TOOL_BY_ID[segs[1]], params: params, segs: segs };
    }
    if (head === 'tag' && segs[1]) {
      var hub = SEO && SEO.hubBySlug ? SEO.hubBySlug(segs[1]) : null;
      if (hub) return { kind: 'tag', tag: hub, params: params, segs: segs };
    }
    if (head === 'dev') {
      if (!segs[1]) return { kind: 'devIndex', params: params, segs: segs };
      return { kind: 'dev', dev: DEV_BY_ID[segs[1]] || DEVTOOLS[0], params: params, segs: segs };
    }
    if (head === 'about') return { kind: 'about', params: params, segs: segs };
    if (head === 'favorites') return { kind: 'favorites', params: params, segs: segs };
    return { kind: 'notfound', params: params, segs: segs };
  }

  /* 站内跳转：保持 SPA 手感，同时把真实路径写入地址栏 */
  function navigate(href) {
    var url;
    try { url = new URL(href, location.origin); } catch (e) { return; }
    if (url.origin !== location.origin) { location.href = url.href; return; }
    var next = url.pathname + url.search + url.hash;
    if (next === location.pathname + location.search + location.hash) { route(); return; }
    try {
      history.pushState(null, '', next);
    } catch (e) { location.href = next; return; }
    route();
  }

  /* 旧版 hash 外链（如 #/tool/comfyui）301 式重定向到目录化地址 */
  function migrateLegacyHash() {
    var h = location.hash;
    if (h.indexOf('#/') !== 0) return false;
    var raw = h.slice(2);
    var qi = raw.indexOf('?');
    var params = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
    var p = (qi >= 0 ? raw.slice(0, qi) : raw).replace(/\/+$/, '');
    var target = null;
    var m;

    if ((m = p.match(/^tool\/([A-Za-z0-9_-]+)$/))) target = '/tool/' + m[1] + '/';
    else if ((m = p.match(/^dev\/([A-Za-z0-9_-]+)$/))) target = '/dev/' + m[1] + '/';
    else if (p === 'dev') target = '/dev/';
    else if (p === 'about') target = '/about/';
    else if (p === 'favorites') target = '/favorites/';
    else if (p === '' || p === 'tools' || p === 'home') {
      var cp = params.get('cat');
      params.delete('cat');
      target = cp && CAT_BY_ID[cp] ? '/category/' + cp + '/' : '/';
    }
    if (!target) return false;
    var qs = params.toString();
    try { location.replace(target + (qs ? '?' + qs : '')); } catch (e) { return false; }
    return true;
  }

  function applyMeta(ctx) {
    if (!SEO) return;
    var t = SEO.title(ctx);
    var d = SEO.description(ctx);
    var url = SEO.SITE + SEO.canonical(ctx);
    document.title = t;
    var md = document.querySelector('meta[name="description"]');
    if (md) md.setAttribute('content', d);
    var lc = document.querySelector('link[rel="canonical"]');
    if (lc) lc.setAttribute('href', url);
    var ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', t);
    var ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute('content', d);
    var ogUrl = document.querySelector('meta[property="og:url"]');
    if (ogUrl) ogUrl.setAttribute('content', url);
    var rb = document.querySelector('meta[name="robots"]');
    if (rb) {
      rb.setAttribute('content', ctx.kind === 'favorites' || ctx.kind === 'notfound'
        ? 'noindex,follow' : 'index,follow,max-image-preview:large');
    }
  }

  function setActiveNav(view) {
    $$('[data-nav]').forEach(function (a) {
      if (a.getAttribute('data-nav') === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function route() {
    var r = resolveRoute();

    var prevPath = state.lastPath;
    var isSamePath = prevPath === location.pathname;
    state.lastPath = location.pathname;

    if (AGI.Dev && AGI.Dev._timer) { clearInterval(AGI.Dev._timer); AGI.Dev._timer = null; }
    closePalette();
    hideDrawer();
    state.drawerPushed = false;
    document.body.classList.remove('no-scroll');
    if (mobileNav) mobileNav.classList.remove('is-open');
    var navToggle = document.getElementById('nav-toggle');
    if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
    filterScrim.classList.remove('is-open');
    var filtersEl = $('#filters');
    if (filtersEl) filtersEl.classList.remove('is-open');

    if (r.kind === 'home') {
      applyParams(r.params);
      renderTools();
      setActiveNav('home');
    } else if (r.kind === 'category') {
      applyParams(r.params);
      state.cat = r.cat.id;
      renderTools(r.cat);
      setActiveNav('home');
    } else if (r.kind === 'favorites') {
      renderFavorites();
      setActiveNav('favorites');
    } else if (r.kind === 'devIndex') {
      renderDevIndex();
      setActiveNav('dev');
    } else if (r.kind === 'dev') {
      renderDevPage(r.dev.id);
      setActiveNav('dev');
    } else if (r.kind === 'about') {
      renderAbout();
      setActiveNav('about');
    } else if (r.kind === 'tool') {
      /* 直接访问详情页：渲染完整文章，避免用全站卡片列表覆盖预渲染正文 */
      renderToolPage(r.tool);
      setActiveNav('home');
    } else if (r.kind === 'tag') {
      renderTagPage(r.tag);
      setActiveNav('home');
    } else {
      renderNotFound();
      setActiveNav('');
    }

    applyMeta(r);

    var cameFromDrawer = !!prevPath && prevPath.indexOf('/tool/') === 0 && r.kind !== 'tool';
    if (!isSamePath && !cameFromDrawer) window.scrollTo(0, 0);
    var h1 = $('#app h1');
    if (h1 && !drawer.classList.contains('is-open')) {
      h1.setAttribute('tabindex', '-1');
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  /* 站内链接统一走 History 路由：href 保持真实路径，中键新开与抓取器都可用 */
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    if (a.target && a.target !== '_self') return;
    if (a.hasAttribute('download')) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) !== '/' || href.charAt(1) === '/') return;
    /* 卡片标题保留真实 href 供抓取器与中键打开，左键点击仍走抽屉预览 */
    if (a.hasAttribute('data-tool')) { e.preventDefault(); return; }
    e.preventDefault();
    if (drawer.classList.contains('is-open')) {
      state.drawerPushed = false;
      hideDrawer();
      document.body.classList.remove('no-scroll');
    }
    navigate(href);
  });
  document.addEventListener('click', function (e) {
    var target = e.target;

    var fav = target.closest('[data-fav]');
    if (fav) {
      e.preventDefault();
      e.stopPropagation();
      var id = fav.getAttribute('data-fav');
      if (favorites.has(id)) { favorites.delete(id); toast('已取消收藏'); }
      else { favorites.add(id); toast('已加入收藏'); }
      saveFavorites();
      $$('[data-fav="' + id + '"]').forEach(function (b) {
        var on = favorites.has(id);
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
        if (b.classList.contains('btn')) {
          b.innerHTML = '<svg style="width:15px;height:15px" fill="none" stroke="currentColor" aria-hidden="true"><use href="#i-star"/></svg>' + (on ? '已收藏' : '收藏');
        }
        if (b.classList.contains('fav-btn')) {
          b.setAttribute('aria-label', on ? '取消收藏' : '收藏');
        }
      });
      if (location.pathname.indexOf('/favorites') === 0) renderFavorites();
      return;
    }

    var closeBtn = target.closest('[data-close-drawer]');
    if (closeBtn) {
      if (closeBtn.tagName === 'A') {
        state.drawerPushed = false;
        hideDrawer();
        document.body.classList.remove('no-scroll');
        return;
      }
      closeDrawer();
      return;
    }

    var toolEl = target.closest('[data-tool]');
    if (toolEl && !target.closest('[data-visit]')) {
      openTool(toolEl.getAttribute('data-tool'), true);
      return;
    }

    var drawerBtn = target.closest('[data-toggle-sidebar]');
    if (drawerBtn) {
      drawerOpen = !drawerOpen;
      var browse = $('#browse');
      if (browse) browse.classList.toggle('is-collapsed', !drawerOpen);
      drawerBtn.setAttribute('aria-expanded', String(drawerOpen));
      drawerBtn.setAttribute('title', (drawerOpen ? '收起' : '展开') + '筛选');
      saveDrawerState();
      return;
    }

    var devNavBtn = target.closest('[data-toggle-dev-nav]');
    if (devNavBtn) {
      devNavOpen = !devNavOpen;
      var devShell = $('#dev-shell');
      if (devShell) devShell.classList.toggle('is-collapsed', !devNavOpen);
      devNavBtn.setAttribute('aria-expanded', String(devNavOpen));
      devNavBtn.setAttribute('title', (devNavOpen ? '收起' : '展开') + '工具列表');
      saveDevNavState();
      return;
    }

    var catBtn = target.closest('[data-cat-filter]');
    if (catBtn) {
      var nextCat = catBtn.getAttribute('data-cat-filter');
      if (window.matchMedia('(max-width: 900px)').matches) closeFilterSheet();
      navigate(nextCat === 'all' ? '/' : '/category/' + nextCat + '/');
      return;
    }

    var priceBtn = target.closest('[data-price]');
    if (priceBtn) {
      state.pricing = priceBtn.getAttribute('data-price');
      renderResultsArea();
      syncToolsUrl();
      if (window.matchMedia('(max-width: 900px)').matches) closeFilterSheet();
      return;
    }

    var tagBtn = target.closest('[data-tag]');
    if (tagBtn) {
      var tag = tagBtn.getAttribute('data-tag');
      var idx = state.tags.indexOf(tag);
      if (idx >= 0) state.tags.splice(idx, 1); else state.tags.push(tag);
      renderResultsArea();
      syncToolsUrl();
      return;
    }

    var viewBtn = target.closest('[data-view]');
    if (viewBtn) {
      state.view = viewBtn.getAttribute('data-view');
      $$('[data-view]').forEach(function (b) {
        var on = b === viewBtn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      var grid = $('#results-area .tool-grid');
      if (grid) grid.classList.toggle('is-list', state.view === 'list');
      return;
    }

    if (target.closest('[data-reset]')) {
      resetFilters(false);
      return;
    }

    var remove = target.closest('[data-remove-filter]');
    if (remove) {
      var type = remove.getAttribute('data-remove-filter');
      if (type === 'q') { state.query = ''; var si = $('#tools-search'); if (si) si.value = ''; }
      if (type === 'cat') state.cat = 'all';
      if (type === 'price') state.pricing = 'all';
      if (type === 'tag') {
        var val = remove.getAttribute('data-value');
        state.tags = state.tags.filter(function (x) { return x !== val; });
      }
      renderResultsArea();
      if (location.pathname.indexOf('/category/') === 0 && state.cat === 'all') {
        navigate(listUrl());
        return;
      }
      syncToolsUrl();
      return;
    }

    if (target.closest('[data-open-filters]')) {
      var f = $('#filters');
      if (f) f.classList.add('is-open');
      filterScrim.classList.add('is-open');
      document.body.classList.add('no-scroll');
      return;
    }
    if (target.closest('[data-close-filters]')) {
      var f2 = $('#filters');
      if (f2) f2.classList.remove('is-open');
      filterScrim.classList.remove('is-open');
      document.body.classList.remove('no-scroll');
      return;
    }

    var palItem = target.closest('[data-palette-index]');
    if (palItem) {
      activatePalette(Number(palItem.getAttribute('data-palette-index')));
      return;
    }
  });

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (palette.open) closePalette(); else openPalette();
      return;
    }

    if (e.key === '/' && !typing) {
      e.preventDefault();
      var s = $('#tools-search');
      if (s) { s.focus(); return; }
      openPalette();
      return;
    }

    if (e.key === 'Escape') {
      if (palette.open) { closePalette(); return; }
      if (drawer.classList.contains('is-open')) { closeDrawer(); return; }
      var f = $('#filters');
      if (f && f.classList.contains('is-open')) {
        f.classList.remove('is-open');
        filterScrim.classList.remove('is-open');
        document.body.classList.remove('no-scroll');
      }
      return;
    }

    if (palette.open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!palette.items.length) return;
        var delta = e.key === 'ArrowDown' ? 1 : -1;
        palette.active = (palette.active + delta + palette.items.length) % palette.items.length;
        renderPalette();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        activatePalette(palette.active);
      } else if (e.key === 'Tab') {
        var pFocus = $$('input, button', paletteBackdrop).filter(function (el) { return el.offsetParent !== null; });
        if (pFocus.length) {
          var pFirst = pFocus[0], pLast = pFocus[pFocus.length - 1];
          if (e.shiftKey && document.activeElement === pFirst) { e.preventDefault(); pLast.focus(); }
          else if (!e.shiftKey && document.activeElement === pLast) { e.preventDefault(); pFirst.focus(); }
        }
      }
      return;
    }

    if (e.key === 'Tab' && drawer.classList.contains('is-open')) {
      var focusables = $$('a[href], button:not([disabled]), input, textarea, select', drawer)
        .filter(function (el) { return el.offsetParent !== null; });
      if (!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'tools-search') {
      state.query = e.target.value;
      clearTimeout(window.__toolsSearchTimer);
      window.__toolsSearchTimer = setTimeout(function () {
        renderResultsArea();
        syncToolsUrl();
      }, 120);
    }
    if (e.target.id === 'palette-input') {
      palette.active = 0;
      palette.items = buildPaletteItems(e.target.value);
      renderPalette();
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.id === 'sort-select') {
      state.sort = e.target.value;
      renderResultsArea();
      syncToolsUrl();
    }
  });

  document.addEventListener('click', function (e) {
    if (e.target === paletteBackdrop) closePalette();
    if (e.target === drawerBackdrop) closeDrawer();
    if (e.target === filterScrim) {
      var f = $('#filters');
      if (f) f.classList.remove('is-open');
      filterScrim.classList.remove('is-open');
      document.body.classList.remove('no-scroll');
    }
  });

  var navToggle = document.getElementById('nav-toggle');
  if (navToggle) {
    navToggle.addEventListener('click', function () {
      var open = mobileNav.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
  }

  var openPaletteBtn = document.getElementById('open-palette');
  if (openPaletteBtn) openPaletteBtn.addEventListener('click', openPalette);

  /* 主题 */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var sun = $('.icon-sun'), moon = $('.icon-moon');
    if (sun && moon) {
      sun.style.display = theme === 'dark' ? 'none' : 'block';
      moon.style.display = theme === 'dark' ? 'block' : 'none';
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0e0f12' : '#f6f6f2');
  }

  var themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (err) {}
    });
  }
  (function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (err) {}
    applyTheme(saved === 'dark' ? 'dark' : 'light');
  })();

  /* 站点图标：加载成功淡入；失败时依次尝试 svg / ico，最终保留首字色块 */
  function advanceLogo(el) {
    var host = el.getAttribute('data-host');
    var step = Number(el.getAttribute('data-step')) || 0;
    LOGO_OK.delete(host);
    el.classList.remove('is-loaded');
    if (step === 0) {
      el.setAttribute('data-step', '1');
      el.src = 'https://' + host + '/favicon.svg';
    } else if (step === 1) {
      el.setAttribute('data-step', '2');
      el.src = 'https://' + host + '/favicon.ico';
    } else {
      LOGO_FAIL.add(host);
      el.style.display = 'none';
    }
  }

  document.addEventListener('load', function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'IMG' || !el.hasAttribute('data-logo')) return;
    /* 过滤热链保护返回的 1×1 透明图 */
    if (el.naturalWidth > 0 && el.naturalWidth < 8) { advanceLogo(el); return; }
    LOGO_OK.add(el.getAttribute('data-host'));
    el.classList.add('is-loaded');
  }, true);

  document.addEventListener('error', function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'IMG' || !el.hasAttribute('data-logo')) return;
    advanceLogo(el);
  }, true);

  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', function () {
    if (migrateLegacyHash()) return;
    route();
  });

  if (!migrateLegacyHash()) route();
})();
