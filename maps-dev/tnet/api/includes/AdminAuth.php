<?php
/**
 * AdminAuth.php
 * Cookie-basierte Authentifizierung fuer Admin-Bereiche.
 * Multi-User: Benutzer in admin-env.json, bcrypt-gesalzen.
 *
 * admin-env.json Format:
 * {
 *   "cookie_secret": "...",
 *   "users": {
 *     "administrator": {"hash":"...", "is_admin":true,  "must_change":false, "updated":"..."},
 *     "del":           {"hash":"...", "is_admin":false, "must_change":false, "updated":"..."},
 *     ...
 *   }
 * }
 *
 * @version    2.0
 * @date       2026-06-08
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

class AdminAuth {

    const COOKIE_NAME    = 'tnet_admin';
    const COOKIE_MAX_AGE = 8 * 3600; // 8 Stunden
    const KNOWN_USERS    = ['admin', 'del', 'mar', 'amr', 'wmi', 'brm', 'mam'];

    // ===== PFAD-HELFER =====

    private static function getAppBasePath() {
        $scriptName  = $_SERVER['SCRIPT_NAME'] ?? '';
        $appBasePath = rtrim(str_replace('\\', '/', dirname(dirname(dirname(dirname($scriptName))))), '/');
        return ($appBasePath === '' || $appBasePath === '.') ? '' : $appBasePath;
    }

    public static function getClientDataRoot() { return '/data/Client_Data/nwow'; }

    private static function getTmpRoot() {
        return self::getClientDataRoot() . '/tmp/' . (self::getAppBasePath() === '/maps-dev' ? 'maps-dev' : 'maps');
    }

    public static function getConfigFilePath()       { return self::getTmpRoot() . '/admin-env.json';     }
    public static function getAccessConfigFilePath() { return self::getTmpRoot() . '/access-config.json'; }

    private static function getCookiePath() {
        return (self::getAppBasePath() ?: '') . '/tnet/api/';
    }

    // ===== KONFIG LESEN/SCHREIBEN =====

    private static function getConfig() {
        $file = self::getConfigFilePath();
        if (!file_exists($file)) return null;
        $data = json_decode(file_get_contents($file), true);
        return is_array($data) ? $data : null;
    }

    private static function saveConfig(array $config) {
        $file = self::getConfigFilePath();
        $dir  = dirname($file);
        if (!is_dir($dir) && !@mkdir($dir, 0755, true)) return false;
        if (!is_writable($dir)) return false;
        return @file_put_contents($file, json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX) !== false;
    }

    private static function getCookieSecret() {
        $config = self::getConfig();
        return $config['cookie_secret'] ?? '';
    }

    // ===== SETUP-PRUEFUNG =====

    /** Ist mindestens ein Benutzer mit Passwort angelegt? */
    public static function isSetup() {
        $config = self::getConfig();
        if (!$config) return false;
        if (isset($config['users'])) {
            foreach ($config['users'] as $u) {
                if (!empty($u['hash'])) return true;
            }
            return false;
        }
        return isset($config['password_hash']); // Legacy
    }

    /** Hat ein bestimmter Benutzer bereits ein Passwort gesetzt? */
    public static function userHasPassword($username) {
        $config = self::getConfig();
        if (!$config || !isset($config['users'][$username])) return false;
        return !empty($config['users'][$username]['hash']);
    }

    /** Muss der Benutzer sein Passwort beim naechsten Login aendern? */
    public static function userMustChange($username) {
        $config = self::getConfig();
        if (!$config || !isset($config['users'][$username])) return false;
        return !empty($config['users'][$username]['must_change']);
    }

    /** Hat der Benutzer Admin-Rechte? */
    public static function isAdmin($username = '') {
        if ($username === '') $username = self::getCurrentUser();
        if ($username === 'admin') return true;
        $config = self::getConfig();
        if (!$config || !isset($config['users'][$username])) return false;
        return !empty($config['users'][$username]['is_admin']);
    }

    // ===== USER-VERWALTUNG =====

    /** Alle Benutzer auflisten (bekannte + angelegte). */
    public static function listUsers() {
        $config   = self::getConfig();
        $result   = [];
        $existing = [];
        if ($config && isset($config['users'])) {
            foreach ($config['users'] as $username => $data) {
                $existing[] = $username;
                $result[] = [
                    'username'    => $username,
                    'has_password'=> !empty($data['hash']),
                    'is_admin'    => ($username === 'admin' || !empty($data['is_admin'])),
                    'must_change' => !empty($data['must_change']),
                    'updated'     => $data['updated'] ?? null,
                ];
            }
        }
        // Bekannte User ohne Eintrag ergaenzen
        foreach (self::KNOWN_USERS as $u) {
            if (!in_array($u, $existing, true)) {
                $result[] = [
                    'username'    => $u,
                    'has_password'=> false,
                    'is_admin'    => ($u === 'admin'),
                    'must_change' => false,
                    'updated'     => null,
                ];
            }
        }
        usort($result, function ($a, $b) {
            if ($a['username'] === 'admin') return -1;
            if ($b['username'] === 'admin') return 1;
            return strcmp($a['username'], $b['username']);
        });
        return $result;
    }

    /** Passwort eines Benutzers setzen (Ersteinrichtung oder Aenderung). */
    public static function setUserPassword($username, $password, $mustChange = false) {
        $username = preg_replace('/[^a-zA-Z0-9_]/', '', $username);
        if ($username === '' || strlen($password) < 8) return false;
        $config = self::getConfig() ?: [];
        if (!isset($config['cookie_secret'])) $config['cookie_secret'] = bin2hex(random_bytes(32));
        if (!isset($config['users']))         $config['users']         = [];
        $isAdmin = ($username === 'admin' || !empty($config['users'][$username]['is_admin']));
        $config['users'][$username] = [
            'hash'        => password_hash($password, PASSWORD_BCRYPT),
            'is_admin'    => $isAdmin,
            'must_change' => (bool)$mustChange,
            'updated'     => date('c'),
        ];
        return self::saveConfig($config);
    }

    /** Admin-Rechte eines Benutzers setzen (nur Administrator darf das). */
    public static function setUserAdmin($username, $isAdmin) {
        if ($username === 'admin') return false; // unveraenderbar
        $config = self::getConfig();
        if (!$config || !isset($config['users'][$username])) return false;
        $config['users'][$username]['is_admin'] = (bool)$isAdmin;
        return self::saveConfig($config);
    }

    /** must_change-Flag setzen (Admin fordert Passwort-Reset). */
    public static function setMustChange($username, $mustChange) {
        $config = self::getConfig();
        if (!$config) return false;
        if (!isset($config['users'][$username])) {
            $config['users'][$username] = [
                'hash'        => null,
                'is_admin'    => false,
                'must_change' => (bool)$mustChange,
                'updated'     => date('c'),
            ];
        } else {
            $config['users'][$username]['must_change'] = (bool)$mustChange;
        }
        return self::saveConfig($config);
    }

    /** Benutzer loeschen (ausser administrator). */
    public static function deleteUser($username) {
        if ($username === 'admin') return false;
        $config = self::getConfig();
        if (!$config || !isset($config['users'][$username])) return false;
        unset($config['users'][$username]);
        return self::saveConfig($config);
    }

    // ===== PASSWORT-PRUEFUNG =====

    /** Passwort eines konkreten Benutzers pruefen. */
    public static function verifyUserPassword($username, $password) {
        $config = self::getConfig();
        if (!$config) return false;
        if (!empty($config['users'][$username]['hash'])) {
            return password_verify($password, $config['users'][$username]['hash']);
        }
        // Legacy: kein Benutzername, globales Passwort
        if ($username === '' && isset($config['password_hash'])) {
            return password_verify($password, $config['password_hash']);
        }
        return false;
    }

    /** Abwaertskompatibel: globales Passwort pruefen. */
    public static function verifyPassword($password) {
        $config = self::getConfig();
        if (!$config) return false;
        if (isset($config['password_hash'])) return password_verify($password, $config['password_hash']);
        return false;
    }

    /** Legacy-Setup: globales Einzelpasswort. */
    public static function setup($password) {
        if (strlen($password) < 8) return false;
        $existing = self::getConfig();
        $config = [
            'password_hash' => password_hash($password, PASSWORD_BCRYPT),
            'cookie_secret' => $existing['cookie_secret'] ?? bin2hex(random_bytes(32)),
            'users'         => $existing['users'] ?? [],
            'created'       => $existing['created'] ?? date('c'),
        ];
        return self::saveConfig($config);
    }

    // ===== COOKIE (Format: "username:timestamp:HMAC") =====

    public static function createCookieValue($username = '') {
        $secret = self::getCookieSecret();
        if (!$secret) return '';
        $ts      = (string)time();
        $payload = $username . ':' . $ts;
        return $payload . ':' . hash_hmac('sha256', $payload, $secret);
    }

    public static function setAuthCookie($username = '') {
        setcookie(self::COOKIE_NAME, self::createCookieValue($username), [
            'expires'  => time() + self::COOKIE_MAX_AGE,
            'path'     => self::getCookiePath(),
            'secure'   => true,
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
    }

    public static function clearAuthCookie() {
        setcookie(self::COOKIE_NAME, '', [
            'expires'  => time() - 3600,
            'path'     => self::getCookiePath(),
            'secure'   => true,
            'httponly' => true,
        ]);
    }

    public static function isAuthenticated($allowWhitelistedIp = false) {
        if ($allowWhitelistedIp && self::isWhitelistedIp()) return true;
        $cookie = $_COOKIE[self::COOKIE_NAME] ?? '';
        if (!$cookie) return false;
        $secret = self::getCookieSecret();
        if (!$secret) return false;
        $parts = explode(':', $cookie);
        // Neues Format: user:ts:hmac
        if (count($parts) === 3) {
            [$user, $ts, $sig] = $parts;
            if (time() - (int)$ts > self::COOKIE_MAX_AGE) return false;
            return hash_equals(hash_hmac('sha256', $user . ':' . $ts, $secret), $sig);
        }
        // Legacy: ts:hmac
        if (count($parts) === 2) {
            [$ts, $sig] = $parts;
            if (time() - (int)$ts > self::COOKIE_MAX_AGE) return false;
            return hash_equals(hash_hmac('sha256', $ts, $secret), $sig);
        }
        return false;
    }

    /** Eingeloggten Benutzernamen aus Cookie lesen (leer bei Legacy/anonym). */
    public static function getCurrentUser() {
        $cookie = $_COOKIE[self::COOKIE_NAME] ?? '';
        if (!$cookie) return '';
        $parts = explode(':', $cookie);
        if (count($parts) === 3 && self::isAuthenticated()) return $parts[0];
        return '';
    }

    public static function requireAuth($allowWhitelistedIp = false) {
        if (!self::isAuthenticated($allowWhitelistedIp)) {
            $redirect = $_SERVER['REQUEST_URI'] ?? '';
            header('Location: admin-login.php' . ($redirect ? '?redirect=' . urlencode($redirect) : ''));
            exit;
        }
    }

    // ===== IP-WHITELIST =====

    private static function getAccessConfig() {
        $file = self::getAccessConfigFilePath();
        if (!file_exists($file)) return null;
        $data = json_decode(file_get_contents($file), true);
        if (!$data) return null;
        if (!isset($data['ips']))       $data['ips']       = [];
        if (!isset($data['endpoints'])) $data['endpoints'] = [];
        return $data;
    }

    private static function ipMatchesPattern($ip, $pattern) {
        if ($ip === '' || $pattern === '') return false;
        if (strpos($pattern, '*') === false) return $ip === $pattern;
        return (bool)preg_match('/^' . str_replace('\\*', '.*', preg_quote($pattern, '/')) . '$/', $ip);
    }

    public static function isWhitelistedIp() {
        $cfg = self::getAccessConfig();
        if (!$cfg) return false;
        $ip = self::getClientIp();
        if (!$ip || $ip === 'unknown') return false;
        foreach (($cfg['blocked_ips'] ?? []) as $p) {
            if (self::ipMatchesPattern($ip, trim((string)$p))) return false;
        }
        foreach ($cfg['ips'] as $entry) {
            if (!isset($entry['ip'])) continue;
            if (self::ipMatchesPattern($ip, trim((string)$entry['ip']))) return true;
        }
        return false;
    }

    public static function endpointAllowsWhitelistedIp($endpointName, $type = 'php') {
        $cfg = self::getAccessConfig();
        if (!$cfg || !isset($cfg['endpoints'])) return false;
        $key  = (strtolower($type) === 'html') ? 'restricted_with_ip_html' : 'restricted_with_ip_php';
        $list = $cfg['endpoints'][$key] ?? [];
        return is_array($list) && in_array(trim((string)$endpointName), $list, true);
    }

    public static function enforceEndpointPolicy($endpointName, $type = 'php') {
        $cfg = self::getAccessConfig();
        if (!$cfg || !isset($cfg['endpoints'])) { self::requireAuth(false); return; }
        $ep     = $cfg['endpoints'];
        $name   = trim((string)$endpointName);
        $type   = strtolower((string)$type);
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $rHtml   = is_array($ep['restricted_html']         ?? null) ? $ep['restricted_html']         : [];
        $rPhp    = is_array($ep['restricted_php']          ?? null) ? $ep['restricted_php']          : [];
        $rIpHtml = is_array($ep['restricted_with_ip_html'] ?? null) ? $ep['restricted_with_ip_html'] : [];
        $rIpPhp  = is_array($ep['restricted_with_ip_php']  ?? null) ? $ep['restricted_with_ip_php']  : [];
        $cPost   = is_array($ep['cache_post_only']         ?? null) ? $ep['cache_post_only']         : [];
        if ($type === 'html') {
            if (in_array($name, $rIpHtml, true)) { self::requireAuth(true);  return; }
            if (in_array($name, $rHtml,   true)) { self::requireAuth(false); return; }
            return;
        }
        if (in_array($name, $rIpPhp, true)) { self::requireAuth(true);  return; }
        if (in_array($name, $rPhp,   true)) { self::requireAuth(false); return; }
        if (in_array($name, $cPost,  true) && $method === 'POST') { self::requireAuth(false); return; }
    }

    public static function getClientIp() {
        if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $ip = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
        } else {
            $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        }
        if (preg_match('/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/', $ip)) $ip = explode(':', $ip)[0];
        if (preg_match('/^\[(.+)\]:\d+$/', $ip, $m)) $ip = $m[1];
        return $ip;
    }
}
