/* global njs */
/* global dojo */
/* jslint node: true */
"use strict";

/* Copyright (c) 2010-2011 Tydac, Inc. */

/**
 * @requires njs.js
 */

/* Layout Global Object for the application */
njs.Layout = {};

/*-------------------------------------------------------------------------
method setArcGisInitialExtentIcon

Calculate the position of the initial extent icon. This position is relative of
map container and the icon will be the placed above or
on the left side of the slider, according its orientation (horizontal or
vertical)

[string] idmap : name of the map
--------------------------------------------------------------------------*/
njs.Layout.setArcGisInitialExtentIcon = function(idmap) {
    // get the width and height of the increment icon of the slider bar
    var plusImgWidth = dojo.query(".dijitSliderIncrementIconV").style("width");
    var plusImgHeight = dojo.query(".dijitSliderIncrementIconV").style("height");

    // if more than one slidebar but with the same style: become array of widths
    // and array of heights
    // To do: identify which values is for which slidebar !!
    plusImgWidth = plusImgWidth[0];
    plusImgHeight = plusImgHeight[0];

    // get the initial extent image object
    var theimg = document.getElementById("initialExtentIconImg_" + idmap);

    var _map_container = njs.AppManager.Maps[idmap].container;

    // Check which position and orientation has the slider
    if (document.getElementById(_map_container + "_zoom_slider").style.width == "") {
        // slider vertical

        if (document.getElementById(_map_container + "_zoom_slider").style.left != "") {
            // position relative to the left
            // place the initial extent icon relative to the left, centred over the increment icon
            document.getElementById("initialExtentIcon_" + idmap).style.left = (parseInt(document.getElementById(_map_container + "_zoom_slider").style.left) + 1 - (theimg.width / 2) + (plusImgWidth / 2)) + "px";
        } else {
            // position relative to the right
            // place the initial extent icon relative to the right. The slider's table width must be taken in account to center the icon
            document.getElementById("initialExtentIcon_" + idmap).style.right = (parseInt(document.getElementById(_map_container + "_zoom_slider").style.right) + (document.getElementById(_map_container + "_zoom_slider").offsetWidth) - theimg.width - 1 + (theimg.width / 2) - (plusImgWidth / 2)) + "px";
        }

        if (document.getElementById(_map_container + "_zoom_slider").style.top != "") {
            // position relative to the top
            // the initial extent icon take the slider's top which is slided beneath
            document.getElementById("initialExtentIcon_" + idmap).style.top = document.getElementById(_map_container + "_zoom_slider").style.top;
            document.getElementById(_map_container + "_zoom_slider").style.top = (parseInt(document.getElementById(_map_container + "_zoom_slider").style.top) + theimg.height + 5) + "px";
        } else {
            // position relative to the bottom
            // the initial extent icon must be pushed on top of the slider
            document.getElementById("initialExtentIcon_" + idmap).style.bottom = (parseInt(document.getElementById(_map_container + "_zoom_slider").style.bottom) + parseInt(esriConfig.defaults.map.slider.height)) + "px";
        }
    } else {
        // slider horizontal

        if (document.getElementById(_map_container + "_zoom_slider").style.left != "") {
            // position relative to the left
            // the initial extent icon take the left position of the slider which slides it to the right
            document.getElementById("initialExtentIcon_" + idmap).style.left = document.getElementById(_map_container + "_zoom_slider").style.left;
            document.getElementById(_map_container + "_zoom_slider").style.left = (parseInt(document.getElementById(_map_container + "_zoom_slider").style.left) + theimg.width + 5) + "px";
        } else {
            // position relative to the right
            // the initial extent icon is placed on the left of the slider
            document.getElementById("initialExtentIcon_" + idmap).style.right = (parseInt(document.getElementById(_map_container + "_zoom_slider").style.right) + parseInt(esriConfig.defaults.map.slider.width) + 5) + "px";
        }

        if (document.getElementById(_map_container + "_zoom_slider").style.top != "") {
            // position relative to the top
            // thie initial extent icon must be centered according to the slider's tab height
            document.getElementById("initialExtentIcon_" + idmap).style.top = (parseInt(document.getElementById(_map_container + "_zoom_slider").style.top) - (theimg.height / 2) + (document.getElementById(_map_container + "_zoom_slider").offsetHeight / 2) - 1) + "px";
        } else {
            // thie initial extent icon must be centered according to the slider's tab height
            document.getElementById("initialExtentIcon_" + idmap).style.bottom = (parseInt(document.getElementById(_map_container + "_zoom_slider").style.bottom) - (theimg.height / 2) + (document.getElementById(_map_container + "_zoom_slider").offsetHeight / 2)) + "px";
        }
    }
};

/*-------------------------------------------------------------------------
Function toggle_visibility
Toggles an object's display with or without style

id: id of the element
style: block, inline, flex, ... default: block
--------------------------------------------------------------------------*/
njs.Layout.toggle_visibility = function(id, style) {
    if (!style) style = 'block';
    var e = document.getElementById(id);
    if (e.style.display == style)
        e.style.display = 'none';
    else
        e.style.display = style;
};

/*-------------------------------------------------------------------------
Function toggle_img
Toogles an image object with two states (images)

id: id of the image object
img1: first image
img2: second image
--------------------------------------------------------------------------*/
njs.Layout.toggle_img = function(id, img1, img2) {
    var toggleImg = document.getElementById(id);
    var currentImage = toggleImg.getAttribute('src');

    if (currentImage == img2)
        toggleImg.src = img1;
    else
        toggleImg.src = img2;
};

/*-------------------------------------------------------------------------
Function toggle_background_img
Toogles a background image object with two states (images)

id: id of the image object
img1: first image
img2: second image

--------------------------------------------------------------------------*/
njs.Layout.toggle_background_img = function(id, img1, img2) {
    var toggleImg = document.getElementById(id);

    if (toggleImg.style.backgroundImage.indexOf(img2) >= 0)
        toggleImg.style.backgroundImage = 'url(' + img1 + ')';
    else
        toggleImg.style.backgroundImage = 'url(' + img2 + ')';
};

/*-------------------------------------------------------------------------
	Function wipeUpDownFixNjsPane

	Wipe out or in (toggle behaviour) a free ContentPane element in the dojo BorderContainer without resizing
	the other Panes forming the application .This frame element must have a
	custom attribute "wipe_status" set to "in" or "out" in the <div> HTML
	element according to the initial state.

	Parameter:
	- toggle_btn (object): properties of the div containing the toggle button
	- targetPane (string): id of the div containing the dojo ContentPane
	- btn_imgs (string array): contains the images of the buttons to be toggeled
*/
njs.Layout.saveMyPaneWidget = null;
njs.Layout.wipeUpDownFixNjsPane = function(toggle_btn, target_pane, include_div) {
    if (dojo.attr(toggle_btn, "toggle_stat") != "hidden") {
        dojo.attr(toggle_btn, {toggle_stat: "hidden"});
        var image = toggle_btn.getElementsByTagName("img");
        image[0].src = njs.Layout.MenuPane.icons[1];
        njs.Layout.saveMyPaneWidget = dijit.byId(target_pane);

        var _paneswitcher = dojo.byId('paneSwitcher');

        var clonableDiv = dojo.clone(dojo.byId("headPane"));

        var _style = "position:absolute;left:" + clonableDiv.style.left + ";top:" + clonableDiv.style.top + ";"

        dojo.attr(_paneswitcher, {"style": _style});
        dojo.attr(clonableDiv, {"class": ""});
        dojo.attr(clonableDiv, {"style": "position:relative;"});
        dojo.place(clonableDiv, _paneswitcher, "first");

        if (include_div && include_div != '') {
            var clonableDiv2 = dojo.clone(dojo.byId(include_div));
            dojo.attr(clonableDiv2, {"class": ""});
            dojo.attr(clonableDiv2, {"style": "position:relative;margin:2px,0px,0px,0px"});
            dojo.place(clonableDiv2, _paneswitcher, "last");
        }

        dijit.byId('NeapoljsContainer').removeChild(dijit.byId(target_pane));
        dojo.byId('paneSwitcher').style.display = "block";
    } else {
        dojo.byId('paneSwitcher').style.display = "none";
        /*var widgets = dijit.findWidgets(dojo.byId('footPane'));
        dojo.forEach(widgets, function(w) {
            w.destroyRecursive(false);
        });*/

        dojo.byId('paneSwitcher').innerHTML = "";
        dijit.byId('NeapoljsContainer').addChild(njs.Layout.saveMyPaneWidget, 0);
        dojo.attr(dojo.byId(dojo.attr(toggle_btn, "id")), {toggle_stat: "visible"});
        var image = dojo.byId(dojo.attr(toggle_btn, "id")).getElementsByTagName("img");
        image[0].src = njs.Layout.MenuPane.icons[0];
    }
    njs.AppManager.Maps['main'].refreshMapSize();
};

/*-------------------------------------------------------------------------
	Function wipeUpDownFreeNjsPane

	Wipe out or in (toggle behaviour) a free ContentPane element in the dojo BorderContainer without resizing
	the other Panes forming the application .This frame element must have a
	custom attribute "wipe_status" set to "in" or "out" in the <div> HTML
	element according to the initial state.

	Parameter:
	- targetPane (string): id of the div containing the dojo ContentPane
	- ececTime (int): execution of the wipe effect in milliseconds
	- force (string): if set, force a in or out action
	Return:
	- bool: false
*/

njs.Layout.wipeUpDownFreeNjsPane = function(targetPane, execTime, force, imgcont) {
    // check if the pane is in or out
    if (dojo.attr(targetPane, "wipe_status") != "out") {
        // check the force parameter, if forced to be opened then do nothing
        if (force == "in") return false;
        njs.Layout.toggle_img(imgcont, njs.Layout.MenuPane.icons[0], njs.Layout.MenuPane.icons[1]);

        // set the attribute to "out" as the frame will be closed
        dojo.attr(targetPane, {wipe_status: "out"});

        // disable the animation for ie (sucks)
        if (dojo.isIE > 5) {
            dojo.attr(targetPane, {style: {display: "none"}});
            return false;
        }

        // for the margins of the pane we need to store the value as attribute
        // as they will be changed programatically (not like the width)
        var o_margins = dojo.query("#" + targetPane).style("marginTop") + "px ";
        o_margins += dojo.query("#" + targetPane).style("marginRight") + "px ";
        o_margins += dojo.query("#" + targetPane).style("marginBottom") + "px ";
        o_margins += dojo.query("#" + targetPane).style("marginLeft") + "px";

        dojo.attr(targetPane, {orig_margins: o_margins});

        // set the dojo wipe function into a variable in order to play
        // different actions syncroniousely (wipe first and only then resize the other panes - wipe has some delay effects)
        var wo = dojo.fx.wipeOut({node: dojo.byId(targetPane), duration: execTime});
        // create a context variable containing the callback actions for the wipe:
        // set the size of the pane to zero and resize the other frames
        var context = {
            callback: function() {
                dojo.attr(targetPane, {style: {margin: "0px"}});
            }
        };
        // add the callback to the wipe function
        dojo.connect(wo, "onEnd", context, 'callback');
        // play the concatenated actions
        wo.play();
    } else {
        // check the force parameter, if forced to be closed then do nothing
        if (force == "out") return false;
        njs.Layout.toggle_img(imgcont, njs.Layout.MenuPane.icons[0], njs.Layout.MenuPane.icons[1]);

        // set the attribute to "in" as the frame will be opened
        dojo.attr(targetPane, {wipe_status: "in"});

        // disable the animation for ie (sucks)
        if (dojo.isIE > 5) {
            dojo.attr(targetPane, {style: {display: "block"}});
            return false;
        }

        // get the original margins
        var o_margins = dojo.attr(targetPane, "orig_margins");

        // get the original width: deprecated, the with won't be changed
        /*		var _width = dojo.query("#"+targetPane).style("width");

                if (_width==0) _width = "100%";
                else  _width += "px";
        */
        // in order to wipe in, no need to concatenate the actions as the play will act at last
        // reset the size of the pane and resize the other frames
        dojo.attr(targetPane, {style: {height: "10px", margin: o_margins, display: "block"}});
        // wipe in
        dojo.fx.wipeIn({node: dojo.byId(targetPane), duration: execTime}).play();
    }
    return false;
};

/*-------------------------------------------------------------------------
	Function wipeUpDownFreeFilterPane

	Wipe out or in (toggle behaviour) a free ContentPane element in the dojo BorderContainer without resizing
	the other Panes forming the application .This frame element must have a
	custom attribute "wipe_status" set to "in" or "out" in the <div> HTML
	element according to the initial state.

	Parameter:
	- targetPane (string): id of the div containing the dojo ContentPane
	- ececTime (int): execution of the wipe effect in milliseconds
	- force (string): if set, force a in or out action
	Return:
	- bool: false
*/

njs.Layout.wipeUpDownFreeFilterPane = function(targetPane, execTime, force, imgcont, _height) {
    if (typeof(_height) == 'undefined') _height = '150px';
    // check if the pane is in or out
    if (dojo.attr(targetPane, "wipe_status") != "out") {
        // check the force parameter, if forced to be opened then do nothing
        if (force == "in") return false;

        njs.Layout.toggle_img(imgcont, njs.Layout.MenuPane.icons[0], njs.Layout.MenuPane.icons[1]);

        // set the attribute to "out" as the frame will be closed
        dojo.attr(targetPane, {wipe_status: "out"});
        var _height = dojo.attr(targetPane, "height");
        // disable the animation for ie (sucks)
        dojo.attr(targetPane, {style: {height: "21px"}});
        return false;
    } else {
        // check the force parameter, if forced to be closed then do nothing
        if (force == "out") return false;
        njs.Layout.toggle_img(imgcont, njs.Layout.MenuPane.icons[0], njs.Layout.MenuPane.icons[1]);
        // set the attribute to "in" as the frame will be opened
        dojo.attr(targetPane, {wipe_status: "in"});

        // disable the animation for ie (sucks)
        dojo.attr(targetPane, {style: {height: _height}});
        return false;
    }
    return false;
};

/*-------------------------------------------------------------------------
	Function freeNjsPaneActivate

	Set up the behaviour of the free pane acoording the events of the application

	Parameter:
	- targetPane (string): id of the div containing the dojo ContentPane
	- map (string): map id handling the events
*/
njs.Layout.freeNjsPaneActivate = function(targetPane, map, imgcont) {
    // Listen for a "queryMapTip" event on the map in order to
    // wipe out the pane when info are queried
    if (document.attachEvent) { // MSIE
        // add an propertychange event callback for the fake "queryMapTipEvent" event
        document.documentElement.attachEvent("onpropertychange", function(event) {
            if (event.propertyName == "queryMapTipEvent") {
                // execute the callback
                njs.Layout.wipeUpDownFreeNjsPane(targetPane, 300, "out", imgcont, njs.Layout.MenuPane.icons[0], njs.Layout.MenuPane.icons[1]);
            }
        });
    } else { // FFox & co: cleaner
        // add a clean "queryMapTipEvent" event handling callback
        dojo.connect(dojo.byId(map), "queryMapTip", function(e) {
            njs.Layout.wipeUpDownFreeNjsPane(targetPane, 300, "out", imgcont, njs.Layout.MenuPane.icons[0], njs.Layout.MenuPane.icons[1]);
        });
    }
};

/*-------------------------------------------------------------------------
   Function slideUpDownNjsPane

   Wipe out or in (toggle behaviour) a ContentPane element in the dojo BorderContainer and resize
   the other Panes forming the application .This frame element must have a
   custom attribute "wipe_status" set to "in" or "out" in the <div> HTML
   element according to the initial state.

   Parameter:
   - targetPane (string): id of the div containing the dojo ContentPane
   Return:
   - bool: false
 */
njs.Layout.slideUpDownNjsPane = function(targetPane) {

    var slideArgs;

    // check if the pane is in or out
    if (dojo.attr(targetPane, "wipe_status") != "out") {

        slideArgs = {
            node: targetPane,
            top: (dojo.coords(targetPane).t + 1500).toString(),
            left: (dojo.coords(targetPane).l).toString(),
            unit: "px"
        };

        // set the original width in a custom attribute
        var elWidth = document.getElementById(targetPane).style.width;
        dojo.attr(targetPane, {original_width: elWidth});

        // set the attribute to "out" as the frame will be closed
        dojo.attr(targetPane, {wipe_status: "out"});

        // set the dojo wipe function into a variable in order to play
        // different actions syncroniousely (wipe first and only then resize the other panes - wipe has some delay effects)
        var wo = dojo.fx.slideTo(slideArgs);
        // create a context variable containing the callback actions for the wipe:
        // set the size of the pane to zero and resize the other frames
        var context = {
            callback: function() {
                dojo.attr(targetPane, {style: {width: "0px", margin: "0px", padding: "0px", border: "solid 0px #fff"}});
                dijit.byId("NeapoljsContainer").resize();

            }
        };
        // add the callback to the wipe function
        dojo.connect(wo, "onEnd", context, 'callback');
        // play the concatenated actions
        //wo.play();
        dojo.attr(targetPane, {style: {width: "0px", margin: "0px", padding: "0px", border: "solid 0px #424A52"}});
        dijit.byId("NeapoljsContainer").resize();

    } else {
        slideArgs = {
            node: targetPane,
            top: (dojo.coords(targetPane).t).toString(),
            left: (dojo.coords(targetPane).l).toString(),
            unit: "px"
        };

        // get the original element width
        var elWidth = dojo.attr(targetPane, "original_width");

        // in order to wipe in, no need to concatenate the actions as the play will act at last
        // reset the size of the pane and resize the other frames
        dojo.attr(targetPane, {style: {width: elWidth, margin: "3px", padding: "10px", border: "solid 2px #424A52", display: "block"}});
        //dojo.attr(targetPane, { style:{height:"10px",width:elWidth, margin:"3px", padding:"10px", border: "solid 2px #424A52", display:"block"}} );

        dijit.byId("NeapoljsContainer").resize();

        //document.getElementById(targetPane).style.top=(dojo.coords(targetPane).t+1500)+"px";
        //dojo.fx.slideTo(slideArgs).play();
        // set the attribute to "in" as the frame will be opened
        dojo.attr(targetPane, {wipe_status: "in"});
    }
    return false;
};

/*-------------------------------------------------------------------------
  Function wipeUpDownNjsPane

  Wipe out or in (toggle behaviour) a ContentPane element in the dojo BorderContainer and resize
  the other Panes forming the application .This frame element must have a
  custom attribute "wipe_status" set to "in" or "out" in the <div> HTML
  element according to the initial state.

  Parameter:
  - targetPane (string): id of the div containing the dojo ContentPane
  - ececTime (int): execution of the wipe effect in milliseconds
  Return:
  - bool: false
*/
njs.Layout.wipeUpDownNjsPane = function(targetPane, execTime) {
    // check if the pane is in or out

    if (dojo.attr(targetPane, "wipe_status") != "out") {
        // set the attribute to "out" as the frame will be closed
        dojo.attr(targetPane, {wipe_status: "out"});

        // for the margins of the pane we need to store the value as attribute
        // as they will be changed programatically (not like the width)
        var o_margins = dojo.query("#" + targetPane).style("marginTop") + "px ";
        o_margins += dojo.query("#" + targetPane).style("marginRight") + "px ";
        o_margins += dojo.query("#" + targetPane).style("marginBottom") + "px ";
        o_margins += dojo.query("#" + targetPane).style("marginLeft") + "px";

        dojo.attr(targetPane, {orig_margins: o_margins});

        // set the dojo wipe function into a variable in order to play
        // different actions syncroniousely (wipe first and only then resize the other panes - wipe has some delay effects)
        var wo = dojo.fx.wipeOut({node: dojo.byId(targetPane), duration: execTime});
        // create a context variable containing the callback actions for the wipe:
        // set the size of the pane to zero and resize the other frames
        var context = {
            callback: function() {
                dojo.attr(targetPane, {style: {margin: "0px"}});
                dijit.byId("NeapoljsContainer").resize();
            }
        };
        // add the callback to the wipe function
        dojo.connect(wo, "onEnd", context, 'callback');
        // play the concatenated actions
        wo.play();
    } else {

        // get the original margins
        var o_margins = dojo.attr(targetPane, "orig_margins");
        // in order to wipe in, no need to concatenate the actions as the play will act at last
        // reset the size of the pane and resize the other frames
        dojo.attr(targetPane, {style: {height: "10px", width: dojo.query("#" + targetPane).style("width") + "px", margin: o_margins, display: "block"}});
        dijit.byId("NeapoljsContainer").resize();

        // wipe in
        dojo.fx.wipeIn({node: dojo.byId(targetPane), duration: execTime}).play();

        // set the attribute to "in" as the frame will be opened
        dojo.attr(targetPane, {wipe_status: "in"});

    }
    return false;
};

njs.Layout.wipeMenuPane = function() {
    if (njs.Layout.MenuPane.type == "freepane" && njs.Layout.MenuPane.collapsible) {
        njs.Layout.wipeUpDownFreeNjsPane('freePaneToggable', 300, null, 'freePaneWiperImg');
    } else if (njs.Layout.MenuPane.type == "leftpane") {
        njs.Layout.wipeUpDownFixNjsPane(dojo.byId('leftPaneWiper'), 'leftPane');
    }
    dojo.publish("wipeMenuPane");
};

njs.Layout.initTitleFreePaneItems = function() {
    if (njs.Layout.MenuPane.items) {
        for (var item in njs.Layout.MenuPane.items) {
            if (njs.Layout.MenuPane.items[item].banner) {
                // add an image banner in the title bar section
                if (njs.Layout.MenuPane.items[item].banner.img != null) {
                    dojo.setStyle(dojo.byId("tp_" + item + "_titleBarNode"), "backgroundImage", "url(" + njs.Layout.MenuPane.items[item].banner.img + ")");
                    dojo.setStyle(dojo.byId("tp_" + item + "_titleBarNode"), "height", njs.Layout.MenuPane.items[item].banner.size);
                }
            }
            if (njs.Layout.MenuPane.items[item].hideTitleArrow) {
                // remove the titlebar arrow
                dojo.setStyle(dojo.query(".dijitInline.dijitArrowNode", "tp_" + item + "_titleBarNode")[0], "display", "none");
            }
            if (njs.Layout.MenuPane.items[item].textStyle) {
                for (var _txtstyle in njs.Layout.MenuPane.items[item].textStyle) {
                    dojo.setStyle(dojo.query(".dijitTitlePaneTextNode", "tp_" + item + "_titleBarNode")[0], _txtstyle, njs.Layout.MenuPane.items[item].textStyle[_txtstyle]);
                }

            }
            if (njs.Layout.MenuPane.sync == true) {
                dijit.byId("tp_" + item).watch("open", function(param, oldValue, newValue) {
                    if (newValue) {
                        for (var _item in njs.Layout.MenuPane.items) {
                            if (this.id != "tp_" + _item) {
                                var otheritem = dijit.byId("tp_" + _item);
                                if (otheritem.open) otheritem.toggle();
                            }
                        }
                        var animation = newValue ? this._wipeIn : this._wipeOut;
                        /*var handler = dojo.connect(animation, "onEnd", this, function() {
                            // do something when wipe finished
                             dojo.disconnect(handler);
                        });
                        */
                    }
                });
            }
            // trigger if an event is required when the title pane is open/closed
            if (njs.Layout.MenuPane.items[item].trigger_event) {
                var _topic_id = "" + njs.Layout.MenuPane.items[item].trigger_event.id;
                // dojo.hitch passes to the event handler the reference of the variable 'item' which changes context
                dijit.byId("tp_" + item).watch("open", dojo.hitch(null, function(_topic_id, param, oldValue, newValue) {
                    require(["dojo/topic", "dojo/domReady!"], function(topic) {
                        topic.publish(_topic_id, {"open": newValue});
                    });
                }, _topic_id));
            }
        }
    }
};

/*
njs.Layout.saveCustomPaneWidget=null;
njs.Layout.saveCustomPaneWidgetStatus="visible";
njs.Layout.saveCustomPaneWidgetContent="";
njs.Layout.saveCustomPaneWidgetClean="";
njs.Layout.wipeUpDownCustomPane = function(target_pane) {

	if (njs.Layout.saveCustomPaneWidgetStatus != "hidden") {
		njs.Layout.saveCustomPaneWidgetStatus="hidden";
		dojo.byId(target_pane).style.display="none";
		if(dojo.byId(target_pane+"_splitter")) dojo.byId(target_pane+"_splitter").style.display="none";
	} else {
		njs.Layout.saveCustomPaneWidgetStatus="visible";
		if(dojo.byId(target_pane+"_splitter")) dojo.byId(target_pane+"_splitter").style.display="block";
		dojo.byId(target_pane).style.display="block";

	}
	dijit.byId("centerPane").resize();
	if (njs.AppManager.Maps['main']){
		njs.AppManager.Maps['main'].refreshMapSize();
		njs.AppManager.Maps['main'].mapObj.baseLayer.redraw();
	}
} */

/*
 Custom Pane handling (toggle pane beneath the map)
*/
njs.Layout.saveCustomPaneWidget = {};
njs.Layout.wipeUpDownCustomPane = function(target_pane) {
    if (njs.Layout.saveCustomPaneWidget[target_pane].status != "hidden") {
        njs.Layout.saveCustomPaneWidget[target_pane].status = "hidden";
        if (dojo.byId(target_pane + "Container")) dojo.byId(target_pane + "Container").style.display = "none";
        if (dojo.byId(target_pane + "Container_splitter")) dojo.byId(target_pane + "Container_splitter").style.display = "none";
    } else {
        njs.Layout.saveCustomPaneWidget[target_pane].status = "visible";
        if (dojo.byId(target_pane + "Container_splitter")) dojo.byId(target_pane + "Container_splitter").style.display = "block";
        if (dojo.byId(target_pane + "Container")) dojo.byId(target_pane + "Container").style.display = "block";

    }
    dijit.byId("NeapoljsContainer").resize(); 
    dijit.byId("mapContainer").resize();     
   

};

njs.Layout.registerCustomPaneEvt = function(target_pane) {
    require(["dojo/ready", "dojo/aspect", "dijit/registry"], function(ready, aspect, registry) {
        ready(dojo.hitch(null, function(target_pane) {
            aspect.after(registry.byId(target_pane + "Container"), "resize", dojo.hitch(null, function(target_pane) {
                for (var _map in njs.config.basisMaps) {
                    njs.AppManager.Maps[_map].refreshMapSize();
                }
            }, target_pane));
        }, target_pane));
    });
};

njs.Layout.registerButtonBar = function(map_obj) {
    var defButtonsMap = njs.AppManager.defbuttons[map_obj];

    if (Array.isArray(defButtonsMap))
        defButtonsMap.forEach(function(item) {
            njs.Layout.registerButtonBarInternal(map_obj, item);
        });
    else
        njs.Layout.registerButtonBarInternal(map_obj, defButtonsMap);

};

njs.Layout.registerButtonBarInternal = function(map_obj, defButtonsMap) {
    var _btnbar;
    var _ribbonbars;
    var _hasbasemapmenu = {};

    // retrocompatibility before ribbon feature
    var _itemlist = defButtonsMap.type ? defButtonsMap.items : defButtonsMap;

    if (defButtonsMap.type && defButtonsMap.type === "ribbonBar")
        _ribbonbars = {};
    else
        _btnbar = dojo.byId(defButtonsMap.bar || map_obj + "ButtonBar");

    for (var _btnIndex in _itemlist) {
        if (!_itemlist.hasOwnProperty(_btnIndex)) continue;

        var _btn = _itemlist[_btnIndex];
        var _wrapper = ["", ""];
        var _divobj = document.createElement("div");

        if (_ribbonbars && !_ribbonbars[_btn.tab])
            _ribbonbars[_btn.tab] = "";

        dojo.attr(_divobj, "id", "btn" + _btnIndex);
        dojo.attr(_divobj, "class", "btn" + _btnIndex + " " + map_obj + "map " + (_btn.cssClass || "toolButton"));
        dojo.attr(_divobj, "title", (_btn.texts && _btn.texts[njs.AppManager.Language] ? _btn.texts[njs.AppManager.Language].description : njs.AppManager.nls.toolsResources["btn" + _btnIndex + "_tooltip"]));
        if (_btn.evalContent) dojo.html.set(_divobj, eval(_btn.evalContent)); // jshint ignore:line
        if (_btn.style) dojo.attr(_divobj, "style", _btn.style);   //aus template
        else dojo.attr(_divobj, "style", 'z-index: 999;');
        if (_btn.icon) dojo.style(_divobj, "background", "url(../core/templates/" + njs.AppManager.template + "/img/" + _btn.icon + ")  no-repeat center");   //aus template
        if (_btn.icon2) dojo.style(_divobj, "background", "url(core/img/" + _btn.icon2 + ")  no-repeat center");                                              //aus portal

        if (_ribbonbars && _btn.type !== "apptool") {
            _wrapper[0] = '<div class="appLayout ' + (_btn.separator ? "border-right" : "") + '" ' + (_btn.container_style ? 'style="'+_btn.container_style+'"' : "") + '>';
//          _wrapper[1] = '<div>' + (_btn.texts && _btn.texts[njs.AppManager.Language] ? _btn.texts[njs.AppManager.Language].label : njs.AppManager.nls.toolsResources["btn" + _btnIndex]) + '</div></div>'; // AGIS label vs tooltip TBD
            _wrapper[1] = '<div>' + (_btn.texts && _btn.texts[njs.AppManager.Language] ? _btn.texts[njs.AppManager.Language].label : njs.AppManager.nls.toolsResources["btn" + _btnIndex + "_tooltip"]) + '</div></div>';
        }

        // Button tools are predefined buttons with particular actions
        if (_btn === "btntool" || _btn.type === "btntool") {
            switch (_btnIndex) {
                case "InitialExtent":
                    dojo.attr(_divobj, "onClick", 'njs.AppManager.Maps["' + map_obj + '"].zoomEntire()');
                    break;
                case "Locate":
                    dojo.attr(_divobj, "onClick", 'njs.AppManager.getLocation("' + map_obj + '",-1)');
                    break;
                case "RemoveLayers":
                    dojo.attr(_divobj, "onClick", 'njs.AppManager.deselectAllLayers(["' + map_obj + '"])');
                    break;
                case "SwissGeoAdmin":
                    //ToDO
                    //dojo.attr(_divobj, "onClick", 'njs.AppManager.startGeoadmin("' + map_obj + '","")');
                    break;
                case "StreetView":
                    dojo.attr(_divobj, "onClick", 'njs.AppManager.Tools.StreetView["' + map_obj + '"].toggleView(true)');
                    break;
                case "Infra3D":
                    dojo.attr(_divobj, "onClick", 'njs.AppManager.Tools.Infra3D["' + map_obj + '"].toggleView(true)');
                    break;
                case "Orbit":
                    dojo.attr(_divobj, "onClick", 'njs.AppManager.Tools.Orbit["' + map_obj + '"].toggleView(true)');
                    break;
                case "ExportKML":
                    //ToDO
                    //dojo.attr(_divobj, "onClick", 'njs.AppManager.startKMLExport("' + map_obj + '","")');
                    break;
                case "Help":
                    dojo.attr(_divobj, "onClick", 'njs.AppManager.showHelpWindow("' + njs.AppManager.nls.toolsResources["btn" + _btnIndex + "_link"] + '","' + njs.AppManager.nls.toolsResources["btn" + _btnIndex + "_title"] + '",'+_btn.print+','+_btn.extern+')');
                    break;
                case "Refresh":
                    dojo.attr(_divobj, "onClick", 'location.reload()');
                    break;
		case "ZoomIn":
                    dojo.attr(_divobj, "onClick", 'njs.AppManager.Maps["' + map_obj + '"].mapObj.getView().setZoom(njs.AppManager.Maps["' + map_obj + '"].mapObj.getView().getZoom()+1)');
                    break;
                case "ZoomOut":
                    dojo.attr(_divobj, "onClick", 'njs.AppManager.Maps["' + map_obj + '"].mapObj.getView().setZoom(njs.AppManager.Maps["' + map_obj + '"].mapObj.getView().getZoom()-1)');
                    break;
                case "Language":
                    dojo.attr(_divobj, "onClick", 'njs.Layout.toggle_visibility(\'langContainer_' + map_obj + '\')');
                    _divobj.innerHTML = njs.AppManager.Language;
                    var _divobj2 = null;
                    if (_btn.target) {
                        _divobj2 = document.createElement("div");
                        dojo.attr(_divobj2, "id", "btn" + _btnIndex + "_" + map_obj + "langlist");
                    }

                    var _ulobj = document.createElement("ul");
                    dojo.attr(_ulobj, "id", "langContainer_" + map_obj);
                    dojo.attr(_ulobj, "style", "display:none;");
                    
                    if (_btn.langs) {
                        for (var _lang in _btn.langs) {

                            var _liobj = document.createElement("li");

                            dojo.attr(_liobj, "id", "btn_" + _btn.langs[_lang]);
                            if (njs.AppManager.Language != _btn.langs[_lang]){
                                dojo.attr(_liobj, "onClick", "window.location.href = window.location.href.replace('lang=" + njs.AppManager.Language +"', 'lang=" + _btn.langs[_lang] +"')");
                            }
                            _liobj.innerHTML = njs.AppManager.nls.toolsResources["btn" + _btnIndex + "_" +  _btn.langs[_lang]] || _btn.langs[_lang];
                            dojo.place(_liobj, _ulobj, "last");

                        }
                        
                    }
                    if (_divobj2) {
                        dojo.place(_ulobj, _divobj2, "first");
                        dojo.place(_divobj2, dojo.byId(_btn.target), "first");

                        

                    } else dojo.place(_ulobj, _divobj, "first");
                    break;
                case "Logout":
                    if (_btn.customCall && _btn.customCall === true){
                        dojo.attr(_divobj, "onClick", "custom_logout_call()" );
                    } else {
                    var _callback = "";
                    if (_btn.callback && _btn.callback!="") _callback = _btn.callback;
                    dojo.attr(_divobj, "onClick", 'njs.AppManager.logout("'+_callback+'")');
                    }
                    
                    break;
                case "ShLinkManager":
                    //dojo.attr(_divobj, "onClick", 'njs.Layout.toggle_visibility(\'njs_main_shlink_wrapper\')');
                    dojo.attr(_divobj, "onClick", 'njs.AppManager.toggleShLinkManager("' + map_obj + '")');
                    break;
                case "Search":
                    dojo.attr(_divobj, "onClick", 'dojo.byId("freesearchResult").style.display="block"');
                    break;
                case "Maps":
                    dojo.attr(_divobj, "onClick", 'njs.Layout.toggle_visibility(\'btnMapContainer_' + map_obj + '\')');
                    var _divobj2 = null;
                    if (_btn.target) {
                        _divobj2 = document.createElement("div");
                        dojo.attr(_divobj2, "id", "btn" + _btnIndex + "_" + map_obj + "maplist");
                    }

                    var _ulobj = document.createElement("ul");
                    dojo.attr(_ulobj, "id", "btnMapContainer_" + map_obj);
                    dojo.attr(_ulobj, "class", "btnMapContainer");
                    dojo.attr(_ulobj, "style", "display:none;");

                    var _baseMaps = njs.config.basisMaps[map_obj].basisMaps;
                    if (_baseMaps) {
                        for (var _bmap in _baseMaps) {
                            if (!_baseMaps.hasOwnProperty(_bmap)) continue; //ignore disabled base maps (still referenced for projections serialization purpose)
                            var _bmapObj = _baseMaps[_bmap];
                            if (_bmapObj.hasOwnProperty("enabled") && !_bmapObj.enabled) continue;

                            var _liobj = document.createElement("li");

                            dojo.attr(_liobj, "id", "btn" + map_obj + "_" + _bmap);
                            if (_bmapObj.btnClass) {
                                dojo.attr(_liobj, "class", _bmapObj.btnClass + " shadow_small map_selector");
                            } else {
                                dojo.attr(_liobj, "class", "njsIconButtonOSM shadow_small map_selector");
                            }

                            if (_ribbonbars && dijit.byId(_btn.tab)){
                            	dojo.attr(_liobj, "onClick", "njs.AppManager.Maps['" + map_obj + "'].changeBaseMap('" + _bmap + "');dojo.byId('btnMapContainer_" + map_obj + "').style.display = 'none';");
                            } else {
                                dojo.attr(_liobj, "onClick", "njs.AppManager.Maps['" + map_obj + "'].changeBaseMap('" + _bmap + "');");
                            }

                            _liobj.innerHTML = njs.AppManager.nls.toolsResources["btn" + _btnIndex + "_" + _bmap] || _bmap;
                            dojo.place(_liobj, _ulobj, "last");
                        }
                    }
                    if (_divobj2) {
                        dojo.place(_ulobj, _divobj2, "first");
                        dojo.place(_divobj2, dojo.byId(_btn.target), "first");

                        // if ribbon then close map list when change tab
                        if (_ribbonbars && dijit.byId(_btn.tab))
                            _hasbasemapmenu[_btn.tab] = true;

                    } else dojo.place(_ulobj, _divobj, "first");
                    break;
            }
            // Here handle the "togglePane", ... more general / configurable buttons
        } else if (_btn.type === "apptool") {
	// place also the legacy tools in this stack (used for ribbon)
            dojo.attr(_divobj, "class", _btn.separator ? "border-right" : "");
            dojo.attr(_divobj, "title", "");
            dojo.attr(_divobj, "id", _btn.wrapper);
        } else {
            if (_btn) {
                if (_btn.togglePane) {
                    var _pane = _btn.togglePane;
                    dojo.attr(_divobj, "id", "btn" + _btnIndex);      //added by AGIS: ist benötigt zum externen antriggern des click-Events
                    dojo.attr(_divobj, "onClick", 'njs.AppManager.toggleCustomPaneContent("' + _pane.id + '","' + _pane.pane + '","' + _pane.url + '","' + _pane.close_callback + '","' + _pane.hold + '")');

                    var array_open_panes = [];
                    var array_close_panes = [];
                    //register the pane behavour if not yet loaded
                    if (!njs.Layout.saveCustomPaneWidget[_pane.pane]) {
                        if (njs.AppManager.StartParams.paneop) array_open_panes = njs.AppManager.StartParams.paneop.split(',');
                        if (njs.AppManager.StartParams.panecl) array_close_panes = njs.AppManager.StartParams.panecl.split(',');
                        njs.Layout.saveCustomPaneWidget[_pane.pane] = {"status": "visible", "content_id": null, "clean": ""};
                        njs.Layout.wipeUpDownCustomPane(_pane.pane);
                        njs.Layout.registerCustomPaneEvt(_pane.pane);
                    }
                    // set priority in the url start parameter
                    if (((_pane.startstatus === "open" && array_close_panes.indexOf(_pane.pane) === -1) || array_open_panes.indexOf(_pane.pane) > -1) &&
                        !(_pane.minWinWidth && $(window).width() <= _pane.minWinWidth))   //added by AGIS: wenn window.width < minWinWidth dann beim Laden nicht einschalten
                            njs.AppManager.toggleCustomPaneContent(_pane.id, _pane.pane, _pane.url, _pane.close_callback, _pane.hold);
                } else if (_btn.command) {
                    dojo.attr(_divobj, "onClick", _btn.command);
                }
            }
        }

        if (_btnbar)
            dojo.place(_divobj, _btnbar, "last");
        else if (_ribbonbars)
            _ribbonbars[_btn.tab] += _wrapper[0] + _divobj.outerHTML + _wrapper[1];
    }

    if (_ribbonbars) {
        for (var _ribb in _ribbonbars) {
            if (!_ribbonbars.hasOwnProperty(_ribb)) continue;
            // set the content of the tab container
            if (dijit.byId(_ribb)){
            dijit.byId(_ribb).setContent(_ribbonbars[_ribb]);
            // ribbon events
            require(["dijit/registry", "dojo/on", "dojo/ready", "dojo/topic", "dojo/domReady!", "dojo"], function(registry, on, ready, topic, mod1, dojo) {
                ready(dojo.hitch(null, function(_ribb, _hasbasemapmenu, _map_obj) {
                    var panel = registry.byId(_ribb);
                    on(panel, "hide", dojo.hitch(null, function(_hasmaplist, _map_obj) {
                        // if maps in that ribbon then close map list when change tab
                        if (_hasmaplist) dojo.byId("btnMapContainer_" + _map_obj).style.display = "none";
                        // publish the close tab event for tools
                        topic.publish("toolsPaneHide");
                    }, _hasbasemapmenu[_ribb], map_obj));
                }, _ribb, _hasbasemapmenu, map_obj));
            });
        }
    }
    }
};

njs.Layout.registerAppPanes = function() {
    var array_open_panes = [];
    if (njs.AppManager.StartParams.paneop) array_open_panes = njs.AppManager.StartParams.paneop.split(',');
    var array_close_panes = [];
    if (njs.AppManager.StartParams.panecl) array_close_panes = njs.AppManager.StartParams.panecl.split(',');

    if (njs.config.mainpane_container) {
        var _divobj = document.createElement("div");    //changed by AGIS
        dojo.attr(_divobj, "id", 'btnMainPane');
        dojo.attr(_divobj, "class", 'btnMainPane');
        dojo.attr(_divobj, "title", njs.AppManager.nls.toolsResources.btnMainPane);
        dojo.attr(_divobj, "style", 'z-index: 999;');
        dojo.attr(_divobj, "onclick", 'njs.AppManager.toggleCustomPaneContent("' + njs.config.mainpane_container.id + '","' + njs.config.mainpane_container.pane + '",null,"");');
        dojo.place(_divobj, dojo.byId("mapContainer"), "first");

        if (njs.config.mainpane_container.reduced) {
            var _divobj2 = document.createElement("div");
            dojo.attr(_divobj2, "id", 'paneSwitcher');
            dojo.attr(_divobj2, "class", 'edgePanel');
            dojo.attr(_divobj2, "style", 'position: absolute;left: 0px;top: 0px;display: none');
            dojo.place(_divobj2, dojo.byId("mapContainer"), "first");
        }

        if (!njs.Layout.saveCustomPaneWidget[njs.config.mainpane_container.pane]) {
            njs.Layout.saveCustomPaneWidget[njs.config.mainpane_container.pane] = {"status": "visible", "content_id": njs.config.mainpane_container.id, "clean": ""};
            // set priority in the url start parameter
            if (njs.AppManager.isMobile == true ||
                (njs.config.mainpane_container.startstatus == "closed" && array_open_panes.indexOf(njs.config.mainpane_container.pane) == -1) ||
                array_close_panes.indexOf(njs.config.mainpane_container.pane) > -1 ||
                (njs.config.mainpane_container.minWinWidth && $(window).width() <= njs.config.mainpane_container.minWinWidth)) //added by AGIS
                njs.Layout.wipeUpDownCustomPane(njs.config.mainpane_container.pane);
        }
    }

    // see if maptips need a side pane
    if (njs.config.maptips.general_settings.customPane) {
        if (!njs.Layout.saveCustomPaneWidget[njs.config.maptips.general_settings.customPane.pane]) {
            njs.Layout.saveCustomPaneWidget[njs.config.maptips.general_settings.customPane.pane] = {"status": "visible", "content_id": null, "clean": ""};
            njs.Layout.wipeUpDownCustomPane(njs.config.maptips.general_settings.customPane.pane);
            njs.Layout.registerCustomPaneEvt(njs.config.maptips.general_settings.customPane.pane);
        }
    }
    else if (typeof  njs.Layout.saveCustomPaneWidget["custompane"] == "undefined" && document.getElementById('custompaneContainer')) {   
        njs.Layout.saveCustomPaneWidget["custompane"] = {"status": "visible", "content_id": null, "clean": ""};
        njs.Layout.wipeUpDownCustomPane("custompane");
        njs.Layout.registerCustomPaneEvt("custompane");    
    }

    // see if streetview need a side pane
    if (njs.config.streetview) {
        if (!njs.Layout.saveCustomPaneWidget[njs.config.streetview.pane_container]) {
            njs.Layout.saveCustomPaneWidget[njs.config.streetview.pane_container] = {"status": "visible", "content_id": null, "clean": ""};
            njs.Layout.wipeUpDownCustomPane(njs.config.streetview.pane_container);
            njs.Layout.registerCustomPaneEvt(njs.config.streetview.pane_container);
        }
    }
    // see if grouting need a side pane
    if (njs.config.grouting) {
        if (!njs.Layout.saveCustomPaneWidget[njs.config.grouting.pane_container]) {
            njs.Layout.saveCustomPaneWidget[njs.config.grouting.pane_container] = {"status": "visible", "content_id": null, "clean": ""};
            njs.Layout.wipeUpDownCustomPane(njs.config.grouting.pane_container);
            njs.Layout.registerCustomPaneEvt(njs.config.grouting.pane_container);
        }
    }
    // see if infra3d need a side pane
    if (njs.config.infra3d && njs.config.infra3d.pane_container != "_blank") {
        if (!njs.Layout.saveCustomPaneWidget[njs.config.infra3d.pane_container]) {
            njs.Layout.saveCustomPaneWidget[njs.config.infra3d.pane_container] = {"status": "visible", "content_id": null, "clean": ""};
            njs.Layout.wipeUpDownCustomPane(njs.config.infra3d.pane_container);
            njs.Layout.registerCustomPaneEvt(njs.config.infra3d.pane_container);
        }
    }

    // see if orbit need a side pane
    if (njs.config.orbit && njs.config.orbit.pane_container != "_blank") {
        if (!njs.Layout.saveCustomPaneWidget[njs.config.orbit.pane_container]) {
            njs.Layout.saveCustomPaneWidget[njs.config.orbit.pane_container] = {"status": "visible", "content_id": null, "clean": ""};
            njs.Layout.wipeUpDownCustomPane(njs.config.orbit.pane_container);
            njs.Layout.registerCustomPaneEvt(njs.config.orbit.pane_container);
        }
    }

    // if the ribbon bar is defined, then put it in a custom top pane
    if (njs.AppManager.defbuttons && njs.AppManager.defbuttons.main.type == "ribbonBar"){
        njs.Layout.saveCustomPaneWidget["header_bar"]={"status":"hidden","content_id":"header_bar","clean":""};
        njs.Layout.wipeUpDownCustomPane("header_bar");
        njs.Layout.registerCustomPaneEvt("header_bar");
        
        //if (array_close_panes.indexOf("header_bar") > -1) njs.Layout.wipeUpDownCustomPane("header_bar");

        if ((njs.AppManager.defbuttons.main.startstatus == "closed" && array_open_panes.indexOf("header_bar") == -1) ||
            array_close_panes.indexOf("header_bar") > -1 )
            njs.Layout.wipeUpDownCustomPane("header_bar");
        
    }
};

//# sourceURL=mapplus://layout.js
