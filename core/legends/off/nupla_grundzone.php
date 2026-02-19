<html>

<head>
<meta http-equiv="Content-Language" content="de-ch">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<title>Kommunale Nutzungsplanung: Grundzone</title>
<link rel="stylesheet" type="text/css" href="css/mapplus.css">

<script type="text/javascript">
    var startDepLegend=true;
    document.write('\x3Cscript type="text/javascript" src="/mapplus-lib/mapplus-dojo/'+parent.njs.AppManager.Version+'/provider/OLPlus/cnt_dep_legends.js">\x3C/script>');
</script>

</head>

<?php
if ($_GET['map_dep']=='true'){
    $url_params="&mode=maplegend&MAPEXT=".urlencode($_GET['MAPEXT'])."&BBOX=".$_GET['BBOX']."&SRS=".$_GET['SRS'];
}else{
    $url_params="&mode=legend";
}
?>

<body onload="init()">

<h1>Kommunale Nutzungsplanung: Grundzone</h1>

<p>Quellen- / Grundlagenvermerk: Kommunale Nutzungsplanung © Berner Gemeinden</p>
<p><a target="_blank" href="https://www.geo.apps.be.ch/de/geodaten/suche-nach-geodaten.html?view=sheet&catalog=geocatalog&type=complete&preview=search_list&guid=2738dec3-bf24-6764-8dbe-cf1d0a0d0d2a">
Weitere Informationen / Metadaten / Datendownload</a></p>

<h2>Legende</h2>
<span id='legend_toggle'></span>
<p>
<?php print file_get_contents("https://be.mapplus.ch/cgi-bin/mapserv?map=/data/Client_Data/bern/geobasis_kanton.map&LAYERS=nupla_grundzone".$url_params);?>
<?php print file_get_contents("https://be.mapplus.ch/cgi-bin/mapserv?map=/data/Client_Data/bern/geobasis_kanton.map&LAYERS=nupla_grundzone_legend&mode=legend");?>

</body>

</html>
