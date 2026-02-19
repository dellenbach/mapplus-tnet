<?php

ini_set("session.use_cookies",'1');
session_start();

//to buffer the adodb debug output
ob_start();

include('../sso/sso.php');
include(API_PATH.API_VERSION."/php/sso/".'auth.php');

//clean the adodb debug output
ob_end_clean();

include_once __DIR__.'/../config.php';

define ('APP_FOLDER',basename(dirname(__DIR__,2))) ;
include API_PATH.API_VERSION."/wmcm/index.php";

?>
