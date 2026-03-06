/* global njs */
/* global dojo */
/* global dijit */
/* global moment */
/* global Sortable */
/* global eval */
/* jslint node: true */
"use strict";
/* Copyright (c) 2010-2011 Tydac, Inc. */

/**
 * @requires njs.js
 */

/*-------------------------------------------------------------------------------
	Workaround for creating custom events in IE
	We create a documentElement property which will be changed when the
	custom event must be fired
--------------------------------------------------------------------------------*/
if (document.attachEvent) { // MSIE
    document.documentElement.changeLayerVisibility = 0; // an expando property
    document.documentElement.changeLayerVisibilityMap = ""; // an expando property
}

/*-------------------------------------------------------------------------------
	Layers Class
	
	Base Layer class from which all other layer's type will be derivated
	[id]	: object's unique id
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Layers = function (options) {
    /* properties */
    this.id = null;
    this.type = null;
    this.url = null;
    this.icon = null;
    this.name = null;
    this.description = null;
    this.rank = null;
    //this.attr_editable=0;
    //this.geo_editable=0;
    this.editobj = "";
    this.searchable = 0;
    this.open_list = null;
    this.minlevel = 0;
    this.maxlevel = 0;
    this.opacity = 1;
    this.legend = null;
    this.tt_legend = null;
    this.tt_layers = null;
    this.domLocation = '';
    this.targetMap = null;
    this.maxResolution = null;
    this.minResolution = null;
    this._ctrButtons = [];	// [diji.form.Button] UI button for activating the digitize button
    this.geoFilter = null;
    this.timestamp = null;
    this.current_zoomvisible = false;
    this.group_layer=null;
    // accept widgets for the layers. Must be set while called
    // even if not used
    this.widget = {};

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
njs.Layers.prototype.Init = function (options) {
    if (options) {
        //this.id = options.id;
        this.id = options.name;
        this.id_lyr_mgr = options.id_lyr_mgr;
        this.type = options.type;
        this.targetMap = options.targetMap;
        this.url = options.url;
        this.icon = options.icon;
        this.icon_style = options.icon_style ? options.icon_style : '';
        this.icon_class = options.icon_class ? options.icon_class : '';
        this.name = options.name;
        this.description = options.description;
        this.rank = (options.rank && options.rank > 1) ? options.rank : 1;
//		this.attr_editable = options.attr_editable ? options.attr_editable: 0;
//		this.geo_editable = options.geo_editable ? options.geo_editable : 0;
        this.editobj = options.editing ? options.editing : null;
        this.searchable = options.searchable;
        this.open_list = options.open_list;
        if (options.legend) this.legend = options.legend;
        if (options.tt_legend) this.tt_legend = options.tt_legend;
        if (options.tt_layers) this.tt_layers = options.tt_layers;
        if (options.maxResolution != null && typeof options.maxResolution != "undefined") this.maxResolution = options.maxResolution;
        if (options.minResolution != null && typeof options.minResolution != "undefined") this.minResolution = options.minResolution;
        if (options.geoFilter) this.geoFilter = options.geoFilter;

        this.group_layer =  (options.group_layer) ? options.group_layer : null;

        this.timestamp = null;
        this.current_zoomvisible = false;
        this.visible = false;
        this.start_visible = options.visible ? options.visible : 0;

	this.logging = options.logging ? options.logging : null;

    }
};
/*-------------------------------------------------------------------------------
	method Activate
	Build the dojo GUI
--------------------------------------------------------------------------------*/
njs.Layers.prototype.Activate = function () {

};
/*-------------------------------------------------------------------------------
	method setStatus
	Build the dojo GUI
--------------------------------------------------------------------------------*/
njs.Layers.prototype.setStatus = function (resolution) {

};
/*-------------------------------------------------------------------------------
	method createLayer
--------------------------------------------------------------------------------*/
njs.Layers.prototype.createLayer = function () {

};

/*-------------------------------------------------------------------------------
	method addModifyControl
--------------------------------------------------------------------------------*/
njs.Layers.prototype.addModifyControl = function () {

};

/*-------------------------------------------------------------------------------
	method removeTools
--------------------------------------------------------------------------------*/
njs.Layers.prototype.removeTools = function () {
    //deactivate associated tools
    for (var _tool in this.tools) {
        this.tools[_tool].deactivate();
    }
    //remove digitize tool button from gui
    for (var t = 0; t < this._ctrButtons.length; t++) {
        if (this._ctrButtons[t]) this._ctrButtons[t].destroy();
    }
};

/*-------------------------------------------------------------------------------
	Layers.WMS Class
	
	Class creating a tabbed layers manager with categories like in Mapplus.
	[id]	: object's unique id
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Layers.WMS = function (id, options) {
    /* properties */
    this.id = id;
    this._tools = null;
    this.tools = null;
    this._ctrButtons = [];
    if (options) {
        this.Init(options);
    }
};
njs.Layers.WMS.prototype = new njs.Layers;
njs.Layers.WMS.prototype.constructor = njs.Layers.WMS;
njs.Layers.WMS.superclass = njs.Layers.prototype;

/*-------------------------------------------------------------------------------
	Layers.arcgisRest Class
	
	Class creating a tabbed layers manager with categories like in Mapplus.
	[id]	: object's unique id
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Layers.arcgisRest = function (id, options) {
    /* properties */
    this.id = id;
    this._tools = null;
    this.tools = null;
    this._ctrButtons = [];
    if (options) {
        this.Init(options);
    }
};
njs.Layers.arcgisRest.prototype = new njs.Layers;
njs.Layers.arcgisRest.prototype.constructor = njs.Layers.arcgisRest;
njs.Layers.arcgisRest.superclass = njs.Layers.prototype;

/*-------------------------------------------------------------------------------
	Layers.GeoJSON Class
	
	Class creating a tabbed layers manager with categories like in Mapplus.
	[id]	: object's unique id
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Layers.GeoJSON = function (id, options) {
    /* properties */
    this.id = id;
    this.DBTable = null;
//	this.attr_editable = 0;
//	this.geo_editable = 0;
    this.snappable = 0;
    // SelectFeature Control
    this._SelectControl = null;
    // ModifyFeature Control
    this._ModifyControl = null;
    // Snapping Control
    this._SnappingControl = null;
    this.hover = true;
    this._MapTips = null;			// MapTips can be: Dynamic Mouse OVer information or Popup Window
    this._ctrButtons = [];	// [diji.form.Button] UI button for activating the digitize button
    this.save_url = null;
    this._tools = null;
    this.tools = null;			// [javascript object] contains all controls associated with that layer such as digitize, opacity
    //feature currently selected by click or hover
    this.protocol = null;
    this._selectedFeature = null;
    this._selectedFeatures = [];		//collection of selected features after using selection tools
    if (options) {
        this.Init(options);
    }
};
njs.Layers.GeoJSON.prototype = new njs.Layers;
njs.Layers.GeoJSON.prototype.constructor = njs.Layers.GeoJSON;
njs.Layers.GeoJSON.superclass = njs.Layers.prototype;


//=====================================================================================================
//		OSM
//=====================================================================================================
/*-------------------------------------------------------------------------------
	Layers.OSM Class
	
	Class creating a tabbed layers manager with categories like in Mapplus.
	[id]	: object's unique id
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Layers.OSM = function (id, options) {
    /* properties */
    this.id = id;
    this._tools = null;
    this.tools = null;
    this._ctrButtons = [];
    if (options) {
        this.Init(options);
    }
};
njs.Layers.OSM.prototype = new njs.Layers;
njs.Layers.OSM.prototype.constructor = njs.Layers.XYZ;
njs.Layers.OSM.superclass = njs.Layers.prototype;

//=====================================================================================================
//		XYZ
//=====================================================================================================
/*-------------------------------------------------------------------------------
	Layers.XYZ Class
	
	Class creating a tabbed layers manager with categories like in Mapplus.
	[id]	: object's unique id
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.Layers.XYZ = function (id, options) {
    /* properties */
    this.id = id;
    this._tools = null;
    this.tools = null;
    this._ctrButtons = [];
    if (options) {
        this.Init(options);
    }
};
njs.Layers.XYZ.prototype = new njs.Layers;
njs.Layers.XYZ.prototype.constructor = njs.Layers.XYZ;
njs.Layers.XYZ.superclass = njs.Layers.prototype;

//=====================================================================================================
//		TMS
//=====================================================================================================
/*-------------------------------------------------------------------------------
	Layers.TMS Class
	
	Class creating a tabbed layers manager with categories like in Mapplus.
	[id]	: object's unique id
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/

njs.Layers.TMS = function (id, options) {
    /* properties */
    this.id = id;
    this._tools = null;
    this.tools = null;
    this._ctrButtons = [];
    if (options) {
        this.Init(options);
    }
};
njs.Layers.TMS.prototype = new njs.Layers;
njs.Layers.TMS.prototype.constructor = njs.Layers.TMS;
njs.Layers.TMS.superclass = njs.Layers.prototype;

//=====================================================================================================
//		WMTS
//=====================================================================================================
/*-------------------------------------------------------------------------------
	Layers.WMTS Class
	
	Class creating a tabbed layers manager with categories like in Mapplus.
	[id]	: object's unique id
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/

njs.Layers.WMTS = function (id, options) {
    /* properties */
    this.id = id;
    this._tools = null;
    this.tools = null;
    this._ctrButtons = [];
    if (options) {
        this.Init(options);
    }
};
njs.Layers.WMTS.prototype = new njs.Layers;
njs.Layers.WMTS.prototype.constructor = njs.Layers.WMTS;
njs.Layers.WMTS.superclass = njs.Layers.prototype;

//===============================================================================
//added by AGIS start
//===============================================================================
njs.Layers.geoasWMTS = function (id, options) {
    this.id = id;
    this._tools = null;
    this.tools = null;
    this._ctrButtons = [];
    if (options) {
        this.Init(options);
    }
};

njs.Layers.geoasWMTS.prototype = new njs.Layers;
njs.Layers.geoasWMTS.prototype.constructor = njs.Layers.geoasWMTS;
njs.Layers.geoasWMTS.superclass = njs.Layers.prototype;
//===============================================================================
//AGIS ENDE
//===============================================================================

//=====================================================================================================
//		Layer Manager
//=====================================================================================================

/*-------------------------------------------------------------------------------
	LayerMgr Class
	
	Base object for the different tools hosted by the application.
	Manage the tool's property and behaviour with the map objects
	[string] id: identifier for the object
	[object] options: options to be set at construction's time
--------------------------------------------------------------------------------*/
njs.LayerMgr = function (id, options) {
    this.id = id;
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
njs.LayerMgr.prototype.Init = function (options) {
    if (options) {

    }
};

//# sourceURL=mapplus://lyr_mgr.js 
