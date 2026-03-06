/* Copyright (c) 2010-2011 Tydac, Inc. */
/* global njs */
/* jslint node: true */
"use strict";

/* -------------------------------------------------------------------------------------
  njs.AppManager.infoFloatWin Class is extended in the corresponding provider's file
  ------------------------------------------------------------------------------------- */
// Info window object
njs.AppManager.infoFloatWin = null;
njs.AppManager.infoFloatWinWidth = null;
njs.AppManager.infoFloatWinHeight = null;
njs.AppManager.infoFloatWinX = null;
njs.AppManager.infoFloatWinY = null;
njs.AppManager.infoFloatFeatures = [];
njs.AppManager.infoFloatSelected = null;
njs.AppManager.infoFloatMapTipLoading = [];
njs.AppManager.infoFloatMapTipIsEditing = null;
njs.AppManager.infoGeoJsonListener = null;
njs.AppManager.infoWMSListener = null;
njs.AppManager.infoPopupContainer = null;
njs.AppManager.infoPopupContent = null;
njs.AppManager.infoPopupCloser = null;
njs.AppManager.infoOverlay = null;;
njs.AppManager.centered = null;
njs.AppManager.infoItemHistory = {};
njs.AppManager.infoRequestsPending = 0;
njs.AppManager.wmsActiveLyrs = new ol.Collection();

/* if (typeof njs.config.maptips.general_settings.customPane == "undefined" || njs.config.maptips.general_settings.customPane == null) {
    if (njs.AppManager.isMobile && dojo.byId("custompaneDiv")) njs.AppManager.customPane = { "id": "custompaneDiv", "pane": "custompane" };
    else njs.AppManager.customPane = false;
} else {
    njs.AppManager.customPane = njs.config.maptips.general_settings.customPane;
} */

if (typeof njs.config.maptips.general_settings.customPane == "undefined" || njs.config.maptips.general_settings.customPane == null || njs.AppManager.isMobile) {
    njs.AppManager.customPane = false;
} else {
    njs.AppManager.customPane = njs.config.maptips.general_settings.customPane;
}

/* -------------------------------------------------------------------------------------
  Method InitInfoFloatingWindow of AppManager
  Called from the maptips classes in order to create the floating info window
  ------------------------------------------------------------------------------------- */
njs.AppManager.InitInfoFloatingWindow = function (bHide, idmap) {
    // check if the info pane content exists, if not create it
    /*if (dojo.byId('njs_info_pane_content')==null || dojo.byId('njs_info_pane_content')==undefined){
        // add the node which will host the floating pane
        var node = document.createElement('div');
        dojo.attr(node, "id", "njs_info_pane_content");
        dojo.attr(node, "style", "display:none;");
        dojo.place(node, dojo.body(), "first");
    }*/

    // get the config values for the window
    if (njs.AppManager.infoFloatWinWidth == null) njs.AppManager.infoFloatWinWidth = njs.config.maptips.general_settings.start_w;
    if (njs.AppManager.infoFloatWinHeight == null) njs.AppManager.infoFloatWinHeight = njs.config.maptips.general_settings.start_h;
    if (njs.AppManager.infoFloatWinX == null) njs.AppManager.infoFloatWinX = njs.config.maptips.general_settings.start_x;
    if (njs.AppManager.infoFloatWinY == null) njs.AppManager.infoFloatWinY = njs.config.maptips.general_settings.start_y;

    njs.AppManager.infoFloatMapTipIsEditing = null;

    // check if the info pane already exists, if not create it
    if (dojo.byId('njs_info_pane') == null || dojo.byId('njs_info_pane') === undefined) {
        // add the node which will host the floating pane
        var node = document.createElement('div');
        dojo.attr(node, "id", "njs_info_pane");
        dojo.place(node, dojo.body(), "first");
        // create the floating pane object and set it to the AppManager
        // modify the core styles for the info window purpose (classes dojox...Info)
        //njs.AppManager.infoFloatWin = new njs.layout.CustomFloatingPane({
        njs.AppManager.infoFloatWin = new dojox.layout.FloatingPane({
            title: "",
            dockable: false,
            maxable: false,
            closable: true,
            resizable: false,
            style: "position:absolute;top:" + njs.AppManager.infoFloatWinY + "px;left:" + njs.AppManager.infoFloatWinX + "px;width:" + njs.AppManager.infoFloatWinWidth + "px;height:" + njs.AppManager.infoFloatWinHeight + "px;visibility:visible;",
            "class": "dojoxFloatingPaneInfo",
            contentClass: "dojoxFloatingPaneContentInfo"
        }, node);
        njs.AppManager.infoFloatWin.canvas.className = "dojoxFloatingPaneCanvasInfo";

        // startup the window
        njs.AppManager.infoFloatWin.startup();

        // hide it if asked
        if (bHide) njs.AppManager.infoFloatWin.hide();
        if (njs.AppManager.customPane === false) {
            njs.AppManager.infoFloatWin.setContent("<div id='njs_info_pane_content'></div>");
            njs.AppManager.infoFloatWin.resize({
                w: njs.AppManager.infoFloatWinWidth,
                h: njs.AppManager.infoFloatWinHeight
            });
            dojo.byId("njs_info_pane").style.left = njs.AppManager.infoFloatWinX + "px";
            dojo.byId("njs_info_pane").style.top = njs.AppManager.infoFloatWinY + "px";
            njs.AppManager.infoFloatMapTipCloseHandler = dojo.connect(njs.AppManager.infoFloatWin, "close", njs.AppManager.infoFloatWin, "onClose");
            njs.AppManager.infoFloatMapTipOnCloseHandle = dojo.connect(njs.AppManager.infoFloatWin, "onClose", function () {
                var win_el = dojo.byId("njs_info_pane");
                //njs.AppManager.infoFloatWinWidth=parseInt(win_el.style.width);
                //njs.AppManager.infoFloatWinHeight=parseInt(win_el.style.height);
                njs.AppManager.infoFloatWinX = parseInt(win_el.style.left);
                njs.AppManager.infoFloatWinY = parseInt(win_el.style.top);

                var _graphicInfoLyr = njs.AppManager.getLayerByName(idmap, "cosmetic_maptip");
                if (_graphicInfoLyr != null) _graphicInfoLyr.getSource().clear();
                njs.AppManager.infoFloatFeatures = [];

                njs.AppManager.infoRequestsPending = 0;
                njs.AppManager.infoItemHistory = {};

                for (var _maptip in njs.AppManager.MapTips) {
                    if (njs.AppManager.MapTips[_maptip].last_sel_item !== undefined) {
                        njs.AppManager.MapTips[_maptip].last_sel_item = [];
                    }
                }

            });
        }

    } else {
        // handle the carousel widget if any
        require(["dojo/_base/connect"], function (connect) {
            for (var _maptip in njs.AppManager.MapTips) {
                for (var i in njs.AppManager.MapTips[_maptip].carousel_widget) {
                    if (njs.AppManager.MapTips[_maptip].carousel_widget[i]) njs.AppManager.MapTips[_maptip].carousel_widget[i].destroyRecursive(false);
                }
                njs.AppManager.MapTips[_maptip].carousel_widget = {};
            }
        });
        // if custompane then this will remain open, then destroy exitsting content
        if (njs.AppManager.customPane !== false) {
            if (dojo.byId('njs_info_pane_content')) {
                var widgets = dijit.findWidgets(dojo.byId('njs_info_pane_content'));
                dojo.forEach(widgets, function (w) {
                    w.destroyRecursive(false);
                });
            }
        }
    }
};

njs.AppManager.infoFloatWinReset = function () {

    dojo.disconnect(njs.AppManager.infoFloatMapTipCloseHandler);
    dojo.disconnect(njs.AppManager.infoFloatMapTipOnCloseHandle);

    if (typeof njs.AppManager.infoFloatWin != "undefined" && njs.AppManager.infoFloatWin != null) njs.AppManager.infoFloatWin.destroy();
    njs.AppManager.infoFloatWin = null;
    njs.AppManager.infoFloatWinWidth = null;
    njs.AppManager.infoFloatWinHeight = null;
    njs.AppManager.infoFloatWinX = null;
    njs.AppManager.infoFloatWinY = null;
    njs.AppManager.infoFloatFeatures = null;
    njs.AppManager.infoFloatFeatures = [];
    njs.AppManager.infoFloatSelected = null;
    njs.AppManager.infoFloatNoSymbol = new esri.symbol.SimpleMarkerSymbol(esri.symbol.SimpleMarkerSymbol.STYLE_CIRCLE, 3, new esri.symbol.SimpleLineSymbol(esri.symbol.SimpleLineSymbol.STYLE_SOLID, new dojo.Color([255, 0, 0, 0]), 1), new dojo.Color([255, 0, 0, 0]));
    njs.AppManager.infoFloatMapTipLoading = null;
    njs.AppManager.infoFloatMapTipLoading = [];
    njs.AppManager.infoFloatMapTipCloseHandler = null;
    njs.AppManager.infoFloatMapTipOnCloseHandler = null;
};

njs.AppManager.infoFloatWinCloseGraph = function (idx, idmap) {
    var _graphicInfoLyr = njs.AppManager.getLayerByName(idmap, "cosmetic_maptip");
    if (idx) {
        if (typeof _graphicInfoLyr != 'undefined' && _graphicInfoLyr != null) {
            _graphicInfoLyr.removeFeatures([njs.AppManager.infoFloatFeatures[idx].geom]);
        }

        njs.AppManager.infoFloatFeatures[idx].geom = null;
        var node = dojo.byId("njs_info_pane_content_" + idx);
        node.parentNode.removeChild(node);
    } else {
        if (typeof _graphicInfoLyr != 'undefined' && _graphicInfoLyr != null) _graphicInfoLyr.getSource().clear();
    }
};

njs.AppManager.infoFloatWinRemoveallItems = function (idmap) {

    var node = dojo.byId('njs_info_pane_content');
    if (node) {
        // first destroy the widgets linked to the node elements
        var widgets = dijit.findWidgets(node);
        dojo.forEach(widgets, function (w) {
            w.destroyRecursive(false);
        });

        var nodes = node.children;
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].id.indexOf('njs_info_pane_content_') > -1) {
                nodes[i].parentNode.removeChild(nodes[i]);
            }
        }
    }

    if (idmap) {
        var _graphicInfoLyr = njs.AppManager.getLayerByName(idmap, "cosmetic_maptip");
        if (typeof _graphicInfoLyr != 'undefined' && _graphicInfoLyr != null) _graphicInfoLyr.getSource().clear();
        njs.AppManager.infoFloatFeatures = [];

        for (var _maptip in njs.AppManager.MapTips) {
            if (njs.AppManager.MapTips[_maptip].last_sel_item !== undefined) {
                njs.AppManager.MapTips[_maptip].last_sel_item = [];
            }
        }
    }
    //node.parentNode.removeChild(node);
};

njs.AppManager.infoFloatWinReplaceHighlite = function (idx, multi, idmap) {
    var _graphicInfoLyr = njs.AppManager.getLayerByName(idmap, "cosmetic_maptip");
    if (typeof _graphicInfoLyr != 'undefined' && _graphicInfoLyr != null && _graphicInfoLyr.isVisible()) {
        if (_graphicInfoLyr != null) {
            _graphicInfoLyr.getSource().clear();
            if (idx == -1) {
                for (var _ft in njs.AppManager.infoFloatFeatures) {
                    if (njs.AppManager.infoFloatFeatures[_ft] != null) {
                        idx = _ft;
                        break;
                    }
                }
            }
            if (njs.AppManager.infoFloatFeatures[idx] && njs.AppManager.infoFloatFeatures[idx].geom != null) {
                for (var i = 0; i < njs.AppManager.infoFloatFeatures[idx].geom.length; i++) {
                    let _tmp_style = njs.AppManager.infoFloatFeatures[idx].geom[i].getStyle();
                    let _tmp_geom = njs.AppManager.infoFloatFeatures[idx].geom[i].clone();
                    _tmp_geom.setStyle(_tmp_style);
                    _graphicInfoLyr.getSource().addFeature(_tmp_geom);
                }
            }
        }
    }
};

njs.AppManager.infoFloatWinHighlite = function (idx, type, multi, idmap) {
    if (njs.AppManager.infoFloatFeatures[idx] != null) {
        var _graphicInfoLyr = njs.AppManager.getLayerByName(idmap, "cosmetic_maptip");
        if (njs.AppManager.infoFloatFeatures[idx].geom != null && typeof _graphicInfoLyr != 'undefined' && _graphicInfoLyr != null) {
            // loop through the array of the feature collection
            for (var i = 0; i < njs.AppManager.infoFloatFeatures[idx].geom.length; i++) {
                if (type == "normal") {
                    if (multi || idx == njs.AppManager.infoFloatSelected) {
                    } else {
                        _graphicInfoLyr.getSource().removeFeature(njs.AppManager.infoFloatFeatures[idx].geom[i]);
                    }
                } else {
                    // first remove the feature as for some events it is called twice and cannot add the same feature twice
                    _graphicInfoLyr.getSource().removeFeature(njs.AppManager.infoFloatFeatures[idx].geom[i]);
                    _graphicInfoLyr.getSource().addFeature(njs.AppManager.infoFloatFeatures[idx].geom[i]);
                }
            }
        }
    }
};

njs.AppManager.infoFloatWinUpdateHighlite = function (idx, idmap, style, action) {
    if (njs.AppManager.infoFloatFeatures[idx] != null) {
        if (njs.AppManager.infoFloatFeatures[idx].geom != null) {
            var _graphicInfoLyr = njs.AppManager.getLayerByName(idmap, "cosmetic_maptip");
            if (typeof _graphicInfoLyr != 'undefined' && _graphicInfoLyr != null) {
                _graphicInfoLyr.getSource().clear();

                if (action != "remove") {
                    let _tmp_geom = njs.AppManager.infoFloatFeatures[idx].geom[0].clone();
                    _tmp_geom.setStyle(style);
                    _graphicInfoLyr.getSource().addFeature(_tmp_geom);
                }
            }
        }
    }
};

njs.AppManager.prepareInfoRequest = function (evt, idmap) {
    njs.AppManager.centered = false;
    njs.AppManager.infoXYCoords = evt.coordinate;
    if (!njs.AppManager.MapTips["_disablewmsgetfeatureinfo"][idmap]) {

        njs.AppManager.infoItemHistory = {};
        if (njs.AppManager.infoFloatWin) {

            var _cont = dojo.byId("njs_info_pane_content");
            if (_cont) {
                var widgets = dijit.findWidgets(_cont);
                dojo.forEach(widgets, dojo.hitch(this, function (w) {
                    if (njs.AppManager.infoItemHistory[w.id_maptip] != null && typeof njs.AppManager.infoItemHistory[w.id_maptip] != "undefined") {
                        if (!njs.AppManager.infoItemHistory[w.id_maptip]) {
                            njs.AppManager.infoItemHistory[w.id_maptip] = w.open;
                        }
                    } else njs.AppManager.infoItemHistory[w.id_maptip] = w.open;
                }));
            }
        }

        if (njs.AppManager.infoFloatMapTipIsEditing) {
            if (njs.AppManager.infoFloatFeatures[njs.AppManager.infoFloatMapTipIsEditing.ft_cnt]) {
                var _former_edit_obj = njs.AppManager.infoFloatFeatures[njs.AppManager.infoFloatMapTipIsEditing.ft_cnt].editing_id;
                if (_former_edit_obj) {
                    if (njs.AppManager.EditingTools[_former_edit_obj]._modifycontrol) {
                        if (njs.AppManager.EditingTools[_former_edit_obj]._modifycontrol.feature) {
                            njs.AppManager.EditingTools[_former_edit_obj]._modifycontrol.unselectFeature(njs.AppManager.EditingTools[_former_edit_obj]._modifycontrol.feature);
                        }

                        njs.AppManager.EditingTools[_former_edit_obj]._modifycontrol.deactivate();
                        njs.AppManager.EditingTools[_former_edit_obj]._modifycontrol.destroy();
                    }
                    njs.AppManager.EditingTools[_former_edit_obj].stopEditing(true);
                    njs.AppManager.infoFloatMapTipIsEditing = null;
                }
            }
        }


        var _tit = njs.AppManager.nls.maptipsResources["general_title"];

        if (njs.AppManager.customPane == false) {
            njs.AppManager.InitInfoFloatingWindow(false, idmap);

            // should use pane.set('content',content) but doesn't work
            njs.AppManager.infoFloatWin.setTitle("<table border='0' cellpadding='0 cellspacing='0'><tr><td>" + _tit + "</td><td><div id='infowin_wait' class='loading_infowin' style='display:none'></div></td></tr></table>");
            njs.AppManager.infoFloatWin.set("content", "<div id='njs_info_pane_content'></div>");
            njs.AppManager.infoFloatWin.show();
            njs.AppManager.infoFloatWin.bringToTop();
            if (dojo.byId("infowin_wait")) dojo.byId("infowin_wait").style.display = 'block';
            // must reset the specified size because the content can change it
            njs.AppManager.infoFloatWin.resize({
                w: njs.AppManager.infoFloatWinWidth,
                h: njs.AppManager.infoFloatWinHeight
            });
        } else {

            // destroy all the carsousel widgets
            for (var _maptip in njs.AppManager.MapTips) {
                if (njs.AppManager.MapTips[_maptip].carousel_widget) {
                    for (var i in njs.AppManager.MapTips[_maptip].carousel_widget) {
                        if (njs.AppManager.MapTips[_maptip].carousel_widget[i]) njs.AppManager.MapTips[_maptip].carousel_widget[i].destroyRecursive(false);
                    }
                    njs.AppManager.MapTips[_maptip].carousel_widget = {};
                }
            }
            // check if upload dialog exists and is open. then close it
            if (njs.AppManager.EditingToolsImportDialog) {
                if (njs.AppManager.EditingTools[njs.AppManager.EditingToolsImportDialog.item_name]) {
                    njs.AppManager.EditingTools[njs.AppManager.EditingToolsImportDialog.item_name].hideUploadDialog();
                }
            }

            // maptips are show inside the right contentPane
            if (dojo.byId('njs_info_pane_content') == null) {
                var node = document.createElement('div');
                dojo.attr(node, "id", "njs_info_pane_content");
                //dojo.attr(node, "class", "infoWindowMsg");

                var paneTitle = "<div id ='flexyPaneTips' style='display:flex'><div id='infowin_wait' class='loading_infowin' style='display:none'></div><div class='infoPaneClose' href='javascript:void(null)' onclick='njs.AppManager.toggleCustomPaneContent(njs.AppManager.customPane.id,njs.AppManager.customPane.pane,\"\",\"\",false);njs.AppManager.infoFloatWinRemoveallItems(\"" + idmap + "\");'></div></div>";
                dojo.place(node, dojo.byId(njs.AppManager.customPane.id), "last");
                dojo.place(paneTitle, dojo.byId('njs_info_pane_content'), "first");
                if (dojo.byId("infowin_wait")) dojo.byId("infowin_wait").style.display = 'block';

            } else {

                var node = dojo.byId('njs_info_pane_content');
                // first destroy the widgets linked to the node elements
                var widgets = dijit.findWidgets(node);
                dojo.forEach(widgets, function (w) {
                    w.destroyRecursive(false);
                });
                // must remove the dom elements manually (all, also the header element !)
                while (node.hasChildNodes()) {
                    node.removeChild(node.lastChild);
                }
                // reinsert the header element
                var paneTitle = "<div id ='flexyPaneTips' style='display:flex'><div id='infowin_wait' class='loading_infowin' style='display:none'></div><div class='infoPaneClose' href='javascript:void(null)' onclick='njs.AppManager.toggleCustomPaneContent(njs.AppManager.customPane.id,njs.AppManager.customPane.pane,\"\",\"\",false);njs.AppManager.infoFloatWinRemoveallItems(\"" + idmap + "\");'></div></div>";
                dojo.place(paneTitle, dojo.byId('njs_info_pane_content'), "first");

                if (dojo.byId("infowin_wait")) dojo.byId("infowin_wait").style.display = 'block';

                if (njs.AppManager.customPane == true) {
                    if (njs.Layout.saveCustomPaneWidget[njs.AppManager.customPane.pane].status == 'visible') {
                        njs.AppManager.centered = true;
                    }
                }

            }
        }

        var _graphicInfoLyr = njs.AppManager.getLayerByName(idmap, "cosmetic_maptip");
        if (_graphicInfoLyr != null) _graphicInfoLyr.getSource().clear();
        njs.AppManager.infoFloatFeatures = [];

        if (njs.config.maptips.general_settings.proxy) {
            njs.AppManager.infoProxyHost = njs.config.maptips.general_settings.proxy;
        }
    }
};

njs.AppManager.terminateInfoRequest = function (idmap, length_divs) {
    if (dojo.byId("njs_info_pane_content").children.length == length_divs) {
        var node = document.createElement('div');

        node.innerHTML = njs.AppManager.nls.maptipsResources["general_noresults"];
        dojo.attr(node, "id", "njs_info_pane_content_disc");
        dojo.attr(node, "class", "infoWindowMsg");
        dojo.place(node, dojo.byId("njs_info_pane_content"), "last");
        if (dojo.byId("infowin_wait")) dojo.byId("infowin_wait").style.display = 'none';

    } else if (dojo.byId("njs_info_pane_content").children.length - length_divs == 1) {
        var node = dojo.byId('njs_info_pane_content');
        var widgets = dijit.findWidgets(node);
        dojo.forEach(widgets, function (w) {
            w.set("open", true);
        });
    }

    // don't show the waiting banner any more
    if (dojo.byId("infowin_wait")) dojo.byId("infowin_wait").style.display = 'none';
    // highlight the first element returned if so configured
    if (njs.config.maptips.general_settings.permanent_highlight) {
        if (njs.config.maptips.general_settings.permanent_highlight === true) njs.AppManager.infoFloatWinReplaceHighlite(-1, false, idmap);
    }
};

njs.AppManager.infoGeoJsonHandler = function (evt) {
    njs.AppManager.infoOverlay.setPosition(undefined);
    njs.AppManager.infoPopupCloser.blur();

    if (njs.AppManager.Maps[this.idmap].mapObj.hasFeatureAtPixel(evt.pixel) === true) {
        njs.AppManager.Maps[this.idmap].mapObj.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
            if (layer == null || typeof (layer.get("name")) == 'undefined') return;
            var coordinate = evt.coordinate;
            let _lname = layer.get("name");
            for (var mt in njs.AppManager.MapTips) {
                if (njs.AppManager.MapTips[mt].linked_layer_id == _lname) {
                    njs.AppManager.MapTips[mt].showInfoBubble(feature);
                    njs.AppManager.infoOverlay.setPosition(coordinate);
                    break;
                }
            }

        });
    }
};

njs.AppManager.infoWMSHandler = function (evt) {
    if (njs.AppManager.wmsActiveLyrs.getLength() == 0) return true;
    let that = this;
    //if (!njs.AppManager.MapTips["_disablewmsgetfeatureinfo"][this.idmap] && njs.AppManager.Maps[that.idmap].mapObj.hasFeatureAtPixel(evt.pixel) == false) {
    if (!njs.AppManager.MapTips["_disablewmsgetfeatureinfo"][this.idmap]) {
        var _exit = false;
        if (njs.AppManager.Maps[that.idmap].mapObj.hasFeatureAtPixel(evt.pixel) === true) {
            njs.AppManager.Maps[that.idmap].mapObj.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
                if (layer == null || typeof (layer.get("name")) == 'undefined' || (layer.get('name') != 'cosmetic_maptip' && layer.get('name') != 'cosmetic_search')) {
                    _exit = true;
                    return;
                }
            });
        }
        if (_exit === true) return true;

        njs.AppManager.prepareInfoRequest(evt, this.idmap);

        njs.AppManager.wmsActiveLyrs.getArray().forEach((lyr) => {
            lyr.queryconnector(evt);
        });
    }
};

/*-------------------------------------------------------------------------------
    Workaround for creating custom events in IE
    We create a documentElement property which will be changed when the
    custom event must be fired
--------------------------------------------------------------------------------*/
if (document.attachEvent) { // MSIE
    document.documentElement.queryMapTipEvent = 0; // an expando property
}

/*-------------------------------------------------------------------------------
    MapTips Class

    Base object for the different maps tips. These are infrmations retrived
    either from a map service or from a database containing point or shape data.
    The tips are displayed in info windows either onclick events and/or on mouse
    over/out events

    [object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.MapTip = function (maptip_id, options) {
    // [string] : id of the MapTip
    var id;

    // [objec] graphicInfoLyr : esri graphic layer hosting the info features
    var graphicInfoLyr = null;
    // [bolean] mouseEvents : if the mous events are enabled
    var mouseEvents = false;

    // [int] maxScaleDisplay: max scale where the info query must happen
    var maxScaleDisplay = null;

    // [string] : njs Map Object's id
    this.idmap = null;
    this.wms_layer = null;
    this.linked_layer_id = null;
    this.linked_editing_id = null;
    this.url = null;
    this.minResolution = null;
    this.maxResolution = null;
    this.linked_basemap = null;
    this.query_layers = null;
    this.query_layers_alias = null;
    this.qryFields = null;
    this.qryFieldsFormat = null;
    this.qryFieldsNullVal = null;
    this.querytype = null;
    this.queryurl = null;
    this.tolerance = null;
    this.qryFieldsTab = null;
    this.fieldValues = null;
    this.htmlTemplate = null;
    this.qrySpecials = null;
    this.texts = null;
    this.active = false;
    this.nls = null;
    this.showEmptyFields = false;
    this.new_info_width = 0;
    this.filter_by_attributes = null;

    this.fldLookup = {};

    this.connector_type = null;

    this.highlightProj = null;
    this.highLightstyle = null;

    //edit control
    this._modifycontrol = null;
    this.selectedFeature = null;

    //this.carousel_widget_evt={};
    this.carousel_widget = {};

    //Events
    this.eventFeatureAdded = null;
    this.id = maptip_id;
    if (options && typeof options != 'undefined') {
        // call the initialisation's function
        // if any options are passed
        this.Init(options);
    }
};

/*-------------------------------------------------------------------------------
    method Init

    Initialisation's work

    [object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.MapTip.prototype.Init = function (options) {
    this.qrySpecialsFields = null;
    this.qrySpecialsFields = options.qrySpecialsFields ? options.qrySpecialsFields : null;
    this.htmlTemplate = options.html ? options.html : null;
    this.key_attr = options.key_attr ? options.key_attr : null;
    this.fieldValues = options.fieldValues ? options.fieldValues : null;
    this.linked_layer_id = options.linked_layer_id ? options.linked_layer_id : null;
    this.nls = options.nls ? options.nls : null;
    this.showEmptyFields = options.show_empty_fields ? options.show_empty_fields : false;
    this.qryFieldsFormat = options.qryFieldsFormat ? options.qryFieldsFormat : null;
    this.qryFieldsNullVal = options.qryFieldsNullVal ? options.qryFieldsNullVal : null;
    this.qryFieldsTab = options.qryFieldsTab ? options.qryFieldsTab : null;
    this.external_form = options.external_form ? options.external_form : null;
    this.pdf_report = options.pdf_report ? options.pdf_report : null;


    this.imageGalleryFields = options.imageGalleryFields ? options.imageGalleryFields : null;
    this.documentsDownloadFields = options.documentsDownloadFields ? options.documentsDownloadFields : null;
    this.querytype = options.querytype || "getfeatureinfo";
    this.queryurl = options.queryurl || false;
    this.tolerance = options.tolerance || 2;
    /*  if (this.imageGalleryFields && this.imageGalleryFields.image) {
         if (!this.imageGalleryFields.image.author_admin) this.imageGalleryFields.image.author_admin = "Mapplus";
     } */
    this.fldLookup = options.fldLookup ? options.fldLookup : {};
    this.nocache_lookup = (options.nocache_lookup != null && typeof options.nocache_lookup != "undefined") ? options.nocache_lookup : false;

    this.filter_by_attributes = (typeof options.filter_by_attributes != "undefined" && options.filter_by_attributes != null) ? options.filter_by_attributes : null;
    this.carousel_widget = {};

    if (njs.AppManager.MapTips["_disablewmsgetfeatureinfo"] == null || typeof njs.AppManager.MapTips["_disablewmsgetfeatureinfo"] == 'undefined') {
        njs.AppManager.MapTips["_disablewmsgetfeatureinfo"] = {};
    }
    if (njs.AppManager.MapTips["_disablewmsgetfeatureinfo"][this.idmap] != null || typeof njs.AppManager.MapTips["_disablewmsgetfeatureinfo"][this.idmap] == 'undefined') njs.AppManager.MapTips["_disablewmsgetfeatureinfo"][this.idmap] = false;

    this.highlightProj = options.highlight_geom_proj ? options.highlight_geom_proj : null;
    this.highLightstyle = options.highlight_style ? options.highlight_style : null;
};

njs.MapTip.prototype.zoomEndCallback = function (evt) {
    var that = this;

    require(["dojo/_base/lang", "dojo/_base/array"], function (lang, array) {
        var _bLayFlag = true;
        var _lyr = null;
        if (that.linked_layer_id) {
            _lyr = njs.AppManager.getLayerByMap(that.idmap, that.linked_layer_id);
            if (_lyr != null) {
                _bLayFlag = _lyr.visible;
                _lyr = _lyr._lyr;
            } else {
                _bLayFlag = false;
                _lyr = null;
            }
        }
        if (that.wms_layer != null) _lyr = that.wms_layer;

        var _blay = njs.AppManager.Maps[that.idmap].mapObj.getLayers().getArray()[0];
        if (that.linked_basemap) {
            // if not multilayer basemap then find directly the layer object in the basisMaps property
            var _blayname = _blay.get("name");
            if (njs.AppManager.Maps[that.idmap].basisMaps[_blayname]) {
                // check if basis map name match with the linked basemap name
                if (dojo.indexOf(that.linked_basemap, _blayname) == -1) {
                    _bLayFlag = false;
                }
            } else {
                // if not in the basisMap then it is a multilayer basemap. Loop through all the multilayer basemap and find out which has this name
                var _basismap_lyr = "";
                for (var _base_map in njs.AppManager.Maps[that.idmap].basisMaps) {
                    if (lang.isArray(njs.AppManager.Maps[that.idmap].basisMaps[_base_map])) {
                        for (var i in njs.AppManager.Maps[that.idmap].basisMaps[_base_map]) {
                            if (njs.AppManager.Maps[that.idmap].basisMaps[_base_map][i].name == _blayname) {
                                _basismap_lyr = _base_map;
                                break;
                            }
                        }
                    }
                    if (_basismap_lyr !== "") break;
                }
                // check if basis map name match with the linked basemap name
                if (dojo.indexOf(that.linked_basemap, _basismap_lyr) == -1) {
                    _bLayFlag = false;
                }
            }
        }


        if (_bLayFlag) {
            that._setActiveIfVisible(njs.AppManager.Maps[that.idmap].mapObj.getView().getResolution(), _lyr);
        } else if (_lyr) {
            if (that.active) {
                njs.AppManager.wmsActiveLyrs.remove(that);
            }
            that.active = false;
        }
        // Handling the ZoomEnd behaviour
        if (evt != null) {
            that.attachZoomEndListner(njs.AppManager.Maps[that.idmap].mapObj, false, function (e) {
                njs.AppManager.Maps[that.idmap].mapObj.once('moveend', function (e) {
                    that.zoomEndCallback(e);
                });
            });
        }
    });


};

njs.MapTip.prototype.attachZoomEndListner = function (map, startup, callback) {
    var that = this;
    function bindToView(view) {
        view.once('change:resolution', callback);
    }
    // Bind to the current view
    bindToView(map.getView());

    // If the view change, then bind to the new one
    if (startup == true) {
        map.on('change:view', function () {
            bindToView(map.getView());
            that.zoomEndCallback(null);
        });
    }
};

njs.MapTip.prototype.addLayerCallback = function (evt) {
    var that = this;
    require(["dojo/_base/lang", "dojo/_base/array"], function (lang, array) {
        var _lyr = evt.element;
        if (that.wms_layer != null) _lyr = that.wms_layer;

        // preload lookups as assync calls are performed (syncs are depreciated by some browsers)
        // in order to be ready when clicked in the map
        for (var _idx in that.fldLookup) {
            if (that.fldLookup[_idx].items == null) {
                that._loadLookUp(_idx);
            } else if (that.fldLookup[_idx].filterlang === true) {
                that.fldLookup[_idx].items = that.fldLookup[_idx].items[njs.AppManager.Language];
                that.fldLookup[_idx].filterlang = false;
            }
        }

        var _bLayFlag = true;
        if (that.linked_basemap) {
            var _blay = njs.AppManager.Maps[that.idmap].mapObj.getLayers().getArray()[0];
            var _blayname = _blay.get("name");
            // if not multilayer basemap then find directly the layer object in the basisMaps property
            if (njs.AppManager.Maps[that.idmap].basisMaps[_blayname]) {
                // check if basis map name match with the linked basemap name
                if (dojo.indexOf(that.linked_basemap, _blayname) == -1) {
                    _bLayFlag = false;
                }
            } else {
                // if not in the basisMap then it is a multilayer basemap. Loop through all the multilayer basemap and find out which has this name
                var _basismap_lyr = "";
                for (var _base_map in njs.AppManager.Maps[that.idmap].basisMaps) {
                    if (lang.isArray(njs.AppManager.Maps[that.idmap].basisMaps[_base_map])) {
                        for (var i in njs.AppManager.Maps[that.idmap].basisMaps[_base_map]) {
                            if (njs.AppManager.Maps[that.idmap].basisMaps[_base_map][i].name == _blayname) {
                                _basismap_lyr = _base_map;
                                break;
                            }
                        }
                    }
                    if (_basismap_lyr !== "") break;
                }
                // check if basis map name match with the linked basemap name
                if (dojo.indexOf(that.linked_basemap, _basismap_lyr) == -1) {
                    _bLayFlag = false;
                }

            }
        } else if (that.linked_layer_id) {
            if (that.minResolution == null && that.maxResolution == null) {
                var _layer = njs.AppManager.getLayerByMap(that.idmap, that.linked_layer_id);
                if (typeof _layer.minResolution != 'undefined' && _layer.minResolution != null && _layer.minResolution > 0) that.minResolution = _layer.minResolution;
                if (typeof _layer.maxResolution != 'undefined' && _layer.maxResolution != null && _layer.maxResolution > 0) that.maxResolution = _layer.maxResolution;
                if (that.minResolution != null || that.maxResolution != null) {
                    // Handling the ZoomEnd behaviour
                    that.attachZoomEndListner(njs.AppManager.Maps[that.idmap].mapObj, true, function (e) {
                        njs.AppManager.Maps[that.idmap].mapObj.once('moveend', function (e) {
                            that.zoomEndCallback(e);
                        });
                    });

                }
            }
        }

        // manage in class getfeatureinfo manager:
        // https://openlayers.org/en/latest/examples/getfeatureinfo-tile.html
        // https://gis.stackexchange.com/questions/227519/how-to-get-getfeatureinfourl-from-multiple-layers-in-openlayers-3
        if (_bLayFlag) {
            if (that.minResolution || that.maxResolution) {
                var _resol = njs.AppManager.Maps[that.idmap].mapObj.getView().getResolution()
                that._setActiveIfVisible(_resol, _lyr);
            } else {
                njs.AppManager.wmsActiveLyrs.push(that);
                that.active = true;
            }
        } else {
            if (that.active) {
                njs.AppManager.wmsActiveLyrs.remove(that);
            }

            that.active = false;
        }
    });
};
njs.MapTip.prototype._featuremodified = function (evt) {
};

njs.MapTip.prototype._featureselected = function (evt) {
};

njs.MapTip.prototype._featureunselected = function (evt) {
};

njs.MapTip.prototype._beforefeaturemodified = function (evt) {
};

njs.MapTip.prototype.removeLayerCallback = function (evt) {

    var that = this;
    var _lyr = evt.element;
    if (this.wms_layer != null) _lyr = this.wms_layer;

    njs.AppManager.wmsActiveLyrs.remove(that);
    this.active = false;

    return false;
};

njs.MapTip.prototype._setActiveIfVisible = function (resol) {
    var that = this;

    if (this.minResolution != null && this.maxResolution != null) {
        if (resol >= this.minResolution && resol <= this.maxResolution) {
            if (!this.active) {
                njs.AppManager.wmsActiveLyrs.push(that);
            }
            this.active = true;
        } else {
            if (this.active) {
                njs.AppManager.wmsActiveLyrs.remove(that);
            }
            this.active = false;
        }
    } else if (this.minResolution != null) {
        if (resol >= this.minResolution) {
            if (!this.active) {
                njs.AppManager.wmsActiveLyrs.push(that);
            }
            this.active = true;
        } else {
            if (this.active) {
                njs.AppManager.wmsActiveLyrs.remove(that);
            }
            this.active = false;
        }
    } else {
        if (resol <= this.maxResolution) {
            if (!this.active) {
                njs.AppManager.wmsActiveLyrs.push(that);
            }
            this.active = true;
        } else {
            if (this.active) {
                njs.AppManager.wmsActiveLyrs.remove(that);
            }
            this.active = false;
        }
    }
};

njs.MapTip.prototype.queryconnector = function (evt) {
};


njs.MapTip.prototype.getLengthDivs = function () {
    var _length_divs = 0;
    if (njs.AppManager.customPane) _length_divs++;
    return _length_divs;
}


njs.MapTip.prototype.showInfo = function (features) {
    var _length_divs = this.getLengthDivs();
    if (njs.AppManager.infoFloatWinWidth) {
        if (this.form_info) var content = this.getFormFeaturesInfos(features, _length_divs);
        else var content = this.getFeatureInfos(features, _length_divs);
    }
    if (njs.AppManager.infoRequestsPending == 0) {
        njs.AppManager.terminateInfoRequest(this.idmap, _length_divs);
    }
};

njs.MapTip.prototype.showInfoExternal = function (features, container, form_info) {
    if (njs.AppManager.infoRequestsPending == 0) {
        // don't show the waiting banner any more
        if (dojo.byId("infowin_wait")) dojo.byId("infowin_wait").style.display = 'none';

        if (dojo.byId("njs_info_pane_content").children.length == 0 && !form_info) {
            njs.AppManager.infoFloatWin.hide();
        }
    }

    var ft_cnt = 0;
    if (njs.AppManager.infoFloatFeatures) ft_cnt = njs.AppManager.infoFloatFeatures.length;

    var array_fid = [];
    for (var ft in features) {
        ft_cnt++;
        // geometry
        var _geom;
        var theGeom;
        var attr = features[ft].getProperties();

        _geom = features[ft];
        theGeom = []
        theGeom[0] = _geom;
        var geom_proj;
        _geom = attr['GEOM_WKT'] ? attr['GEOM_WKT'] : attr['geom_wkt'];
        var _custom_highlight = true;
        if (_geom != null && typeof _geom != "undefined") {
            theGeom = new ol.format.WKT().readFeatures(_geom);
            // the highlightProj contains the projection of the object stored in the db
            if (this.highlightProj != null) geom_proj = this.highlightProj;
        } else {
            _geom = attr['GEOM_JSON'] ? attr['GEOM_JSON'] : attr['geom_json'];
            if (typeof _geom != "undefined" && _geom != null) {
                // consider the response as a feature collection (as default in the read method)
                const format = new ol.format.GeoJSON(); 
                const obj = typeof _geom === 'string' ? JSON.parse(_geom) : _geom;                

                if (obj.type === 'FeatureCollection' || obj.type === 'Feature') {
                    theGeom = format.readFeatures(obj);
                } 
                else if (obj.type === 'GeometryCollection') {
                    theGeom = obj.geometries.map(g =>
                        new ol.Feature({
                            geometry: format.readGeometry(g)
                        })
                    );
                }
                else {
                    theGeom = [
                        new ol.Feature({
                            geometry: format.readGeometry(obj)
                        })
                    ];
                }      
            } else if (typeof features[ft].getGeometry() != "undefined" && features[ft].getGeometry() != null) {
                // Must act as a geojson feature collection in order to support multiobject highlight
                theGeom = [];
                _geom = features[ft];
                theGeom[0] = _geom;
                _custom_highlight = false;
                // The getFeatureInfo returns the feature object with the correct projection (basemap)
                // and therefor doesn't need to be reprojected
            }
            // the highlightProj contains the projection of the object stored in the db
            if (this.highlightProj != null) geom_proj = this.highlightProj;
        }

        njs.AppManager.infoFloatFeatures[ft_cnt] = {};
        njs.AppManager.infoFloatFeatures[ft_cnt].attr = attr;
        njs.AppManager.infoFloatFeatures[ft_cnt].maptip_id = this.id;
        njs.AppManager.infoFloatFeatures[ft_cnt].editing_id = null;
        // keep the feature real geometry  in property realgeom for use in editing if any
        // (as the geom_wkt or geom_json can differ from original geometry)
        if (features[ft].getGeometry() != null && typeof features[ft].getGeometry() != "undefined") {
            njs.AppManager.infoFloatFeatures[ft_cnt].realgeom = [];
            njs.AppManager.infoFloatFeatures[ft_cnt].realgeom[0] = features[ft];
        }
        if (this.linked_editing_id && njs.AppManager.EditingTools[this.linked_editing_id]) njs.AppManager.infoFloatFeatures[ft_cnt].editing_id = this.linked_editing_id;

        //fcb v4 TBC
        array_fid.push(features[ft].data[this.key_attr]);

        if (typeof _geom != "undefined" && _geom != null && _geom !== "" && this.highLightstyle != null) {
            var _graphicInfoLyr = njs.AppManager.getLayerByName(this.idmap, "cosmetic_maptip");
            if (_graphicInfoLyr == null) {
                _graphicInfoLyr = new ol.layer.Vector();
                _graphicInfoLyr.setSource(
                    new ol.source.Vector("cosmetic_maptip", {
                        features: []
                    })
                );
                _graphicInfoLyr.set('name', 'cosmetic_maptip');
                njs.AppManager.Maps[this.idmap].mapObj.addLayer(_graphicInfoLyr);
            }

            njs.AppManager.infoFloatFeatures[ft_cnt].geom = [];
            njs.AppManager.infoFloatFeatures[ft_cnt].custom_highlight = _custom_highlight;
            // loop through the collection objects
            for (var ftt in theGeom) {
                var theNewGeom = theGeom[ftt].clone().geometry;
                if (geom_proj) theNewGeom.transform(geom_proj, njs.AppManager.Maps[this.idmap].mapObj.getView().getProjection().getCode());

                njs.AppManager.Maps[this.idmap].mapObj()
                var _style = njs.AppManager.Maps[this.idmap].getNewOLStyle(this.highLightstyle, theNewGeom.getType());

                // pass the geometry along with the attributes as feature properties

                var _newfeature = new ol.Feature(attr);
                _newfeature.setStyle(_style);

                njs.AppManager.infoFloatFeatures[ft_cnt].geom[ftt] = _newfeature;
                //if (_graphicInfoLyr!=null) _graphicInfoLyr.addFeatures(njs.AppManager.infoFloatFeatures[ft_cnt].geom[ftt]);
            }

            njs.AppManager.infoFloatWinReplaceHighlite(-1, false, this.idmap);

        }
    }


    var that = this;
    var args = {};


    args["FID"] = array_fid[0];

    args["dbconn_id"] = this.dbconn_id;
    args["key"] = this.key_attr;
    args["table"] = this.table;
    args["layer"] = this.linked_layer_id;
    args["lang"] = njs.AppManager.Language;
    args["action"] = "update";

    var request = OpenLayers.Request.POST({
        url: this.external_form_url,
        data: new URLSearchParams(args).toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        callback: function (resp) {
            // check of external container for the form
            if (form_info) {
                var item_title = "";
                var _txt_id = that.id;
                if (that.nls) _txt_id = that.nls;
                if (njs.AppManager.nls.maptipsResources) {
                    // For the title, if a custom entry is still defined in the "nls" file then that will override the general one
                    // (if the parameter "nls" is defined for that maptip.
                    if (njs.AppManager.nls.maptipsResources[that.id + "_title"]) item_title = njs.AppManager.nls.maptipsResources[that.id + "_title"];
                    else if (njs.AppManager.nls.maptipsResources[_txt_id + "_title"]) item_title = njs.AppManager.nls.maptipsResources[_txt_id + "_title"];
                }
                that.currentPageForm = array_fid[0];
                that.arrPagesForm = array_fid;

                //var _ctnt = "<div align='left' style='margin:3px;><b>" + item_title + "</b></div>";
                var _ctnt = "<br><div align='right' style='margin:3px;><a href='javascript:void(null);' onclick='njs.AppManager.MapTips[\"" + that.id + "\"].pagerForm(\"-\");'>&lt;</a>&nbsp;&nbsp;";
                _ctnt += "1 / " + that.arrPagesForm.length;
                _ctnt += "&nbsp;&nbsp;<a href='javascript:void(null);' onclick='njs.AppManager.MapTips[\"" + that.id + "\"].pagerForm(\"+\");'>&gt;</a></div>";
                _ctnt += "<div id='" + that.id + "_formpager'>" + resp.responseText + "</div>";

                njs.AppManager.infoFloatWin.set('content', _ctnt);
                njs.AppManager.infoFloatWin.resize({ w: njs.AppManager.infoFloatWinWidth, h: njs.AppManager.infoFloatWinHeight });
                if (dojo.byId("infowin_wait")) dojo.byId("infowin_wait").style.display = 'none';
                njs.AppManager.infoFloatWin.show();
            } else if (container) {
                var pane = dijit.byId(container);
                pane.setContent(resp.responseText);
                var _container = pane.getParent();
                // switch to the form pane but with some litle delay in order to see the selected object for a litle while
                setTimeout(dojo.hitch(null, function (_pane) {
                    _container.selectChild(_pane)
                }, pane), 500);

            }
        }
    });
};

njs.MapTip.prototype.pagerForm = function (action) {

    if (dojo.byId("infowin_wait")) dojo.byId("infowin_wait").style.display = 'block';

    // change form
    var idx = this.arrPagesForm.indexOf(this.currentPageForm);

    if (idx > -1 && this.arrPagesForm.length > 1) {
        switch (action) {
            case "+":
                if (idx == this.arrPagesForm.length - 1) idx = 0;
                else idx++;
                break;
            case "-":
                if (idx == 0) idx = this.arrPagesForm.length - 1;
                else idx--;
                break;
        }
    }
    this.currentPageForm = this.arrPagesForm[idx];

    var that = this;
    var args = {};

    args["FID"] = this.currentPageForm;

    args["dbconn_id"] = this.dbconn_id;
    args["key"] = this.key_attr;
    args["table"] = this.table;
    args["layer"] = this.linked_layer_id;
    args["lang"] = njs.AppManager.Language;
    args["action"] = "update";

    var request = OpenLayers.Request.POST({
        url: this.external_form_url,
        data: new URLSearchParams(args).toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        callback: function (resp) {
            var _ctnt = "<div align='right' style='margin:3px;'><a href='javascript:void(null);' onclick='njs.AppManager.MapTips[\"" + that.id + "\"].pagerForm(\"-\");'>&lt;</a>&nbsp;&nbsp;";
            _ctnt += (idx + 1) + " / " + that.arrPagesForm.length;;
            _ctnt += "&nbsp;&nbsp;<a href='javascript:void(null);' onclick='njs.AppManager.MapTips[\"" + that.id + "\"].pagerForm(\"+\");'>&gt;</a></div>";
            _ctnt += "<div id='" + that.id + "_formpager'>" + resp.responseText + "</div>";
            njs.AppManager.infoFloatWin.set('content', _ctnt);
            njs.AppManager.infoFloatWin.resize({ w: njs.AppManager.infoFloatWinWidth, h: njs.AppManager.infoFloatWinHeight });
            if (dojo.byId("infowin_wait")) dojo.byId("infowin_wait").style.display = 'none';
        }
    });
};

/*-------------------------------------------------------------------------------
    method showAllInfo

    Shows all fields of listed features	even those that have empty value.

    [object] features: GeoJSON features collection
--------------------------------------------------------------------------------*/
njs.MapTip.prototype.showAllInfo = function (features) {
    var _length_divs = this.getLengthDivs();
    if (njs.AppManager.infoFloatWinWidth) {
        var content = this.getFeatureAllInfos(features, _length_divs);
    }
    if (njs.AppManager.infoRequestsPending == 0) {
        njs.AppManager.terminateInfoRequest(this.idmap, _length_divs);
    }
};
/*-------------------------------------------------------------------------------
    method getFeatureInfos

    Gets the feature from ajax request and formatted id as defined in the config.
    [object] resp: ajax response

--------------------------------------------------------------------------------*/
njs.MapTip.prototype.getFeatureInfos = function (features, length_divs) {
    var ft_cnt = 0;
    var attr = null;
    var content = [];
    var item_title = "";
    var attrib_title = "";
    var ar_item_title = null;
    var tp = null;
    var _tmp_feat = null;

    this.new_info_width = 0;
    for (var _feat in features) {
        //set symbol
        //	feature.setSymbol(this.highlightSymbol);
        //	if (!this.multiselect) feature.setSymbol(njs.AppManager.infoFloatNoSymbol);

        // add the highlight feature
        //	this.graphicInfoLyr.add(feature);
        // add the feature to the info features array (which will increment until the window will be closed: reset)
        ft_cnt = njs.AppManager.infoFloatFeatures.length;
        //	this.last_sel_item[this.last_sel_item.length] = ft_cnt;
        njs.AppManager.infoFloatFeatures[ft_cnt] = null;//{lyr:this.graphicInfoLyr,feat:feature};
        let attr_prop = features[_feat].clone().getProperties();
        const skip_prop = ['boundedBy', 'geom_gml', 'geometry'];
        let attr = {};
        for (var key in attr_prop) {
            if (attr_prop.hasOwnProperty(key) && skip_prop.indexOf(key) == -1) {
                attr[key] = attr_prop[key];
            }
        }

        // Filtering by attribute's value
        if (this.filter_by_attributes != null) {
            let _skip_filtered = false;
            for (let _att in this.filter_by_attributes.conditions) {
                if (typeof attr[_att] != "undefined") {
                    const _cond = this.filter_by_attributes.conditions[_att];
                    let _val_item;
                    let _val_cond;

                    if (_cond.operator != "in" && _cond.operator != "not in") {
                        switch (_cond.type) {
                            case "date":
                                _val_item = new Date(attr[_att]);
                                _val_cond = new Date(_cond.value);
                                break;
                            case "numeric":
                                _val_item = parseFloat(attr[_att]);
                                _val_cond = parseFloat(_cond.value);
                                break;
                            case "text":
                                //if  (typeof _cond.value === "string")
                                _val_item = attr[_att].toString();
                                _val_cond = _cond.value.toString();
                                break;
                            default:
                                break;
                        }
                    }
                    switch (_cond.operator) {
                        case "=":
                            _skip_filtered = (_val_item == _val_cond);
                            break;
                        case "!=":
                            _skip_filtered = (_val_item != _val_cond);
                            break;
                        case ">":
                            _skip_filtered = (_val_item > _val_cond);
                            break;
                        case ">=":
                            _skip_filtered = (_val_item >= _val_cond);
                            break;
                        case "<":
                            _skip_filtered = (_val_item < _val_cond);
                            break;
                        case "<=":
                            _skip_filtered = (_val_item <= _val_cond);
                            break;
                        case "in":
                            _skip_filtered = (_cond.value.indexOf(attr[_att]) != -1);
                            break;
                        case "not in":
                            _skip_filtered = (_cond.value.indexOf(attr[_att]) == -1);
                            break;

                        default:
                            break;
                    }
                }
                if (typeof this.filter_by_attributes.operator != 'undefined' && this.filter_by_attributes.operator != null) {
                    if (this.filter_by_attributes.operator == "or" && _skip_filtered == true) break;
                    else if (this.filter_by_attributes.operator == "and" && _skip_filtered == false) break;
                }
            }
            if (_skip_filtered == true) continue;
        }

        // geometry
        var _geom;
        var _geom_index;
        var theGeom;
        _geom = attr['GEOM_WKT'] || attr['geom_wkt'];
        _geom_index = attr['THE_GEOM_INDEX'] || attr['the_geom_index'];
        var geom_proj;
        var _custom_highlight = true;
        if (typeof _geom != "undefined" && _geom != null) {
            // Must act as a geojson feature collection in order to support multiobject highlight
            theGeom = new ol.format.WKT().readFeatures(_geom);
            // the highlightProj contains the projection of the object stored in the db
            if (this.highlightProj != null) geom_proj = this.highlightProj;
        } else if (typeof _geom_index != "undefined" && _geom_index != null) {
            theGeom = new ol.format.WKB().readFeatures(_geom_index);
            // Must act as a geojson feature collection in order to support multiobject highlight
            if (this.highlightProj != null) geom_proj = this.highlightProj;
            _geom = _geom_index;
        } else {
            _geom = attr['GEOM_JSON'] ? attr['GEOM_JSON'] : attr['geom_json'];
            if (typeof _geom != "undefined" && _geom != null) {
                // consider the response as a feature collection (as default in the read method)
                const format = new ol.format.GeoJSON(); 
                const obj = typeof _geom === 'string' ? JSON.parse(_geom) : _geom;                

                if (obj.type === 'FeatureCollection' || obj.type === 'Feature') {
                    theGeom = format.readFeatures(obj);
                } 
                else if (obj.type === 'GeometryCollection') {
                    theGeom = obj.geometries.map(g =>
                        new ol.Feature({
                            geometry: format.readGeometry(g)
                        })
                    );
                }
                else {
                    theGeom = [
                        new ol.Feature({
                            geometry: format.readGeometry(obj)
                        })
                    ];
                }                
            } else if (typeof features[_feat].getGeometry() != "undefined" && features[_feat].getGeometry() != null) {
                // Must act as a geojson feature collection in order to support multiobject highlight
                theGeom = [];
                _geom = features[_feat];
                theGeom[0] = _geom;
                _custom_highlight = false;
                // The getFeatureInfo returns the feature object with the correct projection (basemap)
                // and therefor don't need to be reprojected
            }
            if (this.highlightProj != null) geom_proj = this.highlightProj;
        }

        njs.AppManager.infoFloatFeatures[ft_cnt] = {};
        njs.AppManager.infoFloatFeatures[ft_cnt].attr = attr;
        njs.AppManager.infoFloatFeatures[ft_cnt].maptip_id = this.id;
        njs.AppManager.infoFloatFeatures[ft_cnt].key_name = this.key_attr;
        njs.AppManager.infoFloatFeatures[ft_cnt].editing_id = null;
        njs.AppManager.infoFloatFeatures[ft_cnt].layer_id = null;
        // keep the feature real geometry  in property realgeom for use in editing if any
        // (as the geom_wkt or geom_json can differ from original geometry)
        if (features[_feat].getGeometry() != null && typeof features[_feat].getGeometry() != "undefined") {
            njs.AppManager.infoFloatFeatures[ft_cnt].realgeom = [];
            njs.AppManager.infoFloatFeatures[ft_cnt].realgeom[0] = features[_feat].clone();
        }
        if (this.linked_editing_id && njs.AppManager.EditingTools[this.linked_editing_id]) {
            njs.AppManager.infoFloatFeatures[ft_cnt].editing_id = this.linked_editing_id;
            njs.AppManager.infoFloatFeatures[ft_cnt].layer_id = this.linked_layer_id
        }

        if (_geom != null && typeof _geom != "undefined" && _geom !== "") {
            var _graphicInfoLyr = njs.AppManager.getLayerByName(this.idmap, "cosmetic_maptip");
            if (_graphicInfoLyr == null) {
                _graphicInfoLyr = new ol.layer.Vector();
                _graphicInfoLyr.setSource(
                    new ol.source.Vector("cosmetic_maptip", {
                        features: []
                    })
                );
                _graphicInfoLyr.set('name', 'cosmetic_maptip');
                njs.AppManager.Maps[this.idmap].mapObj.addLayer(_graphicInfoLyr);
            }

            njs.AppManager.infoFloatFeatures[ft_cnt].geom = [];
            njs.AppManager.infoFloatFeatures[ft_cnt].custom_highlight = _custom_highlight;

            // loop through the collection objects
            for (var ftt in theGeom) {
                var theNewGeom = theGeom[ftt].clone().getGeometry();
                if (geom_proj) theNewGeom.transform(geom_proj, njs.AppManager.Maps[this.idmap].mapObj.getView().getProjection().getCode());


                njs.AppManager.infoFloatFeatures[ft_cnt].geom[ftt] = new ol.Feature(theNewGeom);
                if (this.highLightstyle) {
                    var _style = njs.AppManager.Maps[this.idmap].getNewOLStyle(this.highLightstyle, theNewGeom.getType());
                    njs.AppManager.infoFloatFeatures[ft_cnt].geom[ftt].setStyle(_style);
                }

            }
        }

        // aliases for nls text titles
        var _txt_id = this.id;
        if (this.nls) _txt_id = this.nls;

        var open_external_form = false;
        if (this.linked_editing_id && njs.AppManager.EditingTools[this.linked_editing_id]) {
            if (njs.AppManager.EditingTools[this.linked_editing_id].external_form &&
                njs.AppManager.EditingTools[this.linked_editing_id].qryFields.length == 0 &&
                this.qryFields.length == 0) {
                open_external_form = true;
            }
        }
        // fcb v4
        //if (feat_layer != null) {
        if (!open_external_form) {
            // TITLE
            var item_title = this.getInfoResultsTitle(ft_cnt, _txt_id);

            // content
            content = [];

            // Build here the info content with formats and so on
            content[0] = "<table id='table_" + this.id + "_" + ft_cnt + "' border='0' cellspacing='0' width='100%'>";
            if (this.qryFieldsTab) {
                for (var itab = 0; itab < this.qryFieldsTab.length; itab++) {
                    if (!content[(this.qryFieldsTab[itab] - 1)]) {
                        content[(this.qryFieldsTab[itab] - 1)] = "<table id='table_" + this.id + "_" + ft_cnt + "_" + (this.qryFieldsTab[itab] - 1) + "' border='0' cellspacing='0' width='100%'>";
                    }
                }
            }
            var _tab_content = this.buildInfoResultsTableContent(ft_cnt, content, _txt_id);
            content = _tab_content.content;
            var arr_img_carousels = _tab_content.carousels;

            //end of main table and footer with formats
            for (var itab = 0; itab < content.length; itab++) {
                content[itab] += "</table>";
                content = this.buildInfoResultsFooterContent(ft_cnt, content, _txt_id, itab + 1);

            }

            this.buildInfoResultsTitlePane(ft_cnt, content, _txt_id, length_divs, item_title);

            var itemRequest = {
                query: {},
                count: 20
            };
            var itemNameMap = {
                imageThumbAttr: "thumb",
                imageLargeAttr: "large"
            };

            this.buildInfoResultsCarousels(arr_img_carousels);
        } else {
            njs.AppManager.EditingTools[this.linked_editing_id].openCustomForm(ft_cnt);
        }
        //}
        // limit the display of the informations if set
        if (this.maxFeatures && this.maxFeatures == (_feat + 1)) break;
    }
    if (this.new_info_width > 0 && njs.AppManager.customPane == false) {
        njs.AppManager.infoFloatWin.resize({ w: this.new_info_width });
    }

    return '';
};

njs.MapTip.prototype.getFormFeaturesInfos = function (features, length_divs) {
    var ft_cnt = 0;
    if (njs.AppManager.infoFloatFeatures) ft_cnt = njs.AppManager.infoFloatFeatures.length;

    var array_fid = [];
    for (var ft in features) {
        ft_cnt++;
        // geometry
        var _geom;
        var theGeom;
        var attr = features[ft].getProperties();

        _geom = features[ft];
        theGeom = []
        theGeom[0] = _geom;
        var geom_proj;
        _geom = attr['GEOM_WKT'] ? attr['GEOM_WKT'] : attr['geom_wkt'];
        var _custom_highlight = true;
        if (_geom != null && typeof _geom != "undefined") {
            // Must act as a geojson feature collection in order to support multiobject highlight
            theGeom = new ol.format.WKT().readFeatures(_geom);
            // the highlightProj contains the projection of the object stored in the db
            if (this.highlightProj != null) geom_proj = this.highlightProj;
        } else {
            _geom = attr['GEOM_JSON'] ? attr['GEOM_JSON'] : attr['geom_json'];
            if (typeof _geom != "undefined" && _geom != null) {
                // consider the response as a feature collection (as default in the read method)
                const format = new ol.format.GeoJSON(); 
                const obj = typeof _geom === 'string' ? JSON.parse(_geom) : _geom;                

                if (obj.type === 'FeatureCollection' || obj.type === 'Feature') {
                    theGeom = format.readFeatures(obj);
                } 
                else if (obj.type === 'GeometryCollection') {
                    theGeom = obj.geometries.map(g =>
                        new ol.Feature({
                            geometry: format.readGeometry(g)
                        })
                    );
                }
                else {
                    theGeom = [
                        new ol.Feature({
                            geometry: format.readGeometry(obj)
                        })
                    ];
                }      
            } else if (typeof features[ft].getGeometry() != "undefined" && features[ft].getGeometry() != null) {
                // Must act as a geojson feature collection in order to support multiobject highlight
                theGeom = [];
                _geom = features[ft];
                theGeom[0] = _geom;
                _custom_highlight = false;
                // The getFeatureInfo returns the feature object with the correct projection (basemap)
                // and therefor doesn't need to be reprojected
            }
            // the highlightProj contains the projection of the object stored in the db
            if (this.highlightProj != null) geom_proj = this.highlightProj;
        }

        njs.AppManager.infoFloatFeatures[ft_cnt] = {};
        njs.AppManager.infoFloatFeatures[ft_cnt].attr = attr;
        njs.AppManager.infoFloatFeatures[ft_cnt].maptip_id = this.id;
        njs.AppManager.infoFloatFeatures[ft_cnt].editing_id = null;
        // keep the feature real geometry  in property realgeom for use in editing if any
        // (as the geom_wkt or geom_json can differ from original geometry)
        if (features[ft].getGeometry() != null && typeof features[ft].getGeometry() != "undefined") {
            njs.AppManager.infoFloatFeatures[ft_cnt].realgeom = [];
            njs.AppManager.infoFloatFeatures[ft_cnt].realgeom[0] = features[ft];
        }
        if (this.linked_editing_id && njs.AppManager.EditingTools[this.linked_editing_id]) njs.AppManager.infoFloatFeatures[ft_cnt].editing_id = this.linked_editing_id;

        // v4 TBC
        array_fid.push(features[ft].data[this.key_attr]);

        if (_geom != null && typeof _geom != "undefined" && _geom !== "" && this.highLightstyle != null) {
            var _graphicInfoLyr = njs.AppManager.getLayerByName(this.idmap, "cosmetic_maptip");
            if (_graphicInfoLyr == null) {
                _graphicInfoLyr = new ol.layer.Vector();
                _graphicInfoLyr.setSource(
                    new ol.source.Vector("cosmetic_maptip", {
                        features: []
                    })
                );
                _graphicInfoLyr.set('name', 'cosmetic_maptip');
                njs.AppManager.Maps[this.idmap].mapObj.addLayer(_graphicInfoLyr);
            }

            njs.AppManager.infoFloatFeatures[ft_cnt].geom = [];
            njs.AppManager.infoFloatFeatures[ft_cnt].custom_highlight = _custom_highlight;
            // loop through the collection objects
            for (var ftt in theGeom) {
                var theNewGeom = theGeom[ftt].clone().getGeometry();
                if (geom_proj) theNewGeom.transform(geom_proj, njs.AppManager.Maps[this.idmap].mapObj.getView().getProjection().getCode());

                var _style = njs.AppManager.Maps[this.idmap].getNewOLStyle(this.highLightstyle, theNewGeom.getType());

                // pass the geometry along with the attributes as feature properties

                var _newfeature = new ol.Feature(attr);
                _newfeature.setStyle(_style);

                njs.AppManager.infoFloatFeatures[ft_cnt].geom[ftt] = _newfeature;
                //if (_graphicInfoLyr!=null) _graphicInfoLyr.addFeatures(njs.AppManager.infoFloatFeatures[ft_cnt].geom[ftt]);
            }

            njs.AppManager.infoFloatWinReplaceHighlite(-1, false, this.idmap);

        }
    }

    var that = this;
    var args = {};

    args["FID"] = array_fid;
    args["dbconn_id"] = this.dbconn_id;
    args["key"] = this.key_attr;
    args["table"] = this.table;
    args["layer"] = this.linked_layer_id;
    args["lang"] = njs.AppManager.Language;
    args["action"] = "update";

    // check of external container for the form
    if (this.external_container && this.external_container == "open-window") {
        window.open(this.external_form_url);
    } else if (this.external_container) {
        var pane = dijit.byId(container);
        pane.setContent(resp.responseText);
        var _container = pane.getParent();
        // switch to the form pane but with some litle delay in order to see the selected object for a litle while
        setTimeout(dojo.hitch(null, function (_pane) {
            _container.selectChild(_pane)
        }, pane), 500);

    } else {
        var item_title = "";
        var _txt_id = that.id;
        if (that.nls) _txt_id = that.nls;
        if (njs.AppManager.nls.maptipsResources) {
            // For the title, if a custom entry is still defined in the "nls" file then that will override the general one
            // (if the parameter "nls" is defined for that maptip.
            if (njs.AppManager.nls.maptipsResources[that.id + "_title"]) item_title = njs.AppManager.nls.maptipsResources[that.id + "_title"];
            else if (njs.AppManager.nls.maptipsResources[_txt_id + "_title"]) item_title = njs.AppManager.nls.maptipsResources[_txt_id + "_title"];
        }

        // content
        var content = [];

        // Build here the info content with formats and so on
        content[0] = "<table id='table_" + this.id + "_formfeatures' border='0' cellspacing='0' width='100%'>";


        content[0] = "<iframe src='" + this.external_form_url + "' style='width:100%'></iframe>";

        content[0] += "</table>"; //end of main table


        this.buildInfoResultsTitlePane(ft_cnt, content, _txt_id, length_divs, item_title);
    }

}

njs.MapTip.prototype.getInfoResultsTitle = function (ft_cnt, _txt_id, item_title) {

    var attr = njs.AppManager.infoFloatFeatures[ft_cnt].attr;

    if (typeof item_title == 'undefined' || item_title == null) {
        item_title = "";
        if (njs.AppManager.nls.maptipsResources) {
            // For the title, if a custom entry is still defined in the "nls" file then this will override the general one
            // (if the parameter "nls" is defined for this maptip.
            if (njs.AppManager.nls.maptipsResources[this.id + "_title"]) item_title = njs.AppManager.nls.maptipsResources[this.id + "_title"];
            else if (njs.AppManager.nls.maptipsResources[_txt_id + "_title"]) item_title = njs.AppManager.nls.maptipsResources[_txt_id + "_title"];
        }
    }

    if (item_title.indexOf('#') > -1) {
        var ar_item_title = item_title.split('#');
        item_title = "";
        for (var part = 0; part < ar_item_title.length; part++) {
            // check if is even item
            if (part % 2 == 0) {
                item_title += ar_item_title[part];
            } else {
                var attrib_title = attr[ar_item_title[part]] != null ? attr[ar_item_title[part]] : "";
                // first check if the value must be hold from a lookup
                let _qry_flds_idx = this.qryFields.indexOf(ar_item_title[part]);
                if (_qry_flds_idx > -1) {
                    if (this.fldLookup[_qry_flds_idx] !== undefined) {
                        // if the lookup collection is empty (value of null), retrive it from the remote source first
                        if (this.fldLookup[_qry_flds_idx].items == null || this.nocache_lookup === true) {
                            this._loadLookUp(_qry_flds_idx);
                        } else if (this.fldLookup[_qry_flds_idx].filterlang === true) {
                            this.fldLookup[_qry_flds_idx].items = this.fldLookup[_qry_flds_idx].items[njs.AppManager.Language];
                            this.fldLookup[_qry_flds_idx].filterlang = false;
                        }

                        if (this.fldLookup[_qry_flds_idx].items != null) {
                            // get the lookup value for this item
                            if (typeof this.fldLookup[_qry_flds_idx].items[attr[this.qryFields[_qry_flds_idx]]] != "undefined") {
                                attrib_title = this.fldLookup[_qry_flds_idx].items[attr[this.qryFields[_qry_flds_idx]]];
                            }
                        }
                    }
                }
                // cleans html tags in string
                item_title += attrib_title.replace(/<\/?[^>]+(>|$)/g, "");
            }
        }
    }

    return item_title;
};

njs.MapTip.prototype.buildInfoResultsTableContent = function (ft_cnt, content, _txt_id) {

    content[0] += "<tr><td colspan='4'></td></tr>";
    var attr = njs.AppManager.infoFloatFeatures[ft_cnt].attr;

    var arr_img_carousels = {};
    var is_first = true;

    var _arr_qry_flds = [];
    if (this.qryFields[0] == "*") {
        for (var aname in attr) {
            _arr_qry_flds.push(aname);
        }
    } else {
        _arr_qry_flds = this.qryFields;
    }

    for (var i = 0; i < _arr_qry_flds.length; i++) {
        // get the alias of the field and the field's value
        var item_val = attr[_arr_qry_flds[i]];
        var item_format = "";
        var item_name = _arr_qry_flds[i];

        var item_tab = this.qryFieldsTab ? (this.qryFieldsTab[i] - 1) : 0;

        // check first null placeholder values
        if (this.qryFieldsNullVal) {
            if (this.qryFieldsNullVal[i]) {
                if (item_val == this.qryFieldsNullVal[i]) {
                    item_val = null;
                }
            }
        }

        // check first for formatting definition of the field value
        if (this.qryFieldsFormat) {
            if (this.qryFieldsFormat[i]) item_format = this.qryFieldsFormat[i];
        }

        if (item_format.indexOf("centroid_x(") > -1 || item_format.indexOf("centroid_y(") > -1) var geom_center = calculateGeometryCenter(njs.AppManager.infoFloatFeatures[ft_cnt].realgeom[0].getGeometry());
        if (item_format.indexOf("centroid_x(") > -1) item_val = geom_center.center[0];
        if (item_format.indexOf("centroid_y(") > -1) item_val = geom_center.center[1];
        // when set, show the empty fields too (property showEmptyFields)
        // or when formatting property with concat option, but not with neconcat option)
        if (item_val == null || typeof item_val == 'undefined') {
            if (item_format.indexOf("concat(") > -1) {
                if (item_format.indexOf("neconcat(") == -1) item_val = "";
            }
            else if (this.showEmptyFields == true) item_val = "";
        }
        if (item_format.indexOf("neconcat(") > -1) item_format = item_format.replace("neconcat(", "concat(");

        if (item_val != null && typeof item_val != 'undefined') {
            // first check if the value must be hold from a lookup
            if (typeof this.fldLookup[i] != 'undefined') {
                // if the lookup collection is empty (value of null), retrive it from the remote source first
                if (this.fldLookup[i].items == null || this.nocache_lookup === true) {
                    this._loadLookUp(i);
                } else if (this.fldLookup[i].filterlang === true) {
                    this.fldLookup[i].items = this.fldLookup[i].items[njs.AppManager.Language];
                    this.fldLookup[i].filterlang = false;
                }

                // get the lookup value for this item
                if (typeof this.fldLookup[i].items != 'undefined' && typeof this.fldLookup[i].items[attr[item_name]] != 'undefined') {
                    item_val = this.fldLookup[i].items[attr[item_name]];
                    if (item_val.indexOf("concat(") > -1) item_format = item_val;
                }
            }

            // here do the formatting stuff
            if (item_format != "") {
                if (item_format.indexOf("concat(") > -1) {
                    var _cont_items = item_format.substring(item_format.indexOf("concat(") + 7, item_format.length - 1);
                    item_val = this._concatMaptipAtrtributes(_cont_items, attr, item_name, i);
                } else {
                    item_val = this._formatMaptip(item_val, item_format, item_name);
                }
            }

            // check if the value is an url
            var attribute_value = item_val; //decodeURI(item_val); // decodeURI makes problems with some escaped html values
            if (typeof attribute_value === "string") attribute_value = attribute_value.replace(/\n/g, "<br />");
            if (attribute_value != "" || this.showEmptyFields == true) {
                var _img_gallery = null;
                if (this.imageGalleryFields) {
                    if (this.imageGalleryFields[_arr_qry_flds[i]]) _img_gallery = this.imageGalleryFields[_arr_qry_flds[i]];
                }

                var _dl_docs = null;
                if (this.documentsDownloadFields) {
                    if (this.documentsDownloadFields[_arr_qry_flds[i]]) _dl_docs = this.documentsDownloadFields[_arr_qry_flds[i]];
                }

                if (item_format != 'skip_html_format') {
                    var pattern = /^[a-zA-Z]+:\/\/.*$/;
                    if (pattern.test(attribute_value.toString()) || attribute_value.toString().indexOf('//') == 0)
                        attribute_value = "<a href='" + attribute_value + "' target='_blank'>" + njs.AppManager.nls.maptipsResources["general_linktext"] + "</a>";
                    else if (attribute_value.toString().indexOf('www.') == 0)
                        attribute_value = "<a href='https://" + attribute_value + "' target='_blank'>" + njs.AppManager.nls.maptipsResources["general_linktext"] + "</a>";
                    else if ((attribute_value.toString().indexOf('<') == -1) && (attribute_value.toString().indexOf('@') > 0))
                        attribute_value = "<a href='mailto:" + attribute_value + "'>" + njs.AppManager.nls.maptipsResources["general_linktext"] + "</a>";
                    else if (item_format == 'extract_url_format' || item_format == 'add_url_format') {
                        pattern = /(?:(?:https?|ftp|file):\/\/|www\.|ftp\.)(?:\([-A-Z0-9+&@#\/%=~_|$?!:,.]*\)|[-A-Z0-9+&@#\/%=~_|$?!:,.])*(?:\([-A-Z0-9+&@#\/%=~_|$?!:,.]*\)|[A-Z0-9+&@#\/%=~_|$])/gi;
                        let reg_test = [];
                        let reg_arr;
                        while ((reg_arr = pattern.exec(attribute_value.toString())) !== null) {
                            /* var msg = 'Found ' + reg_arr[0] + '. ' + 'Next match starts at ' + pattern.lastIndex;
                            console.log(msg); */
                            if (reg_arr[0].startsWith("www.")) reg_arr[0]= "https://" + reg_arr[0];                            
                            reg_test.push(reg_arr[0]);
                        }
                        if (reg_test.length > 0) {
                            if (item_format == 'extract_url_format') {
                                attribute_value = "";
                                for (var itm in reg_test) {
                                    const _add_info = (reg_test.length > 1) ? " (Link " + (parseInt(itm) + 1) + ")" : "";
                                    attribute_value += (attribute_value != "") ? "<br>" : ""
                                    attribute_value += "<a href='" + reg_test[itm] + "' target='_blank'>" + njs.AppManager.nls.maptipsResources["general_linktext"] + "</a>" + _add_info;
                                }
                            } else if (item_format == 'add_url_format') {
                                for (var itm in reg_test) {
                                    const newtxt = "<a href='" + reg_test[itm] + "' target='_blank'>" + reg_test[itm] + "</a>";
                                    attribute_value = attribute_value.toString().replace(reg_test[itm], newtxt);
                                }
                            }

                        }
                    }
                }

                var _att_name = item_name;
                if (typeof njs.AppManager.nls.maptipsResources[_txt_id + "_field_" + item_name] != undefined && njs.AppManager.nls.maptipsResources[_txt_id + "_field_" + item_name] != null) {
                    _att_name = njs.AppManager.nls.maptipsResources[_txt_id + "_field_" + item_name];
                }
                //added possibility to overwrite the general nls definition with the specific a layer field nls
                if (this.id !=_txt_id){
                    if (typeof njs.AppManager.nls.maptipsResources[this.id + "_field_" + item_name] != undefined && njs.AppManager.nls.maptipsResources[this.id + "_field_" + item_name] != null) {
                        _att_name = njs.AppManager.nls.maptipsResources[this.id + "_field_" + item_name];                       
                    }
                }               
                //for imported wms hack to overwrite the general nls definition with the query_layers properties
                if (this.id.startsWith("-wi")){
                    if (typeof njs.AppManager.nls.maptipsResources[this.query_layers + "_field_" + item_name] != undefined && njs.AppManager.nls.maptipsResources[this.query_layers + "_field_" + item_name] != null) {
                        _att_name = njs.AppManager.nls.maptipsResources[this.query_layers + "_field_" + item_name];                       
                    }
                }  
                // see if some attribute values shall be included in title
                if (_att_name.indexOf('#') > -1) _att_name = this.getInfoResultsTitle(ft_cnt, _txt_id, _att_name);


                if (_att_name != "" && !_img_gallery) {
                    //if (_att_name!="") {
                    //rba20130716:added id's for editing maptips
                    if (is_first) content[item_tab] += "<tr id='" + this.id + "_row_" + item_name + "_" + ft_cnt + "'><td class='infoWindowFirstItemName'>" + _att_name + "</td><td class='infoWindowFirstItem' id='" + this.id + "_col_" + item_name + "_" + ft_cnt + "'>";
                    else content[item_tab] += "<tr id='" + this.id + "_row_" + item_name + "_" + ft_cnt + "'><td class='infoWindowItemName'>" + _att_name + "</td><td class='infoWindowItem' id='" + this.id + "_col_" + item_name + "_" + ft_cnt + "'>";
                } else {
                    var _style = "";
                    if (_img_gallery) _style = "align='center'";
                    // if no description, then merge the two columns
                    if (is_first) content[item_tab] += "<td colspan='2' class='infoWindowFirstItem' id='" + this.id + "_col_" + item_name + "_" + ft_cnt + "' " + _style + ">";
                    else content[item_tab] += "<td colspan='2' class='infoWindowItem' id='" + this.id + "_col_" + item_name + "_" + ft_cnt + "' " + _style + ">";
                }

                if (_img_gallery) {
                    var fid = eval('attr.' + this.key_attr);
                    var _c = this.key_attr + "=" + fid;
                    var _listimgs = attribute_value.split('|');
                    var _listurls = [];

                    var _max_h = 200;
                    var _author = _img_gallery.author_admin ? _img_gallery.author_admin : "";
                    var _author_carousel;
                    var _src = _img_gallery.src_tn ? _img_gallery.src_tn : _img_gallery.src;
                    var _src_open = _img_gallery.src_tn ? _img_gallery.src : null;

                    if (_src.indexOf("concat(") > -1) {
                        var _cont_items = _src.substring(_src.indexOf("concat(") + 7, _src.length - 1);
                        _src = this._concatMaptipAtrtributes(_cont_items, attr, item_name, i);
                    }
                    if (_src_open != null && _src_open.indexOf("concat(") > -1) {
                        var _cont_items = _src_open.substring(_src_open.indexOf("concat(") + 7, _src_open.length - 1);
                        _src_open = this._concatMaptipAtrtributes(_cont_items, attr, item_name, i);
                    }

                    if (_img_gallery.author_field) {
                        var _auth_fld = _img_gallery.author_field;
                        if (attr[_auth_fld]) {
                            _author = attr[_auth_fld];
                        } else _author = _img_gallery.author_admin;
                    }
                    if (_author && _author != "") {
                        _author_carousel = cleanUpSpecialChars(_author, true);
                        _author = cleanUpSpecialChars(_author, true) + "/tn/";
                    }

                    content[item_tab] += "<div id='" + this.id + "_field_" + _arr_qry_flds[i] + "_" + ft_cnt + "'><div id='carousel_maptip_" + this.id + "_" + _arr_qry_flds[i] + "_" + ft_cnt + "'></div></div><input id='carousel_author_" + this.id + "_" + ft_cnt + "' type='hidden' value='" + _author_carousel + "' /></td></tr>";

                    if (attribute_value != "") {
                        for (var _img in _listimgs) {
                            var _src_obj = { src: _src + _author + _listimgs[_img] + ".jpg" };
                            if (_src_open != null) _src_obj["src_open"] = _src_open + _author + _listimgs[_img] + ".jpg";
                            _listurls.push(_src_obj);
                        }
                    }
                    arr_img_carousels["carousel_maptip_" + this.id + "_" + _arr_qry_flds[i] + "_" + ft_cnt] = {
                        items: _listurls,
                        max_h: _max_h
                    };

                } else if (_dl_docs) {
                    var _doc_items = attribute_value.split("||");
                    content[item_tab] += "<div id='" + this.id + "_field_" + item_name + "_" + ft_cnt + "'>";
                    if (attribute_value != "") {
                        for (var _docu in _doc_items) {
                            if (_docu > 0) content[item_tab] += "<br>";
                            var _doc_elements = _doc_items[_docu].split("|");
                            content[item_tab] += "<div id='" + this.id + "_field_" + item_name + "_" + ft_cnt + "_" + _docu + "'><input  id='" + item_name + "_filedl_" + _docu + "' data-dojo-type='dijit.form.Button' label='" + njs.AppManager.nls.maptipsResources["docs_download"] + "' onclick='njs.AppManager.MapTips[\"" + this.id + "\"]._clickfiledownload(\"" + item_name + "\",\"" + _doc_items[_docu] + "\");' /><span class='info_filename'>" + _doc_elements[2] + "</span></div>";
                        }
                    }
                    content[item_tab] += "</div></td></tr>";

                } else
                    content[item_tab] += "<div id='" + this.id + "_field_" + item_name + "_" + ft_cnt + "'>" + attribute_value + "</div></td></tr>";

                is_first = false;
            }
        }
    }

    // Special queries
    var _spec_qry_cnt = 0;
    if (this.qrySpecialsFields) {
        for (var ii = 0; ii < this.qrySpecialsFields.length; ii++) {
            var _ctnt = "";
            var _key_val = "?";
            this.qrySpecialsFields[ii].cgi = this.qrySpecialsFields[ii].cgi.replace('#lang#', njs.AppManager.Language).replace('#user#', njs.AppManager.auth_user).replace('#sid#', njs.AppManager.Guid);
            if (this.qrySpecialsFields[ii].cgi.indexOf("?") > -1) _key_val = "&";
            // allways send the current projection to the cgi server
            _key_val += "map_proj=" + njs.AppManager.Maps[this.idmap].mapObj.getView().getProjection().getCode() + "&";
            // geo informations
            if (this.qrySpecialsFields[ii].bbox) {
                _key_val += "bbox=" + njs.AppManager.Maps[this.idmap].mapObj.getExtent().toString() + "&";
            }
            if (this.qrySpecialsFields[ii].click_xy) {
                _key_val += "clickx=" + njs.AppManager.infoXYCoords[0] + "&clicky=" + njs.AppManager.infoXYCoords[1] + "&";
            }

            for (var j = 0; j < this.qrySpecialsFields[ii].fields.length; j++) {
                if (this.qrySpecialsFields[ii].alias != null && typeof this.qrySpecialsFields[ii].alias != "undefined") _key_val += this.qrySpecialsFields[ii].alias[j];
                else _key_val += this.qrySpecialsFields[ii].fields[j];

                _key_val += "=" + attr[this.qrySpecialsFields[ii].fields[j]] + "&";
            }
            var _url = this.qrySpecialsFields[ii].cgi + _key_val.substring(0, _key_val.length - 1);
            if (this.qrySpecialsFields[ii].add_args != null && typeof this.qrySpecialsFields[ii].add_args != "undefined") _url += this.qrySpecialsFields[ii].add_args.replace('#lang#', njs.AppManager.Language).replace('#user#', njs.AppManager.auth_user).replace('#sid#', njs.AppManager.Guid);

            if (this.qrySpecialsFields[ii].type == "link" || this.qrySpecialsFields[ii].type == "iframe") {
                if (typeof njs.AppManager.nls.maptipsResources[_txt_id + "_field_" + this.qrySpecialsFields[ii].name] != "undefined" &&
                    njs.AppManager.nls.maptipsResources[_txt_id + "_field_" + this.qrySpecialsFields[ii].name] != null &&
                    njs.AppManager.nls.maptipsResources[_txt_id + "_field_" + this.qrySpecialsFields[ii].name] != "") {
                    if (is_first) _ctnt += "<tr><td class='infoWindowFirstItemName'>" + njs.AppManager.nls.maptipsResources[_txt_id + "_field_" + this.qrySpecialsFields[ii].name] + "</td><td class='infoWindowFirstItem'>";
                    else _ctnt += "<tr><td class='infoWindowItemName'>" + njs.AppManager.nls.maptipsResources[_txt_id + "_field_" + this.qrySpecialsFields[ii].name] + "</td><td class='infoWindowItem'>";
                } else {
                    // if no description, then merge the two columns
                    if (is_first) _ctnt += "<td colspan='2' class='infoWindowFirstItem'>";
                    else _ctnt += "<td colspan='2' class='infoWindowItem'>";
                }

                switch (this.qrySpecialsFields[ii].type) {
                    case "link":
                        var _link_label = "Link";
                        if (njs.AppManager.nls.maptipsResources[_txt_id + "_link_" + this.qrySpecialsFields[ii].name] && njs.AppManager.nls.maptipsResources[_txt_id + "_link_" + this.qrySpecialsFields[ii].name] != "")
                            _link_label = njs.AppManager.nls.maptipsResources[_txt_id + "_link_" + this.qrySpecialsFields[ii].name];
                        _ctnt += "<a href='" + _url + "' target='_blank'>" + _link_label + "</a></td></tr>";
                        break;
                    case "iframe":
                        _ctnt += "<iframe scrolling='no' frameborder='0' style='overflow:hidden;" + this.qrySpecialsFields[ii].style + "' src='" + _url + "' height='" + this.qrySpecialsFields[ii].height + "' width='" + this.qrySpecialsFields[ii].width + "'></iframe></td></tr>";
                        break;
                }

                is_first = false;
            } else {
                if (typeof this.qrySpecialsFields[ii].export != 'undefined' && this.qrySpecialsFields[ii].export != null) {
                    if (this.qrySpecialsFields[ii].export == true) {
                        _url += "&export=1";
                        var _csvstr = "";
                    }
                }


                var _spec_qry_id = this.id + "_" + ft_cnt + "_" + _spec_qry_cnt;
                //if (this.qrySpecialsFields[ii].tab && this.qrySpecialsFields[ii].tab > 1) {
                if (typeof this.qrySpecialsFields[ii].placeholder_id == 'undefined' || this.qrySpecialsFields[ii].placeholder_id == null) {
                    if (this.qrySpecialsFields[ii].tab) {
                        _spec_qry_id = "table_" + this.id + "_" + ft_cnt + "_" + this.qrySpecialsFields[ii].tab;
                        _ctnt += "<table border='0' cellspacing='0' width='100%'><tr id='" + _spec_qry_id + "'><td class='infoWindowItemName' colspan='2'>loading ...</td><td class='infoWindowItem'>loading ...</td></tr></table>";
                    } else {
                        _ctnt += "<tr id='" + _spec_qry_id + "'><td class='infoWindowItemName' colspan='2'>loading ...</td><td class='infoWindowItem'>loading ...</td></tr>";
                    }
                } else {
                    _spec_qry_id = this.id + "_row_" + this.qrySpecialsFields[ii].placeholder_id + "_" + ft_cnt;
                }
                require(["dojo/request/xhr"], dojo.hitch(this, function (_spec_qry_id, placeholder_id, xhr) {
                    xhr(_url, {
                        handleAs: "json", sync: false, preventCache: true
                    }).then(dojo.hitch(this, function (_spec_qry_id, placeholder_id, response) {
                        var _headerline = "";
                        var _spec_qry_resp = "";
                        var tabl_array = [];
                        if (response.table) tabl_array = response.table;
                        else tabl_array = response;

                        var _colspan = 0;
                        var dyna_spec_qry_resp = {};
                        for (var iii = 0; iii < tabl_array.length; iii++) {
                            if (typeof placeholder_id != "undefined" && placeholder_id == "#dynamic#") {
                                for (var plc_hold in tabl_array[iii]) {
                                    dyna_spec_qry_resp[plc_hold] = "";
                                    for (var i_plchold in tabl_array[iii][plc_hold]) {
                                        var _itm = tabl_array[iii][plc_hold][i_plchold].name;
                                        if (njs.AppManager.nls.maptipsResources[_txt_id + "_field_" + _itm]) _itm = njs.AppManager.nls.maptipsResources[_txt_id + "_field_" + _itm];
                                        if (is_first) dyna_spec_qry_resp[plc_hold] += "<tr><td class='infoWindowFirstItemName'>" + _itm + "</td><td class='infoWindowFirstItem'>";
                                        else dyna_spec_qry_resp[plc_hold] += "<tr><td class='infoWindowItemName'>" + _itm + "</td><td class='infoWindowItem'>";
                                        dyna_spec_qry_resp[plc_hold] += tabl_array[iii][plc_hold][i_plchold].value + "</td></tr>";
                                        _colspan = 2;
                                        is_first = false;
                                    }
                                }
                            } else {
                                if (tabl_array[iii].name) {
                                    var _itm = tabl_array[iii].name;
                                    if (njs.AppManager.nls.maptipsResources[_txt_id + "_field_" + _itm]) _itm = njs.AppManager.nls.maptipsResources[_txt_id + "_field_" + _itm];
                                    if (is_first) _spec_qry_resp += "<tr><td class='infoWindowFirstItemName'>" + _itm + "</td><td class='infoWindowFirstItem'>";
                                    else _spec_qry_resp += "<tr><td class='infoWindowItemName'>" + _itm + "</td><td class='infoWindowItem'>";
                                    _spec_qry_resp += tabl_array[iii].value + "</td></tr>";
                                    _colspan = 2;
                                    is_first = false;
                                } else {
                                    _spec_qry_resp += "<tr>";
                                    var _csvline = '';
                                    for (var j = 0; j < tabl_array[iii].length; j++) {
                                        if (iii == 0) {
                                            var _itm = tabl_array[iii][j];
                                            if (njs.AppManager.nls.maptipsResources[_txt_id + "_field_" + _itm]) _itm = njs.AppManager.nls.maptipsResources[_txt_id + "_field_" + _itm];

                                            _headerline += _itm + ",";
                                            _spec_qry_resp += "<td class='infoWindowItem'>" + _itm + "</td>";
                                        } else _spec_qry_resp += "<td class='infoWindowItemName'>" + tabl_array[iii][j] + "</td>";
                                        is_first = false;
                                        if (response.export) {
                                            _csvline += tabl_array[iii][j] + ";";
                                        }
                                    }
                                    _colspan = tabl_array[iii].length;
                                    _spec_qry_resp += "</tr>";
                                    if (response.export) {
                                        _csvstr += _csvline.slice(0, - 1) + '\r\n';
                                    }
                                }
                            }
                        }

                        if (response.export) {
                            var BOM = "\uFEFF";
                            var fileName = "export.csv";
                            var blob = new Blob([BOM + _csvstr], {
                                "type": "text/csv;charset=utf8;"
                            });
                            var exportlink = document.createElement("a");
                            var _tt_export = "Export";
                            if (typeof njs.AppManager.nls.maptipsResources["general_tooltips_export"] != undefined && njs.AppManager.nls.maptipsResources["general_tooltips_export"] != null) {
                                _tt_export = njs.AppManager.nls.maptipsResources["general_tooltips_export"];
                            }
                            var _tt_preview = "Preview";
                            if (typeof njs.AppManager.nls.maptipsResources["general_tooltips_preview"] != undefined && njs.AppManager.nls.maptipsResources["general_tooltips_preview"] != null) {
                                _tt_preview = njs.AppManager.nls.maptipsResources["general_tooltips_preview"];
                            }
                            var inner_str = "<img height='32px' style='margin-right:10px' src='../core/templates/" + njs.AppManager.template + "/img/buttons/export_table.svg' title='" + _tt_export + "'/>";
                            if (exportlink.download !== undefined) {
                                exportlink.setAttribute("href", window.URL.createObjectURL(blob));
                                exportlink.setAttribute("download", fileName);
                                exportlink.innerHTML = inner_str;
                            }
                            else if (window.navigator && window.navigator.msSaveOrOpenBlob) {
                                exportlink.setAttribute("href", "#");
                                exportlink.onclick = function () { window.navigator.msSaveOrOpenBlob(blob, fileName); };
                                exportlink.innerHTML = inner_str;
                            } else {
                                exportlink.innerHTML = "";
                            }
                            _spec_qry_resp = "<tr><td colspan='" + _colspan + "' class='infoWindowItemName'>" + exportlink.outerHTML + "<a href='/mapplus-lib/mapplus-dojo/" + njs.AppManager.Version + "/php/printCSV.php?csv=" + encodeURI(response.export) + "&title=" + encodeURI(_headerline.slice(0, -1)) + "' target='_blank'><img height='32px' src='../core/templates/" + njs.AppManager.template + "/img/buttons/printer.svg' title='" + _tt_preview + "'/></a></td></tr>" + _spec_qry_resp;
                        }

                        if (typeof placeholder_id == 'undefined' || placeholder_id == null) {
                            if (dojo.byId(_spec_qry_id)) dojo.byId(_spec_qry_id).outerHTML = _spec_qry_resp;
                            else {
                                setTimeout(function () {
                                    if (dojo.byId(_spec_qry_id)) dojo.byId(_spec_qry_id).outerHTML = _spec_qry_resp;
                                    else {
                                        setTimeout(function () {
                                            if (dojo.byId(_spec_qry_id)) dojo.byId(_spec_qry_id).outerHTML = _spec_qry_resp;
                                        }, 1000);
                                    }
                                }, 500);
                            }
                        } else {


                            for (var fld_id in dyna_spec_qry_resp) {
                                var _newplaceholder = _spec_qry_id.replace("#dynamic#", fld_id);
                                if (dojo.byId(_newplaceholder)) {
                                    dojo.byId(_newplaceholder).outerHTML = dyna_spec_qry_resp[fld_id];
                                } else {
                                    setTimeout(function () {
                                        if (dojo.byId(_newplaceholder)) {
                                            dojo.byId(_newplaceholder).outerHTML = dyna_spec_qry_resp[fld_id];
                                        } else {
                                            setTimeout(function () {
                                                if (dojo.byId(_newplaceholder)) {
                                                    dojo.byId(_newplaceholder).outerHTML = dyna_spec_qry_resp[fld_id];
                                                }
                                            }, 1000);
                                        }
                                    }, 500);
                                }
                            }

                            if (dojo.byId(_spec_qry_id)) {
                                for (var fld_id in dyna_spec_qry_resp) {
                                    var _newplaceholder = placeholder_id.replace("#dynamic#", fld_id);
                                    dojo.byId(_newplaceholder).outerHTML = dyna_spec_qry_resp[fld_id];
                                }
                            } else {
                                setTimeout(function () {
                                    if (dojo.byId(_spec_qry_id)) {
                                        for (var fld_id in dyna_spec_qry_resp) {
                                            dojo.byId(_newplaceholder).outerHTML = dyna_spec_qry_resp[fld_id];
                                        }
                                    } else {
                                        setTimeout(function () {
                                            if (dojo.byId(_spec_qry_id)) {
                                                for (var fld_id in dyna_spec_qry_resp) {
                                                    var _newplaceholder = placeholder_id.replace("#dynamic#", fld_id);
                                                    dojo.byId(_newplaceholder).outerHTML = dyna_spec_qry_resp[fld_id];
                                                }
                                            }
                                        }, 1000);
                                    }
                                }, 500);
                            }
                        }

                    }, _spec_qry_id, placeholder_id), function (err) {

                    });
                }, _spec_qry_id, this.qrySpecialsFields[ii].placeholder_id));
            }

            if (typeof this.qrySpecialsFields[ii].placeholder_id == 'undefined' || this.qrySpecialsFields[ii].placeholder_id == null) {
                if (this.qrySpecialsFields[ii].tab) {
                    if (this.qrySpecialsFields[ii].tab > 1) {
                        if (typeof content[this.qrySpecialsFields[ii].tab - 1] == "undefined") content[this.qrySpecialsFields[ii].tab - 1] = "";
                        content[this.qrySpecialsFields[ii].tab - 1] += "<table>" + _ctnt + "</table>";
                        if (this.qrySpecialsFields[ii].width && typeof this.qrySpecialsFields[ii].width != 'undefined') this.new_info_width = this.qrySpecialsFields[ii].width;
                    } else {
                        content[this.qrySpecialsFields[ii].tab - 1] += _ctnt;
                    }
                } else {
                    content[item_tab] += _ctnt;
                }
            }

            _spec_qry_cnt++;
        }
    }

    return { content: content, carousels: arr_img_carousels };
};

njs.MapTip.prototype.buildInfoResultsFooterContent = function (ft_cnt, content, _txt_id, itab) {

    content[itab - 1] += "<table border='0' id='maptip_footer_" + itab + "_" + ft_cnt + "' cellspacing='0' width='100%'>";

    var attr = njs.AppManager.infoFloatFeatures[ft_cnt].attr;

    // Footnote
    var footnote = "";
    if (itab == 1 && typeof njs.AppManager.nls.maptipsResources[_txt_id + "_footnote"] != 'undefined' && njs.AppManager.nls.maptipsResources[_txt_id + "_footnote"] != null) {
        footnote = njs.AppManager.nls.maptipsResources[_txt_id + "_footnote"];
    }
    if (typeof njs.AppManager.nls.maptipsResources[_txt_id + "_footnote_tab" + itab] != 'undefined' && njs.AppManager.nls.maptipsResources[_txt_id + "_footnote_tab" + itab] != null) {
        footnote = njs.AppManager.nls.maptipsResources[_txt_id + "_footnote_tab" + itab];
    }
    if (footnote != "") {
        content[itab - 1] += "<tr><td colspan='2' class='infoWindowFooter'>";
        content[itab - 1] += footnote;
        content[itab - 1] += "</td></tr>";
    }

    //    content[0] += "</td></tr>";

    if ((itab - 1) == 0) {
        content[0] += "<tr><td colspan='2' class='infoWindowLinkRight'>";
        content[0] += "<div id='_dialog_footer_" + ft_cnt + "'>";

        var fid = attr[this.key_attr];
        var _table = null;
        var footer_links_separator = "";
        if (typeof njs.config.maptips.general_settings.footer_links_separator != 'undefined') {
            footer_links_separator = njs.config.maptips.general_settings.footer_links_separator;
        }
        var _sep = "";

        //Upload File
        if (njs.AppManager.EditingTools[this.linked_editing_id] && (!njs.AppManager.EditingTools[this.linked_editing_id].restricted_field || (attr[njs.AppManager.EditingTools[this.linked_editing_id].restricted_field] == njs.AppManager.EditingTools[this.linked_editing_id].restricted_value))) {


            if (this.linked_editing_id && njs.AppManager.EditingTools[this.linked_editing_id] && (njs.AppManager.EditingTools[this.linked_editing_id].qryFields.length > 0 || njs.AppManager.EditingTools[this.linked_editing_id].geo_editable == 1 || njs.AppManager.EditingTools[this.linked_editing_id].delete == 1) || njs.AppManager.EditingTools[this.linked_editing_id].custom_action.length > 0) {
                // manage additional conditions (attribute values) in order to allow editing
                var _cnd_flag = true;
                if (njs.AppManager.EditingTools[this.linked_editing_id].attr_condition) {
                    for (var _att_cnd in njs.AppManager.EditingTools[this.linked_editing_id].attr_condition) {
                        if (attr[_att_cnd] != njs.AppManager.EditingTools[this.linked_editing_id].attr_condition[_att_cnd]) _cnd_flag = false;
                    }
                }

                var _lyr_name = njs.AppManager.EditingTools[this.linked_editing_id].linked_layer_id;

                if (_lyr_name && typeof _lyr_name != 'undefined' && _cnd_flag && njs.AppManager.EditingTools[this.linked_editing_id].update != 0) {
                    content[0] += "<a href='javascript:void(null)' onclick=njs.AppManager.EditingTools['" + this.linked_editing_id + "'].editInformation(" + ft_cnt + ",'" + fid + "','" + this.key_attr + "','" + _lyr_name + "')>";
                    content[0] += njs.AppManager.nls.maptipsResources["general_edit"];
                    content[0] += "</a>";
                    _sep = " " + footer_links_separator + " ";
                }
            }

            //Duplicate Feature
            if (this.linked_editing_id && njs.AppManager.EditingTools[this.linked_editing_id] && !njs.AppManager.EditingTools[this.linked_editing_id].is_google_map && njs.AppManager.EditingTools[this.linked_editing_id].duplicate == 1) {
                content[0] += _sep;
                content[0] += "<a href='javascript:void(null)' onclick=njs.AppManager.EditingTools['" + this.linked_editing_id + "'].duplicateFeature(" + ft_cnt + ",'" + fid + "','" + this.key_attr + "','" + _lyr_name + "')>";
                content[0] += njs.AppManager.nls.maptipsResources["general_duplicate_feature"];
                content[0] += "</a>";
                _sep = " " + footer_links_separator + " ";
            }

        }

        if (this.pdf_report !== null) {
            if (typeof this.pdf_report.languages != "undefined" && this.pdf_report.languages !== null) {
                content[0] += njs.AppManager.nls.maptipsResources["general_pdf_report"] + " ";
                for (var i = 0; i < this.pdf_report.languages.length; i++) {
                    content[0] += _sep;
                    content[0] += "<a class='report_lang' href='javascript:void(null)' onclick=njs.AppManager.MapTips['" + this.id + "'].openPdfReport(" + ft_cnt + ",'" + this.pdf_report.languages[i] + "')>";
                    content[0] += this.pdf_report.languages[i];
                    content[0] += "</a>";
                    _sep = " " + footer_links_separator + " ";
                }
            } else {
                content[0] += _sep;
                content[0] += "<a href='javascript:void(null)' onclick=njs.AppManager.MapTips['" + this.id + "'].openPdfReport(" + ft_cnt + ")>";
                content[0] += njs.AppManager.nls.maptipsResources["general_pdf_report"];
                content[0] += "</a>";
                _sep = " " + footer_links_separator + " ";
            }
        }
        //External form
        if (this.external_form !== null) {
            content[0] += _sep;
            content[0] += "<a href='javascript:void(null)' onclick=njs.AppManager.MapTips['" + this.id + "'].openCustomForm(" + ft_cnt + ")>";
            if (typeof this.external_form.info_form_readonly != "undefined" && this.external_form.info_form_readonly != null && this.external_form.info_form_readonly == 1) {
                content[0] += njs.AppManager.nls.maptipsResources["general_external_form_readonly"];
            } else {
                content[0] += njs.AppManager.nls.maptipsResources["general_external_form"];
            }
            content[0] += "</a>";
            _sep = " " + footer_links_separator + " ";

            if (this.external_form.direct_modal_call && typeof this.external_form.direct_modal_call != 'undefined') {
                for (var mod in this.external_form.direct_modal_call) {
                    content[0] += _sep;
                    content[0] += "<a href='javascript:void(null)' onclick=njs.AppManager.MapTips['" + this.id + "'].openCustomForm(" + ft_cnt + ",'" + this.external_form.direct_modal_call[mod] + "')>";
                    content[0] += njs.AppManager.nls.maptipsResources["external_form_" + this.external_form.direct_modal_call[mod]];
                    content[0] += "</a>";
                }
            }
        }

        content[0] += "</div>";

        if (njs.AppManager.EditingTools[this.linked_editing_id] && njs.AppManager.EditingTools[this.linked_editing_id].external_gui) {
            content[0] += "<div class='plus_container' id='" + njs.AppManager.EditingTools[this.linked_editing_id].id + "_update_plus_container'>";

        }

        content[0] += "</td></tr>";
    }
    content[itab - 1] += "</table>";

    return content;

};

njs.MapTip.prototype.buildInfoResultsCarousels = function (arr_img_carousels) {
    var that = this;

    // manage the carousel if needed
    for (var id in arr_img_carousels) {
        require([
            "dojo/_base/connect",
            "dojo/store/Memory",
            "dojox/mobile/StoreCarousel",
            "dojox/mobile"
        ], function (connect, Memory, StoreCarousel) {

            var _data = { items: arr_img_carousels[id].items };
            var imgStore = new Memory({ data: _data });

            that.carousel_widget[id] = new StoreCarousel({
                store: imgStore,
                height: (parseInt(arr_img_carousels[id].max_h) + 45) + "px",
                navButton: true,
                numVisible: 1,
                title: ""
            }, id);
            that.carousel_widget[id].startup();

            // subscribe to an select event of the carousel (global class). Check first that the subscribe is not already active.
            if (!njs.AppManager.MapTips["_carousel_widget_evt"]) {
                njs.AppManager.MapTips["_carousel_widget_evt"] = connect.subscribe("/dojox/mobile/carouselSelect", function (carousel, itemWidget, itemObject, index) {
                    // Each argument means:
                    //   carousel - The carousel widget containing the selected item
                    //   itemWidget - The selected item widget
                    //   itemObject - The item object in the data store for the selected item widget
                    //       (In case of Carousel widget, data store is not used so it is always undefined.)
                    //   index - The index of the selected item in the carousel items

                    // must control that the published event is trigered from a maptip carousel
                    if (carousel.id.indexOf("carousel_maptip_") == 0 && itemObject.src) {
                        var _newurl = "";
                        if (itemObject.src_open) {
                            _newurl = itemObject.src_open;
                        } else {
                            _newurl = itemObject.src.replace(/tn/g, "800");
                            _newurl = "/mapplus-lib/mapplus-dojo/" + njs.AppManager.Version + "/php/showImage.php?img=" + _newurl;
                        }
                        window.open(_newurl);

                        // check for special situation when thumbnails are not in the same format as image
                        /*dojo.xhrGet( {
                            url: that.proxy+"?proxy_url="+_newurl,
                            preventCache: false,
                            handleAs: "text",
                            sync:false,
                            load: function(response){
                                window.open(_newurl);

                            },
                            error: function(error) {
                                if (_newurl.indexOf(".jpg")>-1) window.open(_newurl.replace(/.jpg/g,".png"));
                                else window.open(_newurl.replace(/.png/g,".jpg"));
                            }
                        });*/
                    }
                });
            }
        });
    }
};

njs.MapTip.prototype.buildInfoResultsTitlePane = function (ft_cnt, content, _txt_id, length_divs, item_title, force_open) {
    // create the pane container and behaviour
    var _pane_content = dojo.byId("njs_info_pane_content");
    if (!_pane_content) return;

    var _histo = njs.AppManager.infoItemHistory[this.id];

    if (force_open) {
        _open = true;
    } else {
        if (njs.config.maptips.general_settings.infoboxesAlwaysOpen) _open = true;
        else if (njs.config.maptips.general_settings.infoboxesAlwaysClosed) _open = false;
        else {
            if (_histo != null && typeof _histo != "undefined" && !njs.config.maptips.general_settings.infoboxesOnlyFirstItemOpen) {
                if (_histo) _open = true;
                else _open = false;
            } else if (_pane_content.children.length == length_divs) {
                // check if this is the first info object, then set the info box open
                var _open = true;
            } else var _open = false;
        }
    }

    var tp_content = "<div  id='id_form_" + this.id + "_" + ft_cnt + "' jsId='form_" + this.id + "_" + ft_cnt + "' data-dojo-type='dojox.layout.TableContainer'>";
    var cp_content = [];

    if (content.length > 1) {
        for (var i = 0; i < content.length; i++) {
            cp_content[i] = new dijit.layout.ContentPane({
                title: njs.AppManager.nls.maptipsResources[_txt_id + "_tab" + (i + 1)],
                content: content[i]
            });
        }
        // set height 100% & doLayout=false to TabContainer
        tp_content += '<div class="tabContent" style="width: 100%; height:100%;"><div id="tc_form_' + this.id + '_' + ft_cnt + '" style="padding:10px !important;"></div></div>'; //changed by AGIS: overflow-y raus

    } else tp_content += content[0];

    tp_content += "</div>";

    var tp = new dijit.TitlePane({
        id: "njs_info_title_pane_" + ft_cnt,
        title: item_title,
        content: tp_content,
        open: _open,
        id_maptip: this.id
    });

    var node = document.createElement('div');
    dojo.attr(node, "id", "njs_info_pane_content_" + ft_cnt);

    if (njs.config.maptips.general_settings.permanent_highlight) {
        dojo.attr(node, "onmouseover", 'njs.AppManager.infoFloatWinReplaceHighlite(' + ft_cnt + ',' + this.multiselect + ',"' + this.idmap + '")');

    } else {
        dojo.attr(node, "onmouseout", 'njs.AppManager.infoFloatWinHighlite(' + ft_cnt + ',"normal",' + this.multiselect + ',"' + this.idmap + '")');
        dojo.attr(node, "onmouseover", 'njs.AppManager.infoFloatWinHighlite(' + ft_cnt + ',"highlight",' + this.multiselect + ',"' + this.idmap + '")');
    }

    dojo.place(node, _pane_content, "last");
    dojo.byId("njs_info_pane_content_" + ft_cnt).innerHTML = '';
    dojo.byId("njs_info_pane_content_" + ft_cnt).appendChild(tp.domNode);
    /* set doLayout to false to fix the contentDIV issue in resize .. it will work? */
    if (content.length > 1) {
        var tc = new dijit.layout.TabContainer({
            doLayout: false,
            controllerWidget: 'dijit.layout.TabController',
            tabStrip: false
        }, "tc_form_" + this.id + "_" + ft_cnt);
        tc.startup();
        for (var cp_content_idx in cp_content) {
            tc.addChild(cp_content[cp_content_idx]);
        }
    }
};

njs.MapTip.prototype._loadLookUp = function (i) {
    // get the json from the specified url
    // The context (this object) is passed to the callback with dojo.hitch
    if (this.fldLookup[i].url) {
        var sep = "?";
        var url = this.fldLookup[i].url.replace('#lang#', njs.AppManager.Language);
        if (url.indexOf("?") > -1) sep = "&";
        if (this.fldLookup[i].table != undefined) {
            url += sep + "t=" + escape(this.fldLookup[i].table);
            sep = "&";
        }
        if (this.fldLookup[i].fkey != undefined) {
            url += sep + "k=" + escape(this.fldLookup[i].fkey);
            sep = "&";
        }
        if (this.fldLookup[i].field != undefined) {
            var _fldstr = "";
            if (typeof this.fldLookup[i].field[njs.AppManager.Language] === "string") _fldstr = this.fldLookup[i].field[njs.AppManager.Language];
            else {
                for (var _i = 0; _i < this.fldLookup[i].field[njs.AppManager.Language].length; _i++) {
                    if (_fldstr != "") _fldstr += ",";
                    _fldstr += this.fldLookup[i].field[njs.AppManager.Language][_i];
                }
            }
            url += sep + "f=" + escape(_fldstr);
            sep = "&";
        }
        if (this.fldLookup[i].db != undefined) {
            url += sep + "db=" + escape(this.fldLookup[i].db);
            sep = "&";
        }
        if (this.fldLookup[i].label != undefined) {
            url += sep + "lbl=" + escape(this.fldLookup[i].label);
            sep = "&";
        }
        // If we call a cgi interface (the char ? exists as parameters are passed)
        // no need to prevent cache
        if (sep != "?") var _prevcache = false;
        // If we call a static resource (json), prevent cache and add language param
        else {
            var _prevcache = true;
            url = url.replace('#lang#', njs.AppManager.Language);
        }
        // configure and call the ajax request

        var _syncflag = (this.nocache_lookup === true) ? true : false;
        dojo.xhrGet({
            url: url,
            preventCache: _prevcache,
            handleAs: "json",
            sync: _syncflag,
            load: dojo.hitch(this, function (response) {
                // assign the lookup collection to the objects items
                this.fldLookup[i].items = response;
            }),
            error: function (error) {
                console.log('maptips lookup', error);
            }
        }); // end dojo.xhrGet
    }
};

njs.MapTip.prototype._formatMaptip = function (value, val_fromat, item_name) {

    if (value == "" || value == null) return " ";

    var return_val = "";
    var ar_val_fromat = val_fromat.split("(");
    var pattern = ar_val_fromat[ar_val_fromat.length - 1].substring(0, ar_val_fromat[ar_val_fromat.length - 1].length - 1);
    switch (ar_val_fromat[0]) {
        case "date":
            //see if a source format is given (left of |). if not assume the system
            // understand the format in variable 'value' (case when retrived from postgis/mapserver)
            var source_pattern = "";
            var _date;
            if (pattern.indexOf('|') > -1) {
                var _patterns = pattern.split('|');
                pattern = _patterns[1];
                var _s_year = "";
                var _s_month = "";
                var _s_day = "";
                var _pos_val = 0;
                for (var _i = 0; _i < _patterns[0].length; _i++) {
                    var dp = _patterns[0].charAt(_i);
                    switch (dp) {
                        case "d":
                            _s_day = value.substr(_pos_val, 2);
                            _pos_val += 2;
                            break;
                        case "m":
                            _s_month = value.substr(_pos_val, 2);
                            _pos_val += 2;
                            break;
                        case "y":
                            _s_year = value.substr(_pos_val, 2);
                            _pos_val += 2;
                            break;
                        case "Y":
                            _s_year = value.substr(_pos_val, 4);
                            _pos_val += 4;
                            break;
                        default:
                            _pos_val++;
                            break;
                    }
                }
                _date = new Date(_s_year, parseInt(_s_month) - 1, _s_day);
            } else {
                if (value == '#now#' || value == '#today#') {
                    _date = new Date();
                } else {
                    var a = value.split(/[^0-9]/);
                    if (typeof a[3] == "undefined") {
                        _date = new Date(a[0], a[1] - 1, a[2]);
                    } else {
                        _date = new Date(a[0], a[1] - 1, a[2], a[3], a[4], a[5]);
                    }
                }
            }
            return_val = pattern;

            var _d = _date.getDate().toString();
            _d = (_d.length == 2) ? _d : "0" + _d;
            var _m = (_date.getMonth() + 1).toString();
            _m = (_m.length == 2) ? _m : "0" + _m;
            var _Y = _date.getFullYear().toString();
            var _y = _Y.substring(1, 3)
            var _h = _date.getHours().toString();
            _h = (_h.length == 2) ? _h : "0" + _h;
            var _min = _date.getMinutes().toString();
            _min = (_min.length == 2) ? _min : "0" + _min;
            var _sec = _date.getSeconds().toString();
            _sec = (_sec.length == 2) ? _sec : "0" + _sec;

            return_val = return_val.replace("hh", _h);
            return_val = return_val.replace("mm", _min);
            return_val = return_val.replace("ss", _sec);
            return_val = return_val.replace("d", _d);
            return_val = return_val.replace("m", _m);
            return_val = return_val.replace("Y", _Y);
            return_val = return_val.replace("y", _y);
            break;
        case "num":
        case "centroid_x":
        case "centroid_y":
            if (isNaN(parseFloat(value))) {
                return_val = "";
            } else {
                return_val = parseFloat(value);
                var _patt_array = pattern.split('|');

                var _dec = parseInt(_patt_array[0]);
                if (_dec > 0) return_val = return_val.toFixed(_dec);
                else return_val = return_val.toFixed();

                return_val = return_val.toString();
                var _comma = (_patt_array[1] == "") ? "." : _patt_array[1];
                return_val = return_val.replace(".", _patt_array[1]);
                if (_patt_array[2] != "") {
                    var _nb_arr = return_val.split(_comma);
                    var _cnt = 0;
                    return_val = "";
                    var _pos_nb_start = (_nb_arr[0].charAt(0) != "-") ? 0 : 1;
                    for (var _i = _nb_arr[0].length - 1; _i >= _pos_nb_start; _i--) {
                        _cnt++;
                        return_val = _nb_arr[0].charAt(_i) + "" + return_val;
                        if (_cnt == 3) {
                            if (_i > _pos_nb_start) return_val = _patt_array[2] + return_val;
                            _cnt = 0;
                        }

                    }
                    if (_pos_nb_start == 1) return_val = _nb_arr[0].charAt(0) + "" + return_val;
                    return_val = (_dec > 0) ? return_val + _comma + _nb_arr[1] : return_val;
                }
            }
            break;
        case "form":
            var _form = "";
            var _target = "";
            var _item_name = item_name;
            if (pattern.indexOf('|') > -1) {
                var _patterns = pattern.split('|');
                _form = _patterns[0];
                _target = _patterns[1];
                if (typeof _patterns[2] !== 'undefined') _item_name = _patterns[2];
            } else {
                _form = pattern;
                _target = "_pane";
            }
            var _url = "/mapplus-lib/mapplus-dojo/" + njs.AppManager.Version + "/forms/index.php?" + _item_name + "=" + value + "&form=" + _form + "&folder=" + njs.AppManager.Folder + "&site=" + njs.AppManager.Site + "&uprofile=" + njs.AppManager.uprofile + "&ugroup=" + njs.AppManager.ugroup;

            switch (_target) {
                case "_blank":
                    var _funct = "njs.AppManager.openWinAndFocus('" + _url + "','ext_form_" + this.id + "','" + _url + "','width=900,height=600,location=yes,toolbar=yes');";
                    break;
                case "_pane":
                    var _funct = "njs.AppManager.toggleCustomPaneContent('formedit','custompane','" + _url + "','',true);";
                    break;
            }
            return_val = '<a href="javascript:void(null)" onclick="' + _funct + '">' + value + '</a>';
            break;
        case "boolean":
            if (getBool(value)) {
                if (njs.AppManager.nls.maptipsResources[this.id + "_" + item_name + "_boolean_type_true"]) {
                    return_val = njs.AppManager.nls.maptipsResources[this.id + "_" + item_name + "_boolean_type_true"];
                } else if (njs.AppManager.nls.maptipsResources[this.id + "_boolean_type_true"]) {
                    return_val = njs.AppManager.nls.maptipsResources[this.id + "_boolean_type_true"];
                } else if (njs.AppManager.nls.maptipsResources["general_boolean_type_true"]) {
                    return_val = njs.AppManager.nls.maptipsResources["general_boolean_type_true"];
                } else {
                    return_val = "True";
                }
            } else {
                if (njs.AppManager.nls.maptipsResources[this.id + "_" + item_name + "_boolean_type_false"]) {
                    return_val = njs.AppManager.nls.maptipsResources[this.id + "_" + item_name + "_boolean_type_false"];
                } else if (njs.AppManager.nls.maptipsResources[this.id + "_boolean_type_false"]) {
                    return_val = njs.AppManager.nls.maptipsResources[this.id + "_boolean_type_false"];
                } else if (njs.AppManager.nls.maptipsResources["general_boolean_type_false"]) {
                    return_val = njs.AppManager.nls.maptipsResources["general_boolean_type_false"];
                } else {
                    return_val = "False";
                }
            }

            break;
        default:
            return_val = value;
            break;
    }
    return return_val;

};

njs.MapTip.prototype._concatMaptipAtrtributes = function (cont_str, attr, item_name, qryfld_idx) {
    var _item = "";
    var _str_delimiter = "";
    var _is_const = false;
    var _arr_items = [];
    for (var k = 0; k < cont_str.length; k++) {
        var _chr = cont_str.charAt(k);
        switch (_chr) {
            case "'":
            case '"':
                if (_str_delimiter == "") {
                    _str_delimiter = _chr;
                    _is_const = true
                }
                else if (_str_delimiter == _chr) _str_delimiter = "";
                else _item += "" + _chr;
                break;
            case ",":
                if (_str_delimiter == "") {
                    if (_is_const) {
                        _item = _item.replace(/#lang(?::([^#]+))?#/g, (_, list) => {
                            if (!list) {
                                //simple case: #lang#
                                return njs.AppManager.Language;
                            }

                            //case: #lang:de,it#
                            const langs = list.split(',');
                            const defaultLang = langs[0];

                            return langs.includes(njs.AppManager.Language)
                                ? njs.AppManager.Language
                                : defaultLang;
                        });
                        _item = _item.replace('#user#', njs.AppManager.auth_user).replace('#sid#', njs.AppManager.Guid);
                        var _hasformatidx = -1;
                        if (_item.indexOf(":num(") > -1) _hasformatidx = _item.indexOf(":num(");
                        if (_item.indexOf(":date(") > -1) _hasformatidx = _item.indexOf(":date(");
                        if (_hasformatidx > -1) {
                            // manage lookups when field name to format
                            var _tmp_fld_name = _item.substring(0, _hasformatidx);
                            var _fld_idx = this.qryFields.indexOf(_tmp_fld_name);

                            // check first null placeholder values
                            if (this.qryFieldsNullVal && typeof this.qryFieldsNullVal[qryfld_idx] != 'undefined' && this.qryFieldsNullVal[qryfld_idx] != null && attr[_tmp_fld_name] == this.qryFieldsNullVal[qryfld_idx]) {
                                _item = "";
                            } else {
                                if (typeof this.fldLookup[_fld_idx] != 'undefined') {
                                    // if the lookup collection is empty (value of null), retrive it from the remote source first
                                    if (this.fldLookup[_fld_idx].items == null || this.nocache_lookup === true) {
                                        this._loadLookUp(_fld_idx);
                                    } else if (this.fldLookup[_fld_idx].filterlang === true) {
                                        this.fldLookup[_fld_idx].items = this.fldLookup[_fld_idx].items[njs.AppManager.Language];
                                        this.fldLookup[_fld_idx].filterlang = false;
                                    }
                                    // get the lookup value for this item
                                    if (typeof this.fldLookup[_fld_idx].items != 'undefined' && typeof this.fldLookup[_fld_idx].items[attr[_tmp_fld_name]] != 'undefined') {
                                        _item = this._formatMaptip(this.fldLookup[_fld_idx].items[attr[_tmp_fld_name]], _item.substring(_hasformatidx + 1, _item.length), item_name);
                                    } else {
                                        _item = this._formatMaptip(attr[_tmp_fld_name], _item.substring(_hasformatidx + 1, _item.length), item_name);
                                    }
                                } else {
                                    _item = this._formatMaptip(attr[_tmp_fld_name], _item.substring(_hasformatidx + 1, _item.length), item_name);
                                }
                            }
                        }
                        _arr_items.push(_item);
                    } else {
                        // check first null placeholder values
                        if (this.qryFieldsNullVal && typeof this.qryFieldsNullVal[qryfld_idx] != 'undefined' && this.qryFieldsNullVal[qryfld_idx] != null && attr[_item] == this.qryFieldsNullVal[qryfld_idx]) {
                            _arr_items.push("");
                        } else {
                            var _fld_idx = this.qryFields.indexOf(_item);
                            if (typeof this.fldLookup[_fld_idx] != 'undefined') {
                                // if the lookup collection is empty (value of null), retrive it from the remote source first
                                if (this.fldLookup[_fld_idx].items == null || this.nocache_lookup === true) {
                                    this._loadLookUp(_fld_idx);
                                } else if (this.fldLookup[_fld_idx].filterlang === true) {
                                    this.fldLookup[_fld_idx].items = this.fldLookup[_fld_idx].items[njs.AppManager.Language];
                                    this.fldLookup[_fld_idx].filterlang = false;
                                }

                                // get the lookup value for this item
                                if (typeof this.fldLookup[_fld_idx].items != 'undefined' && typeof this.fldLookup[_fld_idx].items[attr[_item]] != 'undefined') {
                                    _arr_items.push(this.fldLookup[_fld_idx].items[attr[_item]]);
                                } else {
                                    _arr_items.push(attr[_item]);
                                }
                            } else {
                                _arr_items.push(attr[_item]);
                            }
                        }
                    }
                    _item = "";
                    _is_const = false;
                } else _item += "" + _chr;
                break;
            default:
                _item += "" + _chr;
                break;
        }
    }
    if (_item != "") {
        if (_is_const) {
            _item = _item.replace(/#lang(?::([^#]+))?#/g, (_, list) => {
                if (!list) {
                    //simple case: #lang#
                    return njs.AppManager.Language;
                }

                // case: #lang:de,it#
                const langs = list.split(',');
                const defaultLang = langs[0];

                return langs.includes(njs.AppManager.Language)
                    ? njs.AppManager.Language
                    : defaultLang;
            });
            _item = _item.replace('#user#', njs.AppManager.auth_user).replace('#sid#', njs.AppManager.Guid);
            var _hasformatidx = -1;
            if (_item.indexOf(":num(") > -1) _hasformatidx = _item.indexOf(":num(");
            if (_item.indexOf(":date(") > -1) _hasformatidx = _item.indexOf(":date(");
            if (_hasformatidx > -1) {
                // manage lookups when field name to format
                var _tmp_fld_name = _item.substring(0, _hasformatidx);
                var _fld_idx = this.qryFields.indexOf(_tmp_fld_name);

                // check first null placeholder values
                if (this.qryFieldsNullVal && typeof this.qryFieldsNullVal[qryfld_idx] != 'undefined' && this.qryFieldsNullVal[qryfld_idx] != null && attr[_tmp_fld_name] == this.qryFieldsNullVal[qryfld_idx]) {
                    _item = "";
                } else {
                    if (typeof this.fldLookup[_fld_idx] != 'undefined') {
                        // if the lookup collection is empty (value of null), retrive it from the remote source first
                        if (this.fldLookup[_fld_idx].items == null || this.nocache_lookup === true) {
                            this._loadLookUp(_fld_idx);
                        } else if (this.fldLookup[_fld_idx].filterlang === true) {
                            this.fldLookup[_fld_idx].items = this.fldLookup[_fld_idx].items[njs.AppManager.Language];
                            this.fldLookup[_fld_idx].filterlang = false;
                        }
                        // get the lookup value for this item
                        if (typeof this.fldLookup[_fld_idx].items != 'undefined' && typeof this.fldLookup[_fld_idx].items[attr[_tmp_fld_name]] != 'undefined') {
                            _item = this._formatMaptip(this.fldLookup[_fld_idx].items[attr[_tmp_fld_name]], _item.substring(_hasformatidx + 1, _item.length), item_name);
                        } else {
                            _item = this._formatMaptip(attr[_tmp_fld_name], _item.substring(_hasformatidx + 1, _item.length), item_name);
                        }
                    } else {
                        _item = this._formatMaptip(attr[_tmp_fld_name], _item.substring(_hasformatidx + 1, _item.length), item_name);
                    }
                }
            }
            _arr_items.push(_item);
        } else {
            // check first null placeholder values
            if (this.qryFieldsNullVal && typeof this.qryFieldsNullVal[qryfld_idx] != 'undefined' && this.qryFieldsNullVal[qryfld_idx] != null && attr[_item] == this.qryFieldsNullVal[qryfld_idx]) {
                _arr_items.push("");
            } else {
                var _fld_idx = this.qryFields.indexOf(_item);
                if (typeof this.fldLookup[_fld_idx] != 'undefined') {
                    // if the lookup collection is empty (value of null), retrive it from the remote source first
                    if (this.fldLookup[_fld_idx].items == null || this.nocache_lookup === true) {
                        this._loadLookUp(_fld_idx);
                    } else if (this.fldLookup[_fld_idx].filterlang === true) {
                        this.fldLookup[_fld_idx].items = this.fldLookup[_fld_idx].items[njs.AppManager.Language];
                        this.fldLookup[_fld_idx].filterlang = false;
                    }

                    // get the lookup value for this item
                    if (typeof this.fldLookup[_fld_idx].items != 'undefined' && typeof this.fldLookup[_fld_idx].items[attr[_item]] != 'undefined') {
                        _arr_items.push(this.fldLookup[_fld_idx].items[attr[_item]]);
                    } else {
                        _arr_items.push(attr[_item]);
                    }
                } else {
                    _arr_items.push(attr[_item]);
                }
            }
        }
    }

    return _arr_items.join("");
}

/*-------------------------------------------------------------------------------
    method getFeatureAllInfos

    Gets the feature from ajax request and formatted id as defined in the config.
    [object] resp: ajax response

--------------------------------------------------------------------------------*/
njs.MapTip.prototype.getFeatureAllInfos = function (features, length_divs) {
    var ft_cnt = 0;
    var attr = null;
    var content = [];
    var item_title = "";
    var attrib_title = "";
    var ar_item_title = null;
    var tp = null;

    var _new_info_width = 0;
    for (var _feat in features) {
        //set symbol
        //	feature.setSymbol(this.highlightSymbol);
        //	if (!this.multiselect) feature.setSymbol(njs.AppManager.infoFloatNoSymbol);
        // add the highlight feature
        //	this.graphicInfoLyr.add(feature);
        // add the feature to the info features array (which will increment until the window will be closed: reset)
        var ft_cnt = njs.AppManager.infoFloatFeatures.length;
        //	this.last_sel_item[this.last_sel_item.length] = ft_cnt;
        njs.AppManager.infoFloatFeatures[ft_cnt] = null;//{lyr:this.graphicInfoLyr,feat:feature};

        // fcb v4
        //var feat_layer = features[_feat].type;
        var feat_geom = features[_feat].clone().getGeometry();
        //var feat_fid = features[_feat].fid;

        let attr_prop = features[_feat].clone().getProperties();
        const skip_prop = ['boundedBy', 'geom_gml', 'geometry'];
        let attr = {};
        for (var key in attr_prop) {
            if (attr_prop.hasOwnProperty(key) && skip_prop.indexOf(key) == -1) {
                attr[key] = attr_prop[key];
            }
        }

        //if (attr) attr[this.key_attr] = feat_fid;

        // aliases for nls text titles
        var _txt_id = this.id;
        if (this.nls) _txt_id = this.nls;

        // fcb v4
        //if (feat_layer != null) {
        njs.AppManager.infoFloatFeatures[ft_cnt] = {};
        njs.AppManager.infoFloatFeatures[ft_cnt].attr = {};
        njs.AppManager.infoFloatFeatures[ft_cnt].maptip_id = this.id;
        njs.AppManager.infoFloatFeatures[ft_cnt].key_name = this.key_attr;
        njs.AppManager.infoFloatFeatures[ft_cnt].editing_id = null;
        njs.AppManager.infoFloatFeatures[ft_cnt].layer_id = null;

        if (this.linked_editing_id && njs.AppManager.EditingTools[this.linked_editing_id]) {
            njs.AppManager.infoFloatFeatures[ft_cnt].editing_id = this.linked_editing_id;
            njs.AppManager.infoFloatFeatures[ft_cnt].layer_id = this.linked_layer_id
        }

        njs.AppManager.infoFloatFeatures[ft_cnt].attr = attr;

        var _style = njs.AppManager.Maps[this.idmap].getNewOLStyle(this.highLightstyle, feat_geom.getType());

        var _newfeature = new ol.Feature(feat_geom);
        _newfeature.setStyle(_style);

        njs.AppManager.infoFloatFeatures[ft_cnt].geom = [];
        njs.AppManager.infoFloatFeatures[ft_cnt].geom[0] = _newfeature;

        var _graphicInfoLyr = njs.AppManager.getLayerByName(this.idmap, "cosmetic_maptip");
        if (_graphicInfoLyr == null) {
            _graphicInfoLyr = new ol.layer.Vector();
            _graphicInfoLyr.setSource(
                new ol.source.Vector("cosmetic_maptip", {
                    features: []
                })
            );
            _graphicInfoLyr.set('name', 'cosmetic_maptip');
            njs.AppManager.Maps[this.idmap].mapObj.addLayer(_graphicInfoLyr);
        }

        if (_graphicInfoLyr != null) {
            _graphicInfoLyr.getSource().addFeature(njs.AppManager.infoFloatFeatures[ft_cnt].geom[0]);
        }

        var item_title = this.getInfoResultsTitle(ft_cnt, _txt_id);

        // Build here the info content with formats and so on
        content[0] = "<table id='table_" + this.id + "_" + ft_cnt + "' border='0' cellspacing='0' width='100%'>";
        var _tab_content = this.buildInfoResultsTableContent(ft_cnt, content, _txt_id);
        content = _tab_content.content;
        var arr_img_carousels = _tab_content.carousels;
        content[0] += "</table>"; //end of main table

        // Build here the footer content with formats and so on
        content = this.buildInfoResultsFooterContent(ft_cnt, content, _txt_id, 1);

        this.buildInfoResultsTitlePane(ft_cnt, content, _txt_id, null, item_title, true);

        this.buildInfoResultsCarousels(arr_img_carousels);

        //}
    }
    if (_new_info_width > 0 && njs.AppManager.customPane == false) {
        njs.AppManager.infoFloatWin.resize({ w: _new_info_width });
    }
    return '';
};

/*-------------------------------------------------------------------------------
    method processAllInfo

    Process information received by the Ajax response and treat all fields
    even those that have empty value.

    [object] resp: ajax response
--------------------------------------------------------------------------------*/
njs.MapTip.prototype.processAllInfo = function (resp, fid) {
    var features = resp.clone();
    // sets the keyname attribute with the new id returned from server
    features.set(this.key_attr, fid);
    this.showAllInfo([features]);
};

njs.MapTip.prototype.prepareEditingRequest = function () {

    njs.AppManager.infoItemHistory = {};

    if (njs.AppManager.customPane == false) {
        njs.AppManager.InitInfoFloatingWindow(false, this.idmap);

        var _tit = njs.AppManager.nls.maptipsResources["general_title"];

        // should use pane.set('content',content) but doesn't work
        njs.AppManager.infoFloatWin.setTitle("<table border='0' cellpadding='0 cellspacing='0'><tr><td>" + _tit + "</td><td><div id='infowin_wait' class='loading_infowin' style='display:none'></div></td></tr></table>");
        njs.AppManager.infoFloatWin.set("content", "<div id='njs_info_pane_content'></div>");
        njs.AppManager.infoFloatWin.show();
        njs.AppManager.infoFloatWin.bringToTop();
        if (dojo.byId("infowin_wait")) dojo.byId("infowin_wait").style.display = 'block';
        // must reset the specified size because the content can change it
        njs.AppManager.infoFloatWin.resize({ w: njs.AppManager.infoFloatWinWidth, h: njs.AppManager.infoFloatWinHeight });
    } else {
        // maptips are show inside the right contentPane
        if (dojo.byId('njs_info_pane_content') == null) {
            var node = document.createElement('div');
            dojo.attr(node, "id", "njs_info_pane_content");

            var paneTitle = "<div id='flexyPaneTips' style='display:flex'><div id='infowin_wait' class='loading_infowin' style='display:none'></div><div class='infoPaneClose' href='javascript:void(null)' onclick='njs.AppManager.toggleCustomPaneContent(njs.AppManager.customPane.id,njs.AppManager.customPane.pane,\"\",\"\",false);njs.AppManager.infoFloatWinRemoveallItems(\"" + this.idmap + "\");'></div></div>";
            dojo.place(node, dojo.byId(njs.AppManager.customPane.id), "last");
            dojo.place(paneTitle, dojo.byId('njs_info_pane_content'), "first");
            if (dojo.byId("infowin_wait")) dojo.byId("infowin_wait").style.display = 'block';

        } else {
            var widgets = dijit.findWidgets(dojo.byId('njs_info_pane_content'));
            dojo.forEach(widgets, function (w) {
                w.destroyRecursive(false);
            });
            if (dojo.byId("infowin_wait")) dojo.byId("infowin_wait").style.display = 'block';
            if (njs.Layout.saveCustomPaneWidget[njs.AppManager.customPane.pane].status == 'visible') {
                njs.AppManager.centered = true;
            }

        }
        njs.AppManager.toggleCustomPaneContent(njs.AppManager.customPane.id, njs.AppManager.customPane.pane, '', '', true);
    }

    var _graphicInfoLyr = njs.AppManager.getLayerByName(this.idmap, "cosmetic_maptip");
    if (_graphicInfoLyr != null) _graphicInfoLyr.getSource().clear();
    njs.AppManager.infoFloatFeatures = [];

};

njs.MapTip.prototype._clickfiledownload = function (item, params) {
    var url = this.documentsDownloadFields[item].cgi.indexOf('?') == -1 ? this.documentsDownloadFields[item].cgi + "?" : this.documentsDownloadFields[item].cgi + "&";
    url += "params=" + escape(params) + "&cmd=1";
    if (this.documentsDownloadFields[item].dbconn_id_docs) url += "&dbconn_id_docs=" + this.documentsDownloadFields[item].dbconn_id_docs;

    window.open(url, "_blank");

}

njs.MapTip.prototype.openCustomForm = function (ft_cnt, modal, target = false) {
    var params = "";

    if (this.external_form.field) {
        var _sep = (this.external_form.url.indexOf("?") == -1) ? "?" : "&";
        if (njs.AppManager.infoFloatFeatures[ft_cnt] && njs.AppManager.infoFloatFeatures[ft_cnt].attr) {
            for (var item in this.external_form.field) {
                if (njs.AppManager.infoFloatFeatures[ft_cnt].attr[this.external_form.field[item]]) {
                    params += _sep + this.external_form.field[item] + "=" + njs.AppManager.infoFloatFeatures[ft_cnt].attr[this.external_form.field[item]];
                    _sep = "&";
                }
            }
        }
    }

    // site and app params
    params += _sep + "folder=" + njs.AppManager.Folder + "&site=" + njs.AppManager.Site + "&uprofile=" + njs.AppManager.uprofile + "&ugroup=" + njs.AppManager.ugroup;

    // if a modal parameter is passed, the form will open it by default
    if (modal != null && typeof modal != "undefined") params += "&modalopen=" + modal;

    // check option forces opening form readonly only for view (assumes opening form for editing modifiying the geometry - other button)
    if (typeof this.external_form.info_form_readonly != "undefined" && this.external_form.info_form_readonly != null && this.external_form.info_form_readonly == 1) {
        params += "&forcereadonly=1";
    }

    if (this.external_form.external_url) {
        njs.AppManager.toggleCustomPaneContent("formedit", "custompane", this.external_form.url + njs.AppManager.infoFloatFeatures[ft_cnt].attr[this.external_form.field[item]], "", true);
        if (njs.AppManager.infoFloatWin != null && njs.AppManager.isMobile) njs.AppManager.infoFloatWin.hide();
        return;
    }
    if (!target) target = this.external_form.target;
    switch (target) {
        case "_new":
            //window.open(this.external_form.url+params,"ext_form_" + this.id,'location=no,width=200');
            njs.AppManager.openWinAndFocus(this.external_form.url + params, "ext_form_" + this.id, 'width=900,height=600,location=yes,toolbar=yes');
            break;
        case "_blank":
            njs.AppManager.openWinAndFocus(this.external_form.url + params, "_blank" + this.id, 'width=900,height=600,location=yes,toolbar=yes');
            break;
        default:
            njs.AppManager.toggleCustomPaneContent("formedit", "custompane", this.external_form.url + params, "", true);
            if (njs.AppManager.infoFloatWin != null && njs.AppManager.isMobile) njs.AppManager.infoFloatWin.hide();
            break;
    }
}

njs.MapTip.prototype.openPdfReport = function (ft_cnt, lang = false) {

    var params = "";

    var _sep = (this.pdf_report.url.indexOf("?") == -1) ? "?" : "&";
    if (njs.AppManager.infoFloatFeatures[ft_cnt] && njs.AppManager.infoFloatFeatures[ft_cnt].attr) {
        if (njs.AppManager.infoFloatFeatures[ft_cnt].attr[this.pdf_report.id_field]) {
            params += _sep + "id=" + njs.AppManager.infoFloatFeatures[ft_cnt].attr[this.pdf_report.id_field];
            _sep = "&";
        }
    }
    params += _sep + "folder=" + njs.AppManager.Folder + "&site=" + njs.AppManager.Site + "&uprofile=" + njs.AppManager.uprofile + "&ugroup=" + njs.AppManager.ugroup;
    if (lang) params += "&lang=" + lang;
    njs.AppManager.openWinAndFocus(this.pdf_report.url + params, "_blank");
}




//#region wmsserviceMaptip

/*-------------------------------------------------------------------------------
    wms MapTip Object: inherits from the Tool class

    Will handle the filtering of features directly and dynamically in the map

    [object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.MapTip.wmsServiceMapTip = function (maptip_id, options) {

    // [int] : id of the tool
    this.id = null;

    this.id = maptip_id;
    this.external_container = null;
    this.table = null;

    // initialisation' work
    if (options) {
        this.Init(options);
    }
};
njs.MapTip.wmsServiceMapTip.prototype = new njs.MapTip;
njs.MapTip.wmsServiceMapTip.prototype.constructor = njs.MapTip.wmsServiceMapTip;
njs.MapTip.wmsServiceMapTip.superclass = njs.MapTip.prototype;

/*-------------------------------------------------------------------------------
    method Init

    Initialisation's work

    [object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.MapTip.wmsServiceMapTip.prototype.Init = function (options) {

    njs.MapTip.wmsServiceMapTip.superclass.Init.call(this, options);

    this.idmap = options.idmap;
    this.wms_layer = null;
    this.url = options.url ? options.url : null;
    this.linked_layer_id = options.linked_layer ? options.linked_layer : null;
    this.minResolution = options.minResolution ? options.minResolution : null;
    this.maxResolution = options.maxResolution ? options.maxResolution : null;
    this.linked_basemap = options.linked_basemap ? options.linked_basemap : null;
    this.qryFields = options.qryFields ? options.qryFields : null;
    this.key_attr = options.key_attr ? options.key_attr : null;
    this.dbconn_id = options.dbconn_id ? options.dbconn_id : null;
    this.table = options.table ? options.table : null;
    /* DERPRECIATED SEE IF WORKFLOW IS STIL NEEDED ?*/
    this.external_form_url = options.external_form_url ? options.external_form_url : njs.AppManager.uprofile + '/guis/forms.php';
    this.external_container = options.external_container ? options.external_container : null;
    /* - end depreciated- */
    this.form_info = options.form_info ? options.form_info : null;
    this.maxFeatures = options.maxFeatures ? options.maxFeatures : 10;
    this.proxy = options.proxy ? options.proxy : false;
    this.replace_query_layers_name = options.replace_query_layers_name ? options.replace_query_layers_name : null;
    
    for (let i = 0; i < this.qryFields.length; i++) {
        this.qryFields[i] = this.qryFields[i].replace(/#lang#/gi, (match) => {
            const lang = njs.AppManager.Language;

            if (match === match.toUpperCase()) {
                // #LANG#
                return lang.toUpperCase();
            } else if (match[1] === match[1].toUpperCase()) {
                // #Lang#
                return lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase();
            } else {
                // #lang#
                return lang.toLowerCase();
            }
        });
    }

    //this.texts= options.texts ? options.texts : null;

    this.params = options.params ? options.params : null;
    this.options = options.options ? options.options : null;
   
    this.query_layers = options.query_layers ?? null;
    
    this.query_layers_alias = options.query_layers_alias ? options.query_layers_alias : null;

    this.wms_proj = options.wms_proj ? options.wms_proj : null;

    if (this.linked_basemap != null) {
        if (typeof this.linked_basemap === 'string') {
            this.linked_basemap = [this.linked_basemap];
        }
    }
};

njs.MapTip.wmsServiceMapTip.prototype.Activate = function () {
    var that = this;

    this.connector_type = "_wms_connector";

    if (njs.AppManager.infoWMSListener == null) {
        njs.AppManager.infoWMSListener = njs.AppManager.Maps[this.idmap].mapObj.on('singleclick', njs.AppManager.infoWMSHandler.bind(that));
    }

    //if (this.params!=null && typeof this.params != "undefined") {
    if (this.url != null && typeof this.url != "undefined") {
        if (this.params == null) {
            this.params = {
                layers: "",
                format: "image/png",
                transparent: true
            };
            this.options = {
                singleTile: true,
                sphericalMercator: false,
                projection: this.wms_proj,
                isBaseLayer: false,
                opacity: 1
            };
        }

        let olSourceType;
        if (this.querytype == "esrigeojson") {
            olSourceType = ol.source.ImageArcGISRest;
        } else {
            olSourceType = ol.source.ImageWMS;
        }
        this.wms_layer = new ol.layer.Image({
            source: new olSourceType({
                url: this.url,
                ratio: 1.0,
                params: this.params
            })
        });
        this.wms_layer.set('name', this.id);
        this.wms_layer.setProperties(this.options);
    }

    if (this.minResolution || this.maxResolution) {
        // Handling the ZoomEnd behaviour
        this.attachZoomEndListner(njs.AppManager.Maps[that.idmap].mapObj, true, function (e) {
            njs.AppManager.Maps[that.idmap].mapObj.once('moveend', function (e) {
                that.zoomEndCallback(e);
            });
        });
        // handle basemap activation if any at starting time (the map could be zommed at the beginning)
        if (that.linked_basemap) {
            that.zoomEndCallback(null);
        }
    }

    if (that.linked_layer_id) {
        njs.AppManager.Maps[that.idmap].mapObj.getLayers().on('add', function (evt) {
            if (evt.element.getProperties().name == that.linked_layer_id) {
                that.addLayerCallback(evt);
            }
        });

        njs.AppManager.Maps[that.idmap].mapObj.getLayers().on('remove', function (evt) {
            if (evt.element.getProperties().name == that.linked_layer_id) {
                that.removeLayerCallback(evt);
            }

        });
    }
};

njs.MapTip.wmsServiceMapTip.prototype.queryconnector = function (evt) {
    let that = this;

    var layer;
    if (this.wms_layer != null) {
        layer = { _lyr: this.wms_layer, options: {} };
    } else {
        layer = njs.AppManager.getLayerByMap(this.idmap, this.linked_layer_id);
        if (!layer.options) layer.options = {};
    }

    /* V4.0 TO BE CONTROLLED - handle the case when the layer name must be forced - see olWMSGetFetaureinfo.js */
    if (this.replace_query_layers_name != null) {
        layer._lyr.set('replace_query_layers_name', this.replace_query_layers_name);
        if (layer._lyr.getSource().getUrl().indexOf("flyrunique=") == -1) {
            var _new_url = layer._lyr.getSource().getUrl();
            if (_new_url.indexOf('?') == -1) _new_url += "?";
            else _new_url += "&";
            _new_url += "flyrunique=" + layer.name + "&";
            layer._lyr.getSource().setUrl(_new_url);
        }
    }

    let url_query;
    const view_resol = njs.AppManager.Maps[this.idmap].mapObj.getView().getResolution();
    const view_proj = njs.AppManager.Maps[this.idmap].mapObj.getView().getProjection();
    var _sr;
    var _radius;
    var qry_params;
    var info_format = null;
    switch (this.querytype) {
        case "swissadmingeojson":
            let mapExtent = njs.AppManager.Maps[this.idmap].mapObj.getView().calculateExtent().toString();
            let size = njs.AppManager.Maps[this.idmap].mapObj.getSize();
            let imageDisplay = size[0] + "," + size[1] + ",96"
            _sr = view_proj.getCode() ? view_proj.getCode().replace("EPSG:", "") : "2056";
            _radius = view_resol * this.tolerance;
            url_query = "https://api3.geo.admin.ch/rest/services/ech/MapServer/identify";           
            url_query += this.queryurl ? this.queryurl : "?layers=all:"+ this.query_layers + "&";           
            qry_params = "returnGeometry=true&lang=" + njs.AppManager.Language + "&tolerance=10&geometryType=esriGeometryPoint&mapExtent=" + mapExtent + "&imageDisplay=" + imageDisplay + "&sr=" + _sr + "&geometry=" + evt.coordinate[0] + "," + evt.coordinate[1]+"&";
            qry_params += new URLSearchParams(this.params).toString();
            url_query += qry_params;
            break;
        case "esrigeojson":
            _sr = view_proj.getCode() ? view_proj.getCode().replace("EPSG:", "") : "2056";
            _radius = view_resol * this.tolerance;
            url_query = layer._lyr.getSource().getUrl()+"/"+this.query_layers+"/query?";           
            qry_params = "f=json&returnGeometry=true&spatialRel=esriSpatialRelIntersects&geometryType=esriGeometryPoint&outFields=*&inSR=" + _sr + "&outSR=" + _sr + "&geometry=" + encodeURIComponent(evt.coordinate[0] + ',' + evt.coordinate[1]) + "&units=esriSRUnit_Meter&distance=" + _radius;
            url_query += qry_params;
            break;
        default:
            info_format = layer._lyr.getSource().getParams().INFO_FORMAT || layer._lyr.getSource().getParams().info_format || 'application/vnd.ogc.gml';
            url_query = layer._lyr.getSource().getFeatureInfoUrl(
                evt.coordinate,
                view_resol,
                view_proj,
                {
                    'INFO_FORMAT': info_format,
                    'QUERY_LAYERS': this.query_layers.split(','),
                    'FEATURE_COUNT': this.maxFeatures ? this.maxFeatures : 10
                }
            );
            break;

    }

    if (url_query) {
        njs.AppManager.infoRequestsPending++;

        if (njs.config.maptips.general_settings.proxy && this.proxy == true) {
            var pattern = /^[a-zA-Z]+:\/\/.*$/;
            if (pattern.test(url_query.toString()) || url_query.toString().indexOf('//') == 0) {
                url_query = njs.config.maptips.general_settings.proxy + encodeURIComponent(url_query);
            }
        }
        fetch(url_query)
            .then((response) => response.text())
            .then((txt) => { that._queryconnector(txt, info_format); })
            .catch((err) => { console.error(err); }
            );
    }

};

njs.MapTip.wmsServiceMapTip.prototype._queryconnector = function (txt, info_format = null) {
    var that = this;

    let allFeatures = null;
    try {
        if (this.querytype == "esrigeojson") {
            allFeatures = new ol.format.EsriJSON().readFeatures(txt);
        } else if (this.querytype == "swissadmingeojson") {
            var jsonData = JSON.parse(txt);
            const esriJsonFeature = {
                "features": jsonData.results.map(item => ({
                    "geometry": item.geometry,
                    "attributes": {} // Gli attributi verranno aggiunti dopo
                }))
            };
            allFeatures = new ol.format.EsriJSON().readFeatures(esriJsonFeature);
            jsonData.results.forEach((item, index) => {
                allFeatures[index].setProperties(item.attributes);
            });
        } else {
            switch (info_format) {
                case 'application/geo+json':
                case 'application/geojson':    
                    allFeatures = new ol.format.GeoJSON().readFeatures(txt);
                    break;
                case 'text/xml; subtype=gml/3.2.1':                  
                    allFeatures = new ol.format.GML().readFeatures(txt);
                    break;
                default:
                    allFeatures = new ol.format.WMSGetFeatureInfo().readFeatures(txt);
                    
            }

        }
    } catch (err) {
        //console.error(error);
        console.error("Maptip " + that.id + ": FeatureInfo Response cannot be parsed correctly. Skip this feature");
        console.error(err.stack);
        console.log("Feature:", txt);
    }
    // HINT - puo essere utilizzato se ci saranno problemi di aliases sui layers ritornati dalla chiamata
    // when specifying the 'layers' options, only the features of those
    // layers are returned by the format
    //const restaurantFeatures = new ol.format.WMSGetFeatureInfo({layers: ['restaurants']}).readFeatures(txt);

    njs.AppManager.infoRequestsPending--;

    if (!allFeatures || allFeatures.length == 0) {
        if (njs.AppManager.infoRequestsPending == 0) {
            var _length_divs = that.getLengthDivs();
            njs.AppManager.terminateInfoRequest(that.idmap, _length_divs);
        }
    } else {
        if (njs.AppManager.customPane) {
            njs.AppManager.toggleCustomPaneContent(njs.AppManager.customPane.id, njs.AppManager.customPane.pane, '', '', true);
            if (njs.AppManager.centered == false) {
                var geompoint = [njs.AppManager.infoXYCoords[0], njs.AppManager.infoXYCoords[1]];
                var resol = njs.AppManager.Maps[that.idmap].mapObj.getView().getResolution();
                var zoomlevel = njs.AppManager.Maps[that.idmap].mapObj.getView().getZoomForResolution(resol);
                njs.AppManager.Maps[that.idmap].centerAndZoom(geompoint, zoomlevel, false);
            }
            njs.AppManager.centered = true;
        }
        if (that.external_container == null || that.form_info) {
            that.showInfo(allFeatures);
        } else {
            that.showInfoExternal(allFeatures, that.external_container, that.form_info);
        }


    }

};

//#endregion

//#region geojsonMaptip

/*-------------------------------------------------------------------------------
    wms MapTip Object: inherits from the Tool class

    Will handle the filtering of features directly and dynamically in the map

    [object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.MapTip.gjsonServiceMapTip = function (maptip_id, options) {

    // [int] : id of the tool
    this.id = null;

    this.id = maptip_id;

    this.dbconn_id;
    this.key_attr;
    this.mouseover = false;
    // initialisation' work
    if (options) {
        this.Init(options);
    }
};
njs.MapTip.gjsonServiceMapTip.prototype = new njs.MapTip;
njs.MapTip.gjsonServiceMapTip.prototype.constructor = njs.MapTip.gjsonServiceMapTip;
njs.MapTip.gjsonServiceMapTip.superclass = njs.MapTip.prototype;

/*-------------------------------------------------------------------------------
    method Init

    Initialisation's work

    [object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.MapTip.gjsonServiceMapTip.prototype.Init = function (options) {

    njs.MapTip.gjsonServiceMapTip.superclass.Init.call(this, options);

    this.idmap = options.idmap;
    this.wms_layer = null;
    this.url = options.url ? options.url : null;
    this.linked_layer_id = options.linked_layer ? options.linked_layer : null;
    this.minResolution = options.minResolution ? options.minResolution : null;
    this.maxResolution = options.maxResolution ? options.maxResolution : null;
    this.linked_basemap = options.linked_basemap ? options.linked_basemap : null;
    this.qryFields = options.qryFields ? options.qryFields : null;
    this.more_link = options.more_link ? options.more_link : false;
    
    for (let i = 0; i < this.qryFields.length; i++) {
        this.qryFields[i] = this.qryFields[i].replace(/#lang#/gi, (match) => {
            const lang = njs.AppManager.Language;

            if (match === match.toUpperCase()) {
                // #LANG#
                return lang.toUpperCase();
            } else if (match[1] === match[1].toUpperCase()) {
                // #Lang#
                return lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase();
            } else {
                // #lang#
                return lang.toLowerCase();
            }
        });
    }

    //this.texts= options.texts ? options.texts : null;

    this.params = options.params ? options.params : null;
    this.options = options.options ? options.options : null;

    // fc: this.id cannot be used as id for the query layers as the data are retrived from the
    // database and the query_layers param means here the table which has to be queried
    this.query_layers = options.query_layers ? options.query_layers : null;
    this.query_layers_alias = options.query_layers_alias ? options.query_layers_alias : null;

    //this.query_layers = this.id;

    this.key_attr = options.key_attr;
    this.dbconn_id = options.dbconn_id;
    this.mouseover = options.mouseover ? options.mouseover : false;
    this.connector_type = null;

    if (this.linked_basemap != null) {
        if (typeof this.linked_basemap === 'string') {
            this.linked_basemap = [this.linked_basemap];
        }
    }
};

njs.MapTip.gjsonServiceMapTip.prototype.Activate = function () {
    var that = this;

    if (njs.AppManager.infoGeoJsonListener == null) {
        njs.AppManager.infoPopupContainer = document.getElementById('popup');
        njs.AppManager.infoPopupContent = document.getElementById('popup-content');
        njs.AppManager.infoPopupCloser = document.getElementById('popup-closer');

        njs.AppManager.infoOverlay = new ol.Overlay({
            element: njs.AppManager.infoPopupContainer,
            autoPan: true,
            autoPanAnimation: {
                duration: 250
            }
        });
        njs.AppManager.Maps[this.idmap].mapObj.addOverlay(njs.AppManager.infoOverlay);

        njs.AppManager.infoPopupCloser.onclick = function () {
            njs.AppManager.infoOverlay.setPosition(undefined);
            njs.AppManager.infoPopupCloser.blur();
            return false;
        };
        // let lyr = njs.AppManager.getLayerByName(this.idmap,this.linked_layer_id);
        // lyr.set('qryFields',this.qryFields);
        // lyr.set('htmlTemplate',this.htmlTemplate);        
        njs.AppManager.infoGeoJsonListener = njs.AppManager.Maps[this.idmap].mapObj.on('singleclick', njs.AppManager.infoGeoJsonHandler.bind(that));
    }
};

njs.MapTip.gjsonServiceMapTip.prototype.queryconnector = function (evt) {
};

njs.MapTip.gjsonServiceMapTip.prototype.showInfoBubble = function (feature) {
    var prop = feature.getProperties();
    if (this.htmlTemplate) {
        njs.AppManager.infoPopupContent.innerHTML = this.htmlTemplate.toString();
        for (var f = 0; f < this.qryFields.length; f++) {
            let _val = prop[this.qryFields[f]];
            njs.AppManager.infoPopupContent.innerHTML = njs.AppManager.infoPopupContent.innerHTML.replace('%' + this.qryFields[f] + '%', _val);
        }
    }
}

//#endregion


//#region geojsongetfeatureinfo

njs.MapTip.gjsonGetFeatureInfo = function (options) {

    // [int] : id of the tool
    this.id = null;

    // [string] : njs Map Object's id
    this.idmap = null;
    this.layers = "";
    this._arLayers = [];
    this.control = null;
    this.lookupCallbacks = {};
    this.requests_completed = true;
    this.proxy = null;
    this.itemHistory = {};

    // initialisation' work
    if (options) {
        this.Init(options);
    }
};

/*-------------------------------------------------------------------------------
    method Init

    Initialisation's work

    [object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.MapTip.gjsonGetFeatureInfo.prototype.Init = function (options) {

    this.idmap = options.idmap;
    this.id = options.id;
    //this.url = options.url;
    this.click = options.click ? options.click : true;
    this.hover = options.hover ? options.hover : false;
    this.delay = options.delay ? options.delay : 200;
    this.proxy = options.proxy ? options.proxy : null;
    this.layers = "";
    this._arLayers = [];
    this.lookupCallbacks = {};
    this.requests_completed = true;
    this.itemHistory = {};
    this.selectedFeature = null; //rba20130701
    this._modifycontrol = null; //rba20130206

};

njs.MapTip.gjsonGetFeatureInfo.prototype.Activate = function (layer_name) {

};
//#endregion

//# sourceURL=mapplus://maptips.js
