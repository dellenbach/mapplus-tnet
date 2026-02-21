<?php
/**
 * JsonCache - JSON File Cache für API Responses
 * 
 * Cacht aufwendig generierte JSON-Responses als Dateien.
 * Invalidiert automatisch wenn sich Quell-Configs ändern.
 *
 * @version    1.0
 * @date       2026-02-20
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

class JsonCache {
    
    /** @var string Pfad zum Cache-Verzeichnis */
    private string $cacheDir;
    
    /** @var string|null Letzte Fehlermeldung */
    private ?string $lastError = null;
    
    /** @var string Beschreibbares Datenverzeichnis für Cache */
    private const DATA_CACHE_DIR = '/data/Client_Data/nwow/tmp/api-cache';
    
    public function __construct(string $cacheDir = null) {
        $preferredDir = $cacheDir ?? __DIR__ . '/../cache';
        
        // 1. Bevorzugt: lokales cache/ Verzeichnis (wenn beschreibbar)
        if (is_dir($preferredDir) && is_writable($preferredDir)) {
            $this->cacheDir = $preferredDir;
            return;
        }
        
        // Versuche es zu erstellen
        if (!is_dir($preferredDir)) {
            @mkdir($preferredDir, 0777, true);
        }
        if (is_dir($preferredDir) && is_writable($preferredDir)) {
            $this->cacheDir = $preferredDir;
            return;
        }
        
        // 2. Fallback: /data/Client_Data/nwow/tmp/api-cache/ (beschreibbar für www-data)
        $dataDir = self::DATA_CACHE_DIR;
        if (!is_dir($dataDir)) {
            @mkdir($dataDir, 0775, true);
        }
        if (is_dir($dataDir) && is_writable($dataDir)) {
            $this->cacheDir = $dataDir;
            return;
        }
        
        // 3. Letzter Fallback: /tmp/ (wird bei Server-Neustart geleert)
        $tmpDir = sys_get_temp_dir() . '/tnet-api-cache';
        if (!is_dir($tmpDir)) {
            @mkdir($tmpDir, 0777, true);
        }
        $this->cacheDir = $tmpDir;
    }
    
    /**
     * Prüft ob das Cache-Verzeichnis beschreibbar ist
     */
    public function isWritable(): bool {
        return is_dir($this->cacheDir) && is_writable($this->cacheDir);
    }
    
    /**
     * Gibt die letzte Fehlermeldung zurück
     */
    public function getLastError(): ?string {
        return $this->lastError;
    }
    
    /**
     * Gibt den Cache-Verzeichnispfad zurück
     */
    public function getCacheDir(): string {
        return $this->cacheDir;
    }
    
    /**
     * Cache-Key generieren aus Endpoint-Name und Parametern
     * 
     * @param string $endpoint Endpoint-Name (z.B. 'layers')
     * @param array  $params   Parameter die den Cache beeinflussen
     * @return string Cache-Dateiname
     */
    public function getCacheKey(string $endpoint, array $params = []): string {
        $params = array_filter($params, function($v) { return $v !== null && $v !== ''; });
        ksort($params);
        $hash = md5($endpoint . json_encode($params));
        return $endpoint . '_' . $hash . '.json';
    }
    
    /**
     * Gecachte Daten laden (wenn gültig)
     * 
     * @param string $cacheKey     Cache-Dateiname
     * @param array  $sourceFiles  Quell-Dateien für Invalidierung
     * @param int    $maxAge       Max. Alter in Sekunden (Default: 1h)
     * @return array|null          Gecachte Daten oder null bei Cache Miss
     */
    public function get(string $cacheKey, array $sourceFiles = [], int $maxAge = 3600): ?array {
        $cacheFile = $this->cacheDir . '/' . $cacheKey;
        
        if (!file_exists($cacheFile)) {
            return null;
        }
        
        $cacheTime = filemtime($cacheFile);
        
        // Zeitbasierte Invalidierung
        if ((time() - $cacheTime) > $maxAge) {
            return null;
        }
        
        // Quell-Dateien geändert? → Cache ungültig
        foreach ($sourceFiles as $sourceFile) {
            if (file_exists($sourceFile) && filemtime($sourceFile) > $cacheTime) {
                return null;
            }
        }
        
        $content = file_get_contents($cacheFile);
        $data = json_decode($content, true);
        
        if ($data === null) {
            unlink($cacheFile);
            return null;
        }
        
        return $data;
    }
    
    /**
     * Daten in Cache speichern
     * 
     * @param string $cacheKey Cache-Dateiname
     * @param array  $data     Zu cachende Daten
     * @return bool Erfolg
     */
    public function set(string $cacheKey, array $data): bool {
        $this->lastError = null;
        
        if (!is_dir($this->cacheDir) || !is_writable($this->cacheDir)) {
            $this->lastError = "Cache-Verzeichnis nicht beschreibbar: {$this->cacheDir}";
            return false;
        }
        
        $cacheFile = $this->cacheDir . '/' . $cacheKey;
        $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        
        if ($json === false) {
            $this->lastError = "JSON-Encoding fehlgeschlagen: " . json_last_error_msg();
            return false;
        }
        
        $result = @file_put_contents($cacheFile, $json, LOCK_EX);
        
        if ($result === false) {
            $this->lastError = "Cache-Datei konnte nicht geschrieben werden: {$cacheFile} — " . (error_get_last()['message'] ?? 'unbekannter Fehler');
            return false;
        }
        
        return true;
    }
    
    /**
     * Einzelnen Cache-Eintrag löschen
     */
    public function invalidate(string $cacheKey): bool {
        $cacheFile = $this->cacheDir . '/' . $cacheKey;
        if (file_exists($cacheFile)) {
            return unlink($cacheFile);
        }
        return true;
    }
    
    /**
     * Gesamten Cache leeren
     * 
     * @return int Anzahl gelöschter Einträge
     */
    public function clear(): int {
        $count = 0;
        $files = glob($this->cacheDir . '/*.json');
        foreach ($files as $file) {
            if (unlink($file)) {
                $count++;
            }
        }
        return $count;
    }
    
    /**
     * Cache-Statistiken abrufen
     * 
     * @return array Statistiken mit Einträgen, Grösse, Alter
     */
    public function getStats(): array {
        $files = glob($this->cacheDir . '/*.json');
        $totalSize = 0;
        $entries = [];
        
        foreach ($files as $file) {
            $size = filesize($file);
            $totalSize += $size;
            $age = time() - filemtime($file);
            $entries[] = [
                'key'           => basename($file),
                'size'          => $size,
                'sizeFormatted' => self::formatBytes($size),
                'age'           => $age,
                'ageFormatted'  => self::formatDuration($age),
                'created'       => date('c', filemtime($file))
            ];
        }
        
        return [
            'cacheDir'       => realpath($this->cacheDir) ?: $this->cacheDir,
            'writable'       => $this->isWritable(),
            'entries'        => count($entries),
            'totalSize'      => $totalSize,
            'totalFormatted' => self::formatBytes($totalSize),
            'files'          => $entries
        ];
    }
    
    private static function formatBytes(int $bytes): string {
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        while ($bytes >= 1024 && $i < count($units) - 1) {
            $bytes /= 1024;
            $i++;
        }
        return round($bytes, 1) . ' ' . $units[$i];
    }
    
    private static function formatDuration(int $seconds): string {
        if ($seconds < 60) return $seconds . 's';
        if ($seconds < 3600) return round($seconds / 60) . 'min';
        return round($seconds / 3600, 1) . 'h';
    }
}
