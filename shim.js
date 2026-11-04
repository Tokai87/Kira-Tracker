/* Kira app layer: gives the page the same small "claude" interface it uses inside Claude,
   but backed by Google sign-in + Firestore (cloud), Tesseract (bill scan) and normal downloads. */
(function () {
  'use strict';
  var cfg = window.KIRA_FIREBASE || {};
  var configured = !!(cfg.apiKey && cfg.projectId && String(cfg.apiKey).indexOf('PASTE') !== 0 && String(cfg.projectId).indexOf('PASTE') !== 0);
  var FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
  var st = { user: null, fs: null, auth: null, mode: configured ? 'loading' : 'nocfg' };
  var readyResolve, ready = new Promise(function (r) { readyResolve = r; });

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = function () { res(); }; s.onerror = function () { rej(new Error('load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function el(tag, css, html) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
  function whenBody(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

  // ---------- login screen ----------
  var overlay = null;
  function showLogin(msg) {
    whenBody(function () {
      if (overlay) { var m0 = overlay.querySelector('[data-msg]'); if (m0) m0.textContent = msg || ''; return; }
      overlay = el('div', 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg,#F2F5F8);color:var(--fg,#14202B);font-family:"Plus Jakarta Sans",system-ui,sans-serif;');
      overlay.innerHTML =
        '<div style="width:100%;max-width:360px;text-align:center">' +
        '<img src="icon-192.png" width="84" height="84" alt="" style="border-radius:22px;box-shadow:0 8px 24px rgba(20,32,43,.18)">' +
        '<h1 style="margin:18px 0 4px;font-size:28px;font-family:\'Bricolage Grotesque\',inherit">Kira</h1>' +
        '<p style="margin:0 0 26px;color:var(--muted,#5A6B7B);font-size:14px;line-height:1.5">Jejak wang masuk dan keluar. Log masuk untuk simpan data dengan selamat dan lihat di telefon lain.</p>' +
        '<button type="button" data-g style="width:100%;padding:14px 16px;border-radius:16px;border:1px solid var(--line,#D8E0E8);background:var(--surface,#fff);color:inherit;font:600 15px inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px">' +
        '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>' +
        'Log masuk dengan Google</button>' +
        '<p data-msg style="min-height:18px;margin:12px 0 0;color:#B3261E;font-size:13px"></p>' +
        '<button type="button" data-guest style="margin-top:6px;background:none;border:0;color:var(--muted,#5A6B7B);font:500 14px inherit;text-decoration:underline;cursor:pointer;padding:8px">Guna tanpa akaun (data dalam telefon ini sahaja)</button>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.querySelector('[data-msg]').textContent = msg || '';
      overlay.querySelector('[data-g]').onclick = signIn;
      overlay.querySelector('[data-guest]').onclick = function () { lsSet('kira.guest', '1'); hideLogin(); finish(null); };
    });
  }
  function hideLogin() { if (overlay) { overlay.remove(); overlay = null; } }

  function signIn() {
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return st.auth.signInWithPopup(provider).catch(function (e) {
      var c = e && e.code;
      if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment') return st.auth.signInWithRedirect(provider);
      if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return;
      if (c === 'auth/unauthorized-domain') showLogin('Alamat web ini belum ditambah dalam Firebase (Authorized domains). Lihat SETUP.');
      else showLogin('Tidak dapat log masuk. Cuba lagi.');
    });
  }

  // ---------- account row (bottom of the page) ----------
  function accountRow() {
    whenBody(function () {
      var host = document.querySelector('.help');
      if (!host) return;
      var row = el('div', 'margin:10px 0 0;padding:12px 16px;border-radius:16px;border:1px solid var(--line,#D8E0E8);background:var(--surface,#fff);display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:13px;color:var(--muted,#5A6B7B)');
      var left = el('span', 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap');
      var btn = el('button', 'flex:none;background:none;border:1px solid var(--line,#D8E0E8);border-radius:12px;padding:8px 12px;color:var(--fg,#14202B);font:600 13px inherit;cursor:pointer');
      if (st.user) {
        left.textContent = 'Log masuk: ' + (st.user.email || st.user.displayName || '');
        btn.textContent = 'Log keluar';
        btn.onclick = function () { st.auth.signOut().then(function () { lsDel('kira.guest'); location.reload(); }); };
      } else if (st.mode === 'nocfg') {
        left.textContent = 'Simpanan cloud belum disediakan. Data dalam telefon ini sahaja.';
        btn.hidden = true;
      } else {
        left.textContent = 'Data dalam telefon ini sahaja.';
        btn.textContent = 'Log masuk';
        btn.onclick = function () { lsDel('kira.guest'); location.reload(); };
      }
      row.appendChild(left); row.appendChild(btn); host.appendChild(row);
    });
  }

  function finish(user) {
    st.user = user || null;
    if (user) st.mode = 'cloud'; else if (st.mode === 'loading') st.mode = 'guest';
    accountRow();
    readyResolve(st.user);
  }

  // ---------- startup ----------
  (function init() {
    if (!configured) { finish(null); return; }
    Promise.all([loadScript(FB + 'firebase-app-compat.js')]).then(function () {
      return Promise.all([loadScript(FB + 'firebase-auth-compat.js'), loadScript(FB + 'firebase-firestore-compat.js')]);
    }).then(function () {
      firebase.initializeApp(cfg);
      st.auth = firebase.auth();
      st.fs = firebase.firestore();
      try { st.fs.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) {}
      var first = true;
      st.auth.onAuthStateChanged(function (u) {
        if (u) { hideLogin(); if (first || !st.user) { first = false; finish(u); } return; }
        if (first) {
          first = false;
          if (lsGet('kira.guest') === '1') { finish(null); } else showLogin('');
        }
      });
      // after a redirect sign-in the user comes back here
      st.auth.getRedirectResult().catch(function () {});
    }).catch(function () {
      // could not load the sign-in library (offline for the first time): work on this phone only
      st.mode = 'guest'; finish(null);
    });
  })();

  // ---------- db: same shape the page already uses, mapped to users/{uid} ----------
  var SLOW = 600;
  function quick(p) {
    return new Promise(function (res, rej) { p.then(res, rej); setTimeout(res, SLOW); });
  }
  function makeDb(uid) {
    var base = st.fs.collection('users').doc(uid);
    return {
      doc: function () {
        return {
          set: function (d) { return quick(base.set(d)); },
          onSnapshot: function (a, b) { return base.onSnapshot(a, b); },
          collection: function (k) {
            var c = base.collection(k);
            return {
              doc: function (id) {
                var d = c.doc(id);
                return { set: function (o) { return quick(d.set(o)); }, delete: function () { return quick(d.delete()); } };
              },
              onSnapshot: function (a, b) { return c.onSnapshot(a, b); }
            };
          }
        };
      }
    };
  }

  // ---------- bill scan: Tesseract in the browser ----------
  var scanner = null;
  function getScanner() {
    if (scanner) return scanner;
    var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    var DATE_STRIP = /\b\d{1,4}[-\/.]\d{1,2}[-\/.]\d{2,4}\b/g;
    var CAT_WORDS = [
      ['Transport', /petrol|petronas|shell\b|petron|caltex|bhp\b|touch ?n ?go|parking|parkir|toll|\bgrab\b|lrt|mrt|ktm|bus\b|taxi|e-?hailing/i],
      ['Health', /pharmacy|farmasi|guardian|watsons|clinic|klinik|hospital|caring|medic|dental|doktor/i],
      ['Bills', /tnb|syabas|\bair selangor\b|unifi|celcom|maxis|digi\b|u mobile|astro|indah water|telekom|topup|top-?up|reload|bil\b|\bbill\b payment|insurance|takaful/i],
      ['Fun', /cinema|cineplex|\btgv\b|\bgsc\b|karaoke|game|steam|netflix|spotify|bowling|arcade|ticket|tiket/i],
      ['Shopping', /uniqlo|h&m|zara|shopee|lazada|ikea|popular|mr\.? ?diy|daiso|miniso|fashion|boutique|shoes|kasut|electronics|digital|machines/i],
      ['Housing', /\brent\b|\bsewa\b|hardware|furniture|plumb/i],
      ['Food', /restaurant|restoran|cafe\b|coffee|kopi|mamak|nasi\b|\bmee\b|bakery|burger|pizza|\bkfc\b|\bmcd|mcdonald|starbucks|\bfood|bubble|\btea\b|\bteh\b|grocer|\bmart\b|mydin|aeon|tesco|lotus|giant\b|speedmart|econsave|bistro|kitchen|sushi|ayam|bbq|steamboat|supermarket|hypermarket|99 speed/i]
    ];
    function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function validDate(y, m, d) {
      if (y < 100) y += 2000;
      if (y < 2000 || m < 1 || m > 12 || d < 1 || d > 31) return null;
      var dt = new Date(y, m - 1, d);
      if (dt.getMonth() !== m - 1) return null;
      var s = ymd(dt);
      return s > ymd(new Date()) ? null : s;
    }
    function findDate(text) {
      var m;
      if ((m = /\b(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/.exec(text))) { var a = validDate(+m[1], +m[2], +m[3]); if (a) return a; }
      var re = /\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})\b/g;
      while ((m = re.exec(text))) {
        var d1 = validDate(+m[3], +m[2], +m[1]); if (d1) return d1;
        var d2 = validDate(+m[3], +m[1], +m[2]); if (d2) return d2;
      }
      var re2 = /\b(\d{1,2})[ \-]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ \-,.]*(\d{4}|\d{2})\b/ig;
      while ((m = re2.exec(text))) { var d3 = validDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]); if (d3) return d3; }
      return null;
    }
    function amountsIn(line) {
      var out = [], m, re = /(\d{1,3}(?:,\d{3})+|\d+)[.,](\d{2})(?!\d)/g;
      var clean = line.replace(DATE_STRIP, ' ');
      while ((m = re.exec(clean))) {
        var v = parseInt(m[1].replace(/,/g, ''), 10) * 100 + parseInt(m[2], 10);
        if (v > 0 && v < 1e9) out.push(v);
      }
      return out;
    }
    function titleCase(s) { return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s(\/-])([a-z])/g, function (_, a, b) { return a + b.toUpperCase(); }) : s; }
    function parseReceipt(raw) {
      var lines = String(raw || '').replace(/\r/g, '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      var KEY = /(grand\s*total|net\s*total|nett\b|total\s*(amount|due|payable|rm|\(rm\)|incl)?|jumlah|amount\s*due|amt\s*due|bayar)/i;
      var NOT_KEY = /sub\s*-?\s*total|total\s*(qty|item|saving|discount|tax|sst|gst|point)/i;
      var NOT_PAID = /(change|baki|tender|cash|rounding|round adj|discount|diskaun|\btax\b|\bsst\b|\bgst\b|service charge|\bqty\b|points?\b|mata\b|deposit|card\b|visa|master)/i;
      var keyVals = [], allVals = [];
      lines.forEach(function (l, i) {
        var vals = amountsIn(l), isKey = KEY.test(l) && !NOT_KEY.test(l);
        if (isKey) { if (!vals.length && lines[i + 1]) vals = amountsIn(lines[i + 1]); vals.forEach(function (v) { keyVals.push(v); }); }
        else if (!NOT_PAID.test(l)) vals.forEach(function (v) { allVals.push(v); });
      });
      var amount = 0, sure = false;
      if (keyVals.length) { amount = Math.max.apply(null, keyVals); sure = true; }
      else if (allVals.length) amount = Math.max.apply(null, allVals);
      var merchant = '';
      for (var i = 0; i < Math.min(8, lines.length); i++) {
        var l = lines[i].replace(/[^A-Za-z0-9&'.,()\- ]/g, ' ').replace(/\s+/g, ' ').trim();
        var letters = (l.match(/[A-Za-z]/g) || []).length;
        if (letters < 3 || letters / l.length < 0.6) continue;
        if (/^(tax invoice|invoice|receipt|resit|official|cash bill|bill\b|tel\b|phone|gst|sst|reg\b|co\.? ?no|company no|welcome|thank)/i.test(l)) continue;
        merchant = titleCase(l).slice(0, 40); break;
      }
      var head = lines.slice(0, 5).join(' '), cat = 'Other', k;
      for (k = 0; k < CAT_WORDS.length; k++) if (CAT_WORDS[k][1].test(head)) { cat = CAT_WORDS[k][0]; break; }
      if (cat === 'Other') { var all = lines.join(' '); for (k = 0; k < CAT_WORDS.length; k++) if (CAT_WORDS[k][1].test(all)) { cat = CAT_WORDS[k][0]; break; } }
      return { amount: amount, sure: sure, date: findDate(lines.join('\n')), merchant: merchant, cat: cat };
    }
    function prep(file) {
      return new Promise(function (res, rej) {
        var url = URL.createObjectURL(file), img = new Image();
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight, long = Math.max(w, h);
          var k = long > 2000 ? 2000 / long : (long < 1200 ? 1200 / long : 1);
          var cw = Math.round(w * k), ch = Math.round(h * k), c = document.createElement('canvas'); c.width = cw; c.height = ch;
          var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, cw, ch);
          var d = x.getImageData(0, 0, cw, ch), px = d.data, hist = new Uint32Array(256), i;
          for (i = 0; i < px.length; i += 4) { var g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0; px[i] = g; hist[g]++; }
          var total = cw * ch, acc = 0, lo = 0, hi = 255;
          for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.02) { lo = i; break; } }
          acc = 0;
          for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.02) { hi = i; break; } }
          var span = Math.max(30, hi - lo);
          for (i = 0; i < px.length; i += 4) { var v = Math.max(0, Math.min(255, ((px[i] - lo) * 255 / span) | 0)); px[i] = px[i + 1] = px[i + 2] = v; }
          x.putImageData(d, 0, 0); URL.revokeObjectURL(url); res(c);
        };
        img.onerror = function () { URL.revokeObjectURL(url); rej(Object.assign(new Error('image'), { code: 'image_rejected' })); };
        img.src = url;
      });
    }
    var tess = null;
    function loadTess() {
      if (window.Tesseract) return Promise.resolve();
      if (!tess) tess = loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js').catch(function (e) { tess = null; throw e; });
      return tess;
    }
    scanner = {
      limits: function () { return Promise.resolve({ images: true }); },
      json: async function (prompt, opts) {
        var canvas = await prep(opts.images);
        await loadTess();
        var worker = await Tesseract.createWorker('eng');
        try {
          await worker.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' });
          var out = await worker.recognize(canvas);
          var r = parseReceipt(out.data.text);
          if (!r.amount) return { total: null };
          return { total: r.amount / 100, date: r.date, merchant: r.merchant || null, category: r.cat, confident: r.sure };
        } finally { try { await worker.terminate(); } catch (e) {} }
      },
      _parse: parseReceipt
    };
    return scanner;
  }

  // ---------- downloads ----------
  var downloads = {
    save: function (o) {
      return new Promise(function (res, rej) {
        try {
          var blob = o.data instanceof Blob ? o.data : new Blob([o.data], { type: 'text/csv;charset=utf-8' });
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = o.filename || 'kira.csv';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 30000);
          res({ status: 'saved' });
        } catch (e) { rej({ code: 'unavailable', message: String(e) }); }
      });
    }
  };

  window.claude = {
    use: async function (name) {
      if (name === 'sample') return getScanner();
      if (name === 'downloads') return downloads;
      if (name === 'db' || name === 'user') {
        var u = await ready;
        if (!u || !st.fs) return null;
        if (name === 'db') return makeDb(u.uid);
        return { can: function () { return true; }, id: function () { return Promise.resolve(u.uid); } };
      }
      return null;
    }
  };

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
