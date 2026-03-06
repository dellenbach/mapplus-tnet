/* Copyright (c) 2010-2011 Tydac, Inc. */
/*-------------------------------------------------------------------------------
	Search Manager Object
	
	Base object for the different searches hosted by the application.
	Manage the searches's property and behaviour with the map objects
	
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.SearchManager = function(options) {
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
njs.SearchManager.prototype.Init = function(options) {
};
/*-------------------------------------------------------------------------------
	method showSearchOpt
	
	Displays the search masks
	
	[string] nodeName: search id to show
--------------------------------------------------------------------------------*/
njs.SearchManager.prototype.showSearchOpt = function(nodeName) {
    var _container = document.getElementById('search_container');
    var _opts = _container.children;
    for (var _item in _opts) {
        if (_opts[_item].id != undefined) {
            //if (_opts[_item].id.indexOf("srch_")!=-1){
            if (_opts[_item].id == nodeName) {
                _opts[_item].style.display = 'block';
            } else {
                _opts[_item].style.display = 'none';
                //if (_opts[_item].id=="srch_free") closeFreeSearch();
            }
            //}
        }
    }
};
/*-------------------------------------------------------------------------------
	Search Object
	
	Base object for the different searches hosted by the application.
	Manage the searches's property and behaviour with the map objects
	
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Search = function(options) {
    var srch_type = null;
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
njs.Search.prototype.Init = function(options) {
    this.srch_type = options.type;
    this.nearest = options.nearest ? options.nearest : null;
};
/*-------------------------------------------------------------------------------
	method Clear
	
	clears the selection
	
	
--------------------------------------------------------------------------------*/
njs.Search.prototype.Clear = function() {
    //cam v4 popup??
    /* for (var i = njs.AppManager.Maps["main"].mapObj.popups.length - 1; i >= 0; i--) {
        njs.AppManager.Maps["main"].mapObj.removePopup(njs.AppManager.Maps["main"].mapObj.popups[i]);
    } */
    feats_id = "";
    for (var i = 0; i < this.targetMap.length; i++) {
        //njs.AppManager.Maps[this.targetMap[i]].mapObj.graphics.clear();
        var _graphicInfoLyr = njs.AppManager.getLayerByName(this.targetMap[i],"cosmetic_search");        
        _graphicInfoLyr.getSource().clear();
    }
};
/*-------------------------------------------------------------------------------
	method Log
	
	Logs the selection
--------------------------------------------------------------------------------*/
njs.Search.prototype.Log = function(logtxt) {
    if (njs.AppManager.Stats != null) njs.AppManager.Stats.hitSearch(this.id, logtxt);
};

/*-------------------------------------------------------------------------------
	method _highlight
	
	draws on the map the highlighted object
	
	[obj] _highlightobj: the graphic object to be put on the map
--------------------------------------------------------------------------------*/
njs.Search.prototype._highlight = function(_highlightobj) {
    // for each related map create the graphic object and
    // add the graphic to the map's graphic layer
    this.graphics = new Array();
    for (var i = 0; i < this.targetMap.length; i++) {
        var _graphicInfoLyr = njs.AppManager.getLayerByName(this.targetMap[i],"cosmetic_search");
         //clean a previous highlight object
         _graphicInfoLyr.getSource().clear();        
        var style=njs.AppManager.Maps[this.targetMap[i]].getNewOLStyle(_highlightobj.style,_highlightobj.type);
       
        _graphicInfoLyr.setSource(_highlightobj.geometry);
        if (style) _graphicInfoLyr.setStyle(style);
        
        var new_feat = _highlightobj; 
        var myGeom = new ol.format.GeoJSON().writeFeatureObject(new_feat.geometry.getFeatures()[0]);
        myGeom.type='highlight';
        myGeom.properties=style;
        myGeom=  JSON.stringify(myGeom);
        
    }
};

njs.Search.prototype._switchSearchLayerOn = function(layer_src) {
    var lyr_mgr;
    for (var _map in this.targetMap) {
        for (var item_lyrmgr in njs.AppManager.LyrMgr) {
            if (dojo.indexOf(njs.AppManager.LyrMgr[item_lyrmgr].targetMap, this.targetMap[_map]) != -1) {
                lyr_mgr = njs.AppManager.LyrMgr[item_lyrmgr];
                lyr_mgr.switchLayer(layer_src, true);
            }
        }
    }
    if (typeof lyr_mgr == "undefined" && njs.AppManager.StartParams.srch) {
        njs.AppManager.StartParams["post_switch_layon"] = layer_src;
    }
};

njs.Search.prototype.handleStartParams = function(params) {
};

/*-------------------------------------------------------------------------------
	oneParamSearch Search Class: inherits from the Search class
		
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Search.oneParamSearch = function(srch_id, options) {
    // [int] : id of the Search
    var id = null;
    // [object] : first param object
    var firstParam = null;
    // [object] : first param object
    var firstParamStore = null;
    // [object] : first param object
    var firstParamSelect = null;
    var targetMap = null;
    var graphics = new Array();
    var warnings = null;
    // initialisation' work
    this.id = srch_id;
    if (options) {
        this.Init(options);
    }
};
njs.Search.oneParamSearch.prototype = new njs.Search;
njs.Search.oneParamSearch.prototype.constructor = njs.Search.oneParamSearch;
njs.Search.oneParamSearch.superclass = njs.Search.prototype;
/*-------------------------------------------------------------------------------
	method Init
	
	Initialisation's work
	
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Search.oneParamSearch.prototype.Init = function(options) {
    if (options) {
        njs.Search.oneParamSearch.superclass.Init.call(this, options);
        this.firstParam = options.first_param;
        this.targetMap = options.targetMap;
        this.geom_proj = options.geom_proj ? options.geom_proj : null;
        if (this.geom_proj && this.nearest) {
            this.nearest["geom_proj"] = this.geom_proj;
        }
    }
};
/*-------------------------------------------------------------------------------
	method Activate
	
	Activates the tool: links the map's extent change event with the
	scale display box
	
	[string] idmap: njs map obj id
--------------------------------------------------------------------------------*/
njs.Search.oneParamSearch.prototype.Activate = function() {
    // Create the dojo filtering selects and its related stores 
    // first param
    require(["njs/data/ComboBoxRead1ParamStore"], dojo.hitch(this, function(ComboBoxRead1ParamStore) {
        // check if static (json or csv) or dynamic load of data into store
        if (this.firstParam.dataStore.url.indexOf(".json") > -1 || this.firstParam.dataStore.url.indexOf(".csv") > -1) {
            // add the language extension if needed
            this.firstParam.dataStore.url = this.firstParam.dataStore.url.replace('#lang#', njs.AppManager.Language);
            this.firstParamStore = new dojo.data.ItemFileReadStore(this.firstParam.dataStore);
        } else {
            // add the language extension if needed
            this.firstParam.dataStore.searchTable = this.firstParam.dataStore.searchTable.replace('#lang#', njs.AppManager.Language);
            this.firstParam.dataStore.searchField = this.firstParam.dataStore.searchField.replace('#lang#', njs.AppManager.Language);
            this.firstParam.dataStore.valField = this.firstParam.dataStore.valField.replace('#lang#', njs.AppManager.Language);
            this.firstParamStore = new ComboBoxRead1ParamStore(this.firstParam.dataStore);
        }
        this.firstParam.inputField.store = this.firstParamStore;
        if (this.srch_type == "oneParamSearch") {
            this.firstParam.inputField["onKeyUp"] = dojo.hitch(this, function(e) {
                var keyCode = e.which;
                if (keyCode == undefined) {
                    keyCode = e.keyCode;
                }
                if (keyCode == 13) {
                    this.Search(1);
                }
            });
            this.firstParam.inputField["onChange"] = dojo.hitch(this, function(e) {
                this.Search(1);
            });
        } else if (this.srch_type == "twoParamSearch") {
            this.firstParam.inputField["onFocus"] = dojo.hitch(this, function(e) {
                if (!this.focushandlerselect) {
                    var _res = false;
                    if (this.secondParamSelect.attr('displayedValue') != "") {
                        this.secondParamSelect.reset();
                        this.secondParamSelect.focus();
                        _res = true;
                    }
                    if (_res) {
                        this.focushandlerselect = true;
                        this.firstParamSelect.focus();
                    }
                } else {
                    this.focushandlerselect = false;
                }
            });
            if (this.firstParam.dataStore.geomField) {
                this.firstParam.inputField["onKeyUp"] = dojo.hitch(this, function(e) {
                    var keyCode = e.which;
                    if (keyCode == undefined) {
                        keyCode = e.keyCode;
                    }
                    if (keyCode == 13) {
                        this.Search(1);
                    }
                });
                this.firstParam.inputField["onChange"] = dojo.hitch(this, function(e) {
                    this.Search(1);
                });
            }
        } else if (this.srch_type == "threeParamSearch") {
            this.firstParam.inputField["onFocus"] = dojo.hitch(this, function(e) {
                if (!this.focushandlerselect) {
                    var _res = false;
                    if (this.secondParamSelect.attr('displayedValue') != "") {
                        this.secondParamSelect.reset();
                        this.secondParamSelect.focus();
                        _res = true;
                    }
                    if (this.thirdParamSelect.attr('displayedValue') != "") {
                        this.thirdParamSelect.reset();
                        this.thirdParamSelect.focus();
                        _res = true;
                    }
                    if (_res) {
                        this.focushandlerselect = true;
                        this.firstParamSelect.focus();
                    }
                } else {
                    this.focushandlerselect = false;
                }
            });
            if (this.firstParam.dataStore.geomField) {
                this.firstParam.inputField["onKeyUp"] = dojo.hitch(this, function(e) {
                    this.Search(1);
                });
                this.firstParam.inputField["onChange"] = dojo.hitch(this, function(e) {
                    this.Search(1);
                });
            }
        }
        // placeholder (inline form)
        if (typeof this.firstParam.texts != "undefined" && this.firstParam.texts != null) {
            if (typeof this.firstParam.texts[njs.AppManager.Language].placeHolder != "undefined" && this.firstParam.texts[njs.AppManager.Language].placeHolder != null && this.firstParam.texts[njs.AppManager.Language].placeHolder != "") {
                this.firstParam.inputField["placeHolder"] = this.firstParam.texts[njs.AppManager.Language].placeHolder;
            }
        }
        this.firstParamSelect = new dijit.form.FilteringSelect(this.firstParam.inputField, this.id + "FirstParamSelect");
        if (this.nearest) {
            if (!njs.AppManager.SearchOptions[this.nearest.id]) njs.AppManager.SearchOptions[this.nearest.id] = new njs.Search.SearchDialog(this.nearest);
        }
    }));
};
/*-------------------------------------------------------------------------------
	method Search
	
	Shows on the map the searched object
	
	[int] param: level of search 1 (first),2 (second), 3 (third) param or
				 0 for unknown (to be determined)
--------------------------------------------------------------------------------*/
njs.Search.oneParamSearch.prototype.Search = function(param, userzoomlevel) {
    var feat_geom;
    var _highlightobj = null;
    if (this.firstParamStore.geomField && this.firstParamSelect.attr('displayedValue') != "" && this.firstParamSelect.attr('value') != "") {
        // get the geom attribute of the selected item
        var str_geom = this.firstParam.inputField.store.getValue(this.firstParamSelect.item, 'geom');
        if (str_geom != '') {
            feat_geom = JSON.parse(str_geom);
            // if no object then alert and return
            if (feat_geom == null) return;           
           
            for (var i = 0; i < this.targetMap.length; i++) {
                let map_proj=njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().getProjection();               
                var zFeature = new ol.source.Vector({
                    features: new ol.format.GeoJSON({featureProjection:map_proj,dataProjection:this.geom_proj}).readFeatures(feat_geom),
                }); 
              
                var _extent =zFeature.getExtent();
                var _centroid = ol.extent.getCenter(_extent);
                var _x_currmap = _centroid[0];
                var _y_currmap = _centroid[1];  
                njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setCenter(_centroid);
                
                if (feat_geom.type == 'Point') {                   
                    if (userzoomlevel != null && typeof userzoomlevel != "undefined") {
                        njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setZoom(userzoomlevel);
                    } else {
                        njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setResolution(this.firstParam.highlight_point.searchResol);
                    }
                    _highlightobj = this.firstParam.highlight_point.highlight;
                   
                } else {
                    if (parseFloat(njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().getResolutionForExtent(_extent)) < this.firstParam.highlight.searchResol) {
                        njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setResolution(this.firstParam.highlight.searchResol);
                    } else {
                        njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().fit(_extent);
                    }
                    _highlightobj = this.firstParam.highlight.highlight;
                }
            }
            // Add the feature in the highlight object
            _highlightobj.geometry = zFeature;
            _highlightobj.type= feat_geom.type;
            // highlights the selected object on the map
            this._highlight(_highlightobj);
           
            if (this.linked_layer) {
                if (this.linked_layer.type == "attribute") {
                    var lyr = attributes[this.linked_layer.item];
                    if (typeof lyr != 'undefined' && lyr != null && lyr != "") {
                        var arr_lyr = lyr.split(",");
                        for (var i = 0; i < arr_lyr.length; i++) {
                            this._switchSearchLayerOn(arr_lyr[i]);
                        }
                    }
                }
            }
            var _prj = njs.AppManager.Maps[this.targetMap[0]].mapObj.getView().getProjection().getCode();
            _centroid=ol.proj.transform(_centroid,_prj, "EPSG:4326");
            dojo.publish("search_occured", {
                "curr_x": _x_currmap,
                "curr_y": _y_currmap,
                "lon": _centroid[0],
                "lat": _centroid[1],
                "srch_id": this.id,
                "name": this.firstParamSelect.attr('displayedValue'),
                "curr_prj":_prj
            });
            if (this.nearest) {
                var opts = {
                    "idsearch": this.id,
                    "item": this.firstParamSelect.attr('displayedValue'),
                    "dbconn_id": this.firstParam.dataStore.dbconn_id,
                    "search_tbl": this.firstParam.dataStore.searchTable,
                    "field": this.firstParam.dataStore.valField,
                    "highlight_point": this.firstParam.highlight_point,
                    "highlight": this.firstParam.highlight_point,
                    "targetMap": this.targetMap
                };
                njs.AppManager.SearchOptions[this.nearest.id].QryDB(opts);
            }
        } else {
            feat_geom = null;
        }
    }
};
njs.Search.oneParamSearch.prototype.Clear = function() {
    njs.Search.oneParamSearch.superclass.Clear.call(this);
    this.firstParamSelect.reset();
    this.firstParamSelect.set('placeHolder', this.firstParam.texts[njs.AppManager.Language].placeHolder);
    if (njs.AppManager.formFloatWin) {
        njs.AppManager.formFloatWin.setContent("");
        njs.AppManager.formFloatWin.hide();
    }
};

njs.Search.oneParamSearch.prototype.GetInformation = function() {
    var that = this;
    if (this.firstParamSelect.attr('displayedValue') == '') return;
    var request = OpenLayers.Request.POST({
        url: 'forms.php',
        data:new URLSearchParams({
            FID: this.firstParamSelect.attr('displayedValue'),
            key: this.firstParam.dataStore.searchField,
            layer: this.firstParam.dataStore.searchTable,
            action: "update",
            table: this.firstParam.dataStore.searchTable,
            dbconn_id: this.firstParam.dataStore.dbconn_id,
            lang: njs.AppManager.Language,
            editable: 1
        }).toString(),
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        callback: function(resp) {
            // do something with the response
            njs.AppManager.InitFormFloatingWindow(false);
            njs.AppManager.formFloatWin.set("title", "<table border='0' cellpadding='0 cellspacing='0'><tr><td></td><td><div id='infowin_wait' class='loading_infowin' style='display:none'></div>" + that.firstParam.texts[njs.AppManager.Language].title + "</td></tr></table>");
            njs.AppManager.formFloatWin.set('content', resp.responseText);
            njs.AppManager.formFloatWin.resize({
                w: njs.AppManager.formFloatWinWidth,
                h: njs.AppManager.formFloatWinHeight
            });
            njs.AppManager.formFloatWin.resize({
                w: njs.AppManager.formFloatWinWidth,
                h: 80
            });
            // display the info window at the startup location in edit mode
            dojo.byId("njs_form_pane").style.left = njs.AppManager.formFloatWinX + "px";
            dojo.byId("njs_form_pane").style.top = njs.AppManager.formFloatWinY + "px";
            //dojo.byId("infowin_wait").style.display='none';
            njs.AppManager.formFloatWin.show();
            njs.AppManager.formFloatWin.bringToTop();
        }
    });
};

njs.Search.oneParamSearch.prototype.handleStartParams = function(startparams) {
    
    var that = this;
    
    if (!this._startparams_timer_cnt) this._startparams_timer_cnt=0;
    var _timer = setTimeout(function(){ 
        that._startparams_timer_cnt++;
        if (typeof that.firstParamSelect!=="undefined") {
            that.firstParamSelect.set('displayedValue',utf8Decode(startparams.item)); 
        } else if (that._startparams_timer_cnt<=10) {
            that.handleStartParams(startparams);
        }
    }, 100);

};

/*-------------------------------------------------------------------------------
	method destroy
	
	Clean the search: destroy the tool related events
	
--------------------------------------------------------------------------------*/
njs.Search.oneParamSearch.prototype.destroy = function() {
    this.firstParamSelect.destroyRecursive(true);
};

/*-------------------------------------------------------------------------------
	twoParamSearch Search Class: inherits from the oneParamSearch class
		
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Search.twoParamSearch = function(srch_id, options) {
    // [int] : id of the Search
    var id = null;
    // [object] : first param object
    var firstParam = null;
    // [object] : first param object
    var secondParam = null;
    // [object] : first param object
    var firstParamStore = null;
    // [object] : first param object
    var secondParamStore = null;
    // [object] : first param object
    var firstParamSelect = null;
    // [object] : first param object
    var secondParamSelect = null;
    var targetMap = null;
    var graphics = new Array();
    // initialisation' work
    this.id = srch_id;
    if (options) {
        this.Init(options);
    }
};
njs.Search.twoParamSearch.prototype = new njs.Search.oneParamSearch;
njs.Search.twoParamSearch.prototype.constructor = njs.Search.twoParamSearch;
njs.Search.twoParamSearch.superclass = njs.Search.oneParamSearch.prototype;
/*-------------------------------------------------------------------------------
	method Init
	
	Initialisation's work
	
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Search.twoParamSearch.prototype.Init = function(options) {
    if (options) {
        njs.Search.twoParamSearch.superclass.Init.call(this, options);
        this.secondParam = options.second_param;
        this.highlight_point = options.highlight_point;
    }
};
/*-------------------------------------------------------------------------------
	method Activate
	
	Activates the tool: links the map's extent change event with the
	scale display box
	
	[string] idmap: njs map obj id
--------------------------------------------------------------------------------*/
njs.Search.twoParamSearch.prototype.Activate = function() {
    // Create the dojo filtering selects and its related stores 
    // first param
    require(["njs/data/ComboBoxRead2ParamStore"], dojo.hitch(this, function(ComboBoxRead2ParamStore) {
        njs.Search.twoParamSearch.superclass.Activate.call(this);
        // second param
        if (this.secondParam.dataStore.url.indexOf(".json") > -1 || this.secondParam.dataStore.url.indexOf(".csv") > -1) {
            // add the language extension if needed
            this.secondParam.dataStore.url = this.secondParam.dataStore.url.replace('#lang#', njs.AppManager.Language);
            this.secondParamStore = new dojo.data.ItemFileReadStore(this.secondParam.dataStore);
        } else {
            // add the language extension if needed
            this.secondParam.dataStore.searchTable = this.secondParam.dataStore.searchTable.replace('#lang#', njs.AppManager.Language);
            this.secondParam.dataStore.searchField = this.secondParam.dataStore.searchField.replace('#lang#', njs.AppManager.Language);
            this.secondParam.dataStore.valField = this.secondParam.dataStore.valField.replace('#lang#', njs.AppManager.Language);
            this.secondParam.dataStore.linkedField = this.secondParam.dataStore.linkedField.replace('#lang#', njs.AppManager.Language);
            this.secondParamStore = new ComboBoxRead2ParamStore(this.secondParam.dataStore);
        }
        this.secondParam.inputField.store = this.secondParamStore;
        if (this.srch_type == "twoParamSearch") {
            this.secondParam.inputField["onKeyUp"] = dojo.hitch(this, function(e) {
                var keyCode = e.which;
                if (keyCode == undefined) {
                    keyCode = e.keyCode;
                }
                if (keyCode == 13) {
                    this.Search(2);
                }
            });
            this.secondParam.inputField["onChange"] = dojo.hitch(this, function(e) {
                this.Search(2);
            });
        } else if (this.srch_type == "threeParamSearch") {
            this.secondParam.inputField["onFocus"] = dojo.hitch(this, function(e) {
                if (!this.focushandlerselect) {
                    var _res = false;
                    if (this.thirdParamSelect.attr('displayedValue') != "") {
                        this.thirdParamSelect.reset();
                        this.thirdParamSelect.focus();
                        _res = true;
                    }
                    if (_res) {
                        this.focushandlerselect = true;
                        this.secondParamSelect.focus();
                    }
                } else {
                    this.focushandlerselect = false;
                }
            });
            if (this.secondParam.dataStore.geomField) {
                this.secondParam.inputField["onKeyUp"] = dojo.hitch(this, function(e) {
                    var keyCode = e.which;
                    if (keyCode == undefined) {
                        keyCode = e.keyCode;
                    }
                    if (keyCode == 13) {
                        this.Search(2);
                    }
                });
		this.firstParam.inputField["onChange"]=dojo.hitch(this,function(e){
			this.Search(2);
		});
            }
        }
        // placeholder (inline form)
        if (typeof this.secondParam.texts != "undefined" && this.secondParam.texts != null) {
            if (typeof this.secondParam.texts[njs.AppManager.Language].placeHolder != "undefined" && this.secondParam.texts[njs.AppManager.Language].placeHolder != null && this.secondParam.texts[njs.AppManager.Language].placeHolder != "") {
                this.secondParam.inputField["placeHolder"] = this.secondParam.texts[njs.AppManager.Language].placeHolder;
            }
        }
        this.secondParamSelect = new dijit.form.FilteringSelect(this.secondParam.inputField, this.id + "SecondParamSelect");
    }));
};
/*-------------------------------------------------------------------------------
	method Search
	
	Shows on the map the searched object
	
	[int] param: level of search 1 (first),2 (second), 3 (third) param or
				 0 for unknown (to be determined)
--------------------------------------------------------------------------------*/
njs.Search.twoParamSearch.prototype.Search = function(param) {
	var feat_geom;	
	var highlightobj=null;
	var highlightobj_point=null;
	var searchResol=null;
	
    // if the three parameters are filled and no explicit search for parameter 1 or 2 and has a geometry field (searchable)
    if (this.secondParamStore.geomField && this.secondParamSelect.attr('displayedValue') != "" && this.secondParamSelect.attr('value') != "" && param != 1) {
        // get the geom attribute of the selected item 
        var str_geom = this.secondParam.inputField.store.getValue(this.secondParamSelect.item, 'geom');
        feat_geom = JSON.parse(str_geom);
        highlightobj = this.secondParam.highlight.highlight;
        highlightobj_point = this.secondParam.highlight_point.highlight;
        searchResol = this.secondParam.searchResol;
		
        // handle the layer switching on if any
        if (this.secondParam.layer_link != undefined) {
            this._switchSearchLayerOn(this.secondParam.layer_src);
        }		
        // if the one parameter is filled and has a geometry field (searchable)
    } else if (this.firstParamStore.geomField && this.firstParamSelect.attr('displayedValue') != "" && this.firstParamSelect.attr('value') != "") {
        // get the geom attribute of the selected item 
        var str_geom = this.firstParam.inputField.store.getValue(this.firstParamSelect.item, 'geom');
        feat_geom = JSON.parse(str_geom);
        highlightobj = this.firstParam.highlight.highlight;
        highlightobj_point = this.firstParam.highlight_point.highlight;
        searchResol = this.firstParam.searchResol;
        // handle the layer switching on if any
        if (this.firstParam.layer_link != undefined) {
            this._switchSearchLayerOn(this.firstParam.layer_src);
        }
    }
    // if no object then alert and return
    if (feat_geom == null) return;
     
  
    for (var i = 0; i < this.targetMap.length; i++) {
        let map_proj=njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().getProjection();               
        var zFeature = new ol.source.Vector({
            features: new ol.format.GeoJSON({featureProjection:map_proj,dataProjection:this.geom_proj}).readFeatures(feat_geom),
        }); 
        var _extent =zFeature.getExtent();
        var _centroid = ol.extent.getCenter(_extent);
        var _x_currmap = _centroid[0];
        var _y_currmap = _centroid[1];  
        var _highlightobj;
        njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setCenter(_centroid);

        if (feat_geom.type == 'Point') {                 
            if (userzoomlevel != null && typeof userzoomlevel != "undefined") {
                njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setZoom(userzoomlevel);
            } else {
                njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setResolution(searchResol);
            }
            _highlightobj = highlightobj_point;
        } else {
            if (parseFloat(njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().getResolutionForExtent(_extent)) < searchResol) {
                njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setResolution(searchResol);
            } else {                
                njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().fit(_extent);
            }
            _highlightobj = highlightobj;
        }
	}	
    // Add the feature in the highlight object
    _highlightobj.geometry = zFeature;
    _highlightobj.type= feat_geom.type;
    // highlights the selected object on the map
    this._highlight(_highlightobj);

    var _prj = njs.AppManager.Maps[this.targetMap[0]].mapObj.getView().getProjection();
    _centroid.transform(_prj, new OpenLayers.Projection("EPSG:4326"));
    dojo.publish("search_occured", {
        "curr_x": _x_currmap,
        "curr_y": _y_currmap,
        "lon": _centroid.x,
        "lat": _centroid.y,
        "srch_id": this.id,
        "name": this.secondParamSelect.attr('displayedValue'),
        "curr_prj":_prj
    });
    this.Log(this.firstParamSelect.attr('displayedValue') + "|" + this.secondParamSelect.attr('displayedValue'));

	if (this.nearest){
		var opts = {
			"idsearch":this.id,
			"item" : this.secondParamSelect.attr('displayedValue'),
			"dbconn_id" : this.secondParam.dataStore.dbconn_id,
			"search_tbl" : this.secondParam.dataStore.searchTable,
			"field" : this.secondParam.dataStore.valField,
			"highlight_point":this.secondParam.highlight_point,
			"highlight":this.secondParam.highlight_point,
			"targetMap":this.targetMap
		};
		njs.AppManager.SearchOptions[this.nearest.id].QryDB(opts);
	}
};
/*-------------------------------------------------------------------------------
	method destroy
	
	Clean the search: destroy the tool related events
	
--------------------------------------------------------------------------------*/
njs.Search.twoParamSearch.prototype.destroy = function() {
    // calls the superclass destroy first
    njs.Search.twoParamSearch.superclass.destroy.call(this);
    this.secondParamSelect.destroyRecursive(true);
}
/*-------------------------------------------------------------------------------
	freeSearch Search Class: inherits from the Search class
		
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Search.freeSearch = function(srch_id, options) {
    // [int] : id of the Search
    var id = null;
    var freeSearchCounter;
    var targetMap = null;
    var _inputField = null;
    var inputField = null;
    var search_tab = null;
    var dbconn_id = null;
    var _filterField = null;
    var filterField = null;
    var filter_col = null;
    var filter_tab = null;
    var filter_sortorder = false;
    var filter_fixed_value = null;
    var search_fields = null;
    var search_items = null;
    var cgi = null;
    var filter_data_cgi = null;
    var graphics = new Array();
    var highlight_point = null;
    var highlight = null;
    var layer_link = null;
    var layer_src = null;
    var layer_mapping = null;
    var _onrowclick = null;
    var geom_proj = null;
    // initialisation' work
    this.id = srch_id;
    if (options) {
        this.Init(options);
    }
};
njs.Search.freeSearch.prototype = new njs.Search;
njs.Search.freeSearch.prototype.constructor = njs.Search.freeSearch;
njs.Search.freeSearch.superclass = njs.Search.prototype;
/*-------------------------------------------------------------------------------
	method Init
	
	Initialisation's work
	
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Search.freeSearch.prototype.Init = function(options) {
    if (options) {
        njs.Search.freeSearch.superclass.Init.call(this, options);
        this.targetMap = options.targetMap;
        this._inputField = options.inputField ? options.inputField : null;
        this.cgi = options.cgi;
        this.highlight_point = options.highlight_point;
        this.highlight = options.highlight;
        this.layer_link = options.layer_link;
        this.layer_src = options.layer_src;
        this.layer_mapping = options.layer_mapping;
        if (typeof options.dbconn_id != 'undefined' && options.dbconn_id != null) this.dbconn_id = options.dbconn_id;
        else this.dbconn_id = null;
        if (typeof options.search_tab != 'undefined' && options.search_tab != null) this.search_tab = options.search_tab.replace('#lang#', njs.AppManager.Language);
        else this.search_tab = null;
        if (typeof options.filterField != 'undefined' && options.filterField != null) {
            this._filterField = options.filterField;
            this._filterField.searchAttr = this._filterField.searchAttr.replace('#lang#', njs.AppManager.Language)
        } else this._filterField = null;
        if (typeof options.filter_col != 'undefined' && options.filter_col != null) this.filter_col = options.filter_col.replace('#lang#', njs.AppManager.Language);
        else this.filter_col = null;
        if (typeof options.filter_fixed_value != 'undefined' && options.filter_fixed_value != null) this.filter_fixed_value = options.filter_fixed_value.replace('#lang#', njs.AppManager.Language);
        else this.filter_fixed_value = null;
        if (typeof options.filter_sortorder != 'undefined' && options.filter_sortorder != null) this.filter_sortorder = options.filter_sortorder;
        else this.filter_sortorder = false;
        if (typeof options.search_fields != 'undefined' && options.search_fields != null) this.search_fields = options.search_fields.replace('#lang#', njs.AppManager.Language);
        else this.search_fields = "";
        if (typeof options.search_items != 'undefined' && options.search_items != null) this.search_items = options.search_items.replace('#lang#', njs.AppManager.Language);
        else this.search_items = "";
        if (typeof options.filter_tab != 'undefined' && options.filter_tab != null) this.filter_tab = options.filter_tab.replace('#lang#', njs.AppManager.Language);
        else this.filter_tab = null;
        if (typeof options.filter_data_cgi != 'undefined' && options.filter_data_cgi != null) this.filter_data_cgi = options.filter_data_cgi;
        else this.filter_data_cgi = null;
        if (typeof options.filter_data_geom != 'undefined' && options.filter_data_geom != null) this.filter_data_geom = options.filter_data_geom;
        else this.filter_data_geom = false;
        if (typeof options.linked_layer != 'undefined' && options.linked_layer != null) {
            this.linked_layer = options.linked_layer;
            this.linked_layer.item = this.linked_layer.item.replace('#lang#', njs.AppManager.Language);
        } else this.linked_layer = null;
        this.geom_proj = options.geom_proj;
    }
    this.freeSearchCounter = null;
    this._onrowclick
    this._oncompleteload
};
/*-------------------------------------------------------------------------------
	method Activate
	
	Activates the tool: links the map's extent change event with the
	scale display box
	
	[string] idmap: njs map obj id
--------------------------------------------------------------------------------*/
njs.Search.freeSearch.prototype.Activate = function() {
    // filter selectbox if any
    if (this._filterField != null) {
        var _url = this._getFilteredCGI();
        if (this.filter_data_geom) {
            this._filterField["onChange"] = dojo.hitch(this, function(e) {
                if (this.filterField.item != null) {
                    var _item = this.filterField.attr('displayedValue');
                    this._srchFilteredItem(_url, _item);
                }
            });
        }
        this._filterField.store = new dojo.data.ItemFileReadStore({
            url: _url
        })
        this.filterField = new dijit.form.FilteringSelect(this._filterField, this.id + "Filter");
    }
    // input field
    if (this._inputField) {
        this._inputField["onKeyUp"] = dojo.hitch(this, function(e) {
            clearTimeout(this.freeSearchCounter);
            this.freeSearchCounter = setTimeout('njs.AppManager.SearchOptions["' + this.id + '"].freeSearchQryDB()', 500);
        });
        // placeholder (inline form)
        if (typeof this._inputField.texts != "undefined" && this._inputField.texts != null) {
            if (typeof this._inputField.texts[njs.AppManager.Language].placeHolder != "undefined" && this._inputField.texts[njs.AppManager.Language].placeHolder != null && this._inputField.texts[njs.AppManager.Language].placeHolder != "") {
                this._inputField["placeHolder"] = this._inputField.texts[njs.AppManager.Language].placeHolder;
            }
        }
        this.inputField = new dijit.form.TextBox(this._inputField, this.id + "FreeInput");
    } else this.inputField = null;
    if (dojo.byId(this.id + "Grid")) {
        this._onrowclick = dojo.connect(dijit.byId(this.id + "Grid"), "onRowClick", this, function() {
            var row = dijit.byId(this.id + "Grid").selection.getSelected();
            var idValue = dijit.byId(this.id + "Grid").store.getValue(row[0], "geom");
            var _flds = this.search_fields.split(",");
            if (this.linked_layer) {
                if (this.linked_layer.type == "attribute") _flds.push(this.linked_layer.item);
            }
            var attr = {};
            for (var i = 0; i < _flds.length; i++) {
                attr[_flds[i]] = dijit.byId(this.id + "Grid").store.getValue(row[0], _flds[i]);
            }
            this.Search(idValue, attr);
            this.closeFreeSearch(attr);
            //dojo.byId('freesearch').value=this.store.getValue(row[0], "name");
        });
        this._oncompleteload = dojo.connect(dijit.byId(this.id + "Grid"), "_onFetchComplete", this, function() {
            // check if data is loading (the search has triggered this event)
            if (this.dataloading) {
                this.dataloading = false;
                // check if some new query has been asked in the meantime
                if (this.reloadneeded) {
                    this.reloadneeded = false;
                    this.freeSearchQryDB();
                }
            }
        });
    }
};
njs.Search.freeSearch.prototype._getFilteredCGI = function() {
    var _url;
    if (this.filter_data_cgi.indexOf("?") != -1) _url = this.filter_data_cgi + "&tab=" + this.filter_tab + "&col=" + this.filter_col + "&dbconn_id=" + this.dbconn_id + "&sort=" + this.filter_sortorder;
    else _url = this.filter_data_cgi + "?tab=" + this.filter_tab + "&col=" + this.filter_col + "&dbconn_id=" + this.dbconn_id + "&sort=" + this.filter_sortorder;
    return _url;
};
njs.Search.freeSearch.prototype._srchFilteredItem = function(_url, _item) {
    _url += "&item=" + _item;
    dojo.xhrGet({
        url: _url,
        preventCache: true,
        handleAs: "json",
        sync: false,
        load: dojo.hitch(this, function(response) {
            this.Search(response.geom, {});
        }),
        error: function(error) {
            console.error('search for geometry', error);
        }
    }); // end dojo.xhrGet
};
njs.Search.freeSearch.prototype.freeSearchQryDB = function() {
    // clear the timeout pointer
    clearTimeout(this.freeSearchCounter);
    // check if the sotre is still loading (and delay the load of the new query if so (onFetchComlete listener): grid widget errors if not)
    if (dijit.byId(this.id + "Grid").store._loadFinished) {
        this.ClearFilterFlds();
        var o_data;
        //if (dojo.byId(this.id+"FreeInput").value.length>2){
        if (dojo.byId(this.id + "FreeInput").value != "") {
            var _filterstring = "";
            if (this.filter_col != null) {
                if (typeof this.filterField != 'undefined') {
                    var _flit_val = this.filterField.attr('displayedValue');
                } else {
                    var _flit_val = "";
                }
                if (this.filter_fixed_value != null) _flit_val = this.filter_fixed_value;
                _filterstring = "&filter_col=" + this.filter_col + "&filter=" + _flit_val;
            }
            var _url;
            if (this.cgi.indexOf("?") != -1) _url = this.cgi + "&searchItem=";
            else _url = this.cgi + "?searchItem=";
            _url += dojo.byId(this.id + "FreeInput").value + "&lang=" + njs.AppManager.Language + "&dbconn_id=" + this.dbconn_id + "&srch_tab=" + this.search_tab + "&srch_fields=" + this.search_fields + "&srch_items=" + this.search_items;
            if (this.linked_layer) {
                if (this.linked_layer.type == "attribute") _url += "&linkedlay=" + this.linked_layer.item;
            }
            o_data = new dojo.data.ItemFileReadStore({
                url: _url + _filterstring,
                clearOnClose: true
            });
        } else {
            o_data = new dojo.data.ItemFileReadStore({
                data: {
                    label: "poiId",
                    items: []
                },
                clearOnClose: true
            });
        }
        dijit.byId(this.id + "Grid").selection.clear();
        dijit.byId(this.id + "Grid").store.close();
        dijit.byId(this.id + "Grid").store = o_data;
        this.dataloading = true;
        dijit.byId(this.id + "Grid").sort();
        dojo.byId(this.id + "Result").style.display = "block";
        //}
    } else {
        this.reloadneeded = true;
    }
};
njs.Search.freeSearch.prototype.freeSearchQryDBItem = function(srchfilteritem, sp_fields, srchcat) {
    var _filterstring = "";
    _filterstring = "&filter_col=" + this.filter_col + "&filter=" + srchfilteritem;
    var _cond = "";
    for (var sp in sp_fields) {
        // escape will handle the accents and spec caracters
        // pass the conditions built in a string --> db syntax dependent
        //if (_cond!="") _cond+= " and "
        //_cond+="trim("+sp+")='"+escape(sp_fields[sp].replace("'","''"))+"'";
        // pass the conditions in a list --> db syntax indipendent
        if (_cond != "") _cond += "|";
        _cond += sp + "|" + sp_fields[sp];
    }
    var _url;
    if (this.cgi.indexOf("?") != -1) _url = this.cgi + "&searchItem=";
    else _url = this.cgi + "?searchItem=";
    _url += "direct_call&lang=" + njs.AppManager.Language + "&dbconn_id=" + this.dbconn_id + "&srch_tab=" + this.search_tab + "&srch_fields=" + this.search_fields + "&srch_items=" + this.search_items;
    if (_cond != "") _url += "&sp_cond=" + _cond;
    if (this.linked_layer) {
        if (this.linked_layer.type == "attribute") _url += "&linkedlay=" + this.linked_layer.item;
    }
    var _catstring = "";
    if (typeof srchcat != 'undefined' && srchcat != null) _catstring = "&cat=" + srchcat;
    var resp = null;
    dojo.xhrGet({
        url: _url + _filterstring + _catstring,
        preventCache: true,
        handleAs: "json",
        sync: true,
        load: function(response) {
            resp = response.items[0];
        },
        error: function(error) {
            console.error('search for geometry', error);
        }
    }); // end dojo.xhrGet
    return resp;
};
njs.Search.freeSearch.prototype.closeFreeSearch = function(attr) {
    if (typeof attr != "undefined") {
        var _flds = this.search_fields.split(",");
        var _itms = this.search_items.split(",");
        var _str = attr[_flds[0]];
        if (_flds[1] && _itms.length>1) {
            _str += " (" + attr[_flds[1]] + ")";
        }
        dojo.byId(this.id + "FreeInput").value = _str;
    } else {
        dojo.byId(this.id + "FreeInput").value = "";
    }
    dojo.byId(this.id + "Result").style.display = "none";
};
/*-------------------------------------------------------------------------------
	method Search
	
	Shows on the map the searched object
	
	[string] str_geom : esri geometry to place on the map
	[object] attributes: parameters for the info window
--------------------------------------------------------------------------------*/
njs.Search.freeSearch.prototype.Search = function(str_geom, attributes, userzoomlevel) {
    var feat_geom = null;    
    var _highlightobj = null;
    var zFeature;
    
    feat_geom = JSON.parse(str_geom);           
    // if no object then alert and return
    if (feat_geom == null) return;
    
    for (var i = 0; i < this.targetMap.length; i++) {
        // transform the geom object which is in some projection in the DB into the map projection 
        let map_proj=njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().getProjection();               
        var zFeature = new ol.source.Vector({
            features: new ol.format.GeoJSON({featureProjection:map_proj,dataProjection:this.geom_proj}).readFeatures(feat_geom),
        });  

        var _extent =zFeature.getExtent();
        var _centroid = ol.extent.getCenter(_extent);
        var _x_currmap = _centroid[0];
        var _y_currmap = _centroid[1];  
        njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setCenter(_centroid);
        if (feat_geom.type == 'Point') {
            if (userzoomlevel != null && typeof userzoomlevel != "undefined") {
                njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setZoom(userzoomlevel);
            } else {
                njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setResolution(this.highlight_point.searchResol);
            }
            _highlightobj = this.highlight_point.highlight;
        } else {
            if (parseFloat(njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().getResolutionForExtent(_extent)) < this.highlight.searchResol) {
                njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setResolution(this.highlight.searchResol);
            } else {
                njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().fit(_extent);
            }
            _highlightobj = this.highlight.highlight;
        }
    }
    // Add the feature in the highlight object
    _highlightobj.geometry = zFeature;
    _highlightobj.type= feat_geom.type;
    // highlights the selected object on the map
    this._highlight(_highlightobj);

    var _prj = njs.AppManager.Maps[this.targetMap[0]].mapObj.getView().getProjection().getCode();
    _centroid=ol.proj.transform(_centroid,_prj, "EPSG:4326");
    dojo.publish("search_occured", {
        "curr_x": _x_currmap,
        "curr_y": _y_currmap,
        "lon": _centroid[0],
        "lat": _centroid[1],
        "srch_id": this.id,
        "name": attributes.name,
        "curr_prj":_prj
    });
    if (this.linked_layer) {
        if (this.linked_layer.type == "attribute") {
            var lyr = attributes[this.linked_layer.item];
            if (typeof lyr != 'undefined' && lyr != null && lyr != "") {
                var arr_lyr = lyr.split(",");
                for (var i = 0; i < arr_lyr.length; i++) {
                    this._switchSearchLayerOn(arr_lyr[i]);
                }
            }
        }
    }
};
njs.Search.freeSearch.prototype.handleStartParams = function(startparams) {
    var sp_fields = {};
    var sf = this.search_fields.split(',');
    var _flag = false;
    for (var sp in startparams) {
        if (dojo.indexOf(sf, sp) != -1) {
            sp_fields[sp] = startparams[sp];
            _flag = true;
        } else if (sp == "cat") {
            _flag = true;
        }
    }
    if (startparams.filter || _flag) {
        var _item_filter = "";
        if (typeof startparams.filter != "undefined") _item_filter = startparams.filter;
        if (_flag) {
            var resp = this.freeSearchQryDBItem(_item_filter, sp_fields, startparams.cat);
            if (resp != null) {
                var _flds = this.search_fields.split(",");
                if (this.linked_layer) {
                    if (this.linked_layer.type == "attribute") _flds.push(this.linked_layer.item);
                }
                var attr = {};
                for (var i = 0; i < _flds.length; i++) {
                    attr[_flds[i]] = resp[_flds[i]];
                }
                this.Search(resp.geom, attr, startparams.zl);
                if (resp["name"]) dojo.byId(this.id + "FreeInput").value = resp["name"];
                else dojo.byId(this.id + "FreeInput").value = utf8Decode(startparams.name);
                if (resp["category_" + njs.AppManager.Language]) dojo.byId(this.id + "FreeInput").value += " (" + utf8Decode(resp["category_" + njs.AppManager.Language]) + ")";
                else if (_item_filter != "" && typeof _item_filter != 'undefined') dojo.byId(this.id + "FreeInput").value += " (" + utf8Decode(_item_filter) + ")";
            }
        } else {
            // must decode utf8 string for dojo widget ...
			this.filterField._setDisplayedValueAttr(utf8Decode(_item_filter));
            if (this.filter_data_geom) {
                var _url = this._getFilteredCGI();
                this._srchFilteredItem(_url, _item_filter);
            }
        }
    }
};
njs.Search.freeSearch.prototype.filterCols = function() {
    var filterinputs = dojo.byId("freesearchFilterFields").getElementsByTagName("input");
    var opts = {};
    for (var ipt = 0; ipt < filterinputs.length; ipt++) {
        if (filterinputs[ipt].id.indexOf('_filter') > -1) {
            var field_name = filterinputs[ipt].id.replace("_filter", "");
            var field_val = filterinputs[ipt].value;
            if (field_val != "") opts[field_name] = new RegExp("(^|\\s)" + field_val, "gi");
        }
    }
    dijit.byId("freesearchGrid").set("query", opts);
    dijit.byId("freesearchGrid").sort();
};
njs.Search.freeSearch.prototype.ClearFilterFlds = function() {
    if (dojo.byId("freesearchFilterFields")) {
        var filterinputs = dojo.byId("freesearchFilterFields").getElementsByTagName("input");
        var opts = {};
        for (var ipt = 0; ipt < filterinputs.length; ipt++) {
            if (filterinputs[ipt].id.indexOf('_filter') > -1) {
                filterinputs[ipt].value = "";
                var field_name = filterinputs[ipt].id.replace("_filter", "");
                opts[field_name] = "*";
            }
        }
        dijit.byId("freesearchGrid").set("query", opts);
        dijit.byId("freesearchGrid").sort();
    }
};
/*-------------------------------------------------------------------------------
	method Clear
		
	clears the selection
	
	
--------------------------------------------------------------------------------*/
njs.Search.freeSearch.prototype.Clear = function() {
    njs.Search.freeSearch.superclass.Clear.call(this);
    if (dojo.byId(this.id + "FreeInput")) dojo.byId(this.id + "FreeInput").value = "";
    if (this.filterField) this.filterField.set("value", "")
};
/*-------------------------------------------------------------------------------
	method destroy

	Clean the search: destroy the tool related events

--------------------------------------------------------------------------------*/
njs.Search.freeSearch.prototype.destroy = function() {
    this.inputField.destroyRecursive(true);
    if (dojo.byId(this.id + "Grid")) {
        if (this._onrowclick != null) dojo.disconnect(this._onrowclick);
        if (this._oncompleteload != null) dojo.disconnect(this._oncompleteload);
    }
}
/*-------------------------------------------------------------------------------
	Search Additional Dialog Object
	
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Search.SearchDialog = function(options) {
    if (options) {
        // call the initialisation's function
        // if any options are passed
        this.Init(options);
    }
};
njs.Search.SearchDialog.prototype = new njs.Search;
njs.Search.SearchDialog.prototype.constructor = njs.Search.SearchDialog;
njs.Search.SearchDialog.superclass = njs.Search.prototype;
/*-------------------------------------------------------------------------------
	method Init
	
	Initialisation's work
	
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Search.SearchDialog.prototype.Init = function(options) {
    this.id = options.id;
    this.cgi = options.cgi;
    this.nearest_tbl = options.nearest_tbl;
    this.nearest_col_name = options.nearest_col_name ? options.nearest_col_name : null;
    this.nearest_col_layer = options.nearest_col_layer ? options.nearest_col_layer : null;
    this.radius = options.radius ? options.radius : null;
    this.show_only_visible = options.show_only_visible ? options.show_only_visible : false;
    this.geom_proj = options.geom_proj ? options.geom_proj : null;
    this.searchitem = null;
    // Evaluating this.id+"Grid" will reference the dijit object (grid).
    // Passing the context (this) with the dojo.connect will allow us to 
    // access this object's methodes
    this._onrowclick = dojo.connect(dijit.byId(this.id + "Grid"), "onRowClick", this, function() {
        var row = dijit.byId(this.id + "Grid").selection.getSelected();
        var idValue = dijit.byId(this.id + "Grid").store.getValue(row[0], "geom");
        var attr = {
            cat: dijit.byId(this.id + "Grid").store.getValue(row[0], "cat"),
            name: dijit.byId(this.id + "Grid").store.getValue(row[0], "name")
        };
        this.searchitem = dijit.byId(this.id + "Grid").store.getValue(row[0], "name");
        this.Search(idValue, attr);
        //this.closeDialog();
    });
    this._oncompleteload = dojo.connect(dijit.byId(this.id + "Grid"), "_onFetchComplete", this, function() {
        // check if data is loading (the search has triggered this event)
        if (this.dataloading) {
            this.dataloading = false;
            // check if some new query has been asked in the meantime
            if (this.reloadneeded) {
                this.reloadneeded = false;
                this.QryDB(this.reloadopts);
            }
        }
    });
};
njs.Search.SearchDialog.prototype.QryDB = function(opts) {
    // check if the sotre is still loading (and delay the load of the new query if so (onFetchComlete listener): grid widget errors if not)
    if (dijit.byId(this.id + "Grid").store._loadFinished) {
        this.ClearFilterFlds();
        this.highlight_point = opts.highlight_point;
        this.highlight = opts.highlight;
        this.targetMap = opts.targetMap;
        this.idsearch = opts.idsearch;
        var o_data;
        //if (dojo.byId(this.id+"FreeInput").value.length>2){
        if (opts) {
            var _url;
            if (this.cgi.indexOf("?") != -1) _url = this.cgi + "&item=";
            else _url = this.cgi + "?item=";
            _url += escape(opts.item) + "&dbconn_id=" + opts.dbconn_id + "&search_tbl=" + opts.search_tbl + "&nearest_tbl=" + this.nearest_tbl + "&field=" + opts.field;
            if (this.nearest_col_name) _url += "&nearest_col_name=" + this.nearest_col_name;
            if (this.nearest_col_layer) _url += "&nearest_col_layer=" + this.nearest_col_layer;
            if (this.radius) _url += "&radius=" + this.radius
            if (this.show_only_visible) {
                var vis_lays = "";
                var _vis_lays = njs.AppManager.getVisibleLayersByMap(this.targetMap[0]);
                for (var _lay in _vis_lays) {
                    vis_lays += _vis_lays[_lay].id + ",";
                }
                if (vis_lays != "") vis_lays = vis_lays.substring(0, vis_lays.length - 1);
                else return;

                _url += "&layers=" + vis_lays;
            }
            o_data = new dojo.data.ItemFileReadStore({
                url: _url,
                clearOnClose: true
            });
        } else {
            o_data = new dojo.data.ItemFileReadStore({
                data: {
                    label: "poiId",
                    items: []
                },
                clearOnClose: true
            });
        }
        dijit.byId(this.id + "Grid").selection.clear();
        dijit.byId(this.id + "Grid").store.close();
        dijit.byId(this.id + "Grid").store = o_data;
        this.dataloading = true;
        dijit.byId(this.id + "Grid").sort();
        var that = this;
        if (that.dialog) dojo.byId(that.id + "Result").style.display = "block";
        else {
            require(["dojo/dnd/Moveable", "dojo/dom", "dojo/domReady!"], function(Moveable, dom) {
                that.dialog = new Moveable(dom.byId(that.id + "Result"), {
                    skip: true
                });
                dojo.byId(that.id + "Result").style.display = "block";
            });
        }
    } else {
        this.reloadneeded = true;
        this.reloadopts = opts;
    }
};
njs.Search.SearchDialog.prototype.ClearFilterFlds = function() {
    if (dojo.byId(this.id + "FilterFields")) {
        var filterinputs = dojo.byId(this.id + "FilterFields").getElementsByTagName("input");
        var opts = {};
        for (var ipt = 0; ipt < filterinputs.length; ipt++) {
            if (filterinputs[ipt].id.indexOf('_filter') > -1) {
                filterinputs[ipt].value = "";
                var field_name = filterinputs[ipt].id.replace("_filter", "");
                opts[field_name] = "*";
            }
        }
        dijit.byId(this.id + "Grid").set("query", opts);
        dijit.byId(this.id + "Grid").sort();
    }
};
njs.Search.SearchDialog.prototype.filterCols = function() {
    var filterinputs = dojo.byId(this.id + "FilterFields").getElementsByTagName("input");
    var opts = {};
    for (var ipt = 0; ipt < filterinputs.length; ipt++) {
        if (filterinputs[ipt].id.indexOf('_filter') > -1) {
            var field_name = filterinputs[ipt].id.replace("_filter", "");
            var field_val = filterinputs[ipt].value;
            if (field_val != "") opts[field_name] = new RegExp("(^|\\s)" + field_val, "gi");
        }
    }
    dijit.byId(this.id + "Grid").set("query", opts);
    dijit.byId(this.id + "Grid").sort();
};
njs.Search.SearchDialog.prototype.closeDialog = function() {
    dojo.byId(this.id + "Result").style.display = "none";
};
njs.Search.SearchDialog.prototype.Search = function(str_geom, attributes, userzoomlevel) {
    var info = null;
    var _highlightobj = null;
    var zFeature;
    var feat_geom=JSON.parse(str_geom);    
    // if no object then alert and return
    if (feat_geom == null) return;
    for (var i = 0; i < this.targetMap.length; i++) {
        let map_proj=njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().getProjection();    
        var zFeature = new ol.source.Vector({
            features: new ol.format.GeoJSON({featureProjection:map_proj,dataProjection:this.geom_proj}).readFeatures(feat_geom),
        });

        var _extent =zFeature.getExtent();
        var _centroid = ol.extent.getCenter(_extent);
        var _x_currmap = _centroid[0];
        var _y_currmap = _centroid[1];  
        njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setCenter(_centroid);
        
        if (feat_geom.type == 'Point') {                   
            if (userzoomlevel != null && typeof userzoomlevel != "undefined") {
                njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setZoom(userzoomlevel);
            } else {
                njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setResolution(this.highlight_point.searchResol);
            }
            _highlightobj = this.highlight_point.highlight;
        } else {
            if (parseFloat(njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().getResolutionForExtent(_extent)) < this.highlight.searchResol) {
                njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setResolution(this.highlight.searchResol);
            } else {
                njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().fit(_extent);
            }
            _highlightobj = this.highlight.highlight;
        }
    }
    // Add the feature in the highlight object
    _highlightobj.geometry = zFeature;
    // highlights the selected object on the map
    this._highlight(_highlightobj);
    
    var _prj = njs.AppManager.Maps[this.targetMap[0]].mapObj.getView().getProjection().getCode();
    _centroid=ol.proj.transform(_centroid,_prj, "EPSG:4326");
    dojo.publish("search_occured", {
        "curr_x": _x_currmap,
        "curr_y": _y_currmap,
        "lon": _centroid[0],
        "lat": _centroid[1],
        "srch_id": this.idsearch,
        "name": this.searchitem,
        "curr_prj":_prj
    });
};
/*-------------------------------------------------------------------------------
	googleSearch Search Class: inherits from the Search class
		
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Search.googleSearch = function(srch_id, options) {
    // [int] : id of the Search
    var id = null;
    var componentRestrictions = null;
    var targetMap = null;
    var graphics = new Array();
    var warnings = null;
    // initialisation' work
    this.id = srch_id;
    if (options) {
        this.Init(options);
    }
};
njs.Search.googleSearch.prototype = new njs.Search;
njs.Search.googleSearch.prototype.constructor = njs.Search.googleSearch;
njs.Search.googleSearch.superclass = njs.Search.prototype;
/*-------------------------------------------------------------------------------
	method Init
	
	Initialisation's work
	
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Search.googleSearch.prototype.Init = function(options) {
    if (options) {
        njs.Search.googleSearch.superclass.Init.call(this, options);
        this.targetMap = options.targetMap;
        this.autocomplete_opt = options.autocomplete_opt;
        this.highlight_point = options.highlight_point;
        this.inputField = options.inputField;
        this.autocompleteListener;
        this.autocomplete;
    }
};
/*-------------------------------------------------------------------------------
	method Activate
	
	Activates the tool: links the map's extent change event with the
	scale display box
	
	[string] idmap: njs map obj id
--------------------------------------------------------------------------------*/
njs.Search.googleSearch.prototype.Activate = function() {
    var that = this;
    var gooField = dojo.byId(this.id + "SearchInput");
    if (!gooField) return;
    dojo.attr(gooField, {
        "style": this.inputField.style
    });
    this.autocomplete = new google.maps.places.Autocomplete(gooField, that.autocomplete_opt);
    this.RegisterEvent();
};
njs.Search.googleSearch.prototype.RegisterEvent = function() {
    var that = this;
    this.autocompleteListener = google.maps.event.addListener(this.autocomplete, 'place_changed', function() {
        var place = that.autocomplete.getPlace();
        if (typeof(place.geometry) !== 'undefined') {
            that.Search(place);
        }
    });
};
njs.Search.googleSearch.prototype.Search = function(place) {
    var that = this;
    var theNewGeom = [place.geometry.location.lng(), place.geometry.location.lat()];
    for (var i = 0; i < that.targetMap.length; i++) {
        let map_proj=njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().getProjection();      
        theNewGeom=ol.proj.transform(theNewGeom,"EPSG:4326",map_proj);       
        
        var zFeature = new ol.source.Vector({
            features: [
                new ol.Feature(
                    {geometry: new ol.geom.Point(theNewGeom,'XY')}
                )
            ]
        });        
        njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setCenter(theNewGeom);
        njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setResolution(that.highlight_point.searchResol);
        var _highlightobj = that.highlight_point.highlight;
        // Add the feature in the highlight object
        _highlightobj.geometry = zFeature;
        console.log(_highlightobj);
        // highlights the selected object on the map
        this._highlight(_highlightobj);
        dojo.publish("search_occured", {
            "curr_x": theNewGeom[0],
            "curr_y": theNewGeom[1],
            "lon": place.geometry.location.lng(),
            "lat": place.geometry.location.lat(),
            "srch_id": this.id,
            "name": dojo.byId(this.id + "SearchInput").value,
            "curr_prj":"EPSG:3857"
        });
    }
};
njs.Search.googleSearch.prototype.Clear = function() {
    njs.Search.googleSearch.superclass.Clear.call(this);
    dojo.byId(this.id + "SearchInput").value = "";
    google.maps.event.removeListener(this.autocompleteListener);
    this.RegisterEvent();
};

/*-------------------------------------------------------------------------------
	solrSearch Search Class: inherits from the Search class
		
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Search.solrSearch = function(srch_id, options) {
    // [int] : id of the Search
    var id = null;
    // [object] : first param object
    var firstParam = null;
    // [object] : first param object
    var firstParamStore = null;
    // [object] : first param object
    var firstParamSelect = null;
    var targetMap = null;
    var graphics = new Array();
    var warnings = null;
    // initialisation' work
    this.id = srch_id;
    if (options) {
        this.Init(options);
    }
};
njs.Search.solrSearch.prototype = new njs.Search;
njs.Search.solrSearch.prototype.constructor = njs.Search.solrSearch;
njs.Search.solrSearch.superclass = njs.Search.prototype;
/*-------------------------------------------------------------------------------
	method Init
	
	Initialisation's work
	
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Search.solrSearch.prototype.Init = function(options) {
    if (options) {
        njs.Search.solrSearch.superclass.Init.call(this, options);
        this.firstParam = options.first_param;
        this.targetMap = options.targetMap;
        this.geom_proj = options.geom_proj ? options.geom_proj : null;
        if (this.geom_proj && this.nearest) {
            this.nearest["geom_proj"] = this.geom_proj;
        }
        if (typeof options.linked_layer != 'undefined' && options.linked_layer != null) {
            this.linked_layer = options.linked_layer;
            this.linked_layer.item = this.linked_layer.item.replace('#lang#', njs.AppManager.Language);
        } else this.linked_layer = null;
    }
};
/*-------------------------------------------------------------------------------
	method Activate
	
	Activates the tool: links the map's extent change event with the
	scale display box
	
	[string] idmap: njs map obj id
--------------------------------------------------------------------------------*/
njs.Search.solrSearch.prototype.Activate = function() {
    // Create the dojo filtering selects and its related stores 
    // first param
    require(["njs/data/ComboBoxReadSolrStore"], dojo.hitch(this, function(ComboBoxReadSolrStore) {
        this.firstParam.dataStore.lang = njs.AppManager.Language;
        if (this.firstParam.filter_col && this.firstParam.filter_col != "" && this.firstParam.filter_fixed_value && this.firstParam.filter_fixed_value != ""){
            this.firstParam.dataStore.filter_col = this.firstParam.filter_col;
            this.firstParam.dataStore.filter_fixed_value = this.firstParam.filter_fixed_value;
        }
        if (this.firstParam.texts[njs.AppManager.Language].layer) this.firstParam.dataStore.layer_txt=this.firstParam.texts[njs.AppManager.Language].layer;
        this.firstParamStore = new ComboBoxReadSolrStore(this.firstParam.dataStore);
        this.firstParam.inputField.store = this.firstParamStore;
        this.firstParam.inputField.autoComplete = false;
        this.firstParam.inputField.searchAttr = "searchItem";
        this.firstParam.inputField["onKeyUp"] = dojo.hitch(this, function(e) {
            var keyCode = e.which;
            if (keyCode == undefined) {
                keyCode = e.keyCode;
            }
            if (keyCode == 13) {
                this.Search(1);
            }
        });
        this.firstParam.inputField["onChange"] = dojo.hitch(this, function(e) {
            this.Search(1);
        });
        if (njs.AppManager.isMobile) {
            this.firstParam.inputField["onInput"] = dojo.hitch(this, function(e) {
                this.Search(1);
            });
        }
        // placeholder (inline form)
        if (typeof this.firstParam.texts != "undefined" && this.firstParam.texts != null) {
            if (typeof this.firstParam.texts[njs.AppManager.Language].placeHolder != "undefined" && this.firstParam.texts[njs.AppManager.Language].placeHolder != null && this.firstParam.texts[njs.AppManager.Language].placeHolder != "") {
                this.firstParam.inputField["placeHolder"] = this.firstParam.texts[njs.AppManager.Language].placeHolder;
            }
        }
        this.firstParamSelect = new dijit.form.FilteringSelect(this.firstParam.inputField, this.id + "FirstParamSelect");
        if (this.nearest) {
            if (!njs.AppManager.SearchOptions[this.nearest.id]) njs.AppManager.SearchOptions[this.nearest.id] = new njs.Search.SearchDialog(this.nearest);
        }
    }));
};
/*-------------------------------------------------------------------------------
	method Search
	
	Shows on the map the searched object
	
	[int] param: level of search 1 (first),2 (second), 3 (third) param or
				 0 for unknown (to be determined)
--------------------------------------------------------------------------------*/
njs.Search.solrSearch.prototype.Search = function(param, userzoomlevel) {
    const store = this.firstParam?.inputField?.store;
    const item = this.firstParamSelect?.item;
    var highlightobj = null;
    if (this.firstParamSelect.attr('displayedValue') != "" && this.firstParamSelect.attr('value') != "") {
        // get the geom attribute of the selected item       
        var str_geom = (store.hasAttribute(item, 'geom')) ? store.getValue(item, 'geom'):null;
        if (str_geom != '' && str_geom != null && typeof str_geom != "undefined") {
            
            var feat_geom = JSON.parse(str_geom);            
            // if no object then alert and return
            if (feat_geom == null) return;
                    
            
            for (var i = 0; i < this.targetMap.length; i++) {
                let map_proj=njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().getProjection();               
                var zFeature = new ol.source.Vector({
                    features: new ol.format.GeoJSON({featureProjection:map_proj,dataProjection:this.geom_proj}).readFeatures(str_geom),
                });
                                
                var _extent =zFeature.getExtent();
               
                var _lonlat;
                var _x_currmap;
                var _y_currmap;
                var _centroid = ol.extent.getCenter(_extent);
                if (feat_geom.type == 'Point') {
                    _x_currmap = _centroid[0];
                    _y_currmap = _centroid[1];
                    njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setCenter(_centroid);
                    if (userzoomlevel != null && typeof userzoomlevel != "undefined") {
                        njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setZoom(userzoomlevel);
                    } else {
                        njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setResolution(this.firstParam.highlight_point.searchResol);
                    }
                    highlightobj = this.firstParam.highlight_point.highlight;
                } else {
                    _x_currmap = _centroid[0];
                    _y_currmap = _centroid[1];
                    njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setCenter(_centroid);
                    if (parseFloat(njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().getResolutionForExtent(_extent)) < this.firstParam.highlight.searchResol) {
                        njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().setResolution(this.firstParam.highlight.searchResol);
                    } else {
                        njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().fit(_extent);
                    }
                    highlightobj = this.firstParam.highlight.highlight;
                }
            }
            // Add the feature in the highlight object           
            highlightobj.geometry = zFeature;
            highlightobj.type= feat_geom.type;
          
            // highlights the selected object on the map
            this._highlight(highlightobj);
            if (this.linked_layer) {
                if (this.linked_layer.type == "attribute") {
                    var lyr = store.getValue(item, this.linked_layer.item);
                    var theme = this.linked_layer.theme ? store.getValue(item, this.linked_layer.theme) : null;
                    var subtheme = this.linked_layer.subtheme ? store.getValue(item, this.linked_layer.subtheme) : null;
                    
                    if (typeof lyr != 'undefined' && lyr != null && lyr != "") {
                        var arr_lyr = lyr.split(",");
                        for (var i = 0; i < arr_lyr.length; i++) {
                            this._switchSearchLayerOn(arr_lyr[i]);
                        }
                        
                        if (theme!=null || subtheme!=null){
                            for (var item_lyrmgr in njs.AppManager.LyrMgr) {
                                // switch the layermanager on the theme tab if "ClassicLayerMgr"
                                if (njs.AppManager.LyrMgr[item_lyrmgr].type == "ClassicLayerMgr") {
                                    
                                    if (theme!=null){
                                        var _container_id = njs.AppManager.LyrMgr[item_lyrmgr].id + "_cp_" + theme;
                                        var pane = dijit.byId(_container_id);
                                        var container = pane.getParent();
                                        // switch to the form pane but with some litle delay in order to see the selected object for a litle while
                                        container.selectChild(pane);
                                        // trigger the onclick event for container: handles the highlite of the tabs if any
                                        require(["dojo/on"], function(on) {
                                            on.emit(container.domNode, "click", {});
                                        });
                
                                    }
                                    // handle the layermanager with the subtheme tab if "ClassicLayerMgr"
                                    if (subtheme!=null){
                                        var arr_subtheme = subtheme.split(",");
                                        njs.AppManager.LyrMgr[item_lyrmgr].openTPs(arr_subtheme, null);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            var _prj = njs.AppManager.Maps[this.targetMap[0]].mapObj.getView().getProjection().getCode();
            _centroid=ol.proj.transform(_centroid,_prj, "EPSG:4326");          
            dojo.publish("search_occured", {
                "curr_x": _x_currmap,
                "curr_y": _y_currmap,
                "lon": _centroid[0],
                "lat": _centroid[1],
                "srch_id": this.id,
                "name": this.firstParamSelect.attr('displayedValue'),
                "curr_prj":_prj
            });
            if (this.nearest) {
                var opts = {
                    "idsearch": this.id,
                    "item": this.firstParamSelect.attr('displayedValue'),
                    "dbconn_id": this.firstParam.dataStore.dbconn_id,
                    "search_tbl": this.firstParam.dataStore.searchTable,
                    "field": this.firstParam.dataStore.valField,
                    "highlight_point": this.firstParam.highlight_point,
                    "highlight": this.firstParam.highlight_point,
                    "targetMap": this.targetMap
                };
                njs.AppManager.SearchOptions[this.nearest.id].QryDB(opts);
            }
        } else {
            feat_geom = null;

            if (this.linked_layer) {
                if (this.linked_layer.type == "attribute") {
                    var lyr = store.getValue(item, this.linked_layer.item);
                    var theme = this.linked_layer.theme ? store.getValue(item, this.linked_layer.theme) : null;
                    var subtheme = this.linked_layer.subtheme ? store.getValue(item, this.linked_layer.subtheme) : null;

                    if (typeof lyr != 'undefined' && lyr != null && lyr != "") {
                        var arr_lyr = lyr.split(",");
                        for (var i = 0; i < arr_lyr.length; i++) {
                            this._switchSearchLayerOn(arr_lyr[i]);
                        }

                        if (theme!=null || subtheme!=null){
                            for (var item_lyrmgr in njs.AppManager.LyrMgr) {
                                // switch the layermanager on the theme tab if "ClassicLayerMgr"
                                if (njs.AppManager.LyrMgr[item_lyrmgr].type == "ClassicLayerMgr") {
                                    
                                    if (theme!=null){
                                        var _container_id = njs.AppManager.LyrMgr[item_lyrmgr].id + "_cp_" + theme;
                                        var pane = dijit.byId(_container_id);
                                        if (typeof pane != 'undefined'){
                                        var container = pane.getParent();
                                            container.getParent().getParent().set('open',true);
                                        // switch to the form pane but with some litle delay in order to see the selected object for a litle while
                                        container.selectChild(pane);
                                        // trigger the onclick event for container: handles the highlite of the tabs if any
                                        require(["dojo/on"], function(on) {
                                            on.emit(container.domNode, "click", {});
                                        });
                
                                        }
                                    }
                                    // handle the layermanager with the subtheme tab if "ClassicLayerMgr"
                                    if (subtheme!=null){
                                        var arr_subtheme = subtheme.split(",");
                                        njs.AppManager.LyrMgr[item_lyrmgr].openTPs(arr_subtheme, null);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
};
njs.Search.solrSearch.prototype.Clear = function() {
    njs.Search.solrSearch.superclass.Clear.call(this);
    this.firstParamSelect.reset();
    this.firstParamSelect.set('placeHolder', this.firstParam.texts[njs.AppManager.Language].placeHolder);
    if (njs.AppManager.formFloatWin) {
        njs.AppManager.formFloatWin.setContent("");
        njs.AppManager.formFloatWin.hide();
    }
}


njs.Search.solrSearch.prototype.handleStartParams = function(startparams) {
    this.firstParamSelect._setDisplayedValueAttr(utf8Decode(startparams.name));
};


/*-------------------------------------------------------------------------------
	method destroy
	
	Clean the search: destroy the tool related events
	
--------------------------------------------------------------------------------*/
njs.Search.solrSearch.prototype.destroy = function() {
    this.firstParamSelect.destroyRecursive(true);
};

/*-------------------------------------------------------------------------------
	radiusObjSearch Search Class: inherits from the Search class
		
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Search.radiusObjSearch = function(srch_id, options) {
    // [int] : id of the Search
    var id = null;
    var targetMap = null;
    var graphics = new Array();
    var graphicLyr = [];
    var warnings = null;
    var current_center = null;
    // initialisation' work
    this.id = srch_id;
    if (options) {
        this.Init(options);
    }
};
njs.Search.radiusObjSearch.prototype = new njs.Search;
njs.Search.radiusObjSearch.prototype.constructor = njs.Search.radiusObjSearch;
njs.Search.radiusObjSearch.superclass = njs.Search.prototype;
/*-------------------------------------------------------------------------------
	method Init
	
	Initialisation's work
	
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Search.radiusObjSearch.prototype.Init = function(options) {
    if (options) {
        njs.Search.radiusObjSearch.superclass.Init.call(this, options);
        this.targetMap = options.targetMap;
        this.geom_proj = options.geom_proj ? options.geom_proj : null;
        this.radius = options.radius ? options.radius : null;
        this.styles = options.styles ? options.styles : null;
        this.style_key = options.style_key ? options.style_key : null;
        this.key_field = options.key_field;
        this.table = options.table;
        this.dbconn_id = options.dbconn_id;
        this.cgi = options.cgi;
        this.infoQryFields = options.infoQryFields ? options.infoQryFields : null;
    }
};
/*-------------------------------------------------------------------------------
	method Activate
	
	Activates the tool: links the map's extent change event with the
	scale display box
	
	[string] idmap: njs map obj id
--------------------------------------------------------------------------------*/
njs.Search.radiusObjSearch.prototype.Activate = function() {
    this.graphicLyr = [];
    for (var i = 0; i < this.targetMap.length; i++) {
        this.graphicLyr[this.targetMap[i]] = new OpenLayers.Layer.Vector(this.id + "_radiussrch", {
            isBaseLayer: false,
            features: [],
            visibility: true
        });
        njs.AppManager.Maps[this.targetMap[i]].mapObj.addLayer(this.graphicLyr[this.targetMap[i]]);
    }
    require(["dojo/dom", "dojo/topic", "dojo/domReady!"], dojo.hitch(this, function(dom, topic) {
        topic.subscribe("search_occured", dojo.hitch(this, function(args) {
            this.current_center = [];
            this.current_center_proj = [];
            for (var i = 0; i < this.targetMap.length; i++) {
                this.current_center_proj[this.targetMap[i]] = njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().getProjection();
                if (args.curr_x) {
                    this.current_center[this.targetMap[i]] = new ol.geom.Point([args.curr_x, args.curr_y],'XY');
                } else {
                    var _pt = new ol.geom.Point([args.lon, args.lat],'XY');
                    _pt.transform(new OpenLayers.Projection("EPSG:4326"), this.current_center_proj[this.targetMap[i]]);
                    this.current_center[this.targetMap[i]] = _pt;
                }
            }
        }));
    }));
};
/*-------------------------------------------------------------------------------
	method Search
	
	Shows on the map the searched object
	
	[int] param: level of search 1 (first),2 (second), 3 (third) param or
				 0 for unknown (to be determined)
--------------------------------------------------------------------------------*/
njs.Search.radiusObjSearch.prototype.Search = function(radius) {
    if (this.current_center && parseInt(radius) > 0) {
        this.Clear();
        for (var i = 0; i < this.targetMap.length; i++) {
            var _style = null;
            if (this.radius) _style = this.radius.style;
            var _opts = {
                radius: radius,
                c_x: this.current_center[this.targetMap[i]].x,
                c_y: this.current_center[this.targetMap[i]].y,
                c_proj: this.current_center_proj[this.targetMap[i]].getCode(),
                db_proj: this.geom_proj,
                key_field: this.key_field,
                table: this.table,
                dbconn_id: this.dbconn_id
            }
            var _map = this.targetMap[i];
            var that = this;
            require(["dijit/registry", "dojo/dom", "dojo/_base/array", "dojo/parser", "dojo/request/xhr"], function(registry, dom, array, parser, xhr) {
                xhr(that.cgi, {
                    handleAs: "json",
                    sync: false,
                    preventCache: true,
                    method: "POST",
                    data: _opts
                }).then(dojo.hitch(null, function(map, response) {
                    if (response) {
                        var geojson_format = new OpenLayers.Format.GeoJSON();
                        var _feats = geojson_format.read(response);
                        var _feats_classif = {};
                        var _feats_classif_idx = [];
                        for (var _feat in _feats) {
                            _feats[_feat].attributes.layer_id = that.graphicLyr[map].name;
                            _feats[_feat].geometry.transform(that.geom_proj, njs.AppManager.Maps[map].mapObj.getView().getProjection());
                            if (that.style_key && that.styles) {
                                var _class = _feats[_feat].attributes[that.style_key];
                                var _cs_style = that.styles[_class];
                                var _idx = _cs_style.pointRadius;
                                if (!_feats_classif[_idx]) {
                                    _feats_classif[_idx] = [];
                                    _feats_classif_idx.push(_idx);
                                }
                                _feats[_feat].style = _cs_style;
                                _feats_classif[_idx].push(_feats[_feat]);
                            } else _feats[_feat].style = _style;
                        }
                        if (_feats_classif_idx.length > 0) {
                            _feats_classif_idx.sort(function(a, b) {
                                return b - a
                            });
                            for (var i = 0; i < _feats_classif_idx.length; i++) {
                                that.graphicLyr[map].addFeatures(_feats_classif[_feats_classif_idx[i]]);
                            }
                        } else {
                            that.graphicLyr[map].addFeatures(_feats);
                        }
                        var _opts = {
                            "type": "gjsonServiceMapTip",
                            "mouseover": false,
                            "idmap": "main",
                            "key_attr": that.key_field,
                            "query_layers": that.graphicLyr[map].name,
                            "qryFields": that.infoQryFields,
                            "url": "local_attributes"
                        }
                        if (!njs.AppManager.nls.maptipsResources) njs.AppManager["maptipsResources"] = {};
                        if (!njs.AppManager.MapTips[that.graphicLyr[map].name]) {
                            njs.AppManager.MapTips[that.graphicLyr[map].name] = new njs.MapTip.gjsonServiceMapTip(that.graphicLyr[map].name, _opts);
                            njs.AppManager.MapTips[that.graphicLyr[map].name].Activate();
                        }
                        var options = {
                            "id_maptip": njs.AppManager.MapTips[that.graphicLyr[map].name].id,
                            "key_attr": njs.AppManager.MapTips[that.graphicLyr[map].name].key_attr,
                            "connector": njs.AppManager.MapTips[that.graphicLyr[map].name].connector_type
                        };
                        njs.AppManager.MapTips["_gjson_conn_click"][map].addLayer(that.graphicLyr[map], njs.AppManager.MapTips[that.graphicLyr[map].name].url, njs.AppManager.MapTips[that.graphicLyr[map].name].query_layers, options);                       
                    }
                }, _map), function(err) {
                    // Handle the error condition
                    console.error("Error: %o", err);
                });
            });
            // nust calculate the radius in the units of the data stored in the database otherwise happen distortions in the radius
            var _curr_cent = this.current_center[this.targetMap[i]].clone();
            _curr_cent.transform(this.current_center_proj[this.targetMap[i]], this.geom_proj);
            var _perim = OpenLayers.Geometry.Polygon.createRegularPolygon(_curr_cent, radius, 60, 0);
            _perim.transform(this.geom_proj, njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().getProjection());
            this.graphicLyr[this.targetMap[i]].addFeatures(new OpenLayers.Feature.Vector(_perim, null, _style));
            njs.AppManager.Maps[this.targetMap[i]].mapObj.getView().fit(_perim.bounds)
        }
    }
};
njs.Search.radiusObjSearch.prototype.Clear = function() {
    for (var i = 0; i < this.targetMap.length; i++) {
        var arr_feat_ids = [];
        
        this.graphicLyr[this.targetMap[i]].getSource().clear();
    }
};
njs.Search.radiusObjSearch.prototype.clearCenter = function() {
    this.current_center = null;
    this.current_center_proj = null;
};
//# sourceURL=mapplus://search.js
