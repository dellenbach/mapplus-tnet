<?php
include_once("./common.php");

ini_set("session.use_cookies",'1');
session_start();

$ar_lyrs = array();

function buildLayerManager($lyrmgr_conf){
	global $ar_lyrs;

	// loads only one lyrmgr.conf, the group one wins on the profile one
	$ar_lyrmgr = mergeJsonFiles(array($lyrmgr_conf));
	
	$ar_lay = array();
	$ar_lay = array_reverse(glob("../core/config/layers*.conf"));
	//$ar_lay = array_merge($ar_lay, array_reverse(glob("./core/config/layers*.conf")));
	$ar_lay[] = "./core/config/layers.conf";
	$ar_lay[] = "./".$_REQUEST["p"]."/config/layers.conf";
	$ar_lay[] = "./".$_REQUEST["p"]."/config/".$_REQUEST["g"]."/layers.conf";

	$ar_lyr_conf = mergeJsonFiles($ar_lay);

	/* HERE WE LOAD ALL THE LAYERS IN TH LAYERS.CONF - this will allow the custom layers feature*/
	$ar_lyrmgr["layers"] = $ar_lyr_conf;
	
	echo json_encode($ar_lyrmgr);
	exit;
}

// gets only the layers defined in the layer manager
function getLayersItems($items, $ar_base_lyrs){
	global $ar_lyrs;

	foreach ($items as $cat => $item) {
		if (is_array($item)){
			getLayersItems($item["items"], $ar_base_lyrs);
		} else {
			if ($ar_base_lyrs[$item]) $ar_lyrs[$item] =  $ar_base_lyrs[$item];
		}
	}
}

function buildMaptipsArray($custom_conf = null){

	$ar_maptips = array();
	$ar_maptips = array_reverse(glob("../core/config/maptips*.conf"));
	//$ar_maptips = array_merge($ar_maptips, array_reverse(glob("./core/config/maptips*.conf")));
	$ar_maptips[] = "./core/config/maptips.conf";
	$ar_maptips[] = "./".$_REQUEST["p"]."/config/maptips.conf";
	if ($custom_conf != null) $ar_maptips[] = $custom_conf;

	$ar_maptip_conf = mergeJsonFiles($ar_maptips);

	echo json_encode($ar_maptip_conf);
	exit;	
}

function buildBasemapsArray($custom_conf = null){
	$custom_conf=str_replace('.conf','_mgr.conf',$custom_conf);	

	$ar_basemaps = json_decode(file_get_contents('../core/config/basemaps.conf'),true);

	if ($custom_conf != null && file_exists($custom_conf))$ar_bm_conf=json_decode(file_get_contents($custom_conf),true);
	elseif (file_exists("./".$_REQUEST["p"]."/config/basemaps_mgr.conf"))$ar_bm_conf=json_decode(file_get_contents("./".$_REQUEST["p"]."/config/basemaps_mgr.conf"),true);
	else $ar_bm_conf=json_decode(file_get_contents("./core/config/basemaps_mgr.conf"),true);
	
	
	foreach ($ar_bm_conf as $map=>$arrbm){
		$tmpbm=array();
		foreach($ar_bm_conf[$map]['basisMaps'] as $bm){
			if ($ar_basemaps[$bm])$tmpbm[$bm]=$ar_basemaps[$bm];
		}
		$ar_bm_conf[$map]["basisMaps"] = $tmpbm;
	}
	
	header('Content-Type: application/json; charset=utf-8');
	echo json_encode($ar_bm_conf);
	exit;
}

function buildPrintOptionsArray($ar_base_conf,$ar_custom_conf){

	$array_result = array();
	$ar_printvals = array();
	foreach($ar_base_conf as $item=>$conf){
		$array_result[$item]=$conf;
		if ($conf["idmap"]){
			if ($conf["scales"]) $ar_printvals[$item]["scales"] = $conf["scales"];
			if ($conf["layouts"]) $ar_printvals[$item]["layouts"] = $conf["layouts"];
			if ($conf["resolution"]) $ar_printvals[$item]["resolution"] = $conf["resolution"];
		}
	}
	foreach($ar_custom_conf as $item=>$conf){
		if ($array_result[$item]){
			foreach($conf as $prop=>$val){
				switch ($prop){
					case "scales":
					case "resolution":
						if ($array_result[$item][$prop]) {
							$array_result[$item][$prop] = array_unique(array_merge($ar_printvals[$item][$prop],$val));
							sort($array_result[$item][$prop]);
						} else $array_result[$item][$prop] = $val;
						break;
					case "layouts":
						if ($array_result[$item][$prop]) $array_result[$item][$prop] = array_merge($ar_printvals[$item][$prop],$val);
						else $array_result[$item][$prop] = $val;
						break;
					default:
						$array_result[$item][$prop] = $val;
						break;
				}
			}
		} else {
			$array_result[$item]=$conf;
		}
		
	}
	echo json_encode($array_result);
	exit;
	
}


$_f = $_REQUEST["f"];
$path_parts = pathinfo($_f);
if ($path_parts['extension'] !='htm' && $path_parts['extension'] !='conf') exit;
if ($path_parts['extension']=='htm' && $path_parts['dirname'] !='/guis') exit;
if ($path_parts['extension']=='conf' && $path_parts['dirname'] !='/config') exit;
$_REQUEST["p"] = preg_replace('/[^a-zA-Z0-9_?]/','',$_REQUEST["p"]);
$_REQUEST["g"] = preg_replace('/[^a-zA-Z0-9_?]/','',$_REQUEST["g"]);
$base_filename = $path_parts['basename'];


$ok=false;
if ($_REQUEST["p"]=="public" && $_REQUEST["g"]=="public" && is_dir("./public")){
	switch($base_filename){
		case  "lyrmgr.conf":
			buildLayerManager("./".$_REQUEST["p"].$_f); // exits after calling this function
		break;
		case  "maptips.conf":
			buildMaptipsArray(); // exits after calling this function
		break;
		case  "basemaps.conf":
			buildBasemapsArray(); // exits after calling this function
		break;
		case  "modules.conf":
		case  "modules_m.conf":
			if (file_exists("./".$_REQUEST["p"].$_f)){
				$ok=true;
			} else {
				// for retrocompatibility, returns an empty json
				echo "{}";
				exit;
			}
		break;
		default:
			$ok=true;
		break;
	}
	
} else if ($_REQUEST["g"]!="public"){
	if (!isset($_SESSION['OIDC_CLAIM_group'])){
		include "../core/sso/sso.php";
		include API_PATH.API_VERSION."/php/sso/auth.php";
	}
	
	if (isset($_REQUEST["g"]) && $_REQUEST["g"]!=""){
		// add the group name between the "config" folder and the file name
		$group_filename=$path_parts['dirname']."/".$_REQUEST["g"]."/".$base_filename;
		
		switch($base_filename){
			case "editing.conf":
			case "searchoptions.conf":			
			case "printoptions.conf":
			case "snap.conf":
				
				
				if ($_SESSION["isMobile"]===true && $base_filename=="editing.conf"){
					$group_filename = str_replace("editing.conf","editing_m.conf",$group_filename);
					if (strpos($group_filename,$_REQUEST["p"])!==FALSE){
						$group_filename = str_replace($_REQUEST["p"]."/","",$group_filename);
					}
					$group_filename = str_replace("editing.conf","editing_m.conf",$group_filename);
					
				}
				if (file_exists("./".$_REQUEST["p"].$group_filename)) {
					echo file_get_contents("./".$_REQUEST["p"].$group_filename);
					exit;
				} else {
					$ok=true;
				}
			break;
			// case "editing.conf":
			// case "searchoptions.conf":
			// 	$array_result = mergeJsonFiles(array(
			// 		"./".$_REQUEST["p"].$_f,
			// 		"./".$_REQUEST["p"].$group_filename
			// 	));
			// 	echo json_encode($array_result);
			// 	exit;
			// break;
				
			case  "maptips.conf":
				buildMaptipsArray("./".$_REQUEST["p"].$group_filename); // exits after calling this function
			break;

			case  "lyrmgr.conf":
				// for the layer manager only one conf will be loaded, then it must exist
				if (file_exists("./".$_REQUEST["p"].$group_filename)) buildLayerManager("./".$_REQUEST["p"].$group_filename); 
				else buildLayerManager("./".$_REQUEST["p"].$_f);
				// exits after calling this functions
			break;
			case  "basemaps.conf":
				buildBasemapsArray("./".$_REQUEST["p"].$group_filename); // exits after calling this function
			break;
			/*  case "basemaps.conf":
			 case "printoptions.conf":
			 	if (file_exists("./".$_REQUEST["p"].$group_filename)) {
			 		$ar_custom_conf = json_decode(file_get_contents("./".$_REQUEST["p"].$group_filename),true);
			 		if (file_exists("./".$_REQUEST["p"].$_f)) {
			 			$ar_base_conf = json_decode(file_get_contents("./".$_REQUEST["p"].$_f),true);

			 			if ($base_filename == "basemaps.conf") {
			 				buildBasemapsArray($ar_base_conf,$ar_custom_conf); // exits after calling this function
			 			} else if ($base_filename == "printoptions.conf") {
			 				buildPrintOptionsArray($ar_base_conf,$ar_custom_conf); // exits after calling this function
			 			} 

			 		} else {
			 			echo json_encode($ar_custom_conf);
			 			exit;
			 		}
				} else {
					$ok=true;
			 	}
			break; */

			case  "modules.conf":
			case  "modules_m.conf":
			case  "tools.conf":
				$_fconf = "";
				// for the modules only one conf will be loaded, the group one wins over the profil one
				// for retrocompatibility, if none exists returns an empty json
				if (file_exists("./".$_REQUEST["p"].$group_filename)) $_fconf = "./".$_REQUEST["p"].$group_filename;
				else if (file_exists("./".$_REQUEST["p"].$_f)) $_fconf = "./".$_REQUEST["p"].$_f;

				if ($_fconf!="") echo file_get_contents($_fconf);
				else echo "{}";

				exit;
			break;
			case  "gui_coordinates_".$_SESSION["app_language"].".htm":
				$_fconf = "";
				// for the modules only one conf will be loaded, the group one wins over the profil one
				// for retrocompatibility, if none exists returns an empty json
				if (file_exists("./".$_REQUEST["p"].$group_filename)) $_fconf = "./".$_REQUEST["p"].$group_filename;
				else if (file_exists("./".$_REQUEST["p"].$_f)) $_fconf = "./".$_REQUEST["p"].$_f;

				if ($_fconf!="") echo file_get_contents($_fconf);
				else echo "{}";

				exit;
			break;

			default:
				$ok=true;
			break;
		}
	} else {
		die("error: no group name provided");
	}
}

if ($_SESSION["isMobile"]===true){
	switch ($_f){
		case '/config/tools.conf':
			$_f='/config/tools_m.conf';
		break;
		case '/guis/gui_wmsimport_dialog_'.$_SESSION["app_language"].'.htm':
			$_f='/guis/gui_wmsimport_dialog_'.$_SESSION["app_language"].'_m.htm';
		break;
		case '/guis/gui_speclays_'.$_SESSION["app_language"].'.htm':
			$_f='/guis/gui_speclays_'.$_SESSION["app_language"].'_m.htm';
		break;	
	} 
}

if ($ok) include "./".$_REQUEST["p"].$_f;

?>
