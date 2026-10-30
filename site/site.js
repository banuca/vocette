/*
 * Vocette website: the theme switch, the dictation demo, the pricing switch,
 * the step marker in How it works, and the light on the bento tiles.
 * No requests and no cookies. The only thing stored is the visitor's theme,
 * in their own browser, and only after they press the theme button.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Theme ----------------------------------------------------------------- */

  var themeBtn = document.getElementById('theme');
  function currentTheme() {
    return root.getAttribute('data-theme') || (mqDark.matches ? 'dark' : 'light');
  }
  function labelTheme() {
    themeBtn.setAttribute('aria-label', currentTheme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }
  if (themeBtn) {
    themeBtn.hidden = false;
    labelTheme();
    themeBtn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('vocette-theme', next); } catch (e) {}
      labelTheme();
    });
    mqDark.addEventListener('change', labelTheme);
  }

  /* Headline words, for the load sequence -------------------------------- */

  var h1 = document.getElementById('hero-title');
  if (h1) {
    h1.innerHTML = h1.textContent.trim().split(/\s+/).map(function (w, i) {
      return '<span class="w" style="--i:' + i + '">' + w + '</span>';
    }).join(' ');
  }

  /* Bento light that follows the pointer --------------------------------- */

  document.querySelectorAll('.tile').forEach(function (t) {
    t.addEventListener('pointermove', function (e) {
      var r = t.getBoundingClientRect();
      t.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      t.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  /* Pricing switch: prices as in README.md and src/shared/product.ts ------ */

  var billing = document.getElementById('billing');
  if (billing) {
    var amount = document.getElementById('pro-amount');
    var per = document.getElementById('pro-per');
    var note = document.getElementById('pro-note');
    var tag = document.getElementById('pro-tag');
    var PLANS = {
      yearly: { amount: 'US$99', per: 'a year', note: 'Or US$9.99 a month.', tag: 'Saves a little over two months' },
      monthly: { amount: 'US$9.99', per: 'a month', note: 'Or US$99 a year, which saves a little over two months.', tag: '' }
    };
    billing.classList.add('ready');
    billing.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || billing.dataset.plan === b.dataset.plan) return;
      var p = PLANS[b.dataset.plan];
      billing.dataset.plan = b.dataset.plan;
      billing.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      amount.textContent = p.amount;
      per.textContent = p.per;
      note.textContent = p.note;
      tag.textContent = p.tag;
      tag.hidden = !p.tag;
      amount.classList.remove('swap'); void amount.offsetWidth; amount.classList.add('swap');
    });
  }

  /* How it works: mark the step in view ---------------------------------- */

  var dots = document.querySelectorAll('.step-dots li');
  if (dots.length && 'IntersectionObserver' in window) {
    var stepObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var n = Number(en.target.dataset.step);
        dots.forEach(function (d, i) { d.classList.toggle('on', i === n); });
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    document.querySelectorAll('.step').forEach(function (s) { stepObs.observe(s); });
  }

  /* The dictation demo ---------------------------------------------------- */

  var stage = document.getElementById('stage');
  if (!stage) return;

  var ICONS = {
    doc: '<svg class="ico" viewBox="0 0 24 24"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
    mail: '<svg class="ico" viewBox="0 0 24 24"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
    chat: '<svg class="ico" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
  };

  /*
   * Words in [brackets] are what clean-up removes. Only the English scene has
   * any: removing fillers and following spoken corrections work in English
   * only (README, Limits), so the German and French scenes are typed as said.
   */
  var SCENES = [
    {
      app: 'the document', icon: 'doc', title: 'Supply agreement (DE) — Document', lang: 'de',
      body: '<div class="doc bi"><p class="doc-h">Article 12</p><p class="src-p"><span class="lang">EN</span>This agreement enters into force on the date of signature.</p><p><span class="lang">DE</span><span class="typed" lang="de"></span><span class="caret"></span></p></div>',
      said: 'Dieser Vertrag tritt am Tag der Unterzeichnung in Kraft.',
      wrote: 'Dieser Vertrag tritt am Tag der Unterzeichnung in Kraft.'
    },
    {
      app: 'Mail', icon: 'mail', title: 'New message', lang: 'en',
      body: '<div class="field"><span>To</span><b>Claire Martin</b></div><div class="field"><span>Subject</span><b>Signing appointment</b></div><div class="doc"><p>Dear Ms Martin,</p><p><span class="typed" lang="en"></span><span class="caret"></span></p></div>',
      said: '[Um,] could we move the signing to [Tuesday,] [no] [sorry,] Wednesday?',
      wrote: 'Could we move the signing to Wednesday?'
    },
    {
      app: 'Chat', icon: 'chat', title: 'Translation team', lang: 'fr',
      body: '<div class="chat"><div class="bubble" lang="fr"><span class="who">Camille</span>Tu peux relire la traduction demain ?</div><div class="compose"><span class="typed" lang="fr"></span><span class="caret"></span><span class="ph">Message Translation team</span></div></div>',
      said: 'Oui, je te la renvoie avant midi.',
      wrote: 'Oui, je te la renvoie avant midi.'
    }
  ];

  var winBody = document.getElementById('win-body');
  var winTitle = document.getElementById('win-title');
  var winIcon = document.getElementById('win-icon');
  var heard = document.getElementById('heard');
  var keys = document.getElementById('keys');
  var msg = document.getElementById('msg');
  var detail = document.getElementById('detail');
  var timer = document.getElementById('timer');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var waves = Array.prototype.slice.call(stage.querySelectorAll('.wave i'));
  var pauseBtn = document.getElementById('pause');

  var idx = 0;
  var timers = [];
  var barTimer = null;
  var clockTimer = null;
  var paused = false;
  var onScreen = true;

  function reduced() { return mqReduce.matches; }
  function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function clearAll() {
    timers.forEach(clearTimeout);
    timers = [];
    clearInterval(barTimer);
    clearInterval(clockTimer);
    barTimer = clockTimer = null;
  }
  function tokens(said) {
    return said.split(' ').map(function (w) {
      var f = /^\[.*\]$/.test(w);
      return { w: f ? w.slice(1, -1) : w, f: f };
    });
  }
  function setState(s) {
    stage.dataset.state = s;
    if (s === 'rec') { msg.textContent = 'Listening…'; detail.textContent = 'Release Left Ctrl + Left Shift to finish'; }
    if (s === 'proc') { msg.textContent = 'Writing…'; detail.textContent = 'On this PC'; }
    if (s === 'ok') { msg.textContent = 'Pasted'; detail.textContent = 'Into ' + SCENES[idx].app; }
  }
  function settleBars() { waves.forEach(function (b) { b.style.transform = ''; }); }
  function startBars() {
    var t0 = performance.now();
    barTimer = setInterval(function () {
      var t = (performance.now() - t0) / 1000;
      var env = 0.45 + 0.55 * Math.abs(Math.sin(t * 3.1)) * (0.6 + 0.4 * Math.sin(t * 7.3));
      waves.forEach(function (b, i) {
        var v = Math.max(0.18, Math.min(1, env * (0.45 + Math.random() * 0.75) * (1 - Math.abs((i % 5) - 2) * 0.12)));
        b.style.transform = 'scaleY(' + v.toFixed(2) + ')';
      });
    }, 110);
  }
  function startClock() {
    var s = 0;
    timer.textContent = '0:00';
    clockTimer = setInterval(function () { s += 1; timer.textContent = '0:0' + s; }, 1000);
  }
  function fillTyped(text) {
    var el = winBody.querySelector('.typed');
    el.innerHTML = text.split(' ').map(function (w, i) {
      return '<span class="tw" style="--i:' + i + '">' + w + '</span>';
    }).join(' ');
    var c = el.closest('.compose');
    if (c) c.classList.add('has');
  }
  function addHeard(tok, k) {
    if (heard.childNodes.length > 1) heard.appendChild(document.createTextNode(' '));
    var s = document.createElement('span');
    s.className = 'hw' + (tok.f ? ' f' : '');
    if (tok.f) s.style.setProperty('--k', k);
    s.textContent = tok.w;
    heard.appendChild(s);
  }
  function selectTab(i, dur) {
    tabs.forEach(function (t, j) {
      t.setAttribute('aria-selected', String(j === i));
      t.classList.remove('run');
    });
    if (dur) {
      void tabs[i].offsetWidth;
      tabs[i].style.setProperty('--dur', dur + 'ms');
      tabs[i].classList.add('run');
    }
  }
  function render(i) {
    idx = i;
    var sc = SCENES[i];
    winIcon.innerHTML = ICONS[sc.icon];
    winTitle.textContent = sc.title;
    winBody.innerHTML = sc.body;
    winBody.classList.remove('swap'); void winBody.offsetWidth; winBody.classList.add('swap');
    heard.setAttribute('lang', sc.lang);
    heard.innerHTML = '<span class="lbl" lang="en-GB">You say</span>';
    heard.classList.remove('cleaned');
    keys.classList.remove('down');
    settleBars();
    timer.textContent = '0:00';
    setState('rest');
  }
  /* The finished scene, for reduced motion, pause and tab picks while still. */
  function still(i) {
    clearAll();
    render(i);
    var k = 0;
    tokens(SCENES[i].said).forEach(function (t) { addHeard(t, t.f ? k++ : 0); });
    heard.classList.add('cleaned');
    fillTyped(SCENES[i].wrote);
    timer.textContent = '0:04';
    setState('ok');
    selectTab(i, 0);
  }
  function play(i) {
    clearAll();
    render(i);
    var sc = SCENES[i];
    var t = 700;
    var k = 0;
    at(t, function () { keys.classList.add('down'); setState('rec'); startBars(); startClock(); });
    t += 380;
    tokens(sc.said).forEach(function (tok) {
      var kk = tok.f ? k++ : 0;
      at(t, function () { addHeard(tok, kk); });
      t += tok.f ? 190 : 230;
    });
    t += 450;
    at(t, function () {
      keys.classList.remove('down');
      clearInterval(barTimer);
      clearInterval(clockTimer);
      settleBars();
      setState('proc');
      heard.classList.add('cleaned');
    });
    t += 1000;
    at(t, function () { fillTyped(sc.wrote); setState('ok'); });
    t += 1500;
    at(t, function () { setState('rest'); });
    t += 2300;
    at(t, function () { play((i + 1) % SCENES.length); });
    selectTab(i, t);
  }
  function restart() {
    if (reduced() || paused || !onScreen || document.hidden) still(idx);
    else play(idx);
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () { idx = Number(tab.dataset.i); restart(); });
  });
  if (pauseBtn) {
    pauseBtn.hidden = false;
    pauseBtn.addEventListener('click', function () {
      paused = !paused;
      pauseBtn.setAttribute('aria-pressed', String(paused));
      pauseBtn.setAttribute('aria-label', paused ? 'Play the demo' : 'Pause the demo');
      restart();
    });
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      var vis = entries[0].isIntersecting;
      if (vis === onScreen) return;
      onScreen = vis;
      if (reduced() || paused) return;
      if (vis) play(idx); else clearAll();
    }, { threshold: 0.15 }).observe(stage);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) clearAll(); else restart();
  });
  mqReduce.addEventListener('change', restart);

  restart();
})();
