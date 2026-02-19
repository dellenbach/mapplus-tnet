/**
 * tnet-proxy-inject.js
 * Auto-Init Script für die proxied gis-daten.ch Seite im iframe.
 * Wird zusammen mit tnet-mapplus-helpers.js vom Proxy injiziert.
 *
 * Aufgaben:
 * 1. Sidebar-Links umschreiben via processExtractedLinks()
 * 2. NW/OW Buttons abfangen und an Parent-Frame weiterleiten
 * 3. Sidebar Toggle (Hamburger-Icon / Close-Button)
 * (SSO Auto-Login wird serverseitig via active-maps-proxy.php erledigt)
 *
 * @version    1.3
 * @date       2026-02-19
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

(function () {
  'use strict';

  var TAG = '[proxy-inject]';

  // -----------------------------------------------------------
  // 1. Sidebar-Links umschreiben (Bookmark-System)
  //    processExtractedLinks() stammt aus tnet-mapplus-helpers.js
  // -----------------------------------------------------------
  function rewriteLinks() {
    if (typeof processExtractedLinks !== 'function') {
      console.warn(TAG, 'processExtractedLinks nicht verfügbar');
      return;
    }
    // Alle Links in der Sidebar und map/ Links umschreiben
    var selector = '.cdt-frontpage-maps-sidebar a, a[href*="gis-daten.ch/map/"], a[href^="/map/"], a[href*="/secmap/"]';
    var links = document.querySelectorAll(selector);
    console.log(TAG, 'Links gefunden:', links.length);
    if (links.length > 0) {
      processExtractedLinks(selector);
      console.log(TAG, 'Links umgeschrieben');
    }
  }

  // -----------------------------------------------------------
  // 2. NW/OW Button-Handler
  //    Klick → Parent-URL mit ?group=nw|ow aktualisieren
  //    inframe-maps.html erkennt den Wechsel via URL-Monitoring
  // -----------------------------------------------------------
  function setupButtonHandler() {
    var buttons = document.querySelectorAll(
      'button.cdt-frontpage-maps-header-buttons-nw, ' +
      'button.cdt-frontpage-maps-header-buttons-ow'
    );
    console.log(TAG, 'NW/OW Buttons gefunden:', buttons.length);

    buttons.forEach(function (btn) {
      if (btn.dataset.proxyBound) return;
      btn.dataset.proxyBound = 'true';

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        var isOW = btn.classList.contains('cdt-frontpage-maps-header-buttons-ow');
        var newGroup = isOW ? 'ow' : 'nw';
        console.log(TAG, 'Button geklickt: group=' + newGroup);

        // Parent-URL aktualisieren (iframe-Kontext)
        try {
          if (window.parent !== window) {
            var parentUrl = window.parent.location.href;
            var clean = parentUrl.replace(/([?&])group=[^&]*/g, '');
            clean = clean.replace(/[?&]$/, '').replace(/\?&/, '?');
            var sep = clean.indexOf('?') !== -1 ? '&' : '?';
            window.parent.location.href = clean + sep + 'group=' + newGroup;
            return;
          }
        } catch (err) {
          console.log(TAG, 'Parent nicht erreichbar:', err.message);
        }

        // Fallback: Standalone
        window.location.href = window.location.pathname + '?group=' + newGroup;
      }, true); // useCapture
    });
  }

  // -----------------------------------------------------------
  // 3. Sidebar Toggle (Original-Theme-JS greift im Proxy nicht)
  // -----------------------------------------------------------
  function setupSidebarToggle() {
    var nav = document.querySelector('.cdt-frontpage-maps-sidebar-nav');
    if (!nav) return;

    function toggleNav(e) {
      e.preventDefault();
      e.stopPropagation();
      nav.classList.toggle('cdt-frontpage-maps-sidebar-nav-active');
      console.log(TAG, 'Sidebar toggled',
        nav.classList.contains('cdt-frontpage-maps-sidebar-nav-active') ? 'open' : 'closed');
    }

    function closeNav(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      nav.classList.remove('cdt-frontpage-maps-sidebar-nav-active');
      console.log(TAG, 'Sidebar closed');
    }

    // Icon (Logo/Pin) öffnet / schliesst die Nav
    var icon = document.querySelector('.cdt-frontpage-maps-sidebar-icon');
    if (icon && !icon.dataset.proxyBound) {
      icon.dataset.proxyBound = '1';
      icon.addEventListener('click', toggleNav, true);
    }

    // "Kategorien" Titel öffnet / schliesst die Nav
    var title = document.querySelector('.cdt-frontpage-maps-sidebar-title');
    if (title && !title.dataset.proxyBound) {
      title.dataset.proxyBound = '1';
      title.style.cursor = 'pointer';
      title.addEventListener('click', toggleNav, true);
    }

    // Close-Button in der Nav
    var close = document.querySelector('.cdt-frontpage-maps-sidebar-close');
    if (close && !close.dataset.proxyBound) {
      close.dataset.proxyBound = '1';
      close.addEventListener('click', closeNav, true);
    }

    // Kategorie-Links: Klick → Nav schliessen (scrollt automatisch zum Anker)
    var navLinks = nav.querySelectorAll('a');
    navLinks.forEach(function (link) {
      if (link.dataset.proxyNavBound) return;
      link.dataset.proxyNavBound = '1';
      link.addEventListener('click', function () {
        // Kurze Verzögerung damit der Browser erst zum Anker scrollt
        setTimeout(function () {
          nav.classList.remove('cdt-frontpage-maps-sidebar-nav-active');
          console.log(TAG, 'Nav closed after category click');
        }, 150);
      });
    });
  }

  // -----------------------------------------------------------
  // Init: Warte auf DOM-Ready, dann mit Retry (WP lädt nach)
  // -----------------------------------------------------------
  function init() {
    console.log(TAG, 'Init');
    rewriteLinks();
    setupButtonHandler();
    setupSidebarToggle();
  }

  function initWithRetry() {
    init();
    // WordPress rendert Sidebar-Content teils verzögert
    setTimeout(init, 500);
    setTimeout(init, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWithRetry);
  } else {
    initWithRetry();
  }
})();
