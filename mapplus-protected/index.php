<?php
//echo '<pre>'; print_r($_SERVER); echo '</pre>';exit;

// here do the checks with the sso for getting group of user
ini_set("session.use_cookies", '1');

// Zielpfad aus target-Parameter ableiten (fuer spaetere Weiterleitung)
$app_path = 'maps';
if (isset($_GET['target']) && is_string($_GET['target']) && $_GET['target'] !== '') {
	$target_path_for_session = parse_url($_GET['target'], PHP_URL_PATH);
	$target_path_for_session = trim(str_replace('\\', '/', (string)$target_path_for_session), '/');
	if ($target_path_for_session !== '') {
		$target_parts_for_session = explode('/', $target_path_for_session);
		if (!empty($target_parts_for_session[0])) {
			$app_path = $target_parts_for_session[0];
		}
	}
}

// Kein session_set_cookie_params: Standard-Pfad '/' verwenden, damit oidc_callback.php
// und index.php dieselbe Session teilen und die Ziel-App die OIDC-Claims findet.
session_start();

/* header('Content-Type: text/plain');
echo date('l jS \of F Y h:i:s A');
echo "\r\n\r\n"; */

$session_fields = array('unique_name', 'samaccountname');

foreach ($_SERVER as $key => $value) {
	if (substr($key, 0, 11) == 'OIDC_CLAIM_') {      
        $key = end(explode('OIDC_CLAIM_', $key));
		if (in_array($key, $session_fields)) {
			$_SESSION['OIDC_CLAIM_' . $key] = $value;
		}
		if ($key =='group'){
			$groups_arr = $value;			
		}		
	}
}

/* echo "\r\n***************************\r\n<pre>";
print_r($_SESSION);
print_r($_SERVER); exit;  */
//to be deleted
//if ($_SESSION['OIDC_CLAIM_name']=='isn-test@nsnw.ch' || $_SESSION['OIDC_CLAIM_name']=='isn-test-2@nsnw.ch')$cleaned_groups[] = 'baustellen';

if (isset($_SESSION['OIDC_CLAIM_unique_name']) && $_SESSION['OIDC_CLAIM_unique_name'] != '') {
	//$_SESSION['OIDC_CLAIM_mapplus']=$_SERVER['OIDC_CLAIM_mapplus'];
	$_SESSION['OIDC_CLAIM_group']=$groups_arr;
	$query_string = isset($_SERVER['QUERY_STRING']) ? $_SERVER['QUERY_STRING'] : '';
	if ($query_string !== '') {
		parse_str($query_string, $query_params);
		unset($query_params['target']);
		$query_string = http_build_query($query_params);
	}
	header("Location:/" . $app_path . "/index.php" . ($query_string !== '' ? ('?' . $query_string) : ''));
} else {
	print "Login Problem";
	//print_r($_SESSION);
	//print_r($_SERVER);
}

