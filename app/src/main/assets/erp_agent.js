/*
 * MIT Attendance – ERP agent.
 * Runs inside the real erp.mit.asia page (hidden behind the app UI).
 * It fills the login form, notices the email-OTP step, opens the attendance
 * page and reads the subject cards. It reports back through window.MITAgent.
 * It never sends anything anywhere else.
 */
(function () {
  if (window.__mitAgent) { window.__mitAgent.kick(); return; }

  var bridge = window.MITAgent;
  function post(type, obj) {
    try { bridge.post(type, obj == null ? '' : JSON.stringify(obj)); } catch (e) {}
  }
  function cfg() { return window.__MIT_CFG || {}; }

  var startedAt = Date.now();
  var lastAttendanceClick = 0;
  var attendanceClicks = 0;
  var otpAnnounced = false;
  var done = false;
  var timer = null;

  // ---------- helpers ----------
  function isVisible(el) {
    if (!el) return false;
    var s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function attrs(el) {
    return [el.name, el.id, el.placeholder, el.getAttribute('aria-label'),
      el.getAttribute('autocomplete'), el.getAttribute('formcontrolname')].join(' ').toLowerCase();
  }
  function setValue(el, v) {
    el.focus();
    var proto = Object.getPrototypeOf(el);
    var desc = Object.getOwnPropertyDescriptor(proto, 'value') ||
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, v); else el.value = v;
    ['input', 'change', 'keyup'].forEach(function (t) {
      el.dispatchEvent(new Event(t, { bubbles: true }));
    });
    el.blur();
  }
  function buttonText(el) {
    return ((el.innerText || el.value || el.getAttribute('aria-label') || '') + '').trim();
  }
  function findButton(re, scope) {
    var list = (scope || document).querySelectorAll('button, input[type=submit], input[type=button], a, [role=button]');
    for (var i = 0; i < list.length; i++) {
      if (isVisible(list[i]) && re.test(buttonText(list[i]))) return list[i];
    }
    return null;
  }
  function pageText() { return (document.body && document.body.innerText) || ''; }
  function visibleInputs() {
    return Array.prototype.filter.call(
      document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio])'), isVisible);
  }
  function snapshot(reason) {
    var inputs = visibleInputs().map(function (el) {
      return { type: el.type, name: el.name, id: el.id, placeholder: el.placeholder };
    });
    var buttons = Array.prototype.filter.call(document.querySelectorAll('button, input[type=submit], a, [role=button]'), isVisible)
      .map(buttonText).filter(Boolean).slice(0, 40);
    var frames = Array.prototype.map.call(document.querySelectorAll('iframe'), function (f) { return f.src; });
    var selects = Array.prototype.map.call(document.querySelectorAll('select'), function (sel) {
      return { name: sel.name, id: sel.id, visible: isVisible(sel), selected: sel.selectedIndex,
        options: Array.prototype.map.call(sel.options, function (o) { return o.text.trim() + ' = ' + o.value; }).slice(0, 30) };
    });
    var custom = document.querySelectorAll('mat-select, .select2, .bootstrap-select, .dropdown-toggle, [role=combobox], [role=listbox]').length;
    post('debug', {
      reason: reason, url: location.href, title: document.title,
      inputs: inputs, buttons: buttons, iframes: frames, selects: selects, customDropdowns: custom, text: pageText().slice(0, 4000)
    });
  }

  // ---------- attendance cards ----------
  function findCards() {
    var all = document.querySelectorAll('div, mat-card, li, section, article, td');
    var hits = [];
    for (var i = 0; i < all.length; i++) {
      var t = all[i].innerText || '';
      if (/session\s*done/i.test(t) && /credit/i.test(t) &&
          (t.match(/session\s*done/gi) || []).length === 1) hits.push(all[i]);
    }
    // keep the smallest boxes: ones that don't contain another hit
    return hits.filter(function (el) {
      return !hits.some(function (o) { return o !== el && el.contains(o); });
    });
  }
  function num(s) {
    var n = parseFloat(String(s).replace(/[^\d.]/g, ''));
    return isNaN(n) ? null : n;
  }
  function parseCard(el) {
    var text = el.innerText || '';
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var title = (lines[0] || '').replace(/^\d+\s*[.)]\s*/, '');
    var code = null;
    var m = title.match(/\(([^()]+)\)\s*$/);
    if (m) { code = m[1].trim(); title = title.slice(0, m.index).trim(); }

    var faculty = null;
    for (var i = 1; i < lines.length; i++) {
      if (!/credit|next lecture|attendance|session done|^[\d.%\s:-]+$/i.test(lines[i])) { faculty = lines[i]; break; }
    }
    var credits = (text.match(/credits?\s*:?\s*([\d.]+)/i) || [])[1];
    var next = (text.match(/next\s*lecture\s*:?\s*([^\n]*)/i) || [])[1];
    if (next != null) { next = next.trim(); if (/^[-:\s]*$/.test(next)) next = null; }
    var session = (text.match(/([\d.]+)\s*%\s*\n?\s*session\s*done/i) || [])[1];

    // attendance: the number shown just above the word "Attendance"
    var att = null;
    for (var j = 0; j < lines.length; j++) {
      if (/^attendance$/i.test(lines[j]) && j > 0 && /^[\d.]+\s*%?$/.test(lines[j - 1])) { att = num(lines[j - 1]); break; }
    }
    if (att === null) {
      var a = text.match(/([\d.]+)\s*%?\s*\n\s*attendance/i);
      if (a) att = num(a[1]);
    }
    if (att === null) {
      var pv = el.querySelector('[aria-valuenow]');
      if (pv) att = num(pv.getAttribute('aria-valuenow'));
    }
    if (att === null) {
      // ring value drawn in SVG <text> or a lone number element
      var leaf = el.querySelectorAll('text, span, div, p, b, strong');
      for (var k = 0; k < leaf.length; k++) {
        var lt = (leaf[k].textContent || '').trim();
        if (leaf[k].children.length === 0 && /^\d{1,3}(\.\d+)?$/.test(lt) && lt !== credits) { att = num(lt); break; }
      }
    }
    return {
      name: title, code: code, faculty: faculty,
      credits: credits != null ? num(credits) : null,
      attendance: att, sessionDone: session != null ? num(session) : null,
      nextLecture: next
    };
  }

  // ---------- profile photo & name ----------
  function findProfile() {
    var out = { photo: null, name: null };
    var imgs = Array.prototype.filter.call(document.querySelectorAll('img'), isVisible);
    var best = null, bestScore = -1;
    imgs.forEach(function (img) {
      var r = img.getBoundingClientRect();
      if (r.width < 18 || r.width > 160 || r.top > 160) return;
      var src = img.currentSrc || img.src || '';
      var score = 0;
      if (/photo|profile|avatar|user|student|stud|emp|pic|image/i.test(src + ' ' + img.className + ' ' + img.alt)) score += 3;
      if (r.left > window.innerWidth / 2) score += 2;
      if (Math.abs(r.width - r.height) < 6) score += 1;
      if (/logo/i.test(src + ' ' + img.className + ' ' + img.alt)) score -= 5;
      if (score > bestScore) { bestScore = score; best = img; }
    });
    if (best && bestScore >= 2) {
      try {
        var c = document.createElement('canvas');
        var w = best.naturalWidth || 96, h = best.naturalHeight || 96;
        var s = Math.min(1, 192 / Math.max(w, h));
        c.width = Math.round(w * s); c.height = Math.round(h * s);
        c.getContext('2d').drawImage(best, 0, 0, c.width, c.height);
        out.photo = c.toDataURL('image/jpeg', 0.85);
      } catch (e) {
        out.photo = best.currentSrc || best.src;
      }
    }
    var nameEl = document.querySelector('[class*=user-name], [class*=username], [class*=userName], [class*=profile-name], [class*=student-name], [class*=studentName]');
    if (nameEl) {
      var n = (nameEl.innerText || '').trim().split('\n')[0];
      if (n && n.length < 60) out.name = n;
    }
    return out;
  }

  // ---------- login / OTP ----------
  function findOtpInputs() {
    var inputs = visibleInputs();
    var named = inputs.filter(function (el) { return /otp|one.?time|verification|code/.test(attrs(el)); });
    if (named.length) return named;
    var singles = inputs.filter(function (el) { return el.maxLength === 1; });
    if (singles.length >= 4) return singles;
    if (/\botp\b/i.test(pageText())) {
      var nums = inputs.filter(function (el) { return el.type === 'number' || el.type === 'tel' || el.inputMode === 'numeric'; });
      if (nums.length) return nums;
    }
    return [];
  }
  function findUserInput(pwd) {
    var inputs = visibleInputs().filter(function (el) {
      return el !== pwd && /^(text|email|tel|)$/.test(el.type);
    });
    var named = inputs.filter(function (el) { return /user|e-?mail|login|userid|\buid\b/.test(attrs(el)) || el.type === 'email'; });
    if (named.length) return named[0];
    if (!pwd) return null;
    // the text box that comes before the password box
    var before = inputs.filter(function (el) {
      return el.compareDocumentPosition(pwd) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    return before.length ? before[before.length - 1] : null;
  }
  function errorText() {
    var t = pageText();
    var m = t.match(/[^\n]*(invalid|incorrect|wrong|failed|not\s+match|doesn.t\s+exist|locked)[^\n]*/i);
    return m ? m[0].trim().slice(0, 140) : null;
  }
  function submit(near) {
    var form = near && near.form;
    var btn = (form && (form.querySelector('button[type=submit], input[type=submit]') ||
      findButton(/log\s*in|sign\s*in|submit|continue|verify|next|proceed/i, form))) ||
      findButton(/^(log\s*in|login|sign\s*in|submit|continue|verify|next|proceed)/i);
    if (btn) { btn.click(); return; }
    if (form && form.requestSubmit) { form.requestSubmit(); return; }
    if (near) {
      ['keydown', 'keypress', 'keyup'].forEach(function (t) {
        near.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      });
    }
  }

  // ---------- semesters ----------
  var ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
  function semNumber(label) {
    var m = String(label).match(/sem(?:ester)?\s*[-:.]?\s*([ivx]+|\d+)\b/i) || String(label).match(/^\s*([ivx]+|\d+)\s*$/i);
    if (!m) return null;
    var k = m[1].toLowerCase();
    return ROMAN[k] || parseInt(k, 10) || null;
  }
  function isPlaceholder(o) {
    var t = (o.text || '').trim();
    return !t || /^(-+|select|choose|all)\b/i.test(t);
  }
  function findSemSelect() {
    var sels = Array.prototype.filter.call(document.querySelectorAll('select'), function (sel) {
      return sel.options.length > 1;
    });
    var named = sels.filter(function (sel) {
      return /sem|term|year|session|batch/i.test(attrs(sel) + ' ' + Array.prototype.map.call(sel.options, function (o) { return o.text; }).join(' '));
    });
    if (named.length) return named[0];
    var vis = sels.filter(isVisible);
    return vis.length === 1 ? vis[0] : null;
  }
  function signature(cards) {
    return cards.map(function (c) { return (c.innerText || '').split('\n')[0]; }).join('|');
  }
  function pickSelect(sel, value) {
    sel.value = value;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (window.jQuery) { try { window.jQuery(sel).val(value).trigger('change'); } catch (e) {} }
  }
  function readCards() {
    return findCards().map(parseCard).filter(function (x) { return x.name; });
  }
  function finish(all, plan, results) {
    done = true;
    var p = findProfile();
    var payload = { subjects: all, photo: p.photo, name: p.name, semesters: [], current: null };
    if (plan && results) {
      plan.options.forEach(function (o, i) {
        if (results[i] && results[i].length) payload.semesters.push({ label: o.text, number: semNumber(o.text), subjects: results[i] });
      });
      // the semester shown by default, or the highest-numbered one
      var cur = null;
      if (plan.initial != null && results[plan.initial] && results[plan.initial].length) cur = plan.options[plan.initial].text;
      if (!cur && payload.semesters.length) {
        var best = payload.semesters.slice().sort(function (a, b) { return (b.number || 0) - (a.number || 0); })[0];
        cur = (best.number ? best : payload.semesters[payload.semesters.length - 1]).label;
      }
      payload.current = cur;
    }
    post('data', payload);
    snapshot('data');
    try { sessionStorage.removeItem('mit_sem'); } catch (e) {}
  }
  // Walks every semester in the dropdown, one per tick. Progress lives in
  // sessionStorage so it survives the page reloading on each change.
  function semesterWalk(allSubjects) {
    var ss = window.sessionStorage;
    var st = null;
    try { st = JSON.parse(ss.getItem('mit_sem') || 'null'); } catch (e) {}
    if (st && st.attempt !== cfg().attempt) { st = null; ss.removeItem('mit_sem'); }
    var sel = findSemSelect();
    if (!st) {
      if (!sel) { finish(allSubjects, null, null); return; }
      var opts = [];
      var initial = null;
      Array.prototype.forEach.call(sel.options, function (o, i) {
        if (isPlaceholder(o)) return;
        if (i === sel.selectedIndex) initial = opts.length;
        opts.push({ text: o.text.trim(), value: o.value });
      });
      opts = opts.slice(0, 12);
      if (!opts.length) { finish(allSubjects, null, null); return; }
      st = { attempt: cfg().attempt, options: opts, initial: initial, idx: 0, results: {}, firstSig: signature(findCards()), changedAt: 0, lastSig: null, origValue: sel.value };
      post('status', { step: 'reading_semesters', total: opts.length });
    }
    if (!sel) { finish(allSubjects, st, st.results); return; }
    var o = st.options[st.idx];
    if (!st.changedAt) {
      st.lastSig = signature(findCards());
      st.changedAt = Date.now();
      ss.setItem('mit_sem', JSON.stringify(st));
      post('status', { step: 'reading_semesters', index: st.idx + 1, total: st.options.length, label: o.text });
      pickSelect(sel, o.value);
      return;
    }
    var cards = findCards();
    var sig = signature(cards);
    var waited = Date.now() - st.changedAt;
    var changed = sig !== st.lastSig;
    // read once the cards have changed and had a moment to settle, or after 7s
    if ((changed && waited > 1500) || waited > 7000 || (st.idx === 0 && st.lastSig === sig && waited > 3500)) {
      st.results[st.idx] = cards.length ? readCards() : [];
      st.idx++;
      st.changedAt = 0;
      if (st.idx >= st.options.length) {
        ss.setItem('mit_sem', JSON.stringify(st));
        finish(allSubjects, st, st.results);
        return;
      }
      ss.setItem('mit_sem', JSON.stringify(st));
    }
  }

  // ---------- main loop ----------
  var lastSnap = 0;
  function tick() {
    if (done) return;
    if (Date.now() - lastSnap > 5000) { lastSnap = Date.now(); snapshot('progress'); }
    // Login form inside an iframe → open the iframe page directly.
    if (!visibleInputs().length) {
      var fr = Array.prototype.filter.call(document.querySelectorAll('iframe'), isVisible)
        .filter(function (f) { return /^https:/.test(f.src) && /log|sign|auth|sso/i.test(f.src); })[0];
      if (fr && !window.__mitFrameJump) { window.__mitFrameJump = true; location.href = fr.src; return; }
    }
    var c = cfg();
    var ss = window.sessionStorage;

    // 1. Attendance cards on screen → read them, semester by semester.
    var walking = false;
    try { walking = (JSON.parse(ss.getItem('mit_sem') || 'null') || {}).attempt === c.attempt; } catch (e) {}
    var cards = findCards();
    if (cards.length || walking) {
      if (!window.__mitAll) window.__mitAll = readCards();
      semesterWalk(window.__mitAll);
      if (!done) startedAt = Date.now();
      return;
    }

    var cap = Array.prototype.some.call(document.querySelectorAll('input, img, canvas'), function (el) {
      return isVisible(el) && /captcha/i.test(attrs(el) + ' ' + (el.src || '') + ' ' + (el.className || ''));
    });
    if (cap) {
      done = true; post('manual_needed', { reason: 'captcha' }); snapshot('captcha'); return;
    }

    // 2. OTP step.
    var otp = findOtpInputs();
    var pwd = Array.prototype.filter.call(document.querySelectorAll('input[type=password]'), isVisible)[0];
    if (otp.length && !pwd) {
      if (!c.otp) {
        if (!otpAnnounced) { otpAnnounced = true; post('otp_required', {}); snapshot('otp'); }
        return;
      }
      var key = 'mit_otp_' + c.otp;
      var sent = +(ss.getItem(key) || 0);
      if (!sent) {
        if (otp.length === 1) setValue(otp[0], c.otp);
        else otp.forEach(function (el, i) { setValue(el, c.otp.charAt(i) || ''); });
        ss.setItem(key, String(Date.now()));
        setTimeout(function () { submit(otp[0]); }, 250);
      } else if (Date.now() - sent > 7000) {
        done = true; post('otp_failed', { message: errorText() });
      }
      return;
    }

    // 3. Password login.
    if (pwd) {
      if (!c.password) { done = true; post('need_login', {}); return; }
      var subKey = 'mit_sub_' + c.attempt;
      var at = +(ss.getItem(subKey) || 0);
      if (!at) {
        var user = findUserInput(pwd);
        if (user && c.email) setValue(user, c.email);
        setValue(pwd, c.password);
        ss.setItem(subKey, String(Date.now()));
        post('status', { step: 'logging_in' });
        setTimeout(function () { submit(pwd); }, 300);
      } else if (Date.now() - at > 6000) {
        done = true; post('login_failed', { message: errorText() }); snapshot('login_failed');
      }
      return;
    }

    // 3b. Email-first login page (password on the next step).
    var lone = findUserInput(null);
    if (lone && !otp.length && /log\s*in|sign\s*in/i.test(pageText()) && c.email) {
      var ek = 'mit_email_' + c.attempt;
      if (!ss.getItem(ek)) {
        setValue(lone, c.email);
        ss.setItem(ek, '1');
        setTimeout(function () { submit(lone); }, 300);
      }
      return;
    }

    // 4. Logged in but attendance not on screen → open it.
    if (Date.now() - lastAttendanceClick > 5000 && attendanceClicks < 4) {
      var links = document.querySelectorAll('a, button, li, span, div[role=menuitem], [routerlink], mat-list-item');
      for (var i = 0; i < links.length; i++) {
        var t = (links[i].innerText || '').trim();
        if (t && t.length < 30 && /attendance/i.test(t) && links[i].children.length < 4) {
          lastAttendanceClick = Date.now();
          attendanceClicks++;
          post('status', { step: 'opening_attendance' });
          links[i].click();
          return;
        }
      }
    }

    // 5. Give up after a while.
    if (Date.now() - startedAt > 45000) {
      done = true;
      post('timeout', { url: location.href });
      snapshot('timeout');
    }
  }

  window.__mitAgent = {
    kick: function () { startedAt = Date.now(); done = false; otpAnnounced = false; tick(); }
  };
  timer = setInterval(tick, 800);
  tick();
})();
