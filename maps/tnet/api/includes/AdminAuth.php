<?php
/**
 * AdminAuth.php
 * Cookie-basierte Authentifizierung für Admin-Bereiche.
 * Analog FastAPI ags2mapplus_security.py — HMAC-signierte Cookies.
 *
 * @version    1.0
 * @date       2026-04-13
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

class AdminAuth {

    const COOKIE_NAME = 'tnet_admin';
    const COOKIE_MAX_AGE = 8 * 3600; // 8 Stunden

    private static function getAppBasePath() {
        $scriptName = $_SERVER['SCRIPT_NAME'] ?? '';
        $appBasePath = rtrim(str_replace('\\', '/', dirname(dirname(dirname(dirname($scriptName))))), '/');
        if ($appBasePath === '' || $appBasePath === '.') {
            $appBasePath = '';
        }
        return $appBasePath;
    }

    public static function getClientDataRoot() {
        return '/data/Client_Data/nwow';
    }

    private static function getTmpRoot() {
        return self::getClientDataRoot() . '/tmp/' . (self::getAppBasePath() === '/maps-dev' ? 'maps-dev' : 'maps');
    }

    public static function getConfigFilePath() {
        return self::getTmpRoot() . '/admin-env.json';
    }

    public static function getAccessConfigFilePath() {
        return self::getTmpRoot() . '/access-config.json';
    }

    private static function getCookiePath() {
        $appBasePath = self::getAppBasePath();
        return ($appBasePath !== '' ? $appBasePath : '') . '/tnet/api/';
    }

    /**
     * Konfiguration lesen (Passwort-Hash + Cookie-Secret)
     */
    private static function getConfig() {
        $configFile = self::getConfigFilePath();
        if (file_exists($configFile)) {
            $data = json_decode(file_get_contents($configFile), true);
            if ($data && isset($data['password_hash'])) {
                return $data;
            }
        }
        return null;
    }

    /**
     * Zugriffsschutz-Konfiguration lesen (IP-Whitelist)
     */
    private static function getAccessConfig() {
        $configFile = self::getAccessConfigFilePath();
        if (!file_exists($configFile)) {
            return null;
        }
        $data = json_decode(file_get_contents($configFile), true);
        if (!$data) {
            return null;
        }

        if (!isset($data['ips']) || !is_array($data['ips'])) {
            $data['ips'] = [];
        }
        if (!isset($data['endpoints']) || !is_array($data['endpoints'])) {
            $data['endpoints'] = [];
        }

        return $data;
    }

    /**
     * Prüft ob eine IP zu einem Pattern passt (exakt oder mit *-Wildcard)
     */
    private static function ipMatchesPattern($ip, $pattern) {
        if ($ip === '' || $pattern === '') {
            return false;
        }
        if (strpos($pattern, '*') === false) {
            return $ip === $pattern;
        }
        $regex = '/^' . str_replace('\\*', '.*', preg_quote($pattern, '/')) . '$/';
        return preg_match($regex, $ip) === 1;
    }

    /**
     * Prüft ob die aktuelle Client-IP in der Whitelist steht.
     */
    public static function isWhitelistedIp() {
        $cfg = self::getAccessConfig();
        if (!$cfg) return false;

        $clientIp = self::getClientIp();
        if (!$clientIp || $clientIp === 'unknown') return false;

        // Blockliste hat Vorrang vor Whitelist/Wildcards
        $blocked = $cfg['blocked_ips'] ?? [];
        if (is_array($blocked)) {
            foreach ($blocked as $pattern) {
                $pattern = trim((string)$pattern);
                if ($pattern === '') continue;
                if (self::ipMatchesPattern($clientIp, $pattern)) {
                    return false;
                }
            }
        }

        foreach ($cfg['ips'] as $entry) {
            if (!isset($entry['ip'])) continue;
            $pattern = trim((string)$entry['ip']);
            if ($pattern === '') continue;
            if (self::ipMatchesPattern($clientIp, $pattern)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Prüft ob ein Endpoint im Modus "Geschützt mit IP-Freigabe" ist.
     */
    public static function endpointAllowsWhitelistedIp($endpointName, $type = 'php') {
        $cfg = self::getAccessConfig();
        if (!$cfg || !isset($cfg['endpoints']) || !is_array($cfg['endpoints'])) {
            return false;
        }

        $type = strtolower((string)$type);
        $endpointName = trim((string)$endpointName);
        if ($endpointName === '') {
            return false;
        }

        $key = ($type === 'html') ? 'restricted_with_ip_html' : 'restricted_with_ip_php';
        $list = $cfg['endpoints'][$key] ?? [];
        if (!is_array($list)) {
            return false;
        }

        return in_array($endpointName, $list, true);
    }

    /**
     * Erzwingt Endpoint-Policy gemäss access-config.json.
     * - restricted                → Cookie-Auth
     * - restricted_with_ip        → Cookie-Auth ODER Whitelist-IP
     * - cache_post_only           → nur POST benötigt Cookie-Auth
     * - public                    → frei
     */
    public static function enforceEndpointPolicy($endpointName, $type = 'php') {
        $cfg = self::getAccessConfig();
        if (!$cfg || !isset($cfg['endpoints']) || !is_array($cfg['endpoints'])) {
            // Fallback ohne access-config: konservativ schützen
            self::requireAuth(false);
            return;
        }

        $ep = $cfg['endpoints'];
        $name = trim((string)$endpointName);
        $type = strtolower((string)$type);
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

        $restrictedHtml = $ep['restricted_html'] ?? [];
        $restrictedPhp = $ep['restricted_php'] ?? [];
        $restrictedWithIpHtml = $ep['restricted_with_ip_html'] ?? [];
        $restrictedWithIpPhp = $ep['restricted_with_ip_php'] ?? [];
        $cachePostOnly = $ep['cache_post_only'] ?? [];

        if (!is_array($restrictedHtml)) $restrictedHtml = [];
        if (!is_array($restrictedPhp)) $restrictedPhp = [];
        if (!is_array($restrictedWithIpHtml)) $restrictedWithIpHtml = [];
        if (!is_array($restrictedWithIpPhp)) $restrictedWithIpPhp = [];
        if (!is_array($cachePostOnly)) $cachePostOnly = [];

        if ($type === 'html') {
            if (in_array($name, $restrictedWithIpHtml, true)) {
                self::requireAuth(true);
                return;
            }
            if (in_array($name, $restrictedHtml, true)) {
                self::requireAuth(false);
                return;
            }
            return;
        }

        // PHP-Endpunkte
        if (in_array($name, $restrictedWithIpPhp, true)) {
            self::requireAuth(true);
            return;
        }
        if (in_array($name, $restrictedPhp, true)) {
            self::requireAuth(false);
            return;
        }
        if (in_array($name, $cachePostOnly, true) && $method === 'POST') {
            self::requireAuth(false);
            return;
        }
        // public / nicht klassifiziert: keine Auth erzwingen
    }

    /**
     * Prüft ob die Ersteinrichtung bereits erfolgt ist
     */
    public static function isSetup() {
        return self::getConfig() !== null;
    }

    /**
     * Ersteinrichtung: Passwort hashen und Config erstellen
     */
    public static function setup($password) {
        if (strlen($password) < 8) {
            return false;
        }
        $config = [
            'password_hash' => password_hash($password, PASSWORD_BCRYPT),
            'cookie_secret' => bin2hex(random_bytes(32)),
            'created' => date('c'),
        ];
        $configFile = self::getConfigFilePath();
        $dir = dirname($configFile);
        
        // Verzeichnis prüfen und erstellen
        if (!is_dir($dir)) {
            if (!@mkdir($dir, 0755, true)) {
                error_log('AdminAuth::setup() - Verzeichnis konnte nicht erstellt werden: ' . $dir);
                return false;
            }
        }
        
        // Schreibberechtigung prüfen
        if (!is_writable($dir)) {
            error_log('AdminAuth::setup() - Verzeichnis nicht beschreibbar: ' . $dir . ' (Berechtigungen: ' . substr(sprintf('%o', fileperms($dir)), -4) . ')');
            return false;
        }
        
        // Datei schreiben
        $result = @file_put_contents(
            $configFile,
            json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE),
            LOCK_EX
        );
        
        if ($result === false) {
            error_log('AdminAuth::setup() - Datei konnte nicht geschrieben werden: ' . $configFile);
            return false;
        }
        
        return true;
    }

    /**
     * Passwort gegen gespeicherten Hash prüfen
     */
    public static function verifyPassword($password) {
        $config = self::getConfig();
        if (!$config) return false;
        return password_verify($password, $config['password_hash']);
    }

    /**
     * Signierter Cookie-Wert erzeugen (Timestamp:HMAC)
     */
    public static function createCookieValue() {
        $config = self::getConfig();
        if (!$config) return '';
        $timestamp = (string)time();
        $signature = hash_hmac('sha256', $timestamp, $config['cookie_secret']);
        return $timestamp . ':' . $signature;
    }

    /**
     * Auth-Cookie setzen
     */
    public static function setAuthCookie() {
        $value = self::createCookieValue();
        setcookie(self::COOKIE_NAME, $value, [
            'expires' => time() + self::COOKIE_MAX_AGE,
            'path' => self::getCookiePath(),
            'secure' => true,
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
    }

    /**
     * Auth-Cookie löschen (Logout)
     */
    public static function clearAuthCookie() {
        setcookie(self::COOKIE_NAME, '', [
            'expires' => time() - 3600,
            'path' => self::getCookiePath(),
            'secure' => true,
            'httponly' => true,
        ]);
    }

    /**
     * Prüft ob der aktuelle Request authentifiziert ist (gültiger Cookie)
     */
    public static function isAuthenticated($allowWhitelistedIp = false) {
        if ($allowWhitelistedIp && self::isWhitelistedIp()) {
            return true;
        }

        $cookie = $_COOKIE[self::COOKIE_NAME] ?? '';
        if (!$cookie) return false;

        $parts = explode(':', $cookie, 2);
        if (count($parts) !== 2) return false;

        $timestamp = (int)$parts[0];
        $signature = $parts[1];

        // Ablauf prüfen
        if (time() - $timestamp > self::COOKIE_MAX_AGE) return false;

        // Signatur prüfen
        $config = self::getConfig();
        if (!$config) return false;

        $expected = hash_hmac('sha256', (string)$timestamp, $config['cookie_secret']);
        return hash_equals($expected, $signature);
    }

    /**
     * Erzwingt Authentifizierung — Redirect zu Login bei fehlendem Cookie
     */
    public static function requireAuth($allowWhitelistedIp = false) {
        if (!self::isAuthenticated($allowWhitelistedIp)) {
            $redirect = $_SERVER['REQUEST_URI'] ?? '';
            header('Location: admin-login.php' . ($redirect ? '?redirect=' . urlencode($redirect) : ''));
            exit;
        }
    }

    /**
     * Client-IP ermitteln (X-Forwarded-For-aware)
     */
    public static function getClientIp() {
        if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $ip = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
        } else {
            $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        }

        // IPv4-Port entfernen falls vorhanden (z.B. 10.0.0.5:52341)
        if (preg_match('/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/', $ip)) {
            $ip = explode(':', $ip)[0];
        }

        // IPv6 in [addr]:port-Form normalisieren
        if (preg_match('/^\[(.+)\]:\d+$/', $ip, $m)) {
            $ip = $m[1];
        }

        return $ip;
    }
}
