<?php
/**
 * admin-gate.php
 * Gateway für geschützte HTML-Admin-Seiten.
 * Prüft Admin-Cookie und liefert die angeforderte HTML-Datei aus.
 *
 * @version    1.0
 * @date       2026-04-13
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

require_once __DIR__ . '/../includes/AdminAuth.php';

// ===== ERLAUBTE SEITEN =====
$allowedPages = [
    'slm', 'ags-import', 'tree-builder', 'tree-builder-tydac', 'dev-test', 'tree-test', 'prod-sync', 'config-db-admin'
];

$page = isset($_GET['page']) ? $_GET['page'] : '';

// Sicherheitscheck: nur erlaubte Seitennamen
if (!$page || !in_array($page, $allowedPages, true)) {
    http_response_code(404);
    echo '<!DOCTYPE html><html><body><h1>404 — Seite nicht gefunden</h1></body></html>';
    exit;
}

// ===== AUTH-CHECK gemäss Endpoint-Policy =====
// Respektiert die in access-config.json hinterlegten Modi pro Endpoint:
//   - restricted_html          → Cookie-Auth erzwingen
//   - restricted_with_ip_html  → Cookie-Auth ODER Whitelist-IP
//   - public / nicht klassifiziert → frei (Seite wird ohne Auth ausgeliefert)
// Fehlt die Config komplett, erzwingt enforceEndpointPolicy() selbst
// Cookie-Auth (fail-closed — siehe AdminAuth.php).
AdminAuth::enforceEndpointPolicy($page, 'html');
if ($page === 'config-db-admin' && !AdminAuth::isAdmin()) {
    http_response_code(403);
    echo '<!DOCTYPE html><html><body><h1>403 — Nur für Administratoren</h1></body></html>';
    exit;
}

// ===== HTML AUSLIEFERN =====
$htmlFile = __DIR__ . '/' . $page . '.html';
if (!file_exists($htmlFile)) {
    http_response_code(404);
    echo '<!DOCTYPE html><html><body><h1>404 — Datei nicht gefunden</h1></body></html>';
    exit;
}

header('Content-Type: text/html; charset=utf-8');
readfile($htmlFile);
