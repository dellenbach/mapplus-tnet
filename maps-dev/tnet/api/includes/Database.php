<?php
/**
 * Database - PostgreSQL-Verbindung für MAP+ API
 * 
 * Singleton-Wrapper um PDO/pgsql für das mapplusconf-Schema.
 * Konfiguration über db_config.php oder Umgebungsvariablen.
 *
 * @version    1.0
 * @date       2026-02-21
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

class Database {

    /** @var PDO|null Singleton-Instanz */
    private static $pdo = null;

    /** @var string Schema-Name */
    const SCHEMA = 'mapplusconf';

    /**
     * Liefert die PDO-Instanz (lazy init)
     * 
     * @return PDO
     * @throws RuntimeException Wenn keine Verbindung möglich
     */
    public static function getConnection(): PDO {
        if (self::$pdo !== null) {
            return self::$pdo;
        }

        $config = self::loadConfig();

        $dsn = sprintf(
            'pgsql:host=%s;port=%s;dbname=%s',
            $config['host'],
            $config['port'],
            $config['dbname']
        );

        try {
            self::$pdo = new PDO($dsn, $config['user'], $config['password'], [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);

            // Schema als Standard-Suchpfad setzen
            self::$pdo->exec("SET search_path TO " . self::SCHEMA . ", public");

        } catch (PDOException $e) {
            throw new RuntimeException(
                'Datenbankverbindung fehlgeschlagen: ' . $e->getMessage()
            );
        }

        return self::$pdo;
    }

    /**
     * Prüft ob eine Datenbankverbindung möglich ist
     * 
     * @return array Status-Info ['available' => bool, 'message' => string]
     */
    public static function isAvailable(): array {
        try {
            $pdo = self::getConnection();
            $pdo->query('SELECT 1');
            return ['available' => true, 'message' => 'OK'];
        } catch (\Exception $e) {
            return ['available' => false, 'message' => $e->getMessage()];
        }
    }

    /**
     * Prüft ob das mapplusconf-Schema existiert und Tabellen enthält
     * 
     * @return array Schema-Info ['exists' => bool, 'tables' => int]
     */
    public static function schemaReady(): array {
        try {
            $pdo = self::getConnection();
            $stmt = $pdo->prepare(
                "SELECT COUNT(*) AS cnt FROM information_schema.tables 
                 WHERE table_schema = :schema"
            );
            $stmt->execute(['schema' => self::SCHEMA]);
            $row = $stmt->fetch();
            return [
                'exists' => ($row['cnt'] > 0),
                'tables' => (int) $row['cnt']
            ];
        } catch (\Exception $e) {
            return ['exists' => false, 'tables' => 0];
        }
    }

    /**
     * Lädt Konfiguration aus db_config.php oder Umgebungsvariablen
     * 
     * @return array ['host', 'port', 'dbname', 'user', 'password']
     */
    private static function loadConfig(): array {
        // 1. Versuch: Konfigurationsdatei
        $configFile = __DIR__ . '/db_config.php';
        if (file_exists($configFile)) {
            $config = require $configFile;
            if (is_array($config)) {
                return array_merge([
                    'host'     => 'localhost',
                    'port'     => '5432',
                    'dbname'   => 'mapplus',
                    'user'     => 'mapplus',
                    'password' => '',
                ], $config);
            }
        }

        // 2. Fallback: Umgebungsvariablen
        return [
            'host'     => getenv('MAPPLUS_DB_HOST')     ?: 'localhost',
            'port'     => getenv('MAPPLUS_DB_PORT')     ?: '5432',
            'dbname'   => getenv('MAPPLUS_DB_NAME')     ?: 'mapplus',
            'user'     => getenv('MAPPLUS_DB_USER')     ?: 'mapplus',
            'password' => getenv('MAPPLUS_DB_PASSWORD') ?: '',
        ];
    }

    /**
     * Schliesst die Verbindung explizit
     */
    public static function close(): void {
        self::$pdo = null;
    }
}
