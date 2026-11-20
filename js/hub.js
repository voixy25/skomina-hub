(function () {
  'use strict';

  var STORAGE_KEY = 'skomina_lang';
  var COPIED_MS = 1600;
  var TOAST_MS = 1800;
  var LIVE_DELAY_MS = 50;
  var IS_APPLE = /Mac|iPhone|iPad/.test(
    (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''
  );

  var SHORTCUT_LABEL = IS_APPLE ? '⌘K' : 'Alt K';

  var SL = Object.freeze({
    docTitle: 'Domen Skomina — Spletni razvijalec & študent računalništva | skomina.si',
    docDesc: 'Domen Skomina — Študent računalništva in neodvisni spletni razvijalec. Vstopna točka za portfelj in kontakt.',
    statusAvailable: 'Odprt za projekte',
    location: 'Ljubljana & Nova Gorica, Slovenija',
    tagline: 'Študent računalništva (FRI) & samostojni spletni razvijalec. Gradim bliskovito hitre, dovršene in zanesljive digitalne rešitve.',
    card1Chip: 'Storitve & Portfelj',
    card1Desc: 'Osrednji portfelj spletnega razvoja. Pregled tehnologij, arhitektura rešitev in neposredno naročilo projektov.',
    card1Cta: 'Odpri spletno mesto',
    card4Chip: 'Stik & Povezave',
    contactTitle: 'Stopite v stik',
    contactSub: 'Neposredna komunikacija za nova sodelovanja ali vprašanja.',
    mailLabel: 'E-pošta',
    copyTooltip: 'Kopirano!',
    toastCopied: 'E-poštni naslov kopiran',
    toastFailed: 'Kopiranje ni uspelo',
    langLabel: 'Izbira jezika',
    dirLabel: 'Imenik spletnih mest',
    copyAria: 'Kopiraj e-poštni naslov',
    kbdAria: 'Kopiraj e-poštni naslov (' + SHORTCUT_LABEL + ')',
    githubAria: 'GitHub profil',
    mailAria: 'Pošlji e-pošto'
  });

  var EN = Object.freeze({
    docTitle: 'Domen Skomina — Web Developer & CS Student | skomina.si',
    docDesc: 'Domen Skomina — Computer Science student and independent web developer. Gateway to portfolio and direct contact.',
    statusAvailable: 'Available for projects',
    location: 'Ljubljana & Nova Gorica, Slovenia',
    tagline: 'Computer Science student (FRI) & independent web developer building fast, modern, and reliable digital experiences.',
    card1Chip: 'Services & Portfolio',
    card1Desc: 'Core web development landing hub. Tech stack breakdown, architectural approach, and client onboarding.',
    card1Cta: 'Visit site',
    card4Chip: 'Direct Contact',
    contactTitle: "Let's connect",
    contactSub: 'Frictionless direct channel for contracts, collaborations, or questions.',
    mailLabel: 'Email',
    copyTooltip: 'Copied!',
    toastCopied: 'Email address copied',
    toastFailed: 'Copy failed',
    langLabel: 'Language',
    dirLabel: 'Site directory',
    copyAria: 'Copy email address',
    kbdAria: 'Copy email address (' + SHORTCUT_LABEL + ')',
    githubAria: 'GitHub profile',
    mailAria: 'Send an email'
  });

  var I18N = Object.freeze({ sl: SL, en: EN });
  var LOCALES = Object.freeze({ sl: 'sl_SI', en: 'en_US' });
  var toastTimer = 0;
  var copiedTimer = 0;

  function readStoredLang() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY);
      return stored === 'sl' || stored === 'en' ? stored : null;
    } catch (e) {
      return null;
    }
  }

  function storeLang(lang) {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {
      /* storage unavailable: language still applies for this session */
    }
  }

  function detectLang() {
    var stored = readStoredLang();
    if (stored) return stored;
    return 'sl';
  }

  function applyText(data) {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var value = data[el.getAttribute('data-i18n')];
      if (value) el.textContent = value;
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      var value = data[el.getAttribute('data-i18n-aria')];
      if (value) el.setAttribute('aria-label', value);
    });
  }

  function setMeta(selector, attr, value) {
    var el = document.querySelector(selector);
    if (el) el.setAttribute(attr, value);
  }

  function applyMeta(lang, data) {
    document.documentElement.lang = lang;
    document.title = data.docTitle;
    setMeta('meta[name="description"]', 'content', data.docDesc);
    setMeta('meta[property="og:locale"]', 'content', LOCALES[lang]);
    setMeta('meta[property="og:title"]', 'content', data.docTitle.replace(/ \| skomina\.si$/, ''));
    setMeta('meta[property="og:description"]', 'content', data.docDesc);
    setMeta('meta[name="twitter:title"]', 'content', data.docTitle.replace(/ \| skomina\.si$/, ''));
    setMeta('meta[name="twitter:description"]', 'content', data.docDesc);
  }

  function applyButtons(lang) {
    document.querySelectorAll('.lang-btn').forEach(function (btn) {
      var active = btn.getAttribute('data-lang') === lang;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function currentData() {
    return I18N[document.documentElement.lang] || SL;
  }

  function setLanguage(lang) {
    var safe = I18N[lang] ? lang : 'sl';
    var data = I18N[safe];
    applyMeta(safe, data);
    applyText(data);
    applyButtons(safe);
    storeLang(safe);
  }

  function legacyCopy(text) {
    var input = document.createElement('input');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(input);
    return ok;
  }

  function writeClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return legacyCopy(text); }
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  function showToast(message) {
    var toast = document.getElementById('toast');
    var live = document.getElementById('live-region');
    if (live) {
      live.textContent = '';
      window.setTimeout(function () { live.textContent = message; }, LIVE_DELAY_MS);
    }
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.classList.remove('show');
    }, TOAST_MS);
  }

  function flashCopyButton() {
    var btn = document.getElementById('copy-btn');
    if (!btn) return;
    btn.classList.add('copied');
    window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(function () {
      btn.classList.remove('copied');
    }, COPIED_MS);
  }

  function copyEmail() {
    var src = document.getElementById('email-str');
    var email = src ? (src.getAttribute('data-email') || src.textContent.trim().replace(/\(at\)/g, '@')) : 'info@skomina.si';
    if (!email) return;
    writeClipboard(email).then(function (ok) {
      if (ok) flashCopyButton();
      showToast(ok ? currentData().toastCopied : currentData().toastFailed);
    });
  }

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function onKeydown(e) {
    if (e.repeat || e.defaultPrevented) return;
    var key = (e.key || '').toLowerCase();
    var combo = IS_APPLE
      ? e.metaKey && !e.ctrlKey && !e.altKey
      : e.altKey && !e.metaKey && !e.ctrlKey;
    if (combo && !e.shiftKey && key === 'k') {
      e.preventDefault();
      copyEmail();
      return;
    }
    var plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    var inCard = e.target && e.target.closest && e.target.closest('.contact-card');
    if (plain && key === 'c' && inCard && !isTypingTarget(e.target)) copyEmail();
  }

  function bind(id, handler) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
  }

  function init() {
    var year = document.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());
    document.querySelectorAll('.lang-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setLanguage(btn.getAttribute('data-lang'));
      });
    });
    bind('copy-btn', copyEmail);
    bind('kbd-btn', copyEmail);
    var chip = document.getElementById('kbd-btn');
    if (chip) {
      chip.setAttribute('aria-keyshortcuts', IS_APPLE ? 'Meta+K' : 'Alt+K');
      var kbd = chip.querySelector('kbd');
      if (kbd) kbd.textContent = SHORTCUT_LABEL;
    }
    document.addEventListener('keydown', onKeydown);
    setLanguage(detectLang());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
