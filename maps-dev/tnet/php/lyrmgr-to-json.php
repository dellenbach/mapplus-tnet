<?php
/**
 * lyrmgr-to-json.php
 * Converts ALL layer managers from lyrmgr.conf to a hierarchical JSON structure
 * Uses lyrmgr-mapping.json to map layer managers to top-level categories
 *
 * @version    1.1
 * @date       2026-02-12
 * @copyright  Trigonet AG
 * @author     Marco Dellenbach
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

require_once __DIR__ . '/../api/includes/CorePaths.php';

// Path to configuration files
$confPath = __DIR__ . '/../../public/config/lyrmgr.conf';
$mappingPath = __DIR__ . '/lyrmgr-mapping.json';
$coreConfigPath = TnetCorePaths::getConfigPath();

if (!file_exists($confPath)) {
    echo json_encode(['error' => 'lyrmgr.conf not found']);
    exit;
}

if (!file_exists($mappingPath)) {
    echo json_encode(['error' => 'lyrmgr-mapping.json not found']);
    exit;
}

// Read and decode configurations
$confContent = file_get_contents($confPath);
$conf = json_decode($confContent, true);

$mappingContent = file_get_contents($mappingPath);
$mapping = json_decode($mappingContent, true);

// Read layer definitions from core/config/layers_*.conf files
$layerDefinitions = [];
$layerFilesFound = 0;
if ($coreConfigPath && is_dir($coreConfigPath)) {
    $layerFiles = glob($coreConfigPath . '/layers_*.conf');
    $layerFilesFound = count($layerFiles);
    foreach ($layerFiles as $layerFile) {
        $content = file_get_contents($layerFile);
        $layers = json_decode($content, true);
        if (json_last_error() === JSON_ERROR_NONE && is_array($layers)) {
            // Merge layer definitions
            $layerDefinitions = array_merge($layerDefinitions, $layers);
        }
    }
}

if (json_last_error() !== JSON_ERROR_NONE) {
    echo json_encode(['error' => 'Invalid JSON: ' . json_last_error_msg()]);
    exit;
}

// Build result structure
$result = [
    'version' => '2.0',
    'debug' => [
        'coreConfigPath' => $coreConfigPath,
        'layerFilesFound' => $layerFilesFound,
        'layerDefinitionsCount' => count($layerDefinitions)
    ],
    'categories' => []
];

// Process each top-level category from mapping
foreach ($mapping['categories'] as $topCategory) {
    $lyrmgrKey = $topCategory['lyrmgr'];
    
    if (!isset($conf[$lyrmgrKey])) {
        continue; // Skip if layer manager doesn't exist
    }
    
    $lyrmgr = $conf[$lyrmgrKey];
    $topCategoryData = [
        'id' => $topCategory['id'],
        'name' => $topCategory['name'],
        'icon' => $topCategory['icon'],
        'subcategories' => []
    ];
    
    // Process structure within this layer manager
    if (isset($lyrmgr['structure'])) {
        $structure = $lyrmgr['structure'];
        
        foreach ($structure as $categoryId => $category) {
            $categoryData = [
                'id' => $categoryId,
                'name' => ucfirst($categoryId),
                'icon' => $category['iconClass'] ?? '',
                'groups' => []
            ];
            
            // Process items in category
            if (isset($category['items'])) {
                foreach ($category['items'] as $groupId => $group) {
                    $groupData = [
                        'id' => $groupId,
                        'name' => extractLayerName($groupId),
                        'open' => $group['open'] ?? false,
                        'layers' => []
                    ];
                    
                    // Process layers in group
                    if (isset($group['items'])) {
                        $groupData['layers'] = processLayerItems($group['items']);
                    }
                    
                    $categoryData['groups'][] = $groupData;
                }
            }
            
            $topCategoryData['subcategories'][] = $categoryData;
        }
    }
    
    $result['categories'][] = $topCategoryData;
}

// Helper function to process layer items recursively
function processLayerItems($items) {
    global $layerDefinitions;
    $layers = [];
    
    foreach ($items as $item) {
        if (is_string($item)) {
            // Simple layer reference
            $layerData = [
                'id' => $item,
                'name' => extractLayerName($item),
                'type' => 'layer'
            ];
            
            // Try to find layer definition - check full ID and base layer
            $def = findLayerDefinition($item);
            if ($def) {
                $layerData['url'] = $def['url'] ?? null;
                $layerData['layerType'] = $def['type'] ?? null;
                $layerData['opacity'] = $def['opacity'] ?? ($def['options']['opacity'] ?? 1.0);
                $layerData['visible'] = (bool)($def['visible'] ?? false);
                $layerData['params'] = $def['params'] ?? [];
                $layerData['options'] = $def['options'] ?? [];
            }
            
            $layers[] = $layerData;
        } elseif (is_array($item) && isset($item['name'])) {
            // Group or layer with metadata
            $layerData = [
                'id' => $item['name'],
                'name' => extractLayerName($item['name']),
                'type' => isset($item['items']) ? 'group' : 'layer',
                'open' => $item['open'] ?? false
            ];
            
            // Add layer definition data for non-groups
            if (!isset($item['items'])) {
                $def = findLayerDefinition($item['name']);
                if ($def) {
                    $layerData['url'] = $def['url'] ?? null;
                    $layerData['layerType'] = $def['type'] ?? null;
                    $layerData['opacity'] = $def['opacity'] ?? ($def['options']['opacity'] ?? 1.0);
                    $layerData['visible'] = (bool)($def['visible'] ?? false);
                    $layerData['params'] = $def['params'] ?? [];
                    $layerData['options'] = $def['options'] ?? [];
                }
            }
            
            // Process sub-items if it's a group
            if (isset($item['items'])) {
                $layerData['layers'] = processLayerItems($item['items']);
            }
            
            $layers[] = $layerData;
        }
    }
    
    return $layers;
}

// Helper function to find layer definition
function findLayerDefinition($layerId) {
    global $layerDefinitions;
    
    // Try exact match first
    if (isset($layerDefinitions[$layerId])) {
        return $layerDefinitions[$layerId];
    }
    
    // Try without sublayer (e.g. "gis_oereb/nw_planungszonen_def" instead of "gis_oereb/nw_planungszonen_def/planungszonen_kommunal")
    $parts = explode('/', $layerId);
    while (count($parts) > 1) {
        array_pop($parts); // Remove last part
        $baseId = implode('/', $parts);
        if (isset($layerDefinitions[$baseId])) {
            return $layerDefinitions[$baseId];
        }
    }
    
    return null;
}

// Helper function to extract readable layer name
function extractLayerName($layerId) {
    // Extract last part of layer path
    $parts = explode('/', $layerId);
    $lastName = end($parts);
    
    // Convert snake_case to Title Case
    $name = str_replace('_', ' ', $lastName);
    $name = ucwords($name);
    
    return $name;
}

// Output JSON
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
?>
