/**
 * tnet-3d-landscape-config.js
 * Configuration for 3D Landscape Model
 * 
 * Lädt die zentrale Konfiguration aus tnet-global-config.json5
 * und stellt sie als window.Landscape3DConfig bereit.
 */

(function() {
    'use strict';
    
    /**
     * Einfacher JSON5-Parser
     */
    function parseJSON5Simple(text) {
        if (typeof JSON5 !== 'undefined') {
            return JSON5.parse(text);
        }
        
        var lines = text.split('\n');
        var cleaned = [];
        var inMultilineComment = false;
        
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            
            if (line.indexOf('/*') > -1) {
                inMultilineComment = true;
                line = line.substring(0, line.indexOf('/*'));
            }
            if (inMultilineComment) {
                if (line.indexOf('*/') > -1) {
                    inMultilineComment = false;
                    line = line.substring(line.indexOf('*/') + 2);
                } else {
                    continue;
                }
            }
            
            var commentPos = -1;
            var inString = false;
            var stringChar = null;
            
            for (var j = 0; j < line.length; j++) {
                var c = line[j];
                if ((c === '"' || c === "'") && (j === 0 || line[j-1] !== '\\')) {
                    if (!inString) {
                        inString = true;
                        stringChar = c;
                    } else if (c === stringChar) {
                        inString = false;
                        stringChar = null;
                    }
                }
                
                if (!inString && j < line.length - 1 && line[j] === '/' && line[j+1] === '/') {
                    commentPos = j;
                    break;
                }
            }
            
            if (commentPos > -1) {
                line = line.substring(0, commentPos);
            }
            
            if (line.trim()) {
                cleaned.push(line);
            }
        }
        
        var jsonText = cleaned.join('\n');
        jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');
        jsonText = jsonText.replace(/(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
        
        return JSON.parse(jsonText);
    }
    
    /**
     * Lade Konfiguration aus JSON5-Datei
     */
    function loadConfigFromJson() {
        var possiblePaths = [
            '/maps/tnet/tnet-global-config.json5',
            '../tnet-global-config.json5',
            'tnet-global-config.json5'
        ];
        
        for (var i = 0; i < possiblePaths.length; i++) {
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', possiblePaths[i], false);
                xhr.send();
                
                if (xhr.status === 200) {
                    var globalConfig = parseJSON5Simple(xhr.responseText);
                    
                    if (globalConfig && globalConfig['3d-landscape']) {
                        console.log('[Landscape3DConfig] Loaded from:', possiblePaths[i]);
                        // Globales logLevel separat speichern (liegt auf Root-Ebene)
                        if (globalConfig.logLevel) {
                            window.TnetGlobalLogLevel = globalConfig.logLevel;
                        }
                        return globalConfig['3d-landscape'];
                    }
                }
            } catch(e) {
                console.warn('[Landscape3DConfig] Failed to load from:', possiblePaths[i], e.message);
            }
        }
        
        console.error('[Landscape3DConfig] FEHLER: Konfiguration konnte nicht geladen werden!');
        return null;
    }
    
    // Lade Config aus JSON5
    window.Landscape3DConfig = loadConfigFromJson();
    
    if (!window.Landscape3DConfig) {
        console.error('[Landscape3DConfig] 3D Landscape wird nicht funktionieren - keine Konfiguration vorhanden!');
    }
    
})();

/**
 * Helper-Funktion: WebScene wechseln
 */
window.setWebSceneFromConfig = function(sceneName) {
    if (!window.Landscape3DConfig || !window.Landscape3DConfig.availableScenes) {
        console.error('[Landscape3DConfig] Keine Konfiguration verfügbar');
        return;
    }
    
    var scene = window.Landscape3DConfig.availableScenes.find(function(s) {
        return s.name === sceneName;
    });
    
    if (scene) {
        console.log('[Landscape3DConfig] Switching to scene:', sceneName);
        if (typeof toggleLandscape3D !== 'undefined') {
            toggleLandscape3D(scene.id);
        }
    } else {
        console.error('[Landscape3DConfig] Scene not found:', sceneName);
    }
};

/**
 * Helper-Funktion: Alle verfügbaren Szenen auflisten
 */
window.listAvailableScenes = function() {
    if (!window.Landscape3DConfig || !window.Landscape3DConfig.availableScenes) {
        console.error('[Landscape3DConfig] Keine Konfiguration verfügbar');
        return;
    }
    
    console.log('[Landscape3DConfig] Available 3D Scenes:');
    window.Landscape3DConfig.availableScenes.forEach(function(scene, index) {
        console.log(' [' + (index + 1) + '] ' + scene.name + ' - ' + scene.id);
    });
};
