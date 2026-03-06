/* jslint node: true */
"use strict";

/*-------------------------------------------------------------------------------
    Class  olMap
	
    extends njs.Map in order to fetch the arcgis objects, properties and methods 
--------------------------------------------------------------------------------*/
njs.Map.olMap = function (options) {
    if (options) {
        this.set(options);
    }
};
njs.Map.olMap.prototype = new njs.Map();
njs.Map.olMap.prototype.constructor = njs.Map.olMap;
njs.Map.olMap.superclass = njs.Map.prototype;
njs.Map.olMap.prototype.maxResolution = null;

njs.Map.olMap.prototype.highlightLayer = null;
// porperty holding the current layers to be set selectable
njs.Map.olMap.prototype.selectableLayers = {};

/*-------------------------------------------------------------------------------
    method setOpacity
	
    Set opacity value
    op: opacity
--------------------------------------------------------------------------------*/
njs.Map.olMap.prototype.setBaseLayerOpacity = function (op) {
    this.mapObj.getLayers().getArray()[0].setOpacity(op);
    njs.AppManager.updateMapStatusUrl(this.id);
};

njs.Map.olMap.prototype.toggleBaseLayerColor = function (_baselayer) {
    var elem = document.querySelectorAll(".ol-basemap");
    if (_baselayer.status == 'bw') {
        for (var i = 0; i < elem.length; i++) {
            elem[i].classList.add("grayscale");
        }
    } else if (_baselayer.status == 'color') {
        for (var i = 0; i < elem.length; i++) {
            elem[i].classList.remove("grayscale");
        }
    }
    njs.AppManager.updateMapStatusUrl(this.id);
};

/*-------------------------------------------------------------------------------
    method getLocation
	
    Center and zoom to gps location
    pt: x,y
    resol: map resolution
--------------------------------------------------------------------------------*/
njs.Map.olMap.prototype.getLocation = function (pt, resol, accuracy, heading, center = true) {
    if (resol == -1) resol = this.mapObj.getView().getResolution();
    var zoomlevel = this.mapObj.getView().getZoomForResolution(resol, true);
    if (center) this.centerAndZoom(pt, zoomlevel, true, accuracy, heading);
    else this.highlightSrchObj(pt, accuracy, heading);
};

/*-------------------------------------------------------------------------------
    method createLayer

    Returns an OpenLayers.Layer Layer
    [string] map_name: name of the layer
    [Object] map_coll: layer properties

--------------------------------------------------------------------------------*/
njs.Map.olMap.prototype.createLayer = function (map_name, bmap) {
    var that=this;
    if (typeof bmap["type"] == "undefined") return false;
    switch (bmap["type"].toLowerCase()) {
        case "tms":
            var opt = bmap['options'];
            var lyr = new ol.layer.Tile({
                className: 'ol-basemap ol-layer',
                preload: 0,
                transition: 0,
                opacity: opt['opacity'] ? opt['opacity'] : 1,
                minResolution: opt['minResolution'] ? opt['minResolution'] : 0,
                source: new ol.source.TileImage({
                    crossOrigin: typeof bmap['crossOrigin'] != 'undefined' ? bmap['crossOrigin'] : 'anonymous',
                    attributions: bmap['attribution'] ? njs.AppManager.nls.disclaimerResources[bmap['attribution'] + '_text'] : undefined,
                    projection: opt['projection'],
                    tileGrid: new ol.tilegrid.TileGrid({
                        extent: opt['maxExtent'],
                        origin: opt['tileOrigin'],
                        resolutions: opt['resolutions'] ? opt['resolutions'] : this.resolutions
                    }),
                    tileUrlFunction: function (coordinate) {
                        return bmap['url'] + '/1.0.0/' + opt['layername'] + '/' + coordinate[0] + '/' + coordinate[1] + '/' + (-coordinate[2] - 1) + '.' + opt['type'];
                    }
                })
            });
        case "bing":
            //todo
            break;
        case "xyz":
            var opt = bmap['options'];
            var lyr = new ol.layer.Tile({
                className: 'ol-basemap ol-layer',
                preload: 0,
                opacity: opt['opacity'] ? opt['opacity'] : 1,
                minResolution: opt['minResolution'] ? opt['minResolution'] : 0,
                source: new ol.source.XYZ({
                    crossOrigin: typeof bmap['crossOrigin'] != 'undefined' ? bmap['crossOrigin'] : 'anonymous',
                    projection: opt['projection'],
                    attributions: bmap['attribution'] ? njs.AppManager.nls.disclaimerResources[bmap['attribution'] + '_text'] : undefined,
                    url: bmap["url"],
                    tileGrid: new ol.tilegrid.TileGrid({
                        extent: opt['maxExtent'],
                        origin: [opt['maxExtent'][0], opt['maxExtent'][1]],
                        resolutions: opt['resolutions'] ? opt['resolutions'] : this.resolutions
                    })

                })
            });
            break;
        case "google":
            var lyr = new ol.layer.Tile({
                className: 'ol-basemap ol-layer',
                opacity: bmap['opacity'] ? bmap['opacity'] : 1,
                minResolution: bmap['minResolution'] ? bmap['minResolution'] : 0,
                source: new ol.source.Google(bmap['source'])
            });
            break;
        case "void":
            var lyr = new ol.layer.Image({
                className: 'ol-basemap ol-layer',
                opacity: 1,
                minResolution: bmap['minResolution'] ? bmap['minResolution'] : 0,
                source: new ol.source.ImageStatic({
                    imageExtent: [0, 0, 1, 1],
                    url: "data:image/png;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs="
                })
            });
            break;
        case "osm":
            var lyr = new ol.layer.Tile({
                className: 'ol-basemap ol-layer',
                opacity: bmap['opacity'] ? bmap['opacity'] : 1,
                minResolution: bmap['minResolution'] ? bmap['minResolution'] : 0,
                source: new ol.source.OSM({
                    attributions: bmap['attribution'] ? njs.AppManager.nls.disclaimerResources[bmap['attribution'] + '_text'] : undefined,
                    crossOrigin: typeof bmap['crossOrigin'] != 'undefined' ? bmap['crossOrigin'] : 'anonymous'
                })
            });
            break;
        case "wmtscapabilities":
            var lyr = new ol.layer.Tile({
                className: 'ol-basemap ol-layer',
                opacity: bmap['opacity'] ? bmap['opacity'] : 1,
                minResolution: bmap['minResolution'] ? bmap['minResolution'] : 0
            });
            var parser = new ol.format.WMTSCapabilities();
            var url_capab = bmap['url'];
            var options;
            fetch(url_capab).then(function (response) {
                return response.text();
            }).then(function (text) {
                var result = parser.read(text);
                options = ol.source.WMTS.optionsFromCapabilities(result,
                    { layer: bmap['layer'] });
                if (bmap["params"] != null && typeof bmap["params"] != 'undefined') {
                    for (let key in options.dimensions) {
                        if (bmap["params"][key]) options.dimensions[key] = bmap["params"][key];
                    }
                }
                if (options) {
                    options.crossOrigin = typeof bmap['crossOrigin'] != 'undefined' ? bmap['crossOrigin'] : 'anonymous';
                    options.attributions = bmap['attribution'] ? njs.AppManager.nls.disclaimerResources[bmap['attribution'] + '_text'] : undefined,
                        lyr.setSource(new ol.source.WMTS(options));
                    const name = map_name.replace(/_\d+$/, '');  // clean _0, _1, _2.
                    if (njs.AppManager.StartParams.basemap == name){                        
                        that.changeBaseMap(name, false)
                    }
                } else {
                    console.error('Problem loading basemap: ' + map_name);
                }
            });
            break;
        case "wmts":
            var matrixIds = [];
            var istart = 0;
            if (bmap['zoomOffset']) istart += bmap['zoomOffset'];
            for (var i = istart; i < bmap['resolutions'].length + istart; i++) {
                matrixIds.push(i);
            }
            var requestEncoding = "REST";
            var lyr = new ol.layer.Tile({
                className: 'ol-basemap ol-layer',
                opacity: bmap['opacity'] ? bmap['opacity'] : 1,
                minResolution: bmap['minResolution'] ? bmap['minResolution'] : 0,
                source: new ol.source.WMTS({
                    crossOrigin: typeof bmap['crossOrigin'] != 'undefined' ? bmap['crossOrigin'] : 'anonymous',
                    attributions: bmap['attribution'] ? njs.AppManager.nls.disclaimerResources[bmap['attribution'] + '_text'] : undefined,
                    url: bmap["url"],
                    tileGrid: new ol.tilegrid.WMTS({
                        origin: [bmap['maxExtent'][0], bmap['maxExtent'][3]],
                        resolutions: bmap['resolutions'],
                        matrixIds: matrixIds
                    }),
                    projection: bmap["projection"],
                    layer: bmap["layer"],
                    requestEncoding: bmap["requestEncoding"] ? bmap["requestEncoding"] : requestEncoding

                })
            });
            break;
        case "wms":
            var opt = bmap['options'];
            if (opt.singleTile) {
                var tydLayer = ol.layer.Image;
                var tydWMS = ol.source.ImageWMS;
            } else {
                var tydLayer = ol.layer.Tile;
                var tydWMS = ol.source.TileWMS;
            }

            var lyr = new tydLayer({
                className: 'ol-basemap ol-layer',
                opacity: opt['opacity'] ? opt['opacity'] : 1,
                minResolution: opt['minResolution'] ? opt['minResolution'] : 0,
                source: new tydWMS({
                    crossOrigin: typeof bmap['crossOrigin'] != 'undefined' ? bmap['crossOrigin'] : 'anonymous',
                    attributions: bmap['attribution'] ? njs.AppManager.nls.disclaimerResources[bmap['attribution'] + '_text'] : undefined,
                    resolutions: opt['resolutions'] ? opt['resolutions'] : this.resolutions,
                    url: bmap['url'],
                    ratio: 1.0,
                    projection: opt['projection'],
                    params: bmap['params']
                })
            });
            break;
    }
    if (bmap['resol_visibility']) {
        lyr.setMaxResolution(bmap['resol_visibility'][1]);
        lyr.setMinResolution(bmap['resol_visibility'][0]);
    }

    if (bmap['initialResolution']) {
        lyr.set('initialResolution', bmap['initialResolution']);
    }
    lyr.set('name', map_name);
    lyr.set('type', 'base');
    if (bmap['options']) {
        lyr.set('initialExtent', bmap['options']['initialExtent']);
        lyr.set('restrictedExtent', bmap['options']['restrictedExtent']);
        lyr.setExtent(bmap['options']['clippedExtent']);
    }
    else {
        lyr.set('initialExtent', bmap['initialExtent']);
        lyr.set('restrictedExtent', bmap['restrictedExtent']);
        lyr.setExtent(bmap['clippedExtent']);
    }
    return lyr;
};

/*-------------------------------------------------------------------------------
    method initMapping
    extends njs.Map
	
    makes all the initialisation's work after the main page and libraries have
    been loaded:
    - creates the map object according the configuration
    - loads the layers
    - loads the controls
    - loads the tools
    - handles the logging and startparameters 
	
--------------------------------------------------------------------------------*/
njs.Map.olMap.prototype.initMapping = function () {
    if (njs.AppManager.StartParams.basemap && this.basisMaps[njs.AppManager.StartParams.basemap]) {
        this.currBasisMap = njs.AppManager.StartParams.basemap;
    } else {
        if (typeof this.startMap != "undefined" && this.startMap != null) {
            this.currBasisMap = this.startMap;
        } else {
            this.currBasisMap = Object.values(this.basisMaps)[0].get("name");
        }
    }
    let resol;
    if (this.basisMaps[this.currBasisMap].get('multisource') == true) {
        resol = this.basisMaps[this.currBasisMap].get('resolutions');
    } else {
        try {
            if (this.basisMaps[this.currBasisMap].getLayers) resol = this.basisMaps[this.currBasisMap].getLayers().getArray()[0].getSource().getResolutions();
            else resol = this.basisMaps[this.currBasisMap].getSource().getResolutions();
        } catch (error) { }
    }
    if (typeof resol == "undefined" || resol == null) resol = this.resolutions;

    var attribution = null;
    if (njs.AppManager.isMobile) {
        attribution = new ol.control.Attribution({ collapsible: true, collapsed: true });
    } else {
        attribution = new ol.control.Attribution({ collapsible: false, collapsed: false });
    }
    var interactions = ol.interaction.defaults.defaults();
    if (njs.AppManager.mousewheel === false) {
        interactions = ol.interaction.defaults.defaults({ mouseWheelZoom: false });
    }
    let lyr_minresol = this.basisMaps[this.currBasisMap].getMinResolution();
    const filtered_resol = resol.filter((r) => r >= lyr_minresol);

    this.mapObj = new ol.Map({
        layers: [this.basisMaps[this.currBasisMap]],
        controls: ol.control.defaults.defaults({ "attribution": false }).extend([attribution]),
        interactions: interactions,
        target: 'map',
        keyboardEventTarget: document,
        view: new ol.View({
            projection: this.projection,
            constrainResolution: this.constrainResolution !== false ? true : false,
            maxResolution: resol[0],
            resolutions: filtered_resol,
            extent: this.basisMaps[this.currBasisMap].get('restrictedExtent')
        })
    });

    if (njs.AppManager.StartParams.rotation) {
        this.mapObj.getView().setRotation(njs.AppManager.StartParams.rotation / 180 * Math.PI);
    }

    if (this.basisMaps[this.currBasisMap].get('initialExtent')) this.mapObj.getView().fit(this.basisMaps[this.currBasisMap].get('initialExtent'), { 'size': this.mapObj.getSize(), 'nearest': false });
    if (this.basisMaps[this.currBasisMap].get('initialResolution')) this.mapObj.getView().setResolution(this.basisMaps[this.currBasisMap].get('initialResolution'));

    //this.mapObj.addControl(new ol.control.FullScreen({ source: 'NeapoljsContainer'}));
    this.mapObj.addControl(new ol.control.ScaleLine({ units: 'metric', maxWidth: 200 }));
    // register the button bar buttons events
    njs.Layout.registerButtonBar(this.id);

    this.highlightLayer = new ol.layer.Vector({ zIndex: 10000 });
    this.highlightLayer.setSource(
        new ol.source.Vector("cosmetic_search_source", {
            features: []
        })
    );
    this.highlightLayer.set('name', 'cosmetic_search');
    this.mapObj.addLayer(this.highlightLayer);

    // call the superclass initialisation work   
    njs.Map.olMap.superclass.initMapping.call(this);

    if (njs.AppManager.Tools.TrackBookmark) {
        let lastCenter = this.mapObj.getView().getCenter();
        let ghostRotation = this.mapObj.getView().getRotation();
        this.mapObj.on('moveend', (evt) => {
            let rotation = this.mapObj.getView().getRotation();
            let center = this.mapObj.getView().getCenter();
            if (ghostRotation != rotation || lastCenter != center) {
                njs.AppManager.updateMapStatusUrl(this.id);
            }
        });
    }

    const infoLayerWait = document.getElementById("infolay_wait");

    if (infoLayerWait !== null) {
        this.mapObj.on("loadstart", () => {
            this.manageLoadingLayer(true);
        });
        this.mapObj.on("loadend", () => {
            this.manageLoadingLayer(false);
            if (njs.AppManager.Tools.TrackBookmark) {
                njs.AppManager.updateMapStatusUrl(this.id);
            }
        });
    }

    this.toggleBaseMapSwitchs(this.currBasisMap, true);

    // extends the floating pane if module loaded
    dojo.extend(dojo.dnd.Mover, {
        onMouseUp: function (e) {
            if (this.mouseButton == e.button) {
                this.destroy();
            }
            if (document.getElementById('map_cover')) document.getElementById('map_cover').style.display = 'none';
            if (document.getElementById('njs_legend_pane_cover')) document.getElementById('njs_legend_pane_cover').style.display = 'none';
        }
    });

    // dojo has a bug with the resizing of the floating pane.
    // extend the class in order to correct it.
    dojo.extend(dojox.layout.FloatingPane, {
        resize: function (/* Object */ dim) {

            // summary: Size the FloatingPane and place accordingly
            dim = dim || this._naturalState;
            this._naturalState = dim;

            // From the ResizeHandle we only get width and height information
            var dns = this.domNode.style;
            if ("t" in dim) {
                dns.top = dim.t + "px";
            }
            if ("l" in dim) {
                dns.left = dim.l + "px";
            }
            dns.width = dim.w + "px";
            dns.height = dim.h + "px";
        }
    });

    if (typeof njs.AppManager.postConfigurationMap === "function") {
        // safe to use the function
        njs.AppManager.postConfigurationMap(arguments);
    }

};

njs.Map.olMap.prototype.manageLoadingLayer = function (status) {
    if (status) {
        document.getElementById("infolay_wait").style.display = 'block';

    } else {
        document.getElementById("infolay_wait").style.display = 'none';
    }
};

njs.Map.olMap.prototype.postProcessLoadMap = function () {
    if (this.initialExtent != null) {
        this.mapObj.getView().fit(this.initialExtent, { 'nearest': true });
    }
    // handle coord search start params (handled as search option)
    if (typeof njs.AppManager.StartParams.x != "undefined" && typeof njs.AppManager.StartParams.y != "undefined") {
        if (typeof njs.AppManager.StartParams.zl == "undefined") {
            this.mapObj.getView().setCenter(njs.AppManager.StartParams.x, njs.AppManager.StartParams.y);
            this.mapObj.getView().fit(this.initialExtent, { 'nearest': true });
        } else {
            var pt = [njs.AppManager.StartParams.x, njs.AppManager.StartParams.y];
            this.centerAndZoom(pt, njs.AppManager.StartParams.zl);
        }

    }
    // handle start with some custom extent
    if (typeof njs.AppManager.StartParams.extent != "undefined" && typeof njs.AppManager.StartParams.extent != "undefined") {
        var extent = njs.AppManager.StartParams.extent.split(",");
        this.mapObj.getView().fit(extent, { 'nearest': true });
    }
};

njs.Map.olMap.prototype.zoomEntire = function () {
    this.mapObj.getView().setRotation(0);
    this.basisMaps[this.currBasisMap].get('initialExtent') ? this.mapObj.getView().fit(this.basisMaps[this.currBasisMap].get('initialExtent'), { 'nearest': true }) : this.mapObj.getView().fit(this.basisMaps[this.currBasisMap].getExtent(), { 'nearest': true });
};



/*-------------------------------------------------------------------------------
    method resizeMap
	
    Handles the action of resizing the map after resizing the map container (event 'resize')
--------------------------------------------------------------------------------*/
njs.Map.olMap.prototype.resizeMap = function () {
    var resizeTimer;

    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(dojo.hitch(this, function () {
        this.mapObj.updateSize();
    }), 500);
};

/*-------------------------------------------------------------------------------
    method getMapCtrl
	
    Returns the control object in a map corresponding to its type (class name)
    [string] ctrl_class: control class name
--------------------------------------------------------------------------------*/
njs.Map.olMap.prototype.getMapCtrl = function (ctrl_class) {
    for (var ctrl in this.mapObj.controls) {
        if (this.mapObj.controls[ctrl].CLASS_NAME == ctrl_class) {
            return this.mapObj.controls[ctrl];
        }
    }
};

/*-------------------------------------------------------------------------------
    method registerDisclaimerZoomEvent

--------------------------------------------------------------------------------*/
njs.Map.olMap.prototype.registerDisclaimerZoomEvent = function () {

    this.mapObj.on('moveend', (evt) => {
        var cur_resol = this.mapObj.getView().getResolution();
        njs.AppManager.checkInfoDisclaimer(this.id, njs.AppManager.Maps[this.id].currBasisMap, cur_resol);
    });
};



/*-------------------------------------------------------------------------------
    method changeBaseMap
	
    Changes the base (ground) maps in a map container
	
    [string] selectedLyr : name of the layser (base map) to show
--------------------------------------------------------------------------------*/
njs.Map.olMap.prototype.changeBaseMap = function (selectedLyr, set_resolution=true) {
    const currentView = this.mapObj.getView();   

    if (this._disableChangeBaseMap) return false;

    for (var _base_map in this.basisMaps) {
        this.toggleBaseMapSwitchs(_base_map, false);
    }

    var _has_selected_lyr = false;
    // reset the wms maptips block as by change base map geojson layers are redrawn
    if (njs.AppManager.MapTips["_disablewmsgetfeatureinfo"] && njs.AppManager.MapTips["_disablewmsgetfeatureinfo"][this.id]) njs.AppManager.MapTips["_disablewmsgetfeatureinfo"][this.id] = false;

    if (this.basisMaps[selectedLyr]) {
        _has_selected_lyr = true;
        this.currBasisMap = selectedLyr;
        this.mapObj.getLayers().setAt(0, this.basisMaps[selectedLyr]);
        this.toggleBaseMapSwitchs(selectedLyr, true);
        // unselect the 'none' baselayers button if any
        this.toggleBaseMapSwitchs('none', false);

        let resol;

        if (this.basisMaps[this.currBasisMap].get('multisource') == true) {
            resol = this.basisMaps[this.currBasisMap].get('resolutions')
        } else {
            try {
                if (this.basisMaps[this.currBasisMap].getLayers) resol = this.basisMaps[this.currBasisMap].getLayers().getArray()[0].getSource().getResolutions();
                else resol = this.basisMaps[this.currBasisMap].getSource().getResolutions();
            } catch (error) { }
        }
        if (typeof resol == "undefined" || resol == null) resol = this.resolutions;

        let lyr_minresol = this.basisMaps[this.currBasisMap].getMinResolution();
        const filtered_resol =resol.filter(r => r >= lyr_minresol);       

        const options = {
            projection: currentView.getProjection(),
            center: currentView.getCenter(),
            resolutions: filtered_resol,
            constrainResolution: currentView.get('constrainResolution'),
            extent: this.basisMaps[selectedLyr].get('restrictedExtent')
        };
        
        if (set_resolution) {
            options.resolution = currentView.getResolution();
        }

        const newView = new ol.View(options);        
        if (!set_resolution && typeof njs.AppManager.StartParams.zl != "undefined") {           
            newView.setZoom(parseFloat(njs.AppManager.StartParams.zl));            
        }
        this.mapObj.setView(newView);
    }

    if (!_has_selected_lyr) {
        this.currBasisMap = "none";
        this.toggleBaseMapSwitchs(selectedLyr, true);
    }

    // info disclaimer
    if (njs.config.infoDisclaimer != undefined) {
        njs.AppManager.checkInfoDisclaimer(this.id, selectedLyr, this.mapObj.getView().getResolution());
    }

    if (njs.AppManager.Tools.TrackBookmark) {
        njs.AppManager.updateMapStatusUrl(this.id);
    }

    const mapChanged = new CustomEvent("changebaselayer", {
        detail: {
            name: selectedLyr
        }
    });
};

/*-------------------------------------------------------------------------------
    method toggleBaseMapSwitchs
	
    Changes the switches of the map base layers. Can be buttons, select lists, etc.
	
    [string] lyr_name : name of the concerned layer (base map)
    [boolean] switchstatus: true is 'selected' false is 'unselected'
--------------------------------------------------------------------------------*/
njs.Map.olMap.prototype.toggleBaseMapSwitchs = function (lyr_name, switchstatus) {
    // control the 'mapsSwitch' property of the njs map object

    if (this.basisMapsSwitch) {
        switch (this.basisMapsSwitch.type) {
            // switches defined as buttons (must exist in the DOM)
            case "mapButtons":
                // get the style of the current maps switch buttons
                var _style = this.basisMapsSwitch.style;
                if (switchstatus) {
                    // change the style of the button as selected
                    if (document.getElementById('btn' + this.id + '_' + lyr_name)) {
                        dojo.style('btn' + this.id + '_' + lyr_name, _style.selectedStyle);
                        if (_style.selectedClass && _style.unselectedClass) dojo.replaceClass('btn' + this.id + '_' + lyr_name, _style.selectedClass, _style.unselectedClass);
                    }
                } else {
                    // change the style of the button as unselected
                    if (document.getElementById('btn' + this.id + '_' + lyr_name)) {
                        dojo.style('btn' + this.id + '_' + lyr_name, _style.unselectedStyle);
                        if (_style.selectedClass && _style.unselectedClass) dojo.replaceClass('btn' + this.id + '_' + lyr_name, _style.unselectedClass, _style.selectedClass);
                    }
                }
                break;
        }
    }
};

/*-------------------------------------------------------------------------------
    method addLods
	
    Get the lods (tiles levels) of the current map (which must be a TiledLayer)
    and 
	
--------------------------------------------------------------------------------*/
njs.Map.olMap.prototype.addLods = function () {

    // takes the map object defined lods (or if not defined, the mapobject contains the layers lods)
    this.customLods = this.customMapLods;
    // update the lods list and display the current scale if a scale display has been defined
    if (njs.AppManager.Tools.ScaleDisplay[this.container] != undefined) {
        for (var _item in njs.AppManager.Tools.ScaleDisplay[this.container]) {
            njs.AppManager.Tools.ScaleDisplay[this.container][_item].UpdateScaleLods(this.id, _item);
        }
    }

};

/*-------------------------------------------------------------------------------
    method getLevel
	
    Wraper: gets the map zoom from the map
--------------------------------------------------------------------------------*/
njs.Map.olMap.prototype.getLevel = function () {
    return this.mapObj.getView().getZoom();
};

/*-------------------------------------------------------------------------------
    method setLevel
	
    Wraper: sets the map level in the map
--------------------------------------------------------------------------------*/
njs.Map.olMap.prototype.setLevel = function (level) {
    this.mapObj.zoomTo(level);
};

/*-------------------------------------------------------------------------------
    method centerAndZoom
	
    Centers the map to a given point and a given level. If an configuration's object
    is also passed, then highlight it with it style and adds a popup info capability
    	
    [Point] point: point to zoom to
    [int] level: map level to zoom to
    [obj] srch_conf: configuration object (style, attributes and info template)
--------------------------------------------------------------------------------*/
njs.Map.olMap.prototype.centerAndZoom = function (point, level, symb, accuracy, heading) {
    require(["dojo/_base/lang"], dojo.hitch(this, function (lang) {
        var _is_in_extent = false;
        var _warning = njs.config.searchoptions ? njs.config.searchoptions.coordinates.warnings : null;
        // check if the point is in the extent          
        var _ext2check = this.basisMaps[this.currBasisMap].getExtent();

        if (_ext2check) _is_in_extent = ol.extent.containsCoordinate(_ext2check, point)
        else _is_in_extent = true;
        if (!_is_in_extent) {
            this.basisMaps[this.currBasisMap].get('initialExtent') ? this.mapObj.getView().fit(this.basisMaps[this.currBasisMap].get('initialExtent'), { 'nearest': true }) : this.mapObj.getView().fit(_ext2check, { 'nearest': true });
            // show an alert dialog
            if (_warning) {
                /*  var d = new dijit.Dialog({title: _warning.notInBounds[njs.AppManager.Language].title});
                 d.setContent(_warning.notInBounds[njs.AppManager.Language].text);
                 d.show(); */
            }
        } else {
            this.mapObj.getView().setCenter([parseFloat(point[0]), parseFloat(point[1])]);
            this.mapObj.getView().setZoom(level);

            if (!symb) return;

            // create a symbol to show            
            this.highlightSrchObj(point, accuracy, heading);

            /* for (var i = this.mapObj.popups.length - 1; i >= 0; i--) {
                this.mapObj.removePopup(this.mapObj.popups[i]);
            } */
            njs.AppManager.StartParams.address = decodeURIComponent(njs.AppManager.StartParams.address);
        }
    }));
};

/*-------------------------------------------------------------------------------
    method highlightSrchObj
	
    Handler calld when a feature has been selected from the selectCosmeticCtrl object.
    Will open a popup info bubble
    [OpenLayers.Feature] feature: selected feature
--------------------------------------------------------------------------------*/
njs.Map.olMap.prototype.highlightSrchObj = function (point, accuracy, heading, highlightobj) {
    require(["dojo/_base/lang"], dojo.hitch(this, function (lang) {
        var _highlightobj;
        if (accuracy) {
            var src = '';
            if (heading !== false && heading !== null) {
                src = "../core/symbolsets/mapplus/position_heading.svg";
            } else {
                src = "../core/symbolsets/mapplus/position.svg";
            }
            _highlightobj = [];
            _highlightobj[0] = new ol.style.Style({
                image: new ol.style.Icon({
                    width: 36,
                    rotation: heading / 180 * Math.PI + this.mapObj.getView().getRotation(),
                    src: src
                })
            });

            var accuracy_radius = new ol.geom.Circle(point, accuracy);

            _highlightobj[1] = new ol.style.Style({
                geometry: accuracy_radius,
                fill: new ol.style.Fill({ color: [244, 131, 13, 0.4] }),
                stroke: new ol.style.Stroke({ color: [244, 131, 13], width: 1 })
            });
        } else {
            if (highlightobj) {
                _highlightobj = highlightobj;
            }
            else if (njs.config.searchoptions) {
                _highlightobj = this.getNewOLStyle(njs.config.searchoptions.coordinates.highlight.style, 'Point');
            } else {
                _highlightobj = new ol.style.Style({
                    image: new ol.style.Circle({
                        radius: 8,
                        fill: new ol.style.Fill({ color: [0, 0, 255, 0.4] }),
                        stroke: new ol.style.Stroke({ color: [0, 0, 85], width: 2 })
                    })
                });
            }
        }
        this.highlightLayer.getSource().clear();

        var iconFeature = new ol.Feature({
            geometry: new ol.geom.Point(point)
        });

        iconFeature.setStyle(_highlightobj);
        this.highlightLayer.getSource().addFeature(iconFeature);
    }));
};


/*-------------------------------------------------------------------------------
    method refreshMapSize
	
    Called to refresh the map related tools and objects when the map is resized
    programatically 
--------------------------------------------------------------------------------*/
njs.Map.olMap.prototype.refreshMapSize = function () {
    this.mapObj.updateSize();
};

njs.Map.olMap.prototype.setMapBookmark = function (str) {
    njs.AppManager.deselectAllLayers([this.id]);
};


njs.Map.olMap.prototype.loadCustomBaseMap = function (lyr_id) {
    this._arStoreVisibleLayers = [];

    var curr_lays = njs.AppManager.getVisibleLayersByMap(this.id);
    for (var lay in curr_lays) {
        this._arStoreVisibleLayers.push(curr_lays[lay].id);
    }

    for (var item_lyrmgr in njs.AppManager.LyrMgr) {
        if (dojo.indexOf(njs.AppManager.LyrMgr[item_lyrmgr].targetMap, this.id) != -1) {
            njs.AppManager.LyrMgr[item_lyrmgr].deselectAll();
        }
    }

    if (!this._storeCoverLayer) {
        var _lyr_def;
        if (njs.config.lyrmgr) {
            if (njs.config.lyrmgr.layers[lyr_id]) {
                _lyr_def = njs.config.lyrmgr.layers[lyr_id];
                _lyr_def.id = lyr_id;
                _lyr_def.name = lyr_id;
            }
        }

        switch (_lyr_def["type"]) {
            case "WMS":
                this._storeCoverLayer = new WMS(_lyr_def.name, _lyr_def.url, _lyr_def.params, _lyr_def.options);
                break;
        }

    }

    this.mapObj.addLayer(this._storeCoverLayer);
    // this layer must be underneath the rectangle layer and labels, the set it just above the current base layer (base map)
    var _lyridx = this.mapObj.getLayerIndex(this.mapObj.getLayers().getArray()[0]);
    if (_lyridx > -1) this.mapObj.setLayerIndex(this._storeCoverLayer, _lyridx + 1);

    this.mapObj.getLayers().getArray()[0].setVisibility(false);
    this._disableChangeBaseMap = true;


};

njs.Map.olMap.prototype.unloadCustomBaseMap = function () {
    if (this._arStoreVisibleLayers.length > 0) {

        for (var item_lyrmgr in njs.AppManager.LyrMgr) {
            if (dojo.indexOf(njs.AppManager.LyrMgr[item_lyrmgr].targetMap, this.id) != -1) {
                for (var idx in this._arStoreVisibleLayers) {
                    njs.AppManager.LyrMgr[item_lyrmgr].switchLayer(this._arStoreVisibleLayers[idx], true);
                }
            }
        }
        this._arStoreVisibleLayers = [];

    }
    this.mapObj.removeLayer(this._storeCoverLayer);
    this.mapObj.getLayers().getArray()[0].setVisibility(true);
    this._disableChangeBaseMap = false;
};

njs.Map.olMap.prototype.loadCustomLayer = function (lyr_id, lyr_idx, vis_lays, disable_basemap) {
    this._arStoreVisibleLayers = [];

    var curr_lays = njs.AppManager.getVisibleLayersByMap(this.id);
    for (var lay in curr_lays) {
        this._arStoreVisibleLayers.push(curr_lays[lay].id);
    }

    for (var item_lyrmgr in njs.AppManager.LyrMgr) {
        if (dojo.indexOf(njs.AppManager.LyrMgr[item_lyrmgr].targetMap, this.id) != -1) {
            njs.AppManager.LyrMgr[item_lyrmgr].deselectAll();

            if (vis_lays && typeof vis_lays != "string") {
                for (var l in vis_lays) {
                    njs.AppManager.LyrMgr[item_lyrmgr].switchLayer(vis_lays[l], true);
                }
            }
        }
    }

    // this method allows only one custom layer in the application
    if (!this._storeCoverLayer) {
        var _lyr_def;
        if (njs.config.lyrmgr) {
            if (njs.config.lyrmgr.layers[lyr_id]) {

                _lyr_def = njs.config.lyrmgr.layers[lyr_id];
                _lyr_def.id = lyr_id;
                _lyr_def.name = lyr_id;

                if (_lyr_def.widget) {
                    var _sep = "";
                    if (_lyr_def.url.indexOf('?') == -1) _sep = "?";
                    else if (_lyr_def.url.indexOf('&') == -1) _sep = "&";
                    var _baseurl = "" + _lyr_def.url + _sep + "lid=" + _lyr_def.id;
                    this._storeCoverLayerWidget = {
                        "base_url": _baseurl,
                        "widget": _lyr_def.widget
                    };
                    for (var wtype in _lyr_def.widget) {
                        switch (wtype) {
                            case "addparam":
                                var _lastchar = _baseurl.slice(-1);
                                var _newurl = _lastchar == "?" || _lastchar == "&" ? _baseurl.substr(0, _baseurl.length - 1) : _baseurl.toString();
                                for (var i = 0; i < _lyr_def.widget[wtype].length; i++) {
                                    var _val = null;
                                    if (dijit.byId(_lyr_def.widget[wtype][i].source)) {
                                        _val = dijit.byId(_lyr_def.widget[wtype][i].source).displayedValue;
                                        if (typeof _val == "undefined") _val = dijit.byId(_lyr_def.widget[wtype][i].source).value;
                                    }
                                    if (_val === null || typeof _val === "undefined" || _val === "") {
                                        if (_lyr_def.widget[wtype][i].default) {
                                            _val = _lyr_def.widget[wtype][i].default;
                                        } else {
                                            _val = null;
                                        }
                                    } else if (_val instanceof Array) {
                                        _val = _val.join("|");
                                    }
                                    if (_val != null) {
                                        if (_newurl.indexOf('?') == -1) _newurl += "?";
                                        else _newurl += "&";
                                        _newurl += _lyr_def.widget[wtype][i].param + "=" + _val;
                                    }
                                }
                                _lyr_def.url = _newurl;
                                break;
                        }
                    }
                }


            }

        }

        switch (_lyr_def["type"]) {
            case "WMS":
                this._storeCoverLayer = new WMS(_lyr_def.name, _lyr_def.url, _lyr_def.params, _lyr_def.options);
                break;
        }

    }
    //cam v4
    /*  if (dojo.byId("infolay_wait") != null) {
        this._storeCoverLayer.events.register("loadstart", this, function() {
            this.manageLoadingLayer(this._storeCoverLayer.name, true);
        });
        this._storeCoverLayer.events.register("loadend", this, function() {
            this.manageLoadingLayer(this._storeCoverLayer.name, false);
        });
    } */

    this.mapObj.addLayer(this._storeCoverLayer);
    // this layer must be underneath the rectangle layer and labels, the set it just above the current base layer (base map)
    var _lyridx;
    if (lyr_idx) {
        _lyridx = lyr_idx;
    } else {
        _lyridx = this.mapObj.getLayerIndex(this.mapObj.getLayers().getArray()[0]);
        if (_lyridx > -1) _lyridx += 1;
    }
    if (_lyridx > -1) this.mapObj.setLayerIndex(this._storeCoverLayer, _lyridx);


    if (disable_basemap) {
        this.mapObj.getLayers().getArray()[0].setVisibility(false);
        this._disableChangeBaseMap = true;
    }

};

njs.Map.olMap.prototype.unloadCustomLayer = function (disable_basemap) {

    for (var item_lyrmgr in njs.AppManager.LyrMgr) {
        if (dojo.indexOf(njs.AppManager.LyrMgr[item_lyrmgr].targetMap, this.id) != -1) {
            njs.AppManager.LyrMgr[item_lyrmgr].deselectAll();
            if (this._arStoreVisibleLayers.length > 0) {
                for (var idx in this._arStoreVisibleLayers) {
                    njs.AppManager.LyrMgr[item_lyrmgr].switchLayer(this._arStoreVisibleLayers[idx], true);
                }
            }
        }
    }
    this._arStoreVisibleLayers = [];
    this.mapObj.removeLayer(this._storeCoverLayer);
    //cam v4
    /*  if (dojo.byId("infolay_wait") != null) {
        this._storeCoverLayer.events.unregister("loadstart", this, function() {
            this.manageLoadingLayer(this._storeCoverLayer, true);
        });
        this._storeCoverLayer.events.unregister("loadend", this, function() {
            this.manageLoadingLayer(this._storeCoverLayer, false);
        });
    } */

    if (disable_basemap) {
        this.mapObj.getLayers().getArray()[0].setVisibility(true);
        this._disableChangeBaseMap = false;
    }
};

njs.Map.olMap.prototype.refreshMapLyr = function (lyr) {

    var _current_layer = njs.AppManager.getLayerByMap(this.id, lyr);

    if (_current_layer != null && typeof _current_layer != "undefined") {
        if (_current_layer.type != 'WMS') _current_layer._lyr.getSource().refresh();
        else {
            // refresh works only on visible layers (loaded in map). In case the layer is off, 
            // change its url with a timestamp in order to prevent cached images
            /* var _timestamp = (+ new Date());
            _current_layer.updateLayerSource(["prevCache"], _timestamp.toString()); */

            _current_layer._lyr.getSource().updateParams({ "time": Date.now() });

        }
    } else {
        console.warn("tried to refresh layer '" + lyr + "' but not found in layer manager");
    }
};

njs.Map.olMap.prototype.refreshFormMapLyr = function (lyr) {
    var arr_lays = null;

    if (lyr.indexOf("widget|") === 0) {
        var _ar_item = lyr.split("|");
        var _w_type = _ar_item[1];
        var _w_prop = _ar_item[2];
        var _w_val = _ar_item[3];

        var all_lays = njs.AppManager.getAllLayerObjs(this.id);
        for (var _lay in all_lays) {
            if (all_lays[_lay].widget != null && typeof all_lays[_lay].widget != 'undefined') {
                if (all_lays[_lay].widget[_w_type] != null && typeof all_lays[_lay].widget[_w_type] != 'undefined') {
                    if (all_lays[_lay].widget[_w_type][_w_prop] != null && typeof all_lays[_lay].widget[_w_type][_w_prop] != 'undefined') {
                        if (all_lays[_lay].widget[_w_type][_w_prop] == _w_val) {
                            if (arr_lays == null) arr_lays = [];
                            arr_lays.push(_lay);
                        }
                    }
                }
            }
        }
    } else if (njs.AppManager.Tools.SelectTools) {
        for (var _map in njs.AppManager.Tools.SelectTools) {
            for (var _tool in njs.AppManager.Tools.SelectTools[_map]) {
                var _sel_tool = njs.AppManager.Tools.SelectTools[_map][_tool];
                if (_sel_tool.handler && _sel_tool.handler.layers) {
                    var _layer = _sel_tool.handler.layers[lyr];
                    if (_layer != null && typeof _layer != 'undefined') {
                        arr_lays = _layer.linked_layer;
                        break;
                    }
                }
            }
            if (arr_lays != null) break;
        }
    }

    if (arr_lays == null) arr_lays = [lyr];

    for (var i in arr_lays) {
        this.refreshMapLyr(arr_lays[i]);
    }
};

njs.Map.olMap.prototype.loadOLStyle = function (mystyles, geomtype = 'Point', geometry = false) {
    var styles = new Array();
    for (var i = 0; i < mystyles.length; i++) {
        var hstyle = mystyles[i];
        if (geomtype == 'Point' || geomtype == 'MultiPoint') {
            if (!hstyle.image_) return null;
            if (hstyle.image_.iconImage_) {
                let icon_options = {
                    anchor: hstyle.image_.anchor_,
                    anchorXUnits: hstyle.image_.anchorXUnits_,
                    anchorYUnits: hstyle.image_.anchorYUnits_,
                    anchorOrigin: hstyle.image_.anchorOrigin_,
                    src: hstyle.image_.iconImage_.src_
                };
                if (typeof hstyle.image_.scale_ == 'undefined') {
                    if (hstyle.image_.width_) icon_options['width'] = hstyle.image_.width_;
                    else if (hstyle.image_.iconImage_.size_) icon_options['width'] = hstyle.image_.iconImage_.size_[0];
                    if (hstyle.image_.height_) icon_options['height'] = hstyle.image_.height_;
                    else if (hstyle.image_.iconImage_.size_) icon_options['height'] = hstyle.image_.iconImage_.size_[1];
                } else if (hstyle.image_.scale_) {
                    icon_options['scale'] = hstyle.image_.scale_;
                }
                var style = new ol.style.Style({
                    image: new ol.style.Icon(icon_options)
                });
            } else {
                if (hstyle.graphicName_ && hstyle.graphicName_ == 'square') {
                    var style = new ol.style.Style({
                        image: new ol.style.RegularShape({
                            fill: new ol.style.Fill({ color: hstyle.image_.fill_.color_ }),
                            stroke: new ol.style.Stroke({ color: hstyle.image_.stroke_.color_, width: hstyle.image_.stroke_.width_ }),
                            radius: hstyle.image_.radius_ ? hstyle.image_.radius_ : hstyle.image_.width_ / 2,
                            points: 4,
                            angle: Math.PI / 4
                        })
                    });
                } else if (hstyle.graphicName_ && hstyle.graphicName_ == 'triangle') {
                    var style = new ol.style.Style({
                        image: new ol.style.RegularShape({
                            fill: new ol.style.Fill({ color: hstyle.image_.fill_.color_ }),
                            stroke: new ol.style.Stroke({ color: hstyle.image_.stroke_.color_, width: hstyle.image_.stroke_.width_ }),
                            radius: hstyle.image_.radius_ ? hstyle.image_.radius_ : hstyle.image_.width_ / 2,
                            points: 3,
                            angle: 0
                        })
                    });
                } else if (hstyle.graphicName_ && hstyle.graphicName_ == 'star') {
                    var style = new ol.style.Style({
                        image: new ol.style.RegularShape({
                            fill: new ol.style.Fill({ color: hstyle.image_.fill_.color_ }),
                            stroke: new ol.style.Stroke({ color: hstyle.image_.stroke_.color_, width: hstyle.image_.stroke_.width_ }),
                            radius: hstyle.image_.radius_ ? hstyle.image_.radius_ : hstyle.image_.width_ / 2,
                            radius2: hstyle.image_.radius_ ? hstyle.image_.radius_ * 0.4 : hstyle.image_.width_ / 2 * 0.4,
                            points: 5,
                            angle: 0
                        })
                    });
                } else if (hstyle.graphicName_ && hstyle.graphicName_ == 'cross') {
                    var style = new ol.style.Style({
                        image: new ol.style.RegularShape({
                            fill: new ol.style.Fill({ color: hstyle.image_.fill_.color_ }),
                            stroke: new ol.style.Stroke({ color: hstyle.image_.stroke_.color_, width: hstyle.image_.stroke_.width_ }),
                            radius: hstyle.image_.radius_ ? hstyle.image_.radius_ : hstyle.image_.width_ / 2,
                            radius2: 0,
                            points: 4,
                            angle: 0
                        })
                    });
                } else {
                    var radius =
                        hstyle.image_.radius !== undefined ? hstyle.image_.radius :
                            hstyle.image_.radius_ !== undefined ? hstyle.image_.radius_ :
                                hstyle.image_.width_ !== undefined ? hstyle.image_.width_ / 2 :
                                    5;

                    var style = new ol.style.Style({
                        image: new ol.style.Circle({
                            fill: new ol.style.Fill({ color: hstyle.image_.fill_.color_ }),
                            radius: radius
                        })
                    });
                    if (hstyle.image_.stroke_) style.getImage().setStroke(new ol.style.Stroke({ color: hstyle.image_.stroke_.color_, width: hstyle.image_.stroke_.width_ }));
                }
            }
        } else {
            var style = new ol.style.Style({
                fill: new ol.style.Fill({ color: hstyle.fill_.color_ }),
                stroke: new ol.style.Stroke({ color: hstyle.stroke_.color_, width: hstyle.stroke_.width_, lineDash: hstyle.stroke_.lineDash_ })
            });
        }
        if (hstyle.text_) {
            let text_opts = {
                text: hstyle.text_.text_,
                textAlign: hstyle.text_.textAlign_,
                font: hstyle.text_.font_,
                fill: new ol.style.Fill({ color: hstyle.text_.fill_.color_ })
            };
            if (hstyle.text_.stroke_) text_opts['stroke'] = new ol.style.Stroke({ color: hstyle.text_.stroke_.color_, width: hstyle.text_.stroke_.width_ });
            if (hstyle.text_.rotation_) text_opts['rotation'] = hstyle.text_.rotation_;
            if (hstyle.text_.offsetX_) text_opts['offsetX'] = parseInt(hstyle.text_.offsetX_);
            if (hstyle.text_.offsetY_) text_opts['offsetY'] = parseInt(hstyle.text_.offsetY_);
            if (hstyle.text_.textAlign_) text_opts['textAlign'] = hstyle.text_.textAlign_;
            if (hstyle.text_.textBaseline_) text_opts['textBaseline'] = hstyle.text_.textBaseline_;

            let textStyle = new ol.style.Text(text_opts);
            style.setText(textStyle);
        }
        if (hstyle.rotation_) style.getImage().setRotation(hstyle.rotation_);
        if (geometry) style.setGeometry(hstyle.geometry);
        else if (hstyle.geometry_) style.setGeometry(hstyle.geometry_);
        if (hstyle.zIndex_) style.setZIndex(hstyle.zIndex_);
        styles[i] = style;
    }
    if (styles.length == 1) return styles[0];
    else return styles;
};

njs.Map.olMap.prototype.getNewOLStyle = function (hstyle, geomtype = 'Point') {
    if (hstyle == null) return;
    if (hstyle.fillColor) {
        var fillColor = ol.color.asArray(hstyle.fillColor).slice();
        if (hstyle.fillOpacity >= 0 && hstyle.fillOpacity <= 1) fillColor[3] = hstyle.fillOpacity;

    } else {
        var fillColor = [0, 0, 0, 0];
    }
    if (hstyle.strokeColor) {
        var strokeColor = ol.color.asArray(hstyle.strokeColor).slice();
        if (hstyle.strokeOpacity >= 0 && hstyle.strokeOpacity <= 1) strokeColor[3] = hstyle.strokeOpacity;
    } else {
        var strokeColor = [0, 0, 0, 0];
    }
    if (geomtype == 'Point' || geomtype == 'MultiPoint') {
        if (hstyle.externalGraphic) {
            if (hstyle.graphicWidth) {
                var style = new ol.style.Style({
                    image: new ol.style.Icon({
                        width: hstyle.graphicWidth,
                        height: hstyle.graphicHeight,
                        anchorXUnits: 'pixels',
                        anchorYUnits: 'pixels',
                        anchorOrigin: 'top-left',
                        rotateWithView: hstyle.rotateWithView ? hstyle.rotateWithView : false,
                        src: hstyle.externalGraphic
                    })
                });
            } else {
                let icon_options = {
                    rotateWithView: hstyle.rotateWithView ? hstyle.rotateWithView : false,
                    anchorXUnits: hstyle.anchor && hstyle.anchor.offsetX != "undefined" ? 'pixels' : 'fraction',
                    anchorYUnits: hstyle.anchor && hstyle.anchor.offsetY != "undefined" ? 'pixels' : 'fraction',
                    anchorOrigin: hstyle.anchor && typeof hstyle.anchor.anchorOrigin != "undefined" ? hstyle.anchor.anchorOrigin : 'top-left',
                    src: hstyle.externalGraphic
                };
                if (typeof hstyle.scale == 'undefined') {
                    let width = hstyle.width ? hstyle.width : hstyle.pointRadius * 2;
                    icon_options['width'] = width;
                    icon_options['height'] = hstyle.height ? hstyle.height : width;
                } else if (hstyle.scale) {
                    icon_options['scale'] = hstyle.scale;
                }
                if (typeof hstyle.graphicXOffset != "undefined" && typeof hstyle.graphicYOffset != "undefined") {
                    icon_options['anchor'] = [-parseFloat(hstyle.graphicXOffset), -parseFloat(hstyle.graphicYOffset)];
                }
                if (hstyle.anchor && typeof hstyle.anchor.offsetX != "undefined") {
                    icon_options['anchor'] = [parseFloat(hstyle.anchor.offsetX), parseFloat(hstyle.anchor.offsetY)];
                }
                var style = new ol.style.Style({
                    image: new ol.style.Icon(icon_options)
                });
            }
            if (hstyle.fillOpacity && hstyle.fillOpacity >= 0 && hstyle.fillOpacity <= 1) style.getImage().setOpacity(hstyle.fillOpacity);
        } else {
            if (hstyle.graphicName && hstyle.graphicName == 'square') {
                var style = new ol.style.Style({
                    image: new ol.style.RegularShape({
                        fill: new ol.style.Fill({ color: fillColor }),
                        stroke: new ol.style.Stroke({ color: strokeColor, width: hstyle.strokeWidth }),
                        radius: hstyle.pointRadius ? hstyle.pointRadius : hstyle.width / 2,
                        points: 4,
                        angle: Math.PI / 4
                    })
                });
            } else if (hstyle.graphicName && hstyle.graphicName == 'triangle') {
                var style = new ol.style.Style({
                    image: new ol.style.RegularShape({
                        fill: new ol.style.Fill({ color: fillColor }),
                        stroke: new ol.style.Stroke({ color: strokeColor, width: hstyle.strokeWidth }),
                        radius: hstyle.pointRadius ? hstyle.pointRadius : hstyle.width / 2,
                        points: 3,
                        angle: 0
                    })
                });
            } else if (hstyle.graphicName && hstyle.graphicName == 'star') {
                var style = new ol.style.Style({
                    image: new ol.style.RegularShape({
                        fill: new ol.style.Fill({ color: fillColor }),
                        stroke: new ol.style.Stroke({ color: strokeColor, width: hstyle.strokeWidth }),
                        radius: hstyle.pointRadius ? hstyle.pointRadius : hstyle.width / 2,
                        radius2: hstyle.pointRadius ? hstyle.pointRadius * 0.4 : hstyle.width / 2 * 0.4,
                        points: 5,
                        angle: 0
                    })
                });
            } else if (hstyle.graphicName && hstyle.graphicName == 'cross') {
                var style = new ol.style.Style({
                    image: new ol.style.RegularShape({
                        fill: new ol.style.Fill({ color: fillColor }),
                        stroke: new ol.style.Stroke({ color: strokeColor, width: hstyle.strokeWidth }),
                        radius: hstyle.pointRadius ? hstyle.pointRadius : hstyle.width / 2,
                        radius2: 0,
                        points: 4,
                        angle: 0
                    })
                });
            } else {
                var style = new ol.style.Style({
                    image: new ol.style.Circle({
                        fill: new ol.style.Fill({ color: fillColor }),
                        stroke: new ol.style.Stroke({ color: strokeColor, width: hstyle.strokeWidth }),
                        radius: hstyle.pointRadius ? hstyle.pointRadius : hstyle.width / 2
                    })
                });
            }
        }
        if (hstyle.rotation) style.getImage().setRotation(parseFloat(hstyle.rotation) / 180 * Math.PI + this.mapObj.getView().getRotation());
    } else {
        var style = new ol.style.Style({
            fill: new ol.style.Fill({ color: fillColor }),
            stroke: new ol.style.Stroke({ color: strokeColor, width: hstyle.strokeWidth })
        });
        if (geomtype == 'mixed') {
            if (hstyle.pointRadius) {
                var st_point = new ol.style.Circle({
                    fill: new ol.style.Fill({ color: fillColor }),
                    stroke: new ol.style.Stroke({ color: strokeColor, width: hstyle.strokeWidth }),
                    radius: hstyle.pointRadius
                });
            } else {
                var st_point = new ol.style.Circle({
                    fill: new ol.style.Fill({ color: [30, 147, 252, 1] }),
                    stroke: new ol.style.Stroke({ color: [255, 255, 255, 1], width: 2 }),
                    radius: 6
                });
            }
            style.setImage(st_point);
        }
        if (hstyle.strokeDashstyle) {
            let w = hstyle.strokeWidth;
            let dash = [1];
            switch (hstyle.strokeDashstyle) {
                case 'dot':
                    dash = [1, 3 * w];
                    break;
                case 'dash':
                    dash = [3 * w, 3 * w];
                    break;
                case 'dashdot':
                    dash = [3 * w, 3 * w, 1, 3 * w];
                    break;
                case 'longdash':
                    dash = [6 * w, 3 * w];
                    break;
                case 'longdashdot':
                    dash = [6 * w, 3 * w, 1, 3 * w];
                    break;
                default:
                    dash = [1];
            }
            style.getStroke().setLineDash(dash);
        }

    }
    if (hstyle.font) {
        let textAlign = 'center';
        let textBaseline = 'middle';
        let stroke = new ol.style.Stroke({ color: [255, 255, 255, 1], width: 1 });
        let offsetX = 0;
        let offsetY = 0;
        let fontSize = '12px';
        let font = hstyle.fontWeight ? hstyle.fontWeight + ' ' : '';
        if (hstyle.fontSize) fontSize;
        font += fontSize + ' ' + hstyle.font;

        if (hstyle.labelAlign) {
            if (hstyle.labelAlign[0] == 'l') textAlign = 'left';
            if (hstyle.labelAlign[0] == 'r') textAlign = 'right';

            if (hstyle.labelAlign[1] == 't') textBaseline = 'bottom';
            if (hstyle.labelAlign[1] == 'b') textBaseline = 'top';
        }

        if (hstyle.labelOutlineWidth) stroke.setWidth(hstyle.labelOutlineWidth);
        if (hstyle.labelOutlineColor) stroke.setColor(hstyle.labelOutlineColor);
        if (hstyle.labelXOffset) offsetX = hstyle.labelXOffset;
        if (hstyle.labelYOffset) offsetY = -hstyle.labelYOffset;

        style.setText(new ol.style.Text({
            font: font,
            //offsetX: Math.sin(rad_opp) * (radius + 5),
            //offsetY: Math.cos(rad_opp) * (radius + 5),
            textBaseline: textBaseline,
            textAlign: textAlign,
            offsetX: offsetX,
            offsetY: offsetY,
            stroke: stroke,
            fill: hstyle.fontColor ? new ol.style.Fill({ color: hstyle.fontColor }) : new ol.style.Fill({ color: hstyle.fillColor })
        }));
    }
    if (hstyle.zIndex) style.setZIndex(hstyle.zIndex);
    return style;
};

//# sourceURL=mapplus://provider/OLPlus/openlayers.js
