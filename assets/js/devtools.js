/* ============================================================
 * AGI Hunt — 开发者工具箱
 * 12 个纯前端工具，全部在浏览器本地完成计算，无网络请求。
 * 对外接口：AGI.Dev.mount(id, containerEl)
 * ============================================================ */
window.AGI = window.AGI || {};

(function () {
  'use strict';

  /* ---------------- 通用工具函数 ---------------- */
  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function toast(msg) { if (typeof AGI.toast === 'function') AGI.toast(msg); }

  function copyText(text) {
    if (!text) { toast('暂无内容可复制'); return; }
    function done() { toast('已复制到剪贴板'); }
    function legacy() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, legacy);
    } else {
      legacy();
    }
  }

  function setStatus(el, type, msg) {
    if (!el) return;
    el.className = 'status-line' + (type ? ' ' + type : '');
    var m = el.querySelector('.msg');
    if (m) m.textContent = msg;
  }

  function shell(meta, body) {
    return '' +
      '<div class="dev-panel-head">' +
        '<div class="t">' +
          '<h2>' + esc(meta.name) + ' <span class="tag">' + esc(meta.group) + '</span></h2>' +
          '<p>' + esc(meta.desc) + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="dev-panel-body">' + body + '</div>';
  }

  function btn(label, act, opts) {
    opts = opts || {};
    return '<button type="button" class="' + (opts.cls || 'btn btn-ghost btn-sm') + '"' +
      (opts.attr ? ' ' + opts.attr : '') + ' data-act="' + act + '">' + label + '</button>';
  }

  /* ---------------- JSON 格式化 ---------------- */
  function mountJson(root) {
    root.innerHTML = shell(metaOf('json'), '' +
      '<div class="dev-grid">' +
        '<div class="field">' +
          '<div class="field-head">' +
            '<label for="json-in">输入</label><div class="spacer"></div>' +
            '<select class="input-select" id="json-indent" style="height:28px;font-size:12px;padding:0 26px 0 8px;width:auto">' +
              '<option value="2">缩进 2 空格</option><option value="4">缩进 4 空格</option><option value="tab">Tab</option>' +
            '</select>' +
            btn('示例', 'sample') +
            btn('清空', 'clear') +
          '</div>' +
          '<textarea class="input-area" id="json-in" spellcheck="false" placeholder=\'{"project":"AGI Hunt","tools":84}\'></textarea>' +
          '<div class="status-line" id="json-status"><span class="st"></span><span class="msg">等待输入</span></div>' +
        '</div>' +
        '<div class="field">' +
          '<div class="field-head">' +
            '<label>结果</label><div class="spacer"></div>' +
            btn('压缩', 'minify') +
            btn('键排序', 'sort') +
            '<button type="button" class="btn btn-ghost btn-sm" data-act="copy">复制</button>' +
          '</div>' +
          '<pre class="code-out" id="json-out"></pre>' +
          '<div class="status-line" id="json-meta"><span class="st"></span><span class="msg">—</span></div>' +
        '</div>' +
      '</div>');

    var input = $('#json-in', root);
    var output = $('#json-out', root);
    var status = $('#json-status', root);
    var metaLine = $('#json-meta', root);
    var indentSel = $('#json-indent', root);
    var current = '';

    function indentUnit() {
      var v = indentSel.value;
      return v === 'tab' ? '\t' : Number(v);
    }
    function render(sort) {
      var raw = input.value;
      if (!raw.trim()) {
        output.textContent = '';
        setStatus(status, '', '等待输入');
        setStatus(metaLine, '', '—');
        current = '';
        return;
      }
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        var msg = err && err.message ? err.message : String(err);
        var posMatch = msg.match(/position\s+(\d+)/i);
        var extra = '';
        if (posMatch) {
          var pos = Math.min(Number(posMatch[1]), raw.length);
          var before = raw.slice(0, pos);
          var line = before.split('\n').length;
          var col = pos - before.lastIndexOf('\n');
          extra = ' · 第 ' + line + ' 行第 ' + col + ' 列';
        }
        output.textContent = '';
        setStatus(status, 'err', 'JSON 解析失败' + extra);
        setStatus(metaLine, 'err', msg.replace(/^JSON\.parse:\s*/, ''));
        current = '';
        return;
      }
      if (sort) parsed = sortKeys(parsed);
      var unit = indentUnit();
      current = JSON.stringify(parsed, null, unit);
      output.textContent = current;
      var st = jsonStats(parsed);
      setStatus(status, 'ok', '语法有效');
      setStatus(metaLine, 'ok', st.nodes + ' 个节点 · 深度 ' + st.depth + ' · ' + byteSize(current));
    }

    on(input, 'input', function () { render(false); });
    on(indentSel, 'change', function () { render(false); });
    on(root, 'click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'sample') {
        input.value = JSON.stringify({ project: 'AGI Hunt', version: '2026.11', categories: ['chat', 'code', 'image'], stats: { tools: 126, devtools: 12, openSource: true }, notes: null }, null, 2);
        render(false);
      } else if (act === 'clear') {
        input.value = '';
        render(false);
        input.focus();
      } else if (act === 'minify') {
        if (!current) return toast('请先输入有效 JSON');
        output.textContent = JSON.stringify(JSON.parse(current));
        current = output.textContent;
        setStatus(metaLine, 'ok', '已压缩 · ' + byteSize(current));
      } else if (act === 'sort') {
        render(true);
        if (current) setStatus(metaLine, 'ok', '已按键名排序 · ' + byteSize(current));
      } else if (act === 'copy') {
        copyText(output.textContent);
      }
    });
    input.focus();
  }

  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      var out = {};
      Object.keys(v).sort().forEach(function (k) { out[k] = sortKeys(v[k]); });
      return out;
    }
    return v;
  }
  function jsonStats(v) {
    var nodes = 0, depth = 0;
    (function walk(x, d) {
      nodes++;
      if (d > depth) depth = d;
      if (Array.isArray(x)) x.forEach(function (i) { walk(i, d + 1); });
      else if (x && typeof x === 'object') Object.keys(x).forEach(function (k) { walk(x[k], d + 1); });
    })(v, 1);
    return { nodes: nodes, depth: depth };
  }
  function byteSize(str) {
    var n = new Blob([str]).size;
    return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB';
  }

  /* ---------------- Base64 ---------------- */
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64decode(str) {
    var clean = str.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (clean.length % 4) clean += '=';
    var bin = atob(clean);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  function mountBase64(root) {
    root.innerHTML = shell(metaOf('base64'), '' +
      '<div class="seg" id="b64-mode" style="margin-bottom:16px">' +
        '<button type="button" class="is-on" data-mode="encode">文本 → Base64</button>' +
        '<button type="button" data-mode="decode">Base64 → 文本</button>' +
      '</div>' +
      '<div class="dev-grid">' +
        '<div class="field">' +
          '<div class="field-head"><label>输入</label><div class="spacer"></div>' + btn('示例', 'sample') + btn('清空', 'clear') + '</div>' +
          '<textarea class="input-area" id="b64-in" spellcheck="false" placeholder="输入要编码的文本"></textarea>' +
          '<div class="status-line" id="b64-status"><span class="st"></span><span class="msg">实时转换</span></div>' +
        '</div>' +
        '<div class="field">' +
          '<div class="field-head"><label>输出</label><div class="spacer"></div>' +
            '<label class="check"><input type="checkbox" id="b64-urlsafe"> URL 安全</label>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-act="copy">复制</button>' +
          '</div>' +
          '<pre class="code-out" id="b64-out"></pre>' +
        '</div>' +
      '</div>');

    var mode = 'encode';
    var input = $('#b64-in', root);
    var output = $('#b64-out', root);
    var status = $('#b64-status', root);
    var urlSafe = $('#b64-urlsafe', root);

    function render() {
      var val = input.value;
      if (!val) { output.textContent = ''; setStatus(status, '', '实时转换'); return; }
      try {
        var out = mode === 'encode' ? b64encode(val) : b64decode(val);
        if (mode === 'encode' && urlSafe.checked) out = out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        output.textContent = out;
        setStatus(status, 'ok', (mode === 'encode' ? '已编码' : '已解码') + ' · ' + byteSize(out));
      } catch (e) {
        output.textContent = '';
        setStatus(status, 'err', '不是合法的 Base64 字符串');
      }
    }

    on(input, 'input', render);
    on(urlSafe, 'change', render);
    $$('#b64-mode button', root).forEach(function (b) {
      on(b, 'click', function () {
        mode = b.getAttribute('data-mode');
        $$('#b64-mode button', root).forEach(function (x) { x.classList.toggle('is-on', x === b); });
        input.placeholder = mode === 'encode' ? '输入要编码的文本' : '粘贴 Base64 字符串';
        if (mode === 'decode') { input.value = output.textContent; }
        render();
      });
    });
    on(root, 'click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'sample') { input.value = 'AGI Hunt · 让工具回到工具本身'; render(); }
      if (act === 'clear') { input.value = ''; render(); input.focus(); }
      if (act === 'copy') copyText(output.textContent);
    });
    input.focus();
  }

  /* ---------------- URL 编解码 ---------------- */
  function mountUrl(root) {
    root.innerHTML = shell(metaOf('url'), '' +
      '<div class="seg" id="url-mode" style="margin-bottom:16px">' +
        '<button type="button" class="is-on" data-mode="encode">编码</button>' +
        '<button type="button" data-mode="decode">解码</button>' +
        '<button type="button" data-mode="query">拆解查询参数</button>' +
      '</div>' +
      '<div class="dev-grid">' +
        '<div class="field">' +
          '<div class="field-head"><label>输入</label><div class="spacer"></div>' + btn('清空', 'clear') + '</div>' +
          '<textarea class="input-area" id="url-in" spellcheck="false" placeholder="https://example.com/search?q=AI 工具&lang=zh"></textarea>' +
          '<div class="status-line" id="url-status"><span class="st"></span><span class="msg">实时转换</span></div>' +
        '</div>' +
        '<div class="field">' +
          '<div class="field-head"><label>输出</label><div class="spacer"></div>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-act="copy">复制</button></div>' +
          '<pre class="code-out" id="url-out"></pre>' +
        '</div>' +
      '</div>' +
      '<div id="url-params-wrap" style="margin-top:18px;display:none">' +
        '<div class="field-head"><label>查询参数</label></div>' +
        '<div class="code-out is-compact" id="url-params" style="padding:6px 13px"></div>' +
      '</div>');

    var mode = 'encode';
    var input = $('#url-in', root);
    var output = $('#url-out', root);
    var status = $('#url-status', root);
    var paramWrap = $('#url-params-wrap', root);
    var paramBox = $('#url-params', root);

    function renderParams(text) {
      var qi = text.indexOf('?');
      if (qi < 0) { paramWrap.style.display = 'none'; return; }
      var qs = text.slice(qi + 1).split('#')[0];
      if (!qs) { paramWrap.style.display = 'none'; return; }
      var rows = qs.split('&').filter(Boolean).map(function (pair) {
        var i = pair.indexOf('=');
        var k = i < 0 ? pair : pair.slice(0, i);
        var v = i < 0 ? '' : pair.slice(i + 1);
        try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch (e) {}
        try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) {}
        return '<tr><th style="width:38%">' + esc(k) + '</th><td>' + (v ? esc(v) : '<span style="color:var(--ink-4)">（空）</span>') + '</td></tr>';
      });
      if (!rows.length) { paramWrap.style.display = 'none'; return; }
      paramBox.innerHTML = '<table class="kv-table">' + rows.join('') + '</table>';
      paramWrap.style.display = 'block';
    }

    function render() {
      var val = input.value;
      if (!val) { output.textContent = ''; setStatus(status, '', '实时转换'); paramWrap.style.display = 'none'; return; }
      try {
        var out;
        if (mode === 'encode') out = encodeURIComponent(val);
        else if (mode === 'decode') out = decodeURIComponent(val.replace(/\+/g, ' '));
        else out = val;
        output.textContent = out;
        setStatus(status, 'ok', mode === 'query' ? '已拆解参数' : (mode === 'encode' ? '已编码（encodeURIComponent）' : '已解码'));
        renderParams(mode === 'encode' ? val : (mode === 'decode' ? out : val));
      } catch (e) {
        output.textContent = '';
        setStatus(status, 'err', '存在非法的百分号编码');
        paramWrap.style.display = 'none';
      }
    }

    on(input, 'input', render);
    $$('#url-mode button', root).forEach(function (b) {
      on(b, 'click', function () {
        mode = b.getAttribute('data-mode');
        $$('#url-mode button', root).forEach(function (x) { x.classList.toggle('is-on', x === b); });
        render();
      });
    });
    on(root, 'click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.getAttribute('data-act') === 'clear') { input.value = ''; render(); input.focus(); }
      if (b.getAttribute('data-act') === 'copy') copyText(output.textContent);
    });
    input.focus();
  }

  /* ---------------- 哈希 ---------------- */
  function bufToHex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }
  function bufToB64(buf) {
    var bytes = new Uint8Array(buf), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function mountHash(root) {
    root.innerHTML = shell(metaOf('hash'), '' +
      '<div class="dev-grid">' +
        '<div class="field">' +
          '<div class="field-head"><label for="hash-in">输入文本</label><div class="spacer"></div>' + btn('清空', 'clear') + '</div>' +
          '<textarea class="input-area" id="hash-in" spellcheck="false" placeholder="任意文本，实时计算摘要"></textarea>' +
          '<div class="field-head" style="margin-top:14px">' +
            '<label for="hash-algo">算法</label><div class="spacer"></div>' +
            '<select class="input-select" id="hash-algo" style="width:auto">' +
              '<option value="SHA-256">SHA-256</option><option value="SHA-1">SHA-1</option>' +
              '<option value="SHA-384">SHA-384</option><option value="SHA-512">SHA-512</option>' +
            '</select>' +
          '</div>' +
          '<div class="status-line" id="hash-status"><span class="st"></span><span class="msg">由 Web Crypto 本地计算</span></div>' +
        '</div>' +
        '<div class="field">' +
          '<div class="field-head"><label>摘要</label><div class="spacer"></div>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-act="copy-hex">复制 HEX</button></div>' +
          '<div class="code-out is-compact" id="hash-out" style="min-height:120px"></div>' +
          '<div class="notice"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg><span>文本不会离开浏览器。SHA 系列为单向摘要，无法反推原文。</span></div>' +
        '</div>' +
      '</div>');

    var input = $('#hash-in', root);
    var output = $('#hash-out', root);
    var status = $('#hash-status', root);
    var algo = $('#hash-algo', root);
    var latest = { hex: '' };
    var seq = 0;

    function render() {
      var val = input.value;
      if (!val) { output.innerHTML = '<span style="color:var(--ink-4)">等待输入…</span>'; latest.hex = ''; setStatus(status, '', '由 Web Crypto 本地计算'); return; }
      if (!window.crypto || !window.crypto.subtle) {
        setStatus(status, 'err', '当前环境不支持 Web Crypto，请通过 https 或 localhost 访问');
        return;
      }
      var mySeq = ++seq;
      window.crypto.subtle.digest(algo.value, new TextEncoder().encode(val)).then(function (buf) {
        if (mySeq !== seq) return;
        var hex = bufToHex(buf), b64 = bufToB64(buf);
        latest.hex = hex;
        output.innerHTML = '<table class="kv-table">' +
          '<tr><th>算法</th><td>' + esc(algo.value) + '</td></tr>' +
          '<tr><th>HEX</th><td style="font-family:var(--font-mono);font-size:12px">' + esc(hex) + '</td></tr>' +
          '<tr><th>Base64</th><td style="font-family:var(--font-mono);font-size:12px">' + esc(b64) + '</td></tr>' +
          '<tr><th>长度</th><td>' + (hex.length * 4) + ' bit / ' + hex.length + ' 字符</td></tr>' +
          '</table>';
        setStatus(status, 'ok', '计算完成 · ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      }).catch(function () {
        setStatus(status, 'err', '计算失败');
      });
    }

    var timer;
    on(input, 'input', function () { clearTimeout(timer); timer = setTimeout(render, 120); });
    on(algo, 'change', render);
    on(root, 'click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.getAttribute('data-act') === 'clear') { input.value = ''; render(); input.focus(); }
      if (b.getAttribute('data-act') === 'copy-hex') copyText(latest.hex);
    });
    input.focus();
  }

  /* ---------------- JWT 解析 ---------------- */
  function b64urlDecode(str) {
    var s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function mountJwt(root) {
    root.innerHTML = shell(metaOf('jwt'), '' +
      '<div class="field">' +
        '<div class="field-head"><label for="jwt-in">JWT</label><div class="spacer"></div>' +
          btn('示例', 'sample') + btn('清空', 'clear') + '</div>' +
        '<textarea class="input-area" id="jwt-in" spellcheck="false" style="min-height:120px" placeholder="粘贴形如 xxxxx.yyyyy.zzzzz 的令牌"></textarea>' +
        '<div class="status-line" id="jwt-status"><span class="st"></span><span class="msg">仅做本地解码，不校验签名</span></div>' +
      '</div>' +
      '<div class="dev-grid" style="margin-top:18px">' +
        '<div class="field"><div class="field-head"><label>Header</label></div><pre class="code-out is-compact" id="jwt-header" style="min-height:150px"></pre></div>' +
        '<div class="field"><div class="field-head"><label>Payload</label></div><pre class="code-out is-compact" id="jwt-payload" style="min-height:150px"></pre></div>' +
      '</div>' +
      '<div id="jwt-claims" style="margin-top:18px"></div>' +
      '<div class="notice"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/></svg><span>解码结果仅用于调试。签名有效性必须在服务端用密钥验证，前端解码不能作为身份依据。</span></div>');

    var input = $('#jwt-in', root);
    var headerEl = $('#jwt-header', root);
    var payloadEl = $('#jwt-payload', root);
    var claimsEl = $('#jwt-claims', root);
    var status = $('#jwt-status', root);

    function render() {
      var raw = input.value.trim();
      headerEl.textContent = '';
      payloadEl.textContent = '';
      claimsEl.innerHTML = '';
      if (!raw) { setStatus(status, '', '仅做本地解码，不校验签名'); return; }
      var parts = raw.split('.');
      if (parts.length < 2) { setStatus(status, 'err', '结构不完整，至少需要 header.payload'); return; }
      try {
        var header = JSON.parse(b64urlDecode(parts[0]));
        var payload = JSON.parse(b64urlDecode(parts[1]));
        headerEl.textContent = JSON.stringify(header, null, 2);
        payloadEl.textContent = JSON.stringify(payload, null, 2);
        var rows = [];
        if (payload.iss) rows.push(['iss 签发方', payload.iss]);
        if (payload.sub) rows.push(['sub 主体', payload.sub]);
        if (payload.aud) rows.push(['aud 受众', String(payload.aud)]);
        if (payload.iat) rows.push(['iat 签发时间', new Date(payload.iat * 1000).toLocaleString('zh-CN', { hour12: false })]);
        if (payload.exp) {
          var exp = new Date(payload.exp * 1000);
          var expired = payload.exp * 1000 < Date.now();
          rows.push(['exp 过期时间', exp.toLocaleString('zh-CN', { hour12: false }) + (expired ? '（已过期）' : '（未过期）')]);
        }
        claimsEl.innerHTML = rows.length
          ? '<div class="code-out is-compact" style="padding:6px 13px"><table class="kv-table">' +
            rows.map(function (r) { return '<tr><th style="width:140px">' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') +
            '</table></div>'
          : '';
        setStatus(status, 'ok', '解码成功 · 算法 ' + (header.alg || '未知'));
      } catch (e) {
        setStatus(status, 'err', '解码失败：不是合法的 JWT');
      }
    }

    on(input, 'input', render);
    on(root, 'click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'sample') {
        var h = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=+$/, '');
        var p = btoa(JSON.stringify({ sub: 'user_1024', iss: 'agi-hunt', role: 'admin', iat: 1762000000, exp: 1893456000 })).replace(/=+$/, '');
        input.value = h + '.' + p + '.signature-placeholder';
        render();
      }
      if (act === 'clear') { input.value = ''; render(); input.focus(); }
    });
    input.focus();
  }

  /* ---------------- UUID ---------------- */
  function uuidv4() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var b = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function mountUuid(root) {
    root.innerHTML = shell(metaOf('uuid'), '' +
      '<div class="field">' +
        '<div class="field-head"><label for="uuid-count">数量</label><div class="spacer"></div>' +
          '<label class="check"><input type="checkbox" id="uuid-upper"> 大写</label>' +
          '<label class="check"><input type="checkbox" id="uuid-nodash"> 去掉连字符</label>' +
          btn('重新生成', 'regen', { cls: 'btn btn-primary btn-sm' }) +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">' +
          '<input class="input-line" id="uuid-count" type="number" min="1" max="100" value="8" style="max-width:110px">' +
          '<span style="font-size:12px;color:var(--ink-3)">条，单次最多 100 条</span>' +
        '</div>' +
        '<pre class="code-out" id="uuid-out" style="min-height:260px"></pre>' +
        '<div class="status-line" id="uuid-status"><span class="st"></span><span class="msg"></span></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:14px">' +
        btn('复制全部', 'copy', { cls: 'btn btn-ghost btn-sm' }) +
      '</div>');

    var count = $('#uuid-count', root);
    var upper = $('#uuid-upper', root);
    var nodash = $('#uuid-nodash', root);
    var out = $('#uuid-out', root);
    var status = $('#uuid-status', root);
    var list = [];

    function render() {
      var n = Math.max(1, Math.min(100, Number(count.value) || 1));
      count.value = n;
      list = [];
      for (var i = 0; i < n; i++) {
        var u = uuidv4();
        if (nodash.checked) u = u.replace(/-/g, '');
        if (upper.checked) u = u.toUpperCase();
        list.push(u);
      }
      out.textContent = list.join('\n');
      setStatus(status, 'ok', '已生成 ' + n + ' 条 · v4 随机版本');
    }

    on(count, 'input', render);
    on(upper, 'change', render);
    on(nodash, 'change', render);
    on(root, 'click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.getAttribute('data-act') === 'regen') render();
      if (b.getAttribute('data-act') === 'copy') copyText(list.join('\n'));
    });
    render();
  }

  /* ---------------- 时间戳 ---------------- */
  function mountTimestamp(root) {
    root.innerHTML = shell(metaOf('timestamp'), '' +
      '<div class="field" style="margin-bottom:18px">' +
        '<div class="field-head"><label>当前时间</label><div class="spacer"></div>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="copy-now">复制秒级</button></div>' +
        '<div class="stat-grid">' +
          '<div class="stat-box"><span class="lb">Unix 秒</span><span class="vl" id="ts-sec">—</span></div>' +
          '<div class="stat-box"><span class="lb">Unix 毫秒</span><span class="vl is-text" id="ts-ms">—</span></div>' +
          '<div class="stat-box"><span class="lb">本地时间</span><span class="vl is-text" id="ts-local">—</span></div>' +
          '<div class="stat-box"><span class="lb">UTC</span><span class="vl is-text" id="ts-utc" style="line-height:1.5">—</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="field">' +
        '<div class="field-head"><label for="ts-input">时间戳 / 日期互转</label><div class="spacer"></div>' +
          btn('现在', 'now') + btn('今天 0 点', 'today') + btn('清空', 'clear') + '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<input class="input-line" id="ts-input" placeholder="1762000000 或 2026-11-02 14:30:00" style="flex:1">' +
          '<button type="button" class="btn btn-primary" data-act="convert" style="height:40px">转换</button>' +
        '</div>' +
        '<div class="status-line" id="ts-status"><span class="st"></span><span class="msg">支持 10 位秒、13 位毫秒与常见日期格式</span></div>' +
        '<div id="ts-result" style="margin-top:14px"></div>' +
      '</div>');

    var input = $('#ts-input', root);
    var status = $('#ts-status', root);
    var result = $('#ts-result', root);

    function pad(n) { return String(n).padStart(2, '0'); }
    function fmtLocal(d) {
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
        pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
    function tick() {
      var now = new Date();
      var sec = Math.floor(now.getTime() / 1000);
      $('#ts-sec', root).textContent = sec;
      $('#ts-ms', root).textContent = now.getTime();
      $('#ts-local', root).textContent = fmtLocal(now);
      $('#ts-utc', root).textContent = now.toUTCString().replace('GMT', 'UTC');
    }
    tick();
    clearInterval(AGI.Dev._timer);
    AGI.Dev._timer = setInterval(tick, 1000);

    function convert() {
      var raw = input.value.trim();
      if (!raw) { result.innerHTML = ''; setStatus(status, '', '等待输入'); return; }
      var ms;
      if (/^\d{10}$/.test(raw)) ms = Number(raw) * 1000;
      else if (/^\d{13}$/.test(raw)) ms = Number(raw);
      else if (/^\d+$/.test(raw)) ms = Number(raw);
      else {
        var normalized = raw.replace(/\//g, '-').replace(' ', 'T');
        ms = Date.parse(normalized);
      }
      if (!ms || isNaN(ms)) { result.innerHTML = ''; setStatus(status, 'err', '无法识别该格式，请检查输入'); return; }
      var d = new Date(ms);
      var diff = ms - Date.now();
      var absDiff = Math.abs(diff);
      var relText;
      if (absDiff < 60000) relText = '刚刚';
      else if (absDiff < 3600000) relText = (diff > 0 ? '还有 ' : '已过去 ') + Math.floor(absDiff / 60000) + ' 分钟';
      else if (absDiff < 86400000) relText = (diff > 0 ? '还有 ' : '已过去 ') + Math.floor(absDiff / 3600000) + ' 小时';
      else relText = (diff > 0 ? '还有 ' : '已过去 ') + Math.floor(absDiff / 86400000) + ' 天';

      result.innerHTML = '<div class="code-out is-compact" style="padding:6px 13px"><table class="kv-table">' +
        '<tr><th>Unix 秒</th><td>' + Math.floor(ms / 1000) + '</td></tr>' +
        '<tr><th>Unix 毫秒</th><td>' + ms + '</td></tr>' +
        '<tr><th>本地时间</th><td>' + esc(fmtLocal(d)) + '</td></tr>' +
        '<tr><th>ISO 8601</th><td>' + esc(d.toISOString()) + '</td></tr>' +
        '<tr><th>UTC</th><td>' + esc(d.toUTCString()) + '</td></tr>' +
        '<tr><th>相对现在</th><td>' + esc(relText) + '</td></tr>' +
        '</table></div>';
      setStatus(status, 'ok', '转换完成');
    }

    on(root, 'click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'now') { input.value = String(Math.floor(Date.now() / 1000)); convert(); }
      if (act === 'today') {
        var d = new Date(); d.setHours(0, 0, 0, 0);
        input.value = String(Math.floor(d.getTime() / 1000)); convert();
      }
      if (act === 'clear') { input.value = ''; result.innerHTML = ''; setStatus(status, '', '等待输入'); input.focus(); }
      if (act === 'convert') convert();
      if (act === 'copy-now') copyText(String(Math.floor(Date.now() / 1000)));
    });
    on(input, 'keydown', function (e) { if (e.key === 'Enter') convert(); });
    input.focus();
  }

  /* ---------------- 颜色转换 ---------------- */
  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  }
  function toHex(r, g, b) {
    return '#' + [r, g, b].map(function (x) { return clamp(x, 0, 255).toString(16).padStart(2, '0'); }).join('');
  }
  function parseColor(str) {
    if (!str) return null;
    var s = str.trim().toLowerCase();
    var m;
    if ((m = s.match(/^#?([0-9a-f]{3})$/))) {
      var h3 = m[1];
      return [parseInt(h3[0] + h3[0], 16), parseInt(h3[1] + h3[1], 16), parseInt(h3[2] + h3[2], 16), 1];
    }
    if ((m = s.match(/^#?([0-9a-f]{6})$/))) {
      return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
    }
    if ((m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/))) {
      return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    }
    if ((m = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+))?\s*\)$/))) {
      var rgb = hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
      return [rgb[0], rgb[1], rgb[2], m[4] === undefined ? 1 : Number(m[4])];
    }
    if (s === 'white') return [255, 255, 255, 1];
    if (s === 'black') return [0, 0, 0, 1];
    return null;
  }

  function mountColor(root) {
    root.innerHTML = shell(metaOf('color'), '' +
      '<div class="field-head"><label for="color-in">颜色值</label><div class="spacer"></div>' +
        btn('随色', 'random') + '</div>' +
      '<input class="input-line" id="color-in" value="#3d4fe0" spellcheck="false" placeholder="#3d4fe0 / rgb(61,79,224) / hsl(232,72%,56%)">' +
      '<div class="status-line" id="color-status"><span class="st"></span><span class="msg">支持 HEX、RGB、HSL</span></div>' +
      '<div style="margin-top:20px" class="swatch-row">' +
        '<div class="swatch" id="color-swatch"></div>' +
        '<div style="flex:1;min-width:0"><table class="kv-table" id="color-table"></table></div>' +
      '</div>' +
      '<div style="margin-top:22px">' +
        '<div class="field-head"><label>明度阶梯</label><div class="spacer"></div>' +
          '<span style="font-size:11px;color:var(--ink-4)">点击复制</span></div>' +
        '<div class="shade-strip" id="color-shades"></div>' +
      '</div>');

    var input = $('#color-in', root);
    var swatch = $('#color-swatch', root);
    var table = $('#color-table', root);
    var status = $('#color-status', root);
    var shades = $('#color-shades', root);

    function render() {
      var c = parseColor(input.value);
      if (!c) { setStatus(status, 'err', '无法解析该颜色值'); return; }
      var r = clamp(Math.round(c[0]), 0, 255), g = clamp(Math.round(c[1]), 0, 255), b = clamp(Math.round(c[2]), 0, 255);
      var hsl = rgbToHsl(r, g, b);
      var hex = toHex(r, g, b);
      swatch.style.background = 'rgba(' + r + ',' + g + ',' + b + ',' + c[3] + ')';
      table.innerHTML =
        '<tr><th>HEX</th><td style="font-family:var(--font-mono)">' + hex.toUpperCase() + '</td></tr>' +
        '<tr><th>RGB</th><td style="font-family:var(--font-mono)">rgb(' + r + ', ' + g + ', ' + b + ')</td></tr>' +
        '<tr><th>HSL</th><td style="font-family:var(--font-mono)">hsl(' + hsl[0] + ', ' + hsl[1] + '%, ' + hsl[2] + '%)</td></tr>' +
        '<tr><th>亮度</th><td>' + Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b) + ' / 255</td></tr>';
      setStatus(status, 'ok', '解析成功');

      var levels = [95, 88, 78, 68, 58, 48, 38, 28, 20];
      shades.innerHTML = levels.map(function (l) {
        var rgb = hslToRgb(hsl[0], hsl[1], l);
        var h = toHex(rgb[0], rgb[1], rgb[2]);
        return '<button type="button" style="background:' + h + '" data-shade="' + h + '" title="' + h + '">' +
          '<span style="color:' + (l > 60 ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.65)') + '">' + h.slice(1) + '</span></button>';
      }).join('');
    }

    var timer;
    on(input, 'input', function () { clearTimeout(timer); timer = setTimeout(render, 100); });
    on(shades, 'click', function (e) {
      var b = e.target.closest('[data-shade]');
      if (b) copyText(b.getAttribute('data-shade').toUpperCase());
    });
    on(root, 'click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.getAttribute('data-act') === 'random') {
        var rgb = [0, 0, 0].map(function () { return Math.floor(Math.random() * 256); });
        input.value = toHex(rgb[0], rgb[1], rgb[2]);
        render();
      }
    });
    render();
  }

  /* ---------------- 正则测试 ---------------- */
  function mountRegex(root) {
    root.innerHTML = shell(metaOf('regex'), '' +
      '<div class="field">' +
        '<div class="field-head"><label for="re-pattern">表达式</label><div class="spacer"></div>' +
          '<span style="font-size:11px;color:var(--ink-4)">无需输入斜杠</span></div>' +
        '<div style="display:flex;align-items:center;gap:0;border:1px solid var(--line);border-radius:10px;background:var(--bg-elevated);padding:0 12px">' +
          '<span style="font-family:var(--font-mono);color:var(--ink-4);font-size:13px">/</span>' +
          '<input id="re-pattern" style="flex:1;border:0;background:none;outline:none;height:42px;padding:0 8px;font-family:var(--font-mono);font-size:13px" placeholder="\\b(\\w+)@(\\w+\\.\\w+)\\b" spellcheck="false">' +
          '<span style="font-family:var(--font-mono);color:var(--ink-4);font-size:13px">/</span>' +
          '<span id="re-flags-echo" style="font-family:var(--font-mono);color:var(--accent);font-size:13px;min-width:18px">g</span>' +
        '</div>' +
        '<div class="check-row">' +
          ['g', 'i', 'm', 's', 'u'].map(function (f) {
            return '<label class="check"><input type="checkbox" data-flag="' + f + '"' + (f === 'g' ? ' checked' : '') + '> ' + f + '</label>';
          }).join('') +
        '</div>' +
        '<div class="status-line" id="re-status" style="margin-top:12px"><span class="st"></span><span class="msg">输入表达式与测试文本</span></div>' +
      '</div>' +
      '<div class="field" style="margin-top:16px">' +
        '<div class="field-head"><label for="re-text">测试文本</label><div class="spacer"></div>' + btn('示例', 'sample') + '</div>' +
        '<textarea class="input-area" id="re-text" style="min-height:150px" spellcheck="false" placeholder="contact: dev@agi-hunt.com, ops@example.org"></textarea>' +
      '</div>' +
      '<div class="field" style="margin-top:16px">' +
        '<div class="field-head"><label>匹配结果</label><div class="spacer"></div><span id="re-count" style="font-size:11px;color:var(--ink-3)"></span></div>' +
        '<div class="preview-area" id="re-highlight" style="min-height:80px;max-height:200px;font-family:var(--font-mono);font-size:12.5px;white-space:pre-wrap"></div>' +
        '<div class="match-list" id="re-list" style="margin-top:10px"></div>' +
      '</div>');

    var pattern = $('#re-pattern', root);
    var text = $('#re-text', root);
    var list = $('#re-list', root);
    var highlight = $('#re-highlight', root);
    var status = $('#re-status', root);
    var count = $('#re-count', root);
    var echo = $('#re-flags-echo', root);

    function flags() {
      return $$('[data-flag]', root).filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-flag'); }).join('');
    }

    function render() {
      var f = flags();
      echo.textContent = f;
      var p = pattern.value;
      if (!p) { list.innerHTML = ''; highlight.textContent = ''; count.textContent = ''; setStatus(status, '', '输入表达式与测试文本'); return; }
      var re;
      try { re = new RegExp(p, f); }
      catch (e) { list.innerHTML = ''; highlight.textContent = ''; setStatus(status, 'err', '表达式无效：' + e.message); count.textContent = ''; return; }
      var src = text.value;
      var matches = [];
      if (f.indexOf('g') >= 0) {
        var m, guard = 0;
        while ((m = re.exec(src)) !== null && guard++ < 5000) {
          matches.push(m);
          if (m[0] === '') re.lastIndex++;
        }
      } else {
        var one = re.exec(src);
        if (one) matches.push(one);
      }
      count.textContent = matches.length ? matches.length + ' 处匹配' : '无匹配';
      setStatus(status, matches.length ? 'ok' : '', matches.length ? '表达式有效' : '表达式有效，但没有匹配到内容');

      list.innerHTML = matches.slice(0, 100).map(function (m, i) {
        var groups = m.slice(1).map(function (g, gi) {
          return g === undefined ? null : '<span style="color:var(--ink-3)">$' + (gi + 1) + '=</span>' + esc(g);
        }).filter(Boolean).join('  ');
        return '<div class="match-item"><span class="idx">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<span class="val"><mark>' + esc(m[0]) + '</mark>' + (groups ? '  <span style="color:var(--ink-4)">|</span>  ' + groups : '') +
          '  <span style="color:var(--ink-4)">@' + m.index + '</span></span></div>';
      }).join('');

      if (matches.length && src) {
        var first = matches[0];
        var start = first.index, end = start + first[0].length;
        highlight.innerHTML = esc(src.slice(0, start)) +
          '<mark style="background:var(--accent);color:#fff;border-radius:3px">' + esc(src.slice(start, end)) + '</mark>' +
          esc(src.slice(end));
      } else {
        highlight.textContent = src;
      }
    }

    on(pattern, 'input', render);
    on(text, 'input', render);
    $$('[data-flag]', root).forEach(function (c) { on(c, 'change', render); });
    on(root, 'click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.getAttribute('data-act') === 'sample') {
        pattern.value = '\\b[\\w.+-]+@[\\w-]+\\.[\\w.]+\\b';
        text.value = '联系 dev@agi-hunt.com 或 ops@example.org，无效地址：not-an-email@';
        render();
      }
    });
    pattern.focus();
  }

  /* ---------------- 文本统计 ---------------- */
  function mountText(root) {
    root.innerHTML = shell(metaOf('text'), '' +
      '<div class="field">' +
        '<div class="field-head"><label for="text-in">文本</label><div class="spacer"></div>' + btn('清空', 'clear') + '</div>' +
        '<textarea class="input-area" id="text-in" style="min-height:280px" placeholder="粘贴需要统计的文本…"></textarea>' +
      '</div>' +
      '<div class="stat-grid" id="text-stats" style="margin-top:18px"></div>' +
      '<div class="status-line" id="text-status" style="margin-top:14px"><span class="st"></span><span class="msg">Token 数为启发式估算，实际以分词器为准</span></div>');

    var input = $('#text-in', root);
    var grid = $('#text-stats', root);

    function render() {
      var s = input.value;
      var cjk = (s.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
      var latinWords = (s.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
      var charsNoSpace = s.replace(/\s/g, '').length;
      var lines = s ? s.split('\n').length : 0;
      var paragraphs = s.trim() ? s.trim().split(/\n\s*\n/).filter(function (p) { return p.trim(); }).length : 0;
      var tokens = Math.ceil(cjk * 0.75 + latinWords * 1.32);
      var minutes = (cjk / 400) + (latinWords / 220);
      var readTime = minutes < 1 ? (minutes > 0 ? '少于 1 分钟' : '—') : Math.ceil(minutes) + ' 分钟';

      var items = [
        ['字符（含空格）', s.length],
        ['字符（不含空格）', charsNoSpace],
        ['汉字 / 假名 / 谚文', cjk],
        ['西文词数', latinWords],
        ['行数', lines],
        ['段落数', paragraphs],
        ['预估 Token', tokens],
        ['阅读时长', readTime]
      ];
      grid.innerHTML = items.map(function (it) {
        var val = it[1] === '' ? '—' : it[1];
        var isText = typeof val === 'string' && val.indexOf('分钟') >= 0;
        return '<div class="stat-box"><span class="lb">' + it[0] + '</span><span class="vl' + (isText ? ' is-text' : '') + '">' + val + '</span></div>';
      }).join('');
    }

    on(input, 'input', render);
    on(root, 'click', function (e) {
      var b = e.target.closest('[data-act]');
      if (b && b.getAttribute('data-act') === 'clear') { input.value = ''; render(); input.focus(); }
    });
    render();
    input.focus();
  }

  /* ---------------- Markdown 预览 ---------------- */
  function mdInline(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  function mdToHtml(src) {
    var blocks = [];
    var text = esc(src).replace(/```[a-zA-Z0-9+-]*\n?([\s\S]*?)```/g, function (m, code) {
      blocks.push('<pre><code>' + code.replace(/\n$/, '') + '</code></pre>');
      return '\n\u0000B' + (blocks.length - 1) + '\u0000\n';
    });
    var lines = text.split('\n');
    var html = '', listType = null, para = [];
    function closeList() { if (listType) { html += '</' + listType + '>'; listType = null; } }
    function flushPara() { if (para.length) { html += '<p>' + mdInline(para.join(' ')) + '</p>'; para = []; } }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      var ph = line.match(/^\u0000B(\d+)\u0000$/);
      if (ph) { flushPara(); closeList(); html += blocks[Number(ph[1])]; continue; }
      if (!line) { flushPara(); closeList(); continue; }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { flushPara(); closeList(); html += '<hr>'; continue; }
      var m;
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        flushPara(); closeList();
        var lv = m[1].length;
        html += '<h' + lv + '>' + mdInline(m[2]) + '</h' + lv + '>';
        continue;
      }
      if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); closeList(); html += '<blockquote>' + mdInline(m[1]) + '</blockquote>'; continue; }
      if ((m = line.match(/^[-*+]\s+(.*)$/))) {
        flushPara();
        if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
        html += '<li>' + mdInline(m[1]) + '</li>';
        continue;
      }
      if ((m = line.match(/^\d+\.\s+(.*)$/))) {
        flushPara();
        if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
        html += '<li>' + mdInline(m[1]) + '</li>';
        continue;
      }
      para.push(line);
    }
    flushPara(); closeList();
    return html || '<p style="color:var(--ink-4)">在左侧输入 Markdown，右侧即时渲染。</p>';
  }

  function mountMarkdown(root) {
    root.innerHTML = shell(metaOf('markdown'), '' +
      '<div class="dev-grid">' +
        '<div class="field">' +
          '<div class="field-head"><label for="md-in">Markdown</label><div class="spacer"></div>' +
            btn('载入示例', 'sample') + btn('清空', 'clear') + '</div>' +
          '<textarea class="input-area" id="md-in" style="min-height:360px" spellcheck="false"></textarea>' +
        '</div>' +
        '<div class="field">' +
          '<div class="field-head"><label>预览</label></div>' +
          '<div class="preview-area" id="md-out" style="min-height:360px"></div>' +
        '</div>' +
      '</div>' +
      '<div class="status-line" id="md-status" style="margin-top:12px"><span class="st"></span><span class="msg">支持标题、列表、引用、代码块、链接与强调</span></div>');

    var input = $('#md-in', root);
    var out = $('#md-out', root);
    var timer;

    function render() {
      out.innerHTML = mdToHtml(input.value);
    }
    on(input, 'input', function () {
      clearTimeout(timer);
      timer = setTimeout(render, 120);
    });
    on(root, 'click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'sample') {
        input.value = '# AGI Hunt 开发者工具\n\n> 所有计算都在本地完成，不发送任何请求。\n\n## 常用场景\n\n- **调试接口**：格式化响应、解析 JWT\n- **编码转换**：Base64、URL、哈希\n- `Ctrl + K` 打开全局搜索\n\n```js\nconst tools = ["json", "base64", "jwt"];\nconsole.log(tools.length); // 3\n```\n\n更深的内容见 [架构说明](#/about)。\n';
        render();
      }
      if (act === 'clear') { input.value = ''; render(); input.focus(); }
    });
    input.value = '# AGI Hunt 开发者工具\n\n在左侧写下 Markdown，右侧会即时渲染。\n\n- 支持**加粗**、*斜体*与 `行内代码`\n- 支持有序 / 无序列表\n- 支持代码块与引用\n\n> 提示：按 ⌘K 可以随时唤起全局搜索。\n';
    render();
    input.focus();
  }

  /* ---------------- 文本对比 ---------------- */
  function diffLines(a, b) {
    var A = a.length ? a.split('\n') : [];
    var B = b.length ? b.split('\n') : [];
    var n = A.length, m = B.length;
    if (n * m > 4000000) {
      return A.map(function (l) { return { t: 'same', v: l }; }).concat(B.map(function (l) { return { t: 'same', v: l }; }));
    }
    var w = m + 1;
    var dp = new Uint32Array((n + 1) * w);
    for (var i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        dp[i * w + j] = A[i] === B[j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    var out = [];
    var x = 0, y = 0;
    while (x < n && y < m) {
      if (A[x] === B[y]) { out.push({ t: 'same', v: A[x] }); x++; y++; }
      else if (dp[(x + 1) * w + y] >= dp[x * w + y + 1]) { out.push({ t: 'del', v: A[x] }); x++; }
      else { out.push({ t: 'add', v: B[y] }); y++; }
    }
    while (x < n) { out.push({ t: 'del', v: A[x] }); x++; }
    while (y < m) { out.push({ t: 'add', v: B[y] }); y++; }
    return out;
  }

  function mountDiff(root) {
    root.innerHTML = shell(metaOf('diff'), '' +
      '<div class="dev-grid">' +
        '<div class="field">' +
          '<div class="field-head"><label for="diff-a">原始文本</label><div class="spacer"></div>' + btn('示例', 'sample') + '</div>' +
          '<textarea class="input-area" id="diff-a" style="min-height:180px" spellcheck="false"></textarea>' +
        '</div>' +
        '<div class="field">' +
          '<div class="field-head"><label for="diff-b">对比文本</label><div class="spacer"></div>' + btn('清空', 'clear') + '</div>' +
          '<textarea class="input-area" id="diff-b" style="min-height:180px" spellcheck="false"></textarea>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:14px">' +
        '<button type="button" class="btn btn-primary btn-sm" data-act="run">开始对比</button>' +
        '<span id="diff-summary" style="font-size:12px;color:var(--ink-3)"></span>' +
      '</div>' +
      '<div class="code-out diff-out" id="diff-out" style="margin-top:14px;min-height:140px;padding:10px"></div>');

    var a = $('#diff-a', root);
    var b = $('#diff-b', root);
    var out = $('#diff-out', root);
    var summary = $('#diff-summary', root);

    function run() {
      var rows = diffLines(a.value, b.value);
      var adds = 0, dels = 0;
      out.innerHTML = rows.map(function (r) {
        if (r.t === 'add') adds++;
        if (r.t === 'del') dels++;
        var sign = r.t === 'add' ? '+' : r.t === 'del' ? '−' : ' ';
        return '<div class="diff-line diff-' + r.t + '"><span class="sign">' + sign + '</span><span>' + (r.v === '' ? '&nbsp;' : esc(r.v)) + '</span></div>';
      }).join('');
      summary.textContent = rows.length ? '+' + adds + ' 行 / −' + dels + ' 行 / 共 ' + rows.length + ' 行' : '';
    }

    on(root, 'click', function (e) {
      var btnEl = e.target.closest('[data-act]');
      if (!btnEl) return;
      var act = btnEl.getAttribute('data-act');
      if (act === 'run') run();
      if (act === 'sample') {
        a.value = 'AGI Hunt 工具索引\n版本 1.0\n分类：对话、写作、图像\n开发者工具：10 款';
        b.value = 'AGI Hunt 工具索引\n版本 1.1\n分类：对话、写作、图像、音视频\n开发者工具：12 款\n更新：新增文本对比';
        run();
      }
      if (act === 'clear') { a.value = ''; b.value = ''; out.innerHTML = ''; summary.textContent = ''; a.focus(); }
    });
    a.focus();
  }

  /* ---------------- 注册表 ---------------- */
  var MOUNTS = {
    json: mountJson,
    base64: mountBase64,
    url: mountUrl,
    hash: mountHash,
    jwt: mountJwt,
    uuid: mountUuid,
    timestamp: mountTimestamp,
    color: mountColor,
    regex: mountRegex,
    text: mountText,
    markdown: mountMarkdown,
    diff: mountDiff
  };

  function metaOf(id) {
    for (var i = 0; i < AGI.DEVTOOLS.length; i++) {
      if (AGI.DEVTOOLS[i].id === id) return AGI.DEVTOOLS[i];
    }
    return { id: id, name: id, group: '工具', desc: '' };
  }

  AGI.Dev = {
    _timer: null,
    list: function () { return AGI.DEVTOOLS; },
    mount: function (id, container) {
      if (AGI.Dev._timer) { clearInterval(AGI.Dev._timer); AGI.Dev._timer = null; }
      var fn = MOUNTS[id];
      if (!fn) return false;
      container.innerHTML = '';
      fn(container);
      return true;
    },
    copy: copyText
  };
})();
