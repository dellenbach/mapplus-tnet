<?php

ini_set("session.use_cookies", '1');
session_start();

if ($_GET['lang']){
    $lang=$_GET['lang'];
}else{
    include_once("../detect_lang.inc.php");
    $lang=detect_lang($accept_lang,$default_lang);
}
$_SESSION["app_language"]=$lang;

include(__DIR__."/../config.php");

define ('GUI_TEMPLATE_PATH',__DIR__."/login-template.htm") ;
define ('GUI_TEXTS_PATH',__DIR__."/login_txt_" . $lang . ".php") ;

$doc_root=str_replace($_SERVER['PHP_SELF'],'',$_SERVER['SCRIPT_FILENAME']);
$path = str_replace($doc_root,"",__DIR__);
define ('APP_SSO_URI',$path);

include(API_PATH.API_VERSION."/php/sso/login.php");
?>
