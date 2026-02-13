/**
 * tnet-mapplus-helpers.js
 * Hilfsfunktionen für inframe-maps.html
 *
 * @version    1.0
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

/**
 * Extrahiert URL-Parameter aus einer URL
 * @param {string} url - Vollständige URL
 * @returns {string} - Query-String ohne "?"
 */
function extractUrlParams(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.search.substring(1);
  } catch (e) {
    return '';
  }
}

/**
 * Wandelt /secmap/xyz URLs in /maps?map=xyz&group=uwpro um
 * @param {string} href - Original URL
 * @returns {string} - Konvertierte URL
 */
function convertSecmapUrl(href) {
  if (href.includes('/secmap/')) {
    const match = href.match(/^(.+?)\/secmap\/([^?#]+)(.*)$/);
    if (match) {
      const domain = match[1];
      const mapName = match[2];
      const rest = match[3] || '';
      if (rest && rest.startsWith('?')) {
        return `${domain}/maps?map=${mapName}${rest}&group=uwpro`;
      } else {
        return `${domain}/maps?map=${mapName}&group=uwpro`;
      }
    }
  }
  return href;
}

/**
 * Wandelt /map/xyz URLs in /maps?map=xyz um
 * @param {string} href - Original URL
 * @returns {string} - Konvertierte URL
 */
function convertMapUrl(href) {
  if (href.includes('/map/')) {
    const match = href.match(/^(.+?)\/map\/([^?#]+)(.*)$/);
    if (match) {
      const domain = match[1];
      const mapName = match[2];
      const rest = match[3] || '';
      if (rest && rest.startsWith('?')) {
        return `${domain}/maps?map=${mapName}${rest}`;
      } else {
        return `${domain}/maps?map=${mapName}`;
      }
    }
  }
  return href;
}

/**
 * Konvertiert alle URL-Formate
 * @param {string} href - Original URL
 * @returns {string} - Konvertierte URL
 */
function convertUrl(href) {
  let result = href;
  result = convertSecmapUrl(result);
  result = convertMapUrl(result);
  return result;
}

/**
 * Prüft ob URL einen group=*pro Parameter enthält
 * @param {string} url - URL zum Prüfen
 * @returns {boolean} - true wenn group=*pro gefunden
 */
function hasProGroup(url) {
  return /[?&]group=[^&]*pro(&|$|#)/.test(url);
}

/**
 * Verarbeitet alle Links im extrahierten Content
 * @param {string} selector - CSS Selector für Links
 */
function processExtractedLinks(selector) {
  const allLinks = document.querySelectorAll(selector);
  
  allLinks.forEach(link => {
    // Entferne target="_blank"
    if (link.getAttribute('target') === '_blank') {
      link.removeAttribute('target');
    }
    
    let onclick = link.getAttribute('onclick');
    let href = link.getAttribute('href');
    
    // Fall 1: Link hat bereits onclick mit setMapBookmark - ersetze durch TnetSetBookmark
    if (onclick && onclick.includes('setMapBookmark')) {
      // HTML-Entities dekodieren (z.B. &amp; -> &)
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = onclick;
      const decodedOnclick = tempDiv.textContent;
      
      // Extrahiere Parameter aus setMapBookmark(['main'], 'map=XXX&group=YYY')
      const match = decodedOnclick.match(/setMapBookmark\s*\(\s*\[[^\]]*\]\s*,\s*['"]([^'"]+)['"]\s*\)/);
      if (match && match[1]) {
        const params = match[1]; // z.B. "map=nw_nutzungsplanung_intern&group=uwpro"
        const urlParams = extractUrlParams(params);
        const bookmarkId = urlParams.map; // z.B. "nw_nutzungsplanung_intern"
        
        if (bookmarkId) {
          // Ersetze onclick mit TnetSetBookmark Aufruf
          link.setAttribute('onclick', `TnetSetBookmark('${bookmarkId}'); window.top.closeMapsInfoDialog(); return false;`);
        }
      }
      return;
    }
    
    // Fall 2: Link hat href - konvertiere URL und erstelle TnetSetBookmark Aufruf
    if (href) {
      // URL konvertieren
      href = convertUrl(href);
      
      // Wandle HTTP(S) Links in TnetSetBookmark-Aufrufe um
      if (href.startsWith('http')) {
        const params = extractUrlParams(href);
        const bookmarkId = params.map;
        
        if (bookmarkId) {
          link.setAttribute('href', 'javascript:void(null)');
          link.setAttribute('style', (link.getAttribute('style') || '') + '; cursor: pointer;');
          link.setAttribute('onclick', `TnetSetBookmark('${bookmarkId}'); window.top.closeMapsInfoDialog(); return false;`);
        } else {
          // Fallback: Alter setMapBookmark Aufruf wenn keine map-ID gefunden
          link.setAttribute('href', 'javascript:void(null)');
          link.setAttribute('style', (link.getAttribute('style') || '') + '; cursor: pointer;');
          link.setAttribute('onclick', `window.top.njs.AppManager.setMapBookmark(['main'], '${params}'); window.top.closeMapsInfoDialog(); return false;`);
        }
      } else {
        link.setAttribute('href', href);
      }
    }
  });
}

/**
 * Sammelt alle Stylesheets aus einem Dokument
 * @param {Document} doc - Dokument
 * @returns {string} - HTML mit allen Stylesheet-Links
 */
function collectStylesheets(doc) {
  return Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))
    .map(link => `<link rel="stylesheet" href="${link.href}">`)
    .join('\n');
}

/**
 * Sammelt alle inline Styles aus einem Dokument
 * @param {Document} doc - Dokument
 * @returns {string} - HTML mit allen Style-Tags
 */
function collectInlineStyles(doc) {
  return Array.from(doc.querySelectorAll('style'))
    .map(style => `<style>${style.textContent}</style>`)
    .join('\n');
}

/**
 * Versucht Login-Button im iframe zu finden und zu klicken
 * @param {HTMLIFrameElement} iframe - Das iframe Element
 * @returns {boolean} - true wenn Button gefunden und geklickt
 */
function tryAutoLogin(iframe) {
  try {
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    const loginBtn = doc.querySelector('a.oauthloginbutton[onclick*="moOAuthLoginNew"]');
    
    if (loginBtn) {
      loginBtn.click();
      return true;
    }
  } catch(e) {
    // Cross-origin oder iframe noch nicht bereit
  }
  return false;
}

/**
 * TNET Bookmark Funktion - Lädt Map-Konfiguration aus JSON und setzt Layer
 * @param {string} bookmarkId - ID des Bookmarks aus dem map-bookmarks.json (map-bookmark Feld)
 * @param {string} jsonPath - Pfad zum JSON-File (optional, default: '/maps/tnet/map-bookmarks.json')
 * @returns {Promise} - Promise mit den gesetzten Layern
 */
function TnetSetBookmarkJson(bookmarkId, jsonPath = '/maps/tnet/map-bookmarks.json') {
  return fetch(jsonPath)
    .then(response => {
      if (!response.ok) {
        throw new Error('Map-Bookmarks JSON konnte nicht geladen werden: ' + response.statusText);
      }
      return response.json();
    })
    .then(bookmarks => {
      // Suche die Map in der JSON-Struktur (hierarchisch)
      const mapConfig = findMapInHierarchy(bookmarks, bookmarkId);
      
      if (!mapConfig) {
        throw new Error('Bookmark "' + bookmarkId + '" nicht in map-bookmarks.json gefunden');
      }
      
      console.log('TNET Bookmark: Map gefunden:', bookmarkId, mapConfig);
      
      // Baue den Parameter-String für setMapBookmark
      let params = '';
      
      // Basemap hinzufügen wenn vorhanden
      if (mapConfig.basemap) {
        params += 'basemap=' + mapConfig.basemap;
      }
      
      // Layer hinzufügen
      if (mapConfig.layers && mapConfig.layers.length > 0) {
        if (params) params += '&';
        params += 'layers=' + mapConfig.layers.join('|');
      }
      
      // Opacity hinzufügen wenn vorhanden
      if (mapConfig.opacity && mapConfig.opacity.length > 0) {
        params += '&op=' + mapConfig.opacity.join('|');
      }
      
      // Theme hinzufügen wenn vorhanden
      if (mapConfig.theme) {
        params += '&theme=' + mapConfig.theme;
      }
      
      // Subtheme hinzufügen wenn vorhanden
      if (mapConfig.subtheme) {
        params += '&subtheme=' + mapConfig.subtheme;
      }
      
      // Zoom/Position hinzufügen wenn vorhanden
      if (mapConfig.x && mapConfig.y) {
        params += '&x=' + mapConfig.x + '&y=' + mapConfig.y;
        if (mapConfig.zoom) {
          params += '&zl=' + mapConfig.zoom;
        }
      }
      
      console.log('TNET Bookmark: Parameter:', params);
      
      // Rufe setMapBookmark auf
      if (window.top && window.top.njs && window.top.njs.AppManager) {
        window.top.njs.AppManager.setMapBookmark(['main'], params);
        return { success: true, bookmarkId: bookmarkId, params: params };
      } else {
        throw new Error('njs.AppManager nicht verfügbar');
      }
    })
    .catch(error => {
      console.error('TNET Bookmark Fehler:', error);
      return { success: false, error: error.message };
    });
}

/**
 * TNET Bookmark Service Funktion - Lädt Map-Konfiguration vom PHP-Service und setzt Layer
 * @param {string} bookmarkId - ID des Bookmarks (map-bookmark Feld oder Alias)
 * @param {string} serviceUrl - URL zum Bookmark-Service (optional, default: '/maps/tnet/bookmark-service.php')
 * @returns {Promise} - Promise mit den gesetzten Layern
 */
function TnetSetBookmark(bookmarkId, serviceUrl = '/maps/tnet/php/bookmark-service.php') {
  return fetch(serviceUrl + '?name=' + encodeURIComponent(bookmarkId))
    .then(response => {
      if (!response.ok) {
        throw new Error('Bookmark-Service nicht erreichbar: ' + response.statusText);
      }
      return response.json();
    })
    .then(data => {
      // Prüfe ob Service erfolgreich war
      if (!data.success) {
        throw new Error(data.error || 'Bookmark in Service nicht gefunden');
      }
      
      const mapConfig = data.bookmark;
      
      if (!mapConfig) {
        throw new Error('Bookmark "' + bookmarkId + '" nicht in Service gefunden');
      }
      
      console.log('TNET Bookmark Service: Map gefunden:', bookmarkId, mapConfig);
      
      // Baue den Parameter-String für setMapBookmark
      let params = '';
      
      // Basemap hinzufügen wenn vorhanden
      if (mapConfig.basemap) {
        params += 'basemap=' + mapConfig.basemap;
      }
      
      // Layer hinzufügen
      if (mapConfig.layers && mapConfig.layers.length > 0) {
        if (params) params += '&';
        params += 'layers=' + mapConfig.layers.join('|');
      }
      
      // Opacity hinzufügen wenn vorhanden
      if (mapConfig.opacity && mapConfig.opacity.length > 0) {
        params += '&op=' + mapConfig.opacity.join('|');
      }
      
      // Theme hinzufügen wenn vorhanden
      if (mapConfig.theme) {
        params += '&theme=' + mapConfig.theme;
      }
      
      // Subtheme hinzufügen wenn vorhanden
      if (mapConfig.subtheme) {
        params += '&subtheme=' + mapConfig.subtheme;
      }
      
      // Zoom/Position hinzufügen wenn vorhanden
      if (mapConfig.x && mapConfig.y) {
        params += '&x=' + mapConfig.x + '&y=' + mapConfig.y;
        if (mapConfig.zoom) {
          params += '&zl=' + mapConfig.zoom;
        }
      }
      
      console.log('TNET Bookmark Service: Parameter:', params);
      
      // Rufe setMapBookmark auf
      if (window.top && window.top.njs && window.top.njs.AppManager) {
        window.top.njs.AppManager.setMapBookmark(['main'], params);
        return { success: true, bookmarkId: bookmarkId, params: params };
      } else {
        throw new Error('njs.AppManager nicht verfügbar');
      }
    })
    .catch(error => {
      console.error('TNET Bookmark Service Fehler:', error);
      return { success: false, error: error.message };
    });
}

/**
 * Sucht eine Map hierarchisch in der Bookmark-Struktur
 * @param {Object|Array} node - Aktueller Knoten in der Hierarchie
 * @param {string} bookmarkId - Gesuchte Bookmark-ID (map-bookmark Feld)
 * @returns {Object|null} - Map-Konfiguration oder null
 */
function findMapInHierarchy(node, bookmarkId) {
  // Wenn node ein Array ist, durchsuche alle Elemente
  if (Array.isArray(node)) {
    for (let item of node) {
      // Prüfe direkt ob map-bookmark passt
      if (item['map-bookmark'] === bookmarkId) {
        return item;
      }
      // Prüfe ob bookmarkId in aliases enthalten ist
      if (item.aliases && Array.isArray(item.aliases) && item.aliases.includes(bookmarkId)) {
        return item;
      }
      const found = findMapInHierarchy(item, bookmarkId);
      if (found) return found;
    }
    return null;
  }
  
  // Wenn node ein Objekt ist
  if (typeof node === 'object' && node !== null) {
    // Prüfe ob es die gesuchte Map ist
    if (node['map-bookmark'] === bookmarkId || node.id === bookmarkId) {
      return node;
    }
    // Prüfe ob bookmarkId in aliases enthalten ist
    if (node.aliases && Array.isArray(node.aliases) && node.aliases.includes(bookmarkId)) {
      return node;
    }
    
    // Durchsuche children wenn vorhanden
    if (node.children) {
      return findMapInHierarchy(node.children, bookmarkId);
    }
    
    // Durchsuche maps wenn vorhanden (für Root-Level)
    if (node.maps) {
      return findMapInHierarchy(node.maps, bookmarkId);
    }
  }
  
  return null;
}
