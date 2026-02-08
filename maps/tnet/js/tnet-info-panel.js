/**
 * tnet-info-panel.js (ES Module)
 * Info-Panel Erweiterungen: Buttons (Clipboard, Dock, Close), Resize-Handles,
 * Dock/Undock-Logik mit mapContainer-Anpassung, MutationObserver
 */

// ===== INFO PANE ERWEITERUNGEN =====
// Buttons zum Info-Panel hinzufügen und Resize aktivieren
// Verwendet MutationObserver um auch bei Neuöffnen zu funktionieren
function initInfoPaneEnhancements() {

    function enhanceInfoPane() {
        var infoPane = document.getElementById('njs_info_pane');
        if (!infoPane) return false;

        var titleBar = infoPane.querySelector('.dojoxFloatingPaneTitle');
        if (!titleBar) return false;

        // Prüfe ob Actions bereits vorhanden
        if (titleBar.querySelector('.info-pane-actions')) {
            // Actions vorhanden - aber Resize-Handles prüfen
            if (!infoPane.querySelector('.info-pane-resize-left')) {
                initInfoPaneResize(infoPane);
            }
            return true;
        }

        // Actions Container erstellen
        var actions = document.createElement('div');
        actions.className = 'info-pane-actions';

        // Clipboard Button
        var clipboardBtn = document.createElement('button');
        clipboardBtn.className = 'info-pane-btn';
        clipboardBtn.title = 'In Zwischenablage kopieren';
        clipboardBtn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 21H8V7h11m0-2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2m-3-4H4a2 2 0 0 0-2 2v14h2V3h12V1Z"/></svg>';
        clipboardBtn.onclick = function(e) {
            e.stopPropagation();
            copyInfoPaneToClipboard();
        };

        // Dock Button
        var dockBtn = document.createElement('button');
        dockBtn.className = 'info-pane-btn';
        dockBtn.id = 'info-pane-dock-btn';
        dockBtn.title = 'Rechts andocken';
        dockBtn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16h-4V5h4v14z"/></svg>';
        dockBtn.onclick = function(e) {
            e.stopPropagation();
            toggleInfoPaneDock();
        };

        // Close Button (custom, da original versteckt)
        var closeBtn = document.createElement('button');
        closeBtn.className = 'info-pane-btn info-pane-close';
        closeBtn.title = 'Schließen';
        closeBtn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>';
        closeBtn.onclick = function(e) {
            e.stopPropagation();
            // Falls angedockt, mapContainer zurücksetzen
            if (isInfoPaneDocked) {
                var mapContainer = document.getElementById('mapContainer');
                if (mapContainer) {
                    mapContainer.style.setProperty('width', '100%', 'important');
                    setTimeout(function() {
                        triggerMapUpdate();
                    }, 100);
                }
                stopMapContainerObserver();
                isInfoPaneDocked = false;
                infoPane.classList.remove('docked-right');
            }
            // Dojo FloatingPane close aufrufen
            var widget = dijit.byId('njs_info_pane');
            if (widget && widget.close) {
                widget.close();
            } else {
                infoPane.style.visibility = 'hidden';
            }
        };

        actions.appendChild(clipboardBtn);
        actions.appendChild(dockBtn);
        actions.appendChild(closeBtn);

        // Actions ans Ende des Headers
        titleBar.appendChild(actions);

        // Custom Resize-Handle hinzufügen
        initInfoPaneResize(infoPane);

        return true;
    }

    // Initial versuchen
    enhanceInfoPane();

    // MutationObserver für DOM-Änderungen
    var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList' || mutation.type === 'attributes') {
                var infoPane = document.getElementById('njs_info_pane');
                if (infoPane && infoPane.style.visibility !== 'hidden') {

                    // ÖREB-Modus: Info-Pane sofort schliessen (keine Objektinfo während ÖREB)
                    if (window.isOerebActive) {
                        infoPane.style.visibility = 'hidden';
                        return;
                    }

                    enhanceInfoPane();

                    // Falls angedockt, Position und Breite SOFORT wiederherstellen (verhindert Flackern)
                    if (isInfoPaneDocked && infoPane.classList.contains('docked-right')) {
                        var savedWidth = window._savedDockedPanelWidth || 350;
                        var streetviewContainer = document.getElementById('streetviewContainer');
                        var centerPane = document.getElementById('centerPaneLayout');
                        var streetviewWidth = 0;
                        if (streetviewContainer && streetviewContainer.offsetWidth > 0 && streetviewContainer.style.display !== 'none') {
                            streetviewWidth = streetviewContainer.offsetWidth;
                        }

                        infoPane.style.setProperty('width', savedWidth + 'px', 'important');
                        infoPane.style.setProperty('right', streetviewWidth + 'px', 'important');

                        var mapContainer = document.getElementById('mapContainer');
                        if (mapContainer) {
                            // Absolute Breite berechnen
                            var centerPaneWidth = centerPane ? centerPane.offsetWidth : window.innerWidth;
                            var mapWidth = centerPaneWidth - streetviewWidth - savedWidth;
                            mapContainer.style.setProperty('width', mapWidth + 'px', 'important');
                        }
                    }
                }
            }
        });
    });

    // Beobachte body für neue Elemente
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
    });

    // Regelmäßig prüfen (Fallback - seltener da MutationObserver jetzt Hauptarbeit macht)
    setInterval(function() {
        var infoPane = document.getElementById('njs_info_pane');
        if (infoPane && infoPane.style.visibility === 'visible') {
            enhanceInfoPane();
        }
    }, 2000);
}
initInfoPaneEnhancements();

// Custom Resize für Info-Panel
function initInfoPaneResize(pane) {
    // Bestehende Resize-Handles entfernen (falls vorhanden)
    var existingHandles = pane.querySelectorAll('[class*="info-pane-resize"]');
    existingHandles.forEach(function(h) { h.remove(); });
    
    // Alle Resize-Handles erstellen
    var handles = {
        top: createHandle('info-pane-resize-top', 'position:absolute; top:0; left:0; right:0; height:6px; cursor:ns-resize; z-index:1000;'),
        bottom: createHandle('info-pane-resize-bottom', 'position:absolute; bottom:0; left:0; right:0; height:6px; cursor:ns-resize; z-index:1000;'),
        left: createHandle('info-pane-resize-left', 'position:absolute; left:0; top:0; bottom:0; width:8px; cursor:ew-resize; z-index:1000; background:linear-gradient(to right, rgba(75,123,129,0.15), transparent);'),
        right: createHandle('info-pane-resize-right', 'position:absolute; right:0; top:0; bottom:0; width:8px; cursor:ew-resize; z-index:1000; background:linear-gradient(to left, rgba(75,123,129,0.15), transparent);'),
        tl: createHandle('info-pane-resize-corner-tl', 'position:absolute; top:0; left:0; width:12px; height:12px; cursor:nwse-resize; z-index:1001;'),
        tr: createHandle('info-pane-resize-corner-tr', 'position:absolute; top:0; right:0; width:12px; height:12px; cursor:nesw-resize; z-index:1001;'),
        bl: createHandle('info-pane-resize-corner-bl', 'position:absolute; bottom:0; left:0; width:12px; height:12px; cursor:nesw-resize; z-index:1001;')
    };
    
    function createHandle(className, style) {
        var handle = document.createElement('div');
        handle.className = className;
        handle.style.cssText = style;
        pane.appendChild(handle);
        return handle;
    }
    
    var isResizing = false;
    var resizeDirection = '';
    var startX, startY, startWidth, startHeight, startLeft, startTop;
    
    function startResize(e, direction) {
        // Im angedockten Modus nur linken Rand erlauben
        if (pane.classList.contains('docked-right') && direction !== 'left' && direction !== 'tl' && direction !== 'bl') return;
        
        isResizing = true;
        resizeDirection = direction;
        startX = e.clientX;
        startY = e.clientY;
        
        var rect = pane.getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;
        startLeft = rect.left;
        startTop = rect.top;
        
        document.body.style.userSelect = 'none';
        e.preventDefault();
        e.stopPropagation();
    }
    
    // Mousedown für alle Handles
    handles.top.onmousedown = function(e) { startResize(e, 'top'); };
    handles.bottom.onmousedown = function(e) { startResize(e, 'bottom'); };
    handles.left.onmousedown = function(e) { startResize(e, 'left'); };
    handles.right.onmousedown = function(e) { startResize(e, 'right'); };
    handles.tl.onmousedown = function(e) { startResize(e, 'tl'); };
    handles.tr.onmousedown = function(e) { startResize(e, 'tr'); };
    handles.bl.onmousedown = function(e) { startResize(e, 'bl'); };
    
    // Mousemove Handler
    var mouseMoveHandler = function(e) {
        if (!isResizing) return;
        
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        var newWidth = startWidth;
        var newHeight = startHeight;
        
        // Angedockt: nur Breite über linken Rand ändern
        if (pane.classList.contains('docked-right')) {
            if (resizeDirection === 'left' || resizeDirection === 'tl' || resizeDirection === 'bl') {
                newWidth = Math.max(300, Math.min(startWidth - dx, window.innerWidth - 100));
                pane.style.setProperty('width', newWidth + 'px', 'important');
                
                // mapContainer anpassen
                var mapContainer = document.getElementById('mapContainer');
                if (mapContainer && isInfoPaneDocked) {
                    var actualPanelWidth = pane.offsetWidth;
                    mapContainer.style.setProperty('width', 'calc(100% - ' + actualPanelWidth + 'px)', 'important');
                }
            }
            e.preventDefault();
            return;
        }
        
        // Freischwebend: alle Richtungen
        switch(resizeDirection) {
            case 'top':
                newHeight = Math.max(150, startHeight - dy);
                pane.style.setProperty('height', newHeight + 'px', 'important');
                pane.style.setProperty('top', (startTop + dy) + 'px', 'important');
                break;
            case 'bottom':
                newHeight = Math.max(150, startHeight + dy);
                pane.style.setProperty('height', newHeight + 'px', 'important');
                break;
            case 'left':
                newWidth = Math.max(350, startWidth - dx);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                pane.style.setProperty('left', (startLeft + dx) + 'px', 'important');
                break;
            case 'right':
                newWidth = Math.max(350, startWidth + dx);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                break;
            case 'tl':
                newWidth = Math.max(350, startWidth - dx);
                newHeight = Math.max(150, startHeight - dy);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                pane.style.setProperty('height', newHeight + 'px', 'important');
                pane.style.setProperty('left', (startLeft + dx) + 'px', 'important');
                pane.style.setProperty('top', (startTop + dy) + 'px', 'important');
                break;
            case 'tr':
                newWidth = Math.max(350, startWidth + dx);
                newHeight = Math.max(150, startHeight - dy);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                pane.style.setProperty('height', newHeight + 'px', 'important');
                pane.style.setProperty('top', (startTop + dy) + 'px', 'important');
                break;
            case 'bl':
                newWidth = Math.max(350, startWidth - dx);
                newHeight = Math.max(150, startHeight + dy);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                pane.style.setProperty('height', newHeight + 'px', 'important');
                pane.style.setProperty('left', (startLeft + dx) + 'px', 'important');
                break;
            case 'br':
                newWidth = Math.max(350, startWidth + dx);
                newHeight = Math.max(150, startHeight + dy);
                pane.style.setProperty('width', newWidth + 'px', 'important');
                pane.style.setProperty('height', newHeight + 'px', 'important');
                break;
        }
        e.preventDefault();
    };
    
    var mouseUpHandler = function() {
        if (isResizing) {
            // Nach Resize Map aktualisieren falls angedockt
            if (pane.classList.contains('docked-right')) {
                triggerMapUpdate();
            }
            isResizing = false;
            resizeDirection = '';
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    };
    
    // Alte Handler entfernen falls vorhanden
    if (window._infoPaneMouseMove) {
        document.removeEventListener('mousemove', window._infoPaneMouseMove);
    }
    if (window._infoPaneMouseUp) {
        document.removeEventListener('mouseup', window._infoPaneMouseUp);
    }
    
    // Neue Handler speichern und registrieren
    window._infoPaneMouseMove = mouseMoveHandler;
    window._infoPaneMouseUp = mouseUpHandler;
    
    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);
    
    // CSS-Sichtbarkeit wird über CSS gesteuert - die .docked-right Klasse verbirgt die nicht-benötigten Handles automatisch
}

// Info-Panel Inhalt in Zwischenablage kopieren
window.copyInfoPaneToClipboard = function() {
    var content = document.getElementById('njs_info_pane_content');
    if (!content) return;
    
    // Versuche Tabellen-Daten zu extrahieren
    var tables = content.querySelectorAll('table');
    var text = '';
    
    if (tables.length > 0) {
        tables.forEach(function(table, idx) {
            if (idx > 0) text += '\n\n';
            
            // Titel falls vorhanden
            var prevEl = table.previousElementSibling;
            if (prevEl && (prevEl.tagName === 'H3' || prevEl.tagName === 'H4' || prevEl.className.indexOf('title') > -1)) {
                text += prevEl.textContent.trim() + '\n';
                text += '='.repeat(prevEl.textContent.trim().length) + '\n';
            }
            
            var rows = table.querySelectorAll('tr');
            rows.forEach(function(row) {
                var cells = row.querySelectorAll('td, th');
                var rowText = [];
                cells.forEach(function(cell) {
                    rowText.push(cell.textContent.trim());
                });
                text += rowText.join('\t') + '\n';
            });
        });
    } else {
        // Fallback: Nur Text
        text = content.textContent.trim();
    }
    
    // In Zwischenablage kopieren
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
            showCopyNotification('In Zwischenablage kopiert!');
        }).catch(function(err) {
            console.error('Clipboard Error:', err);
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
};

function fallbackCopy(text) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showCopyNotification('In Zwischenablage kopiert!');
    } catch (err) {
        alert('Kopieren fehlgeschlagen');
    }
    document.body.removeChild(textarea);
}

function showCopyNotification(message) {
    var notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:#4b7b81;color:white;padding:10px 20px;border-radius:4px;z-index:10000;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
    document.body.appendChild(notification);
    setTimeout(function() {
        notification.style.transition = 'opacity 0.3s';
        notification.style.opacity = '0';
        setTimeout(function() {
            document.body.removeChild(notification);
        }, 300);
    }, 2000);
}

// Info-Panel andocken/abdocken
var isInfoPaneDocked = false;
var savedInfoPanePosition = null;

// Hilfsfunktion um Map-Update zu triggern
function triggerMapUpdate() {
    setTimeout(function() {
        // Neapolis/OpenLayers Map
        if (window.njs && njs.AppManager && njs.AppManager.Maps && njs.AppManager.Maps['main']) {
            var mapObj = njs.AppManager.Maps['main'].mapObj;
            if (mapObj && mapObj.updateSize) {
                mapObj.updateSize();
            }
        }
        // Dijit Layout Container neu berechnen
        if (typeof dijit !== 'undefined' && dijit.byId('NeapolisContainer')) {
            dijit.byId('NeapolisContainer').resize();
        }
    }, 350);
}

window.toggleInfoPaneDock = function() {
    var infoPane = document.getElementById('njs_info_pane');
    var dockBtn = document.getElementById('info-pane-dock-btn');
    var mapContainer = document.getElementById('mapContainer');
    if (!infoPane) return;
    
    if (isInfoPaneDocked) {
        // Undock - zurück zur gespeicherten Position oder Default
        infoPane.classList.remove('docked-right');
        
        // Observer stoppen
        stopMapContainerObserver();
        
        // mapContainer wieder auf volle Breite
        if (mapContainer) {
            mapContainer.style.setProperty('width', '100%', 'important');
            setTimeout(function() {
                triggerMapUpdate();
            }, 100);
        }
        
        if (savedInfoPanePosition) {
            infoPane.style.setProperty('top', savedInfoPanePosition.top, 'important');
            infoPane.style.setProperty('left', savedInfoPanePosition.left, 'important');
            infoPane.style.setProperty('width', savedInfoPanePosition.width, 'important');
            infoPane.style.setProperty('height', savedInfoPanePosition.height, 'important');
        } else {
            infoPane.style.setProperty('top', '150px', 'important');
            infoPane.style.setProperty('left', '400px', 'important');
            infoPane.style.setProperty('width', '720px', 'important');
            infoPane.style.setProperty('height', '360px', 'important');
        }
        infoPane.style.setProperty('right', 'auto', 'important');
        infoPane.style.setProperty('bottom', 'auto', 'important');
        infoPane.style.setProperty('position', 'absolute', 'important');
        infoPane.style.maxHeight = '';
        
        if (dockBtn) {
            dockBtn.title = 'Rechts andocken';
            dockBtn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16h-4V5h4v14z"/></svg>';
        }
        isInfoPaneDocked = false;
    } else {
        // Position speichern vor dem Andocken
        savedInfoPanePosition = {
            top: infoPane.style.top || '150px',
            left: infoPane.style.left || '400px',
            width: infoPane.style.width || '720px',
            height: infoPane.style.height || '360px'
        };
        
        // Dock - Panel rechts am centerPaneLayout, mapContainer passt sich an
        infoPane.classList.add('docked-right');
        
        if (mapContainer) {
            // Gespeicherte Breite verwenden falls vorhanden, sonst 350px
            var panelWidth = window._savedDockedPanelWidth || 350;
            var centerPane = document.getElementById('centerPaneLayout');
            var streetviewContainer = document.getElementById('streetviewContainer');
            
            // Berechne den rechten Offset (falls StreetView offen)
            var streetviewWidth = 0;
            if (streetviewContainer && streetviewContainer.offsetWidth > 0 && streetviewContainer.style.display !== 'none') {
                streetviewWidth = streetviewContainer.offsetWidth;
            }
            
            // Panel am rechten Rand positionieren (neben StreetView falls offen)
            var centerRect = centerPane ? centerPane.getBoundingClientRect() : mapContainer.getBoundingClientRect();
            infoPane.style.setProperty('position', 'fixed', 'important');
            infoPane.style.setProperty('top', centerRect.top + 'px', 'important');
            infoPane.style.setProperty('right', streetviewWidth + 'px', 'important');
            infoPane.style.setProperty('bottom', (window.innerHeight - centerRect.bottom) + 'px', 'important');
            infoPane.style.setProperty('left', 'auto', 'important');
            infoPane.style.setProperty('width', panelWidth + 'px', 'important');
            infoPane.style.setProperty('height', 'auto', 'important');
            
            // mapContainer verkleinern: Absolute Berechnung
            var centerPaneWidth = centerPane ? centerPane.offsetWidth : window.innerWidth;
            var mapWidth = centerPaneWidth - streetviewWidth - panelWidth;
            mapContainer.style.setProperty('width', mapWidth + 'px', 'important');
            triggerMapUpdate();
        }
        
        // Observer für Layout-Änderungen starten (passt Panel an wenn StreetView etc. geöffnet wird)
        startMapContainerObserver();
        
        if (dockBtn) {
            dockBtn.title = 'Floating';
            dockBtn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/></svg>';
        }
        isInfoPaneDocked = true;
    }
    
    // Container-Breite bei Panel-Resize synchron halten
    updateContainerForInfoPane();
};

// Observer für Layout-Änderungen (z.B. wenn StreetView geöffnet wird)
var mapContainerObserver = null;
var streetviewObserver = null;
function startMapContainerObserver() {
    if (mapContainerObserver) mapContainerObserver.disconnect();
    if (streetviewObserver) streetviewObserver.disconnect();
    
    var mapContainer = document.getElementById('mapContainer');
    var streetviewContainer = document.getElementById('streetviewContainer');
    var infoPane = document.getElementById('njs_info_pane');
    if (!mapContainer || !infoPane) return;
    
    // ResizeObserver für Größenänderungen des mapContainer
    if (window.ResizeObserver) {
        mapContainerObserver = new ResizeObserver(function() {
            if (!isInfoPaneDocked) return;
            updateDockedInfoPanePosition();
        });
        mapContainerObserver.observe(mapContainer);
        
        // Auch streetviewContainer beobachten
        if (streetviewContainer) {
            streetviewObserver = new ResizeObserver(function() {
                if (!isInfoPaneDocked) return;
                updateDockedInfoPanePosition();
            });
            streetviewObserver.observe(streetviewContainer);
        }
    }
    
    // Auch auf Window-Resize reagieren
    window.addEventListener('resize', updateDockedInfoPanePosition);
}

function stopMapContainerObserver() {
    if (mapContainerObserver) {
        mapContainerObserver.disconnect();
        mapContainerObserver = null;
    }
    if (streetviewObserver) {
        streetviewObserver.disconnect();
        streetviewObserver = null;
    }
    window.removeEventListener('resize', updateDockedInfoPanePosition);
}

function updateDockedInfoPanePosition() {
    if (!isInfoPaneDocked) return;
    var mapContainer = document.getElementById('mapContainer');
    var infoPane = document.getElementById('njs_info_pane');
    var centerPane = document.getElementById('centerPaneLayout');
    var streetviewContainer = document.getElementById('streetviewContainer');
    if (!mapContainer || !infoPane) return;
    
    var panelWidth = window._savedDockedPanelWidth || infoPane.offsetWidth || 350;
    
    // Berechne den rechten Offset (falls StreetView offen)
    var streetviewWidth = 0;
    if (streetviewContainer && streetviewContainer.offsetWidth > 0 && streetviewContainer.style.display !== 'none') {
        streetviewWidth = streetviewContainer.offsetWidth;
    }
    
    // Panel-Position aktualisieren - rechts neben StreetView
    var centerRect = centerPane ? centerPane.getBoundingClientRect() : { top: 69, bottom: window.innerHeight - 32 };
    infoPane.style.setProperty('top', centerRect.top + 'px', 'important');
    infoPane.style.setProperty('right', streetviewWidth + 'px', 'important');
    infoPane.style.setProperty('bottom', (window.innerHeight - centerRect.bottom) + 'px', 'important');
    infoPane.style.setProperty('width', panelWidth + 'px', 'important');
    
    // mapContainer-Breite: Absolute Berechnung
    // Verfügbare Breite = centerPaneLayout.width - streetviewWidth - panelWidth
    var centerPaneWidth = centerPane ? centerPane.offsetWidth : window.innerWidth;
    var mapWidth = centerPaneWidth - streetviewWidth - panelWidth;
    mapContainer.style.setProperty('width', mapWidth + 'px', 'important');
    
    triggerMapUpdate();
}

// Funktion um Panel-Position bei Resize zu aktualisieren (ohne Container zu ändern)
function updateContainerForInfoPane() {
    // Nichts zu tun - mapContainer wird nicht mehr verändert
    // Panel passt sich automatisch über updateDockedInfoPanePosition an
}
