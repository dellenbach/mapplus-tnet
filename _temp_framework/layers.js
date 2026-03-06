"use strict";
/* Copyright (c) 2010-2011 Tydac, Inc. */
/* global njs */
/* jslint node: true */
/*-------------------------------------------------------------------------------
    method switchLayer
--------------------------------------------------------------------------------*/
njs.Layers.prototype.switchLayer = function (status) {    
    // difference of the status must be checked, because non visible
    // layer is removed and cannot be removed twice
    if (typeof this.visible == 'undefined') this.visible = false;
    if (this.visible != status) {
        //njs.AppManager.LyrMgr[this.id_lyr_mgr]._nb_lyr_cnt = (status===true) ? njs.AppManager.LyrMgr[this.id_lyr_mgr]._nb_lyr_cnt++ : njs.AppManager.LyrMgr[this.id_lyr_mgr]._nb_lyr_cnt--;
        if (status == true) njs.AppManager.LyrMgr[this.id_lyr_mgr]._nb_lyr_cnt++;
        else njs.AppManager.LyrMgr[this.id_lyr_mgr]._nb_lyr_cnt--;
        this.visible = status;
        for (var map in this.targetMap) {
            var _map = this.targetMap[map];
            var vislay = null;
            if (status) {
               
                //njs.AppManager.Maps[_map].mapObj.addLayer(this._lyr);
                var _rank_candidate;
                var _rank;
                if (this.rank == 1) {
                    this.timestamp = Math.round(+new Date()); // + sign triggers "valueOf" then gets timestamp
                    _rank_candidate = this.timestamp;
                } else if (this.rank > 1) {
                    _rank_candidate = this.rank;
                    this.timestamp = null;
                }
                // get and parse the visible layers (sorted by rank) in order to compare the rank with the
                // effective open layers layer index
                vislay = njs.AppManager.LyrMgr[this.id_lyr_mgr].getAllVisibleLayers();               

                var _cur_idx = 0;
                var lay_idx = -1;

                var ar_lay_idx = [];

                for (var i = 0; i < vislay.length; i++) {
                    if (vislay[i].rank == 1) _rank = vislay[i].timestamp;
                    else _rank = vislay[i].rank;

                    if (this.name != vislay[i].name) {
                        _cur_idx = njs.AppManager.getLayerIndexByName(_map, vislay[i].name);
                        if (lay_idx < _cur_idx) lay_idx = _cur_idx;

                        // Must check all the indexes of the layers with rank >= than the candidate
                        // as some layers have the same rank and can be mixed in the layer stack
                        // then build an array and uses the min value later
                        if (parseFloat(_rank_candidate) <= parseFloat(_rank)) {
                            lay_idx = _cur_idx;
                            ar_lay_idx.push(_cur_idx);
                            //do not break here
                        }
                    }
                }
                if (lay_idx == -1) lay_idx = 1;
                else if (ar_lay_idx.length > 0) {
                    // use of 'apply' in prototype in order to decompose an array
                    // as Math funct use a number serie
                    lay_idx = Math.min.apply(null, ar_lay_idx);
                } else lay_idx++;

                try {        
                    njs.AppManager.Maps[_map].mapObj.getLayers().insertAt(lay_idx, this._lyr)                 
                } catch (error) {
                    console.log(error);
                }                

                // see if the map has a mask layer
                if (njs.AppManager.Maps[_map].mask_layer && njs.AppManager.Maps[_map].mask_layer != null)
                    njs.AppManager.Maps[_map].mask_layer_obj._lyr.setZIndex(9999);
                this.registerSymbolScaleEvents();
            } else {
                if (this.editobj) njs.AppManager.EditingTools[this.editobj].stopEditing();
                this.unregisterSymbolScaleEvents();
                njs.AppManager.Maps[_map].mapObj.removeLayer(this._lyr);
            }
        }
        this.setStatus(null);
        // open the legend if defined to open automatically in the general_settings of the legend.conf
        if (this.visible && njs.config.legends.general_settings.show_on_layer_on && this.get('legend')) {
            njs.AppManager.showLegend(this.get('legend').link, this.get('legend').title);
        }
    }

};

/*-------------------------------------------------------------------------------
    method removeLayer
--------------------------------------------------------------------------------*/
njs.Layers.prototype.removeLayer = function () {

    this.visible = false;
    for (var map in this.targetMap) {
        var _map = this.targetMap[map];
        njs.AppManager.Maps[_map].mapObj.removeLayer(this._lyr);
    }
};

/*-------------------------------------------------------------------------------
    method removeLayer
--------------------------------------------------------------------------------*/
njs.Layers.prototype.addLayer = function () {

    this.visible = true;
    for (var map in this.targetMap) {
        var _map = this.targetMap[map];
        njs.AppManager.Maps[_map].mapObj.addLayer(this._lyr);
    }

};

njs.Layers.prototype.registerEvents = function () {
    var that = this;
    var firstStartflag=[];
    var ghostRes=[];
    for (var map in this.targetMap) {
        var _map = this.targetMap[map];
        firstStartflag[_map]=true;
        njs.AppManager.Maps[_map].mapObj.on('precompose', function (evt) {
            if (firstStartflag[_map]) that.setStatus();           
            firstStartflag[_map]=false;
        }); 
        ghostRes[_map] =  njs.AppManager.Maps[_map].mapObj.getView().getResolution();
        njs.AppManager.Maps[_map].mapObj.on('moveend', (function() {
            let res =njs.AppManager.Maps[_map].mapObj.getView().getResolution();
            if (ghostRes[_map] != res) {                  
                ghostRes[_map] = res;
                that.setStatus(ghostRes[_map]);
            }
        }));
    }
};

njs.Layers.prototype.registerSymbolScaleEvents = function () {
};

njs.Layers.prototype.unregisterSymbolScaleEvents = function () {
};

//=====================================================================================================
//		WMS
//=====================================================================================================

/*-------------------------------------------------------------------------------
    method Init
    Initialisation's work
    [object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Layers.WMS.prototype.Init = function (options) {    
    njs.Layers.WMS.superclass.Init.call(this, options);
    if (this.id, this.url, options) {
        this._MapTips = options.mapTips;

        this.base_url = options.base_url ? options.base_url : null;
        this.widget = options.widget ? options.widget : {};

        if (this.legend != null && typeof this.legend != "undefined") options.options.legend = this.legend;
       
        options.options.opacity = options.options.opacity ? options.options.opacity : 1

        var sourceopt={
            url: this.url,
            ratio: 1.0,
            crossOrigin:(typeof options.crossOrigin !='undefined')?options.crossOrigin:'anonymous',           
            projection:options.options.projection,
            params: upperizeObjKeys(options.params)
        };
        if (options.tileGrid)sourceopt.tileGrid=options.tileGrid;
        if (options.options.singleTile){
            var tydLayer=ol.layer.Image; 
            var tydWMS=ol.source.ImageWMS; 
        }else{
            var tydLayer=ol.layer.Tile; 
            var tydWMS=ol.source.TileWMS; 
        }         
        this._lyr = new tydLayer({
            source: new tydWMS(sourceopt)
        });
        this._lyr.set('name', this.id);
        this._lyr.set('type', 'WMS');  
        if (this.maxResolution != null && typeof this.maxResolution != "undefined") this._lyr.set('maxResolution',  this.maxResolution+0.0001); 
        if (this.minResolution != null && typeof this.minResolution != "undefined") this._lyr.set('minResolution',  this.minResolution);       
        this._lyr.setProperties(options.options);
        this._tools = options.tools ? options.tools : null;

        if (options.options) {
            if (options.options.opacity != null && typeof options.options.opacity != "undefined") this.opacity = options.options.opacity;
        }

        this.tools = [];

        this.registerEvents();
    }
};

/*-------------------------------------------------------------------------------
    method switchLayer
--------------------------------------------------------------------------------*/
njs.Layers.WMS.prototype.switchLayer = function (status) {
    njs.Layers.WMS.superclass.switchLayer.call(this, status);

    //if (!status) this.switchEditLayer(false);
};

njs.Layers.WMS.prototype.toggleLayer = function (status) {
    njs.Layers.WMS.superclass.switchLayer.call(this, status);
};

/*-------------------------------------------------------------------------------
    method addTools
--------------------------------------------------------------------------------*/
njs.Layers.WMS.prototype.addTools = function () {
    var that = this;
    for (var _tool in this.tools) {
        var rnd = Math.round(10000000 * Math.random());
        eval("var " + _tool + "Control = this.tools['" + _tool + "'];");
        //add a control button to current layer's layout
        //blank div
        var oDivBtn = document.createElement("DIV");
        oDivBtn.innerHTML = '';
        dojo.byId("div_" + this.id).appendChild(oDivBtn);

        //button's div
        oDivBtn = document.createElement("DIV");
        oDivBtn.id = "div_btn" + this.id + "_" + rnd;
        oDivBtn.style.width = "30px";
        oDivBtn.style.display = "inline";

        //dojo.byId("div_"+this.id).style.width = "300px";
        dojo.byId("div_" + this.id).appendChild(oDivBtn);

        this._ctrButtons.length++;
        this._ctrButtons[this._ctrButtons.length - 1] = new dijit.form.ToggleButton({
            id: "btn" + this.id + "_" + rnd,
            name: _tool,
            showLabel: false,
            label: this._tools[_tool].options.texts ? this._tools[_tool].options.texts[njs.AppManager.Language].description : '',
            iconClass: this._tools[_tool].options.iconClass,
            onChange: function (status) {
                for (var _tool in that._ctrButtons) {
                    eval(that._ctrButtons[_tool].name + "Control.deactivate()");
                    that._ctrButtons[_tool].checked = false;
                }
                if (status) {
                    eval(this.name + "Control.activate()");
                    this.checked = true;
                }
                else {
                    eval(this.name + "Control.deactivate()");
                    this.checked = false;
                }
            }
        }, "div_btn" + this.id + "_" + rnd);
    }
};

//=====================================================================================================
//		WMS
//=====================================================================================================

/*-------------------------------------------------------------------------------
    method Init
    Initialisation's work
    [object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Layers.arcgisRest.prototype.Init = function (options) {    
    njs.Layers.arcgisRest.superclass.Init.call(this, options);
    if (this.id, this.url, options) {
        this._MapTips = options.mapTips;

        this.base_url = options.base_url ? options.base_url : null;
        this.widget = options.widget ? options.widget : {};

        if (this.legend != null && typeof this.legend != "undefined") options.options.legend = this.legend;
        options.options.opacity = options.options.opacity ? options.options.opacity : 1
        var sourceopt={
            url: this.url,
            ratio: 1.0,
            crossOrigin:(typeof options.crossOrigin !='undefined')?options.crossOrigin:'anonymous',          
            projection:options.options.projection,
            params: upperizeObjKeys(options.params)
        };
        if (options.tileGrid)sourceopt.tileGrid=options.tileGrid;
        if (options.options.singleTile){
            var tydLayer=ol.layer.Image; 
            var tydWMS=ol.source.ImageArcGISRest; 
        }else{
            var tydLayer=ol.layer.Tile; 
            var tydWMS=ol.source.TileArcGISRest; 
        }         
        this._lyr = new tydLayer({
            source: new tydWMS(sourceopt)
        });
        this._lyr.set('name', this.id);
        this._lyr.set('type', 'arcgisRest');  
        if (this.maxResolution != null && typeof this.maxResolution != "undefined") this._lyr.set('maxResolution',  this.maxResolution+0.0001); 
        if (this.minResolution != null && typeof this.minResolution != "undefined") this._lyr.set('minResolution',  this.minResolution);       
        this._lyr.setProperties(options.options);
        this._tools = options.tools ? options.tools : null;

        if (options.options) {
            if (options.options.opacity != null && typeof options.options.opacity != "undefined") this.opacity = options.options.opacity;
        }

        this.tools = [];

        this.registerEvents();
    }
};

/*-------------------------------------------------------------------------------
    method switchLayer
--------------------------------------------------------------------------------*/
njs.Layers.arcgisRest.prototype.switchLayer = function (status) {
    njs.Layers.arcgisRest.superclass.switchLayer.call(this, status);

    //if (!status) this.switchEditLayer(false);
};

njs.Layers.arcgisRest.prototype.toggleLayer = function (status) {
    njs.Layers.arcgisRest.superclass.switchLayer.call(this, status);
};

/*-------------------------------------------------------------------------------
    method addTools
--------------------------------------------------------------------------------*/
njs.Layers.arcgisRest.prototype.addTools = function () {
    var that = this;
    for (var _tool in this.tools) {
        var rnd = Math.round(10000000 * Math.random());
        eval("var " + _tool + "Control = this.tools['" + _tool + "'];");
        //add a control button to current layer's layout
        //blank div
        var oDivBtn = document.createElement("DIV");
        oDivBtn.innerHTML = '';
        dojo.byId("div_" + this.id).appendChild(oDivBtn);

        //button's div
        oDivBtn = document.createElement("DIV");
        oDivBtn.id = "div_btn" + this.id + "_" + rnd;
        oDivBtn.style.width = "30px";
        oDivBtn.style.display = "inline";

        //dojo.byId("div_"+this.id).style.width = "300px";
        dojo.byId("div_" + this.id).appendChild(oDivBtn);

        this._ctrButtons.length++;
        this._ctrButtons[this._ctrButtons.length - 1] = new dijit.form.ToggleButton({
            id: "btn" + this.id + "_" + rnd,
            name: _tool,
            showLabel: false,
            label: this._tools[_tool].options.texts ? this._tools[_tool].options.texts[njs.AppManager.Language].description : '',
            iconClass: this._tools[_tool].options.iconClass,
            onChange: function (status) {
                for (var _tool in that._ctrButtons) {
                    eval(that._ctrButtons[_tool].name + "Control.deactivate()");
                    that._ctrButtons[_tool].checked = false;
                }
                if (status) {
                    eval(this.name + "Control.activate()");
                    this.checked = true;
                }
                else {
                    eval(this.name + "Control.deactivate()");
                    this.checked = false;
                }
            }
        }, "div_btn" + this.id + "_" + rnd);
    }
};

/*-------------------------------------------------------------------------------
    method Init
    Initialisation's work
    [object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Layers.TMS.prototype.Init = function (options) {
    var that = this;
    njs.Layers.TMS.superclass.Init.call(this, options);
    if (options) {
        this._MapTips = options.mapTips;

        this._tools = options.tools ? options.tools : null;
        var opt = options.options;       
        
        opt.opacity = opt.opacity ? opt.opacity : 1
        
        this._lyr = new ol.layer.Tile({
            preload: 0,
            transition: 0,
            source: new ol.source.TileImage({
                crossOrigin:(typeof options.crossOrigin !='undefined')?options.crossOrigin:'anonymous',
                projection: opt['projection'],
                tileGrid: new ol.tilegrid.TileGrid({
                    origin: opt['tileOrigin'],
                    resolutions:opt['resolutions'] ? opt['resolutions'] :njs.AppManager.Maps['main'].resolutions    
                }),
                tileUrlFunction: function (coordinate) {
                    return that.url + '/1.0.0/' + opt['layername'] + '/' + coordinate[0] + '/' + coordinate[1] + '/' + (-coordinate[2] - 1) + '.' + opt['type'];
                }
            })
        });
        this._lyr.setProperties(options.options);
        this._lyr.set('name', this.id);
        this._lyr.set('type', 'TMS'); 
        if (this.maxResolution != null && typeof this.maxResolution != "undefined") this._lyr.set('maxResolution',  this.maxResolution+0.0001); 
        if (this.minResolution != null && typeof this.minResolution != "undefined") this._lyr.set('minResolution',  this.minResolution); 
        this.tools = [];
        this.registerEvents();
    }
};

/*-------------------------------------------------------------------------------
    method switchLayer
--------------------------------------------------------------------------------*/
njs.Layers.TMS.prototype.switchLayer = function (status) {
    njs.Layers.TMS.superclass.switchLayer.call(this, status);
};

/*-------------------------------------------------------------------------------
    method toggleLayer
--------------------------------------------------------------------------------*/
njs.Layers.TMS.prototype.toggleLayer = function (status) {
    njs.Layers.TMS.superclass.switchLayer.call(this, status);
};

/*-------------------------------------------------------------------------------
method Init
Initialisation's work
[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Layers.WMTS.prototype.Init = function (options) {
    njs.Layers.WMTS.superclass.Init.call(this, options);

    if (options) {
        this._MapTips = options.mapTips;
        if (options.urlcapabilities && options.urlcapabilities != '') {
            var parser = new ol.format.WMTSCapabilities();
            var proxy = '/mapplus-lib/mapplus-dojo/' + njs.AppManager.Version + '/php/proxy/cors_proxy.php?url=';
            var url_capab = options.urlcapabilities;
            var pattern = /^[a-zA-Z]+:\/\/.*$/;
            if (pattern.test(url_capab.toString()) || url_capab.toString().indexOf('//') == 0) {
                url_capab = proxy + encodeURIComponent(url_capab);
            }

            this._lyr = new ol.layer.Tile({
                opacity: options.options.opacity ? options.options.opacity : 1
            });
           
            var that = this;
            fetch(url_capab).then(function (response) {
                return response.text();
            }).then(function (text) {
                var result = parser.read(text);
                let wmtsopts = ol.source.WMTS.optionsFromCapabilities(result,{ layer: options.params.layer });
                for (let key in wmtsopts.dimensions) {
                    if (options.params[key])wmtsopts.dimensions[key]=options.params[key];
                }
                wmtsopts.crossOrigin=(typeof options.crossOrigin !='undefined')?options.crossOrigin:'anonymous';               
                that._lyr.setSource(new ol.source.WMTS(wmtsopts));
            });
            this._lyr.setProperties(options.options);           
        } else {
            var matrixIds = [];
            var istart=0;
            if (options.zoomOffset)istart+=options.zoomOffset;
            for (var i = istart; i < options.resolutions.length+istart; i++) {
                matrixIds.push(i);
            }
            var requestEncoding = "REST";           
            this._lyr = new ol.layer.Tile({  
                opacity:  options.opacity ? options.opacity : 1, 
                extent:options.restrictedExtent?options.restrictedExtent:options.maxExtent,       
                source: new ol.source.WMTS(({     
                    crossOrigin:(typeof options.crossOrigin !='undefined')?options.crossOrigin:'anonymous',   
                    url: options.url,
                    tileGrid: new ol.tilegrid.WMTS({
                        origin: [options.maxExtent[0], options.maxExtent[3]],                      
                        resolutions: options.resolutions,
                        matrixIds: matrixIds
                    }),
                    projection:options.projection,
                    layer: options.layer,
                    requestEncoding:options.requestEncoding ? options.requestEncoding :requestEncoding

                }))
            });          
        }
        this._lyr.set('name', this.id);        
        this._lyr.set('type', 'WMTS'); 
        if (this.maxResolution != null && typeof this.maxResolution != "undefined") this._lyr.set('maxResolution',  this.maxResolution+0.0001); 
        if (this.minResolution != null && typeof this.minResolution != "undefined") this._lyr.set('minResolution',  this.minResolution); 
        if (options.options) {
            if (options.options.opacity != null && typeof options.options.opacity != "undefined") this.opacity = options.options.opacity;
        }

        this.tools = [];
        this.registerEvents();
    }
};

/*-------------------------------------------------------------------------------
method switchLayer
--------------------------------------------------------------------------------*/
njs.Layers.WMTS.prototype.switchLayer = function (status) {
    njs.Layers.WMTS.superclass.switchLayer.call(this, status);
};

/*-------------------------------------------------------------------------------
method toggleLayer
--------------------------------------------------------------------------------*/
njs.Layers.WMTS.prototype.toggleLayer = function (status) {
    njs.Layers.WMTS.superclass.switchLayer.call(this, status);
};

/*-------------------------------------------------------------------------------
    method Init
    Initialisation's work
    [object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Layers.GeoJSON.prototype.Init = function (options) {
    var that = this;  
    this.visible = false;
   
    njs.Layers.GeoJSON.superclass.Init.call(this, options);
    this.base_url = options.base_url ? options.base_url : null;
    this.widget = options.widget ? options.widget : {};
   
    this._lyr = null;  
    
    this.key_name_attr = options.key_name_attr;
    //use proxy if not relative path
    var pattern = /^((?:http|ftp)s?:\/\/).*/;
    var jsonurl = options.protocol.url

    if (pattern.test(options.protocol.url)) jsonurl = '/mapplus-lib/mapplus-dojo/' + njs.AppManager.Version + '/php/proxy/cors_proxy.php?url=' + encodeURIComponent(options.protocol.url);
    jsonurl=jsonurl.replace('#lang#', njs.AppManager.Language);    
  
    const loadingStrategy=(options.olLoadingstrategy=='bbox')?ol.loadingstrategy.bbox:ol.loadingstrategy.all;    

    var vectorSource  = new ol.source.Vector({
        crossOrigin:(typeof options.crossOrigin !='undefined')?options.crossOrigin:'anonymous',
        projection:options.projection,
        format: new ol.format.GeoJSON({
            dataProjection:options.projection,
            featureProjection: njs.AppManager.Maps['main'].mapObj.getView().getProjection()
        }),           
        loader: function(extent, resolution, projection, success, failure) {
            var url = jsonurl;
            if (options.olLoadingstrategy=='bbox')url+='?proj='+options.projection+'&bbox=' + ol.proj.transformExtent(extent,projection,options.projection).join(',');
            fetch(url).then(function(response) {
                return response.text();
            }).then(function(resp) {
                const features = vectorSource.getFormat().readFeatures(resp);
                vectorSource.addFeatures(features);
                success(features);
            }).catch(function(err) {
                console.log(err);
                vectorSource.removeLoadedExtent(extent);
                failure();
            })
        },
        strategy:loadingStrategy       
    });

    this._lyr  = new ol.layer.Vector ({
        projection:options.projection,        
        style: function (feature) {            
            const symb_class_def=options.styleMap.default.classes[feature.get(options.class_type_attr)] ? options.styleMap.default.classes[feature.get(options.class_type_attr)] : options.styleMap.default.default;
            var style = new ol.style.Style({
                image: new ol.style.Icon({
                    width: options.styleMap.default.pointRadius*2,        
                    src: options.styleMap.default.symb_root+symb_class_def.symb,
                }),
                zIndex:symb_class_def.zIndex
            });                           
            return style;
        },
        source: vectorSource            
    });
    
    this._lyr.set('name', this.id);  
    this._lyr.set('type', 'GeoJSON');  
    if (this.maxResolution != null && typeof this.maxResolution != "undefined") this._lyr.set('maxResolution',  this.maxResolution+0.0001); 
    if (this.minResolution != null && typeof this.minResolution != "undefined") this._lyr.set('minResolution',  this.minResolution); 
    this.save_url = '';

    this.tools = [];
    if(options.strategies && options.strategies.Refresh) window.setInterval(this.refreshLayer.bind(this), options.strategies.Refresh.interval);
    this.registerEvents();    
};

njs.Layers.GeoJSON.prototype.registerEvents = function () {
    var that = this;
    njs.Layers.GeoJSON.superclass.registerEvents.call(this);
};

/*-------------------------------------------------------------------------------
    method createLayer
--------------------------------------------------------------------------------*/
njs.Layers.GeoJSON.prototype.switchLayer = function (status) {
    njs.Layers.GeoJSON.superclass.switchLayer.call(this, status);
    var _arVisibleLayers = [];
    _arVisibleLayers = njs.AppManager.LyrMgr[this.id_lyr_mgr].getAllVisibleLayers();
   /* return;
    if (status) {
        // first time the layer is switch on, attach the mouseover tool to the layer if exists
        if (!this._SelectControl) {

            if (njs.AppManager.Tools.MouseOver.map) {
                this._SelectControl = njs.AppManager.Tools.MouseOver.map.mouseover.controls['mouseover'].control;
            }
        }

        if (this._SelectControl) this._SelectControl.setLayer(_arVisibleLayers);
        //this._lyr.refresh({ force: true });
    } else {
        if (this._selectedFeature) this._lyr.events.triggerEvent("featureunselected", { feature: this._selectedFeature });
        if (this._SelectControl) this._SelectControl.setLayer(_arVisibleLayers);
    } */
};

/*-------------------------------------------------------------------------------
    method toggleLayer
--------------------------------------------------------------------------------*/
njs.Layers.GeoJSON.prototype.toggleLayer = function (status) {
    njs.Layers.GeoJSON.superclass.switchLayer.call(this, status);
    if (status) {
        if (!this._SelectControl) {
            //add mouseover selection
            this._SelectControl = new OpenLayers.Control.SelectFeature(this._lyr, {
                hover: this.hover
            });
            for (var map in this.targetMap) {
                var _map = this.targetMap[map];
                njs.AppManager.Maps[_map].mapObj.addControl(this._SelectControl);
            }
            this._SelectControl.activate();
        } else {
            this._SelectControl.activate();
        }

        this._lyr.refresh({ force: true });
    } else {
        // layer is deactivated

        //deactivate also the edit checkbox
        if (this._selectedFeature) this._lyr.events.triggerEvent("featureunselected", { feature: this._selectedFeature });
    }
};

njs.Layers.GeoJSON.prototype.refreshLayer = function () {    
    this._lyr.getSource().refresh();
};

/*-------------------------------------------------------------------------------
    method onPopupClose
    Event Handler activated when use closes the popup window
--------------------------------------------------------------------------------*/

njs.Layers.GeoJSON.prototype.onPopupClose = function (evt) {
    if (this._SelectControl) this._SelectControl.unselect(this._selectedFeature);
};

/*-------------------------------------------------------------------------------
    method onFeatureSelect
    Event Handler activated when a feature is selected
--------------------------------------------------------------------------------*/
njs.Layers.GeoJSON.prototype.onFeatureSelect = function (feature) {
    var that = this;
    // 	IS THERE A WAY TO GET THE MAP WITHOUT HARDCODE IT ??
    if (njs.AppManager.Maps['main'].isShiftKey) return;
    this._selectedFeatures.push(feature);
    if (feature._lastHighlighter && feature._lastHighlighter.indexOf('olSelectFeature') > 0) {
        return;
    }
    this._selectedFeature = feature;
    this._selectedFeatures.push(feature);

    if (typeof njs.AppManager.MapTips[this.id] != 'undefined' && njs.AppManager.MapTips[this.id].infoFloatingWindow) {

        //get the info window 'MapTipp' starting with and height
        if (typeof eval('this._MapTips.' + this.id) != 'undefined' && typeof eval('this._MapTips.' + this.id + '.start_w') != 'undefined')
            njs.AppManager.formFloatWinWidth = 2 * eval('this._MapTips.' + this.id + '.start_w');
        if (typeof eval('this._MapTips.' + this.id) != 'undefined' && typeof eval('this._MapTips.' + this.id + '.start_h') != 'undefined')
            njs.AppManager.formFloatWinHeight = eval('this._MapTips.' + this.id + '.start_h');

        // must check if  still exists (is destroyed when clicked on the x button)
        njs.AppManager.InitFormFloatingWindow(false);

        var _tit = njs.AppManager.MapTips[this.id].texts[njs.AppManager.Language].title;
        // should use pane.set('content',content) but doesn't work

        njs.AppManager.formFloatWin.set("title", "<table border='0' cellpadding='0 cellspacing='0'><tr><td>" + _tit + "</td><td><div id='infowin_wait' class='loading_infowin' style='display:none'></div></td></tr></table>");
        dojo.byId("infowin_wait").style.display = 'block';
        // must reset the specified size because the content can change it

        njs.AppManager.formFloatWin.resize({ w: njs.AppManager.formFloatWinWidth, h: 80 });

        // display the info window at the startup location in edit mode
        dojo.byId("njs_form_pane").style.left = njs.AppManager.formFloatWinX + "px";
        dojo.byId("njs_form_pane").style.top = njs.AppManager.formFloatWinY + "px";
        njs.AppManager.formFloatWin.set("closable", false);

        njs.AppManager.formFloatWin.show();
        njs.AppManager.formFloatWin.bringToTop();

        if (this._selectedFeature.cluster) {
            //the selected feature is a point feature beloging to a cluster
            var arFids = [];
            var buf = '';
            for (var c = 0; c < this._selectedFeature.cluster.length; c++) {
                eval('buf = this._selectedFeature.cluster[' + c + '].attributes.' + this.key_name);
                arFids.push(buf);
            }
            var fid = arFids.join(',');
        } else {
            eval('var fid = this._selectedFeature.attributes.' + this.key_name);
        }

        var theUrl;
        //send query to server
        if (dijit.byId(this.id + '_edit').get('checked'))
            theUrl = 'forms.php';
        else if (dijit.byId(this.id).get('checked'))
            theUrl = 'infos.php';
        else
            return;

        var request = OpenLayers.Request.POST({
            url: theUrl,
            data: new URLSearchParams({
                FID: fid,
                key: this.key_name,
                layer: this._lyr.name,
                action: "update",
                table: this.DBTable,
                editable: this.attr_editable,
                lang: njs.AppManager.Language
            }).toString(),
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            callback: function (resp) {
                // do something with the response
                njs.AppManager.formFloatWin.set('content', resp.responseText);
                njs.AppManager.formFloatWin.resize({ w: njs.AppManager.formFloatWinWidth, h: njs.AppManager.formFloatWinHeight });
                dojo.byId("infowin_wait").style.display = 'none';
            }
        });
        // add an entry to the loading array for each executequreytask
        njs.AppManager.infoFloatMapTipLoading[njs.AppManager.infoFloatMapTipLoading.length] = this.id;
    }
};

/*-------------------------------------------------------------------------------
    method onFeatureUnselect
    Event Handler activated when a feature is deselected
--------------------------------------------------------------------------------*/
njs.Layers.GeoJSON.prototype.onFeatureUnselect = function (feature) {
    this._selectedFeature = null;
    if (this._ModifyControl) this.removeModifyControl();
};

/*-------------------------------------------------------------------------------
    method onFeatureModified
    Event Handler activated when a feature is modified
--------------------------------------------------------------------------------*/
njs.Layers.GeoJSON.prototype.onFeatureModified = function (feature) {
    if (!this.geo_editable) {
        //@todo: put the message in the config file
        alert('2-Das Feature ist nicht editierbar.');
        this._lyr.refresh({ force: true });
        return;
    }
    var parser = new OpenLayers.Format.GeoJSON();
    var myGeom = parser.write([feature]);
    var fid;
    if (feature.getGeometry().getType() == 'Point') {
        if (feature.cluster != undefined && feature.cluster.length > 1) {
            //@todo: put the message in the config file
            alert('Man kann nicht ein Gruppe von Punkte verschieben');
            return;
        }
        if (feature.cluster != undefined)
            fid = eval('feature.cluster[0].attributes.' + this.key_name_attr);
        else
            fid = eval('feature.attributes.' + this.key_name_attr);
    } else
        fid = eval('feature.attributes.' + this.key_name_attr);
    //@todo: put the message in the config file
    if (feature.layer.name != 'eigene_gebiete' && feature.layer.name != 'verkehrsverbunde') {
        if (!confirm('Soll dieses Objekt verschoben werden?')) {
            this._lyr.refresh({ force: true });
            return false;
        }
    }
    //save modified feature
    var reqURL = njs.AppManager.apipath + njs.AppManager.Version + "/php/processFeature.php";
    var request = OpenLayers.Request.POST({
        url: reqURL,
        data: new URLSearchParams({
            id: fid,
            table: this.name,
            key: this.key_name_attr,
            action: 'featuremodified',
            geom: myGeom
        }).toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
};

/*-------------------------------------------------------------------------------
    Layers.WCTravel Class
	
    Class creating a tabbed layers manager with categories like in Mapplus.
    [id]	: object's unique id
    [object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Layers.WCTravel = function (id, options) {
    /* properties */
    this.id = id;
    this.DBTable = null;
    /*	this.attr_editable = 0;
        this.geo_editable = 0;
        this.snappable = 0;
        // SelectFeature Control
    */
    this._SelectControl = null;
    // ModifyFeature Control
    this._ModifyControl = null;
    // Snapping Control
    this._MapTips = null;			// MapTips can be: Dynamic Mouse OVer information or Popup Window
    this._ctrButtons = [];	// [diji.form.Button] UI button for activating the digitize button
    this.save_url = null;
    this._tools = null;
    this.tools = null;			// [javascript object] contains all controls associated with that layer such as digitize, opacity
    //feature currently selected by click or hover
    this.protocol = null;
    this._selectedFeature = null;  

    if (options) {
        this.Init(options);
    }
};
njs.Layers.WCTravel.prototype = new njs.Layers.GeoJSON;
njs.Layers.WCTravel.prototype.constructor = njs.Layers.WCTravel;
njs.Layers.WCTravel.superclass = njs.Layers.GeoJSON.prototype;

/*-------------------------------------------------------------------------------
    method Init
    Initialisation's work
    [object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Layers.WCTravel.prototype.Init = function (options) {    
    var that = this;
    options.projection='EPSG:4326';
    njs.Layers.WCTravel.superclass.Init.call(this, options);
    this.base_url = options.base_url ? options.base_url : null;
    this.widget = options.widget ? options.widget : {};
   
    this._lyr = null;   
    
    this.key_name_attr = options.key_name_attr;  
    var jsonurl = options.protocol.url.replace('#lang#', njs.AppManager.Language);
    //if (pattern.test(options.protocol.url)) jsonurl = '/mapplus-lib/mapplus-dojo/' + njs.AppManager.Version + '/php/proxy/proxy_mashape.php?proxy_url=' + options.protocol.url;

    const loadingStrategy=ol.loadingstrategy.bbox;   
   // const loadingStrategy=(options.olLoadingstrategy=='bbox')?ol.loadingstrategy.bbox:ol.loadingstrategy.all;   

    var lastextent;
    var vectorSource  = new ol.source.Vector({
        crossOrigin:(typeof options.crossOrigin !='undefined')?options.crossOrigin:'anonymous', 
        projection:njs.AppManager.Maps['main'].mapObj.getView().getProjection(),
        format: new ol.format.GeoJSON(),           
        loader: function(extent, resolution, projection, success, failure) {
            lastextent=extent;
            extent= ol.proj.transformExtent(extent,projection,"EPSG:4326");
            var url = jsonurl + "?bbox=" + extent[3] + "," +  extent[2] + "," + extent[1] + "," +  extent[0]+"&lang="+njs.AppManager.Language; 
            //var url = jsonurl + "?zoom="+_zoom+"&lang="+njs.AppManager.Language+"&northLat=" + extent[3] + "&southLat=" +  extent[1] + "&eastLon=" + extent[2] + "&westLon=" +  extent[0];
            url+='&limit=50&sortKey=popularity&include=images,location,player,urls';   
            that.paginatedFetch(url,options,projection,that,vectorSource)           
        },
        strategy: function(extent) {  
            var bbox = extent.join(',');
            if (bbox != this.get('bbox')) {
                this.set('bbox', bbox);        
                if (lastextent) vectorSource.removeLoadedExtent(lastextent);              
            }           
            return [extent];
        } 
    });

    this._lyr  = new ol.layer.Vector ({
        projection:options.projection,
        style: this.getFeatureStyle,           
        source: vectorSource            
    });    

    this._lyr.set('name', this.id);  
    this._lyr.set('type', 'WCTravel'); 
    if (this.maxResolution != null && typeof this.maxResolution != "undefined") this._lyr.set('maxResolution',  this.maxResolution+0.0001); 
    if (this.minResolution != null && typeof this.minResolution != "undefined") this._lyr.set('minResolution',  this.minResolution); 
   
    this.save_url = '';

    this.tools = [];
    
    this.registerEvents();    
};

njs.Layers.WCTravel.prototype.getFeatureStyle = function (feature) {
    const symbolname = feature.get('thumbnail_url');
    var style = new ol.style.Style({
        image: new ol.style.Icon({
            width: 40,  
            src: symbolname,
        }),
        zIndex:2
    }); 
    var shadowStyle = new ol.style.Style({
        image: new ol.style.Icon({
            width: 45,  
            src: "../core/templates/" + njs.AppManager.template + "/img/pano_background.gif",
        }),
        zIndex:1
    });                         
    return [style,shadowStyle];
};

var maxCalls=null;

njs.Layers.WCTravel.prototype.paginatedFetch = function (url,options,projection,that,vectorSource,offset = 0) {
    var that = this;   
    console.log(`${url}&offset=${offset}`);
    return fetch(`${url}&offset=${offset}`,{headers: {
        'accept': 'application/json',
        'x-windy-api-key': options.protocol.api_key
    }}) // Append the page number to the base URL
      .then(response => response.json())
      .then(newResponse => {        
        if (!maxCalls){
            vectorSource.clear();
            if (newResponse.total/newResponse.webcams.length>=4){
                maxCalls=3;
            }else{
                maxCalls=Math.ceil(newResponse.total/newResponse.webcams.length);
            }
        }
        that.addFeatures(newResponse.webcams,projection,that,vectorSource);
        if (offset+1 < maxCalls) {
            offset++;
            return that.paginatedFetch(url, options,projection,that,vectorSource,offset);
        }
    }); 
};

njs.Layers.WCTravel.prototype.getZoomFromResolution = function (resol) {
    var arrResolutions = [
        156543.03390625, 78271.516953125, 39135.7584765625,
        19567.87923828125, 9783.939619140625, 4891.9698095703125,
        2445.9849047851562, 1222.9924523925781, 611.4962261962891,
        305.74811309814453, 152.87405654907226, 76.43702827453613,
        38.218514137268066, 19.109257068634033, 9.554628534317017,
        4.777314267158508, 2.388657133579254, 1.194328566789627,
        0.5971642833948135, 0.29858214169740677, 0.14929107084870338,
        0.07464553542435169
    ];

    for (var i = 0; i < arrResolutions.length; i++) {
        if (resol > arrResolutions[i]) {
            return i;
        }
    }
    return 21;
};

njs.Layers.WCTravel.prototype.addFeatures = function (resp,projection,that,vectorSource) {
     // Create points and attach attributes
     var features = [];
     for (var i = 0; i < 50; i++) {                    
         //console.log(i);
         var webcam = resp[i];
         if (webcam != null) {
             var thumbnail_url = webcam.images.current.icon;
             var webcam_url = webcam.urls.detail;
             var preview_url = webcam.images.current.preview;
             var webcam_title = webcam.title;
            
             // You need to transform your point in map coordinates                               
             var fpoint =ol.proj.transform([webcam.location.longitude, webcam.location.latitude],"EPSG:4326", projection);

             var attributes = {
                 'layer_id': that.id,
                 'webcam_url': webcam_url,
                 'preview_url': preview_url,
                 'thumbnail_url': thumbnail_url,
                 'webcam_title': webcam_title,
                
                 'lon': webcam.location.longitude,
                 'lat': webcam.location.latitude
             };
             var _feat = new ol.Feature({
                 geometry: new ol.geom.Point(fpoint),
                 name: that.id
             });
             _feat.setProperties(attributes);                          
             features.push(_feat);
         }
     }   
     vectorSource.addFeatures(features);
     return features;
};

/*-------------------------------------------------------------------------------
    method registerEvents
--------------------------------------------------------------------------------*/
njs.Layers.WCTravel.prototype.registerEvents = function (options) {
    var that = this;
    njs.Layers.GeoJSON.superclass.registerEvents.call(this);
};
/*-------------------------------------------------------------------------------
    method switchLayer
--------------------------------------------------------------------------------*/
njs.Layers.WCTravel.prototype.switchLayer = function (status) {
    njs.Layers.WCTravel.superclass.switchLayer.call(this, status);
    return false;
};

/*-------------------------------------------------------------------------------
    Layers.Wikipedia Class
	
    Class creating a tabbed layers manager with categories like in Mapplus.
    [id]	: object's unique id
    [object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Layers.Wikipedia = function (id, options) {  
    /* properties */
    this.id = id;
    this.DBTable = null;
    //	this.attr_editable = 0;
    //	this.geo_editable = 0;
    //	this.snappable = 0;  
    // Snapping Control
    this._SnappingControl = null;
    this._MapTips = null;			// MapTips can be: Dynamic Mouse OVer information or Popup Window
    this._ctrButtons = [];	// [diji.form.Button] UI button for activating the digitize button
    this.save_url = null;
    this._tools = null;
    this.tools = null;			// [javascript object] contains all controls associated with that layer such as digitize, opacity
    //feature currently selected by click or hover
    this.protocol = null;
    this._selectedFeature = null;

    if (options) {
        this.Init(options);
    }
};
njs.Layers.Wikipedia.prototype = new njs.Layers.GeoJSON;
njs.Layers.Wikipedia.prototype.constructor = njs.Layers.Wikipedia;
njs.Layers.Wikipedia.superclass = njs.Layers.GeoJSON.prototype;
/*-------------------------------------------------------------------------------
    method Init
    Initialisation's work
    [object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Layers.Wikipedia.prototype.Init = function (options) {
    var that = this;
    options.projection='EPSG:4326';
    njs.Layers.Wikipedia.superclass.Init.call(this, options);
    this.base_url = options.base_url ? options.base_url : null;
    this.widget = options.widget ? options.widget : {};
   
    this._lyr = null;
       
    this.key_name_attr = options.key_name_attr;    
    var jsonurl = options.protocol.url;
   
    var vectorSource  = new ol.source.Vector({
        crossOrigin:(typeof options.crossOrigin !='undefined')?options.crossOrigin:'anonymous',
        projection:njs.AppManager.Maps['main'].mapObj.getView().getProjection(),
        format: new ol.format.GeoJSON(),           
        loader: function(extent, resolution, projection, success, failure) {
            this.resolution = resolution;
            var url = jsonurl;           
           
            extent= ol.proj.transformExtent(extent,projection,"EPSG:4326");           
            options.protocol.params['maxRows'] = 100;
            options.protocol.params['lang'] = njs.AppManager.Language;
            options.protocol.params['east'] = extent[2];
            options.protocol.params['south'] = extent[1];
            options.protocol.params['west'] = extent[0];
            options.protocol.params['north'] = extent[3];
            url+= '?'+new URLSearchParams(options.protocol.params).toString();
            fetch(url).then(function(response) {
                return response.json();
            }).then(function(resp) {
               
                // Create points and attach attributes
               var features = [];

               for (var i = 0; i < resp.geonames.length; i++) {
                   //if (resp.geonames[i].countryCode!='CH') continue;
                   var lon = resp.geonames[i].lng;
                   var lat = resp.geonames[i].lat;
                   var doc_title = resp.geonames[i].title;
                   var doc_url = resp.geonames[i].wikipediaUrl;
                   var doc_summary = resp.geonames[i].summary;
                   var fpoint =ol.proj.transform([lon, lat],options.projection, njs.AppManager.Maps['main'].mapObj.getView().getProjection());                   
                   var attributes = {
                       'layer_id': that.id,
                       'doc_title': doc_title,
                       'doc_url': doc_url,
                       'doc_summary': doc_summary
                   };
                   var popup = null;
                   var _feat = new ol.Feature({
                       geometry: new ol.geom.Point(fpoint),
                       name: that.id
                   });
                   _feat.setProperties(attributes);
                   features.push(_feat);
               }               
               vectorSource.clear(true);
               vectorSource.addFeatures(features);
               success(features);
            }).catch(function(err) {
                console.log(err);
                vectorSource.removeLoadedExtent(extent);
                failure();
            })
        },
        strategy:function(extent, resolution) {
            //to load also with zoomin
            if(this.resolution && this.resolution != resolution){
                this.loadedExtentsRtree_.clear();
            }
            return [extent];
        }       
    });

    this._lyr  = new ol.layer.Vector ({
        projection:options.projection,
        style: function (feature) {            
            const symbolname = options.styleMap.default.default.symb;
            var style = new ol.style.Style({
                image: new ol.style.Icon({
                    width: options.styleMap.default.pointRadius*2,        
                    src: options.styleMap.default.symb_root+symbolname,
                }),
                zIndex:options.styleMap.default.default.zIndex
            });                           
            return style;
        },
        source: vectorSource            
    });
 
    this._lyr.set('name', this.id);  
    this._lyr.set('type', 'Wikipedia'); 
    if (this.maxResolution != null && typeof this.maxResolution != "undefined") this._lyr.set('maxResolution',  this.maxResolution+0.0001); 
    if (this.minResolution != null && typeof this.minResolution != "undefined") this._lyr.set('minResolution',  this.minResolution); 
   
    this.save_url = '';

    this.tools = [];
    
    this.registerEvents();    
};
/*-------------------------------------------------------------------------------
    method switchLayer
--------------------------------------------------------------------------------*/
njs.Layers.Wikipedia.prototype.switchLayer = function (status) {
    njs.Layers.Wikipedia.superclass.switchLayer.call(this, status);
    return false;
};


/*-------------------------------------------------------------------------------
    method registerEvents
--------------------------------------------------------------------------------*/
njs.Layers.Wikipedia.prototype.registerEvents = function (options) {
    var that = this;
    njs.Layers.GeoJSON.superclass.registerEvents.call(this);

};

//# sourceURL=mapplus://provider/OLPlus/layers.js 
