/*
     Require all the items defined in the index_lang.htm as the parser will need them
     and also the elements which will be nedded further while building the gui elements
     in the startup (will be handled in a synchrone workflow as already loaded).
 */
require([
    "dojo/ready",
    "dojo/parser",
    "dojo/dom-construct",
    "dojo/dom-attr",
    "dojo/dom-geometry",
    "dijit/layout/BorderContainer",
    "dijit/layout/AccordionContainer",
    "dijit/layout/ContentPane",
    "dijit/TitlePane",
    "dijit/layout/TabContainer",
    "dojox/layout/TableContainer",
    "dijit/Dialog",
    "dijit/form/Select",
    "dijit/form/Button",
    "dijit/form/TextBox",
    "dijit/form/CheckBox",
    "dijit/Tooltip",
    "dojo/data/ItemFileReadStore",
    "dojox/grid/DataGrid",
    "dojox/grid/EnhancedGrid",
    "dojox/grid/enhanced/plugins/Pagination",
    "dojox/grid/enhanced/plugins/Filter",
    "dijit/form/FilteringSelect",
    "dijit/form/Textarea",
    "dijit/form/ValidationTextBox",
    "dojox/layout/FloatingPane",
    "dijit/form/Button",
    "dijit/form/RadioButton",
    "njs/form/GroupToggleButton",
    "njs/data/ComboBoxReadSolrStore",
    "dojo/topic",
    "dojo/fx",
    "dojox/mobile/deviceTheme"
], function (ready, parser, domConstruct, domAttr) {
    ready(function () {


        //build the page
        parser.parse();
        // Add an element in the accordion title for the layer manager
        // section in order to display a "waitng" message when loading
        // the layers
        // Such an object can be placed anywhere in the page if containing
        // the id "infolay_wait"
        var node = document.createElement('div');
        dojo.attr(node, "role", "presentation");
        dojo.attr(node, "id", "infolay_wait");
        dojo.attr(node, "class", "infolay_wait");
        dojo.attr(node, "style", "display:none;z-index: 99999;");

        var subnode = document.createElement('div');
        dojo.attr(subnode, "class", "cube");

        var subnode1 = document.createElement('div');
        dojo.attr(subnode1, "class", "face front");
        var subnode2 = document.createElement('div');
        dojo.attr(subnode2, "class", "face back");
        var subnode3 = document.createElement('div');
        dojo.attr(subnode3, "class", "face left");
        var subnode4 = document.createElement('div');
        dojo.attr(subnode4, "class", "face right");
        var subnode5 = document.createElement('div');
        dojo.attr(subnode5, "class", "face top");
        var subnode6 = document.createElement('div');
        dojo.attr(subnode6, "class", "face bottom");

        dojo.place(subnode1, subnode, "last");
        dojo.place(subnode2, subnode, "last");
        dojo.place(subnode3, subnode, "last");
        dojo.place(subnode4, subnode, "last");
        dojo.place(subnode5, subnode, "last");
        dojo.place(subnode6, subnode, "last");

        dojo.place(subnode, node, "last");
        dojo.place(node, dojo.body(), "first");

        njs.AppManager.start3D = function(idmap) {
            var center = njs.AppManager.Maps[idmap].mapObj.getView().getCenter();  
            if (njs.AppManager.Maps[idmap].mapObj.getView().getProjection().getCode()!="EPSG:2056"){            
                var center = njs.AppManager.Maps[idmap].mapObj.getView().getCenter(); 
                center=ol.proj.transform(center,njs.AppManager.Maps[idmap].mapObj.getView().getProjection().getCode(),"EPSG:2056");
            }
            
            var alti_obj=njs.AppManager.Tools.ElevationDisplay.map.alti1;
            var _url = alti_obj.cgi.url;
            _url += (_url.indexOf('?')>-1) ? "&" : "?";
            _url+= ("&dbconn_id="+alti_obj.cgi.dbconn_id+"&table="+alti_obj.cgi.table+"&x="+center[0]+"&y="+center[1]+"&srs="+alti_obj.elevationProj.replace("EPSG:",""));
            var alti =400;
            dojo.xhrGet( {
                url: _url,
                preventCache: true,
                handleAs: "json",
                sync:false,
                load: function(response){                   
                    if (response) {                                 
                        alti = parseFloat(response);	
                        var resol=njs.AppManager.Maps[idmap].mapObj.getView().getResolution(); 
                        var h=3000* resol;                       
                        if (resol<0.4) h=5000* resol;
                        if (resol<0.2) h=8000* resol;
                        if (h>20000)h=20000;
                        if (h<(alti+200))h=alti+200; 
                        
                        center = njs.AppManager.Maps[idmap].mapObj.getView().getCenter(); 
                  
                        if (njs.AppManager.Maps[idmap].mapObj.getProjection!="EPSG:4326"){            
                            center=ol.proj.transform(center,njs.AppManager.Maps[idmap].mapObj.getView().getProjection().getCode(),"EPSG:4326");
                        }
                    
                        var url="https://3d.mapplus.ch/?site=public&basemap=Luftbild&bm_show=1&layers=SWISSTOPO_Buildings,SWISSTOPO_trees&camx="+center[0]+"&camy="+ center[1]+'&camz='+h+'&heading=6.283&pitch=-1.571';
                        //console.log(url);
                        window.open(url,"_blank");                        
                    }
                },
                error: function(error) {
                    console.error('elevation service error',error);
                }
            });
        };


        njs.AppManager.initApp();

        njs.AppManager.legend_css= ['../core/legends/css/geoadmin_legends.css'];

    });

});
function changemappluslang(langparam) {
    window.location = window.location.href.replace("lang=" + njs.AppManager.Language, "lang=" + langparam)
}