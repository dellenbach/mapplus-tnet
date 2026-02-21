<?php
/**
 * ApiResponse - Standardisierte JSON-API-Antworten
 * 
 * Einheitlicher Response-Wrapper für alle TNET API Endpoints.
 * Liefert konsistente JSON-Struktur mit Status, Daten und Metadaten.
 *
 * @version    1.0
 * @date       2026-02-20
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

class ApiResponse {

    /**
     * Setzt Standard-Header für JSON-API-Responses
     */
    public static function setHeaders() {
        header('Content-Type: application/json; charset=utf-8');
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Methods: GET, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization');
        header('X-API-Version: 1.0');

        // OPTIONS Preflight sofort beantworten
        if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
            http_response_code(204);
            exit;
        }

        // Nur GET erlauben
        if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
            self::error('Method not allowed', 405);
        }
    }

    /**
     * Erfolgreiche Antwort senden
     * 
     * @param mixed  $data     Die Nutzdaten
     * @param array  $meta     Optionale Metadaten (count, pagination etc.)
     * @param int    $httpCode HTTP Status Code (default 200)
     */
    public static function success($data, $meta = [], $httpCode = 200) {
        http_response_code($httpCode);

        $response = [
            'success' => true,
            'data'    => $data
        ];

        if (!empty($meta)) {
            $response['meta'] = $meta;
        }

        echo json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    /**
     * Fehler-Antwort senden
     * 
     * @param string $message  Fehlermeldung
     * @param int    $httpCode HTTP Status Code (default 400)
     * @param array  $details  Optionale Details
     */
    public static function error($message, $httpCode = 400, $details = []) {
        http_response_code($httpCode);

        $response = [
            'success' => false,
            'error'   => [
                'code'    => $httpCode,
                'message' => $message
            ]
        ];

        if (!empty($details)) {
            $response['error']['details'] = $details;
        }

        echo json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    /**
     * 404 Not Found Kurzform
     * 
     * @param string $resource Name der nicht gefundenen Ressource
     */
    public static function notFound($resource = 'Resource') {
        self::error("$resource not found", 404);
    }

    /**
     * 500 Internal Server Error Kurzform
     * 
     * @param string $message Fehlermeldung
     */
    public static function serverError($message = 'Internal server error') {
        self::error($message, 500);
    }
}
