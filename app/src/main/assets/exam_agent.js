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
      links: allLinks(),
      tables: Array.prototype.slice.call(document.querySelectorAll('table'), 0, 6).map(function (t) { return txt(t).slice(0, 600); }),
      text: pageText().slice(0, 3500)
    });
  }

  function studentLink() {
    var anchors = document.querySelectorAll('a, area, input[type=button], input[type=submit], button');
    for (var i = 0; i < anchors.length; i++) {
      var el = anchors[i];
      var t = ((el.innerText || el.textContent || el.value || '') + ' ' + (el.getAttribute('alt') || '') + ' ' + (el.getAttribute('title') || '')).replace(/\s+/g, ' ').trim();
      var href = el.getAttribute('href') || '';
      if ((t.length < 30 && /student\s*login/i.test(t)) || /lnkStudent|student.*log/i.test(href)) return el;
    }
    return null;
  }
  function allLinks() {
    return Array.prototype.map.call(document.querySelectorAll('a[href], area[href]'), function (a) {
      return ((a.innerText || a.textContent || a.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 30)) + ' -> ' + a.getAttribute('href');
    }).slice(0, 40);
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
      var name = colIndex(head, /course|subject|paper/i, /code/i);
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

  // ---------- final internal marks ----------
  function readInternal() {
    var tables = Array.prototype.filter.call(document.querySelectorAll('table'), function (t) { return !t.querySelector('table'); });
    var groups = [];
    tables.forEach(function (t) {
      var rows = rowsOf(t);
      for (var h = 0; h < Math.min(rows.length, 6); h++) {
        var head = rows[h];
        if (head.length < 3) continue;
        var subj = colIndex(head, /course|subject|paper|code/i);
        if (subj < 0) continue;
        // must look like marks: a marks-type column, and mostly short numeric cells
        if (!head.some(function (x) { return /marks|total|ca\s*\d|test|internal|assign|out\s*of|max|ise|mse|tw|obtain|score|unit|practical|oral|attend/i.test(x); })) continue;
        if (head.some(function (x) { return /notice|description|message|subject\s*line|date/i.test(x) && !/marks/i.test(x); }) && !head.some(function (x) { return /marks|total/i.test(x); })) continue;
        var body = rows.slice(h + 1).filter(function (r) {
          if (r.length < head.length - 1 || !r.join('').trim()) return false;
          var nums = r.filter(function (c) { return /^\s*(\d{1,3}(\.\d+)?|ab|a|-)\s*$/i.test(c); }).length;
          return nums >= 2 && r.every(function (c) { return c.length < 90; });
        });
        if (!body.length) continue;
        groups.push({ label: labelNear(t), headers: head, rows: body.slice(0, 40) });
        break;
      }
    });
    return groups;
  }

  // ---------- phases: results, then final internal marks ----------
  function phase() {
    var p = null;
    try { p = JSON.parse(ss.getItem('exam_phase') || 'null'); } catch (e) {}
    if (!p || p.attempt !== cfg().attempt) p = { attempt: cfg().attempt, phase: 'results', results: [], internal: [], at: Date.now() };
    return p;
  }
  function savePhase(p) { ss.setItem('exam_phase', JSON.stringify(p)); }

  var ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };
  function semNum(label) {
    var m = String(label || '').match(/Semester\s+([IVX]+|\d+)/);
    return m ? (ROMAN[m[1].toLowerCase()] || parseInt(m[1], 10) || 0) : 0;
  }
  function publish(p) {
    done = true;
    var out = [];
    p.results.forEach(function (g) {
      var label = prettySem(g.label);
      var dup = out.filter(function (x) { return x.label === label; })[0];
      if (dup) { if (!dup.subjects.length) dup.subjects = g.subjects; return; }
      out.push({ label: label, number: semNum(label), sgpa: g.sgpa, cgpa: g.cgpa, result: g.result, subjects: g.subjects });
    });
    out.sort(function (a, b) { return b.number - a.number; });
    var cg = null;
    out.forEach(function (x) { if (cg == null && x.cgpa != null) cg = x.cgpa; });
    var internal = [];
    p.internal.forEach(function (g) {
      var label = prettySem(g.label);
      if (internal.some(function (x) { return x.label === label; })) return;
      internal.push({ label: label, number: semNum(label), headers: g.headers, rows: g.rows });
    });
    internal.sort(function (a, b) { return b.number - a.number; });
    if (!out.length && !internal.length) { post('exam_timeout', { url: location.href }); snapshot('nothing_read'); }
    else post('exam_data', { semesters: out, cgpa: cg, internal: internal });
    snapshot('data');
    try { ss.removeItem('exam_sem'); ss.removeItem('exam_phase'); } catch (e) {}
  }
  // Called when a walk ends on the current page.
  function finish(groups, mode) {
    var p = phase();
    var useful = groups.filter(function (g) { return (g.subjects && g.subjects.length) || (g.rows && g.rows.length); });
    try { ss.removeItem('exam_sem'); } catch (e) {}
    if (!useful.length) { window.__examNoWalk = true; return; }   // not the right page; keep looking
    if (mode === 'internal') { p.internal = useful; publish(p); return; }
    p.results = useful; p.phase = 'internal'; p.at = Date.now(); p.resultsUrl = location.href;
    savePhase(p);
    window.__examNoWalk = true;
    post('status', { step: 'exam_opening_internal' });
  }

  function walk(mode) {
    var reader = mode === 'internal' ? readInternal : readResults;
    var st = null;
    try { st = JSON.parse(ss.getItem('exam_sem') || 'null'); } catch (e) {}
    if (st && (st.attempt !== cfg().attempt || st.mode !== mode)) st = null;
    var sel = semSelect();
    if (!st) {
      if (!sel) { finish(reader(), mode); return; }
      var opts = Array.prototype.filter.call(sel.options, function (o) { return !placeholder(o); })
        .map(function (o) { return { text: o.text.trim(), value: o.value }; }).slice(0, 12);
      st = { attempt: cfg().attempt, mode: mode, options: opts, idx: 0, results: [], changedAt: 0, lastSig: '', pressed: false };
    }
    if (!sel || st.idx >= st.options.length) { finish(st.results, mode); return; }
    var o = st.options[st.idx];
    if (!st.changedAt) {
      st.lastSig = signature(); st.changedAt = Date.now(); st.pressed = false;
      ss.setItem('exam_sem', JSON.stringify(st));
      post('status', { step: mode === 'internal' ? 'reading_internal' : 'reading_results', index: st.idx + 1, total: st.options.length, label: o.text });
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
      reader().forEach(function (g) { g.label = o.text; st.results.push(g); });
      st.idx++; st.changedAt = 0;
      ss.setItem('exam_sem', JSON.stringify(st));
      if (st.idx >= st.options.length) finish(st.results, mode);
    }
  }

  // A link by its text or address, even inside a closed menu.
  function findLink(re) {
    var els = document.querySelectorAll('a, li, span, td, button, input[type=button], input[type=submit], area');
    var fallback = null;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var t = ((el.innerText || el.textContent || el.value || '') + ' ' + (el.getAttribute('alt') || '')).replace(/\s+/g, ' ').trim();
      if (t.length > 40 || !re.test(t)) continue;
      var a = el.tagName === 'A' ? el : el.closest('a[href]');
      if (a && a.getAttribute('href') && !/^#$/.test(a.getAttribute('href'))) return a;
      if (!fallback) fallback = a || el;
    }
    return fallback;
  }
  function openLink(el) {
    var href = el.getAttribute && el.getAttribute('href') || '';
    var pb = href.match(/__doPostBack\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/);
    if (pb && typeof window.__doPostBack === 'function') { window.__doPostBack(pb[1], pb[2]); return; }
    if (/^javascript:/i.test(href)) {
      try { (0, eval)(decodeURIComponent(href.replace(/^javascript:/i, ''))); return; } catch (e) {}
    }
    if (el.tagName === 'A' && href && !/^#/.test(href)) { location.href = el.href; return; }
    el.click();
  }

  // ---------- main loop ----------
  var RESULT_RE = /^(exam\s*|final\s*|semester\s*|view\s*|my\s*)?results?$|result\s*(view|card)|grade\s*card|mark\s*sheet|marksheet|statement\s+of\s+marks|gradesheet|grade\s*sheet/i;
  var INTERNAL_RE = /final\s*internal|internal\s*marks|internal\s*assessment/i;
  function tick() {
    if (done) return;
    var c = cfg();
    if (Date.now() - lastSnap > 5000) { lastSnap = Date.now(); snapshot('progress'); }
    var p = phase();

    var walking = null;
    try { var w = JSON.parse(ss.getItem('exam_sem') || 'null'); if (w && w.attempt === c.attempt) walking = w.mode; } catch (e) {}
    if (walking) { walk(walking); startedAt = Date.now(); return; }

    var pwd = Array.prototype.filter.call(document.querySelectorAll('input[type=password]'), isVisible)[0];

    if (!pwd && !window.__examNoWalk) {
      if (p.phase === 'results' && (semSelect() || looksLikeResults())) {
        walk('results'); startedAt = Date.now(); return;
      }
      if (p.phase === 'internal' && p.clickedInternal && (semSelect() || readInternal().length)) {
        walk('internal'); startedAt = Date.now(); return;
      }
    }

    var cap = Array.prototype.some.call(document.querySelectorAll('input, img'), function (el) {
      return isVisible(el) && /captcha/i.test(attrs(el) + ' ' + (el.src || ''));
    });

    // "Student Login" can sit in a hover menu, so look at hidden links too.
    var studentKey = 'exam_student_' + c.attempt;
    var tries = +(ss.getItem(studentKey) || 0);
    var lastTry = +(ss.getItem(studentKey + '_at') || 0);
    if (!pwd && tries < 3 && Date.now() - lastTry > 6000 && !ss.getItem('exam_sub_' + c.attempt)) {
      var stu = studentLink();
      if (stu) {
        ss.setItem(studentKey, String(tries + 1));
        ss.setItem(studentKey + '_at', String(Date.now()));
        post('status', { step: 'exam_student_login' });
        openLink(stu);
        return;
      }
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
        p.at = Date.now(); savePhase(p);
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

    // Logged in: open the results page, then the final internal marks page.
    if (Date.now() - lastClick > 4000 && clicks < 6) {
      var target = p.phase === 'internal' ? findLink(INTERNAL_RE) : findLink(RESULT_RE);
      if (target) {
        clicks++; lastClick = Date.now();
        if (p.phase === 'internal') { p.clickedInternal = true; savePhase(p); window.__examNoWalk = false; }
        post('status', { step: p.phase === 'internal' ? 'exam_opening_internal' : 'exam_opening_results' });
        openLink(target);
        return;
      }
    }

    // Move on when a section can't be found.
    var since = Date.now() - (p.at || startedAt);
    if (p.phase === 'results' && since > 15000 && ss.getItem('exam_sub_' + c.attempt)) {
      p.phase = 'internal'; p.at = Date.now(); savePhase(p); clicks = 0; window.__examNoWalk = false; return;
    }
    if (p.phase === 'internal' && since > 15000) { publish(p); return; }

    if (Date.now() - startedAt > 60000) {
      done = true;
      post('exam_timeout', { url: location.href });
      snapshot('timeout');
    }
  }

  window.__examAgent = { kick: function () { startedAt = Date.now(); done = false; tick(); } };
  setInterval(tick, 800);
  tick();
})();
