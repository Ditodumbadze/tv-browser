/* „ჭკვიანი“ რეჟიმი: გვერდს აპლიკაცია თავად ჩამოტვირთავს და საკუთარ თავში აჩვენებს (srcdoc),
 * ამიტომ გვერდის შიგთავსზე წვდომა გვაქვს: პულტის კურსორი აჭერს ბმულებს, ღილაკებს, ველებს,
 * ჩადგმულ პლეერებს; რეკლამის სკრიპტები იშლება, popup-ები იბლოკება.
 */
window.Smart = (function () {
  'use strict';

  // ---------- რეკლამა ----------
  var AD_HOSTS = ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google',
    'googletagservices.com', 'adnxs.com', 'adsterra', 'popads', 'propellerads', 'exoclick', 'juicyads',
    'trafficjunky', 'onclickads', 'popcash', 'hilltopads', 'mgid.com', 'taboola.com', 'outbrain.com',
    'an.yandex.ru', 'yandex.ru/ads', 'adriver', 'admixer', 'adfox', 'smartadserver', 'criteo', 'pubmatic',
    'rubiconproject', 'openx.net', 'bidswitch', 'adform', 'adocean', 'gemius', 'clickadu', 'monetag',
    'profitablegatecpm', 'highperformanceformat', 'pushnami', 'onesignal.com', 'adskeeper', 'bongacams',
    'realsrv', 'acint.net', 'runative', 'a-ads.com'];
  var AD_CSS = 'ins.adsbygoogle,[id^="google_ads"],[id*="div-gpt-ad"],iframe[src*="doubleclick"],' +
    'iframe[src*="googlesyndication"],[class*="banner-ad"],[id*="banner-ad"],.adsbox,.ad-container,' +
    '.ad-banner,[data-ad-slot],[id^="adocean"],[id*="adfox"]{display:none!important}';
  function isAd(url) {
    url = String(url || '').toLowerCase();
    for (var i = 0; i < AD_HOSTS.length; i++) if (url.indexOf(AD_HOSTS[i]) !== -1) return true;
    return false;
  }

  var SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-presentation allow-pointer-lock';
  var W = 1920, H = 1080;

  var host, frame, cbs = {}, curUrl = null, stack = [], alive = false, gen = 0;
  var cx = W / 2, cy = H / 2, lastMove = 0, speed = 14, hoverEl = null, hoverTimer = null;
  var cursorEl, hlEl;

  // ---------- ჩამოტვირთვა ----------
  function fetchPage(url, method, body) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open(method || 'GET', url, true);
      x.timeout = 25000;
      x.onload = function () {
        if (x.status >= 400 && !x.responseText) return reject(new Error('HTTP ' + x.status));
        resolve({ text: x.responseText, url: x.responseURL || url, type: x.getResponseHeader('content-type') || '' });
      };
      x.onerror = function () { reject(new Error('network')); };
      x.ontimeout = function () { reject(new Error('timeout')); };
      x.send(body || null);
    });
  }

  function resolveUrl(href, base) {
    try { return new URL(href, base).href; } catch (e) { return href; }
  }

  // HTML-ის მომზადება: <base>, რეკლამის სკრიპტების წაშლა, რეკლამის CSS
  function prepare(html, baseUrl) {
    html = html.replace(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)["']?[^>]*>\s*<\/script>/gi, function (m, src) {
      return isAd(src) ? '' : m;
    });
    html = html.replace(/<base\b[^>]*>/gi, '');
    var inject = '<base href="' + baseUrl.replace(/"/g, '&quot;') + '"><style id="tvb-ads">' + AD_CSS + '</style>';
    if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, function (m) { return m + inject; });
    if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, function (m) { return m + '<head>' + inject + '</head>'; });
    return inject + html;
  }

  function videoPage(url) {
    return '<!doctype html><html><body style="margin:0;background:#000">' +
      '<video src="' + url.replace(/"/g, '&quot;') + '" controls autoplay style="width:100vw;height:100vh"></video></body></html>';
  }

  // ---------- ჩვენება ----------
  function makeFrame() {
    destroyFrame();
    frame = document.createElement('iframe');
    frame.setAttribute('sandbox', SANDBOX);
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
    return frame;
  }
  function destroyFrame() {
    if (frame) {
      try { frame.srcdoc = ''; frame.src = 'about:blank'; } catch (e) {}
      if (frame.parentNode) frame.parentNode.removeChild(frame);
      frame = null;
    }
  }

  function render(html, url) {
    hoverEl = null;
    var f = makeFrame();
    var myGen = ++gen;
    f.addEventListener('load', function () {
      if (myGen !== gen) return;
      var doc = null;
      try { doc = f.contentDocument; } catch (e) {}
      if (!doc) {
        // გვერდმა თავისით სხვა მისამართზე გადაინაცვლა — ჩვენი კონტროლი აღარ არის
        cbs.onEscaped && cbs.onEscaped();
        return;
      }
      attach(doc, 0);
      cbs.onLoaded && cbs.onLoaded(curUrl);
    });
    f.srcdoc = html;
    host.appendChild(f);
  }

  function attach(doc, depth) {
    if (!doc || doc.__tvb) return;
    doc.__tvb = true;
    var win = doc.defaultView;
    try { win.open = function () { return null; }; } catch (e) {}           // popup-ები
    try { win.alert = win.confirm = function () { return true; }; } catch (e) {}
    doc.addEventListener('click', onDocClick, true);
    doc.addEventListener('submit', onDocSubmit, true);
    doc.addEventListener('keydown', function (e) { if (window.__tvKey) window.__tvKey(e); }, true);
    if (!doc.getElementById('tvb-ads') && doc.head) {
      var st = doc.createElement('style'); st.id = 'tvb-ads'; st.textContent = AD_CSS; doc.head.appendChild(st);
    }
    proxyFrames(doc, depth);
    try {
      new win.MutationObserver(function () { proxyFrames(doc, depth); })
        .observe(doc.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

  // ჩადგმული (სხვა სერვერის) ფანჯრებიც — მაგ. ვიდეოპლეერი — ჩვენით ვტვირთავთ, რომ კურსორმა მიაწვდინოს
  function proxyFrames(doc, depth) {
    if (depth >= 2) return;
    var list = doc.querySelectorAll('iframe[src]:not([data-tvb]), frame[src]:not([data-tvb])');
    Array.prototype.forEach.call(list, function (el) {
      el.setAttribute('data-tvb', '1');
      var src = resolveUrl(el.getAttribute('src'), doc.baseURI);
      if (!/^https?:/i.test(src)) return;
      if (isAd(src)) { el.parentNode && el.parentNode.removeChild(el); return; }
      fetchPage(src).then(function (r) {
        if (!/html/i.test(r.type)) return;
        el.setAttribute('sandbox', SANDBOX);
        el.addEventListener('load', function () {
          try { var d = el.contentDocument; if (d && d.body) attach(d, depth + 1); } catch (e) {}
        });
        el.srcdoc = prepare(r.text, r.url);
      }).catch(function () { /* დარჩება ჩვეულებრივი სახით — მაუსით იმუშავებს */ });
    });
  }

  // ---------- ბმულები და ფორმები ----------
  function onDocClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var raw = a.getAttribute('href') || '';
    if (/^\s*(javascript:|#|mailto:|tel:)/i.test(raw)) return;
    var href = a.href;
    if (!/^https?:/i.test(href)) return;
    if (isAd(href)) { e.preventDefault(); e.stopPropagation(); return; }
    // იმავე გვერდზე ღუზა (#section)
    var doc = a.ownerDocument;
    if (href.split('#')[0] === String(doc.baseURI).split('#')[0] && href.indexOf('#') !== -1) return;
    e.preventDefault();
    e.stopPropagation();
    navigate(href);
  }

  function onDocSubmit(e) {
    var form = e.target;
    var method = (form.getAttribute('method') || 'get').toLowerCase();
    var action = resolveUrl(form.getAttribute('action') || form.ownerDocument.baseURI, form.ownerDocument.baseURI);
    e.preventDefault();
    e.stopPropagation();
    var fd = new FormData(form);
    if (method === 'get') {
      var qs = [];
      fd.forEach(function (v, k) { if (typeof v === 'string') qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); });
      navigate(action.split('?')[0] + (qs.length ? '?' + qs.join('&') : ''));
    } else {
      cbs.onLoading && cbs.onLoading();
      stack.push(curUrl);
      fetchPage(action, 'POST', fd).then(function (r) { curUrl = r.url; render(prepare(r.text, r.url), r.url); })
        .catch(function () { cbs.onFallback && cbs.onFallback(action); });
    }
  }

  // ---------- ნავიგაცია ----------
  function load(url) {
    cbs.onLoading && cbs.onLoading(url);
    var myGen = ++gen;
    return fetchPage(url).then(function (r) {
      if (myGen !== gen) return;
      curUrl = r.url;
      cbs.onUrl && cbs.onUrl(curUrl);
      if (/^video\//i.test(r.type) || /\.(mp4|webm|m3u8)(\?|$)/i.test(r.url)) return render(videoPage(r.url), r.url);
      if (r.type && !/html|text\/plain/i.test(r.type)) throw new Error('not html');
      render(prepare(r.text, r.url), r.url);
      cx = W / 2; cy = H / 2; drawCursor();
    }).catch(function (err) {
      if (myGen !== gen) return;
      cbs.onFallback && cbs.onFallback(url, err);
    });
  }

  function navigate(url) {
    if (curUrl) stack.push(curUrl);
    if (stack.length > 40) stack.shift();
    load(url);
  }

  // ---------- კურსორი ----------
  function ensureCursor() {
    if (cursorEl) return;
    hlEl = document.createElement('div');
    hlEl.id = 'tvb-hl';
    cursorEl = document.createElement('div');
    cursorEl.id = 'tvb-cursor';
    cursorEl.innerHTML = '<svg width="44" height="44" viewBox="0 0 24 24"><path d="M4 2l15 9.5-6.3 1.4 3.9 7.3-2.6 1.4-3.9-7.3L5.4 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.getElementById('browse').appendChild(hlEl);
    document.getElementById('browse').appendChild(cursorEl);
  }
  function drawCursor() {
    if (!cursorEl) return;
    cursorEl.style.transform = 'translate(' + (cx - 6) + 'px,' + (cy - 3) + 'px)';
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(updateHover, 70);
  }

  // ელემენტი კურსორის ქვეშ, ჩადგმული ფანჯრების ჩათვლით
  function pick(x, y) {
    if (!frame) return null;
    var doc, el, ox = 0, oy = 0, cur = frame;
    for (var i = 0; i < 4; i++) {
      try { doc = cur.contentDocument; } catch (e) { doc = null; }
      if (!doc) return { el: cur, doc: cur.ownerDocument, x: x - ox, y: y - oy, blocked: true };
      var r = cur.getBoundingClientRect();
      ox += r.left; oy += r.top;
      el = doc.elementFromPoint(x - ox, y - oy);
      if (!el) return null;
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') { cur = el; continue; }
      return { el: el, doc: doc, x: x - ox, y: y - oy };
    }
    return null;
  }

  var CLICKABLE = 'a[href],button,input,select,textarea,label,summary,video,[onclick],[role="button"],[role="link"],[tabindex],[contenteditable="true"]';
  function clickableOf(el) {
    return el && el.closest ? (el.closest(CLICKABLE) || null) : null;
  }

  function fire(el, type, p) {
    var win = el && el.ownerDocument && el.ownerDocument.defaultView;
    if (!win) return;                   // გვერდი უკვე დაიხურა
    var Ctor = /^pointer/.test(type) && win.PointerEvent ? win.PointerEvent : win.MouseEvent;
    try {
      el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: win, clientX: p.x, clientY: p.y,
        screenX: p.x, screenY: p.y, button: 0, buttons: type === 'mouseup' || type === 'click' ? 0 : 1, pointerType: 'mouse' }));
    } catch (e) {}
  }

  function updateHover() {
    if (!alive || !hlEl) return;
    var p = pick(cx, cy);
    var el = p && p.el;
    if (el !== hoverEl) {
      if (hoverEl && hoverEl.ownerDocument) { fire(hoverEl, 'mouseout', p || { x: 0, y: 0 }); fire(hoverEl, 'mouseleave', p || { x: 0, y: 0 }); }
      if (el && !p.blocked) { fire(el, 'mouseover', p); fire(el, 'mouseenter', p); }
      hoverEl = el;
    }
    if (el && !p.blocked) fire(el, 'mousemove', p);
    var c = p && !p.blocked ? clickableOf(p.el) : null;
    if (c) {
      var r = c.getBoundingClientRect();
      var off = frameOffset(c.ownerDocument);
      hlEl.style.display = 'block';
      hlEl.style.left = (r.left + off.x - 4) + 'px'; hlEl.style.top = (r.top + off.y - 4) + 'px';
      hlEl.style.width = (r.width + 8) + 'px'; hlEl.style.height = (r.height + 8) + 'px';
    } else {
      hlEl.style.display = 'none';
    }
  }
  function frameOffset(doc) {
    var x = 0, y = 0, win = doc.defaultView;
    while (win && win.frameElement) {
      var r = win.frameElement.getBoundingClientRect();
      x += r.left; y += r.top; win = win.parent;
      if (win === window) break;
    }
    return { x: x, y: y };
  }

  function click() {
    var p = pick(cx, cy);
    cursorEl.classList.add('press');
    setTimeout(function () { cursorEl.classList.remove('press'); }, 160);
    if (!p) return;
    if (p.blocked) { cbs.onBlocked && cbs.onBlocked(); return; }
    var el = p.el;
    var target = clickableOf(el) || el;
    var tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
      var type = (target.type || '').toLowerCase();
      if (tag === 'INPUT' && /^(submit|button|checkbox|radio|image|reset)$/.test(type)) { target.click(); return; }
      target.focus();
      if (tag === 'SELECT') { cycleSelect(target); }
      return;
    }
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (t) { fire(el, t, p); });
    fire(el, 'click', p);
    var v = tag === 'VIDEO' ? target : null;
    if (v) setTimeout(function () { if (v.paused) { try { v.play(); } catch (e) {} } }, 250);
  }

  function cycleSelect(s) {
    if (!s.options.length) return;
    s.selectedIndex = (s.selectedIndex + 1) % s.options.length;
    s.dispatchEvent(new (s.ownerDocument.defaultView.Event)('change', { bubbles: true }));
  }

  function scrollAt(dy, dx) {
    var p = pick(cx, cy);
    var el = p && !p.blocked ? p.el : null;
    while (el && el.nodeType === 1) {
      var cs = el.ownerDocument.defaultView.getComputedStyle(el);
      if (dy && el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(cs.overflowY)) break;
      if (dx && el.scrollWidth > el.clientWidth + 4 && /(auto|scroll)/.test(cs.overflowX)) break;
      el = el.parentElement;
    }
    var doc = (p && !p.blocked && p.doc) || (frame && frame.contentDocument);
    if (!doc) return false;
    var target = el && el.nodeType === 1 ? el : (doc.scrollingElement || doc.documentElement);
    var before = target.scrollTop + target.scrollLeft;
    target.scrollTop += dy || 0; target.scrollLeft += dx || 0;
    return (target.scrollTop + target.scrollLeft) !== before;
  }

  function moveCursor(dx, dy) {
    var now = Date.now();
    speed = (now - lastMove < 180) ? Math.min(speed + 6, 60) : 14;
    lastMove = now;
    var nx = cx + dx * speed, ny = cy + dy * speed;
    if (ny > H - 30) { scrollAt(260, 0); ny = H - 30; }
    if (ny < 6) {
      if (!scrollAt(-260, 0) && dy < 0 && cy <= 6) return 'top';
      ny = 6;
    }
    if (nx > W - 20) { scrollAt(0, 200); nx = W - 20; }
    if (nx < 0) { scrollAt(0, -200); nx = 0; }
    cx = nx; cy = ny;
    drawCursor();
    return true;
  }

  // ---------- ვიდეო ----------
  function allVideos(doc, out) {
    out = out || [];
    if (!doc) return out;
    Array.prototype.forEach.call(doc.querySelectorAll('video'), function (v) { out.push(v); });
    Array.prototype.forEach.call(doc.querySelectorAll('iframe,frame'), function (f) {
      try { allVideos(f.contentDocument, out); } catch (e) {}
    });
    return out;
  }
  function mainVideo() {
    var vs = allVideos(frame && frame.contentDocument);
    var best = null, area = 0;
    vs.forEach(function (v) {
      var r = v.getBoundingClientRect(), a = r.width * r.height;
      if (!v.paused) a += 1e9;
      if (a > area) { area = a; best = v; }
    });
    return best;
  }
  function media(action) {
    var v = mainVideo();
    if (!v) return false;
    try {
      if (action === 'toggle') v.paused ? v.play() : v.pause();
      if (action === 'play') v.play();
      if (action === 'pause') v.pause();
      if (action === 'ff') v.currentTime = Math.min(v.duration || 1e9, v.currentTime + 10);
      if (action === 'rw') v.currentTime = Math.max(0, v.currentTime - 10);
      if (action === 'stop') { v.pause(); }
    } catch (e) {}
    return true;
  }

  // ---------- პულტი ----------
  var K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27,
            PLAYPAUSE: 10252, PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412, CHUP: 427, CHDOWN: 428 };

  function innerActive() {
    var a = null;
    try {
      var d = frame && frame.contentDocument;
      a = d && d.activeElement;
      while (a && (a.tagName === 'IFRAME' || a.tagName === 'FRAME')) a = a.contentDocument && a.contentDocument.activeElement;
    } catch (e) { a = null; }
    return a;
  }

  // დაბრუნებს: true — დამუშავდა; 'pass' — ბრაუზერმა თავად დაამუშაოს (ტექსტის აკრეფა); 'top' — ზედა კიდე; false — არ ეხება
  function handleKey(e) {
    if (!alive) return false;
    var k = e.keyCode;
    var a = innerActive();
    var typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
    if (typing) {
      if (k === K.BACK || k === K.ESC || k === K.UP || k === K.DOWN) { a.blur(); return true; }
      return 'pass';                                            // ტექსტი, ისრები ტექსტში, Enter (ფორმის გაგზავნა)
    }
    switch (k) {
      case K.LEFT: return moveCursor(-1, 0);
      case K.RIGHT: return moveCursor(1, 0);
      case K.UP: return moveCursor(0, -1);
      case K.DOWN: return moveCursor(0, 1);
      case K.ENTER: click(); return true;
      case K.CHUP: scrollAt(-800, 0); drawCursor(); return true;
      case K.CHDOWN: scrollAt(800, 0); drawCursor(); return true;
      case K.PLAYPAUSE: return media('toggle');
      case K.PLAY: return media('play');
      case K.PAUSE: return media('pause');
      case K.STOP: return media('stop');
      case K.FF: return media('ff');
      case K.RW: return media('rw');
    }
    return false;
  }

  // ---------- გარე API ----------
  return {
    open: function (hostEl, url, callbacks) {
      host = hostEl; cbs = callbacks || {}; stack = []; curUrl = null; alive = true;
      ensureCursor();
      cursorEl.style.display = 'block';
      cx = W / 2; cy = H / 2; drawCursor();
      load(url);
    },
    back: function () {
      if (!stack.length) return false;
      load(stack.pop());
      return true;
    },
    reload: function () { if (curUrl) load(curUrl); },
    destroy: function () {
      alive = false; gen++; destroyFrame(); stack = []; curUrl = null; hoverEl = null;
      if (cursorEl) cursorEl.style.display = 'none';
      if (hlEl) hlEl.style.display = 'none';
    },
    handleKey: handleKey,
    url: function () { return curUrl; },
    // ტესტისთვის
    _pos: function () { return { x: cx, y: cy }; },
    _set: function (x, y) { cx = x; cy = y; drawCursor(); }
  };
})();
