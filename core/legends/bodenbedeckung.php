<html>

<head>
<meta http-equiv="Content-Language" content="de-ch">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<title>Bodenbedeckung</title>
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

<h1>Bodenbedeckung</h1>

<p>Quellen- / Grundlagenvermerk: © Amtliche Vermessung (Kantone)</p>


<h2>Legende</h2>
<span id='legend_toggle'></span>
<p>
<?php 
print file_get_contents("http://localhost/cgi-bin/mapserv?map=/data/Client_Data/nwow/av.map&LAYERS=bodenbedeckung".$url_params); 
?>
</p>
</body>

</html>
