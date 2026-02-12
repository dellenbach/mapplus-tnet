<?php
/**
 * pdf-log.php
 *
 * Speichert PDFs im Log-Verzeichnis (gleicher Ort wie agsproxy.log).
 * Dient nur zur Archivierung — kein Response an Client nötig.
 *
 * @version    1.0
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

header('Content-Type: application/json; charset=utf-8');

// ── Konfiguration ──────────────────────────────────────────
// Gleicher Pfad wie agsproxy Logs
$logDir = '/data/Client_Data/nwow/tmp/pdf';

// Retention in Tagen: aus Query-Parameter oder Default 1 Tag
$retentionDays = isset($_GET['retention']) ? max(1, intval($_GET['retention'])) : 1;
$maxAge = $retentionDays * 24 * 3600;

// ── Verzeichnis sicherstellen ──────────────────────────────
if (!is_dir($logDir)) {
    @mkdir($logDir, 0755, true);
}

// ── Alte Dateien bereinigen (> 7 Tage) ─────────────────────
$now = time();
foreach (glob($logDir . '/*.pdf') as $old) {
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

if (isset($_FILES['pdf']) && $_FILES['pdf']['error'] === UPLOAD_ERR_OK) {
    $pdfData = file_get_contents($_FILES['pdf']['tmp_name']);
    if (!empty($_POST['filename'])) {
        $origName = basename($_POST['filename']);
    }
} else {
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
// Dateiname: nur wirklich gefährliche Zeichen entfernen (Pfad-Separator etc.)
// Originalname beibehalten (mit Punkten, Unterstrichen, etc.)
$baseName = pathinfo($origName, PATHINFO_FILENAME);
// Nur Path-Separatoren und Null-Bytes entfernen
$safe = preg_replace('/[\/\\\\:\x00]/', '_', $baseName);
// Leerzeichen am Anfang/Ende trimmen
$safe = trim($safe);
// Falls leer, Fallback
if (empty($safe)) {
    $safe = 'Kartenexport_' . date('Ymd_His');
}
$file = $safe . '.pdf';
$path = $logDir . '/' . $file;

// Falls Datei existiert: mit Timestamp versehen
if (file_exists($path)) {
    $ts = date('Ymd_His');
    $file = $safe . '_' . $ts . '.pdf';
    $path = $logDir . '/' . $file;
}

$written = file_put_contents($path, $pdfData);

// ── Antwort ────────────────────────────────────────────────
echo json_encode([
    'ok'       => ($written !== false),
    'path'     => $path,
    'filename' => $file,
    'size'     => strlen($pdfData)
]);
