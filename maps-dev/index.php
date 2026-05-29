<?php

$host = $_SERVER['HTTP_HOST'];
$requestUri = $_SERVER['REQUEST_URI'];
$scriptName = $_SERVER['SCRIPT_NAME'] ?? '';
function resolveAppBasePath($scriptName, $requestUri) {
    $scriptBasePath = rtrim(str_replace('\\', '/', dirname($scriptName)), '/');
    if ($scriptBasePath !== '' && $scriptBasePath !== '.') {
        return $scriptBasePath;
    }

    $requestPath = parse_url($requestUri, PHP_URL_PATH) ?: '';
    if (preg_match('#^/(maps(?:-dev)?)(?:/|$)#', $requestPath, $matches)) {
        return '/' . $matches[1];
    }

    return '';
}
$appBasePath = resolveAppBasePath($scriptName, $requestUri);
$appCookiePath = ($appBasePath !== '' ? $appBasePath : '') . '/';
if ($appCookiePath === '//') {
    $appCookiePath = '/';
}
require_once __DIR__ . '/tnet/api/includes/CorePaths.php';

function resolveCoreNlsFiles($lang, $filename) {
    $paths = [];
    $coreNls = TnetCorePaths::getNlsPath($lang);
    if ($coreNls) {
        $paths[] = $coreNls . '/' . $filename;
    }

    return $paths;
}
if ($host === 'nwow.mapplus.ch' && $requestUri === '/maps/') {
    //header('Location: https://dev.gis-daten.ch/maps/');
    //exit;
}

function getTokenDirForAppBase($appBasePath) {
    if ($appBasePath === '/maps-dev') {
        return '/data/Client_Data/nwow/tmp/maps-dev/token';
    }
    return '/data/Client_Data/nwow/tmp/maps/token';
}

/**
 * Cleanup alte Token-Dateien (älter als 1 Tag)
 * - Session-Tokens: /data/Client_Data/nwow/tmp/<app>/token/mapplus_token_*
 * - ArcGIS-Cache: _token_cache/arcgis_token.json (wenn abgelaufen)
 */
function cleanupOldTokens($appBasePath) {
    // Session-Tokens aufräumen
    $tokenDir = getTokenDirForAppBase($appBasePath);
    $maxAge = 86400; // 1 Tag in Sekunden
    $now = time();
    
    if (is_dir($tokenDir)) {
        $tokenFiles = glob($tokenDir . '/mapplus_token_*');
        if ($tokenFiles) {
            foreach ($tokenFiles as $file) {
                if (is_file($file) && ($now - filemtime($file)) > $maxAge) {
                    @unlink($file);
                }
            }
        }
    }
    
    // ArcGIS-Cache-Token aufräumen (falls abgelaufen)
    $cacheDir = __DIR__ . "/_token_cache";
    $cacheFile = $cacheDir . "/arcgis_token.json";
    
    if (is_file($cacheFile)) {
        $cacheData = @json_decode(file_get_contents($cacheFile), true);
        if ($cacheData && isset($cacheData['expires'])) {
            // expires in Millisekunden, time() in Sekunden
            if ($cacheData['expires'] < ($now * 1000)) {
                @unlink($cacheFile);
            }
        }
    }
}

// Token-Cleanup beim App-Start (max. alle 60s)
if (!isset($_SESSION['lastTokenCleanup']) || (time() - $_SESSION['lastTokenCleanup']) > 60) {
    cleanupOldTokens($appBasePath);
    $_SESSION['lastTokenCleanup'] = time();
}

// Token für agsproxy

$token = bin2hex(random_bytes(32));
$expires = time() + 86400; // Ablaufzeit (z.B. 1 Tag)
//file_put_contents('/tmp/mapplus_token_' . $token, $expires);
$tokenDir = getTokenDirForAppBase($appBasePath);
file_put_contents($tokenDir . '/mapplus_token_' . $token, $expires);

setcookie("mapplus_token", $token, [
    'expires' => $expires,
    'path' => $appCookiePath,
    'secure' => true,
    'httponly' => true,
    'samesite' => 'None'
]);

// Token für agsproxy END

include_once("./common.php");

$maxlifetime = 0;
$path = $appCookiePath;
$domain = '';
$secure = true;
$httponly = false;
$samesite = 'none'; // here is what we need

if(PHP_VERSION_ID < 70300) {    
    session_set_cookie_params($maxlifetime, $path.'; samesite='.$samesite, $domain, $secure, $httponly);
} else {
    session_set_cookie_params(array(
        'lifetime' => $maxlifetime,
        'path' => $path,
        'domain' => $domain,
        'secure' => $secure,
        'httponly' => $httponly,
        'samesite' => $samesite
    ));
}

// here do the checks with the sso for getting group of user
ini_set("session.use_cookies",'1');
session_start();
$default_lang = "de";
$accept_lang = array("de");	
//$accept_lang = array("de","it","en","fr");	

if ($_GET['lang'] && in_array($_GET['lang'],$accept_lang)){
    $lang=$_GET['lang'];
}else{
    $detectLangFile = TnetCorePaths::resolveCoreFile('detect_lang.inc.php');
    if (!$detectLangFile) {
        http_response_code(500);
        exit('core-dev/detect_lang.inc.php nicht gefunden');
    }
    include_once($detectLangFile);
    $lang=detect_lang($accept_lang,$default_lang);
}
$_SESSION["app_language"]=$lang;

$mobile_ext="";
$ismobile=0;
$_SESSION["isMobile"]=false;
if ($_GET['t']){
    if ($_GET['t']=='m'){
        $mobile_ext='_m';
        $ismobile=1;
        $_SESSION["isMobile"]=true;
    }
}elseif (is_file('../../mapplus-lib/mobile_detect/Mobile_Detect.php')){
    require_once '../../mapplus-lib/mobile_detect/Mobile_Detect.php';
    
    $detect = new Mobile_Detect;	 
    // Any mobile device (phones or tablets).
    if ($detect->isMobile()) {
        $mobile_ext='_m';
         $ismobile=1;
         $_SESSION["isMobile"]=true;
    }
    if ($detect->isTablet()) {
        $mobile_ext="";
         $ismobile=0;
         $_SESSION["isMobile"]=false;
    }
}
$browser = "other";
if(strpos($_SERVER['HTTP_USER_AGENT'], 'MSIE') !== false)
    $browser = 'Internet explorer';
 elseif(strpos($_SERVER['HTTP_USER_AGENT'], 'Trident') !== false)
    $browser =  'Internet explorer';
 elseif(strpos($_SERVER['HTTP_USER_AGENT'], 'Firefox') !== false)
    $browser =  'Mozilla Firefox';
 elseif(strpos($_SERVER['HTTP_USER_AGENT'], 'Chrome') !== false)
    $browser =  'Google Chrome';
 elseif(strpos($_SERVER['HTTP_USER_AGENT'], 'Opera Mini') !== false)
    $browser =  "Opera Mini";
 elseif(strpos($_SERVER['HTTP_USER_AGENT'], 'Opera') !== false)
    $browser =  "Opera";
 elseif(strpos($_SERVER['HTTP_USER_AGENT'], 'Safari') !== false)
    $browser =  "Safari";
 

$site=basename(__DIR__);
$folder=basename(dirname(__DIR__));
$_SESSION['site_path'][$folder]=dirname(__DIR__);

unset($_SESSION["savedRedlining"]);
unset($_SESSION["layer_filter"]);

if ($_GET["group"]=="" && is_dir("./public")){
    $app_group='public';
    $app_profile='public';
    $_SESSION["app_group"]='public';
    $_SESSION["app_credentials"][$site]['public']='public';
}else {
    if (!isset($_SESSION['OIDC_CLAIM_group'])){
        // Alten PHPSESSID-Cookie loeschen, damit nach OIDC-Login kein konkurrierender
        // Cookie mit Pfad /maps-dev/ die neue Session aus mapplus-protected verdraengt.
        $_SESSION = [];
        setcookie(session_name(), '', [
            'expires'  => time() - 3600,
            'path'     => $appCookiePath,
            'secure'   => true,
            'httponly' => false,
            'samesite' => 'none',
        ]);
        session_destroy();
        $queryString = isset($_SERVER['QUERY_STRING']) ? $_SERVER['QUERY_STRING'] : '';
        if ($queryString !== '') {
            parse_str($queryString, $queryParams);
            unset($queryParams['target']);
            $queryString = http_build_query($queryParams);
        }
        $targetParam = 'target=' . rawurlencode('/maps-dev/index.php');
        header("Location:/mapplus-protected/?" . $targetParam . ($queryString !== '' ? ('&' . $queryString) : ''));
        exit;
    }else{
        $usernames="'".str_replace("*","%",str_replace(",","','",$_SESSION['OIDC_CLAIM_group'])."'");
        $coreConfigFile = TnetCorePaths::resolveCoreFile('config.php');
        if (!$coreConfigFile) {
            http_response_code(500);
            exit('core-dev/config.php nicht gefunden');
        }
        include_once $coreConfigFile;
        include API_PATH.API_VERSION.'/php/conf/db.conf.php';
        include API_PATH.API_VERSION.'/php/db.connect.php';

        $dbconn=connect2DB(WMCM_DB);
        $db=$dbconn['db'];
        $db->debug=0;
        $sql = "select count(*) from wmcm.users where name in(".$usernames.") and su is true;";
        $su =$db->getOne($sql);
        $validgroup=0;
        if (isset($_GET['group'])){
            if ($su == 0) {
                $sql = "select profile from wmcm.credentials where site=? and name=? and username like any (array[".$usernames."]);";
            }else{
                $sql = "select profile from wmcm.credentials where site=? and name=?;";
            }
            $profile = $db->getOne($sql,array($site,$_GET['group']));
            if ($profile){
                $validgroup=1;
            }   
        }             
      
        if ($validgroup==0){
            if ($su >= 1) {
                $sql = "select name as group, site, profile from wmcm.groups where site=?;";
            }else{
                $sql = "select name as group, site, profile from wmcm.credentials where site=? and username like any (array[".$usernames."]);";
            }
            $credentials = $db->getAll($sql,array($site)); 
            if (count($credentials)==0){
                // puoi mostrare una pagina di errore
                header('HTTP/1.1 401 Unauthorized');
                echo "<h2>Keine Gruppe gefunden</h2>";    
                echo "<p><a href='./'>Öffentliches Profil starten</a></p>";   
                echo "<p><a href='https://www.gis-daten.ch/wp-login.php?action=logout&redirect_to=https%3A%2F%2Fwww.gis-daten.ch%2F&_wpnonce=2b83e40f13'>Logout</a></p>";            
            }else if (count($credentials)==1){
                $g=$credentials[0];
                $sep='&';
                if (strpos($_SERVER['REQUEST_URI'],'?')===false)$sep='?';
                header("Location:".$_SERVER['REQUEST_URI'].$sep."group=".$g['group']);
            }else{
                // structure: site->group->profile (with only one profile per group)
                $ar_credentials = array();
                foreach($credentials as $cred_item){
                    $ar_credentials[$cred_item["site"]][$cred_item["group"]] = $cred_item["profile"];
                }
                $groups_arr = $ar_credentials[$site];
           
                $glist='';

                foreach ($groups_arr as $g => $groupad) {
                    $sep = '&';
                    if (strpos($_SERVER['REQUEST_URI'], '?') === false)
                        $sep = '?';
                    $glist .= "<li><a href='" . $_SERVER['REQUEST_URI'] . $sep . "group=" . $g . "' target='_self'>" . $g . "</a></li>";
                }

                 // TNET Priorisierte Weiterleitung: uwpro > nwpro > owpro
                $selectedGroup = $_GET['group'] ?? null;

                if ($selectedGroup && $selectedGroup !== '?' && !array_key_exists($selectedGroup, $groups_arr)) {
                    // Gruppe ist NICHT in der Liste der erlaubten Gruppen
                    echo "Die gewählte Gruppe '$selectedGroup' ist nicht gültig oder nicht erlaubt.";

                } else {
                    foreach (['uwpro', 'nwpro', 'owpro'] as $prioGroup) {
                        if (isset($groups_arr[$prioGroup])) {
                            $redirectUrl = $_SERVER['REQUEST_URI'] . $sep . "group=" . urlencode($prioGroup);
                            header("Location: $redirectUrl");
                            exit;
                        }
                    }
                }
                // TNET Priorisierte Weiterleitung: uwpro > nwpro > owpro END
                
                //print $glist;
                include('./show_groups.htm');
                exit;
            }
          
        }
        $_SESSION['su'] = $su;
        $_SESSION['app_username']=$_SESSION['OIDC_CLAIM_unique_name'];
        $_SESSION["app_group"]=$_GET['group'];
        $_SESSION["app_profile"]=$profile;
        $_SESSION["app_credentials"][$site][$_GET['group']]=$profile;
    }
    $app_group=$_SESSION["app_group"];
    $app_profile=$_SESSION["app_profile"];    
}

$set_vars='<script type="text/javascript">
    njs.AppManager.Folder = "'.$folder.'";
    njs.AppManager.Site = "'.$site.'";
    njs.AppManager.Language = "'.$lang.'";
    njs.AppManager.auth_user = "'.$_SESSION['app_username'].'";
    njs.AppManager.ugroup = "'.$app_group.'";
    njs.AppManager.uprofile = "'.$app_profile.'";
    // keep trace of authenticated user
    njs.AppManager.app_group = "'. $_SESSION["app_group"].'";
    njs.AppManager.browser = "' . $browser .'";
    njs.AppManager.appBasePath = "' . ($appBasePath ?: '') . '";
    window.__TNET_APP_ROOT = "' . ($appBasePath ?: '') . '";';

if ($ismobile) $set_vars.= "\n\tnjs.AppManager.isMobile = true;";
else $set_vars.= "\n\tnjs.AppManager.isMobile = false;";

$set_vars.="\n\t</script>\n";

// Get the title of the page from the nls
$main_title_arr = mergeJsonFiles(resolveCoreNlsFiles($lang, 'toolsResources.json'));
$main_title = ($main_title_arr["main_title_".$app_group]) ? $main_title_arr["main_title_".$app_group] : null;
if ($main_title==null) $main_title = ($main_title_arr["main_title_".$app_profile]) ? $main_title_arr["main_title_".$app_profile] : null;

if (is_file('./'.$app_profile.'/index_'.$lang.$mobile_ext.'.htm')){
    $entryFile = './'.$app_profile.'/index_'.$lang.$mobile_ext.'.htm';
} else {
    $entryFile = './'.$app_profile.'/index_'.$lang.'.htm';
}

ob_start();
if (is_file('./'.$app_profile.'/index_'.$lang.$mobile_ext.'.htm')){
    include($entryFile);
}else{
    include($entryFile);
}
$pageContent = ob_get_clean();

if ($appBasePath !== '' && $appBasePath !== '/maps') {
    $pageContent = str_replace('/maps/', $appBasePath . '/', $pageContent);
}

echo $pageContent;
?>
