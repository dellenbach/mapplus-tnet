<?php

//for php older than 5.3
if (!defined('__DIR__')) define('__DIR__', dirname(__FILE__));

include(__DIR__."/../config.php");

// don't do template work here as this script is also called by "loader.php"
// store path in a variable
define ('GUI_TEMPLATE_PATH',__DIR__."/login-template.htm") ;
define ('GUI_TEXTS_PATH',__DIR__."/login_txt_" . $_SESSION["app_language"] . ".php") ;

$doc_root=str_replace($_SERVER['PHP_SELF'],'',$_SERVER['SCRIPT_FILENAME']);
$path = str_replace($doc_root,"",__DIR__);

define ('APP_SSO_URI',$path) ;
define ('APP_ACTIVITY_TIMEOUT', 300); //1200; //secs

$path=dirname(__DIR__,2);
$folder=basename($path);

$_SESSION['site_path'][$folder] = $path;
$_SESSION['app_sso_uri'] = APP_SSO_URI;

?>
