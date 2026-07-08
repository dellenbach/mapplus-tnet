<?php
include_once("./common.php");

$maxlifetime = 0;
$path = '/';
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
// ===== AUTH USER FUER SICHERES JS-EMBED =====
$auth_user_js = json_encode((string)($_SESSION['app_username'] ?? ''), JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP);
$default_lang = "de";
$accept_lang = array("de");	
//$accept_lang = array("de","it","en","fr");	

if ($_GET['lang'] && in_array($_GET['lang'],$accept_lang)){
    $lang=$_GET['lang'];
}else{
    include_once("../core/detect_lang.inc.php");
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
 


if ($_REQUEST['r'] == 1)
{
    include_once "simplified_url.php";
}

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
    // Ohne OIDC-Claim zuerst zum Login/SSO-Gateway
    if (!isset($_SESSION['OIDC_CLAIM_group']) || $_SESSION['OIDC_CLAIM_group'] === '') {
        // Alten PHPSESSID-Cookie loeschen, damit nach OIDC-Login kein konkurrierender
        // Cookie die neue Session aus mapplus-protected verdraengt.
        $_SESSION = [];
        setcookie(session_name(), '', [
            'expires'  => time() - 3600,
            'path'     => '/',
            'secure'   => true,
            'httponly' => false,
            'samesite' => 'none',
        ]);
        session_destroy();
        $qs = isset($_SERVER['QUERY_STRING']) ? $_SERVER['QUERY_STRING'] : '';
        if ($qs !== '') {
            parse_str($qs, $qsParams);
            unset($qsParams['target']);
            $qs = http_build_query($qsParams);
        }
        $targetParam = 'target=' . rawurlencode('/maps/index.php');
        header('Location:/mapplus-protected/?' . $targetParam . ($qs !== '' ? ('&' . $qs) : ''));
        exit;
    }

    // get the application's site name (folder)
    $_items_array = explode(DIRECTORY_SEPARATOR, dirname($_SERVER["SCRIPT_FILENAME"]));
    $_SESSION["app_site"] = $_items_array[(count($_items_array) - 1)];

    // Inline DB-Autorisierung (wie maps/index.php) — kein zweiter Login via sso.php/auth.php
    $usernames = "'" . str_replace("*", "%", str_replace(",", "','", $_SESSION['OIDC_CLAIM_group']) . "'");
    include_once('../core/config.php');
    include API_PATH . API_VERSION . '/php/conf/db.conf.php';
    include API_PATH . API_VERSION . '/php/db.connect.php';

    $dbconn = connect2DB(WMCM_DB);
    $db = $dbconn['db'];
    $db->debug = 0;
    $sql = "select count(*) from wmcm.users where name in(" . $usernames . ") and su is true;";
    $su = $db->getOne($sql);
    $validgroup = 0;
    if (isset($_GET['group'])) {
        if ($su == 0) {
            $sql = "select profile from wmcm.credentials where site=? and name=? and username like any (array[" . $usernames . "]);";
        } else {
            $sql = "select profile from wmcm.credentials where site=? and name=?;";
        }
        $profile = $db->getOne($sql, array($site, $_GET['group']));
        if ($profile) {
            $validgroup = 1;
        }
    }

    if ($validgroup == 0) {
        if ($su >= 1) {
            $sql = "select name as group, site, profile from wmcm.groups where site=?;";
        } else {
            $sql = "select name as group, site, profile from wmcm.credentials where site=? and username like any (array[" . $usernames . "]);";
        }
        $credentials = $db->getAll($sql, array($site));
        if (count($credentials) == 0) {
            header('HTTP/1.1 401 Unauthorized');
            echo "<h2>Keine Gruppe gefunden</h2>";
            echo "<p><a href='./'>Öffentliches Profil starten</a></p>";
        } else if (count($credentials) == 1) {
            $g = $credentials[0];
            $sep = '&';
            if (strpos($_SERVER['REQUEST_URI'], '?') === false) $sep = '?';
            header("Location:" . $_SERVER['REQUEST_URI'] . $sep . "group=" . $g['group']);
        } else {
            $ar_credentials = array();
            foreach ($credentials as $cred_item) {
                $ar_credentials[$cred_item["site"]][$cred_item["group"]] = $cred_item["profile"];
            }
            $groups_arr = $ar_credentials[$site];
            $glist = '';
            foreach ($groups_arr as $g => $groupad) {
                $sep = '&';
                if (strpos($_SERVER['REQUEST_URI'], '?') === false) $sep = '?';
                $glist .= "<li><a href='" . $_SERVER['REQUEST_URI'] . $sep . "group=" . $g . "' target='_self'>" . $g . "</a></li>";
            }
            include('./show_groups.htm');
            exit;
        }
    }
    $_SESSION['su'] = $su;
    $_SESSION['app_username'] = $_SESSION['OIDC_CLAIM_unique_name'];
    $_SESSION["app_group"] = $_GET['group'];
    $_SESSION["app_profile"] = $profile;
    $_SESSION["app_credentials"][$site][$_GET['group']] = $profile;

    $app_group = $_SESSION["app_group"];
    $app_profile = $_SESSION["app_profile"];

}

$set_vars='<script type="text/javascript">
    njs.AppManager.Folder = "'.$folder.'";
    njs.AppManager.Site = "'.$site.'";
    njs.AppManager.Language = "'.$lang.'";
    // ORIGINAL (auskommentiert): njs.AppManager.auth_user = "'.$_SESSION['app_username'].'";
    njs.AppManager.auth_user = '.$auth_user_js.';
    njs.AppManager.ugroup = "'.$app_group.'";
    njs.AppManager.uprofile = "'.$app_profile.'";
    // keep trace of authenticated user
    njs.AppManager.app_group = "'. $_SESSION["app_group"].'";
    njs.AppManager.browser = "' . $browser .'";';

if ($ismobile) $set_vars.= "\n\tnjs.AppManager.isMobile = true;";
else $set_vars.= "\n\tnjs.AppManager.isMobile = false;";

$set_vars.= "\n" . <<<'JS'
	// ===== AUTH UI PATCH =====
	// Schaltet den sichtbaren Login-Eintrag in der Toolbar bei vorhandener
	// OIDC-Session auf Logout um und zeigt den Benutzernamen unter dem Icon.
	(function () {
		var LOGIN_LABELS = ['Login', 'Anmelden'];
		var LOGOUT_LABEL = 'Logout';
		var LOGOUT_TITLE = 'Abmelden';
		var USER_CLASS   = 'tnet-auth-user';

		function getAuthUser() {
			return (window.njs && njs.AppManager && njs.AppManager.auth_user)
				? njs.AppManager.auth_user
				: '';
		}

		function buildLogoutUrl() {
			var wreply = window.location.origin + '/maps/';
			return 'https://idp.gis-daten.ch/adfs/ls/?wa=wsignout1.0&wreply='
				+ encodeURIComponent(wreply);
		}

		function findLoginNode() {
			// 1) Klassischer Anchor auf den alten SSO-Login
			var node = document.querySelector("a[href*='/core/sso/login.php']");
			if (node) return node;

			// 2) Toolbar-Container mit title="Login"/"Anmelden"
			node = document.querySelector("[title='Login'],[title='Anmelden']");
			if (node) return node;

			// 3) Sichtbares Label-Element mit Text "Login"/"Anmelden"
			var candidates = document.querySelectorAll('span,div,button,a');
			for (var i = 0; i < candidates.length; i++) {
				var el = candidates[i];
				if (el.children.length !== 0) continue;
				var txt = (el.textContent || '').trim();
				if (LOGIN_LABELS.indexOf(txt) !== -1) return el;
			}
			return null;
		}

		function relabelTextNodes(root) {
			var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
			var node;
			while ((node = walker.nextNode())) {
				var trimmed = (node.nodeValue || '').trim();
				if (LOGIN_LABELS.indexOf(trimmed) !== -1) {
					node.nodeValue = node.nodeValue.replace(/Login|Anmelden/, LOGOUT_LABEL);
				}
			}
		}

		function renderUserUnderLogout(targetNode, authUser) {
			var parent = targetNode && targetNode.parentNode;
			if (!parent) return;
			var existing = parent.querySelector('.' + USER_CLASS);
			if (existing) {
				existing.textContent = authUser;
				return;
			}
			var line = document.createElement('div');
			line.className = USER_CLASS;
			line.textContent = authUser;
			line.style.cssText = 'display:block;font-size:11px;line-height:1.2;'
				+ 'color:#4B7B81;margin-top:2px;text-align:center;';
			parent.insertBefore(line, targetNode.nextSibling);
		}

		function applyEditAuthUi() {
			var authUser = getAuthUser();
			if (!authUser) return;

			var targetNode = findLoginNode();
			if (!targetNode) return;

			var logoutUrl = buildLogoutUrl();
			targetNode.setAttribute('title', LOGOUT_TITLE);
			targetNode.style.cursor = 'pointer';
			relabelTextNodes(targetNode);

			if (targetNode.tagName && targetNode.tagName.toLowerCase() === 'a') {
				targetNode.href = logoutUrl;
			}
			targetNode.onclick = function (e) {
				if (e && e.preventDefault) e.preventDefault();
				window.location.href = logoutUrl;
				return false;
			};

			renderUserUnderLogout(targetNode, authUser);
		}

		// Mehrfach versuchen, weil Dojo-Toolbar verzoegert gerendert wird.
		[400, 1200, 2600].forEach(function (delay) {
			setTimeout(applyEditAuthUi, delay);
		});
	})();
JS;


$set_vars.="\n\t</script>\n";

// Get the title of the page from the nls
$main_title_arr = mergeJsonFiles(array("./core/nls/$lang/toolsResources.json"));
$main_title = ($main_title_arr["main_title_".$app_group]) ? $main_title_arr["main_title_".$app_group] : null;
if ($main_title==null) $main_title = ($main_title_arr["main_title_".$app_profile]) ? $main_title_arr["main_title_".$app_profile] : null;

if (is_file('./'.$app_profile.'/index_'.$lang.$mobile_ext.'.htm')){
    include('./'.$app_profile.'/index_'.$lang.$mobile_ext.'.htm');
}else{
    include('./'.$app_profile.'/index_'.$lang.'.htm');
}
?>
