<?php
/**
 * pdf-save.php
 *
 * Nimmt ein PDF als POST-Upload entgegen, speichert es
 * im temporären Verzeichnis und gibt die URL zurück.
 *
 * POST-Parameter:
 *   - pdf       (file)   Das PDF-Blob
 *   - filename  (string) Gewünschter Dateiname (optional)
 *
 * Antwort (JSON):
 *   { "ok": true, "url": "/maps/tnet/php/pdf-tmp/abc123.pdf", "filename": "xxx.pdf" }
 *
 * Alte PDFs (> 2 Stunden) werden bei jedem Aufruf bereinigt.
 *
 * @version    1.0
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../api/includes/CorePaths.php';

// ── Konfiguration ──────────────────────────────────────────
$tmpDir     = __DIR__ . '/pdf-tmp';
$tmpUrlBase = TnetCorePaths::getAppBasePath() . '/tnet/php/pdf-tmp';
$maxAge     = 2 * 3600;  // 2 Stunden

// ── Verzeichnis sicherstellen ──────────────────────────────
if (!is_dir($tmpDir)) {
    mkdir($tmpDir, 0755, true);
    // .htaccess: Verzeichnislisting verbieten
    file_put_contents($tmpDir . '/.htaccess', "Options -Indexes\n");
}

// ── Alte Dateien bereinigen ────────────────────────────────
$now = time();
foreach (glob($tmpDir . '/*.pdf') as $old) {
    if ($now - filemtime($old) > $maxAge) {
        @unlink($old);
    }
}

// ── Nur POST erlaubt ───────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Nur POST erlaubt']);
    exit;
}

// ── PDF entgegennehmen ─────────────────────────────────────
$pdfData = null;
$origName = 'Kartenexport.pdf';

// Variante 1: multipart/form-data (File-Upload)
if (isset($_FILES['pdf']) && $_FILES['pdf']['error'] === UPLOAD_ERR_OK) {
    $pdfData = file_get_contents($_FILES['pdf']['tmp_name']);
    if (!empty($_POST['filename'])) {
        $origName = basename($_POST['filename']);
    }
}
// Variante 2: raw body (application/pdf)
else {
    $pdfData = file_get_contents('php://input');
    if (!empty($_GET['filename'])) {
        $origName = basename($_GET['filename']);
    }
}

if (!$pdfData || strlen($pdfData) < 100) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Kein PDF empfangen']);
    exit;
}

// ── Speichern ──────────────────────────────────────────────
$uid  = substr(md5(uniqid('', true) . random_bytes(8)), 0, 12);
$safe = preg_replace('/[^a-zA-Z0-9_\-]/', '_', pathinfo($origName, PATHINFO_FILENAME));
$file = $safe . '_' . $uid . '.pdf';
$path = $tmpDir . '/' . $file;

file_put_contents($path, $pdfData);

// ── Antwort ────────────────────────────────────────────────
echo json_encode([
    'ok'       => true,
    'url'      => $tmpUrlBase . '/' . $file,
    'filename' => $origName,
    'size'     => strlen($pdfData)
]);
