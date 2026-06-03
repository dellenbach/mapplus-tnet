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
    var manualDockChoice = false;
    var autoDockRunning = false;
    var originalToggleInfoPaneDock = null;
    var observer = null;

    function isInfoPaneVisible(infoPane) {
        return !!infoPane && infoPane.style.visibility !== 'hidden';
    }

    function resetDefaultDockState() {
        defaultDockApplied = false;
        manualDockChoice = false;
    }

    function installToggleHook() {
        if (originalToggleInfoPaneDock || typeof window.toggleInfoPaneDock !== 'function') {
            return !!originalToggleInfoPaneDock;
        }

        originalToggleInfoPaneDock = window.toggleInfoPaneDock;
        window.toggleInfoPaneDock = function() {
            if (!autoDockRunning) {
                manualDockChoice = true;
            }
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
        if (defaultDockApplied || manualDockChoice || window.isInfoPaneDocked === true || infoPane.classList.contains('docked-right')) {
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

        observer = new MutationObserver(function() {
            applyDefaultDock(infoPane);
        });
        observer.observe(infoPane, {
            attributes: true,
            attributeFilter: ['style', 'class'],
        });
        applyDefaultDock(infoPane);
    }

    function init() {
        if (isMobileEntry()) {
            return;
        }

        var attempts = 0;
        var timer = setInterval(function() {
            attempts += 1;
            installToggleHook();

            var infoPane = document.getElementById('njs_info_pane');
            if (infoPane) {
                attachObserver(infoPane);
                clearInterval(timer);
                return;
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
