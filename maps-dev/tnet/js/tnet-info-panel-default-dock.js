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
    var originalToggleInfoPaneDock = null;
    var observer = null;

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
    }

    function installToggleHook() {
        if (originalToggleInfoPaneDock || typeof window.toggleInfoPaneDock !== 'function') {
            return !!originalToggleInfoPaneDock;
        }

        originalToggleInfoPaneDock = window.toggleInfoPaneDock;
        window.toggleInfoPaneDock = function() {
            return originalToggleInfoPaneDock.apply(this, arguments);
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
        if (defaultDockApplied) {
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
        if (!infoPane || observer) {
            return;
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
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
