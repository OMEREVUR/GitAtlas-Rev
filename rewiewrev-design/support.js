/*
 * RewiewRev tasarım önizleme çalıştırıcısı (support.js)
 * ----------------------------------------------------
 * .dc.html dosyalarını tarayıcıda, sunucu gerekmeden (file:// ile de) çalıştırır.
 * Sadece önizleme içindir; eklentinin kendisine TAŞINMAZ.
 *
 * Desteklenenler:
 *   {{ yol.alt }}            metin ve attribute içinde değer
 *   <sc-for list as>         tekrar ($index kapsamda)
 *   <sc-if value>            koşul
 *   <dc-import name ...>     başka artboard'u iframe içinde açar (attribute'lar URL parametresi olur)
 *   onClick/onChange/...     renderVals() içinden dönen fonksiyonlar
 *   data-props               varsayılan prop'lar; URL'deki ?theme=light gibi parametreler bunları ezer
 */
(function () {
  var SVGNS = 'http://www.w3.org/2000/svg';
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  }
  DCLogic.prototype.setState = function (partial, cb) {
    var next = typeof partial === 'function' ? partial(this.state, this.props) : partial;
    var changed = false;
    for (var k in next) {
      if (Object.prototype.hasOwnProperty.call(next, k) && this.state[k] !== next[k]) { changed = true; break; }
    }
    this.state = Object.assign({}, this.state, next);
    if (changed && this.__render) this.__render();
    if (cb) cb();
  };
  DCLogic.prototype.forceUpdate = function () { if (this.__render) this.__render(); };

  function resolve(scope, expr) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return +expr;
    if (/^(['"]).*\1$/.test(expr)) return expr.slice(1, -1);
    var parts = expr.split('.');
    var v = scope[parts[0]];
    for (var i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
    return v;
  }

  function interp(scope, raw) {
    return raw.replace(HOLE, function (_, e) {
      var v = resolve(scope, e);
      return v == null ? '' : String(v);
    });
  }

  function evalAttr(scope, raw) {
    var m = raw.match(WHOLE);
    if (m) return resolve(scope, m[1]);
    return interp(scope, raw);
  }

  function renderChildren(node, scope, svg, out) {
    for (var c = node.firstChild; c; c = c.nextSibling) {
      var r = renderNode(c, scope, svg);
      for (var i = 0; i < r.length; i++) out.push(r[i]);
    }
    return out;
  }

  function renderNode(node, scope, svg) {
    if (node.nodeType === 3) return [document.createTextNode(interp(scope, node.nodeValue))];
    if (node.nodeType !== 1) return [];
    var tag = node.localName;

    if (tag === 'sc-for') {
      var list = evalAttr(scope, node.getAttribute('list') || '') || [];
      var as = node.getAttribute('as') || 'item';
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var s = Object.create(scope);
        s[as] = list[i];
        s.$index = i;
        renderChildren(node, s, svg, out);
      }
      return out;
    }
    if (tag === 'sc-if') {
      return evalAttr(scope, node.getAttribute('value') || '') ? renderChildren(node, scope, svg, []) : [];
    }
    if (tag === 'dc-import') {
      var q = [];
      for (var a = 0; a < node.attributes.length; a++) {
        var at = node.attributes[a];
        if (at.name === 'name' || at.name.indexOf('hint-') === 0) continue;
        var v = evalAttr(scope, at.value);
        if (typeof v === 'object' || typeof v === 'function') continue;
        q.push(encodeURIComponent(at.name.replace(/-([a-z])/g, function (_, ch) { return ch.toUpperCase(); })) + '=' + encodeURIComponent(v));
      }
      var size = (node.getAttribute('hint-size') || '100%,780px').split(',');
      var f = document.createElement('iframe');
      f.src = node.getAttribute('name') + '.dc.html' + (q.length ? '?' + q.join('&') : '');
      f.title = node.getAttribute('name');
      f.style.cssText = 'display:block;border:0;width:' + size[0].trim() + ';height:' + (size[1] || '780px').trim() + ';';
      return [f];
    }

    var isSvg = svg || tag === 'svg';
    var el = isSvg ? document.createElementNS(SVGNS, tag) : document.createElement(tag);
    var lateValue;
    var type = (node.getAttribute('type') || '').toLowerCase();
    for (var j = 0; j < node.attributes.length; j++) {
      var attr = node.attributes[j];
      var name = attr.name;
      if (name.indexOf('hint-') === 0) continue;
      var val = evalAttr(scope, attr.value);
      if (/^on[a-z]+$/.test(name)) {
        if (typeof val === 'function') {
          var ev = name.slice(2);
          if (ev === 'change' && ((tag === 'input' && !/^(checkbox|radio|range)$/.test(type)) || tag === 'textarea')) ev = 'input';
          el.addEventListener(ev, val);
        }
        continue;
      }
      if (val === false || val == null) continue;
      if (name === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) lateValue = String(val);
      el.setAttribute(name, val === true ? '' : String(val));
    }
    renderChildren(node, scope, isSvg && tag !== 'foreignObject', []).forEach(function (c) { el.appendChild(c); });
    if (lateValue !== undefined) el.value = lateValue;
    return [el];
  }

  function parseQuery() {
    var out = {};
    location.search.replace(/^\?/, '').split('&').forEach(function (p) {
      if (!p) return;
      var kv = p.split('=');
      var k = decodeURIComponent(kv[0]);
      var v = decodeURIComponent(kv[1] || '');
      if (v === 'true') v = true;
      else if (v === 'false') v = false;
      else if (/^-?\d+(\.\d+)?$/.test(v)) v = +v;
      out[k] = v;
    });
    return out;
  }

  function mount() {
    var xdc = document.querySelector('x-dc');
    var script = document.querySelector('script[data-dc-script]');
    if (!xdc || !script) return;

    var meta = {};
    try { meta = JSON.parse(script.getAttribute('data-props') || '{}'); } catch (e) { console.error('data-props okunamadı', e); }
    var props = {};
    Object.keys(meta).forEach(function (k) {
      if (k.charAt(0) !== '$' && meta[k] && 'default' in meta[k]) props[k] = meta[k].default;
    });
    Object.assign(props, parseQuery());

    var Component = new Function('DCLogic', script.textContent + '\n;return Component;')(DCLogic);

    Array.prototype.slice.call(xdc.querySelectorAll('helmet')).forEach(function (h) {
      while (h.firstChild) document.head.appendChild(h.firstChild);
      h.parentNode.removeChild(h);
    });

    var tpl = Array.prototype.slice.call(xdc.childNodes);
    var host = document.createElement('div');
    host.className = 'dc-root';
    xdc.parentNode.insertBefore(host, xdc);
    xdc.parentNode.removeChild(xdc);

    var inst = new Component(props);
    inst.props = props;
    if (!inst.state) inst.state = {};
    inst.__render = function () {
      var act = document.activeElement;
      var id = act && act.id;
      var sel = null;
      try { sel = [act.selectionStart, act.selectionEnd]; } catch (e) { sel = null; }
      var vals = inst.renderVals ? inst.renderVals() || {} : {};
      var frag = document.createDocumentFragment();
      tpl.forEach(function (n) { renderNode(n, vals, false).forEach(function (x) { frag.appendChild(x); }); });
      while (host.firstChild) host.removeChild(host.firstChild);
      host.appendChild(frag);
      if (id) {
        var e = document.getElementById(id);
        if (e && e !== document.activeElement) {
          e.focus();
          try { if (sel && sel[0] != null) e.setSelectionRange(sel[0], sel[1]); } catch (x) { /* ok */ }
        }
      }
    };
    inst.__render();
    if (inst.componentDidMount) inst.componentDidMount();
    window.addEventListener('beforeunload', function () { if (inst.componentWillUnmount) inst.componentWillUnmount(); });
  }

  window.DCLogic = DCLogic;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
