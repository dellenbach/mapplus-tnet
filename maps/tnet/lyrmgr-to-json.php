<?php
/**
 * lyrmgr-to-json.php
 * Converts lyrmgr.conf to a simplified JSON structure for JavaScript layer catalog
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// Path to lyrmgr.conf
$confPath = '../public/config/lyrmgr.conf';

if (!file_exists($confPath)) {
    echo json_encode(['error' => 'lyrmgr.conf not found']);
    exit;
}

// Read and decode JSON
$confContent = file_get_contents($confPath);
$conf = json_decode($confContent, true);

if (json_last_error() !== JSON_ERROR_NONE) {
    echo json_encode(['error' => 'Invalid JSON in lyrmgr.conf: ' . json_last_error_msg()]);
    exit;
}

// Extract layer structure
$result = [
    'version' => $conf['main_lyrmgr']['version'] ?? '1.0',
    'categories' => [],
    'layers' => []
];

// Process structure
if (isset($conf['main_lyrmgr']['structure'])) {
    $structure = $conf['main_lyrmgr']['structure'];
    
    foreach ($structure as $categoryId => $category) {
        $categoryData = [
            'id' => $categoryId,
            'name' => $categoryId,
            'icon' => $category['iconClass'] ?? '',
            'groups' => []
        ];
        
        // Process items in category
        if (isset($category['items'])) {
            foreach ($category['items'] as $groupId => $group) {
                $groupData = [
                    'id' => $groupId,
                    'name' => $groupId,
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
        
        $result['categories'][] = $categoryData;
    }
}

// Helper function to process layer items recursively
function processLayerItems($items) {
    $layers = [];
    
    foreach ($items as $item) {
        if (is_string($item)) {
            // Simple layer reference
            $layers[] = [
                'id' => $item,
                'name' => extractLayerName($item),
                'type' => 'layer'
            ];
        } elseif (is_array($item) && isset($item['name'])) {
            // Group or layer with metadata
            $layerData = [
                'id' => $item['name'],
                'name' => extractLayerName($item['name']),
                'type' => isset($item['items']) ? 'group' : 'layer',
                'open' => $item['open'] ?? false
            ];
            
            // Process sub-items if it's a group
            if (isset($item['items'])) {
                $layerData['layers'] = processLayerItems($item['items']);
            }
            
            $layers[] = $layerData;
        }
    }
    
    return $layers;
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
