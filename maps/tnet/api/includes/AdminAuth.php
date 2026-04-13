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

    const CONFIG_FILE = '/data/Client_Data/nwow/tmp/admin-env.json';
    const COOKIE_NAME = 'tnet_admin';
    const COOKIE_MAX_AGE = 8 * 3600; // 8 Stunden
    const COOKIE_PATH = '/maps/tnet/api/';

    /**
     * Konfiguration lesen (Passwort-Hash + Cookie-Secret)
     */
    private static function getConfig() {
        if (file_exists(self::CONFIG_FILE)) {
            $data = json_decode(file_get_contents(self::CONFIG_FILE), true);
            if ($data && isset($data['password_hash'])) {
                return $data;
            }
        }
        return null;
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
        $dir = dirname(self::CONFIG_FILE);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        return file_put_contents(
            self::CONFIG_FILE,
            json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
        ) !== false;
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
            'path' => self::COOKIE_PATH,
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
            'path' => self::COOKIE_PATH,
            'secure' => true,
            'httponly' => true,
        ]);
    }

    /**
     * Prüft ob der aktuelle Request authentifiziert ist (gültiger Cookie)
     */
    public static function isAuthenticated() {
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
    public static function requireAuth() {
        if (!self::isAuthenticated()) {
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
        // Port entfernen falls vorhanden
        if (strpos($ip, ':') !== false && $ip[0] !== '[') {
            $ip = explode(':', $ip)[0];
        }
        return $ip;
    }
}
