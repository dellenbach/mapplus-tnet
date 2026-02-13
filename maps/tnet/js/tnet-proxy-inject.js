/**
 * tnet-proxy-inject.js
 * Auto-Init Script für die proxied gis-daten.ch Seite im iframe.
 * Wird zusammen mit tnet-mapplus-helpers.js vom Proxy injiziert.
 *
 * Aufgaben:
 * 1. SSO: Auto-Login via tryAutoLogin() wenn WP-Login-Button sichtbar
 * 2. Sidebar-Links umschreiben via processExtractedLinks()
 * 3. NW/OW Buttons abfangen und an Parent-Frame weiterleiten
 *
 * @version    1.1
 * @date       2026-02-13
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

(function () {
  'use strict';

  var TAG = '[proxy-inject]';

  // -----------------------------------------------------------
  // 1. SSO: Auto-Login wenn WordPress Login-Button sichtbar
  //    tryAutoLogin() stammt aus tnet-mapplus-helpers.js
  //    Gleicher IDP (ADFS) → wenn am IDP angemeldet, SSO ohne Passwort
  // -----------------------------------------------------------
  function checkAutoLogin() {
    if (typeof tryAutoLogin !== 'function') {
      console.log(TAG, 'tryAutoLogin nicht verfügbar');
      return;
    }

    // Suche nach WordPress-OAuth-Login-Button (miniOrange)
    var loginBtn = document.querySelector('a.oauthloginbutton[onclick*="moOAuthLoginNew"]');
    if (loginBtn) {
      console.log(TAG, 'WP Login-Button gefunden → starte Auto-SSO');
      // Nutze ein temporäres iframe-Objekt mit document als contentDocument
      var fakeIframe = { contentDocument: document };
      tryAutoLogin(fakeIframe);
    } else {
      console.log(TAG, 'Kein Login-Button → bereits angemeldet oder öffentlich');
    }
  }

  // -----------------------------------------------------------
  // 2. Sidebar-Links umschreiben (Bookmark-System)
  //    processExtractedLinks() stammt aus tnet-mapplus-helpers.js
  // -----------------------------------------------------------
  function rewriteLinks() {
    if (typeof processExtractedLinks !== 'function') {
      console.warn(TAG, 'processExtractedLinks nicht verfügbar');
      return;
    }
    // Alle Links in der Sidebar umschreiben
    var selector = '.cdt-frontpage-maps-sidebar a';
    var links = document.querySelectorAll(selector);
    console.log(TAG, 'Sidebar-Links gefunden:', links.length);
    if (links.length > 0) {
      processExtractedLinks(selector);
      console.log(TAG, 'Links umgeschrieben');
    }
  }

  // -----------------------------------------------------------
  // 3. NW/OW Button-Handler
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
  // Init: Warte auf DOM-Ready, dann mit Retry (WP lädt nach)
  // -----------------------------------------------------------
  function init() {
    console.log(TAG, 'Init');
    checkAutoLogin();
    rewriteLinks();
    setupButtonHandler();
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
