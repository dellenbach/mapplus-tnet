<?php
/**
 * ConfigSource.php
 * Liest das Feature-Flag `configSource` aus tnet-global-config.json5 und
 * entscheidet pro Konfigurationsdomain (bookmarks/layers/catalog), ob die
 * Daten aus der Staging-DB ('db') oder den Legacy-Dateien ('files') kommen.
 *
 * @version    1.0
 * @date       2026-06-04
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/Database.php';

class ConfigSource {

    /** @var array|null Gecachte, geparste json5-Konfiguration */
    private static $config = null;

    /** @var array|null Gecachter configSource-Block */
    private static $source = null;

    const SOURCE_DB    = 'db';
    const SOURCE_FILES = 'files';

    /**
     * Liefert die Datenquelle fuer eine Domain ('db' oder 'files').
     *
     * Beruecksichtigt: Domain-Override -> default -> 'files'. Steht die Quelle
     * auf 'db', ist aber die DB nicht erreichbar und `fallbackToFiles` aktiv,
     * wird auf 'files' zurueckgefallen.
     *
     * @param string $domain z.B. 'bookmarks', 'layers', 'catalog'
     * @return string ConfigSource::SOURCE_DB | ConfigSource::SOURCE_FILES
     */
    public static function for(string $domain): string {
        $src = self::resolveConfigured($domain);

        if ($src === self::SOURCE_DB && self::fallbackEnabled()) {
            $status = Database::isAvailable();
            if (empty($status['available'])) {
                return self::SOURCE_FILES;
            }
        }
        return $src;
    }

    /**
     * Liefert die konfigurierte Quelle ohne DB-Erreichbarkeitspruefung.
     *
     * @param string $domain Domain-Schluessel
     * @return string 'db' | 'files'
     */
    public static function resolveConfigured(string $domain): string {
        $cfg = self::loadSource();
        $value = $cfg[$domain] ?? ($cfg['default'] ?? self::SOURCE_FILES);
        $value = is_string($value) ? strtolower(trim($value)) : self::SOURCE_FILES;
        return $value === self::SOURCE_DB ? self::SOURCE_DB : self::SOURCE_FILES;
    }

    /**
     * Prueft, ob fuer eine Domain die DB genutzt werden soll.
     *
     * @param string $domain Domain-Schluessel
     * @return bool
     */
    public static function useDb(string $domain): bool {
        return self::for($domain) === self::SOURCE_DB;
    }

    /**
     * Gibt an, ob bei DB-Ausfall auf Dateien zurueckgefallen werden darf.
     *
     * @return bool
     */
    public static function fallbackEnabled(): bool {
        $cfg = self::loadSource();
        return !isset($cfg['fallbackToFiles']) || $cfg['fallbackToFiles'] === true;
    }

    /**
     * Laedt und cached den configSource-Block fuer direkte PHP-Aufrufe.
     *
     * Prioritaet:
     *   1. configSourceDirect (neues Feld, granular steuerbar)
     *   2. configSource (altes Feld, Rueckwaertskompatibilitaet)
     *
     * @return array
     */
    private static function loadSource(): array {
        if (self::$source !== null) {
            return self::$source;
        }
        $cfg = self::loadConfig();

        // Neu: configSourceDirect hat Prioritaet fuer direkte PHP-Aufrufe
        if (isset($cfg['configSourceDirect']) && is_array($cfg['configSourceDirect'])) {
            $block = $cfg['configSourceDirect'];
            $block['fallbackToFiles'] = $block['fallbackToFiles'] ?? false;
            self::$source = $block;
            return self::$source;
        }

        // Rueckwaertskompatibilitaet: altes configSource-Feld
        $block = (isset($cfg['configSource']) && is_array($cfg['configSource']))
            ? $cfg['configSource']
            : [];
        $block['fallbackToFiles'] = $block['fallbackToFiles'] ?? false;
        self::$source = $block;
        return self::$source;
    }

    /**
     * Laedt und cached die gesamte json5-Konfiguration.
     *
     * @return array
     */
    public static function loadConfig(): array {
        if (self::$config !== null) {
            return self::$config;
        }

        $path = __DIR__ . '/../../config/tnet-global-config.json5';
        if (!is_file($path)) {
            self::$config = [];
            return self::$config;
        }

        $json5 = file_get_contents($path);
        if ($json5 === false) {
            self::$config = [];
            return self::$config;
        }

        $json = self::json5ToJson($json5);
        $parsed = @json_decode($json, true);
        self::$config = is_array($parsed) ? $parsed : [];
        return self::$config;
    }

    /**
     * Konvertiert JSON5 nach JSON mit einem string-bewussten Tokenizer.
     *
     * Im Gegensatz zu reinen Regex-Ansaetzen respektiert dieser Parser
     * String-Grenzen: Kommentare, unquoted Keys und einfache Anfuehrungszeichen
     * werden nur AUSSERHALB von Strings transformiert. Dadurch brechen
     * String-Inhalte wie "Domain: db oder files" oder URLs (http://...) das
     * Parsing nicht mehr.
     *
     * @param string $src JSON5-Quelltext
     * @return string JSON-Text
     */
    private static function json5ToJson(string $src): string {
        $out     = '';
        $strings = [];
        $i = 0;
        $n = strlen($src);

        while ($i < $n) {
            $ch = $src[$i];

            // Kommentare ausserhalb von Strings entfernen
            if ($ch === '/' && $i + 1 < $n) {
                $next = $src[$i + 1];
                if ($next === '/') {
                    $i += 2;
                    while ($i < $n && $src[$i] !== "\n") { $i++; }
                    continue;
                }
                if ($next === '*') {
                    $i += 2;
                    while ($i + 1 < $n && !($src[$i] === '*' && $src[$i + 1] === '/')) { $i++; }
                    $i += 2;
                    continue;
                }
            }

            // Strings (einfache oder doppelte Anfuehrungszeichen) als Token sichern
            if ($ch === '"' || $ch === "'") {
                $quote = $ch;
                $i++;
                $val = '';
                while ($i < $n) {
                    $c = $src[$i];
                    if ($c === '\\' && $i + 1 < $n) {
                        $val .= $c . $src[$i + 1];
                        $i += 2;
                        continue;
                    }
                    if ($c === $quote) { $i++; break; }
                    $val .= $c;
                    $i++;
                }
                if ($quote === "'") {
                    $val = str_replace('"', '\\"', $val);
                }
                $token     = "\x00S" . count($strings) . "\x00";
                $strings[] = '"' . $val . '"';
                $out      .= $token;
                continue;
            }

            $out .= $ch;
            $i++;
        }

        // Unquoted keys -> quoted (Strings sind durch Tokens geschuetzt)
        $out = preg_replace('/(^|[\s{,])([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/', '$1"$2":', $out);
        // Trailing commas entfernen
        $out = preg_replace('/,(\s*[}\]])/', '$1', $out);
        // String-Tokens zuruecksetzen
        $out = preg_replace_callback('/\x00S(\d+)\x00/', function ($m) use ($strings) {
            return $strings[(int) $m[1]];
        }, $out);

        return $out;
    }
}
