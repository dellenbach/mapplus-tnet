<html>

<head>
<meta http-equiv="Content-Language" content="de-ch">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<title>Kulturobjekte Nidwalden</title>
<link rel="stylesheet" type="text/css" href="css/mapplus.css">
<script type="text/javascript">
    var startDepLegend=true;
    document.write('\x3Cscript type="text/javascript" src="/mapplus-lib/mapplus-dojo/'+parent.njs.AppManager.Version+'/provider/OLPlus/cnt_dep_legends.js">\x3C/script>');
</script>
</head>

<?php
if ($_GET['map_dep']=='true'){
    $url_params="&BBOX=".$_GET['BBOX']."&CRS=".$_GET['CRS'];
}else{
    $url_params="";
}
?>

<body onload="init()">

<h1>Kulturobjekte Nidwalden</h1>

<p>Quellen- / Grundlagenvermerk: Kulturobjekte Nidwalden © Kanton Nidwalden</p>
<span id='legend_toggle'></span>
<h2>Legende</h2>
<p>
<?php
$image = 'https://nwow.mapplus.ch/qgis?MAP=/data/Client_Data/nwow/kulturobjekte_nw_pg.qgs&LAYERS=Kulturobjekte%20Flaeche&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetLegendGraphic&FORMAT=image/png'.$url_params;
$imageData = base64_encode(file_get_contents($image));
$src = 'data: '.mime_content_type($image).';base64,'.$imageData;
echo '<img src="' . $src . '">';
?>
</p>
</body>
</html>
