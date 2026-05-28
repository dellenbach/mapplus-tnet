<?php
/**
 * IpTracker.php
 * Leichtgewichtiger IP-Zugriffslogger.
 * Wird via auto_prepend_file bei jedem PHP-Request eingebunden.
 * Loggt IP, Pfad und Zeitstempel in eine TSV-Datei.
 *
 * @version    1.0
 * @date       2026-04-13
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

if (defined('TNET_IP_TRACKED')) return;
define('TNET_IP_TRACKED', true);

// ===== KONFIGURATION =====
define('IP_LOG_FILE', '/data/Client_Data/nwow/tmp/maps-dev/ip-access.log');
define('IP_LOG_MAX_AGE', 7 * 86400); // 7 Tage behalten

// ===== TRACKING =====
$_tnet_ip = '';
if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
    $_tnet_ip = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
} else {
    $_tnet_ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
}
// Port entfernen
if (strpos($_tnet_ip, ':') !== false && $_tnet_ip[0] !== '[') {
    $_parts = explode(':', $_tnet_ip);
    if (count($_parts) === 2 && is_numeric($_parts[1])) {
        $_tnet_ip = $_parts[0];
    }
}

$_tnet_path = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/';
// Query-String kürzen (keine Sensiblen Daten loggen)
$_tnet_path = strtok($_tnet_path, '?');
// Basis-Pfad kürzen (funktioniert für /maps/ und /maps-dev/)
$_tnet_path = preg_replace('#^/(maps(?:-dev)?)/tnet/api/v1/#', '/', $_tnet_path);

$_tnet_time = date('c');

// Atomar an Logdatei anhängen
@file_put_contents(IP_LOG_FILE, "$_tnet_time\t$_tnet_ip\t$_tnet_path\n", FILE_APPEND | LOCK_EX);

// Variablen aufräumen
unset($_tnet_ip, $_tnet_path, $_tnet_time, $_parts);


/**
 * Statische Klasse für Logdatei-Auswertung
 */
class IpTracker {

    /**
     * Logdatei parsen und nach IP aggregieren
     * @return array Assoziatives Array: ip => { count, first_seen, last_seen, paths[] }
     */
    public static function getAggregated() {
        if (!file_exists(IP_LOG_FILE)) return [];

        $data = [];
        $cutoff = date('c', time() - IP_LOG_MAX_AGE);
        $lines = file(IP_LOG_FILE, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);

        foreach ($lines as $line) {
            $parts = explode("\t", $line, 3);
            if (count($parts) < 3) continue;

            $time = $parts[0];
            $ip = $parts[1];
            $path = $parts[2];

            // Alte Einträge überspringen
            if ($time < $cutoff) continue;

            if (!isset($data[$ip])) {
                $data[$ip] = [
                    'count' => 0,
                    'first_seen' => $time,
                    'last_seen' => $time,
                    'paths' => [],
                ];
            }

            $data[$ip]['count']++;
            if ($time < $data[$ip]['first_seen']) $data[$ip]['first_seen'] = $time;
            if ($time > $data[$ip]['last_seen']) $data[$ip]['last_seen'] = $time;

            // Pfade sammeln (max 20 verschiedene)
            if (!in_array($path, $data[$ip]['paths']) && count($data[$ip]['paths']) < 20) {
                $data[$ip]['paths'][] = $path;
            }
        }

        // Nach Zugriffen sortieren (absteigend)
        uasort($data, function($a, $b) {
            return $b['count'] - $a['count'];
        });

        return $data;
    }

    /**
     * Logdatei bereinigen (Einträge älter als MAX_AGE entfernen)
     */
    public static function cleanup() {
        if (!file_exists(IP_LOG_FILE)) return;

        $cutoff = date('c', time() - IP_LOG_MAX_AGE);
        $lines = file(IP_LOG_FILE, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        $kept = [];

        foreach ($lines as $line) {
            $time = strtok($line, "\t");
            if ($time >= $cutoff) {
                $kept[] = $line;
            }
        }

        file_put_contents(IP_LOG_FILE, implode("\n", $kept) . ($kept ? "\n" : ""), LOCK_EX);
    }

    /**
     * Prüft ob eine IP in einer Whitelist enthalten ist (mit Wildcard-Unterstützung)
     */
    public static function ipMatchesWhitelist($ip, $whitelistIps) {
        foreach ($whitelistIps as $entry) {
            $pattern = is_array($entry) ? $entry['ip'] : $entry;
            if (strpos($pattern, '*') !== false) {
                // Wildcard-Matching: 10.203.*.* → fnmatch
                if (fnmatch($pattern, $ip)) return true;
            } else {
                if ($ip === $pattern) return true;
            }
        }
        return false;
    }
}
