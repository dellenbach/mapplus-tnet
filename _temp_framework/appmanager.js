/* global njs */
/* jslint node: true */
"use strict";

/* Copyright (c) 2010-2011 Tydac, Inc. */

/**
 * @requires njs.js
 */

/* Application Manager Global Object */
njs.AppManager = {
    // Site parameters
    Site: "",
    Language: "",
    Version: "",
    apipath: "",
    Guid: "",
    SearchManager: null,
    Stats: null,
    // njs mapObjs collection
    Maps: {},
    Layers: {}, // test if that property can be removed, using directly the LyrMgr object fc 20130315
    // collection of tools
    Tools: {
        BaseLayerOpacity: {},
        BaseLayerToggleColor: {},
        CoordDisplay: {},
        ScaleDisplay: {},
        ElevationDisplay: {},
        OverviewDisplay: {},
        PrintScaledMap: {},
        PredefinedScaledMap: {},
        PrintMap: {},
        HTMLPrintMap: {},
        Measurement: {},
        GeoQueryFilter: {},
        MouseOver: {},
        WMSGetFeatureInfo: {},
        SelectionTools: {},
        ClearSelection: {},
        Snapping: {},
        Selecting: {},
        WMSImport: {},
        TrackBookmark: false,
        StreetView: {},
        Infra3D: {},
        Orbit: {},
        GRouting: {},
        GrayscaleOpacity: {},
        ImportTool: {},
        StructuredGPSImport: {},
        TimeSlider: {},
        ShLinkManager: {}
    },
    SelectFeature: null,
    SearchOptions: {},
    MapTips: {},
    Select: {},
    SelectControl: null,
    Snap: {},
    SnapControl: null,
    LyrMgr: {},
    StartParams: {},
    CustomInfoWin: {},
    InfoDisclaimer: {},
    loadedApiScripts: {},
    EditingTools: {},
    EditingInteractions: {},
    nls: {}
};

njs.AppManager.initApp = function () {
    njs.AppManager.keepalivetimer = setTimeout(njs.AppManager.keepUserSessionAlive, njs.AppManager.keepalivetimeout);
    // format the startparams object
    njs.AppManager.getStartParams();
    // create the GUID
    njs.AppManager.Guid = njs.AppManager.getcookie('PHPSESSID');

    require(["dijit/registry", "dojo/dom", "dojo/parser", "dojo/request/xhr"], function (registry, dom, parser, xhr) {
        var _mob = njs.AppManager.isMobile === true ? "_m" : "";
        xhr("./loader.php", {
            handleAs: "text", sync: false, preventCache: true, method: "POST",
            data: { "f": "/config/modules" + _mob + ".conf", "g": njs.AppManager.ugroup, "p": njs.AppManager.uprofile }
        }).then(function (response) {
            if (response) {
                if (response.error) {
                    // stop startprocess
                } else {
                    var find = ['#lang#', '#ugroup#', '#uprofile#', '#folder#', "#site#", "#version#"];
                    var re = [njs.AppManager.Language, njs.AppManager.ugroup, njs.AppManager.uprofile, njs.AppManager.Folder, njs.AppManager.Site, njs.AppManager.Version];
                    var items = JSON.parse(njs.AppManager.replaceCumulative(response, find, re));
                    for (var cnf in items) {
                        switch (cnf) {
                            case "TrackBookmark":
                                njs.AppManager.Tools.TrackBookmark = items[cnf];
                                break;
                            case "MenuPane":
                                njs.Layout.MenuPane = items[cnf];
                                break;
                            case "defmodules":
                                njs.AppManager.defmodules = items[cnf];
                                break;
                            case "mainpane_container":
                                njs.config.mainpane_container = items[cnf];
                                break;
                            case "defbuttons":
                                njs.AppManager.defbuttons = items[cnf];
                                break;
                            case "logUser":
                                if (items[cnf].cgi != null && typeof items[cnf].cgi != "undefined") {
                                    njs.AppManager.logUser(items[cnf].cgi, items[cnf].dbconn_id);
                                }
                                break;
                        }
                    }

                    //Do some styling work on the free menu pane if any
                    if (njs.Layout.MenuPane.type == "freepane") njs.Layout.initTitleFreePaneItems();
                    // load the map options
                    njs.AppManager.loadThemeMapOptions(".", njs.AppManager.uprofile);
                    ol.proj.proj4.register(proj4);
                }
            } else {
                console.error("Error loading modules.conf");
            }
        }, function (err) {
            // Handle the error condition
            console.error("Error: %o", err);
        });
    });
};

/*-------------------------------------------------------------------------------
    method require

    Checks and loads a javascript library

    [string] name : library's name
    [string] file : path and filename of the library
--------------------------------------------------------------------------------*/

njs.AppManager.require = function (name, file) {
    if (!njs.AppManager.loadedApiScripts[name]) {
        xhr(file, {
            handleAs: "javascript", preventCache: false, sync: true
        }).then(function (response) {
            njs.AppManager.loadedApiScripts[name] = true;
        }, function (err) {
            // Handle the error condition
            console.error("Error loading provider library: %o", err);
        }
        );
    }
};

/*-------------------------------------------------------------------------------
    method loadThemeMapOptions

    Load the map and lounch the application's build up

    [string] theme_uri: current thematique relative url
    [string] uprofile: current user's profile

--------------------------------------------------------------------------------*/
njs.AppManager.loadThemeMapOptions = function (theme_uri, uprofile) {
    // first step in the app startup, which must be synchron. Then load also common libraries used later
    require(["dijit/registry", "dojo/dom", "dojo/_base/array", "dojo/parser", "dojo/request/xhr", "dojo/DeferredList"], function (registry, dom, array, parser, xhr, DeferredList) {

        xhr(theme_uri + "/loader.php", {
            handleAs: "json", sync: false, preventCache: true, method: "POST",
            data: { "f": "/config/basemaps.conf", "g": njs.AppManager.ugroup, "p": uprofile }
        }).then(function (response) {
            if (response) {
                if (response.error) {
                    // stop startprocess
                } else {
                    // assign json object to variable
                    njs.config.basisMaps = response;

                    //read localization resources for texts in one shot
                    var getNLSFile = function (theme_uri, uprofile, item) {
                        // user the class notation 'dojo.xhr()' and not the variable xhr
                        var headers = [];
                        if (typeof app != "undefined" && app != null && app.clientId) {  //added by AGIS: token mit übertragen
                            headers = {
                                "ClientId": app.clientId,
                                "PortalId": app.portal.name,
                                "Authorization": app.user.token,
                                "Username": app.user.name,
                                "IsMobile": njs.AppManager.isMobile
                            };
                        }
                        return dojo.xhr("POST", {
                            url: njs.AppManager.apipath + njs.AppManager.Version + "/php/nls.php",
                            handleAs: "json",
                            preventCache: true,
                            content: { "f": item, "profile": uprofile, "lang": njs.AppManager.Language, "folder": njs.AppManager.Folder, "site": njs.AppManager.Site },
                            headers: headers
                        }).then(
                            function (res) {
                                if (res.error != null || typeof res.error != "undefined") {
                                    console.error("Error: %o", res.error, item);
                                } else {
                                    njs.AppManager.nls[item] = res;
                                }
                                return null;
                            },
                            function (err) {
                                // Handle the error condition
                                console.error("Error: %o", err, item);
                            }
                        );
                    };

                    var dList = new DeferredList([
                        getNLSFile(theme_uri, uprofile, "toolsResources"),
                        getNLSFile(theme_uri, uprofile, "disclaimerResources"),
                        getNLSFile(theme_uri, uprofile, "editingResources"),
                        getNLSFile(theme_uri, uprofile, "legendResources"),
                        getNLSFile(theme_uri, uprofile, "lyrmgrResources"),
                        getNLSFile(theme_uri, uprofile, "maptipsResources")
                    ]);
                    dList.then(function (arrayOfValues) {
                        for (var bmap in njs.config.basisMaps) {
                            if (typeof njs.config.basisMaps[bmap].id == "undefined") njs.config.basisMaps[bmap].id = bmap;
                            njs.AppManager.Maps[bmap] = new njs.Map.olMap(njs.config.basisMaps[bmap]);
                            njs.AppManager.Maps[bmap].initMapping();
                        }

                        // now the map is set up load the app modules
                        njs.AppManager.loadThemeModules(theme_uri, uprofile);
                    });
                }
            }
        }, function (err) {
            // Handle the error condition
            console.error("Error: %o", err);
        });
    });
};

/*-------------------------------------------------------------------------------
    method loadThemeModules

    Add the modules to the application

    [string] theme_uri: current thematique relative url
    [string] uprofile: current user's profile

--------------------------------------------------------------------------------*/
njs.AppManager.loadThemeModules = function (theme_uri, uprofile) {
    require(["dojo/request/xhr", "dojo/DeferredList"], function (xhr, DeferredList) {
        var _deferred_items = [];

        var getConfFile = function (theme_uri, uprofile, item) {
            // user the class notation 'dojo.xhr()' and not the variable xhr
            var headers = [];
            if (typeof app != "undefined" && app != null && app.clientId) {  //added by AGIS: token mit übertragen
                headers = {
                    "ClientId": app.clientId,
                    "PortalId": app.portal.name,
                    "Authorization": app.user.token,
                    "Username": app.user.name,
                    "IsMobile": njs.AppManager.isMobile
                };
            }
            return dojo.xhr("POST", {
                url: theme_uri + "/loader.php",
                handleAs: "json",
                preventCache: true,
                content: { "f": "/config/" + item + ".conf", "g": njs.AppManager.ugroup, "p": uprofile },
                headers: headers
            }).then(function (res) {
                var arr_scripts = {
                    main: [],
                    secondary: [],
                    tertiary: []
                };
                if (res) {
                    if (!res.error) {
                        switch (item) {
                            case "maptips":
                                njs.config.maptips = res;
                                if (njs.config.maptips.general_settings != null && typeof njs.config.maptips.general_settings != "undefined") {
                                    if (arr_scripts.main.indexOf("maptips.js") == -1) {
                                        arr_scripts.main.push("maptips.js");
                                    }
                                }
                                break;
                            case "editing":
                                njs.config.editingtool = res;
                                if (arr_scripts.secondary.indexOf("editing.js") == -1) {
                                    arr_scripts.secondary.push("editing.js");
                                }
                                break;
                            case "lyrmgr":
                                njs.config.lyrmgr = res;
                                for (var item_lyrmgr in njs.config.lyrmgr) {
                                    if (item_lyrmgr !== "layers") {
                                        if (arr_scripts.main.indexOf("lyr_mgr.js") == -1) {
                                            arr_scripts.main.push("lyr_mgr.js");
                                        }
                                        if (arr_scripts.secondary.indexOf("provider/" + njs.AppManager.Provider + "/layers.js") == -1) {
                                            arr_scripts.secondary.push("provider/" + njs.AppManager.Provider + "/layers.js");
                                        }
                                        if (arr_scripts.secondary.indexOf("layer_manager/" + njs.config.lyrmgr[item_lyrmgr].type + ".js") == -1) {
                                            arr_scripts.secondary.push("layer_manager/" + njs.config.lyrmgr[item_lyrmgr].type + ".js");
                                        }
                                    }
                                }
                                break;
                            case "legends":
                                njs.config.legends = res;
                                if (arr_scripts.secondary.indexOf("legend.js") == -1) {
                                    arr_scripts.secondary.push("legend.js");
                                }
                                break;
                            case "printoptions":
                                njs.config.printoptions = res;
                                break;
                            case "searchoptions":
                                njs.config.searchoptions = res;
                                if (arr_scripts.main.indexOf("provider/" + njs.AppManager.Provider + "/Format/GeoNeapolJSON.js") == -1) {
                                    //arr_scripts.main.push("provider/" + njs.AppManager.Provider + "/Format/GeoNeapolJSON.js");
                                }
                                var _searchopt_cnt = 0;
                                for (var _srch in njs.config.searchoptions) {
                                    if (typeof njs.config.searchoptions[_srch]["type"] != "undefined" && njs.config.searchoptions[_srch]["type"] !== null) {
                                        if (arr_scripts.main.indexOf("search.js") == -1) {
                                            arr_scripts.main.push("search.js");
                                        }
                                    }
                                }
                                break;
                            case "tools":
                            case "tools_m":
                                njs.config.tools = res;
                                // load it in a first strike, before the others ?
                                if (arr_scripts.main.indexOf("provider/" + njs.AppManager.Provider + "/Format/GeoNeapolJSON.js") == -1) {
                                    //arr_scripts.main.push("provider/" + njs.AppManager.Provider + "/Format/GeoNeapolJSON.js");
                                }
                                if (arr_scripts.main.indexOf("tools.js") == -1) {
                                    arr_scripts.main.push("tools.js");
                                }
                                if (arr_scripts.secondary.indexOf("provider/" + njs.AppManager.Provider + "/tools.js") == -1) {
                                    arr_scripts.secondary.push("provider/" + njs.AppManager.Provider + "/tools.js");
                                }

                                // reference needed libraries
                                for (var _map in njs.config.tools) {
                                    for (var _tool in njs.config.tools[_map]) {
                                        var tool = njs.config.tools[_map][_tool];
                                        if (tool.hasOwnProperty("enabled") && tool.enabled === false || tool.length > 1 && tool.some(function (x) {
                                            return x.hasOwnProperty("enabled") && x.enabled === false;
                                        })) {
                                            delete njs.config.tools[_map][_tool];
                                            continue;
                                        }
                                        switch (_tool) {
                                            case "Measurement":
                                                // must be loaded in the second draw
                                                if (arr_scripts.secondary.indexOf("provider/" + njs.AppManager.Provider + "/measurement.js") == -1) {
                                                    arr_scripts.secondary.push("provider/" + njs.AppManager.Provider + "/measurement.js");
                                                }

                                                break;
                                            case "Redlining":
                                                if (arr_scripts.secondary.indexOf("provider/" + njs.AppManager.Provider + "/redlining.js") == -1) {
                                                    arr_scripts.secondary.push("provider/" + njs.AppManager.Provider + "/redlining.js");
                                                }
                                                break;
                                            case "TouchCursorMeasure":
                                                if (arr_scripts.secondary.indexOf("provider/" + njs.AppManager.Provider + "/touchcursormeasure.js") == -1) {
                                                    arr_scripts.secondary.push("provider/" + njs.AppManager.Provider + "/touchcursormeasure.js");
                                                }
                                                break;
                                            case "MultiSelect":
                                                if (arr_scripts.secondary.indexOf("provider/" + njs.AppManager.Provider + "/Control/GetFeature.js") == -1) {
                                                    arr_scripts.secondary.push("provider/" + njs.AppManager.Provider + "/Control/GetFeature.js");
                                                }
                                                if (arr_scripts.secondary.indexOf("provider/" + njs.AppManager.Provider + "/multiselect.js") == -1) {
                                                    arr_scripts.secondary.push("provider/" + njs.AppManager.Provider + "/multiselect.js");
                                                }
                                                break;
                                            case "WMSImport":
                                                if (arr_scripts.secondary.indexOf("wmsimport.js") == -1) {
                                                    arr_scripts.secondary.push("wmsimport.js");
                                                }
                                                if (arr_scripts.tertiary.indexOf("provider/" + njs.AppManager.Provider + "/wmsimport.js") == -1) {
                                                    arr_scripts.tertiary.push("provider/" + njs.AppManager.Provider + "/wmsimport.js");
                                                }
                                                break;
                                        }
                                        // MODULES see if some tool needs the load of a non standard module and load it
                                        if (njs.config.tools[_map][_tool]["include"]) {
                                            if (arr_scripts.secondary.indexOf(njs.config.tools[_map][_tool]["include"] + ".js") == -1) {
                                                arr_scripts.secondary.push(njs.config.tools[_map][_tool]["include"] + ".js");
                                            }
                                        }
                                    }
                                }
                                break;
                            case "snap":
                                njs.config.snap = res;
                                if (arr_scripts.secondary.indexOf("snap.js") == -1) {
                                    arr_scripts.secondary.push("snap.js");
                                }
                                break;
                            case "selection":
                                njs.config.selection = res;
                                if (arr_scripts.secondary.indexOf("selection.js") == -1) {
                                    arr_scripts.secondary.push("selection.js");
                                }
                                break;
                            case "streetview":
                                njs.config.streetview = res;
                                if (arr_scripts.secondary.indexOf("provider/" + njs.AppManager.Provider + "/streetview.js") == -1) {
                                    arr_scripts.secondary.push("provider/" + njs.AppManager.Provider + "/streetview.js");
                                }
                                break;
                            case "infra3d":
                                njs.config.infra3d = res;
                                if (arr_scripts.secondary.indexOf("provider/" + njs.AppManager.Provider + "/infra3d.js") == -1) {
                                    arr_scripts.secondary.push("provider/" + njs.AppManager.Provider + "/infra3d.js");
                                }
                                break;
                            case "orbit":
                                njs.config.orbit = res;
                                if (arr_scripts.secondary.indexOf("provider/" + njs.AppManager.Provider + "/orbit.js") == -1) {
                                    arr_scripts.secondary.push("provider/" + njs.AppManager.Provider + "/orbit.js");
                                }
                                break;
                            case "grouting":
                                njs.config.grouting = res;
                                if (arr_scripts.secondary.indexOf("provider/" + njs.AppManager.Provider + "/grouting.js") == -1) {
                                    arr_scripts.secondary.push("provider/" + njs.AppManager.Provider + "/grouting.js");
                                }
                                break;
                            case "disclaimer":
                                njs.config.infoDisclaimer = res;
                                break;
                            case "timeslider":
                                njs.config.timeSliders = res;
                                break;
                        }
                    } else {
                        console.error("Error loading module " + item + ": ", res.error);
                    }
                }
                return arr_scripts;
            }, function (error) {
                console.error("Error loading module: " + item + ": ", error);
            });
        };

        var getScriptFile = function (item, level) {
            // user the class notation 'dojo.xhr()' and not the variable xhr
            return dojo.xhr("GET", {
                url: njs.AppManager.apipath + njs.AppManager.Version + "/" + item,
                handleAs: "javascript"
            }).then(
                function (res) {
                    njs.AppManager.loadedApiScripts[item] = true;
                    return res;
                },
                function (err) {
                    // Handle the error condition
                    console.error("Error: %o", err, item);
                }
            );
        };

        for (var _mod in njs.AppManager.defmodules) {
            // build the xhr promise object being monitored by the deferred list
            // in order to coordinate layer manager construction
            // dojo.hitch passes the current script name for the callback
            // use the class statement "dojo.xhr" and not directly xhr, which invoques the ajax call directly
            _deferred_items.push(
                getConfFile(theme_uri, uprofile, njs.AppManager.defmodules[_mod])
            );
        }

        var dList = new DeferredList(_deferred_items);
        dList.then(function (arrayOfValues) {
            var _success = true;
            //console.info(arrayOfValues);
            //console.info(njs.config);

            require(["dojo/request/xhr", "dojo/DeferredList"], function (xhr, DeferredList) {

                var arr_sec_scripts = [];
                var arr_tert_scripts = [];
                var arrDefMainScripts = [];

                arrDefMainScripts.push(
                    // getScriptFile("provider/" + njs.AppManager.Provider + "/selectfeature.js", 1)
                );

                for (var i = 0; i < arrayOfValues.length; i++) {
                    if (arrayOfValues[i][0]) {
                        for (var j = 0; j < arrayOfValues[i][1].main.length; j++) {
                            //arrScripts.push(arrayOfValues[i][1].main[j]);
                            arrDefMainScripts.push(
                                getScriptFile(arrayOfValues[i][1].main[j], 1)
                            );
                            //console.info("main",arrayOfValues[i][1].main[j]);
                        }
                        for (var j = 0; j < arrayOfValues[i][1].secondary.length; j++) {
                            //arrScripts.push(arrayOfValues[i][1].secondary[j]);
                            arr_sec_scripts.push(arrayOfValues[i][1].secondary[j]);

                        }

                        for (var j = 0; j < arrayOfValues[i][1].tertiary.length; j++) {
                            //arrScripts.push(arrayOfValues[i][1].secondary[j]);
                            arr_tert_scripts.push(arrayOfValues[i][1].tertiary[j]);

                        }
                    }
                }

                var dSList = new DeferredList(arrDefMainScripts);
                dSList.then(function (arrayOfScripts) {
                    // Begin creating the SelectFeature general object
                    njs.AppManager.SelectFeature = {};
                    for (var _map in njs.AppManager.Maps) {
                        //njs.AppManager.SelectFeature[_map] = new njs.SelectFeature('general_select_feature', {idmap: _map});
                    }

                    require(["dojo/request/xhr", "dojo/DeferredList"], function (xhr, DeferredList) {

                        var arrDefSecScripts = [];
                        for (var i = 0; i < arr_sec_scripts.length; i++) {
                            arrDefSecScripts.push(
                                getScriptFile(arr_sec_scripts[i], 2)
                            );
                        }

                        var dSList2 = new DeferredList(arrDefSecScripts);
                        dSList2.then(function (arrayOfScripts2) {
                            require(["dojo/request/xhr", "dojo/DeferredList"], function (xhr, DeferredList) {

                                var arrDefTertScripts = [];
                                for (var i = 0; i < arr_tert_scripts.length; i++) {
                                    arrDefTertScripts.push(
                                        getScriptFile(arr_tert_scripts[i], 3)
                                    );
                                }

                                var dSList3 = new DeferredList(arrDefTertScripts);
                                dSList3.then(function (arrayOfScripts3) {
                                    njs.AppManager.buildThemeModules(theme_uri, uprofile);
                                });

                            });
                        });

                    });

                });

            });

        });

    });

};

/*-------------------------------------------------------------------------------
    method buildThemeModules

    [string] theme_uri: current thematique relative url
    [string] uprofile: current user's profile

--------------------------------------------------------------------------------*/
njs.AppManager.buildThemeModules = function (theme_uri, uprofile) {

    // register the panes events used beside the map
    njs.Layout.registerAppPanes();

    // do the last positionning work - to be done here, after the panes have been registered
    for (var bmap in njs.AppManager.Maps) {
        njs.AppManager.Maps[bmap].postProcessLoadMap();
    }

    hideLoader();

    // search start param highlight
    if (njs.AppManager.StartParams.hl == 1) {
        // x and y are allways provided, then test first for the highlight (hlfct)
        if (njs.AppManager.StartParams.hlfct != null && typeof njs.AppManager[njs.AppManager.StartParams.hlfct] === "function") {
            // safe to use the function
            njs.AppManager[njs.AppManager.StartParams.hlfct]();
        } else if (typeof njs.AppManager.StartParams.x != "undefined" && typeof njs.AppManager.StartParams.y != "undefined") {
            var pt = [njs.AppManager.StartParams.x, njs.AppManager.StartParams.y];
            if (njs.config.searchoptions) {
                for (var bmap in njs.AppManager.Maps) {
                    njs.AppManager.Maps[bmap].highlightSrchObj(pt, null);
                }
            }
        }
    }
    // StreetView
    if (njs.config.streetview) njs.AppManager.loadStreetView(uprofile);
    // Google Routing
    if (njs.config.grouting) njs.AppManager.loadGRouting(uprofile);
    // Infra3D
    if (njs.config.infra3d) njs.AppManager.loadInfra3D(uprofile);
    // Orbit
    if (njs.config.orbit) njs.AppManager.loadOrbit(uprofile);

    // LEGEND
    if (njs.config.legends) {
        if (njs.config.legends.general_settings) {
            njs.AppManager.legendFloatWinWidth = njs.config.legends.general_settings.start_w;
            njs.AppManager.legendFloatWinHeight = njs.config.legends.general_settings.start_h;
            njs.AppManager.legendFloatWinX = njs.config.legends.general_settings.start_x;
            njs.AppManager.legendFloatWinY = njs.config.legends.general_settings.start_y;
            if (njs.config.legends.general_settings.proxy) njs.AppManager.legendProxy = njs.config.legends.general_settings.proxy;          //added by AGIS
            if (!njs.config.legends.general_settings.extern) njs.config.legends.general_settings.extern = false;
            njs.AppManager.legendGeneralExtern = njs.config.legends.general_settings.extern;
        }
    }

    // TOOLS & GUIs
    // Destroy already existing tools
    for (var _tool in njs.AppManager.Tools) {
        if (typeof njs.AppManager.Tools[_tool].destroy != 'undefined') njs.AppManager.Tools[_tool].destroy();
    }
    // If some GUIs must be loaded with deferred ajax calls
    // then handles this building process with a switch
    if (njs.config.tools || njs.config.lyrmgr || njs.config.searchoptions) {
        njs.AppManager.loadSiteGUIs(theme_uri, uprofile);
    } else {
        // load only the modules without GUIS
        // MAPTIPS
        njs.AppManager.loadSiteMapTips(theme_uri, uprofile);
        // SNAP
        if (njs.config.snap) njs.AppManager.loadSiteSnap(theme_uri, uprofile);
        // SELECTION
        if (njs.config.selection) njs.AppManager.loadSiteSelection(theme_uri, uprofile);
        // EDITING
        njs.AppManager.loadSiteEditingTool(theme_uri, uprofile);
        // DISCLAMER
        njs.AppManager.loadThemeDisclaimer(theme_uri, uprofile);
    }
};

/*-------------------------------------------------------------------------------
    method loadSiteTools

    Loads all the components needed for the tools, according to the
    site which is passed as parameter.
    - first handles the tool wrapper items (gui items)
    - then loads the tool configuration for that site
    - then check if the javascript libraries are loaded for tools
    - finally instanciate the tool objects

--------------------------------------------------------------------------------*/

njs.AppManager.loadSiteGUIs = function (theme_uri, uprofile) {

    var getHTMLGUI = function (theme_uri, uprofile, item) {
        var _f = "/guis/gui_" + item + "_" + njs.AppManager.Language;

        switch (item) {
            case "search":
            case "coordinates":
                if (njs.AppManager.isMobile) _f += "_m";
                break;
        }

        // user the class notation 'dojo.xhr()' and not the variable xhr
        return dojo.xhr("POST", {
            url: theme_uri + "/loader.php",
            preventCache: true,
            handleAs: "text",
            content: { "f": _f + ".htm", "g": njs.AppManager.ugroup, "p": uprofile }
        }).then(
            function (res) {
                //console.info(item);
                if (res) {
                    //console.info(item,res)
                    return { html: res, gui_el: item };
                }
            },
            function (err) {
                // Handle the error condition
                console.error("Error: %o", err, item);
            }
        );
    };
    // this require will be loaded synchronusly as it has been already loaded before
    require(["dijit/registry", "dojo/dom", "dojo/_base/array", "dojo/DeferredList"], function (registry, dom, array, DeferredList) {
        // retrive gui elements for the tools and/or layer manager
        var _deferred_items = [];
        var arr_guis = [];
        if (njs.config.tools) {
            for (var _map in njs.config.tools) {

                for (var _tool in njs.config.tools[_map]) {

                    if (njs.config.tools[_map][_tool]["gui_el"] != null && typeof njs.config.tools[_map][_tool]["gui_el"] != "undefined" && njs.config.tools[_map][_tool]["gui_el"] != "") {
                        if (arr_guis.indexOf(njs.config.tools[_map][_tool]["gui_el"]) == -1) {
                            arr_guis.push(njs.config.tools[_map][_tool]["gui_el"]);
                        }
                    } else {
                        switch (_tool) {
                            case "Measurement":
                                if (arr_guis.indexOf("measure") == -1) {
                                    arr_guis.push("measure");
                                }
                                break;
                            case "PrintScaledMap":
                            case "PredefinedScaledMap":
                            case "HTMLPrintMap":
                                if (arr_guis.indexOf("print") == -1) {
                                    arr_guis.push("print");
                                }
                                break;
                            case "CoordDisplay":
                            case "ElevationDisplay":
                                if (arr_guis.indexOf("coordinates") == -1) {
                                    arr_guis.push("coordinates");
                                }
                                break;
                            case "Redlining":
                                if (arr_guis.indexOf("redlining") == -1) {
                                    arr_guis.push("redlining");
                                }
                                break;
                            case "OrthogonalMeasure":
                            case "LinearMeasure":
                            case "SurfaceMeasure":
                            case "DistanceMeasure":
                                if (arr_guis.indexOf("orthomeasure") == -1) {
                                    arr_guis.push("orthomeasure");
                                }
                                break;
                        }
                    }
                } // end loop through the tools
            } // end loop maps
        }
        // retrieve gui elements for the layer manager
        if (njs.config.lyrmgr) {
            for (var item_lyrmgr in njs.config.lyrmgr) {
                if (item_lyrmgr !== "layers") {
                    if (njs.config.lyrmgr[item_lyrmgr].type != "ClassicLayerMgr") {

                        if (arr_guis.indexOf(item_lyrmgr) == -1) {
                            arr_guis.push(item_lyrmgr);
                        }
                    }
                }
            }
        }
        // retrieve gui elements for the layer manager
        if (njs.config.searchoptions) {
            if (arr_guis.indexOf("search") == -1) {
                arr_guis.push("search");
            }

        }

        for (var i = 0; i < arr_guis.length; i++) {
            var gui_el = arr_guis[i];
            if (document.getElementById("njs_" + gui_el + "_wrapper")) {
                var widgets = registry.findWidgets(dom.byId("njs_" + gui_el + "_wrapper"));
                array.forEach(widgets, function (w) {
                    w.destroyRecursive(false);
                });
                document.getElementById("njs_" + gui_el + "_wrapper").innerHTML = "";

                _deferred_items.push(
                    getHTMLGUI(theme_uri, uprofile, gui_el)
                );
            } else console.warn("missing html element for module UI:", gui_el);
        }

        var dSList = new DeferredList(_deferred_items);
        dSList.then(function (arrayOfValues) {

            require(["dojo/parser", "dojo/dom"], function (parser, dom) {
                for (var i = 0; i < arrayOfValues.length; i++) {
                    if (arrayOfValues[i][0]) {
                        // Put the gui element in the page
                        var guiElm = document.getElementById("njs_" + arrayOfValues[i][1].gui_el + "_wrapper");
                        guiElm.innerHTML = arrayOfValues[i][1].html;
                        dojo.removeClass(guiElm, "hidden");                                                    //added by AGIS: unhide GUI-Element
                        //create the dojo objects
                        parser.parse(guiElm);
                    }
                }
            });

            // MAPTIPS -- must be loaded before layer manager and editing
            njs.AppManager.loadSiteMapTips(theme_uri, uprofile);
            // SNAP -- must be loaded before the tools
            if (njs.config.snap) njs.AppManager.loadSiteSnap(theme_uri, uprofile);
            // SELECTION
            if (njs.config.selection) njs.AppManager.loadSiteSelection(theme_uri, uprofile);
            // EDITING
            njs.AppManager.loadSiteEditingTool(theme_uri, uprofile);
            // TOOLS
            if (njs.config.tools) {
                njs.AppManager.addTools(_map, njs.config.tools[_map], theme_uri, uprofile);
                njs.AppManager.activateTools(_map);
            }
            // LYRMGR
            njs.AppManager.loadSiteLyrMgr(theme_uri, uprofile);
            // SEARCH -- must be loaded after maptips and layer manager
            njs.AppManager.loadSiteSearchOptions(theme_uri, uprofile);
            // DISCLAMER
            njs.AppManager.loadThemeDisclaimer(theme_uri, uprofile);
        });
    });
};

/*-------------------------------------------------------------------------------
    method loadSiteMapTips

    Loads all the components needed for the maptips options, according to the
    site which is passed as parameter.
    - first handles the search wrapper items (gui items)
    - then loads the search configuration for that site
    - then check if the javascript libraries are loaded for search options
    - finally instanciate the search objects

--------------------------------------------------------------------------------*/
njs.AppManager.loadSiteMapTips = function (theme_uri, uprofile) {
    // Destroy the maptips
    for (var maptip in njs.AppManager.MapTips) {
        njs.AppManager.MapTips[maptip].destroy();
        njs.AppManager.MapTips[maptip] = null;
    }
    njs.AppManager.MapTips = {};

    if (njs.config.maptips) {

        //FORM DIALOG
        njs.AppManager.formFloatWin = null;
        njs.AppManager.formFloatWinWidth = njs.config.maptips.general_settings.start_w;
        njs.AppManager.formFloatWinHeight = njs.config.maptips.general_settings.start_h;
        njs.AppManager.formFloatWinX = njs.config.maptips.general_settings.start_x;
        njs.AppManager.formFloatWinY = njs.config.maptips.general_settings.start_y;

        //INFO DIALOG
        njs.AppManager.infoFloatWinWidth = njs.config.maptips.general_settings.start_w;
        njs.AppManager.infoFloatWinHeight = njs.config.maptips.general_settings.start_h;
        njs.AppManager.infoFloatWinX = njs.config.maptips.general_settings.start_x;
        njs.AppManager.infoFloatWinY = njs.config.maptips.general_settings.start_y;

        for (var _maptip in njs.config.maptips) {
            if (typeof njs.config.maptips[_maptip]["type"] != "undefined" && njs.config.maptips[_maptip]["type"] != null) {
                var _opts = njs.config.maptips[_maptip];
                if (_opts.hasOwnProperty("enabled") && _opts.enabled === false || _opts.hasOwnProperty("linked_layer_disabled")) //added by AGIS: deaktivierte Maptips nicht berücksichtigen
                    continue;
                njs.AppManager.MapTips[_maptip] = new njs.MapTip[njs.config.maptips[_maptip]["type"]](_maptip, _opts);
                njs.AppManager.MapTips[_maptip].Activate();
            }
        }
    }
};

/*-------------------------------------------------------------------------------
    method loadSiteSnap

    Loads all the components needed for the snap options, according to the
    site which is passed as parameter.
    - first handles the search wrapper items (gui items)
    - then loads the search configuration for that site
    - then check if the javascript libraries are loaded for search options
    - finally instanciate the search objects

--------------------------------------------------------------------------------*/
njs.AppManager.loadSiteSnap = function (theme_uri, uprofile) {
    // Destroy existing snap definitions
    if (njs.AppManager.SnapControl && njs.AppManager.SnapControl.destroy) njs.AppManager.SnapControl.destroy();
    njs.AppManager.SnapControl = new njs.SnapControl(njs.config.snap);
    njs.AppManager.SnapControl.Activate();

};


/*-------------------------------------------------------------------------------
    method loadSiteSelection

    Loads all the components needed for the selection options, according to the
    site which is passed as parameter.
    - first handles the search wrapper items (gui items)
    - then loads the search configuration for that site
    - then check if the javascript libraries are loaded for search options
    - finally instanciate the search objects

--------------------------------------------------------------------------------*/
njs.AppManager.loadSiteSelection = function (theme_uri, uprofile) {
    // Destroy existing selection definitions
    if (njs.AppManager.SelectControl && njs.AppManager.SelectControl.destroy) njs.AppManager.SelectControl.destroy();
    njs.AppManager.SelectControl = new njs.SelectControl(njs.config.selection);
    njs.AppManager.SelectControl.Activate();

};

/*-------------------------------------------------------------------------------
    method loadSiteEditingTool

    Loads all the components needed for the editingtool options, according to the
    site which is passed as parameter.
    - first handles the search wrapper items (gui items)
    - then loads the search configuration for that site
    - then check if the javascript libraries are loaded for search options
    - finally instanciate the search objects

--------------------------------------------------------------------------------*/
njs.AppManager.loadSiteEditingTool = function (theme_uri, uprofile) {
    // Destroy the editingtool
    for (var _maptip in njs.AppManager.EditingTools) {
        njs.AppManager.EditingTools[_maptip].destroy();
        njs.AppManager.EditingTools[_maptip] = null;
    }

    if (njs.config.editingtool) {
        for (var _item in njs.config.editingtool) {
            if (_item != "general_settings") {
                var _opts = njs.config.editingtool[_item];
                njs.AppManager.EditingTools[_item] = new njs.Editing(_item, _opts);
            }
        }
    }
};

/*-------------------------------------------------------------------------------
    method addTools

    Add tools to the application and sets the passed attributes as properties

    [string] idmap: njs map object id
    [obj] tools : array of tools and their properties
    [string] theme_uri: current thematique relative url
    [string] uprofile: current user's profile

--------------------------------------------------------------------------------*/
njs.AppManager.addTools = function (idmap, tools, theme_uri, uprofile) {
    var _tool_items = [];
    // loop into all the passed tools
    for (var _tool in tools) {
        // Handles if more items of this tool have been specified
        // for this map
        if (typeof tools[_tool].id != "undefined" && tools[_tool].id != null) {
            _tool_items = [tools[_tool]]
        } else if (typeof tools[_tool].items != "undefined" && tools[_tool].items != null) {
            _tool_items = tools[_tool].items;
        } else {
            _tool_items = tools[_tool];
        }

        // loop through the items collection
        for (var _item in _tool_items) {
            if (typeof this.Tools[_tool] == "undefined") this.Tools[_tool] = {};
            if (typeof this.Tools[_tool][this.Maps[idmap].container] == "undefined") this.Tools[_tool][this.Maps[idmap].container] = [];
            // instantiate a tool object according to the given type and adds it to the collection
            try {
                if (_tool_items[_item].subclass == null && typeof _tool_items[_item].subclass == 'undefined')
                    this.Tools[_tool][this.Maps[idmap].container][_tool_items[_item].id] = new njs.Tools[_tool](_tool_items[_item], theme_uri, uprofile);
                else
                    this.Tools[_tool][this.Maps[idmap].container][_tool_items[_item].id] = new njs.Tools[_tool_items[_item].subclass](_tool_items[_item], theme_uri, uprofile);

                // add the map reference as parameter for the tool's object
                _tool_items[_item]["idmap"] = idmap;
                // call the tool's method adding the given attributes as properties
                this.Tools[_tool][this.Maps[idmap].container][_tool_items[_item].id].setAttr(_tool_items[_item]);
            } catch (error) {
                console.info(error);
            }
        }
    }
};

/*-------------------------------------------------------------------------------
    method activateTools

    For each defined tool in the application object, activate their interraction
    with the njs map object (define events,...)

    [string] idmap: njs map object id

--------------------------------------------------------------------------------*/
njs.AppManager.activateTools = function (idmap) {
    for (var _tool in njs.AppManager.Tools) {
        if (typeof njs.AppManager.Tools[_tool][njs.AppManager.Maps[idmap].container] != "undefined") {
            for (var _item in njs.AppManager.Tools[_tool][njs.AppManager.Maps[idmap].container]) {
                njs.AppManager.Tools[_tool][njs.AppManager.Maps[idmap].container][_item].Activate(idmap, _item);
            }
        }
    }
};

/*-------------------------------------------------------------------------------
    method loadSiteSearchOptions

    Loads all the components needed for the search options, according to the
    site which is passed as parameter.
    - first handles the search wrapper items (gui items)
    - then loads the search configuration for that site
    - then check if the javascript libraries are loaded for search options
    - finally instanciate the search objects

--------------------------------------------------------------------------------*/
njs.AppManager.loadSiteSearchOptions = function (theme_uri, uprofile) {
    // Destroy the searchoptions
    for (var _srch in njs.AppManager.SearchOptions) {
        njs.AppManager.SearchOptions[_srch].destroy();
        njs.AppManager.SearchOptions[_srch] = null;
    }
    njs.AppManager.SearchOptions = {};

    if (njs.config.searchoptions) {

        var _searchopt_cnt = 0;
        for (var _srch in njs.config.searchoptions) {
            if (typeof njs.config.searchoptions[_srch]["type"] != "undefined" && njs.config.searchoptions[_srch]["type"] !== null) {
                var _opts = njs.config.searchoptions[_srch];
                njs.AppManager.SearchOptions[_srch] = new njs.Search[_opts["type"]](_srch, _opts);
                njs.AppManager.SearchOptions[_srch].Activate();

                _searchopt_cnt++;
            }
        }

        // check if some search is defined as startparam
        if (njs.AppManager.StartParams.srch) {
            var _srchobj = njs.AppManager.SearchOptions[njs.AppManager.StartParams.srch];
            _srchobj.handleStartParams(njs.AppManager.StartParams);

        }

        // if more than one search option is defined then activate the search manager
        if (_searchopt_cnt > 1) {
            njs.AppManager.SearchManager = new njs.SearchManager();
        }

        if (dijit.byId("search_container")) {
            dijit.byId("search_container").resize();
            document.getElementById("search_container").style.visibility = 'visible';
        }

    }
};

njs.AppManager.loadStreetView = function (uprofile) {

    require(["dojo/ready", "dojo/aspect", "dijit/registry"], function (ready, aspect, registry) {
        ready(dojo.hitch(null, function (name, map) {
            aspect.after(registry.byId(name + "Container"), "resize", dojo.hitch(null, function (name, map) {
                njs.AppManager.Maps[map].refreshMapSize();
            }, name, map));
        }, njs.config.streetview.pane_container, njs.config.streetview.idmap));
    });

    njs.AppManager.Tools.StreetView[njs.config.streetview.idmap] = new njs.StreetViewModule(njs.config.streetview.id, njs.config.streetview);
};

njs.AppManager.loadInfra3D = function (uprofile) {

    require(["dojo/ready", "dojo/aspect", "dijit/registry"], function (ready, aspect, registry) {
        ready(dojo.hitch(null, function (name, map) {
            aspect.after(registry.byId(name + "Container"), "resize", dojo.hitch(null, function (name, map) {
                njs.AppManager.Maps[map].refreshMapSize();
            }, name, map));
        }, njs.config.infra3d.pane_container, njs.config.infra3d.idmap));
    });

    njs.AppManager.Tools.Infra3D[njs.config.infra3d.idmap] = new njs.Infra3DModule(njs.config.infra3d.id, njs.config.infra3d);
};

njs.AppManager.loadOrbit = function (uprofile) {
    require(["dojo/ready", "dojo/aspect", "dijit/registry"], function (ready, aspect, registry) {
        ready(dojo.hitch(null, function (name, map) {
            aspect.after(registry.byId(name + "Container"), "resize", dojo.hitch(null, function (name, map) {
                njs.AppManager.Maps[map].refreshMapSize();
            }, name, map));
        }, njs.config.orbit.pane_container, njs.config.orbit.idmap));
    });
    njs.AppManager.Tools.Orbit[njs.config.orbit.idmap] = new njs.OrbitModule(njs.config.orbit.id, njs.config.orbit);
};

njs.AppManager.loadGRouting = function (uprofile) {
    require(["dojo/ready", "dojo/aspect", "dijit/registry"], function (ready, aspect, registry) {
        ready(dojo.hitch(null, function (name, map) {
            aspect.after(registry.byId(name + "Container"), "resize", dojo.hitch(null, function (name, map) {
                njs.AppManager.Maps[map].refreshMapSize();
            }, name, map));
        }, njs.config.grouting.pane_container, njs.config.grouting.idmap));
    });

    njs.AppManager.Tools.GRouting[njs.config.grouting.idmap] = new njs.GRoutingModule(njs.config.grouting.id, njs.config.grouting);
};

/*-------------------------------------------------------------------------------
    method loadSiteLyrMgr

    Loads all the components needed for the layer manager(s) according to the
    site which is passed as parameter.
    - first handles the gui wrapper items
    - then loads the layer manager configuration for that site
    - then check if the javascript libraries are loaded for layer management
    - finally instanciate the layer manager(s) objects

--------------------------------------------------------------------------------*/
njs.AppManager.loadSiteLyrMgr = function (theme_uri, uprofile) {

    // resets the layers and destroy objects
    for (var _lyrmgr in njs.AppManager.LyrMgr) {
        njs.AppManager.LyrMgr[_lyrmgr].reset();
        njs.AppManager.LyrMgr[_lyrmgr].destroy();
        njs.AppManager.LyrMgr[_lyrmgr] = null;
    }
    // destroy the widgets
    if (njs.config.lyrmgr) {
        for (var item_lyrmgr in njs.config.lyrmgr) {
            if (item_lyrmgr !== "layers" && document.getElementById('njs_' + item_lyrmgr + '_wrapper')) {
                var widgets = dijit.findWidgets(document.getElementById('njs_' + item_lyrmgr + '_wrapper'));
                dojo.forEach(widgets, function (w) {
                    w.destroyRecursive(false);
                });
                document.getElementById('njs_' + item_lyrmgr + '_wrapper').innerHTML = "";
            }
        }

        for (var _lyrmgr in njs.config.lyrmgr) {
            if (typeof njs.config.lyrmgr[_lyrmgr]["type"] != "undefined" && njs.config.lyrmgr[_lyrmgr]["type"] != null) {
                var _opts = njs.config.lyrmgr[_lyrmgr];
                _opts["texts"] = njs.AppManager.nls["lyrmgrResources"];
                _opts["leg_texts"] = njs.AppManager.nls["legendResources"];
                _opts["edit_lays"] = {};
                var _edit_lays = [];
                var _edit_lays_id = [];
                if (typeof njs.config.editingtool != "undefined" && njs.config.editingtool != null) {
                    for (var _editobj in njs.config.editingtool) {
                        _edit_lays_id.push(_editobj);
                        _edit_lays.push(njs.config.editingtool[_editobj].linked_layer_id);
                    }
                    _opts["edit_lays"] = { "ids": _edit_lays_id, "lays": _edit_lays };

                }
                _opts["layers"] = njs.config.lyrmgr["layers"];
                njs.AppManager.LyrMgr[_lyrmgr] = new njs.LayerMgr[njs.config.lyrmgr[_lyrmgr]["type"]](_lyrmgr, _opts);
                njs.AppManager.LyrMgr[_lyrmgr].Activate(theme_uri);
            }
        }
        dojo.publish("moveend", njs.AppManager.Maps["main"].mapObj.getView().getResolution());
    }
};

njs.AppManager.loadThemeDisclaimer = function (theme_uri, uprofile) {
    if (njs.config.infoDisclaimer) {
        njs.AppManager.infoDisclaimer = {};
        for (var _idmap in njs.config.infoDisclaimer) {
            njs.AppManager.loadInfoDisclaimer(_idmap, njs.AppManager.nls["disclaimerResources"]);
        }
    }

};

/*-------------------------------------------------------------------------------
    method loadInfoDisclaimer

    For each defined inf disclaimer in the config object, activate their interraction
    with the njs map object


--------------------------------------------------------------------------------*/
njs.AppManager.loadInfoDisclaimer = function (idmap, disc_lang) {
    // general positioning and layout work
    njs.AppManager.infoDisclaimer[idmap] = {};

    for (var id_disc in njs.config.infoDisclaimer[idmap]) {
        // check first if element in exists in DOM
        var discContainer = document.getElementById("disclaimer_" + id_disc);
        if (!discContainer) continue;

        njs.AppManager.infoDisclaimer[idmap][id_disc] = {};

        var _disc_params = njs.config.infoDisclaimer[idmap][id_disc];

        if (typeof _disc_params.width != "undefined")
            discContainer.style.width = _disc_params.width + "px";

        //dojo.attr(discContainer, "style", "width:"+_disc_params.width+"px;");
        switch (_disc_params.type) {
            case "center":
                var _cont_width = document.getElementById("NeapoljsContainer").style.width;
                if (_cont_width == "100%") _cont_width = document.documentElement.clientWidth;

                discContainer.style.bottom = "2px";
                discContainer.style.left = parseInt(_cont_width) / 2 - parseInt(_disc_params.width) / 2 + "px";
                // Connects the frame container resize event with the resize of the map
                /*dojo.connect(dijit.byId(njs.AppManager.Maps[idmap].container), 'resize',function(){
                    var _cont_width =dojo.byId("NeapoljsContainer").style.width;
                    if (_cont_width=="100%") _cont_width = document.documentElement.clientWidth;

                discContainer.style.bottom="2px";
                    discContainer.style.left=(parseInt(_cont_width)/2)-(parseInt(_disc_params.width)/2)+"px";
                });*/
                break;
            case "free":
                if (parseInt(_disc_params.pos_x) < 0) {
                    discContainer.style.right = Math.abs(parseInt(_disc_params.pos_x)) + "px";
                } else {
                    discContainer.style.left = parseInt(_disc_params.pos_x) + "px";
                }
                if (parseInt(_disc_params.pos_y) < 0) {
                    discContainer.style.bottom = Math.abs(parseInt(_disc_params.pos_y)) + "px";
                } else {
                    discContainer.style.top = parseInt(_disc_params.pos_y) + "px";
                }

                break;
        }

        // for each info ein objekt tun
        for (var _info in _disc_params.items) {
            njs.AppManager.infoDisclaimer[idmap][id_disc][_info] = {};
            njs.AppManager.infoDisclaimer[idmap][id_disc][_info]["currMap"] = "";
            if (typeof _disc_params.items[_info]["baseMaps"] != "undefined") {
                njs.AppManager.infoDisclaimer[idmap][id_disc][_info]["baseMaps"] = _disc_params.items[_info].baseMaps;
            } else {
                njs.AppManager.infoDisclaimer[idmap][id_disc][_info]["baseMaps"] = ["all"];
            }

            njs.AppManager.infoDisclaimer[idmap][id_disc][_info].range = null;
            if (typeof _disc_params.items[_info].range != "undefined") {
                njs.AppManager.infoDisclaimer[idmap][id_disc][_info].range = _disc_params.items[_info].range;
                njs.AppManager.Maps[idmap].registerDisclaimerZoomEvent();
            }

            var node_content = "<table border='0' width='100%'><tr>";
            if (typeof disc_lang[_info + "_img"] != "undefined" && disc_lang[_info + "_img"] != "") node_content += "<td width='5px' valign='top'><img src='" + disc_lang[_info + "_img"] + "'></td>";

            if (disc_lang[_info + "_array"]) {
                var arr_id = Math.floor(Math.random() * disc_lang[_info + "_array"].length);
                node_content += "<td valign='top'>" + disc_lang[_info + "_array"][arr_id] + "</td>";
            } else {
                node_content += "<td valign='top'>" + disc_lang[_info + "_text"] + "</td>";
            }

            //if (_disc_params.items[_info].closable) node_content += "<td valign='top' width='5px'><div class='njsDisclaimerClose' onclick='njs.AppManager.clearInfoDisclaimer(\"" + idmap + "\",\"" + id_disc + "\",\"" + _info + "\");'></div></td>";
            if (_disc_params.items[_info].closable) node_content += "<td valign='top' width='5px'><div class='njsDisclaimerClose' onclick='dojo.byId(\"disclaimer_" + id_disc + "\").style.visibility = \"hidden\";'></div></td>";

            node_content += "</tr></table>";

            njs.AppManager.infoDisclaimer[idmap][id_disc][_info]["node"] = node_content;

            if (_disc_params.items[_info].timeout) {
                // dojo.hitch in order to pass variable into the new scope of the setTimout function
                // if not, the timer will be set for the last disclamer created
                setTimeout(
                    dojo.hitch(null, function (_idmap, _id_disc, _info_) {
                        njs.AppManager.clearInfoDisclaimer(_idmap, _id_disc, _info_);
                    }, idmap, id_disc, _info),
                    _disc_params.items[_info].timeout
                );
            }
        }
    }

    var cur_resol = njs.AppManager.Maps[idmap].mapObj.getView().getResolution();
    njs.AppManager.checkInfoDisclaimer(idmap, njs.AppManager.Maps[idmap].currBasisMap, cur_resol);
};

njs.AppManager.addInfoDisclaimer = function (idmap, disc_id, disc_obj) {

    var discContainer = document.getElementById("disclaimer_" + disc_id);
    var node = document.createElement('div');
    node.setAttribute("id", "disclaim_" + disc_obj);
    node.setAttribute("class", "njsDisclaimerContent");
    if (typeof njs.config.infoDisclaimer[idmap][disc_id].width != "undefined")
        node.setAttribute("style", "width:" + njs.config.infoDisclaimer[idmap][disc_id].width + "px;height:" + njs.config.infoDisclaimer[idmap][disc_id].height + "px;");
    discContainer.insertBefore(node, discContainer.firstChild);
    document.getElementById("disclaim_" + disc_obj).innerHTML = njs.AppManager.infoDisclaimer[idmap][disc_id][disc_obj]["node"];
};

njs.AppManager.checkInfoDisclaimer = function (idmap, basemap, scale) {
    if (!njs.AppManager.infoDisclaimer) return;
    for (var _disc_id in njs.AppManager.infoDisclaimer[idmap]) {
        if (!document.getElementById("disclaimer_" + _disc_id)) return;
        document.getElementById("disclaimer_" + _disc_id).innerHTML = "";

        for (var _info in njs.AppManager.infoDisclaimer[idmap][_disc_id]) {

            var _basemap = "";
            if (basemap == null) {
                _basemap = njs.AppManager.infoDisclaimer[idmap][_disc_id][_info].currMap;
            } else {
                _basemap = basemap;
            }

            if (dojo.indexOf(njs.AppManager.infoDisclaimer[idmap][_disc_id][_info].baseMaps, _basemap) > -1 || njs.AppManager.infoDisclaimer[idmap][_disc_id][_info].baseMaps[0] == "all") {

                if (njs.AppManager.infoDisclaimer[idmap][_disc_id][_info].range != null) {
                    if (parseFloat(scale) <= parseFloat(njs.AppManager.infoDisclaimer[idmap][_disc_id][_info].range[1]) &&
                        parseFloat(scale) > parseFloat(njs.AppManager.infoDisclaimer[idmap][_disc_id][_info].range[0])) {
                        njs.AppManager.addInfoDisclaimer(idmap, _disc_id, _info);
                    }
                } else {
                    njs.AppManager.addInfoDisclaimer(idmap, _disc_id, _info);
                }

            }
            if (basemap != null) njs.AppManager.infoDisclaimer[idmap][_disc_id][_info].currMap = basemap;
        }
    }
};

njs.AppManager.clearInfoDisclaimer = function (idmap, disc_id, disc_obj) {
    dojo.destroy(dojo.byId("disclaim_" + disc_obj));
    if (njs.AppManager.infoDisclaimer[idmap][disc_id][disc_obj].baseMaps.length > 0) {
        if (njs.AppManager.infoDisclaimer[idmap][disc_id][disc_obj].baseMaps[0] == "all") {
            njs.AppManager.infoDisclaimer[idmap][disc_id][disc_obj].baseMaps = [];
        } else {
            var idx = dojo.indexOf(njs.AppManager.infoDisclaimer[idmap][disc_id][disc_obj].baseMaps, njs.AppManager.infoDisclaimer[idmap][disc_id][disc_obj].currMap);
            if (idx > -1) {
                njs.AppManager.infoDisclaimer[idmap][disc_id][disc_obj].baseMaps.splice(idx, 1);
            }
        }
    }
};


/*-------------------------------------------------------------------------------
    method getStartParams

    get the startparams from the url

--------------------------------------------------------------------------------*/
njs.AppManager.getStartParams = function () {
    if (location.href.indexOf('?', 0) > -1) {
        var arr_paramstr = location.href.split('?');
        var arr_parampairs = arr_paramstr[1].split('&');
        for (var i = 0; i < arr_parampairs.length; i++) {
            var arr_params = arr_parampairs[i].split('=');
            njs.AppManager.StartParams[arr_params[0]] = decodeURI(arr_params[1]);
        }
    }
};

/*-------------------------------------------------------------------------------
    method handleStartParams

    For each start param found in the url perform the related action
    [string] idmap: njs map opject id which will handle the start actions

--------------------------------------------------------------------------------*/
njs.AppManager.handleStartParams = function (idmap) {
    // add layers
    if (typeof njs.AppManager.StartParams.layers != "undefined") {
        njs.AppManager.addLyrDynamic(idmap, njs.AppManager.StartParams.layers, true);
    }

    if (typeof njs.AppManager.StartParams['adressen'] != "undefined") {
        njs.AppManager.StartParams['adressen'] = njs.AppManager.StartParams['adressen'].replace(/\%20(\d+\w?)$/, '|$1');
    }

    // search parameters !! link it to the search objects !!
    var _stsrch = false;

    for (var srch in njs.config.searchoptions) {
        if (typeof njs.AppManager.StartParams[srch] != "undefined") {
            var sqlstr = "";
            var sqltab = "";
            //njs.AppManager.StartParams[srch] = njs.AppManager.StartParams[srch].replace(/\%7C/,'|');
            njs.AppManager.StartParams[srch] = decodeURI(njs.AppManager.StartParams[srch]);

            var srch_items = njs.AppManager.StartParams[srch].split('|');
            var highlight;
            var graphics;
            var searchResol = null;

            switch (srch_items.length) {
                // one parameter search

                case 1:
                    var ds = njs.config.searchoptions[srch].first_param.dataStore;

                    if (ds.searchField.indexOf('$') == 0) {
                        sqlstr += ds.searchField.replace('$', '') + "='" + srch_items[0] + "'";
                    } else {
                        sqlstr += ds.searchField.replace('#', '') + "=" + srch_items[0];
                    }
                    sqltab = ds.searchTable;
                    highlight = njs.config.searchoptions[srch].first_param.highlight;
                    highlight.infoTemplate = njs.config.searchoptions[srch].first_param.texts[njs.AppManager.Language];
                    searchResol = njs.config.searchoptions[srch].first_param.searchResol;
                    break;
                case 2:
                    var ds = njs.config.searchoptions[srch].second_param.dataStore;

                    if (ds.linkedField.indexOf('$') == 0) {
                        sqlstr += ds.linkedField.replace('$', '') + "='" + srch_items[0] + "'";
                    } else {
                        sqlstr += ds.linkedField.replace('#', '') + "=" + srch_items[0];
                    }
                    if (ds.searchField.indexOf('$') == 0) {
                        sqlstr += " and " + ds.searchField.replace('$', '') + "='" + srch_items[1] + "'";
                    } else {
                        sqlstr += " and " + ds.searchField.replace('#', '') + "=" + srch_items[1];
                    }
                    sqltab = ds.searchTable;
                    highlight = njs.config.searchoptions[srch].second_param.highlight;
                    highlight.infoTemplate = njs.config.searchoptions[srch].second_param.texts[njs.AppManager.Language];
                    searchResol = njs.config.searchoptions[srch].second_param.searchResol;
                    break;
                case 3:
                    var ds = njs.config.searchoptions[srch].third_param.dataStore;

                    if (ds.linkedFirstField.indexOf('$') == 0) {
                        sqlstr += ds.linkedFirstField.replace('$', '') + "='" + srch_items[0] + "'";
                    } else {
                        sqlstr += ds.linkedFirstField.replace('#', '') + "=" + srch_items[0];
                    }
                    if (ds.linkedSecondField.indexOf('$') == 0) {
                        sqlstr += " and " + ds.linkedSecondField.replace('$', '') + "='" + srch_items[1] + "'";
                    } else {
                        sqlstr += " and " + ds.linkedSecondField.replace('#', '') + "=" + srch_items[1];
                    }
                    if (ds.searchField.indexOf('$') == 0) {
                        sqlstr += " and " + ds.searchField.replace('$', '') + "='" + srch_items[2] + "'";
                    } else {
                        sqlstr += " and " + ds.searchField.replace('#', '') + "=" + srch_items[2];
                    }
                    sqltab = ds.searchTable;
                    highlight = njs.config.searchoptions[srch].third_param.highlight;
                    highlight.infoTemplate = njs.config.searchoptions[srch].third_param.texts[njs.AppManager.Language];
                    searchResol = njs.config.searchoptions[srch].third_param.searchResol;
                    break;
            }
            if (njs.config.searchoptions.start_search.cgi.indexOf('?') > -1)
                var args = "&tab=" + sqltab + "&sql=" + encodeURI(sqlstr);
            else
                var args = "?tab=" + sqltab + "&sql=" + encodeURI(sqlstr);

            dojo.xhrGet({
                url: njs.config.searchoptions.start_search.cgi + args,
                preventCache: false,
                handleAs: "text",
                sync: true,
                load: function (response) {
                    var feat_obj = null;
                    if (response != "") {
                        eval("feat_obj=" + response);
                        var zFeature;

                        // if the searched object has paths (polyline or multipolylines)
                        if (typeof feat_obj.paths != "undefined") {
                            // create an arcgis polygon object
                            zFeature = new esri.geometry.Polyline(feat_obj);
                            // Add the feature in the highlight object
                            highlight.geometry = zFeature;
                            highlight.attributes.addition = eval(highlight.attributes.addition);
                            // highlights the selected object on the map
                            graphics = [];
                            graphics = new esri.Graphic(highlight);
                            var _extent = zFeature.getExtent();
                            // for each related map zoom to the selected object
                            if (typeof njs.AppManager.StartParams.zoom != "undefined") {
                                njs.AppManager.Maps[idmap].mapObj.centerAndZoom(_extent.getCenter(), njs.AppManager.StartParams.zoom, graphics);
                            } else {
                                njs.AppManager.Maps[idmap].mapObj.setExtent(_extent, true);
                            }

                            // if the searched object has rings (polygon or multipolygons)
                        } else if (typeof feat_obj.rings != "undefined") {
                            // create an arcgis polygon object
                            zFeature = new esri.geometry.Polygon(feat_obj);
                            // Add the feature in the highlight object
                            highlight.geometry = zFeature;
                            highlight.attributes.addition = eval(highlight.attributes.addition);
                            // highlights the selected object on the map
                            graphics = [];
                            graphics = new esri.Graphic(highlight);
                            var _extent = zFeature.getExtent();
                            // for each related map zoom to the selected object
                            if (typeof njs.AppManager.StartParams.zoom != "undefined") {
                                njs.AppManager.Maps[idmap].mapObj.centerAndZoom(_extent.getCenter(), njs.AppManager.StartParams.zoom, graphics);
                            } else {
                                njs.AppManager.Maps[idmap].mapObj.setExtent(_extent, true);
                            }
                            // if the searched object has coord pairs (point)
                        } else if (typeof feat_obj.x != "undefined") {
                            // create an arcgis point object
                            zFeature = new esri.geometry.Point(feat_obj);
                            // Add the feature in the highlight object
                            highlight.geometry = zFeature;
                            highlight.attributes.addition = eval(highlight.attributes.addition);
                            // highlights the selected object on the map
                            graphics = [];
                            graphics = new esri.Graphic(highlight);

                            // for each related map zoom to the selected object
                            if (typeof njs.AppManager.StartParams.zoom != "undefined") {
                                njs.AppManager.Maps[idmap].mapObj.centerAndZoom(zFeature, njs.AppManager.StartParams.zoom, graphics);
                            } else {
                                njs.AppManager.Maps[idmap].mapObj.centerAndZoom(zFeature, searchResol, graphics);
                            }
                        }
                        _stsrch = true;
                    }
                }
            }); // end dojo.xhrGet
        }
    }

    // zoom to coordinates
    if (typeof njs.AppManager.StartParams.koor != "undefined" && typeof njs.AppManager.StartParams.zoom != "undefined") {
        var xy = njs.AppManager.StartParams.koor.split(',');
        njs.AppManager.Maps[idmap].centerAndZoom(xy[0], xy[1], njs.AppManager.StartParams.zoom, true);
    } else if (typeof njs.AppManager.StartParams.latlon != "undefined" && typeof njs.AppManager.StartParams.zoom != "undefined") {
        var xy1 = njs.AppManager.StartParams.latlon.split(',');
        var zPoint_goo = new ol.geom.Point([xy1[1], xy1[0]]);
        var zPoint = zPoint_goo.clone();

        var st_x = WGStoCHy(xy1[0], xy1[1]);
        var st_y = WGStoCHx(xy1[0], xy1[1]);

        njs.AppManager.Maps[idmap].centerAndZoom(st_x, st_y, njs.AppManager.StartParams.zoom, true);
    }
    // zoom to lod (uses same zoom param), but only if no search has been performed
    else if (typeof njs.AppManager.StartParams.zoom != "undefined" && !_stsrch) {
        njs.AppManager.Maps[idmap].setLevel(njs.AppManager.StartParams.zoom)
    }
};

/**
 * method addLyrDynamic
 *
 * Sets dynamically a layer visible. This happens when a start parameter is defined or when a POI search is performed
 *
 * @param idmap string     njs map opject id which will handle the start actions
 * @param lyrlst string    layer list separated with pipe '|'
 * @param start bool       if is a start parameter
 */
njs.AppManager.addLyrDynamic = function (idmap, lyrlst, start) {
    var _ckbox_lyr_list = [];
    var _ckbox_lyr_opacity = [];

    var lyrsrc = lyrlst.split('|');

    for (var i = 0; i < lyrsrc.length; i++) {
        var arr_lyrsrc = lyrsrc[i].split(',');
        var url = "./layermanager/" + arr_lyrsrc[0] + ".json";
        // remove the first element of the array as this isn't a layer but the layer manager source
        arr_lyrsrc.splice(0, 1);
        // get the json file corresponding to the passed layer set
        dojo.xhrGet({
            url: url,
            preventCache: false,
            handleAs: "json",
            sync: true,
            load: function (response) {
                if (typeof response.items != "undefined") {
                    for (var j = 0; j < response.items.length; j++) {
                        if (dojo.indexOf(arr_lyrsrc, response.items[j].id) > -1) {
                            var lyr_info = response.items[j].id.split("/");
                            _ckbox_lyr_opacity[lyr_info[0]] = response.items[j].opacity;

                            if (typeof _ckbox_lyr_list[lyr_info[0]] == "undefined") _ckbox_lyr_list[lyr_info[0]] = {};
                            _ckbox_lyr_list[lyr_info[0]]["url"] = response.items[j].url;

                            if (typeof _ckbox_lyr_list[lyr_info[0]]["lyrlst"] == "undefined") {
                                if (typeof lyr_info[1] == "undefined") _ckbox_lyr_list[lyr_info[0]]["lyrlst"] = "all";
                                else _ckbox_lyr_list[lyr_info[0]]["lyrlst"] = lyr_info[1];
                            } else {
                                if (typeof lyr_info[1] == "undefined") _ckbox_lyr_list[lyr_info[0]]["lyrlst"] = "all";
                                else if (_ckbox_lyr_list[lyr_info[0]]["lyrlst"] != "all") _ckbox_lyr_list[lyr_info[0]]["lyrlst"] += "|" + lyr_info[1];
                            }
                        }
                    }
                }
            }
        }); // end dojo.xhrGet
    }

    if (start) {
        njs.AppManager.StartParams.ckbox_lyr_list = _ckbox_lyr_list;
        njs.AppManager.StartParams.ckbox_lyr_opacity = _ckbox_lyr_opacity;
    }

    // loop through the layer manager objects if allready loaded
    for (var lyr_mgr in njs.AppManager.LyrMgr) {
        // check the layermanagers if the this map is defined
        if (dojo.indexOf(njs.AppManager.LyrMgr[lyr_mgr].targetMap, idmap) > -1) {
            njs.AppManager.LyrMgr[lyr_mgr]._ckbox_lyr_opacity = _ckbox_lyr_opacity;
            njs.AppManager.LyrMgr[lyr_mgr].switch_lyr(_ckbox_lyr_list, true);
        }
    }
};

njs.AppManager.setBaseLayerOpacity = function (map, opacity) {
    var op = 1 - parseFloat(opacity / 100).toFixed(2);
    njs.AppManager.Maps[map].setBaseLayerOpacity(op);
};

let geolocation = null;

njs.AppManager.getLocation = function (map, resol, options = {}) {
    const followLocation = options.follow === true;
    const updateInterval = options.interval || 10000; // default 10s
    const onceCenter = options.centerFirst !== false;

    let setCenter = onceCenter;
    let mapObject = njs.AppManager.Maps[map];
    let btn = document.getElementById("btnLocate");

    // ---- deactivate if active (toggle botton) ----
    if (geolocation || mapObject._followTimer) {
        if (mapObject.highlightLayer) {
            mapObject.highlightLayer.getSource().clear();
        }
        if (mapObject._followTimer) {
            clearInterval(mapObject._followTimer);
            mapObject._followTimer = null;
        }
        if (geolocation) {
            geolocation.un('change:position', onChangePosition);
            geolocation.un('error', onError);
            geolocation.setTracking(false);
            geolocation = null;
        }
        btn.classList.remove("locate_active");
        return;
    }

    btn.classList.add("locate_active");

    const trackingOptions = {
        enableHighAccuracy: true,
        maximumAge: followLocation ? Math.min(updateInterval, 5000) : 5000,
        timeout: followLocation ? Math.max(updateInterval + 5000, 10000) : 30000
    };

    geolocation = new ol.Geolocation({
        tracking: true,
        projection: mapObject.mapObj.getView().getProjection(),
        trackingOptions: trackingOptions
    });

    function onChangePosition() {
        if (!geolocation) return;
        const coords = geolocation.getPosition();
        if (!coords) return;

        const accuracy = geolocation.getAccuracy();
        const heading = geolocation.getHeading() ? geolocation.getHeading() : null;

        mapObject.getLocation(coords, resol, accuracy, heading, setCenter);
        setCenter = false;
    }

    function onError(error) {
        const messages = {
            1: "locationErrorDenied",
            2: "locationErrorNotAvailable",
            3: "locationErrorTimeout"
        };
        const msgKey = messages[error.code] || "locationErrorUnknown";
        const msg = (njs.AppManager.nls.toolsResources[msgKey] || "Error") +
            (error.message ? ": " + error.message : "");
        console.error(msg);
        if (error.code !== 2) showErrorDialog("locationErrorTitle", msg);
    }

    function showErrorDialog(titleKey, msg) {
        const d = new dijit.Dialog({
            title: njs.AppManager.nls.toolsResources[titleKey] || "Location problem"
        });
        d.setContent(msg);
        d.show();
    }

    if (followLocation) {
        onChangePosition();
        geolocation.setTrackingOptions({
            maximumAge: Math.min(updateInterval, 5000),
            timeout: Math.max(updateInterval, 10000)
        })
        // Polling a intervalli
        mapObject._followTimer = setInterval(onChangePosition, updateInterval);
    } else {
        // Tracking continuo
        geolocation.on('change:position', onChangePosition);
        geolocation.on('error', onError);
    }
};

njs.AppManager.getLocation_bk = function (map, resol) {
    const btn = document.getElementById("btnLocate");
    const mapObj = njs.AppManager.Maps[map].mapObj;

    if (geolocation) {
        // disattiva
        geolocation.un('change:position', onChangePosition);
        geolocation.un('error', onError);
        geolocation = null;
        njs.AppManager.Maps[map].highlightLayer.getSource().clear();
        btn.classList.remove("locate_active");
        return;
    }

    // attiva
    geolocation = new ol.Geolocation({
        tracking: true,
        trackingOptions: {
            enableHighAccuracy: true,
            maximumAge: 5000,
            timeout: 30000
        },
        projection: mapObj.getView().getProjection()   // importante!
    });

    let setCenter = true;

    function onChangePosition() {
        if (!geolocation) return;
        const coords = geolocation.getPosition();
        const accuracy = geolocation.getAccuracy();
        const heading = geolocation.getHeading() ? geolocation.getHeading() : false;
        const timestamp = Date.now();

        if (coords) {
            njs.AppManager.Maps[map].getLocation(coords, resol, accuracy, heading, setCenter);
            setCenter = false;
        }
    }
    function onError(err) {
        const errorType = {
            1: (njs.AppManager.nls.toolsResources.locationErrorDenied || "Permission denied by user"),
            2: (njs.AppManager.nls.toolsResources.locationErrorNotAvailable || "Position is not available"),
            3: (njs.AppManager.nls.toolsResources.locationErrorTimeout || "Request time out")
        };
        let errorMessage = errorType[err.code] || (njs.AppManager.nls.toolsResources.locationErrorUnknown || "Unknown error");
        console.error(errorMessage);
        if (err.code !== 2) {
            const d = new dijit.Dialog({ title: (njs.AppManager.nls.toolsResources.locationErrorTitle || "Location problem") });
            d.setContent(errorMessage);
            d.show();
        }
    }
    geolocation.on('change:position', onChangePosition);
    geolocation.on('error', onError);

    btn.classList.add("locate_active");
};

njs.AppManager.deselectAllLayers = function (ar_maps) {
    // set first the theme to none as by deselect all will the url updated
    njs.AppManager.currentTheme = "";
    njs.AppManager.currentSubTheme = "";
    if (typeof ar_maps == 'undefined') {
        for (var item_lyrmgr in njs.AppManager.LyrMgr) {
            njs.AppManager.LyrMgr[item_lyrmgr].deselectAll();
        }
    } else {
        for (var i = 0; i < ar_maps.length; i++) {
            for (var item_lyrmgr in njs.AppManager.LyrMgr) {
                if (dojo.indexOf(njs.AppManager.LyrMgr[item_lyrmgr].targetMap, ar_maps[i]) != -1) {
                    njs.AppManager.LyrMgr[item_lyrmgr].deselectAll();
                }
            }
        }
    }
};

njs.AppManager.showHelpWindow = function (href, title, print, extern) {
    if (print == null || typeof print == 'undefined') print = true;
    if (typeof njs.AppManager.legendFloatWinWidth != "undefined") {
        njs.AppManager.showLegend(href, title, print, extern);
    } else {
        window.open(href)
    }
};

njs.AppManager.getLayerByName = function (idmap, name) {
    var mylayer = null;
    njs.AppManager.Maps[idmap].mapObj.getLayers().getArray().forEach((layer) => {
        if (layer && layer.get('name') === name) {
            mylayer = layer;
        }
    });
    return mylayer;
};

njs.AppManager.getLayerIndexByName = function (idmap, name) {
    var indx = null;
    njs.AppManager.Maps[idmap].mapObj.getLayers().getArray().forEach((layer, i) => {
        if (layer && layer.get('name') === name) {
            indx = i;
        }
    });
    return indx;
};

njs.AppManager.getLayerManagerByLayer = function (idmap, idlayer) {
    for (var item_lyrmgr in njs.AppManager.LyrMgr) {
        if (dojo.indexOf(njs.AppManager.LyrMgr[item_lyrmgr].targetMap, idmap) != -1) {
            var _lyr = njs.AppManager.LyrMgr[item_lyrmgr].getLayerById(idlayer);
            if (_lyr != null && typeof _lyr != "undefined") return njs.AppManager.LyrMgr[item_lyrmgr];
        }
    }
    return null;
};

njs.AppManager.getLayerByMap = function (idmap, idlayer) {
    for (var item_lyrmgr in njs.AppManager.LyrMgr) {
        if (dojo.indexOf(njs.AppManager.LyrMgr[item_lyrmgr].targetMap, idmap) != -1) {
            var _lyr = njs.AppManager.LyrMgr[item_lyrmgr].getLayerById(idlayer);
            if (_lyr != null && typeof _lyr != "undefined") return _lyr;
        }
    }
    return null;
};

njs.AppManager.getVisibleLayersByMap = function (idmap, excludeLayersNotInZoomVisible) {
    var vis_lays = [];
    for (var item_lyrmgr in njs.AppManager.LyrMgr) {
        if (dojo.indexOf(njs.AppManager.LyrMgr[item_lyrmgr].targetMap, idmap) != -1) {
            var _vis_lays = njs.AppManager.LyrMgr[item_lyrmgr].getAllVisibleLayers(excludeLayersNotInZoomVisible);
            vis_lays = vis_lays.concat(_vis_lays);
        }
    }
    return vis_lays;

};

njs.AppManager.getAllLayerObjs = function (idmap) {
    var all_lays = {};
    for (var item_lyrmgr in njs.AppManager.LyrMgr) {
        if (dojo.indexOf(njs.AppManager.LyrMgr[item_lyrmgr].targetMap, idmap) != -1) {
            var _all_lays = njs.AppManager.LyrMgr[item_lyrmgr].getAllLayerObjs();
            // ... (3x dot) is the spread operator, allowing expand arrays or js objects
            // but doesn't work with ie 11
            //all_lays = {...all_lays,..._all_lays};
            for (var _lys in _all_lays) {
                all_lays[_lys] = _all_lays[_lys];
            }
        }
    }
    return all_lays;

};


njs.AppManager.keepUserSessionAlive = function () {
    clearTimeout(njs.AppManager.keepalivetimer);

    if (typeof njs.AppManager.keepalivepage === 'string') {
        njs.AppManager.keepalivepage = [njs.AppManager.keepalivepage];
    }

    require(["dojo/request/xhr"], function (xhr) {
        for (var _url in njs.AppManager.keepalivepage) {
            xhr(njs.AppManager.keepalivepage[_url], {
                handleAs: "text", sync: false
            }).then(function (response) {
            }, function (err) {
                console.error('error in keepalive session');
            });
        }
    });

    njs.AppManager.keepalivetimer = setTimeout(njs.AppManager.keepUserSessionAlive, njs.AppManager.keepalivetimeout);
};

/*
* Reads a cookie by name
*/
njs.AppManager.getcookie = function (c_name) {
    var c_value = document.cookie;
    var c_start = c_value.indexOf(" " + c_name + "=");
    if (c_start == -1) {
        c_start = c_value.indexOf(c_name + "=");
    }
    if (c_start == -1) {
        c_value = null;
    } else {
        c_start = c_value.indexOf("=", c_start) + 1;
        var c_end = c_value.indexOf(";", c_start);
        if (c_end == -1) {
            c_end = c_value.length;
        }
        c_value = decodeURI(c_value.substring(c_start, c_end));
    }
    return c_value;
};
/*
* Sets a cookie by name
*/
njs.AppManager.setcookie = function (c_name, value, exdays) {
    var exdate = new Date();
    exdate.setDate(exdate.getDate() + exdays);
    var c_value = encodeURI(value) + ((exdays == null) ? "" : "; expires=" + exdate.toUTCString());
    document.cookie = c_name + "=" + c_value;
};


/*
 *  Toggle the grayscale / colorful mode
 */
njs.AppManager.toggleBaseLayerColor = function (map, id, button) {
    var tool_opts = njs.AppManager.Tools.BaseLayerToggleColor[this.Maps[map].container][id];
    var _baselayer = njs.AppManager.Maps[map].basisMaps[njs.AppManager.Maps[map].currBasisMap];

    if (_baselayer.status == null && typeof _baselayer.status == "undefined") {
        _baselayer.status = 'color';
    }
    if (_baselayer.status == 'color') {
        _baselayer.status = 'bw';
        button.value = tool_opts._label_col;
        button.style.backgroundImage = 'url(' + tool_opts.imgs.col + ')';
    } else {
        _baselayer.status = 'color';
        button.value = tool_opts._label_bw;
        button.style.backgroundImage = 'url(' + tool_opts.imgs.bw + ')';
    }
    njs.AppManager.Maps[map].toggleBaseLayerColor(_baselayer);
};

/**
 * Toggle th OverviewControl/Button
 * @param id
 * @param button
 */
njs.AppManager.toggleOverviewDisplay = function (id, button) {
    njs.AppManager.Tools.OverviewDisplay["map"][id].toggleOverview(button);
};


njs.AppManager.loadThemeTimeSlider = function (theme_uri, uprofile) {
    require(["dojo/request/xhr"], function (xhr) {
        xhr(theme_uri + "/loader.php", {
            handleAs: "json", sync: true, preventCache: true, method: "POST",
            data: { "f": "/config/timeslider.conf", "g": njs.AppManager.ugroup, "p": uprofile }
        }).then(function (response) {
            // assign the response to the config object
            njs.config.timeSliders = response;
            njs.AppManager.timeSliders = {};

            for (var _idmap in njs.config.timeSliders) {
                njs.AppManager.loadTimeSlider(_idmap, njs.config.timeSliders[_idmap]);
            }
            //});
        }, function (err) {
            // Handle the error condition
            console.error("Error: %o", err);
        }, function (evt) {
            // Handle a progress event from the request if the
            // browser supports XHR2
        });
    });
};

njs.AppManager.loadTimeSlider = function (idmap, opts) {
    require([
        "dojo/dom-construct",
        "dijit/registry",
        "dojo/dom", // for inserting value in TextBox example
        "dojo/parser", // parser because of TextBox decoration
        "dojo/topic",
        "dijit/form/HorizontalSlider",
        "dijit/form/HorizontalRuleLabels",
        "dijit/form/HorizontalRule"
    ], function (domConstruct, registry, dom, parser, topic, HorizontalSlider, HorizontalRuleLabels, HorizontalRule) {

        //calculate current season for initial slider's value
        var d = new Date();
        var _current_year = d.getFullYear();
        var _current_month = d.getMonth() + 1;

        if (_current_month < 10) {
            _current_year--;
        }

        function triggerSliderChange(value) {
            var _arLayers = opts.layers;
            for (var _lay in _arLayers) {
                var _lyr = njs.AppManager.Maps['main'].mapObj.getLayersByName(_arLayers[_lay])[0];
                if (_lyr) {
                    var _params = _lyr.protocol.params;
                    eval('_params.' + opts.filter_field + ' = value');
                    _lyr.protocol.params = _params;
                    _lyr.refresh({ force: true, params: _params });
                }
            }
        }

        // add time filter for all specified layer at startup
        njs.AppManager.Maps[idmap].mapObj.events.on({
            "addlayer": function (evt) {
                var _arLayers = opts.layers;
                for (var _lay in _arLayers) {
                    if (evt.layer.name == _arLayers[_lay]) {
                        var _season = slider.get('value');
                        var _params = evt.layer.protocol.params;
                        eval('_params.' + opts.filter_field + ' = _season');
                        evt.layer.refresh({ force: true, params: _params });
                    }
                }
            }
        });

        //Create the labels
        var rulesNode = domConstruct.create("div", {}, dom.byId("timeslider_slider"), "first");
        var sliderRules = new HorizontalRule({
            container: "topDecoration",
            count: 14,
            style: "height: 10px; margin: 2em 0px -10px 0"
        }, rulesNode);
        var arLabels = [];

        for (var _lbl in opts.labels['de']) {
            arLabels.push(opts.labels[njs.AppManager.Language][_lbl]);
        }
        var labelsNode = domConstruct.create("div", {}, dom.byId("timeslider_slider"), "first");
        var sliderLabels = new HorizontalRuleLabels({
            container: "topDecoration",
            labels: arLabels,
            labelStyle: "font-weight: bold; font-style: italic; font-size: 0.8em;"
        }, labelsNode);

        var slider = new HorizontalSlider({
            name: "timeslider",
            value: _current_year,
            minimum: opts.minimum,
            maximum: opts.maximum,
            discreteValues: opts.maximum - opts.minimum + 1,
            intermediateChanges: true,
            showButtons: false,
            style: "height:65px; width:560px;",
            onChange: function (value) {
                triggerSliderChange(value);
            }
        }, "timeslider_slider");

        // Start up the widgets
        slider.startup();
        sliderRules.startup();
        sliderLabels.startup();

        dom.byId('timeslider_container').style.visibility = 'visible';

        topic.subscribe("tool_activated", function (args) {
            if (args.tool == 'selectiontools1') {
                dom.byId('timeslider_container').style.visibility = 'hidden';
            }
        });
        njs.AppManager.Tools.TimeSlider = slider;
    });
};

njs.AppManager.toggleShLinkManager = function (map_name) {
    var map = njs.AppManager.Maps[map_name].container;

    for (var shlink in njs.AppManager.Tools.ShLinkManager[map]) {
        njs.AppManager.Tools.ShLinkManager[map][shlink].toggleDialog();
    }
};

njs.AppManager.updateMapStatusUrl = function (map_name) {
    const params = new URLSearchParams(window.location.search);

    if (njs.AppManager.Maps[map_name].mapObj.getView().getCenter()) {
        var _theme = "";
        if (njs.AppManager.currentTheme && njs.AppManager.currentTheme != "") _theme = "&theme=" + njs.AppManager.currentTheme;

        var _subtheme = "";
        if (njs.AppManager.currentSubTheme && njs.AppManager.currentSubTheme != "") _subtheme = "&subtheme=" + njs.AppManager.currentSubTheme;

        var _loc = "&x=" + njs.AppManager.Maps[map_name].mapObj.getView().getCenter()[0] + "&y=" + njs.AppManager.Maps[map_name].mapObj.getView().getCenter()[1] + "&zl=" + njs.AppManager.Maps[map_name].mapObj.getView().getZoom() + "&hl=0";
        // visible layers
        var vis_lay = "";
        var op_lay = "";
        var curr_lays = njs.AppManager.getVisibleLayersByMap(map_name);

        var _b_op = false;
        for (var lay in curr_lays) {
            vis_lay += curr_lays[lay].id + '|';

            if (curr_lays[lay].type == "GeoJSON__") {

                var _graphicOpacity = curr_lays[lay]._lyr.styleMap.styles.default.defaultStyle.graphicOpacity;
                if (_graphicOpacity == null || typeof _graphicOpacity == "undefined") _graphicOpacity = "";
                else {
                    _graphicOpacity = Math.round(_graphicOpacity * 10) / 10;
                    if (_graphicOpacity != 1) _b_op = true;
                }

                var _fillOpacity = curr_lays[lay]._lyr.styleMap.styles.default.defaultStyle.fillOpacity;
                if (_fillOpacity == null || typeof _fillOpacity == "undefined") _fillOpacity = "";
                else if (_fillOpacity == "${getFillOpacity}") {
                    // classes are provided, then use general default opacity from the default calss
                    if (curr_lays[lay].general_default_fill_opacity != null) {
                        _fillOpacity = curr_lays[lay].general_default_fill_opacity;
                        _b_op = true;
                    }

                }
                else {
                    _fillOpacity = Math.round(_fillOpacity * 10) / 10;
                    if (_fillOpacity != 1) _b_op = true;
                }

                // disable opacity update by stroke
                var _strokeOpacity = null;
                //var _strokeOpacity = curr_lays[lay]._lyr.styleMap.styles.default.defaultStyle.strokeOpacity;
                if (_strokeOpacity == null || typeof _strokeOpacity == "undefined") _strokeOpacity = "";
                else {
                    _strokeOpacity = Math.round(_strokeOpacity * 10) / 10;
                    if (_strokeOpacity != 1) _b_op = true;
                }

                var _mainOpacity = _fillOpacity;
                if (_mainOpacity == "" && _graphicOpacity != _fillOpacity) {
                    _mainOpacity = _graphicOpacity;
                }
                if (_mainOpacity != "") op_lay += _mainOpacity;
                else op_lay += "1";
                if (_strokeOpacity != "") op_lay += ',' + _strokeOpacity;
                op_lay += '|';
            } else {
                op_lay += Math.round(curr_lays[lay].opacity * 10) / 10 + '|';
                if (curr_lays[lay].opacity != 1) _b_op = true;
            }

        }
        vis_lay = "&layers=" + vis_lay.substring(0, vis_lay.length - 1);
        if (_b_op) op_lay = "&op=" + op_lay.substring(0, op_lay.length - 1);
        else op_lay = "";

        // redlining
        var _rlstate = "";
        if (njs.AppManager.Tools.TrackBookmark["rl_id"] != "") _rlstate = "&rl=" + njs.AppManager.Tools.TrackBookmark["rl_id"];

        var _ugroup = "";
        if (njs.AppManager.ugroup != "public") _ugroup = "&group=" + njs.AppManager.ugroup;

        // custom params
        let url_params = new URLSearchParams(document.location.search);
        var _customparams = "";
        if (njs.AppManager.Tools.TrackBookmark["custom"]) {
            for (var i in njs.AppManager.Tools.TrackBookmark["custom"]) {
                var custom_item = url_params.get(njs.AppManager.Tools.TrackBookmark["custom"][i]);
                _customparams += "&" + njs.AppManager.Tools.TrackBookmark["custom"][i] + "=" + custom_item;
                //console.info(custom_item);
            }
        }

        // drawing and color schemes
        let drawings = url_params.getAll("drawings");
        let drwngs = new URLSearchParams();
        for (var _drwg in drawings) {
            if (drawings[_drwg] != "") {
                drwngs.append("drawings", drawings[_drwg]);
            }
        }

        var blop = "&blop=" + Math.round(parseFloat(njs.AppManager.Maps[map_name].mapObj.getLayers().getArray()[0].getOpacity()) * 100) / 100;

        var blbw = "";
        if (njs.AppManager.Maps[map_name].mapObj.getLayers().getArray()[0].status) blbw = "&blbw=" + njs.AppManager.Maps[map_name].mapObj.getLayers().getArray()[0].status;

        let rotation = "";
        if (njs.AppManager.Maps[map_name].mapObj.getView().getRotation() != 0) {
            rotation = "&rotation=" + Math.round((njs.AppManager.Maps[map_name].mapObj.getView().getRotation() * 180 / Math.PI) % 360);
        }


        if (typeof window.history.replaceState == "function") {
            window.history.replaceState({}, '', '?lang=' + njs.AppManager.Language + _ugroup + _customparams + '&basemap=' + njs.AppManager.Maps[map_name].currBasisMap + blop + blbw + _loc + vis_lay + op_lay + rotation + _rlstate + _theme + _subtheme + (drwngs.has("drawings") ? "&" + drwngs.toString() : ""));
        }
    }
};

njs.AppManager.setMapBookmark = function (ar_maps, opts) {
    var args = {};
    var _pairs = opts.split("&");
    for (var i = 0; i < _pairs.length; i++) {
        var _items = _pairs[i].split("=");
        args[_items[0]] = _items[1];
    }

    var lyr_managers = {};
    for (var i = 0; i < ar_maps.length; i++) {
        // remove all maptips items
        njs.AppManager.infoFloatWinRemoveallItems(ar_maps[i]);
        for (var item_lyrmgr in njs.AppManager.LyrMgr) {
            if (dojo.indexOf(njs.AppManager.LyrMgr[item_lyrmgr].targetMap, ar_maps[i]) != -1) {
                njs.AppManager.LyrMgr[item_lyrmgr].deselectAll();
                lyr_managers[item_lyrmgr] = njs.AppManager.LyrMgr[item_lyrmgr];

                // switch the layermanager on the theme tab if "ClassicLayerMgr"
                if (lyr_managers[item_lyrmgr].type == "ClassicLayerMgr") {
                    if (args["theme"] && args["theme"] != "") {
                        njs.AppManager.currentTheme = args["theme"];
                        var _container_id = lyr_managers[item_lyrmgr].id + "_cp_" + args["theme"];
                        var pane = dijit.byId(_container_id);
                        if (typeof pane !== 'undefined') {
                            var container = pane.getParent();
                            container.getParent().getParent().set('open', true);
                            // switch to the form pane but with some litle delay in order to see the selected object for a litle while
                            container.selectChild(pane);
                            // trigger the onclick event for container: handles the highlite of the tabs if any
                            require(["dojo/on"], function (on) {
                                on.emit(container.domNode, "click", {});
                            });
                        }

                    } else njs.AppManager.currentTheme = "";
                    // handle the layermanager with the subtheme tab if "ClassicLayerMgr"
                    if (args["subtheme"] && args["subtheme"] != "") {
                        njs.AppManager.currentSubTheme = args["subtheme"];
                        var _subtheme_arr = njs.AppManager.currentSubTheme.split(',');
                        lyr_managers[item_lyrmgr].openTPs(_subtheme_arr, njs.AppManager.currentTheme);
                    } else njs.AppManager.currentSubTheme = "";
                }
            }
        }

        if (args["basemap"] && args["basemap"] != "") njs.AppManager.Maps[ar_maps[i]].changeBaseMap(args["basemap"], true);

        if (args["blop"] && args["blop"] != "") {
            njs.AppManager.Maps[ar_maps[i]].setBaseLayerOpacity(parseFloat(args["blop"]));
        }

        if (args["rotation"] && args["rotation"] != "") {
            console.log(args["rotation"]);
            njs.AppManager.Maps[ar_maps[i]].mapObj.getView().setRotation(args["rotation"] / 180 * Math.PI);
        }

        if (args["x"] && args["y"]) {
            if (!args["zl"]) args["zl"] = 5;
            var pt = [args["x"], args["y"]];
            var _hl = true;
            if (args["hl"]) {
                if (args["hl"] == 0) _hl = false;
            }
            njs.AppManager.Maps[ar_maps[i]].centerAndZoom(pt, args["zl"], _hl);
        }

        if (args["layers"] && args["layers"] != "") {
            for (var _lyrmgr in lyr_managers) {
                lyr_managers[_lyrmgr].switchLayersProgr(args["layers"], args["op"], true);
            }
        }
    }
};

/*
// use the custom pane as general repository for many contents as the user needs
njs.AppManager.toggleCustomPaneContent = function(id,pane,url,close_callback){
    if (njs.Layout.saveCustomPaneWidgetStatus=="visible" && id==njs.Layout.saveCustomPaneWidgetContent) {
        njs.Layout.wipeUpDownCustomPane(pane+'Container');
        njs.Layout.saveCustomPaneWidgetContent = "";
        njs.Layout.saveCustomPaneWidgetClean="";
    } else {
        njs.Layout.saveCustomPaneWidgetContent=id;
        if (njs.Layout.saveCustomPaneWidgetClean!="") eval(njs.Layout.saveCustomPaneWidgetClean);
        njs.Layout.saveCustomPaneWidgetClean=close_callback;
        dojo.byId(pane+'Frame').src = url;
        if (njs.Layout.saveCustomPaneWidgetStatus!="visible") njs.Layout.wipeUpDownCustomPane(pane+'Container');
    }

};*/

// use the custom pane as general repository for many contents as the user needs

njs.AppManager.toggleCustomPaneContent = function (id, pane, url, close_callback, hold) {
    var isDiv = false;

    if (document.getElementById(id) && document.getElementById(id).nodeName == 'DIV' && document.getElementById(id).parentNode == document.getElementById(pane + 'Container')) isDiv = true;
    if (typeof njs._ext_list_window != "undefined" && id == "split") {
        if (confirm(njs.AppManager.nls.toolsResources.confirm_close_list) == true) {
            njs.Layout.saveCustomPaneWidget[pane].status = "hidden"
            njs._ext_list_window.close();
            njs._ext_list_window = undefined;
        } else {
            njs.Layout.saveCustomPaneWidget[pane].content_id = id;
        }
        return;
    }

    if (njs.Layout.saveCustomPaneWidget[pane].status == "visible" && id == njs.Layout.saveCustomPaneWidget[pane].content_id) {
        if (!hold) {
            njs.Layout.wipeUpDownCustomPane(pane);
            if (njs.Layout.saveCustomPaneWidget[pane].clean != "") eval(njs.Layout.saveCustomPaneWidget[pane].clean);
            njs.Layout.saveCustomPaneWidget[pane].content_id = "";
            njs.Layout.saveCustomPaneWidget[pane].clean = "";
        } else {
            if (url != null && typeof url != "undefined" && url != "") document.getElementById(pane + 'Frame').src = url;
        }
    } else {
        njs.Layout.saveCustomPaneWidget[pane].content_id = id;
        if (njs.Layout.saveCustomPaneWidget[pane].clean != "") eval(njs.Layout.saveCustomPaneWidget[pane].clean);
        njs.Layout.saveCustomPaneWidget[pane].clean = close_callback;
        if (url != null && typeof url != "undefined" && url != "") document.getElementById(pane + 'Frame').src = url;
        if (njs.Layout.saveCustomPaneWidget[pane].status != "visible") njs.Layout.wipeUpDownCustomPane(pane);
    }

    if (!isDiv) {
        if (document.getElementById(pane + 'Frame')) document.getElementById(pane + 'Frame').style.display = 'block';
        if (document.getElementById(pane + 'FrameForm')) document.getElementById(pane + 'FrameForm').style.display = 'none';
        if (document.getElementById(pane + 'Div')) document.getElementById(pane + 'Div').style.display = 'none';
    } else {
        if (document.getElementById(pane + 'Frame')) document.getElementById(pane + 'Frame').style.display = 'none';
        if (document.getElementById(pane + 'FrameForm')) document.getElementById(pane + 'FrameForm').style.display = 'none';
        if (document.getElementById(id)) document.getElementById(id).style.display = 'block';
    }
};

njs.AppManager.openWinAndFocus = function (url, name, specs) {
    var win = window.open(url, name, specs);
    win.focus();
};
njs.AppManager.openCustomPaneContent = function (id, pane, url, close_callback) {
    var isDiv = false;
    if (document.getElementById(id) && document.getElementById(id).nodeName == 'DIV' && document.getElementById(id).parentNode == document.getElementById(pane + 'Container')) isDiv = true;
    if (njs.Layout.saveCustomPaneWidget[pane].status == "visible" && id == njs.Layout.saveCustomPaneWidget[pane].content_id) {
        if (url != null && typeof url != "undefined" && url != "") document.getElementById(pane + 'Frame').src = url;
    } else {
        njs.Layout.saveCustomPaneWidget[pane].content_id = id;
        if (njs.Layout.saveCustomPaneWidget[pane].clean != "") eval(njs.Layout.saveCustomPaneWidget[pane].clean);
        njs.Layout.saveCustomPaneWidget[pane].clean = close_callback;
        if (url != null && typeof url != "undefined" && url != "") document.getElementById(pane + 'Frame').src = url;
        if (njs.Layout.saveCustomPaneWidget[pane].status != "visible") njs.Layout.wipeUpDownCustomPane(pane);
    }
    if (!isDiv) {
        if (document.getElementById(pane + 'Frame')) document.getElementById(pane + 'Frame').style.display = 'block';
        if (document.getElementById(pane + 'FrameForm')) document.getElementById(pane + 'FrameForm').style.display = 'none';
        if (document.getElementById(pane + 'Div')) document.getElementById(pane + 'Div').style.display = 'none';
    } else {
        if (document.getElementById(pane + 'Frame')) document.getElementById(pane + 'Frame').style.display = 'none';
        if (document.getElementById(pane + 'FrameForm')) document.getElementById(pane + 'FrameForm').style.display = 'none';
        if (document.getElementById(id)) document.getElementById(id).style.display = 'block';
    }
};

njs.AppManager.closeCustomPaneContent = function (pane) {
    if (njs.Layout.saveCustomPaneWidget[pane].status != "hidden") {
        njs.Layout.wipeUpDownCustomPane(pane);
        njs.Layout.saveCustomPaneWidget[pane].content_id = "";
        njs.Layout.saveCustomPaneWidget[pane].clean = "";
    }
};

njs.AppManager.switchAppLang = function (lang) {
    var _curr_lang = "lang=" + njs.AppManager.Language;
    var _new_lang = "lang=" + lang;
    window.location = window.location.href.replace(_curr_lang, _new_lang);
};

njs.AppManager.goFullscreen = function (id) {
    //toggle fullscreen
    var element = document.getElementById(id);
    if (document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement) {

        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.mozCancelFullScreen) { // Firefox
            document.mozCancelFullScreen();
        } else if (document.webkitExitFullscreen) { // Chrome, Safari
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) { // IE/Edge
            document.msExitFullscreen();
        }

    } else {
    if (element.requestFullscreen) {
        element.requestFullscreen();
        } else if (element.mozRequestFullScreen) { // Firefox
        element.mozRequestFullScreen();
        } else if (element.webkitRequestFullScreen) { // Chrome, Safari
        element.webkitRequestFullScreen();
        } else if (element.msRequestFullscreen) { // IE/Edge
        element.msRequestFullscreen();
    }

            }
};

njs.AppManager.exitFullscreen = function (id) {
    if (document.exitFullscreen) {
        document.exitFullscreen();
    } else if (document.mozCancelFullScreen) { // Firefox
        document.mozCancelFullScreen();
    } else if (document.webkitExitFullscreen) { // Chrome, Safari
        document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) { // IE/Edge
        document.msExitFullscreen();
    }
};

njs.AppManager.logout = function (callbak_url) {
    var _callback = "";
    if (callbak_url) _callback = callbak_url.replace("#site#", njs.AppManager.Site);
    else _callback = window.location.href.replace('&group=', '&nogroup=');
    window.location = njs.AppManager.apipath + njs.AppManager.Version + "/php/sso/logout.php?callbackPage=" + _callback;
};

/*-------------------------------------------------------------------------------
    method logUser

    Log user session beforeunload

    [string] script_name: called php log script
    [string] conn_id: logging connection id

--------------------------------------------------------------------------------*/
njs.AppManager.logUser = function (script_name, conn_id) {

    njs.AppManager.logUserScript = script_name;
    njs.AppManager.logUserDBConn = conn_id;

    var timestart = new Date();
    var msg;
    require(["dojo/dom", "dojo/on", "dojo/request/xhr", "dojo/domReady!"],
        function (dom, on, xhr) {
            msg = timestart.getTime() + "|" + timestart.getTime() + "|0|" + navigator.userAgent + "|" + njs.AppManager.Language + "|" + njs.AppManager.Site + "|" + njs.AppManager.ugroup + "|" + njs.AppManager.isMobile;
            xhr(njs.AppManager.apipath + njs.AppManager.Version + "/php/logging/" + script_name + "?dbconn_id=" + conn_id + "&tmsg=" + msg, {
                handleAs: "text", sync: false, method: "GET"
            });
            on(window, "beforeunload", function (evt) {
                njs.AppManager.unloadlogUser(script_name, conn_id, timestart, evt);
            });
            on(window, "unload", function (evt) {
                njs.AppManager.unloadlogUser(script_name, conn_id, timestart, evt);
            });
            on(window, "pagehide", function (evt) {
                njs.AppManager.unloadlogUser(script_name, conn_id, timestart, evt);
            });
            on(window, "visibilitychange", function (evt) {
                if (document.visibilityState == 'hidden') {
                    njs.AppManager.unloadlogUser(script_name, conn_id, timestart, evt);
                }
            });

        }
    );
};

njs.AppManager.unloadlogUser = function (script_name, conn_id, timestart, evt) {
    var msg;
    require(["dojo/dom", "dojo/on", "dojo/request/xhr", "dojo/domReady!"],
        function (dom, on, xhr) {
            var timeend = new Date();
            var totTime = (timeend.getTime() - timestart.getTime()) / 1000;
            msg = timestart.getTime() + "|" + timeend.getTime() + "|" + totTime + "|" + navigator.userAgent + "|" + njs.AppManager.Language + "|" + njs.AppManager.Site + "|" + njs.AppManager.ugroup + "|" + njs.AppManager.isMobile;
            xhr(njs.AppManager.apipath + njs.AppManager.Version + "/php/logging/" + script_name + "?dbconn_id=" + conn_id + "&update=1&tmsg=" + msg, {
                handleAs: "text", sync: false, method: "GET"
            });
        }
    );
};

njs.AppManager.logUserLayer = function (layername) {

    if (!njs.AppManager.logUserDBConn || !njs.AppManager.logUserScript) return;
    var msg;
    require(["dojo/dom", "dojo/on", "dojo/request/xhr", "dojo/domReady!"],
        function (dom, on, xhr) {
            msg = navigator.userAgent + "|" + njs.AppManager.Language + "|" + njs.AppManager.Site + "|" + njs.AppManager.ugroup + "|" + njs.AppManager.isMobile + "|" + layername;
            xhr(njs.AppManager.apipath + njs.AppManager.Version + "/php/logging/" + njs.AppManager.logUserScript + "?dbconn_id=" + njs.AppManager.logUserDBConn + "&type=layer&tmsg=" + msg, {
                handleAs: "text", sync: false, method: "GET"
            });

        }
    );
};

njs.AppManager.replaceCumulative = function (str, find, replace) {
    for (var i = 0; i < find.length; i++)
        str = str.replace(new RegExp(find[i], "g"), replace[i]);
    return str;
};

njs.AppManager.changeCustomPaneContent = function (id, pane, url, close_callback) {
    if (njs.Layout.saveCustomPaneWidget[pane].status == "visible" && id == njs.Layout.saveCustomPaneWidget[pane].content_id) {
        if (url != null && typeof url != "undefined" && url != "") document.getElementById(pane + 'Frame').src = url;
    }

};

njs.AppManager.syncDigitExternalGUIOptions = function (item) {
    var form_items = document.getElementsByName(item.name);
    // first synchronise all the form elements in all the guis
    // presents in the application
    for (var i = 0; i < form_items.length; i++) {
        switch (item.type) {
            case "checkbox":
                form_items[i].checked = item.checked;
                break;
        }

    }
    // then sync the values in the editing objects which are linked with those parameters
    for (var edit in njs.AppManager.EditingTools) {
        if (njs.AppManager.EditingTools[edit].external_gui_items && njs.AppManager.EditingTools[edit].external_gui_items[item.name] != null) {
            switch (item.type) {
                case "checkbox":
                    njs.AppManager.EditingTools[edit].external_gui_items[item.name] = item.checked;
                    break;
            }
        }
    }
    // then sync the values in the geotools objects which are linked with those parameters
    for (var map in njs.AppManager.Tools.GeoTools) {
        for (var geotool in njs.AppManager.Tools.GeoTools[map]) {
            if (njs.AppManager.Tools.GeoTools[map][geotool].external_gui_items && njs.AppManager.Tools.GeoTools[map][geotool].external_gui_items[item.name] != null) {
                switch (item.type) {
                    case "checkbox":
                        njs.AppManager.Tools.GeoTools[map][geotool].external_gui_items[item.name] = item.checked;
                        break;
                }
            }
        }
    }
};

njs.AppManager.reloadColorSchemes = function () {


    for (var lyr_mgr in njs.AppManager.LyrMgr) {
        njs.AppManager.LyrMgr[lyr_mgr].refreshDrawingsCombos();
    }
};

//# sourceURL=mapplus://appmanager.js

