ol.style.IconImageCache.shared.setSize(1024);

proj4.defs(
    "EPSG:2056",
    "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs"
);
proj4.defs(
    "EPSG:21781",
    "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=600000 +y_0=200000 +ellps=bessel +towgs84=674.4,15.1,405.3,0,0,0,0 +units=m +no_defs"
);

/*Namespace: njs*/
njs = {};
/*Namespace:njs.config*/
njs.config = {};

/* Themes Manager: namespace and objects */
njs.ThemeManager = {};
njs.ThemeManager.Themes = function(options) {
    if (options) {
        this.init(options);
    }
};
njs.ThemeManager.Themes.prototype.items = {};
njs.ThemeManager.Themes.prototype.init = function(themes) {
    if (themes) {
        for (var i in themes) {
            if (themes[i]['id'] !== undefined) this.items[themes[i]['id']] = themes[i];
        }
    }
};
njs.ThemeManager.Themes.prototype.addTheme = function(theme) {
    if (theme) {
        if (theme.id !== undefined) this.items[theme.id] = theme;
    }
};
njs.ThemeManager.Themes.prototype.count = function(theme) {
    var icnt = 0;
    for (var _item in this.items) {
        icnt++;
    }
    return icnt;
};

njs.ThemeManager.Theme = function(options) {
    if (options) {
        this.init(options);
    }
};
njs.ThemeManager.Theme.prototype.id = null;
njs.ThemeManager.Theme.prototype.layers = {};
njs.ThemeManager.Theme.prototype.init = function(options) {
    if (options) {
        if (options['id'] !== undefined) this.id = options['id'];
        if (options['layers'] !== undefined) this.layers = options['layers'];
    }
};

/* Maps Objects */
njs.Map = function(options) {
    if (options) {
        this.set(options);
    }
};
njs.Map.prototype.id = "";
njs.Map.prototype.initialExtent = null;
njs.Map.prototype.fullExtent = [];
njs.Map.prototype.centerMap = null;
njs.Map.prototype.container = "";
njs.Map.prototype.mapObj = null;
njs.Map.prototype.measure_layer = null;
njs.Map.prototype.startMap = null;
njs.Map.prototype.basisMaps = {};
njs.Map.prototype.basisMapsArray = [];
njs.Map.prototype.currBasisMap = null;
njs.Map.prototype.themes = new njs.ThemeManager.Themes();
njs.Map.prototype.overview;
njs.Map.prototype.projection = null;
njs.Map.prototype.mapLogo = false;
njs.Map.prototype.customLods = [];
njs.Map.prototype.basisMapsSwitch = null;
njs.Map.prototype.customMapLods = null;
njs.Map.prototype.resolutions = null;
njs.Map.prototype.drawingActive = false;
njs.Map.prototype.mapUnits = null;
njs.Map.prototype.currentTool = null;
njs.Map.prototype.mask_layer = null;
njs.Map.prototype.constrainResolution=null;
njs.Map.prototype.init = function(options) {};

/*-------------------------------------------------------------------------------
	method set
	
	Sets the properties to the njs map object.
	[Object] attributes: array of properties to be set to the map object
--------------------------------------------------------------------------------*/
njs.Map.prototype.set = function(attributes) {
	var that = this;
    if (attributes) {
        for (var i in attributes) {           
            if (this[i] !== undefined) {
                switch (i) {                 
                    // create an array with the basis maps
                    case "basisMaps":
                        this.transitionEffect = (attributes['transitionEffect']!=null && attributes['transitionEffect']!='undefined') ? attributes['transitionEffect'] : "resize";
                        var _b_maps_collection = {};
                        var _b_maps = attributes[i];
                        this.hasMultiBaseMap = false;                       
                        for (var _b_map_name in _b_maps) {
                            if (_b_maps[_b_map_name]["multisource"]) {
                                if (typeof _b_maps[_b_map_name]["items"][0]['options'] =='undefined')_b_maps[_b_map_name]["items"][0]['options'] =[];
                                this.hasMultiBaseMap = true;
                                var grp=new ol.layer.Group({
                                    className: 'ol-basemap'                                   
                                });
                                var collection =new ol.Collection();
                                grp.set('name',_b_map_name);
                                grp.set('type','base');
                                grp.set('multisource',true);
                                
                                if (_b_maps[_b_map_name]["items"][0]['options']){
                                    var _restrictedExtent= _b_maps[_b_map_name]["items"][0]['options']['restrictedExtent'] ?  _b_maps[_b_map_name]["items"][0]['options']['restrictedExtent'] : attributes['restrictedExtent'];
                                    var _clippedExtent= _b_maps[_b_map_name]["items"][0]['options']['clippedExtent'] ?  _b_maps[_b_map_name]["items"][0]['options']['clippedExtent'] : attributes['clippedExtent'];
                                    var _initialExtent= _b_maps[_b_map_name]["items"][0]['options']['initialExtent'] ?  _b_maps[_b_map_name]["items"][0]['options']['initialExtent'] : attributes['initialExtent'];
                                }else{
                                    var _restrictedExtent= _b_maps[_b_map_name]["items"][0]['restrictedExtent'] ?  _b_maps[_b_map_name]["items"][0]['restrictedExtent'] : attributes['restrictedExtent'];
                                    var _clippedExtent= _b_maps[_b_map_name]["items"][0]['clippedExtent'] ?  _b_maps[_b_map_name]["items"][0]['clippedExtent'] : attributes['clippedExtent'];
                                    var _initialExtent= _b_maps[_b_map_name]["items"][0]['initialExtent'] ?  _b_maps[_b_map_name]["items"][0]['initialExtent'] : attributes['initialExtent'];
                                }
                                let resolutions=_b_maps[_b_map_name].resolutions?_b_maps[_b_map_name].resolutions:this.resolutions;
                                let minResolution=_b_maps[_b_map_name].minResolution?_b_maps[_b_map_name].minResolution:0;

                                grp.set('initialExtent',_initialExtent);
                                grp.set('restrictedExtent',_restrictedExtent);
                                grp.set('resolutions',resolutions);
                                grp.set('minResolution',minResolution);
                                
                                let opacity=_b_maps[_b_map_name]['opacity'] ?_b_maps[_b_map_name]['opacity'] : 1;                              
                                grp.setOpacity(opacity);
                                for (var i in _b_maps[_b_map_name]["items"]) {
                                    if (typeof _b_maps_collection[_b_map_name] == 'undefined' || _b_maps_collection[_b_map_name] == null) {
                                        _b_maps_collection[_b_map_name] = [];
                                    }
                                    if (_b_maps[_b_map_name]["items"][i]['options']){
                                        _b_maps[_b_map_name].items[i]['options']["initialExtent"]=_initialExtent
                                        _b_maps[_b_map_name].items[i]['options']["clippedExtent"]=_clippedExtent;
                                        _b_maps[_b_map_name].items[i]['options']["restrictedExtent"]=_restrictedExtent;
                                    }else{
                                        _b_maps[_b_map_name].items[i]["initialExtent"]=_initialExtent
                                        _b_maps[_b_map_name].items[i]["clippedExtent"]=_clippedExtent;
                                        _b_maps[_b_map_name].items[i]["restrictedExtent"]=_restrictedExtent;
                                    }                                   
                                    // create the appropriate layer type according to the provider
                                    _b_maps_collection[_b_map_name][i] = this.createLayer(_b_map_name + "_" + i, _b_maps[_b_map_name]["items"][i]);
                                    collection.push(_b_maps_collection[_b_map_name][i]);                                   
                                }
                                grp.setLayers(collection);
                                this.basisMapsArray.push(grp);
                                _b_maps_collection[_b_map_name]=grp;
                            } else {
                                if (_b_maps[_b_map_name]['options']){
                                    _b_maps[_b_map_name]['options']['restrictedExtent']= _b_maps[_b_map_name]['options']['restrictedExtent'] ?  _b_maps[_b_map_name]['options']['restrictedExtent'] : attributes['restrictedExtent'];
                                    _b_maps[_b_map_name]['options']['clippedExtent']= _b_maps[_b_map_name]['options']['clippedExtent'] ?  _b_maps[_b_map_name]['options']['clippedExtent'] : attributes['clippedExtent'];
                                    _b_maps[_b_map_name]['options']['initialExtent']= _b_maps[_b_map_name]['options']['initialExtent'] ?  _b_maps[_b_map_name]['options']['initialExtent'] : attributes['initialExtent'];
                                }else{
                                    _b_maps[_b_map_name]['restrictedExtent']= _b_maps[_b_map_name]['restrictedExtent'] ?  _b_maps[_b_map_name]['restrictedExtent'] : attributes['restrictedExtent'];
                                    _b_maps[_b_map_name]['clippedExtent']= _b_maps[_b_map_name]['clippedExtent'] ?  _b_maps[_b_map_name]['clippedExtent'] : attributes['clippedExtent'];
                                    _b_maps[_b_map_name]['initialExtent']= _b_maps[_b_map_name]['initialExtent'] ?  _b_maps[_b_map_name]['initialExtent'] : attributes['initialExtent'];
                                }                              
                                // create the appropriate layer type according to the provider
                                _b_maps_collection[_b_map_name] = this.createLayer(_b_map_name, _b_maps[_b_map_name]);
                                // create an array with these base layers
                                this.basisMapsArray.push(_b_maps_collection[_b_map_name]);
                            }
                        }
                        this.basisMaps = _b_maps_collection;
                        break;
                    default:
                        this[i] = attributes[i];                        
                        break;
                }
            }
        }
    }
};

/*-------------------------------------------------------------------------------
	method initMapping
	
	makes all the initialisation's work after the main page and libraries have
	been loaded.
	
--------------------------------------------------------------------------------*/
njs.Map.prototype.initMapping = function() {  
    var that=this;  
    
    /*  
    warning: 
    sometimes the tool parameter is taken from the id of the element defined in the configuration, 
    if a user changes the id this control will not work, for example printpdf
    */    
    const substrings = ["_profile","_area","_angle","_distance","_distance_simple","_ortho","_rl_line","_marker","_rl_text","_rl_circle","_rl_polygon","editing","selecttools","shoprectangle","touchcursormeasure","printpdf"];

    require(["dojo/dom", "dojo/topic", "dojo/domReady!"], function (dom, topic) {
        topic.subscribe("tool_deactivated", function (args) {
            if (that.currentTool===args.tool && new RegExp(substrings.join("|")).test(args.tool)) {
                that.currentTool=null;
                that.drawingActive=false;
                njs.AppManager.MapTips["_disablewmsgetfeatureinfo"][that.id] = false;
            }           
        });
        topic.subscribe("tool_activated", function (args) {
            if (new RegExp(substrings.join("|")).test(args.tool)) {
                that.currentTool=args.tool;
                that.drawingActive=true;  
                njs.AppManager.MapTips["_disablewmsgetfeatureinfo"][that.id] = true;   
            }else{
                that.currentTool=null;
                that.drawingActive=false;   
                njs.AppManager.MapTips["_disablewmsgetfeatureinfo"][that.id] = false;          
            }
        });
    });  
};
//# sourceURL=mapplus://njs.js 
