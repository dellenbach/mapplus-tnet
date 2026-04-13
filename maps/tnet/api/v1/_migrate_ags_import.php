<?php
/**
 * _migrate_ags_import.php
 * Einmaliges Migrationsskript: Erstellt die Tabelle ags_import_history
 * Nach Ausführung wieder löschen!
 *
 * @version    1.0
 * @date       2026-03-26
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/../includes/AdminAuth.php';
AdminAuth::requireAuth();
require_once __DIR__ . '/../includes/Database.php';

try {
    $pdo = Database::getConnection();

    // Tabelle erstellen
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS mapplusconf.ags_import_history (
            id              SERIAL       PRIMARY KEY,
            service_name    TEXT         NOT NULL,
            hash            TEXT,
            published_at    TEXT,
            published_by    TEXT,
            imported_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
        )
    ");

    // Index erstellen
    $pdo->exec("
        CREATE INDEX IF NOT EXISTS idx_ags_import_svc
            ON mapplusconf.ags_import_history (service_name, imported_at DESC)
    ");

    // Kommentar
    $pdo->exec("
        COMMENT ON TABLE mapplusconf.ags_import_history
            IS 'Audit-Log: Jeder AGS-Import-Lauf erzeugt eine Zeile pro Dienst.'
    ");

    // Prüfen ob Tabelle existiert
    $stmt = $pdo->query("
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'mapplusconf' AND table_name = 'ags_import_history'
        ORDER BY ordinal_position
    ");
    $columns = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'message' => 'Tabelle ags_import_history erstellt',
        'columns' => $columns
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
}
