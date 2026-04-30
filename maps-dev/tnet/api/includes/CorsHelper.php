<?php
/**
 * CorsHelper.php
 * Zentrale CORS-Origin-Validierung für alle TNET API Endpoints.
 *
 * @version    1.0
 * @date       2026-04-13
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

class CorsHelper {

    /**
     * Erlaubte Origins für Cross-Origin-Requests.
     * Nur diese Domains dürfen die API per AJAX aufrufen.
     */
    private static $allowedOrigins = [
        'https://www.gis-daten.ch',
        'https://gis-daten.ch',
        'https://dev.gis-daten.ch',
        'https://nwow.mapplus.ch',
    ];

    /**
     * Setzt CORS-Header basierend auf dem Origin des Requests.
     * Fremde Origins erhalten keinen Allow-Origin-Header → Browser blockiert.
     *
     * @param string $methods  Erlaubte HTTP-Methoden (Default: 'GET, OPTIONS')
     * @param string $headers  Erlaubte Request-Headers
     */
    public static function setHeaders($methods = 'GET, OPTIONS', $headers = 'Content-Type') {
        $origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
        if (in_array($origin, self::$allowedOrigins, true)) {
            header('Access-Control-Allow-Origin: ' . $origin);
        } else {
            // Default für Same-Origin Requests und unbekannte Origins
            header('Access-Control-Allow-Origin: https://www.gis-daten.ch');
        }
        header('Access-Control-Allow-Methods: ' . $methods);
        header('Access-Control-Allow-Headers: ' . $headers);
    }

    /**
     * OPTIONS Preflight beantworten und beenden.
     *
     * @param string $methods  Erlaubte HTTP-Methoden
     * @param string $headers  Erlaubte Request-Headers
     */
    public static function handlePreflight($methods = 'GET, OPTIONS', $headers = 'Content-Type') {
        if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
            self::setHeaders($methods, $headers);
            http_response_code(204);
            exit;
        }
    }
}
