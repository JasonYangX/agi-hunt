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

  /* quiet=true 时不弹「已复制」提示，由调用方给出更具体的文案（如 JSONPath） */
  function copyText(text, quiet) {
    if (!text) { toast('暂无内容可复制'); return; }
    function done() { if (!quiet) toast('已复制到剪贴板'); }
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
      if (!ok) toast('复制失败，请手动选择');
      else if (!quiet) toast('已复制到剪贴板');
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

  /* ============================================================
   * JSON 核心：词法分析 → AST → 序列化
   * 不走 JSON.parse 的原因：
   *   1) 超出 IEEE-754 的整数会被静默改写（雪花 ID、订单号、大额金额）；
   *   2) 重复键会被静默覆盖；
   *   3) 报错位置依赖引擎文案，V8 对 Unexpected token 已不再输出 position。
   * 同一套扫描器同时承载 JSONC 宽松模式与树视图所需的 AST。
   * ============================================================ */
  var JSON_MAX_DEPTH = 256;
  var JSON_QUOTE_SAFE = /^[\x20\x21\x23-\x5B\x5D-\uD7FF\uE000-\uFFFF]*$/;
  var JSON_SAFE_INT = '9007199254740992';

  function jsonHex4(c) { return ('0000' + c.toString(16)).slice(-4); }
  function jsonIsDigit(c) { return c >= 48 && c <= 57; }
  function jsonIsIdentStart(c) {
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 36 || c === 95 || c >= 128;
  }
  function jsonIsIdentPart(c) { return jsonIsIdentStart(c) || jsonIsDigit(c); }

  /* 偏移 → 行列。\r\n 记一次换行，孤立 \r 也记换行；列按 UTF-16 code unit 计 */
  function lineColOf(text, pos) {
    var n = text.length, i, line = 1, start = 0, c;
    if (pos > n) pos = n;
    for (i = 0; i < pos; i++) {
      c = text.charCodeAt(i);
      if (c === 13) {
        if (text.charCodeAt(i + 1) === 10) i++;
        line++;
        start = i + 1;
      } else if (c === 10) {
        line++;
        start = i + 1;
      }
    }
    return { line: line, col: pos - start + 1 };
  }

  /* 与 JSON.stringify 对齐：孤立代理转义成 \udXXX，合法代理对原样输出 */
  function quoteJsonString(s) {
    if (JSON_QUOTE_SAFE.test(s)) return '"' + s + '"';
    var out = '"', i, c, n = s.length, d;
    for (i = 0; i < n; i++) {
      c = s.charCodeAt(i);
      if (c === 34) out += '\\"';
      else if (c === 92) out += '\\\\';
      else if (c === 8) out += '\\b';
      else if (c === 12) out += '\\f';
      else if (c === 10) out += '\\n';
      else if (c === 13) out += '\\r';
      else if (c === 9) out += '\\t';
      else if (c < 32) out += '\\u' + jsonHex4(c);
      else if (c >= 0xD800 && c <= 0xDBFF) {
        d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { out += s.charAt(i) + s.charAt(i + 1); i++; }
        else out += '\\u' + jsonHex4(c);
      } else if (c >= 0xDC00 && c <= 0xDFFF) {
        out += '\\u' + jsonHex4(c);
      } else {
        out += s.charAt(i);
      }
    }
    return out + '"';
  }

  function makeLexer(text, conf) {
    var i = 0, n = text.length;
    var loose = conf.loose;
    var issues = conf.issues;
    var t = { t: '', v: null, raw: '', start: 0, end: 0 };

    function fail(code, pos, msg, hint) {
      var e = new Error(msg);
      e.code = code;
      e.pos = pos;
      e.hint = hint || '';
      throw e;
    }

    function skipWs() {
      var c, d, j, k, closed;
      while (i < n) {
        c = text.charCodeAt(i);
        if (c === 32 || c === 9 || c === 10 || c === 13 || (i === 0 && c === 0xFEFF)) { i++; continue; }
        if (c === 47) {
          d = text.charCodeAt(i + 1);
          if (d !== 47 && d !== 42) return;
          if (!loose) fail('COMMENT_STRICT', i, '这里出现了注释', 'JSON 不允许注释，可勾选「宽松（JSONC）」');
          if (d === 47) {
            j = i + 2;
            while (j < n) {
              d = text.charCodeAt(j);
              if (d === 10 || d === 13) break;
              j++;
            }
            i = j;
          } else {
            k = i + 2;
            closed = false;
            while (k < n - 1) {
              if (text.charCodeAt(k) === 42 && text.charCodeAt(k + 1) === 47) { closed = true; break; }
              k++;
            }
            if (!closed) fail('UNTERMINATED_COMMENT', i, '块注释缺少结束符 */', '补上 */ 或删除注释');
            i = k + 2;
          }
          issues.loose.comments++;
          continue;
        }
        if (c === 0xA0 || c === 0x3000 || (c >= 0x2000 && c <= 0x200D) || c === 0x2028 || c === 0x2029 || c === 0xFEFF) {
          if (!loose) {
            fail('NON_STANDARD_WS', i, '含不可见字符 U+' + c.toString(16).toUpperCase(),
              '从网页或文档复制时常带此类字符，可勾选「宽松（JSONC）」');
          }
          issues.loose.ws++;
          i++;
          continue;
        }
        return;
      }
    }

    function readString(quote) {
      var start = i, end, chunk, parts, cur, c, e, h;
      i++;
      end = text.indexOf(String.fromCharCode(quote), i);
      if (end !== -1) {
        chunk = text.slice(i, end);
        if (chunk.indexOf('\\') === -1 && !/[\x00-\x1F]/.test(chunk)) {
          i = end + 1;
          t.t = 'str'; t.v = chunk; t.raw = text.slice(start, i); t.end = i;
          return t;
        }
      }
      parts = [];
      cur = '';
      while (i < n) {
        c = text.charCodeAt(i);
        if (c === quote) {
          i++;
          parts.push(cur);
          t.t = 'str'; t.v = parts.join(''); t.raw = text.slice(start, i); t.end = i;
          return t;
        }
        if (c === 92) {
          parts.push(cur);
          cur = '';
          i++;
          if (i >= n) fail('UNTERMINATED_ESCAPE', i - 1, '反斜杠后缺少字符', '字符串没有正常结束');
          e = text.charCodeAt(i);
          if (e === 34) { cur += '"'; i++; }
          else if (e === 92) { cur += '\\'; i++; }
          else if (e === 47) { cur += '/'; i++; }
          else if (e === 98) { cur += '\b'; i++; }
          else if (e === 102) { cur += '\f'; i++; }
          else if (e === 110) { cur += '\n'; i++; }
          else if (e === 114) { cur += '\r'; i++; }
          else if (e === 116) { cur += '\t'; i++; }
          else if (e === 117) {
            h = text.substr(i + 1, 4);
            if (!/^[0-9a-fA-F]{4}$/.test(h)) {
              if (!loose) fail('BAD_UNICODE_ESCAPE', i, '\\u 后必须跟 4 位十六进制', '例如 \\u00e9');
              cur += 'u';
              issues.loose.escapeFixes++;
              i++;
            } else {
              cur += String.fromCharCode(parseInt(h, 16));
              i += 5;
            }
          } else if (loose) {
            cur += text.charAt(i);
            issues.loose.escapeFixes++;
            i++;
          } else {
            fail('INVALID_ESCAPE', i, '\\' + text.charAt(i) + ' 不是合法转义',
              '可用 \\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX');
          }
          continue;
        }
        if (c < 32) {
          if (!loose) fail('CTRL_CHAR_IN_STRING', i, '字符串中出现未转义的控制字符', '换行写 \\n，制表符写 \\t');
          issues.loose.escapeFixes++;
        }
        cur += text.charAt(i);
        i++;
      }
      fail('UNTERMINATED_STRING', start, '字符串缺少结束引号', '起始于第 ' + lineColOf(text, start).line + ' 行');
    }

    function readNumber() {
      var start = i, c, raw, ePos, sign;
      if (text.charCodeAt(i) === 45) i++;
      if (text.charCodeAt(i) === 43) {
        if (!loose) fail('NUMBER_PLUS_SIGN', i, 'JSON 数字不能带前导 +', '去掉 + 号');
        issues.loose.numberFixes++;
        i++;
      }
      c = text.charCodeAt(i);
      if (c === 48) {
        i++;
        if (jsonIsDigit(text.charCodeAt(i))) {
          if (!loose) fail('NUMBER_LEADING_ZERO', start, '数字不能有前导零', '去掉多余的前导零，或加引号写成字符串');
          while (jsonIsDigit(text.charCodeAt(i))) i++;
          issues.loose.numberFixes++;
        }
      } else if (c >= 49 && c <= 57) {
        while (jsonIsDigit(text.charCodeAt(i))) i++;
      } else {
        fail('NUMBER_LEADING_DOT', i, '数字不能以小数点开头', '补一个 0，例如 0.5');
      }
      if (text.charCodeAt(i) === 46) {
        i++;
        if (!jsonIsDigit(text.charCodeAt(i))) fail('NUMBER_TRAILING_DOT', i - 1, '小数点后必须有数字', '补一个 0，例如 1.0');
        while (jsonIsDigit(text.charCodeAt(i))) i++;
      }
      c = text.charCodeAt(i);
      if (c === 101 || c === 69) {
        ePos = i;
        i++;
        c = text.charCodeAt(i);
        if (c === 43 || c === 45) i++;
        if (!jsonIsDigit(text.charCodeAt(i))) fail('NUMBER_BAD_EXPONENT', ePos, '指数部分缺少数字', '例如 1e3');
        while (jsonIsDigit(text.charCodeAt(i))) i++;
      }
      if (jsonIsIdentStart(text.charCodeAt(i))) {
        fail('NOT_A_JSON_LITERAL', start, '“' + text.slice(start, i + 1) + '” 不是合法数字',
          'JSON 不支持 0x 十六进制、NaN、Infinity 与数字后缀');
      }
      raw = text.slice(start, i);
      t.t = 'num'; t.v = null; t.raw = raw; t.end = i;
      return t;
    }

    function next() {
      var c, s;
      skipWs();
      t.start = i;
      t.v = null;
      if (i >= n) { t.t = 'eof'; t.raw = ''; t.end = i; return t; }
      c = text.charCodeAt(i);
      if (c === 123) { i++; t.t = '{'; t.raw = '{'; t.end = i; return t; }
      if (c === 125) { i++; t.t = '}'; t.raw = '}'; t.end = i; return t; }
      if (c === 91) { i++; t.t = '['; t.raw = '['; t.end = i; return t; }
      if (c === 93) { i++; t.t = ']'; t.raw = ']'; t.end = i; return t; }
      if (c === 58) { i++; t.t = ':'; t.raw = ':'; t.end = i; return t; }
      if (c === 44) { i++; t.t = ','; t.raw = ','; t.end = i; return t; }
      if (c === 34) return readString(34);
      if (c === 39) {
        if (!loose) fail('SINGLE_QUOTE_STRICT', i, '字符串必须使用双引号', '可勾选「宽松（JSONC）」按单引号解析');
        issues.loose.singleQuotes++;
        return readString(39);
      }
      if (c === 45 || c === 43 || c === 46 || jsonIsDigit(c)) return readNumber();
      if (jsonIsIdentStart(c)) {
        s = i;
        while (i < n && jsonIsIdentPart(text.charCodeAt(i))) i++;
        t.t = 'ident'; t.v = text.slice(s, i); t.raw = t.v; t.end = i;
        return t;
      }
      fail('UNEXPECTED_CHAR', i, '出现无法识别的字符 ' + JSON.stringify(text.charAt(i)),
        '检查是否少了逗号、引号或括号');
    }

    return { next: next, tok: t };
  }

  function scanJson(text, opts) {
    opts = opts || {};
    var issues = {
      dupCount: 0, dupKeys: [], numCount: 0, numbers: [],
      loose: { comments: 0, trailingCommas: 0, singleQuotes: 0, unquotedKeys: 0, escapeFixes: 0, ws: 0, numberFixes: 0 }
    };
    var maxDepth = opts.maxDepth || JSON_MAX_DEPTH;
    var lx = makeLexer(text, { loose: !!opts.loose, issues: issues });

    function fail(code, pos, msg, hint) {
      var e = new Error(msg);
      e.code = code;
      e.pos = pos;
      e.hint = hint || '';
      throw e;
    }

    function trailingComma(pos) {
      if (!opts.loose) fail('TRAILING_COMMA_STRICT', pos, '多了一个尾随逗号', '删掉逗号，或勾选「宽松（JSONC）」');
      issues.loose.trailingCommas++;
    }

    /* 只做告警，不改写：整数超出安全范围或浮点溢出时提示 */
    function noteNumber(raw, pos) {
      var digits = raw.charAt(0) === '-' ? raw.slice(1) : raw;
      var bad = false;
      if (digits.indexOf('.') === -1 && digits.indexOf('e') === -1 && digits.indexOf('E') === -1) {
        while (digits.length > 1 && digits.charAt(0) === '0') digits = digits.slice(1);
        if (digits.length > 16) bad = true;
        else if (digits.length === 16 && digits >= JSON_SAFE_INT) bad = true;
      }
      if (!bad && !isFinite(Number(raw))) bad = true;
      if (bad) {
        issues.numCount++;
        if (issues.numbers.length < 20) issues.numbers.push({ raw: raw, pos: pos });
      }
    }

    function parseValue(depth) {
      var tk, node;
      if (depth > maxDepth) {
        fail('DEPTH_LIMIT', lx.tok.start, '嵌套层级超过 ' + maxDepth + ' 层', '请检查数据是否异常嵌套');
      }
      tk = lx.tok;
      if (tk.t === '{') return parseObject(depth);
      if (tk.t === '[') return parseArray(depth);
      if (tk.t === 'str') {
        node = { type: 'string', value: tk.v, pos: tk.start, end: tk.end };
        lx.next();
        return node;
      }
      if (tk.t === 'num') {
        node = { type: 'number', raw: tk.raw, pos: tk.start, end: tk.end };
        noteNumber(tk.raw, tk.start);
        lx.next();
        return node;
      }
      if (tk.t === 'ident') {
        if (tk.v === 'true' || tk.v === 'false') {
          node = { type: 'boolean', value: tk.v === 'true', pos: tk.start };
          lx.next();
          return node;
        }
        if (tk.v === 'null') {
          node = { type: 'null', pos: tk.start };
          lx.next();
          return node;
        }
        fail('NOT_A_JSON_LITERAL', tk.start, '“' + tk.v + '” 不是 JSON 字面量',
          'JSON 只支持 true / false / null；NaN、Infinity、undefined 需改用字符串或 null');
      }
      if (tk.t === 'eof') {
        fail('UNEXPECTED_EOF', tk.start, '内容意外结束', '可能缺少值、引号或右括号');
      }
      fail('UNEXPECTED_CHAR', tk.start, '这里需要一个值，却遇到 “' + (tk.raw || tk.t) + '”',
        '检查是否少了逗号、引号或括号');
    }

    function parseObject(depth) {
      var node = { type: 'object', entries: [], pos: lx.tok.start, end: 0 };
      var seen = Object.create(null);
      var lastComma = -1;
      var tk, key, keyPos, val, entry;
      lx.next();
      if (lx.tok.t === '}') { node.end = lx.tok.end; lx.next(); return node; }
      for (;;) {
        tk = lx.tok;
        if (tk.t === '}') {
          if (lastComma >= 0) trailingComma(lastComma);
          node.end = tk.end;
          lx.next();
          return node;
        }
        if (tk.t === 'str') {
          key = tk.v; keyPos = tk.start;
          lx.next();
        } else if (tk.t === 'ident') {
          if (!opts.loose) fail('UNQUOTED_KEY_STRICT', tk.start, '键 “' + tk.v + '” 缺少双引号', '写成 "' + tk.v + '"');
          issues.loose.unquotedKeys++;
          key = tk.v; keyPos = tk.start;
          lx.next();
        } else if (tk.t === 'eof') {
          fail('UNEXPECTED_EOF', tk.start, '对象没有闭合', '补上右花括号 }');
        } else {
          fail('UNEXPECTED_CHAR', tk.start, '这里需要一个键名', '键名必须是双引号包裹的字符串');
        }
        if (lx.tok.t !== ':') {
          if (lx.tok.t === 'eof') fail('UNEXPECTED_EOF', lx.tok.start, '键 “' + key + '” 后缺少冒号', '');
          fail('EXPECTED_COLON', lx.tok.start, '键 “' + key + '” 后缺少冒号', '写成 "key": value');
        }
        lx.next();
        val = parseValue(depth + 1);
        if (seen[key] !== undefined) {
          issues.dupCount++;
          if (issues.dupKeys.length < 50) issues.dupKeys.push({ key: key, pos: keyPos });
          seen[key].node = val;
          seen[key].keyPos = keyPos;
        } else {
          entry = { key: key, keyPos: keyPos, node: val };
          seen[key] = entry;
          node.entries.push(entry);
        }
        if (lx.tok.t === ',') { lastComma = lx.tok.start; lx.next(); continue; }
        if (lx.tok.t === '}') { node.end = lx.tok.end; lx.next(); return node; }
        if (lx.tok.t === 'eof') fail('UNEXPECTED_EOF', lx.tok.start, '对象没有闭合', '补上右花括号 }');
        fail('EXPECTED_COMMA_OR_BRACE', lx.tok.start, '缺少逗号或右花括号', '两个键之间要用逗号分隔');
      }
    }

    function parseArray(depth) {
      var node = { type: 'array', items: [], pos: lx.tok.start, end: 0 };
      var lastComma = -1;
      lx.next();
      if (lx.tok.t === ']') { node.end = lx.tok.end; lx.next(); return node; }
      for (;;) {
        if (lx.tok.t === ']') {
          if (lastComma >= 0) trailingComma(lastComma);
          node.end = lx.tok.end;
          lx.next();
          return node;
        }
        node.items.push(parseValue(depth + 1));
        if (lx.tok.t === ',') { lastComma = lx.tok.start; lx.next(); continue; }
        if (lx.tok.t === ']') { node.end = lx.tok.end; lx.next(); return node; }
        if (lx.tok.t === 'eof') fail('UNEXPECTED_EOF', lx.tok.start, '数组没有闭合', '补上右方括号 ]');
        fail('EXPECTED_COMMA_OR_BRACKET', lx.tok.start, '缺少逗号或右方括号', '两个元素之间要用逗号分隔');
      }
    }

    try {
      lx.next();
      var rootNode = parseValue(0);
      if (lx.tok.t !== 'eof') {
        fail('TRAILING_CONTENT', lx.tok.start, '根节点结束后还有多余内容', '检查是否多了一段文本，或两个值之间漏了逗号');
      }
      return { ok: true, root: rootNode, issues: issues };
    } catch (e) {
      if (!e || !e.code) throw e;
      var lc = lineColOf(text, e.pos);
      return {
        ok: false,
        err: { code: e.code, pos: e.pos, msg: e.message, hint: e.hint || '', line: lc.line, col: lc.col }
      };
    }
  }

  /* 扁平数组拼接，避免深嵌套时按层重复拷贝；输出布局与 JSON.stringify 逐字节一致 */
  function formatJson(root, opts) {
    opts = opts || {};
    var unit = opts.indent === 0 ? '' : (opts.indent === '\t' ? '\t' : (opts.indent === 4 ? '    ' : '  '));
    var sort = !!opts.sort;
    var out = [];
    var pads = [''];

    function pad(d) {
      while (pads.length <= d) pads[pads.length] = pads[pads.length - 1] + unit;
      return pads[d];
    }

    function emit(n, d) {
      var i, list;
      if (n.type === 'object') {
        list = n.entries;
        if (!list.length) { out.push('{}'); return; }
        if (sort) {
          list = list.slice().sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
        }
        out.push('{');
        for (i = 0; i < list.length; i++) {
          if (i) out.push(',');
          if (unit) out.push('\n', pad(d + 1));
          out.push(quoteJsonString(list[i].key));
          out.push(unit ? ': ' : ':');
          emit(list[i].node, d + 1);
        }
        if (unit) out.push('\n', pad(d));
        out.push('}');
        return;
      }
      if (n.type === 'array') {
        list = n.items;
        if (!list.length) { out.push('[]'); return; }
        out.push('[');
        for (i = 0; i < list.length; i++) {
          if (i) out.push(',');
          if (unit) out.push('\n', pad(d + 1));
          emit(list[i], d + 1);
        }
        if (unit) out.push('\n', pad(d));
        out.push(']');
        return;
      }
      if (n.type === 'string') { out.push(quoteJsonString(n.value)); return; }
      if (n.type === 'number') { out.push(n.raw); return; }
      if (n.type === 'boolean') { out.push(n.value ? 'true' : 'false'); return; }
      out.push('null');
    }

    emit(root, 0);
    return out.join('');
  }

  function collectStats(root) {
    var nodes = 0, depth = 0, objects = 0, arrays = 0, strings = 0, numbers = 0, booleans = 0, nulls = 0;
    var sn = [root], sd = [1], sp = 1, n, d, i, kids;
    while (sp > 0) {
      sp--;
      n = sn[sp];
      d = sd[sp];
      nodes++;
      if (d > depth) depth = d;
      if (n.type === 'object') {
        objects++;
        kids = n.entries;
        for (i = 0; i < kids.length; i++) { sn[sp] = kids[i].node; sd[sp] = d + 1; sp++; }
      } else if (n.type === 'array') {
        arrays++;
        kids = n.items;
        for (i = 0; i < kids.length; i++) { sn[sp] = kids[i]; sd[sp] = d + 1; sp++; }
      } else if (n.type === 'string') strings++;
      else if (n.type === 'number') numbers++;
      else if (n.type === 'boolean') booleans++;
      else nulls++;
    }
    return {
      nodes: nodes, depth: depth, objects: objects, arrays: arrays,
      strings: strings, numbers: numbers, booleans: booleans, nulls: nulls
    };
  }

  function jsonPathOf(parts) {
    var out = '$', i, p;
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      if (typeof p === 'number') { out += '[' + p + ']'; continue; }
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p)) out += '.' + p;
      else out += "['" + String(p).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "']";
    }
    return out;
  }

  /* ---------------- JSON 格式化 ---------------- */
  function mountJson(root) {
    root.innerHTML = shell(metaOf('json'), '' +
      '<div class="dev-grid">' +
        '<div class="field">' +
          '<div class="field-head field-head--wrap">' +
            '<label for="json-in">输入</label>' +
            '<label class="check"><input type="checkbox" id="json-loose"> 宽松（JSONC）</label>' +
            '<div class="spacer"></div>' +
            btn('示例', 'sample') +
            btn('清空', 'clear') +
          '</div>' +
          '<div class="input-wrap" id="json-in-wrap">' +
            '<div class="input-gutter" aria-hidden="true"><pre class="input-gutter-inner" id="json-in-gutter"></pre></div>' +
            '<textarea class="input-area" id="json-in" spellcheck="false" aria-describedby="json-status" placeholder=\'{"project":"AGI Hunt","tools":84}\'></textarea>' +
          '</div>' +
          '<div class="status-line" id="json-status" role="status" aria-live="polite" aria-atomic="true"><span class="st"></span><span class="msg">等待输入</span></div>' +
        '</div>' +
        '<div class="field">' +
          '<div class="field-head field-head--wrap field-head--out">' +
            '<label class="json-out-label">结果</label>' +
            '<div class="seg" id="json-view" role="group" aria-label="结果视图">' +
              '<button type="button" class="is-on" data-view="text" aria-pressed="true">文本</button>' +
              '<button type="button" data-view="tree" aria-pressed="false">树</button>' +
            '</div>' +
            '<div class="spacer"></div>' +
            '<select class="input-select" id="json-indent" aria-label="输出缩进" style="height:28px;font-size:12px;padding:0 26px 0 8px;width:auto">' +
              '<option value="2">缩进 2 空格</option><option value="4">缩进 4 空格</option><option value="tab">Tab</option>' +
            '</select>' +
            btn('压缩', 'minify', { attr: 'aria-pressed="false"' }) +
            btn('键排序', 'sort', { attr: 'aria-pressed="false"' }) +
            '<button type="button" class="btn btn-ghost btn-sm" data-act="copy">复制</button>' +
          '</div>' +
          '<div class="code-scroll" id="json-out-wrap" tabindex="0" role="region" aria-label="格式化结果">' +
            '<pre class="code-gutter" id="json-gutter" aria-hidden="true"></pre>' +
            '<pre class="code-out is-code" id="json-out"></pre>' +
          '</div>' +
          '<div class="json-tree" id="json-tree" role="tree" aria-label="JSON 结构" hidden></div>' +
          '<div class="status-line" id="json-meta" role="status" aria-live="polite" aria-atomic="true"><span class="st"></span><span class="msg">—</span></div>' +
        '</div>' +
      '</div>');

    var input = $('#json-in', root);
    var outWrap = $('#json-out-wrap', root);
    var gutterIn = $('#json-in-gutter', root);
    var output = $('#json-out', root);
    var outWrap = $('#json-out-wrap', root);
    var gutter = $('#json-gutter', root);
    var treeEl = $('#json-tree', root);
    var status = $('#json-status', root);
    var metaLine = $('#json-meta', root);
    var fmtSel = $('#json-indent', root);
    var looseChk = $('#json-loose', root);
    var segView = $('#json-view', root);
    var minifyBtn = $('[data-act="minify"]', root);

    var TEXT_CAP = 300000;
    var TREE_CHILD_CAP = 500;
    var TREE_ROW_BUDGET = 4000;
    var TREE_LABEL_CAP = 120;

    var SAMPLE = JSON.stringify({
      project: 'AGI Hunt',
      version: '2026.11',
      categories: ['chat', 'code', 'image'],
      stats: { tools: 126, devtools: 12, openSource: true },
      notes: null
    }, null, 2);

    var treeRows = [];
    var budget = { n: 0 };

    var st = {
      model: null, out: '', view: 'text', sort: false, compact: false,
      timer: null, modelId: 0, treeSig: '', toggle: {},
      sizeStr: '', sizeLabel: '—'
    };

    function indentUnit() {
      var v;
      if (st.compact) return 0;
      v = fmtSel.value;
      return v === 'tab' ? '\t' : Number(v);
    }
    function lineCountOf(s) {
      var n = 1, i = -1;
      if (!s) return 0;
      while ((i = s.indexOf('\n', i + 1)) !== -1) n++;
      return n;
    }
    function gutterOf(n) {
      var out = '', i;
      for (i = 1; i <= n; i++) out += (i === 1 ? '' : '\n') + i;
      return out;
    }

    /* ---- 输入行号：软换行后按视觉行对齐 ----
     * textarea 无法直接读每行高度，用同宽同字体的镜像层逐行量高，
     * 折行占 N 行的逻辑行只在首行显示编号，其余留空。 */
    var mirror = null;
    var gutterWidth = -1;
    var charW = 0;

    function mirrorEl() {
      if (!mirror) {
        mirror = document.createElement('div');
        mirror.className = 'ln-mirror';
        root.appendChild(mirror);
      }
      return mirror;
    }
    function mirrorFont(m, cs) {
      m.style.fontFamily = cs.fontFamily;
      m.style.fontSize = cs.fontSize;
      m.style.lineHeight = cs.lineHeight;
      m.style.letterSpacing = cs.letterSpacing;
      m.style.whiteSpace = 'pre-wrap';
      m.style.overflowWrap = 'break-word';
      m.style.wordBreak = 'normal';
      m.style.tabSize = '4';
    }
    function syncInputScroll() {
      gutterIn.style.transform = 'translateY(' + (-input.scrollTop) + 'px)';
    }
    function measureCharW(cs, w) {
      var m = mirrorEl(), probe, r;
      m.style.width = w + 'px';
      mirrorFont(m, cs);
      m.textContent = '';
      probe = document.createElement('span');
      probe.style.whiteSpace = 'pre';
      probe.textContent = new Array(51).join('0');
      m.appendChild(probe);
      r = probe.getBoundingClientRect().width / 50;
      m.textContent = '';
      return r > 0 ? r : parseFloat(cs.fontSize) * 0.6;
    }
    function visualLen(s) {
      var i, extra = 0;
      for (i = 0; i < s.length; i++) if (s.charCodeAt(i) === 9) extra++;
      return s.length + extra * 3;
    }
    function updateInputGutter() {
      var cs, lh, w, text, lines, rows, i, n, out, m, d, kids, h, needMeasure, tabbed;
      if (!document.body.contains(input)) return;
      cs = window.getComputedStyle(input);
      lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.7;
      w = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      gutterIn.style.fontFamily = cs.fontFamily;
      gutterIn.style.fontSize = cs.fontSize;
      gutterIn.style.lineHeight = cs.lineHeight;
      gutterIn.style.letterSpacing = cs.letterSpacing;
      text = input.value;
      if (!text || w <= 0) {
        gutterIn.textContent = '';
        syncInputScroll();
        return;
      }
      if (Math.abs(w - gutterWidth) > 0.5 || !charW) {
        gutterWidth = w;
        charW = measureCharW(cs, w);
      }
      lines = text.split('\n');
      rows = new Array(lines.length);
      needMeasure = false;
      for (i = 0; i < lines.length; i++) {
        if (!lines[i] || visualLen(lines[i]) * charW <= w) {
          rows[i] = 1;
        } else {
          rows[i] = -1;
          needMeasure = true;
        }
      }
      if (needMeasure) {
        m = mirrorEl();
        m.style.width = w + 'px';
        mirrorFont(m, cs);
        m.textContent = '';
        for (i = 0; i < lines.length; i++) {
          if (rows[i] !== -1) continue;
          d = document.createElement('div');
          d.textContent = lines[i] + '\u200b';
          d._ln = i;
          m.appendChild(d);
        }
        kids = m.children;
        for (i = 0; i < kids.length; i++) {
          h = kids[i].getBoundingClientRect().height;
          rows[kids[i]._ln] = Math.max(1, Math.round(h / lh));
        }
        m.textContent = '';
      }
      out = [];
      for (i = 0; i < rows.length; i++) {
        out.push(String(i + 1));
        for (n = rows[i] - 1; n > 0; n--) out.push('');
      }
      /* 末尾若是折行留下的空行，<pre> 会塌掉一个行高，用零宽字符撑住 */
      if (out[out.length - 1] === '') out[out.length - 1] = '\u200b';
      gutterIn.textContent = out.join('\n');
      syncInputScroll();
    }
    function isEmpty() {
      var v = input.value;
      return v.length > 1000 ? false : !/\S/.test(v);
    }
    function sizeOf(str) {
      var n, label;
      if (st.sizeStr === str) return st.sizeLabel;
      n = new Blob([str]).size;
      label = n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
      st.sizeStr = str;
      st.sizeLabel = label;
      return label;
    }
    function setOut(text) {
      var code = text, note = '', cut, c;
      if (text.length > TEXT_CAP) {
        cut = TEXT_CAP;
        c = text.charCodeAt(cut - 1);
        if (c >= 0xD800 && c <= 0xDBFF) cut--;
        code = text.slice(0, cut);
        note = '\n… （已截断显示，复制仍为完整内容）';
      }
      output.textContent = code + note;
      gutter.textContent = gutterOf(lineCountOf(code));
    }
    function updateMeta() {
      var s, txt;
      if (!st.model) { setStatus(metaLine, '', '—'); return; }
      s = collectStats(st.model.root);
      txt = s.nodes + ' 个节点 · 深度 ' + s.depth + ' · ' + sizeOf(st.out);
      if (st.out.length > TEXT_CAP) txt += ' · 仅显示前 30 万字符';
      setStatus(metaLine, '', txt);
    }
    function statusOk(issues) {
      var bits = [], L = issues.loose;
      if (L.comments) bits.push(L.comments + ' 处注释已忽略');
      if (L.trailingCommas) bits.push(L.trailingCommas + ' 处尾随逗号已忽略');
      if (L.singleQuotes) bits.push(L.singleQuotes + ' 处单引号已按字符串处理');
      if (L.unquotedKeys) bits.push(L.unquotedKeys + ' 个无引号键已补全');
      if (L.escapeFixes) bits.push(L.escapeFixes + ' 处非法转义已修正');
      if (L.ws) bits.push(L.ws + ' 个不可见空白已忽略');
      if (issues.dupCount) bits.push(issues.dupCount + ' 处重复键，保留最后一个值');
      if (issues.numCount) bits.push(issues.numCount + ' 个数字超出双精度范围，已按原样保留');
      if (bits.length) setStatus(status, 'warn', '语法有效 · ' + bits.join(' · '));
      else setStatus(status, 'ok', '语法有效');
    }
    function showError(err) {
      var hint = err.hint ? '（' + err.hint + '）' : '';
      var stale = !!st.model;
      setStatus(status, 'err', '第 ' + err.line + ' 行第 ' + err.col + ' 列：' + err.msg + hint);
      if (stale) {
        if (output.textContent) outWrap.classList.add('is-stale');
        if (treeEl.firstChild) treeEl.classList.add('is-stale');
        setStatus(metaLine, 'err', '下方为上一次有效结果，已过期');
      } else {
        output.textContent = '';
        setStatus(metaLine, '', '—');
      }
    }
    function reset() {
      st.model = null;
      st.out = '';
      st.toggle = {};
      st.treeSig = '';
      st.sizeStr = '';
      output.textContent = '';
      gutter.textContent = '';
      gutterIn.textContent = '';
      outWrap.classList.remove('is-stale');
      outWrap.hidden = st.view === 'tree';
      treeEl.innerHTML = '';
      treeEl.classList.remove('is-stale');
      treeEl.hidden = st.view !== 'tree';
      setStatus(status, '', '等待输入');
      setStatus(metaLine, '', '—');
    }
    function paint() {
      var sig;
      if (!st.model) return;
      st.out = formatJson(st.model.root, { indent: indentUnit(), sort: st.sort });
      if (st.view === 'tree') {
        sig = st.modelId + '|' + (st.sort ? 1 : 0);
        if (sig !== st.treeSig) { buildTree(); st.treeSig = sig; }
        outWrap.hidden = true;
        treeEl.hidden = false;
      } else {
        outWrap.hidden = false;
        treeEl.hidden = true;
        setOut(st.out);
      }
      updateMeta();
    }
    function run() {
      var res;
      if (st.timer) { clearTimeout(st.timer); st.timer = null; }
      if (!document.body.contains(root)) return;
      updateInputGutter();
      if (isEmpty()) { reset(); return; }
      res = scanJson(input.value, { loose: st.loose });
      if (!res.ok) { showError(res.err); return; }
      st.model = res;
      st.modelId++;
      st.toggle = {};
      st.treeSig = '';
      output.classList.remove('is-stale');
      outWrap.classList.remove('is-stale');
      treeEl.classList.remove('is-stale');
      paint();
      statusOk(res.issues);
    }
    function schedule() {
      var len, delay;
      if (st.timer) { clearTimeout(st.timer); st.timer = null; }
      len = input.value.length;
      delay = len <= 524288 ? 120 : len <= 2097152 ? 350 : len <= 8388608 ? 800 : -1;
      if (delay < 0) {
        setStatus(status, 'warn', '内容超过 8 MB，已暂停自动格式化；按 ⌘/Ctrl + Enter 立即处理');
        return;
      }
      st.timer = setTimeout(function () { st.timer = null; run(); }, delay);
    }

    /* ---- 树视图 ---- */
    function isOpen(parts, depth) {
      var v = st.toggle[JSON.stringify(parts)];
      if (v !== undefined) return !!v;
      return depth <= 2;
    }
    function setFocusRow(row, doFocus) {
      var i;
      for (i = 0; i < treeRows.length; i++) treeRows[i].tabIndex = treeRows[i] === row ? 0 : -1;
      if (doFocus && row) row.focus();
    }
    function visibleRows() {
      var out = [], i;
      for (i = 0; i < treeRows.length; i++) if (treeRows[i].offsetParent !== null) out.push(treeRows[i]);
      return out;
    }
    function rowOf(el) {
      while (el && el !== treeEl) {
        if (el.nodeType === 1 && el.classList && el.classList.contains('jt-row')) return el;
        el = el.parentNode;
      }
      return null;
    }
    function buildRow(node, parts, label, depth) {
      var frag = document.createDocumentFragment();
      var row = document.createElement('div');
      var twisty = document.createElement('span');
      var labelWrap = document.createElement('span');
      var keyEl = document.createElement('span');
      var colon = document.createElement('span');
      var isContainer = node.type === 'object' || node.type === 'array';
      var valEl, meta, br, group, cnt, open, cut, c;

      row.className = 'jt-row';
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(depth));
      row.tabIndex = -1;
      row._path = parts;
      budget.n++;
      treeRows.push(row);

      twisty.className = 'jt-twisty' + (isContainer ? '' : ' is-leaf');
      twisty.setAttribute('aria-hidden', 'true');

      labelWrap.className = 'jt-label';
      keyEl.className = 'jt-key';
      keyEl.textContent = label;
      labelWrap.appendChild(keyEl);

      /* 根节点没有键名，也就不需要冒号 */
      if (parts.length) {
        colon.className = 'jt-punct';
        colon.textContent = ':';
        labelWrap.appendChild(colon);
      }

      row.appendChild(twisty);
      row.appendChild(labelWrap);

      if (isContainer) {
        cnt = node.type === 'object' ? node.entries.length : node.items.length;
        open = isOpen(parts, depth);
        row.setAttribute('aria-expanded', open ? 'true' : 'false');
        br = document.createElement('span');
        br.className = 'jt-punct';
        br.textContent = node.type === 'object' ? '{' : '[';
        row.appendChild(br);
        if (cnt) {
          meta = document.createElement('span');
          meta.className = 'jt-meta';
          meta.textContent = node.type === 'object' ? cnt + ' 个键' : cnt + ' 项';
          row.appendChild(meta);
        }
        br = document.createElement('span');
        br.className = 'jt-punct';
        br.textContent = node.type === 'object' ? '}' : ']';
        row.appendChild(br);
        frag.appendChild(row);
        if (cnt) {
          group = document.createElement('div');
          group.className = 'jt-group';
          group.setAttribute('role', 'group');
          group._node = node;
          group._parts = parts;
          group._depth = depth;
          group._built = false;
          if (open) {
            appendChunk(group, node, parts, depth, 0);
            group._built = true;
          } else {
            group.hidden = true;
          }
          frag.appendChild(group);
        }
        return frag;
      }

      valEl = document.createElement('span');
      if (node.type === 'string') {
        valEl.className = 'jt-val jt-val--str';
        if (node.value.length > TREE_LABEL_CAP) {
          cut = TREE_LABEL_CAP;
          c = node.value.charCodeAt(cut - 1);
          if (c >= 0xD800 && c <= 0xDBFF) cut--;
          valEl.textContent = JSON.stringify(node.value.slice(0, cut) + '…');
          meta = document.createElement('span');
          meta.className = 'jt-meta';
          meta.textContent = node.value.length + ' 字符';
          row.appendChild(valEl);
          row.appendChild(meta);
        } else {
          valEl.textContent = JSON.stringify(node.value);
          row.appendChild(valEl);
        }
      } else if (node.type === 'number') {
        valEl.className = 'jt-val jt-val--num';
        valEl.textContent = node.raw;
        row.appendChild(valEl);
      } else if (node.type === 'boolean') {
        valEl.className = 'jt-val jt-val--bool';
        valEl.textContent = node.value ? 'true' : 'false';
        row.appendChild(valEl);
      } else {
        valEl.className = 'jt-val jt-val--null';
        valEl.textContent = 'null';
        row.appendChild(valEl);
      }
      frag.appendChild(row);
      return frag;
    }
    function appendChunk(group, node, parts, depth, from) {
      var total = node.type === 'object' ? node.entries.length : node.items.length;
      var to = Math.min(total, from + TREE_CHILD_CAP);
      var i, e, more;
      for (i = from; i < to; i++) {
        if (budget.n > TREE_ROW_BUDGET) break;
        if (node.type === 'object') {
          e = node.entries[i];
          group.appendChild(buildRow(e.node, parts.concat([e.key]), JSON.stringify(e.key), depth + 1));
        } else {
          group.appendChild(buildRow(node.items[i], parts.concat([i]), '[' + i + ']', depth + 1));
        }
      }
      if (i < total) {
        more = document.createElement('button');
        more.type = 'button';
        more.className = 'jt-more';
        more.textContent = '再显示 ' + Math.min(TREE_CHILD_CAP, total - i) + ' 项（共 ' + total + '）';
        more._chunk = { group: group, node: node, parts: parts, depth: depth, from: i };
        group.appendChild(more);
      }
    }
    function buildTree() {
      treeEl.innerHTML = '';
      treeRows = [];
      budget = { n: 0 };
      treeEl.appendChild(buildRow(st.model.root, [], '$', 1));
      if (treeRows.length) setFocusRow(treeRows[0], false);
    }
    function toggleRow(row) {
      var open = row.getAttribute('aria-expanded') === 'true';
      var group = row.nextSibling;
      if (!group || !group.className || group.className.indexOf('jt-group') === -1) return;
      st.toggle[JSON.stringify(row._path)] = open ? 0 : 1;
      if (open) {
        group.hidden = true;
        row.setAttribute('aria-expanded', 'false');
      } else {
        if (!group._built) {
          appendChunk(group, group._node, group._parts, group._depth, 0);
          group._built = true;
        }
        group.hidden = false;
        row.setAttribute('aria-expanded', 'true');
      }
    }
    function setView(v) {
      var btns, i, one;
      if (v !== 'tree') v = 'text';
      st.view = v;
      btns = $$('[data-view]', segView);
      for (i = 0; i < btns.length; i++) {
        one = btns[i].getAttribute('data-view') === v;
        if (one) btns[i].classList.add('is-on'); else btns[i].classList.remove('is-on');
        btns[i].setAttribute('aria-pressed', one ? 'true' : 'false');
      }
      if (st.model) {
        paint();
      } else {
        outWrap.hidden = v === 'tree';
        treeEl.hidden = v !== 'tree';
      }
    }

    var gutterTimer = null;
    function queueGutter() {
      if (gutterTimer) clearTimeout(gutterTimer);
      gutterTimer = setTimeout(updateInputGutter, 120);
    }

    on(input, 'input', schedule);
    on(input, 'scroll', syncInputScroll);
    on(window, 'resize', queueGutter);
    if (window.ResizeObserver) {
      try { new ResizeObserver(queueGutter).observe(input); } catch (e) { /* 老浏览器忽略 */ }
    }
    on(input, 'keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.keyCode === 13)) {
        e.preventDefault();
        run();
      }
    });
    on(fmtSel, 'change', function () {
      /* 手动选缩进即视为退出压缩态 */
      if (st.compact) {
        st.compact = false;
        minifyBtn.classList.remove('is-on');
        minifyBtn.setAttribute('aria-pressed', 'false');
      }
      paint();
    });
    on(looseChk, 'change', function () { st.loose = looseChk.checked; run(); });
    on(root, 'click', function (e) {
      var t = e.target, vb, b, act;
      if (t && t.nodeType === 3) t = t.parentNode;
      vb = t.closest ? t.closest('[data-view]') : null;
      if (vb) { setView(vb.getAttribute('data-view')); return; }
      b = t.closest ? t.closest('[data-act]') : null;
      if (!b) return;
      act = b.getAttribute('data-act');
      if (act === 'sample') {
        input.value = SAMPLE;
        run();
        input.focus();
      } else if (act === 'clear') {
        input.value = '';
        reset();
        input.focus();
      } else if (act === 'minify') {
        st.compact = !st.compact;
        if (st.compact) b.classList.add('is-on'); else b.classList.remove('is-on');
        b.setAttribute('aria-pressed', st.compact ? 'true' : 'false');
        paint();
      } else if (act === 'sort') {
        st.sort = !st.sort;
        if (st.sort) b.classList.add('is-on'); else b.classList.remove('is-on');
        b.setAttribute('aria-pressed', st.sort ? 'true' : 'false');
        st.toggle = {};
        st.treeSig = '';
        paint();
      } else if (act === 'copy') {
        copyText(st.out || output.textContent);
      }
    });
    on(treeEl, 'click', function (e) {
      var t = e.target, more, row, tw, path, ch;
      if (t && t.nodeType === 3) t = t.parentNode;
      more = t.closest ? t.closest('.jt-more') : null;
      if (more) {
        ch = more._chunk;
        more.parentNode.removeChild(more);
        appendChunk(ch.group, ch.node, ch.parts, ch.depth, ch.from);
        return;
      }
      row = rowOf(t);
      if (!row) return;
      tw = t.closest ? t.closest('.jt-twisty') : null;
      if (tw && row.hasAttribute('aria-expanded')) { toggleRow(row); return; }
      path = jsonPathOf(row._path);
      copyText(path, true);
      toast('已复制 ' + path);
    });
    on(treeEl, 'keydown', function (e) {
      var row = rowOf(e.target), rows, idx, key, i;
      if (!row) return;
      rows = visibleRows();
      idx = rows.indexOf(row);
      key = e.key;
      if (key === 'ArrowDown') {
        e.preventDefault();
        setFocusRow(rows[Math.min(idx + 1, rows.length - 1)], true);
      } else if (key === 'ArrowUp') {
        e.preventDefault();
        setFocusRow(rows[Math.max(idx - 1, 0)], true);
      } else if (key === 'ArrowRight') {
        e.preventDefault();
        if (row.hasAttribute('aria-expanded')) {
          if (row.getAttribute('aria-expanded') === 'false') toggleRow(row);
          else if (rows[idx + 1]) setFocusRow(rows[idx + 1], true);
        }
      } else if (key === 'ArrowLeft') {
        e.preventDefault();
        if (row.getAttribute('aria-expanded') === 'true') {
          toggleRow(row);
        } else {
          for (i = idx - 1; i >= 0; i--) {
            if (rows[i].hasAttribute('aria-expanded') &&
              Number(rows[i].getAttribute('aria-level')) === Number(row.getAttribute('aria-level')) - 1) {
              setFocusRow(rows[i], true);
              break;
            }
          }
        }
      } else if (key === 'Home') {
        e.preventDefault();
        setFocusRow(rows[0], true);
      } else if (key === 'End') {
        e.preventDefault();
        setFocusRow(rows[rows.length - 1], true);
      } else if (key === 'Enter') {
        e.preventDefault();
        copyText(jsonPathOf(row._path), true);
        toast('已复制 ' + jsonPathOf(row._path));
      } else if (key === ' ' || key === 'Spacebar') {
        if (row.hasAttribute('aria-expanded')) { e.preventDefault(); toggleRow(row); }
      }
    });
    on(treeEl, 'focusin', function (e) {
      var row = rowOf(e.target);
      if (row) setFocusRow(row, false);
    });
    input.focus();
  }

  function byteSize(str) {
    var n = new Blob([str]).size;
    return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
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
    /* 仅用于本地自测，页面逻辑不要依赖 */
    _internals: {
      scanJson: scanJson,
      formatJson: formatJson,
      collectStats: collectStats,
      lineColOf: lineColOf,
      jsonPathOf: jsonPathOf,
      quoteJsonString: quoteJsonString
    },
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
