/**
 * tnet-info-panel-default-dock.js
 * Konfigurierbares Standard-Andocken der Objektinformation.
 *
 * @version    1.0
 * @date       2026-04-30
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */
(function() {
    'use strict';

    // ===== CONFIG =====
    function isMobileEntry() {
        return window.__TNET_MOBILE_ENTRY === true;
    }

    function getInfoPanelConfig() {
        try {
            return window.TnetGlobalConfig && window.TnetGlobalConfig.infoPanel
                ? window.TnetGlobalConfig.infoPanel
                : {};
        } catch (error) {
            return {};
        }
    }

    function shouldDockByDefault() {
        var config = getInfoPanelConfig();
        return config.defaultDockedRight === true
            || config.defaultDockedRight === 'true'
            || config.defaultDock === 'right'
            || config.defaultMode === 'docked-right';
    }

    // ===== STATE =====
    var defaultDockApplied = false;
    var autoDockRunning = false;
    var userManuallyUndocked = false; // Nutzer hat in DIESER Sitzung bewusst abgedockt
    var originalToggleInfoPaneDock = null;
    var observer = null;
    var observedPane = null;          // aktuell beobachteter Panel-Knoten (kann neu erzeugt werden)

    function isInfoPaneVisible(infoPane) {
        if (!infoPane) {
            return false;
        }
        var style = window.getComputedStyle ? window.getComputedStyle(infoPane) : null;
        if (style) {
            return style.visibility !== 'hidden' && style.display !== 'none';
        }
        return infoPane.style.visibility !== 'hidden' && infoPane.style.display !== 'none';
    }

    function resetDefaultDockState() {
        defaultDockApplied = false;
        // Frische Sitzung (Panel ausgeblendet): manuelles Abdocken vergessen,
        // damit die Objektinfo beim naechsten Oeffnen wieder andockt.
        userManuallyUndocked = false;
    }

    function installToggleHook() {
        if (originalToggleInfoPaneDock || typeof window.toggleInfoPaneDock !== 'function') {
            return !!originalToggleInfoPaneDock;
        }

        originalToggleInfoPaneDock = window.toggleInfoPaneDock;
        window.toggleInfoPaneDock = function() {
            var result = originalToggleInfoPaneDock.apply(this, arguments);
            // Nutzer-initiierter Toggle (nicht der Auto-Dock): merken, ob bewusst
            // ABgedockt wurde, damit der Safety-Enforcer nicht sofort wieder andockt.
            if (!autoDockRunning) {
                var pane = document.getElementById('njs_info_pane');
                userManuallyUndocked = !!(pane && !pane.classList.contains('docked-right'));
            }
            return result;
        };
        return true;
    }

    function applyDefaultDock(infoPane) {
        if (isMobileEntry() || !shouldDockByDefault() || !installToggleHook()) {
            return;
        }
        if (!isInfoPaneVisible(infoPane)) {
            resetDefaultDockState();
            return;
        }
        // window.isInfoPaneDocked wird nicht durch alle Schliess-Pfade (Dojo widget.close)
        // korrekt zurueckgesetzt und ist daher kein zuverlaessiger Indikator.
        // docked-right CSS-Klasse ist der einzige robuste DOM-Zustand.
        if (infoPane.classList.contains('docked-right')) {
            defaultDockApplied = true;
            return;
        }
        // Bereits in dieser Sichtbarkeits-Sitzung angedockt ODER vom Nutzer bewusst
        // abgedockt: nicht (erneut) andocken.
        if (defaultDockApplied || userManuallyUndocked) {
            return;
        }

        defaultDockApplied = true;
        autoDockRunning = true;
        try {
            originalToggleInfoPaneDock.call(window);
        } finally {
            autoDockRunning = false;
        }
    }

    // ===== OBSERVER =====
    function attachObserver(infoPane) {
        if (!infoPane) {
            return;
        }
        // Bereits korrekt mit DIESEM Knoten verbunden: nichts zu tun.
        if (observer && observedPane === infoPane) {
            return;
        }
        // Panel-Knoten wurde neu erzeugt (z.B. Kartenwechsel): alten Observer
        // loesen und den Dock-Zustand fuer den frischen Knoten neu bewerten.
        var nodeChanged = observedPane && observedPane !== infoPane;
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        observedPane = infoPane;
        if (nodeChanged) {
            defaultDockApplied = false;
            userManuallyUndocked = false;
        }

        var _prevVisible = isInfoPaneVisible(infoPane);

        observer = new MutationObserver(function() {
            var nowVisible = isInfoPaneVisible(infoPane);

            if (!nowVisible) {
                // Panel wird ausgeblendet (Schliessen): Dock-State zuruecksetzen,
                // damit beim naechsten Oeffnen erneut angedockt wird.
                resetDefaultDockState();
            } else if (!_prevVisible) {
                // Transition hidden -> visible (Oeffnen): defaultDockApplied
                // zuruecksetzen, damit der Auto-Dock bei JEDEM Oeffnen greift.
                defaultDockApplied = false;
                userManuallyUndocked = false;
            }
            // WICHTIG: KEIN Re-Dock wenn nur die docked-right-Klasse entfernt wird
            // (manuelles Abdocken durch den Nutzer ODER Klassen-Entfernung waehrend
            // des Schliessens). Sonst dockt das Panel beim Schliessen erneut an und
            // oeffnet danach inkonsistent. Andocken erfolgt ausschliesslich ueber die
            // Hidden->Visible-Transition oben.

            _prevVisible = nowVisible;
            applyDefaultDock(infoPane);
        });
        observer.observe(infoPane, {
            attributes: true,
            attributeFilter: ['style', 'class'],
        });
        _prevVisible = isInfoPaneVisible(infoPane);
        applyDefaultDock(infoPane);
    }

    function init() {
        if (isMobileEntry()) {
            return;
        }

        var attempts = 0;
        var hookInstalled = false;
        var timer = setInterval(function() {
            attempts += 1;

            // Hook so frueh wie moeglich installieren — toggleInfoPaneDock kann
            // erst nach tnet-info-panel.js verfuegbar sein (Race-Condition).
            if (!hookInstalled) {
                hookInstalled = installToggleHook();
            }

            var infoPane = document.getElementById('njs_info_pane');
            if (infoPane) {
                // Observer sofort attachen sobald pane im DOM vorhanden;
                // Timer aber erst stoppen wenn auch der Hook installiert ist.
                attachObserver(infoPane);
                if (hookInstalled) {
                    clearInterval(timer);
                    return;
                }
            }

            if (attempts >= 80) {
                clearInterval(timer);
            }
        }, 250);

        // Safety-Enforcer: faengt verpasste Hidden->Visible-Transitionen UND neu
        // erzeugte Panel-Knoten ab. Garantiert, dass die Objektinfo bei jedem
        // Oeffnen angedockt ist (Anforderung: nach App-Start IMMER angedockt),
        // solange der Nutzer nicht in dieser Sitzung bewusst abgedockt hat.
        setInterval(function() {
            if (isMobileEntry() || !shouldDockByDefault()) {
                return;
            }
            var infoPane = document.getElementById('njs_info_pane');
            if (!infoPane) {
                return;
            }
            installToggleHook();
            // Observer ggf. an den (neuen) Knoten anbinden.
            if (infoPane !== observedPane) {
                attachObserver(infoPane);
            }
            // applyDefaultDock respektiert defaultDockApplied + userManuallyUndocked,
            // dockt also nur wenn noetig und nie gegen eine bewusste Nutzer-Aktion.
            applyDefaultDock(infoPane);
        }, 300);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
