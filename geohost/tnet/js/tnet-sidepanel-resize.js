/**
 * tnet-sidepanel-resize.js
 * Horizontales Resize fuer das linke Sidepanel (freepane)
 *
 * @version    1.0
 * @date       2026-06-03
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function () {
  'use strict';

  // ===== KONFIGURATION =====
  var STORAGE_KEY = 'tnet-sidepanel-width';
  var MIN_WIDTH = 280;
  var MAX_WIDTH = 620;

  // ===== HILFSFUNKTIONEN =====
  function isMobile() {
    return !!window.__TNET_MOBILE_ENTRY;
  }

  function getWidthMax() {
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - 180));
  }

  function clampWidth(width) {
    return Math.max(MIN_WIDTH, Math.min(getWidthMax(), width));
  }

  function getCurrentWidth(freepane) {
    var cssValue = window.getComputedStyle(document.documentElement).getPropertyValue('--tnet-sidepanel-width');
    var parsedCss = parseInt(cssValue, 10);
    if (!isNaN(parsedCss) && parsedCss > 0) {
      return parsedCss;
    }
    if (freepane) {
      return Math.round(freepane.getBoundingClientRect().width || 340);
    }
    return 340;
  }

  function applyWidth(width) {
    var clamped = clampWidth(width);
    document.documentElement.style.setProperty('--tnet-sidepanel-width', clamped + 'px');
    return clamped;
  }

  function loadSavedWidth() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = parseInt(raw, 10);
      return isNaN(parsed) ? null : parsed;
    } catch (e) {
      return null;
    }
  }

  function saveWidth(width) {
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch (e) {
      // localStorage kann deaktiviert sein
    }
  }

  // ===== RESIZE INIT =====
  function initSidepanelResize() {
    if (isMobile()) return;

    var freepane = document.getElementById('freepane');
    if (!freepane || !document.body.classList.contains('tnet-sidepanel-v2')) return;

    var handle = document.getElementById('freepane-resize-handle');
    if (!handle) {
      handle = document.createElement('div');
      handle.id = 'freepane-resize-handle';
      handle.setAttribute('aria-hidden', 'true');
      freepane.appendChild(handle);
    }

    var saved = loadSavedWidth();
    if (saved !== null) {
      applyWidth(saved);
    }

    var isResizing = false;
    var startX = 0;
    var startWidth = 0;

    function onMouseMove(e) {
      if (!isResizing) return;
      var deltaX = e.clientX - startX;
      applyWidth(startWidth + deltaX);
      e.preventDefault();
    }

    function onMouseUp() {
      if (!isResizing) return;
      isResizing = false;
      handle.classList.remove('active');
      freepane.classList.remove('freepane-resizing');
      document.body.classList.remove('tnet-resizing');
      document.body.style.userSelect = '';
      saveWidth(getCurrentWidth(freepane));
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    handle.addEventListener('mousedown', function (e) {
      if (freepane.classList.contains('close')) return;
      isResizing = true;
      startX = e.clientX;
      startWidth = getCurrentWidth(freepane);
      handle.classList.add('active');
      freepane.classList.add('freepane-resizing');
      document.body.classList.add('tnet-resizing');
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener('resize', function () {
      applyWidth(getCurrentWidth(freepane));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidepanelResize);
  } else {
    initSidepanelResize();
  }
})();
