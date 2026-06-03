/**
 * proxy-button-handler.js
 * JavaScript für Button-Interaktivität in der gis-daten.ch Kartenseite
 * Wird vom active-maps-proxy.php injiziert
 *
 * @version    3.0
 * @date       2026-02-13
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

(function() {
    console.log('[proxy] v3 - Starte Button-Listener Setup');
    
    function setupButtons() {
        var buttons = document.querySelectorAll(
            'button.cdt-frontpage-maps-header-buttons-nw, button.cdt-frontpage-maps-header-buttons-ow'
        );
        console.log('[proxy] Buttons gefunden: ' + buttons.length);
        
        if (buttons.length === 0) return false;
        
        buttons.forEach(function(btn) {
            // Verhindere doppeltes Binden
            if (btn.dataset.proxyBound) return;
            btn.dataset.proxyBound = 'true';
            
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                var isOW = btn.classList.contains('cdt-frontpage-maps-header-buttons-ow');
                var newActiveMap = isOW ? 'ow' : 'nw';
                
                console.log('[proxy] Button geklickt: active-map=' + newActiveMap);
                
                // Strategie 1: Parent-URL aktualisieren (wenn in iframe)
                try {
                    if (window.parent !== window) {
                        var parentUrl = window.parent.location.href;
                        console.log('[proxy] Parent-URL: ' + parentUrl);
                        
                        // group Parameter aktualisieren in der Parent-URL
                        var newUrl = parentUrl.replace(/([?&])group=[^&]*/g, '');
                        // Doppelte & oder ? aufräumen
                        newUrl = newUrl.replace(/[?&]$/, '').replace(/\?&/, '?');
                        var sep = newUrl.indexOf('?') !== -1 ? '&' : '?';
                        window.parent.location.href = newUrl + sep + 'group=' + newActiveMap;
                        return false;
                    }
                } catch(err) {
                    console.log('[proxy] Parent nicht erreichbar: ' + err.message);
                }
                
                // Strategie 2: Proxy-URL direkt navigieren (Standalone)
                window.location.href = window.location.pathname + '?group=' + newActiveMap;
                return false;
            }, true); // useCapture=true für höchste Priorität
        });
        
        console.log('[proxy] ' + buttons.length + ' Buttons gebunden');
        return true;
    }
    
    // Versuche Button-Setup mehrfach (WordPress lädt dynamisch nach)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupButtons);
    } else {
        if (!setupButtons()) {
            setTimeout(setupButtons, 300);
            setTimeout(setupButtons, 800);
            setTimeout(setupButtons, 2000);
        }
    }
    
    console.log('[proxy] Button-Listener Setup initiiert');
})();
