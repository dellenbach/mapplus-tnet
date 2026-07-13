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

class TnetSchemaConnection {

    /** @var PDO */
    private $pdo;

    public function __construct(PDO $pdo) {
        $this->pdo = $pdo;
    }

    public function exec($statement) {
        return $this->pdo->exec(Database::rewriteSql($statement));
    }

    public function query($query, $fetchMode = null, $classname = null, $constructorArgs = null) {
        if (func_num_args() === 1) {
            return $this->pdo->query(Database::rewriteSql($query));
        }
        if ($classname !== null) {
            return $this->pdo->query(Database::rewriteSql($query), $fetchMode, $classname, $constructorArgs);
        }
        return $this->pdo->query(Database::rewriteSql($query), $fetchMode);
    }

    public function prepare($query, $options = []) {
        return $this->pdo->prepare(Database::rewriteSql($query), $options);
    }

    public function __call($name, $arguments) {
        return call_user_func_array([$this->pdo, $name], $arguments);
    }
}

class Database {

    /** @var TnetSchemaConnection|null Singleton-Instanz */
    private static $pdo = null;

    /** @var string Schema-Name */
    const SCHEMA = 'mapplusconf';

    /** @var string|null Aktives Schema */
    private static $schema = null;

    /**
     * Liefert die PDO-Instanz (lazy init)
     * 
    * @return TnetSchemaConnection
     * @throws RuntimeException Wenn keine Verbindung möglich
     */
    public static function getConnection() {
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
            $pdo = new PDO($dsn, $config['user'], $config['password'], [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
            self::$pdo = new TnetSchemaConnection($pdo);

            // Schema als Standard-Suchpfad setzen
            self::$pdo->exec("SET search_path TO " . self::quoteIdentifier(self::getSchema()) . ", public");

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
    * Prüft ob das aktive Schema existiert und Tabellen enthält
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
            $stmt->execute(['schema' => self::getSchema()]);
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
     * Setzt den Schema-Namen explizit (Override aus Applikationskontext).
     * Muss VOR dem ersten getConnection()/getSchema()-Aufruf gesetzt werden.
     *
     * @param string $schema Schema-Name (z.B. 'mapplusconf_dev')
     */
    public static function setSchemaOverride(string $schema): void {
        self::$schema = self::normalizeSchemaName($schema);
        // Falls bereits eine Verbindung besteht, search_path aktualisieren
        if (self::$pdo !== null) {
            self::$pdo->exec("SET search_path TO " . self::quoteIdentifier(self::$schema) . ", public");
        }
    }

    /**
     * Liefert den aktiven Schema-Namen.
     *
     * DEV nutzt standardmaessig mapplusconf_dev, PROD mapplusconf.
     *
     * @return string Schema-Name
     */
    public static function getSchema(): string {
        if (self::$schema !== null) {
            return self::$schema;
        }

        $config = self::loadConfig();
        self::$schema = self::normalizeSchemaName($config['schema'] ?? self::defaultSchema());
        return self::$schema;
    }

    /**
     * Schreibt historische mapplusconf-Qualifizierungen auf das aktive Schema um.
     *
     * @param string $sql SQL-Statement
     * @return string SQL mit aktivem Schema
     */
    public static function rewriteSql($sql): string {
        $schema = self::getSchema();
        if ($schema === self::SCHEMA) {
            return $sql;
        }

        $rewritten = str_replace(
            [self::SCHEMA . '.', "'" . self::SCHEMA . "'"],
            [self::quoteIdentifier($schema) . '.', "'" . $schema . "'"],
            $sql
        );

        $quotedSchema = self::quoteIdentifier($schema);
        $rewritten = preg_replace(
            '/CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+' . preg_quote(self::SCHEMA, '/') . '\b/i',
            'CREATE SCHEMA IF NOT EXISTS ' . $quotedSchema,
            $rewritten
        );
        $rewritten = preg_replace(
            '/SET\s+search_path\s+TO\s+' . preg_quote(self::SCHEMA, '/') . '\s*,\s*public\s*;/i',
            'SET search_path TO ' . $quotedSchema . ', public;',
            $rewritten
        );

        return $rewritten;
    }

    /**
     * Quoted einen PostgreSQL-Identifier nach Validierung.
     *
     * @param string $identifier Schema-/Tabellenname
     * @return string Quoted Identifier
     */
    public static function quoteIdentifier($identifier): string {
        $name = self::normalizeSchemaName($identifier);
        return '"' . str_replace('"', '""', $name) . '"';
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
                    'schema'   => getenv('MAPPLUS_DB_SCHEMA') ?: self::defaultSchema(),
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
            'schema'   => getenv('MAPPLUS_DB_SCHEMA')   ?: self::defaultSchema(),
        ];
    }

    /**
     * Ermittelt das Default-Schema aus dem App-Root.
     *
     * @return string Schema-Name
     */
    private static function defaultSchema(): string {
        $scriptName = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '');
        $dir = str_replace('\\', '/', __DIR__);
        if (strpos($scriptName, '/maps-dev/') === 0 || strpos($dir, '/maps-dev/') !== false) {
            return 'mapplusconf_dev';
        }
        return self::SCHEMA;
    }

    /**
     * Validiert Schema-Namen gegen einfache PostgreSQL-Identifier.
     *
     * @param string $schema Schema-Name
     * @return string Validierter Schema-Name
     */
    private static function normalizeSchemaName($schema): string {
        $schema = trim((string)$schema);
        if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $schema)) {
            throw new InvalidArgumentException('Ungueltiger PostgreSQL-Schema-Name: ' . $schema);
        }
        return $schema;
    }

    /**
     * Schliesst die Verbindung explizit
     */
    public static function close(): void {
        self::$pdo = null;
    }
}
