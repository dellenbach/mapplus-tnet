/* global njs */
/* global dojo */
/* global dijit */
/* global moment */
/* global Sortable */
/* jslint node: true */
"use strict";

/*-------------------------------------------------------------------------------
	LayerMgr.ClassicLayerMgr Class

	Class creating a tabbed layers manager with categories like in Mapplus.
	[id]	: object's unique id
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerMgr = function (id, options) {

    /* properties */
    this.id = id;
    this.arLayers = [];
    this.arBMap = [];
    this.targetMap = options.targetMap;
    this.useRemoveHighlight = false;
    this.switchLyrChkBoxAndName = false;
    this.arCategories = []; // [njs.LayerMgr.ClassicLayerCategory] array of layer category's objects populated by the addCategory/removeCategory
    this.arExternalLays = [];
    this.arLoadingLays = [];
    this.mod_sortlayers = null;
    this.statemanager_cgi = null;
    this.startLayersOverride = false;   
    this.open_list = false; 
    this.hasStartLayers = false;       
    this._nb_lyr_cnt = 0;
    this.type = "ClassicLayerMgr";
    if (options) {
        this.Init(options);
    }
};

njs.LayerMgr.ClassicLayerMgr.prototype = new njs.LayerMgr();
njs.LayerMgr.ClassicLayerMgr.prototype.constructor = njs.LayerMgr.ClassicLayerMgr;
njs.LayerMgr.ClassicLayerMgr.superclass = njs.LayerMgr.prototype;

/*-------------------------------------------------------------------------------
	method Init
	Initialisation's work
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerMgr.prototype.Init = function (options) {
    this._nb_lyr_cnt = 0;
    
    if (options.useRemoveHighlight) this.useRemoveHighlight = options.useRemoveHighlight;
    else this.useRemoveHighlight = false;

    if (options.switchLyrChkBoxAndName) this.switchLyrChkBoxAndName = options.switchLyrChkBoxAndName;
    else this.switchLyrChkBoxAndName = false;

    if (!njs.AppManager.isMobile)
        this.mod_sortlayers = options.mod_sortlayers ? options.mod_sortlayers : null;
    else
        this.mod_sortlayers = null;

    this.statemanager_cgi = options.statemanager_cgi ? options.statemanager_cgi : null;

    this.startLayersOverride = options.startLayersOverride != null ? options.startLayersOverride : this.startLayersOverride;
 
    if (this.startLayersOverride) {
        this.hasStartLayers = !!(njs.AppManager.StartParams && typeof njs.AppManager.StartParams.layers !== "undefined");
        //console.debug("hasStartLayers: " + this.hasStartLayers);
    }
    options.hasStartLayers = this.hasStartLayers;

    if (options.structure && typeof options.structure !== "undefined") {
        var _cnt=0;
        var _new_structure = {};
        
        for (var idparentcat in options.structure){
            // add the base maps manager embedded into the layer manager from the 
            if (_cnt==0 && options.basemaps_embedded && !njs.AppManager.isMobile){
                var items = [];
                for (var _targetmap in options.targetMap){
                    var _map = njs.config.basisMaps[options.targetMap[_targetmap]];
                    if (_map!=null && typeof _map != 'undefined'){
                        for (var _bmap in _map.basisMaps){
                            if (!_map.basisMaps.hasOwnProperty(_bmap)) continue; //ignore disabled base maps (still referenced for projections serialization purpose)
                            if (_map.basisMaps[_bmap].hasOwnProperty("enabled") && !_map.basisMaps[_bmap].enabled) continue;
                            if (items.indexOf(_bmap)==-1) items.push(_bmap);
                        }
                    }
                }
                
               var _basemaps_cat = {
                    "baselayers_embedded":{
                        "open": true,
                        "drawtype": "radio",
                        "selectAll": false,
                        "items": items
                    }
                };

                options.structure[idparentcat].items = Object.assign(_basemaps_cat, options.structure[idparentcat].items);
               
            }
            options.structure[idparentcat].id = idparentcat;
            this.addCategoryRecursive(options.structure[idparentcat], options, this.arCategories);
            _cnt++;
        }

    } else {
        for (var lyr in options.layers){
            var lay = options.layers[lyr];
        
            if (lay.legend && typeof lay.legend !== "undefined") {
                var legText = options.leg_texts[lay.legend + "_print"];
                var _printlegend = !(legText != null && typeof legText !== "undefined" && legText === false);
                lay.legend = {
                    "link": options.leg_texts[lay.legend + "_link"],
                    "title": options.leg_texts[lay.legend + "_title"],
                    "print": _printlegend,
                    "extern": lay.legend_extern
                };
            }
            lay.description = options.texts["desc_" + lay.name];
            lay.targetMap = options.targetMap;
            lay.id_lyr_mgr = this.id;

            //var _edit_idx = dojo.indexOf(options.edit_lays.lays, lay.id);
            var _edit_idx = dojo.indexOf(options.edit_lays.lays, lay.name);
            if (_edit_idx > -1) lay.editing = options.edit_lays.ids[_edit_idx];

            var className = lyr.type;
            var olayer = new njs.Layers[className](lyr.name,lyr);
        
            this.arLayers.push(olayer);
        }
   }
};

njs.LayerMgr.ClassicLayerMgr.prototype.addCategoryRecursive = function (category, options, _tmpObj) {
    var _opts = category;
    if (typeof _opts.nls!='undefined' && _opts.nls!=null)_opts.id = _opts.nls;     
    _opts.description = options.texts["desc_" + _opts.id];
    _opts.tt_legend = options.leg_texts.tt_open_clic;
    _opts.tt_layers = options.texts.tt_layers_clic;
    _opts.id_lyr_mgr = this.id;
    _opts.hasStartLayers = options.hasStartLayers;
	_opts.tools = options.texts["tool_"+_opts.tool];

    var item = new njs.LayerMgr.ClassicLayerCategory(_opts);

    if (Array.isArray(category.items)){
        // layers
        for (var i = 0; i < category.items.length; i++) {
            
            var _lyr = options.layers[category.items[i]];
            if (category.id=="baselayers_embedded"){
                item.addBaseMap(category.items[i]);
            } else if (category.items[i].name) {
                // multi-layer layer
                _lyr = {
                        id: category.items[i],
                        childs: category.items[i].items[l]
                };
                //item.addGroupedLayer(_lyr);
                for (var l = 0; l < category.items[i].items.length; l++) {
                    var _sublyr = options.layers[category.items[i].items[l]];
		    if (typeof _sublyr!="undefined"){
	                    _sublyr.group_layer=category.items[i];
	                    this.createLayerItem(category.items[i].items[l],_sublyr,options);
	                    item.addLayer(_sublyr); 
		    }
                } 
            } else if (_lyr) {
                this.createLayerItem(category.items[i],_lyr,options);
                item.addLayer(_lyr);
            } 
        }
    } else {
        // categories
        for (var icat in category.items){

            var _cat = category.items[icat];

            _cat.id = icat;

            if (_cat.legend && typeof _cat.legend !== "undefined") {
                var _lgd;
                if (typeof _cat.legend.title !== "undefined" && _cat.legend.title !== '') {
                    _lgd = _cat.legend;
                } else {

                    var _printlegend = true;
                    if (options.leg_texts[_cat.legend + "_print"] != null && typeof options.leg_texts[_cat.legend + "_print"] !== "undefined") {
                        if (options.leg_texts[_cat.legend + "_print"] === false) _printlegend = false;
                    }
                    _lgd = {
                        "link": options.leg_texts[_cat.legend + "_link"],
                        "title": options.leg_texts[_cat.legend + "_title"],
                        "print": _printlegend,
                        "extern": _cat.legend_extern
                    };
                }
                _cat.legend = _lgd;
            }
            
            if (_cat.tool && typeof _cat.tool!='undefined'){
                var _tools = {
                    "link" : options.texts["tool_"+_cat.tool+"_link"]
                };
                _cat.tool = _tools;
            }

            _cat.description = options.texts["desc_" + _cat.id];
                

            this.addCategoryRecursive(_cat, options, item.arCategories);
        }
    }
    
    _tmpObj.push(item);
};

njs.LayerMgr.ClassicLayerMgr.prototype.refreshDrawingsCombos = function () {
        this.arCategories.forEach(function (cat) {
            cat.refreshDrawingsCombos();
        });
};

njs.LayerMgr.ClassicLayerMgr.prototype.createLayerItem = function (id,_lyr,options) {
    // retrocompatibility - tbcl
    _lyr.id = id;
    _lyr.name = id;
    var _printlegend = true;
    if (options.leg_texts[_lyr.legend + "_print"] != null && typeof options.leg_texts[_lyr.legend + "_print"] !== "undefined") {
    if (options.leg_texts[_lyr.legend + "_print"] === false) _printlegend = false;
    }

    if (_lyr.legend && typeof _lyr.legend !== "undefined") {
    _lyr.legend = {
        "link": options.leg_texts[_lyr.legend + "_link"],
        "title": options.leg_texts[_lyr.legend + "_title"],
        "print": _printlegend,
        "extern": _lyr.legend_extern
    };

    }
    //_lyr["description"]=options.texts["desc_"+_lyr.id];
    if (options.texts["desc_" + _lyr.name]) _lyr.description = options.texts["desc_" + _lyr.name];
    else _lyr.description = _lyr.name;

    //var _edit_idx = dojo.indexOf(options.edit_lays.lays, _lyr.id);
    var _edit_idx = dojo.indexOf(options.edit_lays.lays, _lyr.name);
    if (_edit_idx > -1) _lyr.editing = options.edit_lays.ids[_edit_idx];

    _lyr.tt_legend = options.leg_texts.tt_open_clic;
    _lyr.tt_layers = options.texts.tt_layers_clic;
    _lyr.targetMap = options.targetMap;
    _lyr.id_lyr_mgr = this.id;
};


/*-------------------------------------------------------------------------------
	method Activate
	Activates the search element
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerMgr.prototype.Activate = function () {
    var that = this;
    // ** temporary workarround for tooltips, because dojo bug #16909
    var _ttips = {};

    if (this.arCategories.length > 1) {
        var _start_with_sel_tab = null;
        var tc_opts = {
            id: this.id,
            style: "width:100%"
        };
        if (njs.Layout.MenuPane.type === "freepane" && njs.Layout.MenuPane.collapsible) {
            tc_opts.doLayout = false;
        }
        var _iconeclass_active_flag = false;
        var tc = new dijit.layout.TabContainer(tc_opts, "njs_" + this.id + "_wrapper");

        this.arCategories.forEach(function (cat) {
            // ** temporary workarround for tooltips, because dojo bug #16909
            if (cat.description != null && typeof cat.description !== "undefined") {
                _ttips[cat.iconClass] = cat.description;
            }

            var _opts = {id: that.id + "_cp_" + cat.id, tooltip: cat.description};
            if (cat.iconClass != null && typeof cat.iconClass !== "undefined" && cat.iconClass !== "") {
                _opts.iconClass = "dijitEditorIcon " + cat.iconClass;
            } else {
                _opts.title = cat.description;
            }
            if (cat.iconClassActive != null && typeof cat.iconClassActive !== "undefined" && cat.iconClassActive !== "")
                _iconeclass_active_flag = true;

            var n = new dijit.layout.ContentPane(_opts);
            tc.addChild(n);
            cat._build(that.id + "_cp_" + cat.id, null);
            if (njs.AppManager.StartParams.theme && njs.AppManager.StartParams.theme == cat.id) {
                _start_with_sel_tab = n;
                njs.AppManager.currentTheme = njs.AppManager.StartParams.theme;
            }
        });

        tc.startup();
        if (_start_with_sel_tab) tc.selectChild(_start_with_sel_tab);

        // handle the change of selected  icon in the tab container
        if (_iconeclass_active_flag) {
            this.arCategories.forEach(function (cat) {
                if (tc.selectedChildWidget.id == that.id + "_cp_" + cat.id) {
                    if (cat.iconClassActive != null && typeof cat.iconClassActive !== "undefined" && cat.iconClassActive !== "") {
                        dijit.byId(that.id + "_tablist_" + that.id + "_cp_" + cat.id).iconNode.className = "dijitInline dijitIcon dijitTabButtonIcon dijitEditorIcon " + cat.iconClassActive;
                    }
                }
            });
            this._onTabContainerClick = dojo.connect(tc, "onClick", this, function (evt) {
                that.arCategories.forEach(function(cat) {
                    if (tc.selectedChildWidget.id == that.id + "_cp_" + cat.id) {
                        if (cat.iconClassActive != null && typeof cat.iconClassActive !== "undefined" && cat.iconClassActive !== "") {
                            //evt.target.className = "dijitInline dijitIcon dijitTabButtonIcon dijitEditorIcon " + cat.iconClassActive;
                            dijit.byId(that.id + "_tablist_" + that.id + "_cp_" + cat.id).iconNode.className = "dijitInline dijitIcon dijitTabButtonIcon dijitEditorIcon " + cat.iconClassActive;
                        }
                    } else {
                        dijit.byId(that.id + "_tablist_" + that.id + "_cp_" + cat.id).iconNode.className = "dijitInline dijitIcon dijitTabButtonIcon dijitEditorIcon " + cat.iconClass;
                    }
                });
            });
        }

        // ** temporary workarround for tooltips, because dojo bug #16909
        require(["dojo/dom-class", "dojo/query"], function (domClass, query) {
            query(".dijitIcon").forEach(function (node) {
                if (domClass.contains(node, "dijitTabButtonIcon dijitEditorIcon")) {
                    for (var _icon in _ttips) {
                        if (domClass.contains(node, _icon) || domClass.contains(node, _icon + "_active")) {
                            node.setAttribute("title", _ttips[_icon]);
                        }
                    }
                }
            });
        });
    } else if (this.arCategories.length==1) {
        this.arCategories[0]._build("njs_" + this.id + "_wrapper", null);
    }

    // manage subtheme, aka the title panes open or closed
    if (njs.AppManager.StartParams.subtheme && njs.AppManager.StartParams.subtheme !== "") {
        njs.AppManager.currentSubTheme = njs.AppManager.StartParams.subtheme;
        var _subtheme_arr = njs.AppManager.currentSubTheme.split(',');
        let theme=njs.AppManager.StartParams.theme;     
        if (theme!=null){
            var _container_id = this.id + "_cp_" + theme;
            var pane = dijit.byId(_container_id);            
            if (typeof pane !== 'undefined') {
                let container = pane.getParent();
                container.getParent().getParent().set('open', true);
                // switch to the form pane but with some litle delay in order to see the selected object for a litle while
                container.selectChild(pane);                
                // trigger the onclick event for container: handles the highlite of the tabs if any
                require(["dojo/on"], function(on) {
                    on.emit(container.domNode, "click", {});
                });
            }    
        }
        this.openTPs(_subtheme_arr, theme);
    }

    // must be done first, before the handling of the other layers
    this.targetMap.forEach(function (mapname) {
        var map = njs.AppManager.Maps[mapname];
        if (map.mask_layer != null) {
            var lyr = map.mask_layer;
            lyr.id_lyr_mgr = that.id; 

            var className = lyr.type;
            map.mask_layer_obj = new njs.Layers[className](lyr.name,lyr);
            var _lyr = map.mask_layer_obj._lyr;
            if (njs.AppManager.getLayerIndexByName(mapname, 'mask_layer')==null) map.mapObj.addLayer(_lyr);
        }
    });

    // reload the accordeon container after building the layermanager
    var _acc = dijit.byId("freePaneAccordeon");
    if (_acc != null && typeof _acc !== "undefined") _acc.layout();
    else {
        var _lyrmgr_widget = dijit.byId("main_lyrmgr");
        if (_lyrmgr_widget != null && typeof _lyrmgr_widget !== "undefined") _lyrmgr_widget.resize();
    }

    this.switchLayersProgr(njs.AppManager.StartParams.layers, njs.AppManager.StartParams.op, true);

    if (this.mod_sortlayers != null) {
        this.updateSortLyrMod();
    }
	// hack solving the full height display problem when the pane is closed at start time
    if (njs.AppManager.isMobile) {
        //cam v4.0
        //njs.AppManager.toggleCustomPaneContent('leftpane','leftPane',null,'');
        //njs.AppManager.toggleCustomPaneContent('leftpane','leftPane',null,'');
    }
};

njs.LayerMgr.ClassicLayerMgr.prototype.switchLayersProgr = function (lays, opacity, status) {
    var that = this;
    var _start_lyrs_arr = null;
    var _start_opacity_arr = null;
    // startparameters: must be handeled after sortable object initialisation (if any)
    if (lays && lays !== "") {
            _start_lyrs_arr = lays.split('|');
        }
    if (opacity && opacity !== "") {
            _start_opacity_arr = opacity.split('|');
    }

    var _logged_layers = [];
    var lobjs = this.getAllLayerObjs();   
    if (_start_lyrs_arr != null && typeof _start_lyrs_arr !== "undefined") {
        
        for (var i = 0; i < _start_lyrs_arr.length; i++) {
            if (_start_lyrs_arr[i].indexOf('-wi') === 0) {
                if (njs.AppManager.getLayerByMap(this.targetMap[0],_start_lyrs_arr[i]) == null){
                    this.retriveExternalLayer(_start_lyrs_arr[i]);
                } else {
                    continue;
                }
            }else if(typeof lobjs[_start_lyrs_arr[i]] == 'undefined' || lobjs[_start_lyrs_arr[i]] == null){
                continue;
            }
            this.switchLayer(_start_lyrs_arr[i], true);

            var _lyr = this.getLayerById(_start_lyrs_arr[i]);
            if (_lyr && _start_opacity_arr != null) {
                var _opacity = _start_opacity_arr[i];
                _opacity=parseFloat(_opacity);
                _lyr.opacity = _opacity;
                _lyr._lyr.setOpacity(_opacity);
                           }
            if (_lyr && _lyr.logging===1) {
                njs.AppManager.logUserLayer(_lyr.name);
                _logged_layers.push(_lyr.name);
            }

        }

    }
    var _switched_layer = false;
    // switch the default layers on
    
    for (var l in lobjs) {
        if (!lobjs.hasOwnProperty(l)) continue;
        var lobj = lobjs[l];
        if (!that.hasStartLayers && lobj.start_visible == 1) {
            if (lobj.logging===1 && _logged_layers.indexOf(lobj.name)==-1) {
			njs.AppManager.logUserLayer(lobj.name);
			_logged_layers.push(lobj.name);
		}
            this.switchLayer(lobj.name, true);
            _switched_layer = true;
        }
    }

    // check if a start parameter has been requested for the search options
    // and this object was not ready on time
    if (njs.AppManager.StartParams.post_switch_layon && njs.AppManager.StartParams.post_switch_layon !== "") {
        
        var _lyr=this.getLayerById(njs.AppManager.StartParams.post_switch_layon);
        if (_lyr && _lyr.logging===1 &&  _logged_layers.indexOf(_lyr.name)==-1) {
            njs.AppManager.logUserLayer(_lyr.name);
            _logged_layers.push(_lyr.name);
        }

        this.switchLayer(njs.AppManager.StartParams.post_switch_layon, true);
        njs.AppManager.StartParams.post_switch_layon = "";
        _switched_layer = true;
    }

    if (_start_opacity_arr != null || _switched_layer) {
        if (njs.AppManager.Tools.TrackBookmark) {
            njs.AppManager.updateMapStatusUrl(this.targetMap[0]);
        }
    }
};



njs.LayerMgr.ClassicLayerMgr.prototype._getLayerByIdRecursive = function (categories, id) {
    var layer = null;
    for (var i = 0; i < categories.length; i++) {
        var lays = categories[i].arLayers;
        for (var j = 0; j < lays.length; j++) {
            //if (lays[j].id==id) {
            if (lays[j].name == id) {
                return lays[j];
            }
        }
        layer = this._getLayerByIdRecursive(categories[i].arCategories, id);
        if (layer != null) return layer; 
    }
    return layer;
};

njs.LayerMgr.ClassicLayerMgr.prototype.getLayerById = function (id) {
    // loop the layers defined in the layer manager
    var lyr = this._getLayerByIdRecursive(this.arCategories, id);

    // if none found, try in the external layers loaded by the user
    if (lyr == null || typeof lyr == "undefined") {
        for (var i = 0; i < this.arExternalLays.length; i++) {
            if (this.arExternalLays[i].name == id) {
                return this.arExternalLays[i];
            }
        }
    }
    return lyr;
};

/*-------------------------------------------------------------------------------
	method _getCategoryById
	extract a given group definition from the given group array
	[string] id: searched id
	[object array] lays: array of the groups definitions in which to search

	return: group definition object
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerMgr.prototype._getCategoryById = function (id, cat, texts, leg_texts) {
    for (var i = 0; i < cat.length; i++) {
        if (cat[i].id == id) {
            var _cat = cat[i];
            if (_cat.legend && typeof _cat.legend !== "undefined") {
                var _lgd;
                if (typeof _cat.legend.title !== "undefined" && _cat.legend.title !== '') {
                    _lgd = _cat.legend;
                } else {

                    var _printlegend = true;
                    if (leg_texts[_cat.legend + "_print"] != null && typeof leg_texts[_cat.legend + "_print"] !== "undefined") {
                        if (leg_texts[_cat.legend + "_print"] === false) _printlegend = false;
                    }
                    _lgd = {
                        "link": leg_texts[_cat.legend + "_link"],
                        "title": leg_texts[_cat.legend + "_title"],
                        "print": _printlegend,
                        "extern": _cat.legend_extern
                    };
                }
                _cat.legend = _lgd;
            }
            
	if (_cat.tool && typeof _cat.tool!='undefined'){
		var _tools = {
			"link" : texts["tool_"+_cat.tool+"_link"]
		};
		_cat.tool = _tools;
	}

	_cat.description = texts["desc_" + _cat.id];
            return _cat;
            break;
        }
    }
    return null;
};

/*-------------------------------------------------------------------------------
	method getAllLayerObjs

--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerMgr.prototype.getAllLayerObjs = function () {
    var obj_layers = {};
    // loop the layers defined in the layer manager
    this._getLayersByCategories(this.arCategories, obj_layers);
  
    // then the external layers loaded by the user

    this.arExternalLays.forEach(function (extlay) {
        obj_layers[extlay.name] = extlay;
    });
    return obj_layers;
};

njs.LayerMgr.ClassicLayerMgr.prototype._getLayersByCategories = function (categories, obj_layers) {
    var that = this;
    categories.forEach(function (cat) {
        cat.arLayers.forEach(function (lay) {
            obj_layers[lay.name] = lay;
        });
        that._getLayersByCategories(cat.arCategories, obj_layers);
    });
};

/*-------------------------------------------------------------------------------
	method getAllVisibleLayers

--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerMgr.prototype.getAllVisibleLayers = function (excludeLayersNotInZoomVisible) {
    excludeLayersNotInZoomVisible = excludeLayersNotInZoomVisible || false;  //if true, return only layers, which are visible in current zoomlevel
    var arr_layers = [];
    // loop the layers defined in the layer manager
    this._getLayersByVisibility(this.arCategories, arr_layers, true, false, excludeLayersNotInZoomVisible);
    // then the external layers loaded by the user which are visible
    this.arExternalLays.forEach(function (extlay) {
        if (extlay.visible) arr_layers.push(extlay);
    });
    // sort the response in order to take in account the rank of the layer
    arr_layers.sort(function (a, b) {
        var rank_a = parseFloat(a.rank);
        var rank_b = parseFloat(b.rank);

        if (rank_a == 1 || a.timestamp != null) {
            rank_a = a.timestamp;
        }
        if (rank_b == 1 || b.timestamp != null) {
            rank_b = b.timestamp;
        }
        return rank_b - rank_a;
    });
    arr_layers.reverse();

    return arr_layers;
};

njs.LayerMgr.ClassicLayerMgr.prototype._getLayersByVisibility = function (categories, arr_layers, visible, nonvisible, excludeLayersNotInZoomVisible) {
    var that = this;
    categories.forEach(function (cat) {
        cat.arLayers.forEach(function (lay) {
            if (excludeLayersNotInZoomVisible && !lay.current_zoomvisible) return;
            if (visible && lay.visible) arr_layers.push(lay);
            if (nonvisible && !lay.visible) arr_layers.push(lay);
        });
        that._getLayersByVisibility(cat.arCategories, arr_layers, visible, nonvisible, excludeLayersNotInZoomVisible);
    });
};

/*-------------------------------------------------------------------------------
	method switchCategory

	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerMgr.prototype.switchCategory = function () {

};

njs.LayerMgr.ClassicLayerMgr.prototype.handlechangesortlist = function (event) {
    var changed_layer = event.item.id;

    if (changed_layer) {
        var ar_neworder = this.sortable.toArray();
        var ar_idx = ar_neworder.indexOf(changed_layer);

        //var _lyr = njs.AppManager.Maps[this.targetMap[0]].mapObj.getLayersByName(changed_layer)[0];
        //var _lyr_idx= njs.AppManager.Maps[this.targetMap[0]].mapObj.getLayerIndex(_lyr);
        var _lyr =  njs.AppManager.getLayerByName(this.targetMap[0],changed_layer);        
        var _lyr_idx = njs.AppManager.getLayerIndexByName(this.targetMap[0],changed_layer);
        
        var _ref_lyr;
        var _ref_lyr_idx;
        var _new_lyr_idx;
        if (ar_idx === 0) {
            // if the concerned layer is on the first place, take the second layer as reference (then the indexes are set differently)
            //_ref_lyr = njs.AppManager.Maps[this.targetMap[0]].mapObj.getLayersByName(ar_neworder[ar_idx + 1])[0];
            //_ref_lyr_idx = njs.AppManager.Maps[this.targetMap[0]].mapObj.getLayerIndex(_ref_lyr);
            _ref_lyr_idx = njs.AppManager.getLayerIndexByName(this.targetMap[0],ar_neworder[ar_idx + 1]);

            if (_lyr_idx < _ref_lyr_idx) _new_lyr_idx = _ref_lyr_idx;
            else _new_lyr_idx = _ref_lyr_idx + 1; // this case never happens
        } else {
            //_ref_lyr = njs.AppManager.Maps[this.targetMap[0]].mapObj.getLayersByName(ar_neworder[ar_idx - 1])[0];
            //_ref_lyr_idx = njs.AppManager.Maps[this.targetMap[0]].mapObj.getLayerIndex(_ref_lyr);
            _ref_lyr_idx = njs.AppManager.getLayerIndexByName(this.targetMap[0],ar_neworder[ar_idx - 1]);

            // control if the layer is moved upward or downward. It changes the handling of the indexes
            // as the function setLayerIndex seems to remove the concerned layer before building the index tree
            if (_lyr_idx < _ref_lyr_idx) _new_lyr_idx = _ref_lyr_idx - 1;
            else _new_lyr_idx = _ref_lyr_idx;
        }
        njs.AppManager.Maps[this.targetMap[0]].mapObj.removeLayer(_lyr);
        njs.AppManager.Maps[this.targetMap[0]].mapObj.getLayers().insertAt(_new_lyr_idx,_lyr)

        var timestamp = Math.round(+new Date()); //the + sign triggers "valueOf" then gets timestamp
	// we wants to go downward
        for (var i = ar_neworder.length - 1; i >= 0; i--) {
            //var lyr = this.getLayerById(ar_neworder[i]);
            var lyr = njs.AppManager.getLayerByMap(this.targetMap[0],ar_neworder[i]);
            lyr.timestamp = timestamp;
            timestamp++;
        }

        // if module track bookmark then update the url, because of the layer order
        if (njs.AppManager.Tools.TrackBookmark) {
            njs.AppManager.updateMapStatusUrl(this.targetMap[0]);
        }
    } else {
        console.error("can't retrive changed layer name");
    }
};

/*-------------------------------------------------------------------------------
	method updateSortLyrMod
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerMgr.prototype.updateSortLyrMod = function () {
    var that = this;
    var widgets = dijit.findWidgets(dojo.byId('main_lyrsorter'));
    dojo.forEach(widgets, function (w) {
        w.destroyRecursive(false);
    });

    if (this.sortable) {
        this.sortable.destroy();
    }

    // get the visible layers (sorted by rank) if not yet retrived
    //var vislay = this.getAllVisibleLayers();
    var vislay = njs.AppManager.getVisibleLayersByMap(this.targetMap[0]);

    var _txt = dojo.byId("main_lyrsorter_txt");
    if (_txt) {
        _txt.style.display = vislay.length === 0 ? "block" : "none";
    }
    var txt = "";

    for (var i = vislay.length - 1; i >= 0; i--) {
        var _rangeclass = "";
        var _desc = vislay[i].description.replace(/<a\b[^>]*>(.*?)<\/a>/i, '');

        var lyr_mgr_id= njs.AppManager.getLayerManagerByLayer(this.targetMap[0],vislay[i].name).id;

        if (!vislay[i].current_zoomvisible) _rangeclass = "notinrange";
        txt += "<li id='" + vislay[i].name + "' class='sortable_li'><span class='sortable_handle'></span>";
        txt += "<span class='sortable_slider'>";
        txt += "<input type='range' min='0' max='1' step='0.01' value='" + (1 - parseFloat(vislay[i].opacity)) + "' id='slider_" + vislay[i].name + "'  onchange=\"njs.AppManager.LyrMgr['" + lyr_mgr_id + "'].setLayOpacity('" + vislay[i].name + "',this.value)\" oninput=\"njs.AppManager.LyrMgr['" + lyr_mgr_id + "'].setLayOpacity('" + vislay[i].name + "',this.value)\">";
        txt += "<span id='sort_lyr_" + vislay[i].name + "' class='unselectable sortable_label " + _rangeclass + "'>" + _desc + "</span></span>";
        txt += "<span class='sortable_close'  onclick=\"njs.AppManager.LyrMgr['" + lyr_mgr_id + "'].switchLayer('" + vislay[i].name + "',false)\"></span></li>";
    }
    dojo.byId('main_lyrsorter').innerHTML = txt;
   
    try {
	    this.sortable = new Sortable(main_lyrsorter, {      //TODO: variable not defined -> maybe string?
            dataIdAttr: 'id',
            animation: 150,
            handle: ".sortable_handle",
            onSort: function (evt) {
                that.handlechangesortlist(evt);
            }
        });
    }
    catch(err) {
        this.sortable=null;
    }


    // version with params in url: limited by the size of the string passed as parameters
    //dojo.byId("njs_main_lyrsorter_wrapper").src=this.mod_sortlayers.cgi+"?l="+escape(_serie);

    // submit a post via form, this manage many layers names in a long string
    // doesen't work with loop calls as the form is not loaded any more for a while
    /*var ifrm_sortable = dojo.byId("njs_main_lyrsorter_wrapper");
    var ifrm_sortable_doc = ifrm_sortable.contentDocument || ifrm_sortable.contentWindow.document;
    var iput_sortable = ifrm_sortable_doc.getElementById("lays");
    iput_sortable.value=_serie;
    var form_sortable = ifrm_sortable_doc.getElementById("submitnewlays");
    form_sortable.submit();
    */

    dojo.parser.parse(dojo.byId('main_lyrsorter'));
};

njs.LayerMgr.ClassicLayerMgr.prototype.setLayOpacity = function (lyr, value) {

    var _lyr = this.getLayerById(lyr);
    var _opacity = 1 - Math.round(value * 10) / 10;
    _lyr.opacity = _opacity;
    _lyr._lyr.setOpacity(_opacity);   
    // if module track bookmark then update the url, because of the layer order
    if (njs.AppManager.Tools.TrackBookmark) {
        njs.AppManager.updateMapStatusUrl(this.targetMap[0]);
    }
};

/*-------------------------------------------------------------------------------
	method switchLayer

	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerMgr.prototype.switchLayer = function (layer_src, status) {
    var lobjs = this.getAllLayerObjs();
    if (typeof lobjs[layer_src] != 'undefined' && lobjs[layer_src] != null &&
        dijit.byId(layer_src) && dijit.byId(layer_src).get('checked') != status) {
        this.arCategories.forEach(function (cat) {
            cat.switchLayer(layer_src, status);
        });
        if (dijit.byId(layer_src)) dijit.byId(layer_src).set('checked', status);
        //if modoule sortlayers load the new layer order
        if (this.mod_sortlayers != null) this.updateSortLyrMod();
    }

    // then the external layers loaded by the user which are visible
    for (var i = 0; i < this.arExternalLays.length; i++) {
        if (this.arExternalLays[i].name == layer_src) {
            this.arExternalLays[i].switchLayer(status);
            if (this.mod_sortlayers != null) this.updateSortLyrMod();
            break;
        }
    }
    // if module track bookmark then update the url
    if (njs.AppManager.Tools.TrackBookmark) {
        njs.AppManager.updateMapStatusUrl(this.targetMap[0]);
    }
};


njs.LayerMgr.ClassicLayerMgr.prototype.toggleLayer = function (layer_src){
    var _lyr = this.getLayerById(layer_src);
    this.switchLayer(layer_src,!_lyr.visible);
}

/*-------------------------------------------------------------------------------
	method deselectAll
	Deselect all current layers
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerMgr.prototype.deselectAll = function () {
    //loop all the layers: in root without categories
    this.arLayers.forEach(function (lay) {
        lay.switchLayer(false);
        if (dijit.byId(lay.name)) dijit.byId(lay.name).set('checked', false);
    });
    //loop all the layers: in the categories
    this.arCategories.forEach(function (cat) {
        cat.deselectAll();
    });
    //then the external layers loaded by the user which are visible
    this.arExternalLays.forEach(function (extlay) {
        extlay.switchLayer(false);
    });

    //if modoule sortlayers load the new layer order
    if (this.mod_sortlayers != null) this.updateSortLyrMod();
    // if module track bookmark then update the url
    if (njs.AppManager.Tools.TrackBookmark) {
        njs.AppManager.currentSubTheme=null;
        njs.AppManager.currentTheme=null;
        njs.AppManager.updateMapStatusUrl(this.targetMap[0]);
    }
};

/*-------------------------------------------------------------------------------
	method addExternalLayer
	[object] options: options defining the layer
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerMgr.prototype.addExternalLayer = function (opts) { 
    var className = opts["type"];
    var olayer  = new njs.Layers[className](opts.name,opts);
    this.arExternalLays.push(olayer);
};

/*-------------------------------------------------------------------------------
	method storeExternalLayer
	[string] id of the stored layer
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerMgr.prototype.storeExternalLayer = function (id, lyr_opts) {
    var that = this;
    require(['dojo/_base/json'], function (dojo) {
        // convert it to a string:
        var data = dojo.toJson(lyr_opts);

        require(["dojo/request/xhr"], function (xhr) {
            xhr(that.statemanager_cgi.url + "?id=" + id + "&dbconn_id=" + that.statemanager_cgi.dbconn_id + "&action=putWMS", {
                handleAs: "json", sync: false, preventCache: true, method: "POST",
                data: {"wms": data}
            }).then(function (data) {
            }, function (err) {
                // Handle the error condition
                console.error("Error saving wms into db: %o", err);
            });
        });
    });
};

/*-------------------------------------------------------------------------------
	method retriveExternalLayer
	[string] id of the stored layer
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerMgr.prototype.retriveExternalLayer = function (id) {
    var that = this;

    require(["dojo/request/xhr"], function (xhr) {
        // must be syncrone
        xhr(that.statemanager_cgi.url + "?id=" + id + "&dbconn_id=" + that.statemanager_cgi.dbconn_id + "&action=getWMS", {
            handleAs: "json", sync: true, preventCache: true, method: "GET"
        }).then(function (data) {
            if (data==null) {
                console.info("WMS with id: %o not found", id);
                return;
            }
            var _opts = data;
            _opts.targetMap = that.targetMap;
            _opts.id_lyr_mgr = that.id;

            if (_opts.maptip_ops) {
                if (njs.AppManager.MapTips[_opts.id] == null || typeof njs.AppManager.MapTips[_opts.id] === "undefined") {
                    if (!njs.AppManager.nls.maptipsResources) njs.AppManager.maptipsResources = {};
                    njs.AppManager.nls.maptipsResources[_opts.id + "_title"] = _opts.description;

                    njs.AppManager.MapTips[_opts.id] = new njs.MapTip.wmsServiceMapTip(_opts.id, _opts.maptip_ops);
                    njs.AppManager.MapTips[_opts.id].Activate();
                }
            }

            if (_opts.error){
                console.error(_opts.error);
            } else {
                that.addExternalLayer(_opts);
            }

            //that.switchLayer(id,true);

        }, function (err) {
            // Handle the error condition
            console.error("Error retriving wms from db: %o", err);
        });
    });
};

/*-------------------------------------------------------------------------------
	method disableAll
	Disable all current layers
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerMgr.prototype.disableAll = function () {
    this.arCategories.forEach(function (cat) {
        cat.disableAll();
    });
};

/*-------------------------------------------------------------------------------
	method enabletAll
	Enable all current layers
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerMgr.prototype.enableAll = function () {
    this.arCategories.forEach(function (cat) {
        cat.enableAll();
    });
};

njs.LayerMgr.ClassicLayerMgr.prototype.openTPs = function (items, maincat) {
    //loop all the layers: in the categories
    this.arCategories.forEach(function (cat) {
        cat.openTPs(items, maincat);
    });
};

njs.LayerMgr.ClassicLayerMgr.prototype.updateLayerCallParams = function (item,values) {
	var updated_layers = [];
	for(var _layr in this.arLayers) {
		if(this.arLayers[_layr].widget){
			if (this.arLayers[_layr].widget.addparam){
				var _ar_params = [];
				for (var i=0;i<this.arLayers[_layr].widget.addparam.length;i++){
					if (this.arLayers[_layr].widget.addparam[i].source==item){
						_ar_params.push(this.arLayers[_layr].widget.addparam[i].param);
					}
				}
				if (_ar_params.length>0) {
					this.arLayers[_layr].updateLayerSource(_ar_params,values);
					var _lyr_url = (this.arLayers[_layr].type == "WMS") ? this.arLayers[_layr]._lyr.url : this.arLayers[_layr]._lyr.protocol.options.url;
					var _lay_obj = {id:this.arLayers[_layr].id,url:_lyr_url};
					updated_layers.push(_lay_obj);
				}
			}
		}
	}

	for (var _cats in this.arCategories) {
		var _updated_layers = this.arCategories[_cats].updateLayerCallParams(item,values);
		updated_layers = updated_layers.concat(_updated_layers);
	}

	if (njs.AppManager.Maps[this.targetMap]._storeCoverLayer && njs.AppManager.Maps[this.targetMap]._storeCoverLayerWidget){
		var _custlay = njs.AppManager.Maps[this.targetMap]._storeCoverLayerWidget;
		if (_custlay.widget.addparam){
			var _ar_params = [];
			for (var i=0;i<_custlay.widget.addparam.length;i++){
				if (_custlay.widget.addparam[i].source==item){
					_ar_params.push(_custlay.widget.addparam[i].param);
				}
			}	
			if (_ar_params.length>0){

				var _sep="";
				//if (_custlay.base_url){
				if (njs.AppManager.Maps[this.targetMap]._storeCoverLayer.url){
					var _base_url = njs.AppManager.Maps[this.targetMap]._storeCoverLayer.url.toString();

					for (var i=0;i<_ar_params.length;i++){
						var _start = _base_url.indexOf(_ar_params[i]+"=");
						var _end = _base_url.indexOf("&",_start);

						var _newitem = _ar_params[i]+"=";
						if (typeof values!="string") _newitem += values.join("|");
						else  _newitem += values;

						if (_start==-1){
							if (_base_url.indexOf('?')==-1) _base_url += "?";
							else _base_url += "&";
							_base_url +=_newitem;
						} else {
							if (_end==-1) _end = _base_url.length;
							_base_url = _base_url.substring(0,_start)+_newitem+_base_url.substring(_end,_base_url.length);
						}
					}

					var linked_maptip;
					var arr_qry_lays;
					var arr_qry_lays_alias = [];
					for (var mt in njs.AppManager.MapTips){
						if (njs.AppManager.MapTips[mt].linked_layer_id && njs.AppManager.MapTips[mt].linked_layer_id==njs.AppManager.Maps[this.targetMap]._storeCoverLayer.name){
							linked_maptip=njs.AppManager.MapTips[mt];
							var arr_qry_lays = linked_maptip.query_layers.split(',');
							var arr_qry_lays_alias = [];
							if (linked_maptip.query_layers_alias) arr_qry_lays_alias = linked_maptip.query_layers_alias.split(',');
							break;
						}

					} 

					if (linked_maptip && njs.AppManager.MapTips._wms_connector){
						for (var map in this.targetMap) {
							if (njs.AppManager.MapTips._wms_connector[this.targetMap[map]].lookupCallbacks){
								var lkups = njs.AppManager.MapTips._wms_connector[this.targetMap[map]].lookupCallbacks;
								var _tobedeleted = [];
								for (var lkup in lkups){
									var _id = lkup.split("~");

									for (var i=0;i<arr_qry_lays.length;i++) {
                                        var arr_layname = [];
                                        if (arr_qry_lays_alias[i] && arr_qry_lays_alias[i] != ""){
                                            // supports multiple alias names as multi geometry layers in mapserver are split in three layers (point, line,polygon)
                                            var _aliases = arr_qry_lays_alias[i].split("|");
                                            for (var _a in _aliases){
                                                arr_layname.push(_aliases[_a].toLowerCase().replace(/[^\w]/gi, '_'));
                                            }
                                        } else {
                                            arr_layname.push(arr_qry_lays[i].toLowerCase().replace(/[^\w]/gi, '_'));
                                        }
                                        for (var aln in arr_layname){
                                            if (njs.AppManager.Maps[this.targetMap]._storeCoverLayer.url.toString() + "~" + arr_layname[aln] == lkup){
                                                    var _new_id = _base_url + "~" + _id[1];
                                                    lkups[_new_id]=[];
                        
                                                    for (var ilk = 0; ilk<lkups[lkup].length; ilk++){
                                                        lkups[_new_id].push(lkups[lkup][ilk]);
                                                    }
                                                    
                                                    _tobedeleted.push(lkup);
                                            }
                                        }
									}
								}

								for (var lkup in lkups){
									if (_tobedeleted.indexOf(lkup)>-1)	delete lkups[lkup];
								}
							}
						}
					}
					

					njs.AppManager.Maps[this.targetMap]._storeCoverLayer.setUrl(_base_url);
					var _lay_obj = {id:njs.AppManager.Maps[this.targetMap]._storeCoverLayer.name,url:njs.AppManager.Maps[this.targetMap]._storeCoverLayer.url};
					updated_layers.push(_lay_obj);
					//updated_layers.push(njs.AppManager.Maps[this.targetMap]._storeCoverLayer.url);

					//if (njs.AppManager.Maps[this.targetMap]._storeCoverLayer.visible){
						if (njs.AppManager.Maps[this.targetMap]._storeCoverLayer.CLASS_NAME != 'OpenLayers.Layer.WMS') njs.AppManager.Maps[this.targetMap]._storeCoverLayer.refresh({force:true});
						else {
							// redraw() function works only when object refernced by getLayersByName() form OL map
							// Better solution as switching on/off the wms layer changing the timestamp
							for (var map in this.targetMap) {
								var _map = this.targetMap[map];
								var _lyr = njs.AppManager.Maps[_map].mapObj.getLayersByName(njs.AppManager.Maps[this.targetMap]._storeCoverLayer.name);
								
								if (_lyr.length>0) _lyr[0].redraw(true);
							}
						}
					//}
				}
				
			}
		}
	}
	return updated_layers;
};

njs.LayerMgr.ClassicLayerMgr.prototype.changeBaseMap = function (cat,bmap) {
   
    var arr_basemaps = this._getBaseMapRecursive(this.arCategories, bmap, cat);
    
    for (var i in arr_basemaps){
        
        if (arr_basemaps[i].name==bmap){
            dojo.addClass("bmapmgr_" + arr_basemaps[i].name,'active');
            for (var map_obj in arr_basemaps[i].targetMap){
                njs.AppManager.Maps[arr_basemaps[i].targetMap[map_obj]].changeBaseMap(arr_basemaps[i].name);
            }
        } else {
            dojo.removeClass("bmapmgr_" + arr_basemaps[i].name, "active");
        }
    }
};
njs.LayerMgr.ClassicLayerMgr.prototype._getBaseMapRecursive = function (categories, bmap, bmapcat) {
    var arr_basemaps = null;
    for (var i = 0; i < categories.length; i++) {
        var bmaps = categories[i].arBMap;
        for (var j = 0; j < bmaps.length; j++) {
            if (bmaps[j].name == bmap && categories[i].id==bmapcat) {
                return bmaps;
            }
        }
        arr_basemaps = this._getBaseMapRecursive(categories[i].arCategories, bmap, bmapcat);
        if (arr_basemaps != null) return arr_basemaps; 
    }
    return arr_basemaps;
};

/*-------------------------------------------------------------------------------
	LayerMgr.ClassicLayerCategory Class
	Base ClassicLayerCategory class.
	[integer]	id: object's unique id
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerCategory = function (options) {

    /* properties */
    this.id = null;		// category's unique id
    this.icon = null;	// icon to use in the layer manager tabs
    this.iconClass = null;
    this.iconClassActive = null;
    this.open = false;
    this.rank = 1;		// category's rank in the layer manager tabs
    this.tooltip = null;	// category's tab
    this.name = null;	// category's name
    this.legend = null;	// category's legend definition
    this.EditableLayer = null; // layer that is currently editable
    this.arLayers = []; // array of layer's objects populated by the addCategory/removeCategory
    this.arBMap = [];
    this.drawType = 'checkbox';
    this.selectAll = true;
    this.useRemoveHighlight = false;
    this.tt_legend = null;
    this.tt_layers = null;
    this.id_lyr_mgr = "";
    this.arCategories = [];
    this.restricted = false;    //added by AGIS
    this.hasStartLayers = false;    //added by AGIS
    this.drawings_combos = [];
    this.drawings_combos_lays = [];
    if (options) {
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
njs.LayerMgr.ClassicLayerCategory.prototype.Init = function (options) {
    this.checkBox = [];
    this.checkEditBox = [];
    this.checkBoxAll = null;

    if (options) {
        this.id = options.id;
        this.id_lyr_mgr = options.id_lyr_mgr;
        this.icon = options.icon;
        this.open = options.open;
        this.rank = options.rank;
        this.description = options.description;
        this.name = options.name;
        this.legend = options.legend ? options.legend : null;
	this.tool = options.tool ? options.tool : null;
        this.iconClass = options.iconClass;
        this.iconClassActive = options.iconClassActive;
        this.restricted = options.restricted || false;  //added by AGIS
        this.hasStartLayers = options.hasStartLayers || false;    //added by AGIS
        this.useRemoveHighlight = options.useRemoveHighlight ? options.useRemoveHighlight : false;
        if (options.drawtype !== '') this.drawType = options.drawtype;
        if (options.selectAll === false) this.selectAll = false;

        this.tt_legend = options.tt_legend;
        this.tt_layers = options.tt_layers;
        
    }
};

/*-------------------------------------------------------------------------------
	method addLayer
	Initialisation's work
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerCategory.prototype.addLayer = function (lyr) {
    if (lyr.widget) {
        var _sep="";
        var _lyr_url = (lyr.type == "WMS") ? lyr.url : lyr.protocol.url;
		var _lastchar= _lyr_url.slice(-1);
		lyr["base_url"] = (_lastchar=="?" || _lastchar=="&") ?  _lyr_url.substr(0,(_lyr_url.length-1)) :  _lyr_url.toString();

		if (_lyr_url.indexOf('?')==-1) _sep = "?";
		else _sep = "&";

		lyr["base_url"] += _sep + "lid="+lyr.id;
		_sep = "&";
        for (var wtype in lyr.widget) {
            var witem = lyr.widget[wtype];
            switch (wtype) {
                case "date":
			if(lyr.type == "GeoJSON") {
				lyr["base_url"] += _sep + "wfilter="+witem.param;
				_sep = "&";
			}
                    //use the moment.js library (reference it in the main page)
                    var d = new Date();
                    var datestring = moment().format(witem.format);
                    if (witem.start) {
                        if (witem.start === "yesterday") {
                            datestring = moment().add(-1, 'days').format(witem.format);
                        } else if (witem.start !== "today") {
                            var _d_arr = witem.start.split(".");
                            var _dateobj = {
                                'year': parseInt(_d_arr[2]),
                                'month': parseInt(_d_arr[1]) - 1,
                                'date': parseInt(_d_arr[0])
                            };
                            datestring = moment().set(_dateobj).format(witem.format);
                        }
                    }
			
			lyr.url = lyr.base_url + _sep + witem.param + "=" + datestring;
                    break;

		case "slider":
			if (lyr.widget[wtype].type=="rangeslilder"){
						if(lyr.type == "GeoJSON") {
							lyr["base_url"] += _sep + "wfilter="+lyr.widget[wtype].param;
							_sep = "&";
						}
				var d = new Date();
						if (typeof lyr.widget[wtype].options.value[0] == "string" && lyr.widget[wtype].options.value[0].indexOf("#") == 0){
							if (lyr.widget[wtype].options.value[0].indexOf("-") > -1){
								var _opt_parts_0 = lyr.widget[wtype].options.value[0].split("-");
								if (_opt_parts_0[0]==="#current_year") {
									lyr.widget[wtype].options.value[0] = parseInt(d.getFullYear()) - parseInt(_opt_parts_0[1]);
								}
							} else if (lyr.widget[wtype].options.value[0].indexOf("+") > -1){
								var _opt_parts_0 = lyr.widget[wtype].options.value[0].split("+");
								if (_opt_parts_0[0]==="#current_year") {
									lyr.widget[wtype].options.value[0] = parseInt(d.getFullYear()) + parseInt(_opt_parts_0[1]);
								}
							} else {
								if (lyr.widget[wtype].options.value[0]==="#current_year") lyr.widget[wtype].options.value[0] = d.getFullYear();
								else if (lyr.widget[wtype].options.value[0]==="#last_year") lyr.widget[wtype].options.value[0] = d.getFullYear()-1;
							}
						}
						if (typeof lyr.widget[wtype].options.value[1] == "string" && lyr.widget[wtype].options.value[1].indexOf("#") == 0){
							if (lyr.widget[wtype].options.value[1].indexOf("-") > -1){
								var _opt_parts_1 = lyr.widget[wtype].options.value[1].split("-");
								if (_opt_parts_1[0]==="#current_year") {
									lyr.widget[wtype].options.value[1] = parseInt(d.getFullYear()) - parseInt(_opt_parts_1[1]);
								}
							} else if (lyr.widget[wtype].options.value[1].indexOf("+") > -1){
								var _opt_parts_1 = lyr.widget[wtype].options.value[1].split("+");
								if (_opt_parts_1[0]==="#current_year") {
									lyr.widget[wtype].options.value[1] = parseInt(d.getFullYear()) + parseInt(_opt_parts_1[1]);
								}
							} else {
				if (lyr.widget[wtype].options.value[1]==="#current_year") lyr.widget[wtype].options.value[1] = d.getFullYear();
				else if (lyr.widget[wtype].options.value[1]==="#last_year") lyr.widget[wtype].options.value[1] = d.getFullYear()-1;
							}
						}
						var _recalc_range = false;
						if (typeof lyr.widget[wtype].options.minimum == "string" && lyr.widget[wtype].options.minimum.indexOf("#") == 0){
							if (lyr.widget[wtype].options.minimum.indexOf("-") > -1){
								var _opt_parts_max = lyr.widget[wtype].options.minimum.split("-");
								if (_opt_parts_max[0]==="#current_year") {
									lyr.widget[wtype].options.minimum = parseInt(d.getFullYear()) - parseInt(_opt_parts_max[1]);
								}
							} else if (lyr.widget[wtype].options.minimum.indexOf("+") > -1){
								var _opt_parts_max = lyr.widget[wtype].options.minimum.split("+");
								if (_opt_parts_max[0]==="#current_year") {
									lyr.widget[wtype].options.minimum = parseInt(d.getFullYear()) + parseInt(_opt_parts_max[1]);
								}
							} else {
								if (lyr.widget[wtype].options.minimum==="#current_year") lyr.widget[wtype].options.minimum = d.getFullYear();
								else if (lyr.widget[wtype].options.minimum==="#last_year") lyr.widget[wtype].options.minimum = d.getFullYear()-1;
							}
							_recalc_range = true;
						}

						if (typeof lyr.widget[wtype].options.maximum == "string" && lyr.widget[wtype].options.maximum.indexOf("#") == 0){
							if (lyr.widget[wtype].options.maximum.indexOf("-") > -1){
								var _opt_parts_max = lyr.widget[wtype].options.maximum.split("-");
								if (_opt_parts_max[0]==="#current_year") {
									lyr.widget[wtype].options.maximum = parseInt(d.getFullYear()) - parseInt(_opt_parts_max[1]);
								}
							} else if (lyr.widget[wtype].options.maximum.indexOf("+") > -1){
								var _opt_parts_max = lyr.widget[wtype].options.maximum.split("+");
								if (_opt_parts_max[0]==="#current_year") {
									lyr.widget[wtype].options.maximum = parseInt(d.getFullYear()) + parseInt(_opt_parts_max[1]);
								}
							} else {
								if (lyr.widget[wtype].options.maximum==="#current_year") lyr.widget[wtype].options.maximum = d.getFullYear();
								else if (lyr.widget[wtype].options.maximum==="#last_year") lyr.widget[wtype].options.maximum = d.getFullYear()-1;
							}
							_recalc_range = true;
						}
						
						if (_recalc_range === true) {
					lyr.widget[wtype].options.discreteValues=lyr.widget[wtype].options.maximum-lyr.widget[wtype].options.minimum+1;
				}
				
				var _value = lyr.widget[wtype].options.value[0]+","+lyr.widget[wtype].options.value[1];
			} else {
				var _value = lyr.widget[wtype].options.value;
			}
		
					lyr.url = lyr.base_url + _sep + lyr.widget[wtype].param + "=" + _value;
			break;

		case "addparam":			
			var _paramlist = "";
			var _lastchar= lyr.base_url.slice(-1);
			var _newurl = (_lastchar=="?" || _lastchar=="&") ?  lyr.base_url.substr(0,(lyr["base_url"].length-1)) :  lyr.base_url.toString();
			for (var i=0;i<lyr.widget[wtype].length;i++){
				if (lyr.widget[wtype][i].default){
					if (_newurl.indexOf('?')==-1) _newurl += "?";
					else _newurl += "&";
					_newurl += lyr.widget[wtype][i].param+"="+lyr.widget[wtype][i].default;
				}
				_paramlist += (_paramlist=="") ? lyr.widget[wtype][i].param : "," + lyr.widget[wtype][i].param; 
			}
			
			if (lyr.type == "WMS") lyr.url =_newurl;
			else {
				lyr.base_url += _sep + "wfilter="+_paramlist;
				if (_newurl.indexOf('?')==-1) _newurl += "?";
				else _newurl += "&";
				_newurl += "wfilter="+_paramlist;
				lyr.protocol.url = _newurl;
				lyr.protocol.options.url = _newurl;
			}
		break;

            }
        }
    }

    var className = lyr.type;
    var olayer = new njs.Layers[className](lyr.name,lyr);

    this.arLayers.push(olayer);
};

njs.LayerMgr.ClassicLayerCategory.prototype.addBaseMap = function (bmap) {
    var _bmap={"name":bmap};
    var _target_maps = [];
    var _startmap = false;
    var _btnClass;
    for (var _map in njs.config.basisMaps){
        if (njs.config.basisMaps[_map].basisMaps[bmap]!=null && typeof njs.config.basisMaps[_map].basisMaps[bmap]!='undefined'){
            _target_maps.push(_map);
            _btnClass = njs.config.basisMaps[_map].basisMaps[bmap].btnClass ? njs.config.basisMaps[_map].basisMaps[bmap].btnClass : null;
        }
    }   
    if (njs.AppManager.StartParams.basemap!=null && typeof njs.AppManager.StartParams.basemap!='undefined' && njs.AppManager.StartParams.basemap!=""){
        if (njs.AppManager.StartParams.basemap == bmap) _startmap=true;
    } else if (njs.config.basisMaps[_map].startMap == bmap) _startmap=true;
    
    _bmap.targetMap=_target_maps;
    _bmap.startmap=_startmap;
    _bmap.label = njs.AppManager.nls.toolsResources["btnMaps" + "_" + bmap] || bmap;
    _bmap.btnClass = _btnClass;
    this.arBMap.push(_bmap);
}

/*-------------------------------------------------------------------------------
	method _build
	Build the dojo Object
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerCategory.prototype._build = function (domLocation, oCatPaneContainer) {
    var that = this;
    this._domLocation = domLocation;
    if (oCatPaneContainer == null) oCatPaneContainer = document.createElement("DIV");

    if (this.arCategories.length > 0)
        dojo.attr(oCatPaneContainer, {"class": "categoryHeader"});   //added by AGIS: css fÃ¼r CatHeader

    this._buildContentHeader(domLocation, oCatPaneContainer);

    if (this.arBMap.length > 0) {
        this._buildContentBaseMaps(domLocation, oCatPaneContainer);   //Basemaps erzeugen
    }
    if (this.arLayers.length > 0) {
        //console.log("create layers");
        this._buildContentLayers(domLocation, oCatPaneContainer);   //Layer erzeugen
    }
    if (this.arCategories.length > 0) {
        this.arCategories.forEach(function(cat) {
            that._buildContentSubCat(cat, domLocation); //Unterkategorie erzeugen
        });
    }
};

njs.LayerMgr.ClassicLayerCategory.prototype._buildContentHeader = function (domLocation, oCatPaneContainer) {
    var html = '';
    if (this.useRemoveHighlight) {
        html = "<table width='100%'><tr><td><b>" + this.description + "</b></td><td style='width:10%; color:#ffffff;text-align:right'>";
        html += "<div id='" + domLocation + "_wrapper'></div>";
        html += "</td>";
    } else if (this.description !== '' && typeof this.iconClass !== "undefined" && this.iconClass != null && this.iconClass !== "") {
        html = "<table><tr><td><b>" + this.description + "</b></td>";
    }

    if (html !== '') {
        html += "</tr></table>";

        oCatPaneContainer.innerHTML = html;
        dojo.byId(domLocation).appendChild(oCatPaneContainer);
    }

    if (this.useRemoveHighlight) {
        var oBtn = new dijit.form.Button({
            iconClass: "njsIconButtonDeselect",
            label: "Alle deselektieren",
            showLabel: false,
            onClick: function () {
                njs.Tools.ClearSelection.prototype.Clear();
            }
        }, domLocation + "_wrapper");

        oBtn.className = "njsButton";
    }
};

njs.LayerMgr.ClassicLayerCategory.prototype._buildContentBaseMaps = function (domLocation, oCatPaneContainer) {
    var that = this;
    var oContainer = null;
   
    this.arBMap.forEach(function (bmap, j) {
        //add a div to the content pane in order to receive the checkbox object
        var oContainer = document.createElement("DIV");
        oContainer.id = "bmapmgr_" + bmap.name;
        oContainer.className = "bmap";
        if (bmap.startmap) oContainer.className += " active";
        oContainer.style.margin = '2px';

        if (bmap.btnClass) {
            oContainer.innerHTML += "<div class=\"" + bmap.btnClass + " shadow_small map_selector_embedded\" />" ;
        } else {
            oContainer.innerHTML += "<div class=\"njsIconButtonOSM shadow_small map_selector_embedded\" />" ;
        }
        
        oContainer.innerHTML += "<span class='bmapLabel'>" + bmap.label + "</span>";
        dojo.attr(oContainer, "onClick", "njs.AppManager.LyrMgr['"+that.id_lyr_mgr+"'].changeBaseMap('"+that.id+"','"+bmap.name+"');");        
        oCatPaneContainer.appendChild(oContainer);
        
    });
}

njs.LayerMgr.ClassicLayerCategory.prototype._buildContentLayers = function (domLocation, oCatPaneContainer) {
    var that = this;
    var _has_editable = 0;
    var oContainer = null;
    var oContWidgetElement = null;
    var _curr_grouplay = null;
    
    var oGroupLayContainer=null;
    var oGroupLayContainerHead=null;
    
    this.arLayers.forEach(function (layr, j) {
        layr.domLocation = domLocation;
        //add a div to the content pane in order to receive the checkbox object
        oContainer = layr._build(j, domLocation);
        // handle the grouped layers
        if (layr.group_layer!=null){
            if (_curr_grouplay==null || _curr_grouplay!=layr.group_layer.name){
                oGroupLayContainer= document.createElement("DIV");
                dojo.attr(oGroupLayContainer,"id","div_" + layr.group_layer.name);
                dojo.attr(oGroupLayContainer, "class","lyrmgr_group");
                var _open = "block";
                var _classopen = "grlay_open";
                if (layr.group_layer.open!=null && typeof layr.group_layer.open!='undefined'){
                    if (layr.group_layer.open==false || layr.group_layer.open==0) {
                        _open = "none";
                        _classopen = "";
                    }
                } 
                dojo.setStyle(oGroupLayContainer, "display", _open);
                oGroupLayContainerHead = document.createElement("DIV");
                oGroupLayContainerHead.id = "div_head_" + layr.group_layer.name;
                oGroupLayContainerHead.style.margin = '2px';
            
                var _lyrprefix = "";
                var _lyrsuffix = "";
                if (layr.group_layer.legend ) {
                    var leg_link = njs.AppManager.nls.legendResources[layr.group_layer.legend+"_link"] ? njs.AppManager.nls.legendResources[layr.group_layer.legend+"_link"] : "";
                    var leg_tit = njs.AppManager.nls.legendResources[layr.group_layer.legend+"_title"] ? njs.AppManager.nls.legendResources[layr.group_layer.legend+"_title"] : "";
                    _lyrprefix = "<a href='javascript:void(0)' class='njsLegend' title='" + that.tt_legend + "' onclick=njs.AppManager.showLegend('" + leg_link + "','" + escape(leg_tit) + "'," + layr.group_layer.legend.print + "," + layr.group_layer.legend.extern + ")>";
                    _lyrsuffix = "</a>";
                }
            
                var _legendiconclass = layr.group_layer.icon_class ? layr.group_layer.icon_class : "";
                var _icon_img = (layr.group_layer.icon!=null && typeof layr.group_layer.icon != 'undefined') ? "<img src=\"" + layr.group_layer.icon + "\" alt=\"\" class=\"njsIcon legendIcon " + _legendiconclass + "\" />" : "<span class=\"njsIcon legendIcon\"></span>";
                oGroupLayContainerHead.innerHTML += _lyrprefix + _icon_img + _lyrsuffix;
                oGroupLayContainerHead.innerHTML += "&nbsp;";
                // visibility checkbox
                oGroupLayContainerHead.innerHTML += "<input id=\"" + domLocation + "_" + layr.group_layer.name  + "_grouplayckbx" + "\" />&nbsp;";
                
                var _grp_lay_name = njs.AppManager.nls.lyrmgrResources["desc_"+layr.group_layer.name] ? njs.AppManager.nls.lyrmgrResources["desc_"+layr.group_layer.name] : layr.group_layer.name;
                
                oGroupLayContainerHead.innerHTML += "<label id=\"" + domLocation + layr.group_layer.name + "_lbl\" for=\"" + domLocation + layr.group_layer.name + "\">" + _lyrprefix + _grp_lay_name + _lyrsuffix + "</label>";
                
                var _btn = "<div id=\"" + domLocation + layr.group_layer.name + "_tgle\" class='lyrmgr_group_expand "+_classopen+"' ";
                _btn += "onclick='(document.getElementById(\"div_"+ layr.group_layer.name+"\").style.display==\"block\") ? document.getElementById(\"div_"+ layr.group_layer.name+"\").style.display=\"none\" : document.getElementById(\"div_"+ layr.group_layer.name+"\").style.display=\"block\";require([\"dojo/dom-class\"], function (domClass) {(document.getElementById(\"div_"+ layr.group_layer.name+"\").style.display==\"block\") ? domClass.replace(document.getElementById(\"" + domLocation + layr.group_layer.name + "_tgle\"),\"grlay_open\",\"\") : domClass.replace(document.getElementById(\"" + domLocation + layr.group_layer.name + "_tgle\"),\"\",\"grlay_open\")});'>";
                _btn += "+</div>";
                oGroupLayContainerHead.innerHTML += _btn;
                
                oGroupLayContainerHead.style.width = '100%';
                oCatPaneContainer.appendChild(oGroupLayContainerHead);
                oCatPaneContainer.appendChild(oGroupLayContainer);

                var checkAll = new dijit.form.CheckBox({
                    id: domLocation + "_" + layr.group_layer.name + "_grouplayckbx",
                    name: domLocation + "_" + layr.group_layer.name + "_grouplayckbx",
                    value: layr.group_layer.name,
                    checked: false,
                    onClick: function (b) {
                        b.stopPropagation();
                        require(["dojo/dom-class"], dojo.hitch(this,function (domClass) {
                            domClass.replace(this.domNode, null, "dijit dijitReset dijitInline tmpdirCheckBox tmpdirCheckBoxMixed dijitMixed");
                        }));
                        for (var _gp_lay in that.arLayers){
                            if (that.arLayers[_gp_lay].group_layer && that.arLayers[_gp_lay].group_layer.name==this.value){
                                that.switchLayer(that.arLayers[_gp_lay].id, this.checked);
                                if (that.arLayers[_gp_lay].logging===1 && this.checked) njs.AppManager.logUserLayer(that.arLayers[_gp_lay].name);
                            }
                        }
                        //if modoule sortlayers load the new layer order
                        if (njs.AppManager.LyrMgr[that.id_lyr_mgr].mod_sortlayers != null) njs.AppManager.LyrMgr[that.id_lyr_mgr].updateSortLyrMod();
                        njs.AppManager.currentSubTheme=null;
                        njs.AppManager.currentTheme=null;                        
                        // if module track bookmark then update the url
                        if (njs.AppManager.Tools.TrackBookmark) njs.AppManager.updateMapStatusUrl(njs.AppManager.LyrMgr[that.id_lyr_mgr].targetMap[0]);
                    
                    }
                }, domLocation + "_" + layr.group_layer.name + "_grouplayckbx");
            }
            oGroupLayContainer.appendChild(oContainer);

            _curr_grouplay=layr.group_layer.name;
        } else {
            oGroupLayContainer=null;
            oCatPaneContainer.appendChild(oContainer);
        }
        
        if (layr.editobj) _has_editable = 1;

        if (that.drawType === 'radio') dojo.attr(oContainer, {"class": "pseudoRadio"});

        // building the dijit visibility checkbox
        that.checkBox[j] = new dijit.form.CheckBox({
            id: layr.name,
            name: that.id,
            value: layr.name,
            checked: that.hasStartLayers ? layr.visible : false,        //TODO: when is visible=true? on startup is always false. start_visible is used for this?
            onClick: dojo.hitch(null,function(_layr,c) { // jshint ignore:line
                if (that.drawType == 'radio' && this.checked) {
                    var radio = dojo.query('[name=' + this.name + ']');
                    for (var x = 0; x < radio.length; x++) {
                        if (radio[x].checked && radio[x].id != this.id) {
                            that.toggleLayer(radio[x].id, false);
                            dijit.byId(radio[x].id).set('checked', false);
                        }
                    }
                }
                that.switchLayer(this.id, this.checked);
                //if modoule sortlayers load the new layer order
                if (njs.AppManager.LyrMgr[that.id_lyr_mgr].mod_sortlayers != null) njs.AppManager.LyrMgr[that.id_lyr_mgr].updateSortLyrMod();
                // if module track bookmark then update the url
                njs.AppManager.currentSubTheme=null;
                njs.AppManager.currentTheme=null;
                if (njs.AppManager.Tools.TrackBookmark) njs.AppManager.updateMapStatusUrl(njs.AppManager.LyrMgr[that.id_lyr_mgr].targetMap[0]);
            	if (_layr.logging===1 && this.checked) njs.AppManager.logUserLayer(_layr.name);
            },layr)
        }, domLocation + j);

        // create a selectbox at the top of the layer group
        if (layr.widget.drawing){
            if (oContWidgetElement==null) {
                oContWidgetElement = document.createElement("DIV");
                var _txt=that._widgetDrawingNameSelect(layr.widget.drawing);
                dojo.html.set(oContWidgetElement, _txt, {parseContent: true});
                oCatPaneContainer.insertBefore(oContWidgetElement, oCatPaneContainer.firstChild);

                that.drawings_combos_lays[layr.widget.drawing.group + "_drawings_combo"] = [];

                // instanciate the widget
                require(["dojo/data/ItemFileWriteStore", "dojo/store/DataStore", "dojox/form/CheckedMultiSelect"], function(ItemFileWriteStore, DataStore, CheckedMultiSelect){
                    var datastore = new ItemFileWriteStore({url:"/mapplus-lib/mapplus-dojo/"+njs.AppManager.Version+"/php/mods/mod_drawing.php"+ "?id=" + layr.widget.drawing.group + "&dbconn_id=" + layr.widget.drawing.dbconn_id + "&sch=" + layr.widget.drawing.schema + "&type=" + (typeof layr.widget.drawing.type!="undefined" ? layr.widget.drawing.type : '') + "&action=getList"});
                    datastore.clearOnClose = true;
                    
                    // vesrion with inline generation of checkmultiselect
                    setTimeout(function () {
                        that.drawings_combos[layr.widget.drawing.group + "_drawings_combo"]=dijit.byId(layr.widget.drawing.group + "_drawings_combo");
                        that.drawings_combos[layr.widget.drawing.group + "_drawings_combo"].refLays= that.drawings_combos_lays[layr.widget.drawing.group + "_drawings_combo"];
                        that.drawings_combos[layr.widget.drawing.group + "_drawings_combo"].store= datastore;
                        that.drawings_combos[layr.widget.drawing.group + "_drawings_combo"].store.close();
                        that.drawings_combos[layr.widget.drawing.group + "_drawings_combo"].store.fetch({
                            onComplete: function(storeitems){
                                let params = new URLSearchParams(document.location.search);
                                let drawings = params.getAll("drawings");
                                let start_param=[];
                                for (var _idraw in drawings){
                                    if (drawings[_idraw].indexOf(layr.widget.drawing.group+"|")==0){
                                        start_param=drawings[_idraw].split("|")[1].split(",");
                                       break;
                                    }
                                }
                                var _opts = [];
                                for (var i=0; i<storeitems.length;i++){
                                    const _dr_sel = (start_param.indexOf(storeitems[i].id[0])!==-1) ? true : false;
                                    _opts.push({
                                        "disabled":false,
                                    "label": storeitems[i].name[0],
                                        "selected": _dr_sel,
                                    "value":storeitems[i].id[0]
                        });
                            }
                                that.drawings_combos[layr.widget.drawing.group + "_drawings_combo"].set("options", _opts)
                                that.drawings_combos[layr.widget.drawing.group + "_drawings_combo"].startup();
                        }
                    });
                        that.drawings_combos[layr.widget.drawing.group + "_drawings_combo"].onChange= function(_ids) {
                            dojo.byId(this.domNode.firstChild.id+"_label").innerHTML=this.dropDownButton.label.trim();

                            var _id=_ids;
                            if (Array.isArray(_ids)) {
                                _id=_ids.join();
                   }
                                var _lyrs = [];
                            var _param;
                                for (var i in this.refLays){
                                _param = this.refLays[i].widget.drawing.param ? this.refLays[i].widget.drawing.param : "drawing";
                                this.refLays[i].updateLayerSource([_param],_id);
                                    _lyrs.push(this.refLays[i].id)
                                }
                                require(["dojo/request/xhr"], function (xhr) {
                                    xhr("/mapplus-lib/mapplus-dojo/"+njs.AppManager.Version+"/php/mods/mod_drawing.php?action=setDrawing", {
                                        handleAs: "json", sync: false, preventCache: true, method: "POST",
                                    data: {"dwg": _id,"id_param":_param,"lids":_lyrs.join()}
                                    }).then(function (data) {
                                    }, function (err) {
                                        // Handle the error condition
                                        console.error("Error setting selected drawing", err);
                                    });
                                });
                            // bookmarks params
                            let params = new URLSearchParams(document.location.search);
                            params.forEach((value, key) => {
                                if (key=="drawings"){
                                    if (value.indexOf(layr.widget.drawing.group+"|")==0){
                                        params.delete(key, value);
                                    }
                                }
                            });
                            if (_id!="") params.append("drawings",layr.widget.drawing.group+"|"+_id);
                            
                            if (typeof window.history.replaceState == "function") {
                                const path = window.location.href.split('?')[0];
                                window.history.replaceState({}, '', path+"?"+params);
                            }

                        };
                    },1000);
                });

                that.drawings_combos_lays[layr.widget.drawing.group + "_drawings_combo"].push(layr);
            } else {
                that.drawings_combos_lays[layr.widget.drawing.group + "_drawings_combo"].push(layr);
            }
        }

        if (layr.widget.date) {
            var d = new Date();
            if (layr.widget.date.start) {
                if (layr.widget.date.start === "yesterday") d.setDate(d.getDate() - 1);
                else if (layr.widget.date.start !== "today") {
                    var _d_arr = layr.widget.date.start.split(".");
                    d.setFullYear(parseInt(_d_arr[2]));
                    d.setMonth(parseInt(_d_arr[1]) - 1);
                    d.setDate(parseInt(_d_arr[0]));
                }
            }

            var _date_widget = new dijit.form.DateTextBox(
                {
                    id: layr.id + "_datewidget",
                    name: layr.id + "_datewidget",
                    style: "width: 90px;border-width:1px;",
                    value: d,
                    onKeyDown: function (evt) { // jshint ignore:line
                        dojo.stopEvent(evt);
                    },
                    onChange: function (evt) { // jshint ignore:line
                        var _param = this.refLay.widget.date.param;
                        var _format = this.refLay.widget.date.format;
                        var _dateobj = {
                            'year': evt.getFullYear(),
                            'month': evt.getMonth(),
                            'date': evt.getDate()
                        };

                        var _date = moment().set(_dateobj).format(_format);

                        var _newurl = this.refLay.base_url;
                        if (_newurl.substring(_newurl.length - 1) !== "&") _newurl += "&";
                        _newurl += _param + "=" + _date;

			if (this.refLay.type == "WMS") {
                        	this.refLay._lyr.setUrl(_newurl);
				if (this.refLay.visible){
                            		this.refLay.switchLayer(false);
                            		this.refLay.switchLayer(true);
                        	}
			} else {
				this.refLay._lyr.protocol.url = _newurl;
				this.refLay._lyr.protocol.options.url = _newurl;
				if (this.refLay.visible) this.refLay._lyr.refresh({force:true});
			}

                    },
                    refLay: layr
                }, layr.id + "_datewidget"
            );
			
		
        } else if (layr.widget.slider) {
			var _params = layr.widget.slider.options;
			if (!_params.style) _params.style = "width:300px;";
			_params.onChange = function(value){
				var _newurl = this.refLay.base_url;
				if (_newurl.substring(_newurl.length-1)!="&")_newurl+="&";
				var _param = this.refLay.widget.slider.param;
				_newurl+=_param+"="+value;

				if (this.refLay.type == "WMS") {
					this.refLay._lyr.setUrl(_newurl);
					if (this.refLay.visible){
						this.refLay.switchLayer(false);
						this.refLay.switchLayer(true);
					}
				} else {
					this.refLay._lyr.protocol.url = _newurl;
					this.refLay._lyr.protocol.options.url = _newurl;
					if (this.refLay.visible) this.refLay._lyr.refresh({force:true});
				}
				
				dojo.byId(this.refLay.id+"_slider_vals").innerHTML="<p>"+value.toString().replace(","," - ")+"</p>";
			};
			_params.refLay = layr;

			var horizontal_slider = dojo.byId(layr.id+"_sliderwidget");
			var rulesNode = document.createElement("div");
			horizontal_slider.appendChild(rulesNode);
			var labelsNode = document.createElement("div");
			horizontal_slider.appendChild(labelsNode);
			var valsNode = document.createElement("div");
			dojo.attr(valsNode, "id", _params.refLay.id+"_slider_vals");
			horizontal_slider.appendChild(valsNode);
			//var _cnt = _params.maximum - _params.minimum + 1;
			var _cnt = _params.discreteValues;

			var sliderRules = new dijit.form.HorizontalRule({
				count:_cnt,
				style:"height:5px;"
			}, rulesNode);

			var _labels=[_params.minimum];
			var _center = _cnt/2; 
			var _curr_val=_params.minimum;
			for (var i=2;i<_cnt;i++){
				_curr_val++;
				var _lab = (i==Math.round(_center)) ? _curr_val : "";
				_labels.push(_lab);
			}
			_labels.push(_params.maximum);

			var sliderLabels = new dijit.form.HorizontalRuleLabels({
				labels:_labels,
				container:"bottomDecoration",
				style:{height:"1em",fontSize:"75%"}
			}, labelsNode);
			
			var rangeSlider = new dojox.form.HorizontalRangeSlider(
				_params,
				horizontal_slider
			);
	} else if (layr.widget.textbox) {
			var _params = layr.widget.textbox.options ? layr.widget.textbox.options : {};
			if (!_params.style) _params.style = "width:100px;";
			if (!_params.name) _params.name = "textboxwidget_"+j;
			_params.onKeyUp = function(value){
				var _newurl = this.refLay.base_url;
				if (_newurl.substring(_newurl.length-1)!="&")_newurl+="&";
				var _param = this.refLay.widget.textbox.param;
				_newurl+= _param + "=" + (this.refLay.widget.textbox.prefix ? this.refLay.widget.textbox.prefix : "") + this.displayedValue + (this.refLay.widget.textbox.suffix ? this.refLay.widget.textbox.suffix : "");

				this.refLay._lyr.setUrl(_newurl);
				if (this.refLay.visible){
					//this.refLay._lyr.redraw();
					this.refLay.switchLayer(false);
					this.refLay.switchLayer(true);
				}
			};
			_params.refLay = layr;

			var text_box = dojo.byId(domLocation+j+"_textboxwidget");
			var txtNode = document.createElement("div");
			text_box.appendChild(txtNode);

			var textBox = new dijit.form.TextBox(
				_params,
				text_box
			);        
        }
    });
    return _has_editable;
};

/*-------------------------------------------------------------------------------
	method Activate
	Activates the search element
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerCategory.prototype.Activate = function () {
};

/*-------------------------------------------------------------------------------
	method _buildContentSubCat
	Organize the layers in groups according to the configuration // layercategory 2
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerCategory.prototype._buildContentSubCat = function (_opts, domLocation) {
    var that = this;
    var title_html = '';

    if (_opts.legend) {
        var _leg = _opts.legend.link;
        var _title = _opts.legend.title;
        var _print = _opts.legend.print;
        var _extern = _opts.legend.extern;
        title_html += "<a class='imagelink' href='javascript:void(0)' onclick='event.stopPropagation();njs.AppManager.showLegend(\"" + _leg + "\",\"" + escape(_title) + "\"," + _print + "," + _extern + ");'><img title='" + this.tt_legend + "' style='vertical-align: middle;' src='../core/templates/" + njs.AppManager.template + "/img/buttons/map.png' alt='' /></a>&nbsp;";
    }

	if (_opts.tool) {
		var _toollink = _opts.tool.link;
        title_html += "<a class='imagelink'  href='javascript:void(0)' onclick='event.stopPropagation();window.open(\""+_toollink+"\",\"shop\");'><div class='grpShop'></div></a>";
	}

    if (_opts.selectAll) title_html += "<input id='" + domLocation + "_" + _opts.id + "_groupckbx' />";

    var desc = _opts.description;
    title_html += "<span class='appendtitle'>"+_opts.description+"</span>"; //sc: better position control in lm
    if (_opts.restricted)
        title_html += "&nbsp;<span class='categoryLocked'>&nbsp;&nbsp;&nbsp;</span>";   //added by AGIS
    var tp = new dijit.TitlePane({
        id: domLocation + "_" + _opts.id,
        style: "width:100%",
        title: title_html,
        content: "",
        open: _opts.open ? _opts.open : false
    });


    //tp_header.innerHTML = "<img id='' width='16' height='16'/><img id='' width='16' height='16'/>";
    //tp.appendChild(tp_header);
    dojo.byId(domLocation).appendChild(tp.domNode);

    _opts.description = "";

    var oCatPaneContainer = dojo.byId(domLocation + "_" + _opts.id + "_pane");

    _opts._build(domLocation, oCatPaneContainer);

    tp.startup();

    var _box_checked = false;
    var nbLayChecked = 0;
    var nbLayTot = 0;
    _opts.arLayers.forEach(function (lay) {
        if (!that.hasStartLayers && lay.visible) {   //TODO: when is visible=true? on startup is always false. start_visible is used for this?
            _box_checked = true;
            nbLayChecked++;
        }
        nbLayTot++;
    });

    if (_opts.selectAll) {
        _opts.checkBoxAll = new dijit.form.CheckBox({
            id: domLocation + "_" + _opts.id + "_groupckbx",
            name: domLocation + "_" + _opts.id + "_groupckbx",
            value: _opts.id,
            checked: _box_checked,
            onClick: function (b) {
                b.stopPropagation();
                njs.AppManager.currentSubTheme=null;
                njs.AppManager.currentTheme=null; 
                that.switchGroupLayers(this.id, this.value, this.checked);
            }
        }, domLocation + "_" + _opts.id + "_groupckbx");
    }

    if (nbLayChecked < nbLayTot && nbLayChecked > 0) {
        require(["dojo/dom-class"], dojo.hitch(this, function (domClass) {
            domClass.replace(_opts.checkBoxAll.domNode, "dijit dijitReset dijitInline tmpdirCheckBox tmpdirCheckBoxMixed dijitMixed", "dijit dijitReset dijitInline dijitCheckBox dijitCheckBoxChecked dijitChecked");
        }));
    }

    _opts.description = desc;
};

/*-------------------------------------------------------------------------------
	method switchLayer
	Switch Layer's visibility in the Map
	[integer] id: layer's id to switch on/off
	[boolean] status: checkbox' status
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerCategory.prototype.switchLayer = function (id_layer, status) {
    var that = this;
    var nbLayChecked = 0;
    var nbLayTot = 0;
    var grouplay_vis = {};
    //for( _layr in njs.AppManager.Layers) {
    this.arLayers.forEach(function (lay) {
        var _lay_chkbox = dijit.byId(lay.name);
        if (lay.name == id_layer) {
            lay.switchLayer(status);
            //rba:added one condition in test
            if (_lay_chkbox) _lay_chkbox.set('checked', status);
            if (lay.geoFilter) {
                require(["dojo/topic"], dojo.hitch(that, function (topic) {
                    //rba:to be discussed-do not work for some projects
                    //if (status)	topic.publish('geofilter_activated',that.arLayers[_layr].geoFilter);
                    //else topic.publish('geofilter_deactivated');
                }));
            }
        }
        //added one condition in test
        if (_lay_chkbox) {
            if (_lay_chkbox.checked) nbLayChecked++;

            if (lay.group_layer){
                if (!grouplay_vis[lay.group_layer.name]) {
                    var node =dojo.byId("div_"+lay.group_layer.name);
                    var _gptot =0;
                    if (node) _gptot=node.children.length;
                    grouplay_vis[lay.group_layer.name] = {_tot:_gptot,_vis:0,_domloc:lay.domLocation};
                }
                if (_lay_chkbox.checked) grouplay_vis[lay.group_layer.name]._vis++;
            }

        }
        nbLayTot++;
    });
    if (this.checkBoxAll != null) {
        if (nbLayChecked === 0) {
            this.checkBoxAll.set('checked', false);
            require(["dojo/dom-class"], dojo.hitch(this, function (domClass) {
                var node = dijit.byId(that.checkBoxAll.id).domNode;
                domClass.replace(node, "dijit dijitReset dijitInline dijitCheckBox", "dijit dijitReset dijitInline tmpdirCheckBox tmpdirCheckBoxMixed dijitMixed");
            }));
        } else if (nbLayTot != nbLayChecked) {
            this.checkBoxAll.set('checked', true);
            require(["dojo/dom-class"], dojo.hitch(this, function (domClass) {
                var node = dijit.byId(that.checkBoxAll.id).domNode;
                if (!status) {
                    domClass.replace(node, "dijit dijitReset dijitInline tmpdirCheckBox tmpdirCheckBoxMixed dijitMixed", "dijit dijitReset dijitInline dijitCheckBox dijitCheckBoxChecked dijitChecked");
                } else {
                    domClass.replace(node, "dijit dijitReset dijitInline tmpdirCheckBox tmpdirCheckBoxMixed dijitMixed", "dijit dijitReset dijitInline dijitCheckBox");
                }
            }));
        } else {
            this.checkBoxAll.set('checked', true);
            require(["dojo/dom-class"], dojo.hitch(this, function (domClass) {
                var node = dijit.byId(that.checkBoxAll.id).domNode;
                domClass.replace(node, "dijit dijitReset dijitInline dijitCheckBox dijitCheckBoxChecked dijitChecked", "dijit dijitReset dijitInline tmpdirCheckBox tmpdirCheckBoxMixed dijitMixed");
            }));
        }
    }

    require(["dojo/dom-class"], function (domClass) {
        for (var _gplay in grouplay_vis){
            var _iid = grouplay_vis[_gplay]._domloc + "_" + _gplay + "_grouplayckbx";
            var node = dijit.byId(_iid).domNode;
            if (grouplay_vis[_gplay]._vis===0){
                domClass.replace(node, "dijit dijitReset dijitInline dijitCheckBox", "dijit dijitReset dijitInline tmpdirCheckBox tmpdirCheckBoxMixed dijitMixed");
                document.getElementById(_iid).checked = false;
            } else if (grouplay_vis[_gplay]._vis!=grouplay_vis[_gplay]._tot){
                domClass.replace(node, "dijit dijitReset dijitInline tmpdirCheckBox tmpdirCheckBoxMixed dijitMixed", "dijit dijitReset dijitInline dijitCheckBox dijitCheckBoxChecked dijitChecked");
                document.getElementById(_iid).checked = true;
            } else {
                domClass.replace(node, "dijit dijitReset dijitInline dijitCheckBox dijitCheckBoxChecked dijitChecked", "dijit dijitReset dijitInline tmpdirCheckBox tmpdirCheckBoxMixed dijitMixed");
                document.getElementById(_iid).checked = true;
            }
        }
    });


    this.arCategories.forEach(function (cat) {
        cat.switchLayer(id_layer, status);
    });
};

njs.LayerMgr.ClassicLayerCategory.prototype.refreshDrawingsCombos = function () {
    for (var cat in this.arCategories) {
        for (var combo in this.arCategories[cat].drawings_combos_lays){
            
            var _combo = dijit.byId(combo);
            var _curr_val = _combo.get('value');
            _combo.store.close();
            _combo.store.fetch({query: {name:_curr_val}, queryOptions: {ignoreCase: true}, onComplete: function(items,request){_combo.set("value", _curr_val);_combo.item=items[0];}});
    
        }
    }
};

njs.LayerMgr.ClassicLayerCategory.prototype.deselectAll = function () {
    this.arLayers.forEach(function (lay) {
        lay.switchLayer(false);
        if (dijit.byId(lay.name)) dijit.byId(lay.name).set('checked', false);
    });
    this.arCategories.forEach(function (cat) {
        if (cat.checkBoxAll != null) cat.checkBoxAll.set('checked', false);
        cat.deselectAll();
    });
};

njs.LayerMgr.ClassicLayerCategory.prototype.disableAll = function () {
    this.arLayers.forEach(function (lay) {
        if (dijit.byId(lay.name)) dijit.byId(lay.name).set('disabled', true);
    });
    this.arCategories.forEach(function (cat) {
        if (cat.checkBoxAll != null) cat.checkBoxAll.set('disabled', true);
        cat.disableAll();
    });
};

njs.LayerMgr.ClassicLayerCategory.prototype.enableAll = function () {
    this.arLayers.forEach(function (lay) {
        if (dijit.byId(lay.name)) dijit.byId(lay.name).set('disabled', false);
    });
    this.arCategories.forEach(function (cat) {
        if (cat.checkBoxAll != null) cat.checkBoxAll.set('disabled', false);
        cat.enableAll();
    });
};

njs.LayerMgr.ClassicLayerCategory.prototype.switchGroupLayers = function (idchkbox, idgroup, status) {
    this.arCategories.forEach(function (cat) {
        if (cat.id == idgroup) {
            var myarray = cat.arLayers.reverse();
            var grplays = {};
            myarray.forEach(function (lay) {
                if (status && lay.visible == status) {
                    lay.removeLayer();
                }
                // logging function must be set before switchLayer call otherwise reference to array obj will be lost
                if (lay.logging===1 && status) njs.AppManager.logUserLayer(lay.name)
                if (lay.group_layer!=null) grplays[idchkbox.replace(idgroup+"_groupckbx","")+lay.group_layer.name+"_grouplayckbx"]=status;
                cat.switchLayer(lay.name, status);
            });
            require(["dojo/dom-class"], function (domClass) {
                for (var gp_l in grplays){
                    var el = dijit.byId(gp_l);
                    el.checked = grplays[gp_l];
                    if (status) {
                        domClass.replace(el.domNode, "dijit dijitReset dijitInline dijitCheckBox dijitCheckBoxChecked dijitChecked", "dijit dijitReset dijitInline dijitCheckBox");
                        domClass.replace(el.domNode,null, "dijit dijitReset dijitInline tmpdirCheckBox tmpdirCheckBoxMixed dijitMixed");
                    } else {
                        domClass.replace(el.domNode, "dijit dijitReset dijitInline dijitCheckBox", "dijit dijitReset dijitInline dijitCheckBox dijitCheckBoxChecked dijitChecked");
                        domClass.replace(el.domNode, null, "dijit dijitReset dijitInline tmpdirCheckBox tmpdirCheckBoxMixed dijitMixed");
                    }
                }
            
                var node = dijit.byId(idchkbox).domNode;
                if (status) {
                    domClass.replace(node, "dijit dijitReset dijitInline dijitCheckBox dijitCheckBoxChecked dijitChecked", "dijit dijitReset dijitInline tmpdirCheckBox tmpdirCheckBoxMixed dijitMixed");
                } else {
                    domClass.replace(node, "dijit dijitReset dijitInline dijitCheckBox", "dijit dijitReset dijitInline tmpdirCheckBox tmpdirCheckBoxMixed dijitMixed");
                }

            });
        }
    });
    //if modoule sortlayers load the new layer order
    if (njs.AppManager.LyrMgr[this.id_lyr_mgr].mod_sortlayers != null) njs.AppManager.LyrMgr[this.id_lyr_mgr].updateSortLyrMod();
    // if module track bookmark then update the url
    if (njs.AppManager.Tools.TrackBookmark) njs.AppManager.updateMapStatusUrl(njs.AppManager.LyrMgr[this.id_lyr_mgr].targetMap[0]);
};

/*-------------------------------------------------------------------------------
	method toggleLayer
	Switch Layer's visibility in the Map
	[integer] id: layer's id to switch on/off
	[boolean] status: checkbox' status
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerCategory.prototype.toggleLayer = function (id_layer, status) {
    this.arLayers.forEach(function (lay) {
        //("toggleLayer: %o, %o", id_layer, lay);
        if (lay.name == id_layer) {
            lay.toggleLayer(status);
        }
    });
    this.arCategories.forEach(function (cat) {
        cat.toggleLayer(id_layer, status);
    });
};

/*-------------------------------------------------------------------------------
	method switchEditLayer
	Switch Layer's visibility in the Map
	[integer] id: layer's id to switch on/off
	[boolean] status: checkbox' status
--------------------------------------------------------------------------------*/
njs.LayerMgr.ClassicLayerCategory.prototype.switchEditLayer = function (id_layer, status) {
    var that = this;
    this.arLayers.forEach(function (lay) {
        if (lay.name + "_edit" == id_layer) {
            if (status) {
                that.EditableLayer = id_layer;
                if (lay._SelectControl) lay._SelectControl.deactivate();
            } else {
                if (that.EditableLayer == id_layer && lay._SelectControl) lay._SelectControl.activate();
            }
            lay.switchEditLayer(status);
//        } else if (lay.name + "_edit" != id_layer) {
//			if (status && lay.attr_editable) lay.switchEditLayer(false);
        }
    });
    this.arCategories.forEach(function (cat) {
        cat.switchEditLayer(id_layer, status);
    });
};

njs.LayerMgr.ClassicLayerCategory.prototype.openTPs = function (items, maincat) {
    var that = this;
    this.arCategories.forEach(function (cat) {
        var _bflag = true;
        if (maincat && maincat !== "") {
            if (maincat != that.id) _bflag = false;
        }
        if (_bflag) cat.openTPs(items, maincat);
    });

    var tp = dijit.byId(this._domLocation + "_" + this.id);
    if (tp) {
        if (dojo.indexOf(items, this.id) > -1) {
            if (!tp.open) tp.toggle();
        } 
	// We don't want to close all the other table panes
	/* else {
            if (tp.open) tp.toggle();
        } */
    }

	
};

njs.LayerMgr.ClassicLayerCategory.prototype.updateLayerCallParams = function(item,values){
	var updated_layers = [];
	for(var _layr in this.arLayers) {
		if(this.arLayers[_layr].widget){
			if (this.arLayers[_layr].widget.addparam){
				var _ar_params = [];
				for (var i=0;i<this.arLayers[_layr].widget.addparam.length;i++){
					
					if (this.arLayers[_layr].widget.addparam[i].source==item){
						_ar_params.push(this.arLayers[_layr].widget.addparam[i].param);
					}
				}
				if (_ar_params.length>0) {
					this.arLayers[_layr].updateLayerSource(_ar_params,values);
					var _lyr_url = (this.arLayers[_layr].type == "WMS") ? this.arLayers[_layr]._lyr.url : this.arLayers[_layr]._lyr.protocol.options.url;
					var _lay_obj = {id:this.arLayers[_layr].id,url:_lyr_url};
					updated_layers.push(_lay_obj);
				}
			}
		}
	}
	
	for (var _cats in this.arCategories) {
		var _updated_layers = this.arCategories[_cats].updateLayerCallParams(item,values);
		updated_layers = updated_layers.concat(_updated_layers);
	}
	

	return updated_layers;

};

njs.LayerMgr.ClassicLayerCategory.prototype._widgetDrawingNameSelect = function(item) {
    // Check if at least one layer from this.arLayers exists
    // among the linked_layer_id values of EditingTools.
    // If yes, set widget_editable = true; otherwise it stays false.
    let widget_editable = false;

    widget_editable = this.arLayers.some(layer =>
        Object.values(njs.AppManager.EditingTools).some(
            tool => tool.linked_layer_id === layer.id
        )
    );

    var cbx_tit = njs.AppManager.nls.lyrmgrResources["desc_"+item.group] ? njs.AppManager.nls.lyrmgrResources["desc_"+item.group] : "Zeichnung" ;

    const multi= (typeof item.multiple!='undefined' && item.multiple==true) ? "true" : "false";
    var _htm = '<span>'+cbx_tit+'</span><div class="rowplus"><select id="' + item.group + '_drawings_combo" name="' + item.group + '_drawing_combo" multiple="'+multi+'" dropdown="true" data-dojo-type="dojox/form/CheckedMultiSelect"><option value"1">1</option><option value"2">2</option></select>';
        if (item.type == "colorscheme"){
            _htm += "<button class='njsLegend'  data-dojo-type='dijit/form/Button' onclick='njs.AppManager.toggleCustomPaneContent(\"split\",\"custompane\",\""+njs.AppManager.apipath + njs.AppManager.Version+"/forms/list.php?form="+item.form+"&folder="+njs.AppManager.Folder+"&site="+njs.AppManager.Site+"&uprofile="+njs.AppManager.uprofile+"\",\"\",true)' title=''><b>+</b></button>";
    } else if (widget_editable) {
            _htm += "<button class='njsLegend'  data-dojo-type='dijit/form/Button' onclick='dojo.byId(\"" + item.group + "_add_drawing_form\").style.display == \"block\" ? dojo.byId(\"" + item.group + "_add_drawing_form\").style.display=\"none\" : dojo.byId(\"" + item.group + "_add_drawing_form\").style.display=\"block\";' title=''><b>+</b></button>";
        }
        
    if (item.type == "colorscheme" || widget_editable){
            _htm += '<button class="njsLegend" data-dojo-type="dijit/form/Button" type="button"><b>-</b>' +
            '<script type="dojo/on" data-dojo-event="click" data-dojo-args="evt">' +
            '	var _combo = dijit.byId("' + item.group + '_drawings_combo");' +
            
        '   if (_combo.options && _combo.options.length>0){' +
        '       var _ids="";' +
        '       var _itms="";' +
        '       for (var _i in _combo.options){' +
        '           if (_combo.options[_i].selected==true){' +
        '               _ids += (_ids=="") ? _combo.options[_i].value.toString() : "," + _combo.options[_i].value.toString();' +
        '               _itms += (_itms=="") ? _combo.options[_i].label.toString() : "," + _combo.options[_i].label.toString();' +
        '           }' +
        '       }' +
        '       if (_ids){' +
        '           var _del = confirm("Mochten Sie \'"+ _itms +"\' entfernen ? Alle die verfknÃ¼pfte gezeichnete Objekte werden auch gelÃ¶scht!");' +
            '           if (_del){' + 
            'require(["dojo/request/xhr"], function(xhr){' +
            '	var ar_items={};';

    }
        if (item.type == "colorscheme"){
            _htm += '	xhr("'+njs.AppManager.apipath + njs.AppManager.Version+'/forms/php/delete.php?form='+item.form+'&folder='+njs.AppManager.Folder+'&site='+njs.AppManager.Site+'&uprofile='+njs.AppManager.uprofile+'&__id__="+_id, {';
    } else if (widget_editable) {
            _htm += '	ar_items["id"]=_ids;' +
            '	ar_items["group"]="' + item.group + '";' +
            '	ar_items["dbconn_id"]="' + item.dbconn_id + '";' +
            '	ar_items["sch"]="' + item.schema + '";' +
            '	xhr("/mapplus-lib/mapplus-dojo/'+njs.AppManager.Version+'/php/mods/mod_drawing.php?action=delDrawing", {';
        }
    if (item.type == "colorscheme" || widget_editable){
        _htm += '	handleAs: "json", sync: false, preventCache: false, method:"POST",' +
            '		data:ar_items' +
            '	}).then(function(response){' +
            '       if (response && !response.error){' +
            
            '       var _combo = dijit.byId("' + item.group + '_drawings_combo");' +


            '       _combo.store.close();' +
        '           _combo.store.fetch({onComplete: function(items){' +
        '               try{var _opts=[];' +
        '               for (var i=0; i<items.length;i++){' +
        '                _opts.push({' +
        '                   "disabled":false,' +
        '                    "label": items[i].name[0],' +
        '                    "selected": false,' +
        '                    "value":items[i].id[0]' +
        '                 });' +
        '               }' +      
        '              _combo.set("options", _opts);' +
        '              _combo.startup();' +        
        '              } catch(e){console.error(e)}' +            
        '           }});' +
            '       } else{' +
            '           if (response){' +
            '               switch(response.error){' +
            '                   default:' +
            '                       alert("Eine Fehler ist aufgetretten");' +
            '                       console.error(response.error);' +
            '                       break;' +
            '               }' +
            '           } else {' +
            '               alert("Eine Fehler ist aufgetretten");' +
            '           }' +
            '       }' +
            '	});' +
            '});' +
            '       }' +
            '   }' +
            '   }' +
        '</script></button></div>';

    }
    if (item.type != "colorscheme" && widget_editable){
            _htm += "<div id='" + item.group + "_add_drawing_form' style='display:none;'><form class='rowplus' name='" + item.group + "_edit_drawing_form'>";
            _htm += '<span>Name</span><input type="text" id="' + item.group + '_name_edit_drawing" name="' + item.group + '_name_edit_drawing" data-dojo-type="dijit/form/TextBox" value="" data-dojo-props=" required:false"/>';
            
        _htm+= '<button data-dojo-type="dijit/form/Button" type="button">HinzufÃ¼gen' +
            '<script type="dojo/on" data-dojo-event="click" data-dojo-args="evt">' +
            '	var ar_items={};' +
            '	var new_item = dijit.byId("' + item.group + '_name_edit_drawing");' +
            '   if (new_item.value!=""){' +
            '	    ar_items["name"]=new_item.value;' +
            '	    ar_items["group"]="' + item.group + '";' +
            '	    ar_items["dbconn_id"]="' + item.dbconn_id + '";' +
            '	    ar_items["sch"]="' + item.schema + '";' +
            'require(["dojo/request/xhr"], function(xhr){' +
            '	xhr("/mapplus-lib/mapplus-dojo/'+njs.AppManager.Version+'/php/mods/mod_drawing.php?action=putDrawing", {' +
            '		handleAs: "json", sync: false, preventCache: false, method:"POST",' +
            '		data:ar_items' +
            '	}).then(function(response){' +
            '       if (response && !response.error){' +
            '       dojo.byId("' + item.group + '_add_drawing_form").style.display="none";' +

            '       var _combo = dijit.byId("' + item.group + '_drawings_combo");' +
            '       _combo.store.close();' +
        '       _combo.store.fetch({query: {name:ar_items["name"]}, queryOptions: {ignoreCase: true}, onComplete: function(items,request){' +
        '            var _opts=_combo.get("options");' +
        '            for (var i=0; i<_opts.length;i++){' +
        '               _opts[i].selected=false;' +
        '            }' +    
        '            _opts.push({' +
        '                "disabled":false,' +
        '                "label": items[0].name[0],' +
        '                "selected": true,' +
        '                "value":items[0].id[0]' +
        '             });' +
        '              _opts.sort((a, b) => a.label.localeCompare(b.label));' +
        '           _combo.set("options", _opts);' +
        '           _combo.startup();' +
        '        }});'+  
            '       new_item.set("value","");' +
            '       } else{' +
            '           if (response){' +
            '               switch(response.error){' +
            '                   case "name_exists":' +
            '                       _msg = njs.AppManager.nls.editingResources["error_file_exists"] ? njs.AppManager.nls.editingResources["error_file_exists"] :  response.error;' +
            '                       alert(_msg);' +
            '                       break;' +
            '                   default:' +
        '                       alert("Eine Fehler ist aufgetretten");' +
        '                       console.error(response.error);' +
            '                       break;' +
            '               }' +
            '           } else {' +
        '               alert("Eine Fehler ist aufgetretten");' +
            '           }' +
            '       }' +
            '	});' +
            '});' +
            '   }' +
            '</script></button>' +
            '</form></div>';
    }
    return _htm

};

njs.LayerMgr.ClassicLayerCategory.prototype._widgetDrawingRemoveItem = function(item) {

}

/*-------------------------------------------------------------------------------
	method setStatus
	Build the dojo GUI
--------------------------------------------------------------------------------*/
njs.Layers.prototype.setStatus = function (resol) {
    var resolution;
    if (!resol) resolution = njs.AppManager.Maps[this.targetMap].mapObj.getView().getResolution();
    else resolution = resol;

    var _zoomvisible = true;
    if (this.maxResolution != null && typeof this.maxResolution != "undefined") {
        if (resolution > this.maxResolution) _zoomvisible = false;
    }
    if (this.minResolution != null && typeof this.minResolution != "undefined") {
        if (resolution < this.minResolution) _zoomvisible = false;
    }
    // include the module sortlayers in this process
    var _item;
    try {
        if (njs.AppManager.LyrMgr[this.id_lyr_mgr]?.mod_sortlayers != null) {
            _item = dojo.byId("sort_lyr_" + this.name);
        }
    } catch (error) {
        console.info(error);
    }  

    if (!_zoomvisible) {
        // set status to 'not in range'
        if (dojo.byId(this.domLocation + this.id + "_lbl")) {
            dojo.byId(this.domLocation + this.id + "_lbl").style.fontStyle = "italic";
            dojo.byId(this.domLocation + this.id + "_lbl").style.color = "#AAAAAA";
        }

        if (_item != null && typeof _item !== "undefined") {
            dojo.addClass("sort_lyr_" + this.name, "notinrange");
        }

        if (dojo.byId(this.domLocation + this.id + "_editing")) {
            dojo.byId(this.domLocation + this.id + "_editing").style.visibility = "hidden";
        }
        if (dojo.byId(this.domLocation + this.id + "_addcontainer")) {
            dojo.byId(this.domLocation + this.id + "_addcontainer").style.display = "none";
        }
        //if (this._lyr) this._lyr.setVisibility(false);
    } else {
        // set status to 'in range'
        if (dojo.byId(this.domLocation + this.id + "_lbl")) {
            dojo.byId(this.domLocation + this.id + "_lbl").style.fontStyle = "normal";
            dojo.byId(this.domLocation + this.id + "_lbl").style.color = "#000000";
        }

        if (_item != null && typeof _item !== "undefined") {
            dojo.removeClass("sort_lyr_" + this.name, "notinrange");
        }

        if (dojo.byId(this.domLocation + this.id + "_editing")) {
            if (this.visible) {
                dojo.byId(this.domLocation + this.id + "_editing").style.visibility = "visible";

            }
            else {
                dojo.byId(this.domLocation + this.id + "_editing").style.visibility = "hidden";
                if (dojo.byId(this.domLocation + this.id + "_adder_container")) {
                    dojo.byId(this.domLocation + this.id + "_adder_container").style.display = "none";
                }
                if (dojo.byId(this.domLocation + this.id + "_adder_plus_container")) {
                    dojo.byId(this.domLocation + this.id + "_adder_plus_container").style.display = "none";
                }
                
            }
        }
        //this._lyr.setVisibility(true);
    }
    this.current_zoomvisible = _zoomvisible;
};

/*-------------------------------------------------------------------------------
	method switchEditLayer
	Switch Layer's visibility in the Map
	[boolean] status: checkbox' status
--------------------------------------------------------------------------------*/
//njs.LayerMgr.ClassicLayers.prototype.switchEditLayer = function(status){
njs.Layers.prototype.switchEditLayer = function (status) {
    if (status) {
        if (!dijit.byId(this.id).get('checked')) {
            this.switchLayer(status);
            dijit.byId(this.id).set('checked', true);
        }
//		if (this.attr_editable == 1) {
//			this.addTools();
//		}
    } else {
        this.removeTools();
        if (dijit.byId(this.id + "_edit").get('checked')) dijit.byId(this.id + "_edit").set('checked', false);
    }
    //if modoule sortlayers load the new layer order
    if (njs.AppManager.LyrMgr[this.id_lyr_mgr].mod_sortlayers != null) njs.AppManager.LyrMgr[this.id_lyr_mgr].updateSortLyrMod();
    // if module track bookmark then update the url
    if (njs.AppManager.Tools.TrackBookmark) njs.AppManager.updateMapStatusUrl(njs.AppManager.LyrMgr[this.id_lyr_mgr].targetMap[0]);
};

/*-------------------------------------------------------------------------------
	method createLayer
--------------------------------------------------------------------------------*/
//njs.LayerMgr.ClassicLayers.prototype._build = function(key,domLocation){
njs.Layers.prototype._build = function (key, domLocation) {
    //if (typeof njs.AppManager.LyrMgr[this.id_lyr_mgr]==='undefined') return;
    //add a div to the content pane in order to receive the checkbox object
    var oContainer = document.createElement("DIV");
    oContainer.id = "div_" + this.id;
    oContainer.style.margin = '2px';

    var _lyrprefix = "";
    var _lyrsuffix = "";
    if (this.legend && this.legend.link !== '') {
        _lyrprefix = "<a href='javascript:void(0)' class='njsLegend' title='" + this.tt_legend + "' onclick=njs.AppManager.showLegend('" + this.legend.link + "','" + escape(this.legend.title) + "'," + this.legend.print + "," + this.legend.extern + ")>";
        _lyrsuffix = "</a>";
    }

    var _legendiconclass = this.icon_class ? this.icon_class : "";
    oContainer.innerHTML += _lyrprefix + "<img src=\"" + this.icon + "\" alt=\"\" class=\"njsIcon legendIcon " + _legendiconclass + "\" />" + _lyrsuffix;
    oContainer.innerHTML += "&nbsp;";
    
    // visibility checkbox
    oContainer.innerHTML += "<input id=\"" + domLocation + key + "\" />&nbsp;";
    if (njs.AppManager.LyrMgr[this.id_lyr_mgr].switchLyrChkBoxAndName == true){
        var _lyrprefix = "<a href='javascript:void(0)' class='njsLegend' title='" + this.tt_layers + "'onclick=njs.AppManager.LyrMgr['" + this.id_lyr_mgr + "'].toggleLayer('" + this.id + "')>";
        var _lyrsuffix = "</a>";
    }

    if (this.open_list){
        var target='_def';      
        if (this.open_list.target)target=this.open_list.target;  
        var url = njs.AppManager.apipath+njs.AppManager.Version+"/forms/list.php?form="+this.open_list.form;
        url += "&folder=" + njs.AppManager.Folder + "&site=" + njs.AppManager.Site + "&uprofile=" + njs.AppManager.uprofile + "&ugroup=" + njs.AppManager.ugroup;
    
        switch (target) {
            case "_new":
                oContainer.innerHTML += '<span class=\'lyrlist\' onclick="njs.AppManager.openWinAndFocus(\''+url+'\', \'ext_form_'+ this.open_list.form +'\', \'width=900,height=600,location=yes,toolbar=yes\');"></span>';
                break;
            default:                
                oContainer.innerHTML += '<span class=\'lyrlist\' onclick="njs.AppManager.toggleCustomPaneContent(\'split\', \'custompane\',\''+url+'\',\'njs.AppManager.Tools.SelectTools.map.selecttools.Deactivate(true)\');"></span>';
                break;
        }      
    }

    oContainer.innerHTML += "<label id=\"" + domLocation + this.id + "_lbl\" for=\"" + domLocation + key + "\">" + _lyrprefix + this.description + _lyrsuffix + "</label>";

    if (this.editobj) {
	    // adder_point is the default class (image) for the button 'digitize object'
        var _iclass = 0;
        var _digit_tools = "";
        var _adder_plus_flag = false;
        
        var _fct_mobile="";
        var _fct_ext_cont="";

        if (njs.AppManager.isMobile) _fct_mobile="njs.AppManager.toggleCustomPaneContent(\"leftpane\",\"leftPane\",null,\"\");";
        if (njs.AppManager.EditingTools[this.editobj].external_gui != null) _fct_ext_cont="njs.AppManager.EditingTools[\"" + this.editobj + "\"].prepEditingTools(\""+domLocation + this.id+"\",\""+this.editobj+"\");";
            
        for (var _itype in njs.AppManager.EditingTools[this.editobj].geometryType){
            var _icon_class = "";
            if (njs.AppManager.EditingTools[this.editobj].icon_class && njs.AppManager.EditingTools[this.editobj].icon_class[_iclass]) _icon_class = njs.AppManager.EditingTools[this.editobj].icon_class[_iclass];
            
            var _stype = njs.AppManager.EditingTools[this.editobj].geometryType[_itype];
            
            _digit_tools += "<span id=\"" + domLocation + this.id + "_" + _stype + "\" class='adder_elem " + _icon_class + "' href='javascript:void(null)' onclick='njs.AppManager.EditingTools[\"" + this.editobj + "\"].addNewFeature(0,null,null,null,\"" + _stype + "\");"+_fct_mobile+"' title='" + njs.AppManager.nls.maptipsResources["general_new_"+_stype.toLowerCase()] + "'>" + njs.AppManager.nls.maptipsResources["general_"+_stype.toLowerCase()+"_symbol"] + "</span>";

            if (njs.AppManager.EditingTools[this.editobj].freehand && _stype != "Point") {
                _digit_tools += "<span id=\"" + domLocation + this.id + "_fh_" + _stype + "\" class='adder_elem adder_freehand' href='javascript:void(null)' onclick='njs.AppManager.EditingTools[\"" + this.editobj + "\"].addNewFeature(0,true,null,null,\"" + _stype + "\");"+_fct_mobile+"' title='" + njs.AppManager.nls.maptipsResources["general_new_"+_stype.toLowerCase()+"_freehand"] + "'>" + njs.AppManager.nls.maptipsResources["general_"+_stype.toLowerCase()+"_freehand_symbol"] + "</span>";
            }

            _iclass++;
        }
        
        if (njs.AppManager.EditingTools[this.editobj].geo_editable == 1 && njs.AppManager.EditingTools[this.editobj].create != 0) {
            var tmpContainer = "";
            var _multi_geotype = (njs.AppManager.EditingTools[this.editobj].geometryType && njs.AppManager.EditingTools[this.editobj].geometryType.length>1) ? true : false;
            if (!njs.AppManager.EditingTools[this.editobj].skip_expand_tools && (
                njs.AppManager.EditingTools[this.editobj].freehand || 
                njs.AppManager.EditingTools[this.editobj].import_kml == 1 || 
                njs.AppManager.EditingTools[this.editobj].duplicate_sel == 1 ||
                njs.AppManager.EditingTools[this.editobj].upload_fields ||
                njs.AppManager.EditingTools[this.editobj].import_shp ||
                njs.AppManager.EditingTools[this.editobj].delete_all == 1 || 
                _multi_geotype)
            ) {
                tmpContainer += "<div id=\"" + domLocation + this.id + "_editing\" class='add_button' onclick='"+_fct_ext_cont+"njs.Layout.toggle_visibility(\"" + domLocation + this.id + "_adder_container\",\"flex\");' title='" + njs.AppManager.nls.maptipsResources["general_edit"] + "'>[+]</div>";
                tmpContainer += "<span class='spacerflex'></span>";
                tmpContainer += "<div id='" + domLocation + this.id + "_adder_container' class='adder_container' style='display:none;'>";
                tmpContainer += _digit_tools;
                _adder_plus_flag = true;
            } else {
                tmpContainer += "<div id=\""+domLocation+this.id+"_editing\" >";
                tmpContainer += _digit_tools;
				
            }

            if (njs.AppManager.EditingTools[this.editobj].upload_fields) {
                if (njs.AppManager.EditingTools[this.editobj].upload_fields.item_field || njs.AppManager.EditingTools[this.editobj].upload_fields.pane) {
                    // image gps support
                    if (njs.AppManager.EditingTools[this.editobj].upload_fields.create_object!==false){

                        if (njs.AppManager.EditingTools[this.editobj].upload_fields.pane!=null && typeof njs.AppManager.EditingTools[this.editobj].upload_fields.pane != 'undefined'){
                            var _pane_url=njs.AppManager.EditingTools[this.editobj].upload_fields.pane.url;
                            if (njs.AppManager.EditingTools[this.editobj].upload_fields.form_upload!=null && typeof njs.AppManager.EditingTools[this.editobj].upload_fields.form_upload != 'undefined'){
                                _pane_url += "&form="+njs.AppManager.EditingTools[this.editobj].upload_fields.form_upload+"&formfoto="+njs.AppManager.EditingTools[this.editobj].upload_fields.form_foto+"&form_foto_fid="+njs.AppManager.EditingTools[this.editobj].upload_fields.form_foto_fid+"&form_foto_field="+njs.AppManager.EditingTools[this.editobj].upload_fields.form_foto_field;
                            } else if (njs.AppManager.EditingTools[this.editobj].upload_fields.pane!=null && typeof njs.AppManager.EditingTools[this.editobj].upload_fields.pane != 'undefined'){
                                _pane_url += "&form="+njs.AppManager.EditingTools[this.editobj].upload_fields.form_upload+"&formfoto="+njs.AppManager.EditingTools[this.editobj].upload_fields.form_foto+"&form_foto_fid="+njs.AppManager.EditingTools[this.editobj].upload_fields.form_foto_fid+"&form_foto_field="+njs.AppManager.EditingTools[this.editobj].upload_fields.form_foto_field;
                            }
                            if (njs.AppManager.EditingTools[this.editobj].upload_fields.limit_bounds) _pane_url += "&limit_bounds=" + njs.AppManager.EditingTools[this.editobj].upload_fields.limit_bounds;
                            
                            var _fct = "njs.AppManager.openCustomPaneContent(\""+njs.AppManager.EditingTools[this.editobj].upload_fields.pane.id+"\",\""+njs.AppManager.EditingTools[this.editobj].upload_fields.pane.pane+"\",\""+_pane_url+"\",\""+njs.AppManager.EditingTools[this.editobj].upload_fields.pane.close_callback+"\",\""+njs.AppManager.EditingTools[this.editobj].upload_fields.pane.hold+"\");"+_fct_mobile;
                            tmpContainer += "<span id=\""+domLocation+this.id+"_gpsimg\" class='adder_elem adder_img' href='javascript:void(null)' onclick='"+_fct+"' title='"+njs.AppManager.nls.maptipsResources["general_upload_photo"]+"'>"+njs.AppManager.nls.maptipsResources["general_upload_photo_symbol"]+"</span>";
                        } else {
                            tmpContainer += "<span id=\""+domLocation+this.id+"_gpsimg\" class='adder_elem adder_img' href='javascript:void(null)' onclick='njs.AppManager.EditingTools[\""+this.editobj+"\"].showUploadDialog(\"image\",\"new\");"+_fct_mobile+"' title='"+njs.AppManager.nls.maptipsResources["general_upload_photo"]+"'>"+njs.AppManager.nls.maptipsResources["general_upload_photo_symbol"]+"</span>";
                        }

                        
                    }
                } else {
                    var _lbl = "";
                    if (njs.AppManager.EditingTools[this.editobj].import_shp){
                        tmpContainer += "<span id=\"" + domLocation + this.id + "_shp\" class='adder_elem adder_shp' href='javascript:void(null)' onclick='njs.AppManager.EditingTools[\"" + this.editobj + "\"].showUploadDialog(\"shp\",\"new\")' title='" + njs.AppManager.nls.maptipsResources["general_import_shp"] + "'>" + njs.AppManager.nls.maptipsResources["general_import_shp_symbol"] + "</span>";
                    }
                    if (njs.AppManager.EditingTools[this.editobj].import_gpx) {
                        tmpContainer += "<span id=\"" + domLocation + this.id + "_gpx\" class='adder_elem adder_gpx' href='javascript:void(null)' onclick='njs.AppManager.EditingTools[\"" + this.editobj + "\"].showUploadDialog(\"gpx\",\"new\")' title='" + njs.AppManager.nls.maptipsResources["general_import_gpx"] + "'>" + njs.AppManager.nls.maptipsResources["general_import_gpx_symbol"] + "</span>";
                    }
                    if (njs.AppManager.EditingTools[this.editobj].import_kml) {
                        tmpContainer += "<span id=\"" + domLocation + this.id + "_kml\" class='adder_elem adder_kml' href='javascript:void(null)' onclick='njs.AppManager.EditingTools[\"" + this.editobj + "\"].showUploadDialog(\"kml\",\"new\")' title='" + njs.AppManager.nls.maptipsResources["general_import_kml"] + "'>" + njs.AppManager.nls.maptipsResources["general_import_kml_symbol"] + "</span>";
                    }
                }
            } else if (njs.AppManager.EditingTools[this.editobj].import_kml == 1) {
                // old import kml on temp layer
                tmpContainer += "<span id=\"" + domLocation + this.id + "_kml\" class='adder_elem adder_kml' href='javascript:void(null)' onclick='njs.AppManager.EditingTools[\"" + this.editobj + "\"].uploadKML()' title='" + njs.AppManager.nls.maptipsResources["general_import_kml"] + "'>" + njs.AppManager.nls.maptipsResources["general_import_kml_symbol"] + "</span>";
            }

            if (njs.AppManager.EditingTools[this.editobj].duplicate_sel) {
                tmpContainer += "<span id=\"" + domLocation + this.id + "_duplsel\" class='adder_elem adder_duplsel' href='javascript:void(null)' onclick='njs.AppManager.EditingTools[\"" + this.editobj + "\"].toggleDuplicateFromSel();"+_fct_mobile+"' title='" + njs.AppManager.nls.maptipsResources["general_import_duplicate_sel"] + "'>" + njs.AppManager.nls.maptipsResources["general_import_duplicate_sel_symbol"] + "</span>";
            }

            if (njs.AppManager.EditingTools[this.editobj].delete_all == 1) {
                tmpContainer += "<span id=\"" + domLocation + this.id + "_deleteall\" class='adder_elem adder_delall' href='javascript:void(null)' onclick='njs.AppManager.EditingTools[\"" + this.editobj + "\"].deleteAll()' title='" + njs.AppManager.nls.maptipsResources["general_delete_all"] + "'>" + njs.AppManager.nls.maptipsResources["general_delete_all_symbol"] + "</span>";
            }
				
            tmpContainer += "</div>";
            if (_adder_plus_flag){
                tmpContainer += "<span class='spacerflex'></span>";
                tmpContainer += "<div id='" + domLocation + this.id + "_adder_plus_container' class='adder_container' style='display:none;'>";
                tmpContainer += "</div>";
            }
            oContainer.innerHTML += tmpContainer;
        }
    }

    if (this.widget.date) {
        //oContainer.innerHTML += '&nbsp;<span id="'+domLocation+key+'_date"><input type="text" style="width: 90px;border-width:1px;" id="'+domLocation+key+'_datewidget" value="123" data-dojo-type="dijit/form/DateTextBox" /></span>';
		oContainer.innerHTML += '&nbsp;&nbsp;&nbsp;<input type="text" id="'+this.id+'_datewidget" />';
    } else if (this.widget.slider) {
		oContainer.innerHTML += '<p><div id="'+this.id+'_sliderwidget"></div></p>';
	} else if (this.widget.textbox) {
		oContainer.innerHTML += '<p><div>' + njs.AppManager.nls.lyrmgrResources[this.id + "_lbl_textbox"] + '</div>&nbsp;&nbsp;<div id="'+domLocation+key+'_textboxwidget"></div><p>';
    }

    oContainer.style.width = '100%';

    return oContainer;
};



njs.Layers.prototype.updateLayerSource = function(param,values){
	var _base_url = this._lyr.getSource().getUrl();
	if (_base_url){

		var linked_maptip;
		var arr_qry_lays;
		var arr_qry_lays_alias = [];
		for (var mt in njs.AppManager.MapTips){
			if (njs.AppManager.MapTips[mt].linked_layer_id && njs.AppManager.MapTips[mt].linked_layer_id==this.name){
				linked_maptip=njs.AppManager.MapTips[mt];
				var arr_qry_lays = linked_maptip.query_layers.split(',');
				var arr_qry_lays_alias = [];
				if (linked_maptip.query_layers_alias) arr_qry_lays_alias = linked_maptip.query_layers_alias.split(',');
				break;
			}

		} 
		

		for (var i=0;i<param.length;i++){

			var _start = _base_url.indexOf(param[i]+"=");
			var _end = _base_url.indexOf("&",_start);

			var _newitem = param[i]+"=";
			if (typeof values!="string") _newitem += values.join("|");
			else  _newitem += values;

			if (_start==-1){
				if (_base_url.indexOf('?')==-1) _base_url += "?";
				else _base_url += "&";
				_base_url +=_newitem;
			} else {
				if (_end==-1) _end = _base_url.length;
				_base_url = _base_url.substring(0,_start)+_newitem+_base_url.substring(_end,_base_url.length);
			}
			
		}
		
		if (linked_maptip && njs.AppManager.MapTips._wms_connector){
			for (var map in this.targetMap) {
				if (njs.AppManager.MapTips._wms_connector[this.targetMap[map]].lookupCallbacks){
					var lkups = njs.AppManager.MapTips._wms_connector[this.targetMap[map]].lookupCallbacks;
					var _tobedeleted = [];
					for (var lkup in lkups){
						var _id = lkup.split("~");
						for (var i=0;i<arr_qry_lays.length;i++) {
                            var arr_layname = [];
                            if (arr_qry_lays_alias[i] && arr_qry_lays_alias[i] != ""){
                                // supports multiple alias names as multi geometry layers in mapserver are split in three layers (point, line,polygon)
                                var _aliases = arr_qry_lays_alias[i].split("|");
                                for (var _a in _aliases){
                                    arr_layname.push(_aliases[_a].toLowerCase().replace(/[^\w]/gi, '_'));
                                }
                            } else {
                                arr_layname.push(arr_qry_lays[i].toLowerCase().replace(/[^\w]/gi, '_'));
                            }
                            for (var aln in arr_layname){
                                if (this._lyr.url.toString() + "~" + arr_layname[aln] == lkup){
                                    var _new_id = _base_url + "~" + _id[1];
                                    // do not remove existing entry if the id hasn't change, otherwise
                                    // the maptip lookup entry will erased and not resotred correctly
                                    if (_new_id!=lkup){
                                        lkups[_new_id]=[];
                                        for (var ilk = 0; ilk<lkups[lkup].length; ilk++){
                                            lkups[_new_id].push(lkups[lkup][ilk]);
                                        }
    
                                        _tobedeleted.push(lkup);
                                    }
                                }
                            }
						}
					}

					for (var lkup in lkups){
						if (_tobedeleted.indexOf(lkup)>-1)	delete lkups[lkup];
					}
				}

			}
		}

		if (this.type == "WMS") {
			this._lyr.getSource().setUrl(_base_url);
		}
	}

};

//# sourceURL=mapplus://layer_manager/ClassicLayerMgr.js

