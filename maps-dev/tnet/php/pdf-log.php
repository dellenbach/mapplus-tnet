<?php
/**
 * pdf-log.php
 *
 * Speichert PDFs und Druckprotokolle im Log-Verzeichnis.
 * - POST ?action=log   → JSON-Metadaten ins print.log schreiben
 * - POST (ohne action) → PDF-Blob speichern (Archivierung)
 *
 * Log-Verzeichnis: /data/Client_Data/nwow/tmp/pdf/
 *
 * @version    1.1
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

header('Content-Type: application/json; charset=utf-8');

// ── Konfiguration ──────────────────────────────────────────
$logDir   = '/data/Client_Data/nwow/tmp/pdf';
$printLog = $logDir . '/print.log';

$retentionDays = isset($_GET['retention']) ? max(1, intval($_GET['retention'])) : 1;
$maxAge = $retentionDays * 24 * 3600;

// ── Verzeichnis sicherstellen ──────────────────────────────
if (!is_dir($logDir)) {
    @mkdir($logDir, 0755, true);
}

// ── Alte PDF-Dateien bereinigen (> retention) ──────────────
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

// ── Action: Metadaten-Log ──────────────────────────────────
$action = isset($_GET['action']) ? $_GET['action'] : '';

if ($action === 'log') {
    $json = file_get_contents('php://input');
    $data = json_decode($json, true);

    if (!$data || !is_array($data)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'Ungültige JSON-Daten']);
        exit;
    }

    // Log-Zeile: Tab-separiert
    $ts       = isset($data['timestamp'])  ? $data['timestamp']  : date('c');
    $tmpl     = isset($data['template'])   ? $data['template']   : '?';
    $paper    = isset($data['paper'])      ? $data['paper']      : '?';
    $dpi      = isset($data['dpi'])        ? $data['dpi']        : '?';
    $scale    = isset($data['scale'])      ? $data['scale']      : '?';
    $duration = isset($data['duration_s']) ? $data['duration_s'] . 's' : '?';
    $size     = isset($data['size_bytes']) ? round($data['size_bytes'] / 1024) . 'KB' : '?';
    $extent   = isset($data['extent'])     ? implode(',', $data['extent']) : '?';
    $center   = isset($data['center'])     ? implode(',', $data['center']) : '?';
    $rotation = isset($data['rotation'])   ? $data['rotation'] . '°' : '0°';
    $layers   = isset($data['layers'])     ? implode('; ', $data['layers']) : '?';
    $title    = isset($data['title'])      ? $data['title']      : '';
    $filename = isset($data['filename'])   ? $data['filename']   : '';

    $line = implode("\t", [
        $ts, $tmpl, $paper, $dpi . 'dpi', $scale, $duration,
        $size, $center, $rotation, $filename, $title, $layers
    ]) . "\n";

    $written = file_put_contents($printLog, $line, FILE_APPEND | LOCK_EX);

    echo json_encode([
        'ok'   => ($written !== false),
        'file' => $printLog
    ]);
    exit;
}

// ── Action: PDF speichern ──────────────────────────────────
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
$baseName = pathinfo($origName, PATHINFO_FILENAME);
$safe = preg_replace('/[\/\\:\x00]/', '_', $baseName);
$safe = trim($safe);
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
