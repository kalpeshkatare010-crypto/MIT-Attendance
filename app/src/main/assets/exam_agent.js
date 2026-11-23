/*
 * MIT Attendance – exam portal agent (mitaexamcell.in).
 * Logs in with the PRN (also the password), opens the results page and reads
 * subject grades, SGPA and CGPA, semester by semester. Reports to window.MITExam.
 */
(function () {
  if (window.__examAgent) { window.__examAgent.kick(); return; }
  function post(type, obj) { try { window.MITExam.post(type, obj == null ? '' : JSON.stringify(obj)); } catch (e) {} }
  function cfg() { return window.__EXAM_CFG || {}; }
  var ss = window.sessionStorage;
  var startedAt = Date.now(), done = false, lastSnap = 0, clicks = 0, lastClick = 0;

  // ---------- helpers ----------
  function isVisible(el) {
    if (!el) return false;
    var s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function attrs(el) { return [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.className].join(' ').toLowerCase(); }
  function txt(el) { return ((el && (el.innerText || el.value || el.textContent)) || '').replace(/\s+/g, ' ').trim(); }
  function pageText() { return (document.body && document.body.innerText) || ''; }
  function setValue(el, v) {
    el.focus();
    var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (d && d.set) d.set.call(el, v); else el.value = v;
    ['input', 'change', 'keyup'].forEach(function (t) { el.dispatchEvent(new Event(t, { bubbles: true })); });
    el.blur();
  }
  function visibleInputs() {
    return Array.prototype.filter.call(document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=image])'), isVisible);
  }
  function clickables() { return Array.prototype.filter.call(document.querySelectorAll('a, button, input[type=submit], input[type=button], input[type=image], [onclick], li, span'), isVisible); }
  function findClickable(re, maxLen) {
    var list = clickables();
    for (var i = 0; i < list.length; i++) {
      var t = txt(list[i]) || list[i].getAttribute('alt') || list[i].getAttribute('title') || '';
      if (t.length <= (maxLen || 40) && re.test(t)) return list[i];
    }
    return null;
  }
  function snapshot(reason) {
    post('debug', {
      reason: reason, url: location.href, title: document.title,
      inputs: visibleInputs().map(function (el) { return { type: el.type, name: el.name, id: el.id, placeholder: el.placeholder }; }),
      buttons: clickables().map(txt).filter(function (t) { return t && t.length < 50; }).slice(0, 60),
      selects: Array.prototype.map.call(document.querySelectorAll('select'), function (s) {
        return { name: s.name, id: s.id, options: Array.prototype.map.call(s.options, function (o) { return o.text.trim() + ' = ' + o.value; }).slice(0, 25) };
      }),
      tables: Array.prototype.slice.call(document.querySelectorAll('table'), 0, 6).map(function (t) { return txt(t).slice(0, 600); }),
      text: pageText().slice(0, 3500)
    });
  }

  // ---------- results parsing ----------
  var SEM_RE = /sem(?:ester)?\s*[-:.]?\s*([ivx]+|\d+)\b/i;
  function rowsOf(table) {
    return Array.prototype.map.call(table.rows, function (r) {
      return Array.prototype.map.call(r.cells, function (c) { return txt(c); });
    });
  }
  function colIndex(head, re, avoid) {
    for (var i = 0; i < head.length; i++) if (re.test(head[i]) && !(avoid && avoid.test(head[i]))) return i;
    return -1;
  }
  function parseTable(table) {
    var rows = rowsOf(table);
    for (var h = 0; h < Math.min(rows.length, 6); h++) {
      var head = rows[h];
      var name = colIndex(head, /course|subject|paper|title/i, /code/i);
      var code = colIndex(head, /code/i);
      var grade = colIndex(head, /^grade$|grade\s*obt|^grd/i);
      if (grade < 0) grade = colIndex(head, /grade/i, /point|gp/i);
      var marks = colIndex(head, /total|marks|obtained|score/i);
      if (name < 0 && code < 0) continue;
      if (grade < 0 && marks < 0) continue;
      var credits = colIndex(head, /credit/i, /point/i);
      var gp = colIndex(head, /grade\s*point|^gp$/i);
      var result = colIndex(head, /result|status|remark/i);
      var subjects = [];
      for (var r = h + 1; r < rows.length; r++) {
        var row = rows[r];
        if (row.length < Math.max(2, head.length - 2)) continue;
        var nm = name >= 0 ? row[name] : '';
        var cd = code >= 0 ? row[code] : '';
        if (!nm && !cd) continue;
        if (/^(total|sgpa|cgpa|result)/i.test(nm || cd)) continue;
        subjects.push({
          code: cd || null, name: nm || cd,
          credits: credits >= 0 ? (parseFloat(row[credits]) || null) : null,
          grade: grade >= 0 ? row[grade] || null : null,
          gradePoint: gp >= 0 && !isNaN(parseFloat(row[gp])) ? parseFloat(row[gp]) : null,
          marks: marks >= 0 ? row[marks] || null : null,
          result: result >= 0 ? row[result] || null : null
        });
      }
      if (subjects.length) return subjects;
    }
    return null;
  }
  function numAfter(re, text) { var m = text.match(re); return m ? parseFloat(m[1]) : null; }
  function labelNear(el) {
    // look at the table's caption and the text just before it
    var cap = el.caption ? txt(el.caption) : '';
    if (SEM_RE.test(cap)) return cap.match(SEM_RE)[0];
    var p = el, hops = 0;
    while (p && hops < 6) {
      var prev = p.previousElementSibling;
      while (prev && hops < 6) {
        var t = txt(prev);
        if (SEM_RE.test(t)) return t.match(SEM_RE)[0];
        prev = prev.previousElementSibling; hops++;
      }
      p = p.parentElement; hops++;
    }
    return null;
  }
  function prettySem(raw) {
    var m = String(raw || '').match(SEM_RE);
    return m ? 'Semester ' + m[1].toUpperCase() : (raw || 'Result');
  }
  function readResults() {
    var tables = Array.prototype.filter.call(document.querySelectorAll('table'), function (t) {
      return !t.querySelector('table'); // innermost tables only
    });
    var groups = [];
    tables.forEach(function (t) {
      var subs = parseTable(t);
      if (!subs) return;
      var box = t.parentElement && t.parentElement.parentElement ? t.parentElement.parentElement : t;
      var near = txt(box);
      groups.push({
        label: labelNear(t), subjects: subs,
        sgpa: numAfter(/SGPA\s*[:=\-]?\s*([\d.]+)/i, near),
        cgpa: numAfter(/CGPA\s*[:=\-]?\s*([\d.]+)/i, near),
        result: (near.match(/result\s*[:\-]\s*([A-Za-z ]{3,20})/i) || [])[1] || null
      });
    });
    var all = pageText();
    if (groups.length === 1) {
      var g = groups[0];
      if (g.sgpa == null) g.sgpa = numAfter(/SGPA\s*[:=\-]?\s*([\d.]+)/i, all);
      if (g.cgpa == null) g.cgpa = numAfter(/CGPA\s*[:=\-]?\s*([\d.]+)/i, all);
      if (!g.label) { var m = all.match(SEM_RE); if (m) g.label = m[0]; }
    }
    return groups;
  }
  function signature() {
    var t = pageText();
    return (t.match(/SGPA[^\n]{0,20}/i) || [''])[0] + '|' + Array.prototype.slice.call(document.querySelectorAll('table'), 0, 4).map(function (x) { return txt(x).slice(0, 120); }).join('|');
  }
  function looksLikeResults() {
    return /sgpa|cgpa|grade/i.test(pageText()) && readResults().length > 0;
  }
  function semSelect() {
    var sels = Array.prototype.filter.call(document.querySelectorAll('select'), function (s) { return s.options.length > 1 && isVisible(s); });
    return sels.filter(function (s) {
      return /sem|exam|session|month/i.test(attrs(s) + ' ' + Array.prototype.map.call(s.options, function (o) { return o.text; }).join(' '));
    })[0] || null;
  }
  function placeholder(o) { var t = (o.text || '').trim(); return !t || /^(-+|select|choose|all)\b/i.test(t); }

  function finish(groups) {
    if (!groups.length || !groups.some(function (g) { return g.subjects && g.subjects.length; })) {
      // nothing readable here: keep looking for the results page
      try { ss.removeItem('exam_sem'); } catch (e) {}
      window.__examNoWalk = true;
      return;
    }
    done = true;
    // merge by label, newest semester first
    var ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };
    var out = [];
    groups.forEach(function (g) {
      var label = prettySem(g.label);
      var m = label.match(/Semester\s+([IVX]+|\d+)/);
      var n = m ? (ROMAN[m[1].toLowerCase()] || parseInt(m[1], 10) || 0) : 0;
      var dup = out.filter(function (x) { return x.label === label; })[0];
      if (dup) { if (!dup.subjects.length) dup.subjects = g.subjects; return; }
      out.push({ label: label, number: n, sgpa: g.sgpa, cgpa: g.cgpa, result: g.result, subjects: g.subjects });
    });
    out.sort(function (a, b) { return b.number - a.number; });
    var cg = null;
    out.forEach(function (x) { if (cg == null && x.cgpa != null) cg = x.cgpa; });
    post('exam_data', { semesters: out, cgpa: cg });
    snapshot('data');
    try { ss.removeItem('exam_sem'); } catch (e) {}
  }

  function walk() {
    var st = null;
    try { st = JSON.parse(ss.getItem('exam_sem') || 'null'); } catch (e) {}
    if (st && st.attempt !== cfg().attempt) st = null;
    var sel = semSelect();
    if (!st) {
      if (!sel) { finish(readResults()); return; }
      var opts = Array.prototype.filter.call(sel.options, function (o) { return !placeholder(o); })
        .map(function (o) { return { text: o.text.trim(), value: o.value }; }).slice(0, 12);
      st = { attempt: cfg().attempt, options: opts, idx: 0, results: [], changedAt: 0, lastSig: '', pressed: false };
    }
    if (!sel || st.idx >= st.options.length) { finish(st.results); return; }
    var o = st.options[st.idx];
    if (!st.changedAt) {
      st.lastSig = signature(); st.changedAt = Date.now(); st.pressed = false;
      ss.setItem('exam_sem', JSON.stringify(st));
      post('status', { step: 'reading_results', index: st.idx + 1, total: st.options.length, label: o.text });
      sel.value = o.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    var waited = Date.now() - st.changedAt;
    var sig = signature();
    if (!st.pressed && waited > 1500 && sig === st.lastSig) {
      var b = findClickable(/^(show|view|submit|search|get|go|display)/i, 20);
      st.pressed = true; ss.setItem('exam_sem', JSON.stringify(st));
      if (b) { b.click(); return; }
    }
    if ((sig !== st.lastSig && waited > 1200) || waited > 8000) {
      readResults().forEach(function (g) { if (!g.label) g.label = o.text; st.results.push(g); });
      st.idx++; st.changedAt = 0;
      ss.setItem('exam_sem', JSON.stringify(st));
      if (st.idx >= st.options.length) finish(st.results);
    }
  }

  // ---------- main loop ----------
  function tick() {
    if (done) return;
    var c = cfg();
    if (Date.now() - lastSnap > 5000) { lastSnap = Date.now(); snapshot('progress'); }

    var walking = false;
    try { walking = (JSON.parse(ss.getItem('exam_sem') || 'null') || {}).attempt === c.attempt; } catch (e) {}
    var pwdHere = Array.prototype.some.call(document.querySelectorAll('input[type=password]'), isVisible);
    var resultsPage = !window.__examNoWalk && !pwdHere && semSelect();
    if (walking || resultsPage || (!window.__examNoWalk && looksLikeResults())) { walk(); startedAt = Date.now(); return; }

    var pwd = Array.prototype.filter.call(document.querySelectorAll('input[type=password]'), isVisible)[0];
    var cap = Array.prototype.some.call(document.querySelectorAll('input, img'), function (el) {
      return isVisible(el) && /captcha/i.test(attrs(el) + ' ' + (el.src || ''));
    });

    // Pick "Student Login" first if the page offers it.
    var studentKey = 'exam_student_' + c.attempt;
    if (!ss.getItem(studentKey)) {
      var stu = findClickable(/^student\s*login$/i, 20);
      if (stu) { ss.setItem(studentKey, '1'); stu.click(); return; }
    }

    if (pwd) {
      if (cap) { done = true; post('exam_manual', { reason: 'captcha' }); snapshot('captcha'); return; }
      var key = 'exam_sub_' + c.attempt;
      var at = +(ss.getItem(key) || 0);
      if (!at) {
        var user = visibleInputs().filter(function (el) { return el !== pwd && /^(text|tel|number|email|)$/.test(el.type); })[0];
        if (user) setValue(user, c.prn);
        setValue(pwd, c.prn);
        ss.setItem(key, String(Date.now()));
        post('status', { step: 'exam_logging_in' });
        setTimeout(function () {
          var b = (pwd.form && pwd.form.querySelector('input[type=submit], button[type=submit], input[type=image]')) ||
            findClickable(/^(log\s*in|login|sign\s*in|submit|go)$/i, 20);
          if (b) b.click(); else if (pwd.form) pwd.form.submit();
        }, 300);
      } else if (Date.now() - at > 7000) {
        done = true;
        var m = pageText().match(/[^\n]*(invalid|incorrect|wrong|not\s+found|failed)[^\n]*/i);
        post('exam_login_failed', { message: m ? m[0].trim().slice(0, 140) : null });
        snapshot('login_failed');
      }
      return;
    }

    // Logged in → open the results page.
    if (Date.now() - lastClick > 4000 && clicks < 5) {
      var list = clickables().filter(function (el) {
        var t = txt(el);
        return t && t.length < 40 && /result|grade\s*card|mark\s*sheet|marksheet|statement\s+of\s+marks/i.test(t);
      });
      // prefer real links
      list.sort(function (a, b) { return (b.tagName === 'A' ? 1 : 0) - (a.tagName === 'A' ? 1 : 0); });
      if (list.length) {
        var el = list[clicks % list.length];
        clicks++; lastClick = Date.now();
        post('status', { step: 'exam_opening_results' });
        el.click();
        return;
      }
    }

    if (Date.now() - startedAt > 45000) {
      done = true;
      post('exam_timeout', { url: location.href });
      snapshot('timeout');
    }
  }

  window.__examAgent = { kick: function () { startedAt = Date.now(); done = false; tick(); } };
  setInterval(tick, 800);
  tick();
})();
