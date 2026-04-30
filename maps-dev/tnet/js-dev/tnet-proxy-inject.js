/**
 * tnet-proxy-inject.js
 * Auto-Init Script für die proxied gis-daten.ch Seite im iframe.
 * Wird zusammen mit tnet-mapplus-helpers.js vom Proxy injiziert.
 *
 * Aufgaben:
 * 1. Sidebar-Links umschreiben via processExtractedLinks()
 * 2. NW/OW Buttons abfangen und an Parent-Frame weiterleiten
 * 3. Sidebar Toggle (Hamburger-Icon / Close-Button)
 * 4. SSO Auto-Login: WP OAuth-Button automatisch klicken (JS-seitig)
 *
 * @version    2.0
 * @date       2026-03-10
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

(function () {
  'use strict';

  function getAppRoot() {
    return window.__TNET_APP_ROOT || '/maps';
  }

  var TAG = '[proxy-inject]';

  // Konfiguration aus tnet-global-config.json5 (via PHP injiziert)
  var _dbg = (window.__TNET_PROXY_DEBUG !== false);  // default true wenn PHP fehlt

  function log()  { if (_dbg) console.log.apply(console, arguments); }
  function warn() { if (_dbg) console.warn.apply(console, arguments); }

  // Status-Log (kompakt)
  log(TAG, '=== v3.0 ===  Pre-Auth läuft in tnet-header.js, _dbg=' + _dbg);

  // -----------------------------------------------------------
  // 1. Sidebar-Links umschreiben (Bookmark-System)
  //    processExtractedLinks() stammt aus tnet-mapplus-helpers.js
  //
  //    Markiert verarbeitete Links mit data-proxy-rewritten,
  //    damit MutationObserver & Retries keine Duplikate erzeugen.
  // -----------------------------------------------------------
  var LINK_SELECTOR = '.cdt-frontpage-maps-sidebar a, ' +
    'a[href*="gis-daten.ch/map/"], a[href*="gis-daten.ch/secmap/"], ' +
    'a[href^="/map/"], a[href*="/secmap/"], ' +
    'a[onclick*="setMapBookmark"]';

  function rewriteLinks() {
    if (typeof processExtractedLinks !== 'function') {
      warn(TAG, 'processExtractedLinks nicht verfügbar');
      return;
    }
    // Nur Links die noch NICHT umgeschrieben wurden
    var all = document.querySelectorAll(LINK_SELECTOR);
    var unrewritten = [];
    all.forEach(function (a) {
      if (!a.dataset.proxyRewritten) unrewritten.push(a);
    });
    if (unrewritten.length === 0) return;

    log(TAG, 'Links gefunden:', all.length, ', neu:', unrewritten.length);
    processExtractedLinks(LINK_SELECTOR);

    // Alle jetzt markieren (auch solche die schon vorher da waren)
    all.forEach(function (a) { a.dataset.proxyRewritten = '1'; });
    log(TAG, unrewritten.length + ' Links umgeschrieben');
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
    log(TAG, 'NW/OW Buttons gefunden:', buttons.length);

    buttons.forEach(function (btn) {
      if (btn.dataset.proxyBound) return;
      btn.dataset.proxyBound = 'true';

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        var isOW = btn.classList.contains('cdt-frontpage-maps-header-buttons-ow');
        var newGroup = isOW ? 'ow' : 'nw';
        log(TAG, 'Button geklickt: group=' + newGroup);

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
          log(TAG, 'Parent nicht erreichbar:', err.message);
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
      log(TAG, 'Sidebar toggled',
        nav.classList.contains('cdt-frontpage-maps-sidebar-nav-active') ? 'open' : 'closed');
    }

    function closeNav(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      nav.classList.remove('cdt-frontpage-maps-sidebar-nav-active');
      log(TAG, 'Sidebar closed');
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
          log(TAG, 'Nav closed after category click');
        }, 150);
      });
    });
  }

  // -----------------------------------------------------------
  // 4. Login-Button: OAuth im Popup-Fenster öffnen
  //
  //    Problem: miniOrange definiert moOAuthLoginNew() NACH unserer
  //    Injection → ein einfaches Überschreiben wird von WP überschrieben.
  //    Lösung: Object.defineProperty Setter-Trap auf window.moOAuthLoginNew.
  //
  //    Statt window.top.location.href (lädt ganze App neu) senden wir
  //    postMessage an den Top-Frame. tnet-header.js öffnet ein Popup,
  //    nach OAuth-Callback wird nur der iframe refresht.
  // -----------------------------------------------------------

  // Property-Trap: moOAuthLoginNew abfangen BEVOR miniOrange sie definiert
  (function _installOAuthTrap() {
    var _trapped = false;
    var _originalFn = null;

    Object.defineProperty(window, 'moOAuthLoginNew', {
      configurable: true,
      enumerable: true,
      set: function(fn) {
        if (!_trapped) {
          _trapped = true;
          log(TAG, 'moOAuthLoginNew Setter-Trap ausgelöst — miniOrange-Funktion abgefangen');
        }
        _originalFn = fn; // Original merken (für Debug)
      },
      get: function() {
        // Immer unseren Wrapper zurückgeben
        return function(appName, extraParam) {
          log(TAG, 'moOAuthLoginNew aufgerufen (app=' + appName + ') → _requestOAuthPopup()');
          _requestOAuthPopup();
        };
      }
    });
    log(TAG, 'moOAuthLoginNew Property-Trap installiert');
  })();

  function setupLoginButton() {
    // onclick entfernen — Property-Trap fängt moOAuthLoginNew() trotzdem ab,
    // aber direkter Click-Handler ist sauberer
    var btns = document.querySelectorAll('a.oauthloginbutton, [class*="oauthloginbutton"]');
    btns.forEach(function (btn) {
      if (btn.dataset.proxyLoginBound) return;
      btn.dataset.proxyLoginBound = '1';
      btn.removeAttribute('onclick');
      btn.onclick = null;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        log(TAG, 'Login-Button geklickt → _requestOAuthPopup()');
        _requestOAuthPopup();
      }, true);
      log(TAG, 'Login-Button gebunden');
    });
  }

  function _requestOAuthPopup() {
    // postMessage an Top-Frame senden.
    // tnet-header.js öffnet ein Popup-Fenster für den OAuth-Flow
    // und refresht danach nur den iframe (kein ganzer App-Reload).
    var base = 'https://www.gis-daten.ch';
    var callbackUrl = base + getAppRoot() + '/tnet/views/oauth-callback.html';
    var oauthUrl = base + '/?option=oauthredirect&app_name=adfs&redirect_url=' + encodeURIComponent(callbackUrl);
    console.log(TAG, 'OAuth → postMessage an top (Popup-Request)');
    console.log(TAG, '  callback URL:', callbackUrl);
    console.log(TAG, '  OAuth    URL:', oauthUrl);
    try {
      window.top.postMessage({ type: 'tnet-oauth-popup', url: oauthUrl }, '*');
    } catch(e) {
      // Fallback: direkt im Top-Frame navigieren
      console.warn(TAG, 'postMessage fehlgeschlagen, Fallback: window.top.location');
      window.top.location.href = oauthUrl;
    }
  }

  // -----------------------------------------------------------
  // 5. Karten-Suchfeld: Volltext-Filter der Karten-Kacheln rechts
  //    Scannt DOM bei jedem Tastendruck komplett neu — funktioniert
  //    auch nach Login wenn sich der Inhalt ändert.
  // -----------------------------------------------------------
  function setupSearchFilter() {
    if (document.getElementById('tnet-map-search')) return; // bereits vorhanden

    var input = document.createElement('input');
    input.id = 'tnet-map-search';
    input.type = 'text';
    input.placeholder = 'Karte suchen\u2026';
    document.body.appendChild(input);

    input.addEventListener('input', function () {
      var query = input.value.toLowerCase().trim();
      _filterMapCards(query);
    });
    log(TAG, 'Suchfeld eingefügt');
  }

  /**
   * Volltext-Filter für Karten-Kacheln (rechte Seite).
   *
   * Die WP-Seite hat folgende Struktur:
   *   .cdt-maps-archive-term         (Sektion, z.B. "Grundkarten")
   *     .cdt-maps-archive-term-title  > h2
   *     .cdt-maps-archive-term-maps   (Grid-Container)
   *       > [card 1]                  (direkte Kinder = Karten)
   *       > [card 2]
   *       > ...
   *
   * Karten werden per AJAX dynamisch geladen.
   * → Direkte Kinder von .cdt-maps-archive-term-maps sind die Karten.
   * → display:none auf der ganzen Karte → Inhalt bleibt komplett intakt.
   */
  function _filterMapCards(query) {
    // Alle Karten = direkte Kinder der Grid-Container
    var grids = document.querySelectorAll('.cdt-maps-archive-term-maps');
    if (grids.length === 0) {
      log(TAG, 'Keine .cdt-maps-archive-term-maps Container gefunden');
      return;
    }

    var cards = [];
    grids.forEach(function (grid) {
      for (var i = 0; i < grid.children.length; i++) {
        cards.push(grid.children[i]);
      }
    });

    log(TAG, 'filterMapCards: query="' + (query || '') + '", cards=' + cards.length + ', grids=' + grids.length);

    // Kein Suchbegriff → alles wieder anzeigen
    if (!query) {
      cards.forEach(function (c) { c.style.removeProperty('display'); });
      // Sektionen wieder einblenden
      var sections = document.querySelectorAll('.cdt-maps-archive-term');
      sections.forEach(function (s) { s.style.removeProperty('display'); });
      return;
    }

    // Volltext-Filter: ganzen Card-Text prüfen (Titel + Beschreibung + alles)
    cards.forEach(function (card) {
      var text = (card.textContent || '').toLowerCase();
      if (text.indexOf(query) !== -1) {
        card.style.removeProperty('display');
      } else {
        card.style.display = 'none';
      }
    });

    // Leere Sektionen komplett ausblenden
    _hideEmptySections(cards);
  }

  /**
   * Sektionen (.cdt-maps-archive-term) komplett ausblenden,
   * wenn alle enthaltenen Karten durch die Suche versteckt sind.
   * Sidebar springt nicht dank CSS min-height auf Container.
   */
  function _hideEmptySections(cards) {
    var sections = document.querySelectorAll('.cdt-maps-archive-term');
    sections.forEach(function (section) {
      // Prüfe ob irgendeine Karte in dieser Sektion noch sichtbar ist
      var anyVisible = false;
      for (var i = 0; i < cards.length; i++) {
        if (section.contains(cards[i]) && cards[i].style.display !== 'none') {
          anyVisible = true;
          break;
        }
      }

      if (anyVisible) {
        section.style.removeProperty('display');
      } else {
        section.style.display = 'none';
      }
    });
  }

  // -----------------------------------------------------------
  // Init: Warte auf DOM-Ready, dann mit Retry (WP lädt nach)
  // -----------------------------------------------------------
  function init() {
    log(TAG, 'Init');
    rewriteLinks();
    setupButtonHandler();
    setupSidebarToggle();
    setupLoginButton();
    setupSearchFilter();
  }

  function initWithRetry() {
    init();
    // WordPress rendert Content teils verzögert (AJAX, Tab-Switch)
    // Mehrere Retries um auch spät geladene OW-Inhalte zu erfassen
    setTimeout(init, 500);
    setTimeout(init, 1500);
    setTimeout(init, 3000);
    setTimeout(init, 5000);
  }

  // -----------------------------------------------------------
  // MutationObserver: Neue Links automatisch umschreiben
  // Wenn WP per AJAX Content nachlädt (z.B. OW-Kacheln)
  // -----------------------------------------------------------
  function setupLinkObserver() {
    if (typeof MutationObserver === 'undefined') return;
    var debounceTimer = null;
    var observer = new MutationObserver(function (mutations) {
      // Prüfe ob neue Links hinzugekommen sind
      var hasNewLinks = false;
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          // Ist es ein Link oder enthält es Links?
          if (node.tagName === 'A' || (node.querySelector && node.querySelector('a'))) {
            hasNewLinks = true;
            break;
          }
        }
        if (hasNewLinks) break;
      }
      if (!hasNewLinks) return;
      // Debounce: nicht bei jedem einzelnen Node triggern
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        log(TAG, 'MutationObserver: Neue Links erkannt, rewriteLinks()');
        rewriteLinks();
      }, 200);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    log(TAG, 'MutationObserver für Link-Erkennung gestartet');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initWithRetry();
      setupLinkObserver();
    });
  } else {
    initWithRetry();
    setupLinkObserver();
  }

})();
