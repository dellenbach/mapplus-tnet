/* -------------------------------------------------------------------------------------
  Extend AppManager Class in order to handle an info floating pane
  ------------------------------------------------------------------------------------- */
// Form window object

njs.AppManager.InitFormFloatingWindow = function(bHide) {
    // check if the info pane already exists, if not create it
    if (dojo.byId('njs_form_pane') == null || dojo.byId('njs_form_pane') == undefined) {
        // add the node which will host the floating pane
        var node = document.createElement('div');
        dojo.attr(node, "id", "njs_form_pane");
        dojo.place(node, dojo.body(), "first");

        if (njs.AppManager.formFloatWin) njs.AppManager.formFloatWin.destroy();
        // create the floating pane object and set it to the AppManager
        njs.AppManager.formFloatWin = new dojox.layout.FloatingPane({
            title: "",
            dockable: false,
            maxable: false,
            closable: false,
            resizable: false,
            constrainToContainer: true,
            "class": "dojoxFloatingPaneInfo",
            contentClass: "dojoxFloatingPaneContentInfo"
        }, node);
        njs.AppManager.formFloatWin.canvas.className = "dojoxFloatingPaneCanvasInfo";
        // startup the window
        njs.AppManager.formFloatWin.startup();

        if (bHide) njs.AppManager.formFloatWin.hide();
        njs.AppManager.formFloatWin.setContent("<div id='njs_form_pane_content'></div>");
        njs.AppManager.formFloatWin.resize({w: njs.AppManager.formFloatWinWidth, h: njs.AppManager.formFloatWinHeight});
        dojo.byId("njs_form_pane").style.left = njs.AppManager.formFloatWinX + "px";
        dojo.byId("njs_form_pane").style.top = njs.AppManager.formFloatWinY + "px";
        dojo.connect(njs.AppManager.formFloatWin, "close", njs.AppManager.formFloatWin, "onClose");

        dojo.connect(njs.AppManager.formFloatWin, "onClose", function() {
            var win_el = dojo.byId("njs_form_pane");
            njs.AppManager.formFloatWinWidth = parseInt(win_el.style.width);
            njs.AppManager.formFloatWinHeight = parseInt(win_el.style.height);
            njs.AppManager.formFloatWinX = parseInt(win_el.style.left);
            njs.AppManager.formFloatWinY = parseInt(win_el.style.top);
        });


    }
};
//# sourceURL=mapplus://floatingwindow.js 
