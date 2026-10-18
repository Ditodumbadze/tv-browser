/* TV ბრაუზერი — მსუბუქი ბრაუზერი Samsung Tizen ტელევიზორისთვის.
 * ერთი გვერდი ერთდროულად (iframe), მთავარ ეკრანზე დაბრუნებისას გვერდი მთლიანად იშლება —
 * ასე მეხსიერება თავისუფლდება. მენიუები იმართება პულტით, საიტის შიგნით — მაუსით.
 */
(function () {
  'use strict';

  // ---------- გასაღებები ----------
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
              BACK: 10009, ESC: 27, BACKSPACE: 8,
              RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406 };
  try {
    ['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue'].forEach(function (k) {
      window.tizen && tizen.tvinputdevice.registerKey(k);
    });
  } catch (e) { /* ბრაუზერში ტესტისას tizen არ არსებობს */ }

  // ---------- მეხსიერება (localStorage) ----------
  function load(key, def) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  var state = {
    view: 'home',                       // home | browse
    url: null,                          // გახსნილი საიტის მისამართი
    frame: null,
    goingBack: false,
    backTimer: null,
    overlayTimer: null,
    dialog: null                        // გახსნილი დიალოგის cleanup
  };

  // ---------- საიტები ----------
  function allSites() {
    var hidden = load('hiddenSites', []);
    var user = load('userSites', []);
    return window.DEFAULT_SITES.concat(user).filter(function (s) { return hidden.indexOf(s.url) === -1; });
  }
  function hostOf(url) {
    var m = /^[a-z]+:\/\/([^\/?#]+)/i.exec(url || '');
    return m ? m[1].replace(/^www\./, '') : url;
  }
  function normalizeInput(text) {
    text = (text || '').trim();
    if (!text) return null;
    if (/^[a-z]+:\/\//i.test(text)) return text;
    if (/^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(text)) return 'https://' + text;
    return 'https://www.google.com/search?q=' + encodeURIComponent(text);
  }
  var PALETTE = ['#2c4a8a', '#7a2d3a', '#2d4f7a', '#3c5a2d', '#5a3c7a', '#2d6a6a', '#6a4a2d', '#4a4a6a'];

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  // ---------- საათი ----------
  var DAYS = ['კვირა', 'ორშაბათი', 'სამშაბათი', 'ოთხშაბათი', 'ხუთშაბათი', 'პარასკევი', 'შაბათი'];
  var MONTHS = ['იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი', 'ივლისი', 'აგვისტო',
                'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი'];
  function tick() {
    var d = new Date();
    $('time').textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    $('date').textContent = DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }
  tick(); setInterval(tick, 15000);

  // ---------- საწყისი ეკრანის აწყობა ----------
  function renderHome() {
    var grid = $('grid');
    grid.innerHTML = '';
    allSites().forEach(function (s, i) {
      var t = el('div', 'tile');
      t.setAttribute('data-f', '');
      t.setAttribute('data-act', 'open');
      t.setAttribute('data-url', s.url);
      t.setAttribute('data-name', s.name);
      var color = s.color || PALETTE[i % PALETTE.length];
      t.innerHTML = '<div class="m" style="background:' + color + '">' + esc(s.name.charAt(0).toUpperCase()) +
                    '</div><div><b>' + esc(s.name) + '</b><span>' + esc(hostOf(s.url)) + '</span></div>';
      grid.appendChild(t);
    });
    var add = el('div', 'tile add', '<div class="m">+</div><div><b>დამატება</b><span>ახალი საიტი</span></div>');
    add.setAttribute('data-f', '');
    add.setAttribute('data-act', 'addsite');
    grid.appendChild(add);

    // გაგრძელება (თუ წინა ჯერზე საიტი ღია იყო — მაგ. გაითიშა)
    var cw = $('contWrap');
    cw.innerHTML = '';
    var sess = load('session', null);
    if (sess && sess.browsing && sess.url) {
      var c = el('div', 'cont', '<em>▶ გაგრძელება</em> ' + esc(hostOf(sess.url)) +
                 '<small>წინა ჯერზე ეს გვერდი იყო ღია</small>');
      c.setAttribute('data-f', '');
      c.setAttribute('data-act', 'open');
      c.setAttribute('data-url', sess.url);
      cw.appendChild(c);
    }

    // ბოლოს ნანახი
    var rec = $('recent');
    rec.innerHTML = '';
    var list = load('recent', []).slice(0, 3);
    if (!list.length) {
      rec.innerHTML = '<div class="empty">ჯერ არაფერი გაგიხსნია</div>';
    }
    list.forEach(function (r) {
      var d = new Date(r.t);
      var when = d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + ', ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      var c = el('div', 'rc', '<b>' + esc(r.name || hostOf(r.url)) + '</b><div><span>' + esc(hostOf(r.url)) +
                 ' · ' + when + '</span><em>გაგრძელება ▸</em></div>');
      c.setAttribute('data-f', '');
      c.setAttribute('data-act', 'open');
      c.setAttribute('data-url', r.url);
      rec.appendChild(c);
    });
  }

  // ---------- ფოკუსი და სივრცითი ნავიგაცია ----------
  var current = null;
  function layer() {
    if (!$('dim').classList.contains('hidden')) return $('dialog');
    if (state.view === 'browse') return $('overlay');
    return $('home');
  }
  function focusables() {
    var nodes = layer().querySelectorAll('[data-f]');
    return Array.prototype.filter.call(nodes, function (n) { return n.offsetParent !== null; });
  }
  function setFocus(node) {
    if (current) current.classList.remove('focus');
    current = node;
    if (!node) return;
    node.classList.add('focus');
    if (node.tagName === 'INPUT') { node.focus(); } else if (document.activeElement && document.activeElement.tagName === 'INPUT') { document.activeElement.blur(); }
    if (node.scrollIntoView && state.view === 'home') { /* ეკრანი ერთ გვერდზე ეტევა */ }
  }
  function ensureFocus(prefer) {
    var list = focusables();
    if (prefer && list.indexOf(prefer) !== -1) return setFocus(prefer);
    if (current && list.indexOf(current) !== -1) return setFocus(current);
    setFocus(list[0] || null);
  }
  function move(dir) {
    var list = focusables();
    if (!current || list.indexOf(current) === -1) return ensureFocus();
    var a = current.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var best = null, bestScore = Infinity;
    list.forEach(function (n) {
      if (n === current) return;
      var b = n.getBoundingClientRect();
      var bx = b.left + b.width / 2, by = b.top + b.height / 2;
      var dx = bx - ax, dy = by - ay, main, cross;
      if (dir === 'left')  { if (dx >= -5) return; main = -dx; cross = Math.abs(dy); }
      if (dir === 'right') { if (dx <= 5) return;  main = dx;  cross = Math.abs(dy); }
      if (dir === 'up')    { if (dy >= -5) return; main = -dy; cross = Math.abs(dx); }
      if (dir === 'down')  { if (dy <= 5) return;  main = dy;  cross = Math.abs(dx); }
      var score = main + cross * 2.2;
      if (score < bestScore) { bestScore = score; best = n; }
    });
    if (best) setFocus(best);
  }

  // ---------- შეტყობინება ----------
  var toastTimer;
  function toast(text, ms) {
    var t = $('toast');
    t.innerHTML = '<span style="color:var(--ok)">●</span>' + esc(text);
    t.classList.remove('off');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('off'); }, ms || 3500);
  }

  // ---------- გვერდის გახსნა / დახურვა ----------
  function destroyFrame() {
    if (state.frame) {
      try { state.frame.src = 'about:blank'; } catch (e) {}
      if (state.frame.parentNode) state.frame.parentNode.removeChild(state.frame);
      state.frame = null;
    }
    $('frameHost').innerHTML = '';
  }

  function openUrl(url, name) {
    if (!url) return;
    destroyFrame();
    state.url = url;
    state.view = 'browse';
    state.goingBack = false;
    // „დამცავი“ ჩანაწერი ისტორიაში: უკან სვლა მას ვერ გასცდება და აპლიკაცია არ დაიხურება.
    try { history.pushState({ tvguard: Date.now() }, ''); } catch (e) {}
    $('home').classList.add('hidden');
    $('browse').classList.remove('hidden');
    $('curUrl').textContent = url.replace(/^https?:\/\//, '');

    var f = document.createElement('iframe');
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
    f.src = url;                        // src ჯერ — რომ ცარიელი about:blank არ ჩაიტვირთოს
    f.addEventListener('load', function () { if (this === state.frame) onFrameLoad(); });
    state.frame = f;
    $('frameHost').appendChild(f);
    progress(true);

    save('session', { url: url, browsing: true, t: Date.now() });
    var rec = load('recent', []).filter(function (r) { return r.url !== url; });
    rec.unshift({ url: url, name: name || hostOf(url), t: Date.now() });
    save('recent', rec.slice(0, 6));

    showOverlay(4000);
    toast('ზედა პანელი: პულტის ↑ ან მაუსი ეკრანის ზედა კიდესთან. თუ გვერდი ცარიელია — „სრულად გახსნა“.', 6000);
  }

  function onFrameLoad() {
    state.goingBack = false;
    progress(false);
    if (state.backTimer) { clearTimeout(state.backTimer); state.backTimer = null; }
  }

  function progress(on) {
    var p = $('loading');
    if (on) { p.style.transition = 'none'; p.style.width = '0'; setTimeout(function () { p.style.transition = 'width 8s'; p.style.width = '85%'; }, 30); }
    else { p.style.transition = 'width .3s'; p.style.width = '100%'; setTimeout(function () { p.style.width = '0'; }, 400); }
  }

  function goHome() {
    destroyFrame();                    // მეხსიერების გათავისუფლება
    state.view = 'home';
    state.url = null;
    var s = load('session', null);
    if (s) { s.browsing = false; save('session', s); }
    $('browse').classList.add('hidden');
    $('home').classList.remove('hidden');
    hideOverlay();
    $('toast').classList.add('off');
    renderHome();
    window.focus();
    ensureFocus($('grid').firstChild);
  }

  function goBack() {
    // iframe-ის ისტორია მშობელი ფანჯრის ისტორიის ნაწილია, ამიტომ history.back() გვერდს აბრუნებს.
    // პირველ გვერდზე უკან სვლა „დამცავ“ ჩანაწერს მიაღწევს (popstate) — მაშინ მთავარზე გავდივართ.
    state.goingBack = true;
    try { history.back(); } catch (e) { state.goingBack = false; return goHome(); }
    progress(true);
    state.backTimer = setTimeout(function () { state.backTimer = null; state.goingBack = false; progress(false); goHome(); }, 1500);
  }

  function cleanReload() {
    if (state.view !== 'browse' || !state.url) return;
    var url = state.url;
    toast('სუფთა გადატვირთვა — მეხსიერება გათავისუფლდა');
    destroyFrame();
    setTimeout(function () { openUrl(url); }, 250);
  }

  // ---------- ზედა პანელი ----------
  function showOverlay(ms) {
    $('overlay').classList.remove('off');
    window.focus();                     // კლავიატურა/პულტი ისევ ჩვენ გვეკუთვნის
    if (state.view === 'browse') ensureFocus();
    clearTimeout(state.overlayTimer);
    if (ms) state.overlayTimer = setTimeout(hideOverlay, ms);
  }
  function hideOverlay() {
    $('overlay').classList.add('off');
    clearTimeout(state.overlayTimer);
    if (current && $('overlay').contains(current)) { current.classList.remove('focus'); current = null; }
  }
  function overlayVisible() { return !$('overlay').classList.contains('off'); }

  $('handle').addEventListener('mouseenter', function () { showOverlay(5000); });
  $('overlay').addEventListener('mouseenter', function () { clearTimeout(state.overlayTimer); });
  $('overlay').addEventListener('mouseleave', function () { state.overlayTimer = setTimeout(hideOverlay, 1500); });
  $('homeFab').addEventListener('click', goHome);
  window.addEventListener('popstate', function () {
    if (state.view === 'browse') { if (state.backTimer) { clearTimeout(state.backTimer); state.backTimer = null; } goHome(); }
  });

  // ---------- დიალოგები ----------
  function openDialog(html, onKey) {
    $('dialog').innerHTML = html;
    $('dim').classList.remove('hidden');
    clearTimeout(state.overlayTimer);
    var prev = current;
    state.dialog = { prev: prev, onKey: onKey };
    ensureFocus();
  }
  function closeDialog() {
    $('dim').classList.add('hidden');
    $('dialog').innerHTML = '';
    var d = state.dialog; state.dialog = null;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
    current = null;
    if (state.view === 'browse') { showOverlay(4000); } else { ensureFocus(d && d.prev); }
  }

  function addressDialog() {
    openDialog(
      '<h3>მისამართი ან ძებნა</h3><p>ჩაწერე საიტის მისამართი (მაგ. imovs.ge) ან საძიებო სიტყვა.</p>' +
      '<input id="dlgInput" data-f type="text" autocomplete="off" value="">' +
      '<div class="row"><div class="dbtn" data-f data-act="dlg-cancel">გაუქმება</div>' +
      '<div class="dbtn primary" data-f data-act="dlg-go">გახსნა</div></div>');
    $('dlgInput').addEventListener('keydown', function (e) {
      if (e.keyCode === KEY.ENTER) { e.stopPropagation(); e.preventDefault(); act({ getAttribute: function () { return 'dlg-go'; } }); }
    });
  }

  function addSiteDialog(prefillUrl) {
    openDialog(
      '<h3>საიტის დამატება</h3><p>ბარათი რჩეულ საიტებში გამოჩნდება.</p>' +
      '<label>სახელი</label><input id="dlgName" data-f type="text" autocomplete="off" value="' + esc(prefillUrl ? hostOf(prefillUrl) : '') + '">' +
      '<label>მისამართი</label><input id="dlgUrl" data-f type="text" autocomplete="off" value="' + esc(prefillUrl || 'https://') + '">' +
      '<div class="row"><div class="dbtn" data-f data-act="dlg-cancel">გაუქმება</div>' +
      '<div class="dbtn primary" data-f data-act="dlg-save">შენახვა</div></div>');
  }

  function deleteDialog(tile) {
    var url = tile.getAttribute('data-url'), name = tile.getAttribute('data-name');
    state.pendingDelete = url;
    openDialog(
      '<h3>ბარათის წაშლა</h3><p>წავშალო „' + esc(name) + '“ რჩეული საიტებიდან?</p>' +
      '<div class="row"><div class="dbtn" data-f data-act="dlg-cancel">არა</div>' +
      '<div class="dbtn danger" data-f data-act="dlg-delete">წაშლა</div></div>');
  }

  // ---------- მოქმედებები ----------
  function act(node) {
    var a = node.getAttribute('data-act');
    switch (a) {
      case 'open': openUrl(node.getAttribute('data-url'), node.getAttribute('data-name')); break;
      case 'address': addressDialog(); break;
      case 'addsite': addSiteDialog(); break;
      case 'back': goBack(); break;
      case 'reload': cleanReload(); break;
      case 'home': goHome(); break;
      case 'star': addSiteDialog(state.url); break;
      case 'fullopen':
        // iframe-ის გარეშე, მთელ ფანჯარაში. დასაბრუნებლად აპლიკაცია თავიდან გაუშვი.
        save('session', { url: state.url, browsing: false, t: Date.now() });
        window.location.href = state.url;
        break;
      case 'dlg-cancel': closeDialog(); break;
      case 'dlg-go': {
        var url = normalizeInput($('dlgInput').value);
        closeDialog();
        if (url) openUrl(url);
        break;
      }
      case 'dlg-save': {
        var name = ($('dlgName').value || '').trim();
        var u = normalizeInput($('dlgUrl').value);
        if (!u || !name) { toast('შეავსე სახელიც და მისამართიც'); return; }
        var user = load('userSites', []);
        user.push({ name: name, url: u });
        save('userSites', user);
        var hidden = load('hiddenSites', []).filter(function (h) { return h !== u; });
        save('hiddenSites', hidden);
        closeDialog();
        if (state.view === 'home') renderHome();
        toast('„' + name + '“ დაემატა რჩეულებში');
        break;
      }
      case 'dlg-delete': {
        var del = state.pendingDelete;
        save('userSites', load('userSites', []).filter(function (s) { return s.url !== del; }));
        var isDefault = window.DEFAULT_SITES.some(function (s) { return s.url === del; });
        if (isDefault) { var h = load('hiddenSites', []); h.push(del); save('hiddenSites', h); }
        closeDialog();
        renderHome(); ensureFocus();
        toast('ბარათი წაიშალა');
        break;
      }
    }
  }

  // ---------- პულტი ----------
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    var inInput = document.activeElement && document.activeElement.tagName === 'INPUT';
    var dialogOpen = !$('dim').classList.contains('hidden');

    if (inInput && (k === KEY.LEFT || k === KEY.RIGHT || k === KEY.BACKSPACE)) return; // ტექსტის რედაქტირება

    if (k === KEY.BACK || k === KEY.ESC) {
      e.preventDefault();
      if (dialogOpen) return closeDialog();
      if (state.view === 'browse') return overlayVisible() ? hideOverlay() : goBack();
      return; // მთავარ ეკრანზე Back არაფერს აკეთებს (გასასვლელად — EXIT)
    }

    if (state.view === 'browse' && !dialogOpen && !overlayVisible()) {
      if (k === KEY.UP || k === KEY.ENTER || k === KEY.DOWN) { e.preventDefault(); return showOverlay(5000); }
    }

    switch (k) {
      case KEY.LEFT: e.preventDefault(); move('left'); break;
      case KEY.RIGHT: e.preventDefault(); move('right'); break;
      case KEY.UP: e.preventDefault(); move('up'); break;
      case KEY.DOWN:
        e.preventDefault();
        if (state.view === 'browse' && !dialogOpen) { hideOverlay(); break; }
        move('down'); break;
      case KEY.ENTER:
        if (current && current.tagName !== 'INPUT') { e.preventDefault(); act(current); }
        break;
      case KEY.RED: e.preventDefault(); if (!dialogOpen) addressDialog(); break;
      case KEY.GREEN: e.preventDefault(); if (state.view === 'browse') cleanReload(); else { renderHome(); toast('მთავარი ეკრანი განახლდა'); } break;
      case KEY.YELLOW: e.preventDefault(); if (!dialogOpen) addSiteDialog(state.view === 'browse' ? state.url : null); break;
      case KEY.BLUE:
        e.preventDefault();
        if (state.view === 'home' && current && current.classList.contains('tile') && current.getAttribute('data-url')) deleteDialog(current);
        break;
    }
    if (state.view === 'browse' && overlayVisible() && !dialogOpen) { clearTimeout(state.overlayTimer); state.overlayTimer = setTimeout(hideOverlay, 6000); }
  });

  // მაუსით დაჭერა ჩვენს ელემენტებზე
  document.addEventListener('click', function (e) {
    var n = e.target.closest ? e.target.closest('[data-act]') : null;
    if (n && layer().contains(n)) { setFocus(n); act(n); }
  });
  document.addEventListener('mouseover', function (e) {
    var n = e.target.closest ? e.target.closest('[data-f]') : null;
    if (n && n.tagName !== 'INPUT' && layer().contains(n)) setFocus(n);
  });

  // ---------- გაშვება ----------
  renderHome();
  ensureFocus($('contWrap').firstChild || $('grid').firstChild);

  // ტესტისთვის: window.__tv
  window.__tv = { openUrl: openUrl, goHome: goHome, state: state };
})();
