/* 石見銀山 世界遺産検定 — 画面の流れ
 *  スタート → 第1〜10問（選択 → 確認 → 次へ） → 採点中（約10秒） → 結果
 *
 *  ・回答と受付の状態は localStorage と Cookie の両方に保存する。
 *    どちらか片方が消えても、もう片方から復元する（「すくい取り済み」はどちらかに残っていれば済み扱い）。
 *  ・解き終わった後に開き直すと、結果画面がそのまま出る（やり直しはできない）。
 *  ・テスト用リセット：URL の末尾に ?reset=ooda1128 を付けて開く。
 */
(function () {
  "use strict";

  var QUIZ = window.QUIZ || [];
  var LETTERS = ["A", "B", "C"];
  var KEY = "iwami_kentei_20261128";
  var RESET_VALUE = "ooda1128";
  // 確認期間中は true：結果画面のいちばん下に「もう1回解く」を出す（運営が何回も試すため・2026-11-09 kacky 指示）
  // ⚠️ 本番（11/28）の直前に必ず false にする。false で「もう1回解く」が消え、1回解いたら結果画面のまま
  var RETRY_BUTTON = true;
  var COOKIE_PATH = location.pathname.replace(/[^/]*$/, "") || "/";

  var app = document.getElementById("app");
  var timers = [];

  /* =========================================================
   * 保存（localStorage ＋ Cookie）
   * ======================================================= */
  function blank() {
    return { v: 1, answers: [], done: false, finishedAt: null, scooped: false, scoopedAt: null, sound: true };
  }

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; }
  }

  function readCookie() {
    try {
      var parts = document.cookie ? document.cookie.split("; ") : [];
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p.indexOf(KEY + "=") === 0) return JSON.parse(decodeURIComponent(p.slice(KEY.length + 1)));
      }
    } catch (e) { /* noop */ }
    return null;
  }

  function valid(s) { return s && typeof s === "object" && Array.isArray(s.answers); }

  function load() {
    var a = readLocal(), b = readCookie();
    a = valid(a) ? a : null;
    b = valid(b) ? b : null;
    if (!a && !b) return blank();
    if (!a || !b) return Object.assign(blank(), a || b);
    // 両方ある → 先に進んでいる方を採用し、「済み」はどちらかにあれば済み
    var base = (b.done && !a.done) || (b.answers.length > a.answers.length) ? b : a;
    var s = Object.assign(blank(), base);
    if (a.scooped || b.scooped) {
      s.scooped = true;
      s.scoopedAt = a.scoopedAt || b.scoopedAt || s.scoopedAt;
    }
    return s;
  }

  function save() {
    var json = JSON.stringify(state);
    try { localStorage.setItem(KEY, json); } catch (e) { /* noop */ }
    try {
      document.cookie = KEY + "=" + encodeURIComponent(json) +
        "; max-age=" + 60 * 60 * 24 * 60 + "; path=" + COOKIE_PATH + "; SameSite=Lax" +
        (location.protocol === "https:" ? "; Secure" : "");
    } catch (e) { /* noop */ }
  }

  function wipe() {
    try { localStorage.removeItem(KEY); } catch (e) { /* noop */ }
    document.cookie = KEY + "=; max-age=0; path=" + COOKIE_PATH;
  }

  // テスト用リセット
  (function () {
    var m = location.search.match(/[?&]reset=([^&]+)/);
    if (m && decodeURIComponent(m[1]) === RESET_VALUE) {
      wipe();
      history.replaceState(null, "", location.pathname);
    }
  })();

  var state = load();

  /* =========================================================
   * 音（Web Audio で合成。ファイルは使わない）
   * ======================================================= */
  var Sound = {
    ctx: null,
    unlock: function () {
      try {
        if (!this.ctx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
          // iOS のための無音バッファ
          var buf = this.ctx.createBuffer(1, 1, 22050);
          var src = this.ctx.createBufferSource();
          src.buffer = buf; src.connect(this.ctx.destination); src.start(0);
        }
        if (this.ctx.state === "suspended") this.ctx.resume();
      } catch (e) { /* noop */ }
    },
    ok: function () { return state.sound && this.ctx && this.ctx.state !== "closed"; },
    tone: function (freq, at, dur, type, vol, freqTo) {
      if (!this.ok()) return;
      var c = this.ctx, t = c.currentTime + (at || 0);
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t);
      if (freqTo) o.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    noise: function (at, dur, vol, filterType, filterFreq) {
      if (!this.ok()) return;
      var c = this.ctx, t = c.currentTime + (at || 0);
      var len = Math.max(1, Math.floor(c.sampleRate * dur));
      var buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      var src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
      src.buffer = buf;
      f.type = filterType || "bandpass"; f.frequency.value = filterFreq || 1200;
      g.gain.setValueAtTime(vol || 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(c.destination);
      src.start(t); src.stop(t + dur + 0.02);
    },
    tap: function () { this.tone(720, 0, 0.06, "square", 0.05); },
    open: function () { this.tone(880, 0, 0.08, "sine", 0.12); this.tone(1320, 0.05, 0.1, "sine", 0.08); },
    yes: function () { this.tone(784, 0, 0.1, "triangle", 0.18); this.tone(1175, 0.08, 0.18, "triangle", 0.16); },
    start: function () {
      var n = [523, 659, 784, 1047];
      for (var i = 0; i < n.length; i++) this.tone(n[i], i * 0.08, 0.18, "triangle", 0.16);
    },
    clink: function () { this.tone(2400, 0, 0.12, "triangle", 0.07, 1800); this.noise(0, 0.05, 0.08, "highpass", 4000); },
    bibibi: function () {
      for (var i = 0; i < 7; i++) this.tone(900 + Math.random() * 700, i * 0.05, 0.04, "square", 0.05);
    },
    pi: function () { this.tone(1568, 0, 0.09, "square", 0.06); },
    chime: function () { this.tone(1047, 0, 0.6, "sine", 0.2); this.tone(1568, 0.02, 0.8, "sine", 0.1); },
    drumroll: function (dur) {
      for (var t = 0; t < dur; t += 0.045) this.noise(t, 0.05, 0.05 + 0.18 * (t / dur), "bandpass", 300 + Math.random() * 200);
    },
    count: function (n) { this.tone([523, 659, 784][n - 1] || 784, 0, 0.18, "square", 0.12); },
    don: function () {
      this.tone(110, 0, 0.6, "sine", 0.6, 40);
      this.noise(0, 0.35, 0.35, "lowpass", 900);
      this.noise(0.02, 0.9, 0.12, "highpass", 5000);
    },
    fanfare: function (big) {
      var seq = big
        ? [[523, 0, .14], [523, .14, .14], [523, .28, .14], [659, .42, .5], [587, .92, .14], [659, 1.06, .14], [784, 1.2, .9]]
        : [[523, 0, .12], [659, .12, .12], [784, .24, .12], [1047, .36, .55]];
      for (var i = 0; i < seq.length; i++) {
        this.tone(seq[i][0], seq[i][1], seq[i][2] + 0.05, "triangle", 0.2);
        this.tone(seq[i][0] * 2, seq[i][1], seq[i][2], "square", 0.04);
      }
      if (big) {
        for (var j = 0; j < 10; j++) this.tone(1800 + Math.random() * 1600, 1.4 + j * 0.09, 0.12, "sine", 0.06);
      }
    }
  };

  function unlockOnce() { Sound.unlock(); }
  document.addEventListener("touchend", unlockOnce, { passive: true });
  document.addEventListener("click", unlockOnce);

  var soundBtn = document.getElementById("sound-toggle");
  function paintSoundBtn() {
    soundBtn.textContent = state.sound ? "🔊" : "🔇";
    soundBtn.classList.toggle("is-off", !state.sound);
  }
  soundBtn.addEventListener("click", function () {
    state.sound = !state.sound; save(); paintSoundBtn();
    if (state.sound) { Sound.unlock(); Sound.tap(); }
  });
  paintSoundBtn();

  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* noop */ } }

  /* =========================================================
   * 共通
   * ======================================================= */
  function later(fn, ms) { var id = setTimeout(fn, ms); timers.push(id); return id; }
  function clearTimers() { while (timers.length) clearTimeout(timers.pop()); }

  function show(html, dark) {
    clearTimers();
    closeSheet();
    document.body.classList.toggle("is-dark", !!dark);
    app.innerHTML = html;
    window.scrollTo(0, 0);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtTime(ms) {
    if (!ms) return "";
    var d = new Date(ms);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function score() {
    var n = 0;
    for (var i = 0; i < QUIZ.length; i++) if (state.answers[i] === QUIZ[i].answer) n++;
    return n * 10;
  }

  /* ---------- 確認シート ---------- */
  var sheet = document.getElementById("sheet");
  var sheetBody = document.getElementById("sheet-body");
  var sheetYes = document.getElementById("sheet-yes");
  var sheetNo = document.getElementById("sheet-no");
  var sheetOnYes = null, sheetOnNo = null;

  function openSheet(opt) {
    sheetBody.innerHTML = opt.html;
    sheetYes.textContent = opt.yes || "はい";
    sheetNo.textContent = opt.no || "えらびなおす";
    sheetYes.className = "btn " + (opt.yesClass || "btn--primary");
    sheetYes.disabled = false;
    sheetOnYes = opt.onYes; sheetOnNo = opt.onNo || null;
    sheet.hidden = false;
    Sound.open();
    setTimeout(function () { sheetYes.focus({ preventScroll: true }); }, 50);
  }
  function closeSheet() { sheet.hidden = true; sheetOnYes = null; }
  sheetYes.addEventListener("click", function () {
    if (sheetYes.disabled || !sheetOnYes) return;
    sheetYes.disabled = true;
    var fn = sheetOnYes;
    closeSheet();
    fn();
  });
  function cancelSheet() {
    var fn = sheetOnNo;
    closeSheet();
    Sound.tap();
    if (fn) fn();
  }
  sheetNo.addEventListener("click", cancelSheet);
  sheet.querySelector("[data-close]").addEventListener("click", cancelSheet);

  /* =========================================================
   * 1. スタート
   * ======================================================= */
  var MOUNTAIN_SVG =
    '<svg class="start__mountain" viewBox="0 0 320 150" role="img" aria-label="石見銀山の山なみ">' +
    '<defs><linearGradient id="moon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c3c9d2"/></linearGradient></defs>' +
    '<circle cx="236" cy="44" r="24" fill="url(#moon)"/>' +
    '<path d="M0 118 L48 74 L84 96 L132 46 L176 88 L214 64 L262 102 L320 70 L320 150 L0 150 Z" fill="#9fb0c4"/>' +
    '<path d="M0 132 L40 104 L92 124 L150 78 L204 116 L250 96 L320 128 L320 150 L0 150 Z" fill="#4f6d8f"/>' +
    '<path d="M0 150 L0 140 L70 120 L130 138 L190 112 L262 136 L320 126 L320 150 Z" fill="#1d2a3a"/>' +
    '<path d="M180 150 L180 136 Q190 124 200 136 L200 150 Z" fill="#0b121b"/>' +
    '<circle cx="190" cy="140" r="2.2" fill="#f4d35e"/>' +
    "</svg>";

  function renderStart() {
    show(
      '<section class="screen start">' +
        '<div class="start__hero">' + MOUNTAIN_SVG +
          (RETRY_BUTTON ? '<div class="test-badge">確認用：結果画面のいちばん下から、もう1回解けます</div>' : "") +
          '<div class="start__badge">世界遺産石見銀山 東京マルシェ</div>' +
          '<h1 class="start__title"><small>石見銀山</small>世界遺産検定</h1>' +
          '<p class="start__lead">にチャレンジ！</p>' +
        "</div>" +
        '<div class="info">' +
          '<div class="info__row"><div class="info__icon">📝</div><div class="info__text"><b>全10問・3択</b><br>A・B・C から1つ選んでください</div></div>' +
          '<div class="info__row"><div class="info__icon">⏱</div><div class="info__text"><b>3分ほどで終わります</b><br>チャレンジは1人1回です</div></div>' +
          '<div class="info__row"><div class="info__icon">🎁</div><div class="info__text"><b>受けた方全員に</b><br>参加賞と「お米のすくい取り」！</div></div>' +
        "</div>" +
        '<div class="start__foot">' +
          '<button type="button" class="btn btn--primary" id="go">はじめる</button>' +
          '<p class="credit">問題制作：石見銀山世界遺産センター</p>' +
        "</div>" +
      "</section>"
    );
    document.getElementById("go").addEventListener("click", function () {
      Sound.unlock(); Sound.start();
      renderQuestion(0);
    });
  }

  /* =========================================================
   * 2. 出題
   * ======================================================= */
  function renderQuestion(i) {
    var q = QUIZ[i];
    var html =
      '<section class="screen question">' +
        '<div class="q-head"><div class="q-head__no">第' + (i + 1) + '<span>問</span></div><div class="q-head__total">全' + QUIZ.length + "問</div></div>" +
        '<div class="progress"><div class="progress__bar" style="width:' + (i / QUIZ.length) * 100 + '%"></div></div>' +
        '<div class="q-card"><p class="q-card__text">' + esc(q.q) + "</p></div>" +
        '<div class="choices">';
    for (var c = 0; c < q.choices.length; c++) {
      html += '<button type="button" class="choice" data-c="' + c + '"><span class="choice__letter">' + LETTERS[c] +
        '</span><span class="choice__text">' + esc(q.choices[c]) + "</span></button>";
    }
    html += "</div></section>";
    show(html);

    // 進捗バーを少し遅らせて伸ばす
    var bar = app.querySelector(".progress__bar");
    requestAnimationFrame(function () { bar.style.width = ((i + 1) / QUIZ.length) * 100 + "%"; });

    var buttons = app.querySelectorAll(".choice");
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener("click", function () {
        var c = Number(btn.getAttribute("data-c"));
        Array.prototype.forEach.call(buttons, function (b) { b.classList.remove("is-picked"); });
        btn.classList.add("is-picked");
        Sound.unlock();
        openSheet({
          html:
            '<div class="sheet__pick"><span class="choice__letter">' + LETTERS[c] + "</span>" +
            '<span class="sheet__pick-text">' + esc(q.choices[c]) + "</span></div>" +
            '<p class="sheet__ask" id="sheet-title">こちらでよろしいですか？</p>',
          yes: i === QUIZ.length - 1 ? "はい（採点へ）" : "はい",
          no: "えらびなおす",
          onYes: function () { answer(i, c); },
          onNo: function () { btn.classList.remove("is-picked"); }
        });
      });
    });
  }

  function answer(i, c) {
    state.answers[i] = c;
    state.answers.length = i + 1;
    if (i === QUIZ.length - 1) {
      state.done = true;
      state.finishedAt = Date.now();
      save();
      Sound.yes();
      renderGrading();
    } else {
      save();
      Sound.yes();
      renderQuestion(i + 1);
    }
  }

  /* =========================================================
   * 3. 採点中（約10秒）
   * ======================================================= */
  var PICK_SVG =
    '<svg class="mine__pick" viewBox="0 0 110 110" aria-hidden="true">' +
    '<path d="M96 100 L44 34" stroke="#8a5a2b" stroke-width="9" stroke-linecap="round"/>' +
    '<path d="M96 100 L44 34" stroke="#b07a42" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M10 58 Q22 30 48 22 Q70 16 88 22 Q66 24 52 36 Q38 46 10 58 Z" fill="#dfe4ea" stroke="#5c6878" stroke-width="2.5" stroke-linejoin="round"/>' +
    "</svg>";
  var ORE_SVG =
    '<svg class="mine__ore" viewBox="0 0 150 96" aria-hidden="true">' +
    '<path d="M8 92 L18 46 L48 18 L92 10 L128 30 L144 70 L138 92 Z" fill="#3b4656" stroke="#0f1722" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M30 70 L58 44 L82 52 L110 30" stroke="#e8ecf1" stroke-width="4" fill="none" stroke-linecap="round"/>' +
    '<path d="M50 82 L74 66 L100 74" stroke="#c9d0d9" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '<circle cx="58" cy="44" r="3.5" fill="#fff"/><circle cx="110" cy="30" r="3" fill="#fff"/><circle cx="74" cy="66" r="2.5" fill="#fff"/>' +
    "</svg>";

  function renderGrading() {
    var lamps = "";
    for (var i = 0; i < QUIZ.length; i++) lamps += '<div class="lamp" data-i="' + i + '">' + (i + 1) + "</div>";
    show(
      '<section class="screen grading">' +
        '<p class="grading__sub">おつかれさまでした！</p>' +
        '<h2 class="grading__title">それでは、これから<br>採点をしていきます</h2>' +
        '<div class="mine">' + ORE_SVG + PICK_SVG + '<span class="mine__spark"></span><span class="mine__spark"></span><span class="mine__spark"></span></div>' +
        '<div class="bibibi" id="bibibi">ビビビビ…</div>' +
        '<div class="lamps">' + lamps + "</div>" +
        '<div class="meter"><div class="meter__bar" id="meter"></div></div>' +
        '<p class="grading__status" id="status">答案を読み込み中…</p>' +
      "</section>",
      true
    );

    var lampEls = app.querySelectorAll(".lamp");
    var meter = document.getElementById("meter");
    var status = document.getElementById("status");
    var bibi = document.getElementById("bibibi");
    var sparks = app.querySelectorAll(".mine__spark");
    var STEP = 820;                // 1問あたり
    var TOTAL = STEP * QUIZ.length; // 約8.2秒
    var messages = [
      [0, "答案を読み込み中…"],
      [2200, "間歩にもぐって答え合わせ中…"],
      [4600, "灰吹法で銀を取り出し中…"],
      [7000, "最後の1問をチェック中…"]
    ];
    messages.forEach(function (m) { later(function () { status.textContent = m[1]; }, m[0]); });

    // つるはしが当たるたびに火花
    var hit = 0;
    (function strike() {
      later(function () {
        var s = sparks[hit % sparks.length];
        var ang = Math.random() * Math.PI - Math.PI;
        s.style.setProperty("--dx", Math.cos(ang) * (30 + Math.random() * 30) + "px");
        s.style.setProperty("--dy", Math.sin(ang) * (30 + Math.random() * 30) + "px");
        s.classList.remove("go"); void s.offsetWidth; s.classList.add("go");
        Sound.clink();
        hit++;
        if (hit * 500 < TOTAL) strike();
      }, hit === 0 ? 275 : 500);
    })();

    // ランプを1つずつ点ける（○×はここでは見せない）
    Array.prototype.forEach.call(lampEls, function (el, i) {
      later(function () { el.classList.add("is-blink"); Sound.bibibi(); }, i * STEP + 80);
      later(function () {
        el.classList.remove("is-blink"); el.classList.add("is-on");
        Sound.pi();
        meter.style.width = ((i + 1) / QUIZ.length) * 100 + "%";
      }, i * STEP + 560);
    });

    later(function () {
      bibi.textContent = "チーン！";
      status.textContent = "採点完了！";
      app.querySelector(".mine__pick").style.animation = "none";
      Sound.chime();
    }, TOTAL + 200);

    later(function () { renderResult(true); }, TOTAL + 1800); // 合計 約10秒
  }

  /* =========================================================
   * 4. 結果
   * ======================================================= */
  function resultMessage(s) {
    if (s === 100) return "満点合格！おめでとう！";
    if (s >= 70) return "おみごと！おめでとう！";
    if (s >= 40) return "おめでとう！";
    return "チャレンジおめでとう！";
  }

  function stampHtml(isNew) {
    return '<div class="stamp' + (isNew ? " is-new" : "") + '"><div class="stamp__in">お米すくい取り<b>済</b><small>' +
      esc(fmtTime(state.scoopedAt)) + "</small></div></div>";
  }

  function renderResult(animate) {
    var s = score();
    var perfect = s === 100;

    var marks = "";
    for (var i = 0; i < QUIZ.length; i++) {
      var ok = state.answers[i] === QUIZ[i].answer;
      marks +=
        '<div class="mark-row"><div class="mark-row__no">問' + (i + 1) + "</div>" +
        '<div class="mark-row__q">' + esc(QUIZ[i].q) +
        (QUIZ[i].note ? '<span class="mark-row__note">' + esc(QUIZ[i].note) + "</span>" : "") + "</div>" +
        '<div class="mark-row__mark ' + (ok ? "ok" : "ng") + '" aria-label="' + (ok ? "正解" : "不正解") + '">' + (ok ? "○" : "×") + "</div></div>";
    }

    var scoreHtml = '<span class="score"><span class="score__num">' + s + '</span><span class="score__unit">点</span></span>';
    var badge = perfect ? '<div class="title-badge"><small>満点合格の称号</small>石見銀山 銀山奉行</div>' : "";

    show(
      '<section class="screen result' + (perfect ? " is-perfect" : "") + '">' +
        '<div class="reveal">' +
          '<p class="reveal__label" id="r-label">' + (animate ? "あなたの得点は…" : "あなたの得点は") + "</p>" +
          '<div class="reveal__count" id="r-count">' + (animate ? "" : scoreHtml) + "</div>" +
          '<p class="reveal__msg" id="r-msg">' + (animate ? "" : resultMessage(s)) + "</p>" +
          '<div id="r-badge">' + (animate ? "" : badge) + "</div>" +
        "</div>" +
        '<div class="result-body" id="r-body"' + (animate ? " hidden" : "") + ">" +
          '<div class="ticket' + (state.scooped ? " is-used" : "") + '" id="ticket">' +
            '<p class="ticket__show">この画面を受付で<br>そのままお見せください<span>参加賞と、お米のすくい取りが受けられます</span></p>' +
            '<div class="ticket__perks">' +
              '<div class="perk"><div class="perk__icon">🎁</div><div class="perk__text"><b>参加賞</b>受付でお渡しします</div></div>' +
              '<div class="perk perk--rice"><div class="perk__icon">🍚</div><div class="perk__text"><b>お米のすくい取り</b>三瓶山のふもと「ファーム浮布」さんの「うきぬのの米」を、手ですくい取れます！</div></div>' +
            "</div>" +
            '<div class="ticket__meta"><span>石見銀山 世界遺産検定</span><span>' + s + "点・" + esc(fmtTime(state.finishedAt)) + "</span></div>" +
            (state.scooped ? stampHtml(false) : "") +
          "</div>" +
          '<div class="marks"><p class="marks__title">答え合わせ</p>' + marks + "</div>" +
          '<div class="staff" id="staff">' + staffInner() + "</div>" +
          '<p class="result-foot">石見銀山世界遺産センター 制作の問題より</p>' +
          (RETRY_BUTTON
            ? '<div class="retry"><p class="retry__label">― 確認用（本番前に消えます）―</p>' +
              '<button type="button" class="btn btn--retry" id="retry">もう1回解く</button></div>'
            : "") +
        "</div>" +
      "</section>",
      true
    );
    bindStaff();
    bindRetry();

    if (!animate) return;

    var count = document.getElementById("r-count");
    var msg = document.getElementById("r-msg");
    var label = document.getElementById("r-label");
    var badgeBox = document.getElementById("r-badge");
    var body = document.getElementById("r-body");

    Sound.drumroll(3.6);
    var seq = [
      // 3、2、1、ドン！（音は1拍ごとに高くしていく）
      [1300, "3", function () { Sound.count(1); }],
      [2100, "2", function () { Sound.count(2); }],
      [2900, "1", function () { Sound.count(3); }],
      [3700, '<span class="don">ドン！</span>', function () { Sound.don(); vibrate([0, 90, 40, 140]); }]
    ];
    seq.forEach(function (st) {
      later(function () {
        count.innerHTML = '<span class="pop">' + st[1] + "</span>";
        st[2]();
      }, st[0]);
    });

    later(function () {
      label.textContent = "あなたの得点は";
      count.innerHTML = '<span class="pop">' + scoreHtml + "</span>";
      msg.textContent = resultMessage(s);
      msg.className = "reveal__msg pop";
      Sound.fanfare(perfect);
      confetti(perfect);
    }, 4400);

    if (perfect) {
      later(function () {
        badgeBox.innerHTML = '<span class="pop" style="display:inline-block">' + badge + "</span>";
      }, 5300);
    }

    later(function () { body.hidden = false; }, perfect ? 6200 : 5400);
  }

  function staffInner() {
    if (state.scooped) {
      return '<p class="staff__done">お米すくい取り 済み（' + esc(fmtTime(state.scoopedAt)) + "）</p>";
    }
    return '<p class="staff__label">― 受付スタッフ用 ―</p>' +
      '<button type="button" class="btn btn--staff" id="scoop">お米すくい取り 済みにする</button>';
  }

  function bindStaff() {
    var btn = document.getElementById("scoop");
    if (!btn) return;
    btn.addEventListener("click", function () {
      openSheet({
        html:
          '<p class="sheet__title" id="sheet-title">受付スタッフの方が押してください</p>' +
          '<p class="sheet__note">お米のすくい取りが終わったら押してください。<br>押すと元に戻せません。</p>',
        yes: "済みにする",
        no: "やめる",
        yesClass: "btn--shu",
        onYes: markScooped
      });
    });
  }

  // 確認期間だけの「もう1回解く」。点数と「済み」を消して最初の画面へ
  function bindRetry() {
    var btn = document.getElementById("retry");
    if (!btn) return;
    btn.addEventListener("click", function () {
      openSheet({
        html:
          '<p class="sheet__title" id="sheet-title">もう1回、最初から解きますか？</p>' +
          '<p class="sheet__note">今の点数と「お米すくい取り 済み」は消えます。</p>',
        yes: "最初から解く",
        no: "やめる",
        onYes: function () {
          var sound = state.sound;
          wipe();
          state = blank();
          state.sound = sound;
          save();
          renderStart();
        }
      });
    });
  }

  function markScooped() {
    if (state.scooped) return;
    state.scooped = true;
    state.scoopedAt = Date.now();
    save();
    var ticket = document.getElementById("ticket");
    ticket.classList.add("is-used");
    ticket.insertAdjacentHTML("beforeend", stampHtml(true));
    document.getElementById("staff").innerHTML = staffInner();
    Sound.don();
    vibrate(80);
  }

  /* =========================================================
   * 紙吹雪（満点は金・銀・お米つぶ）
   * ======================================================= */
  function confetti(perfect) {
    var cv = document.getElementById("confetti");
    var ctx = cv.getContext && cv.getContext("2d");
    if (!ctx) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var colors = perfect
      ? ["#f0cf5a", "#ffe99a", "#c9a227", "#ffffff", "#d9dde3", "#c23b22"]
      : ["#ffffff", "#d9dde3", "#a9b0ba", "#c23b22", "#f0cf5a", "#7fa4cf"];
    var N = perfect ? 220 : 120;
    var parts = [];
    for (var i = 0; i < N; i++) {
      var rice = perfect && i % 3 === 0;
      parts.push({
        x: W / 2 + (Math.random() - 0.5) * 60,
        y: H * 0.32,
        vx: (Math.random() - 0.5) * 14,
        vy: -6 - Math.random() * 10,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        w: rice ? 4 : 6 + Math.random() * 6,
        h: rice ? 8 : 8 + Math.random() * 8,
        c: rice ? "#fffdf2" : colors[i % colors.length],
        rice: rice
      });
    }
    var start = performance.now(), DUR = perfect ? 5200 : 3800;
    (function frame(now) {
      var t = now - start;
      ctx.clearRect(0, 0, W, H);
      for (var k = 0; k < parts.length; k++) {
        var p = parts[k];
        p.vy += 0.28; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t / DUR);
        ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        if (p.rice) {
          ctx.beginPath(); ctx.ellipse(0, 0, p.w / 2, p.h / 2, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "rgba(160,140,90,.5)"; ctx.lineWidth = 0.8; ctx.stroke();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
        }
        ctx.restore();
      }
      if (t < DUR) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    })(start);
  }

  /* =========================================================
   * 起動
   * ======================================================= */
  function route() {
    if (!QUIZ.length) { app.textContent = "問題を読み込めませんでした。"; return; }
    if (state.done) renderResult(false);
    else if (state.answers.length > 0) renderQuestion(Math.min(state.answers.length, QUIZ.length - 1));
    else renderStart();
  }

  // 戻る／進むでページが復元されたときも、保存内容から描き直す
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) { state = load(); paintSoundBtn(); route(); }
  });

  route();
})();
