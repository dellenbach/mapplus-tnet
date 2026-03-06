const parsedStyleForCSS = function(cssString){
    var el = document.createElement("span");
    el.setAttribute("style", cssString);    
    return el.style; 
};

const upperizeObjKeys = (obj) =>
    Object.keys(obj).reduce((acc, k) => {
      acc[k.toUpperCase()] = obj[k];
      return acc;
}, {});

function in_popup(e) {
    njs.AppManager.Maps["main"].isShiftKey = e.shiftKey;
    var dynInfo = document.getElementById('njs_info_floatingpane');
    if (!dynInfo) return;
    if (dynInfo.style.visibility == "hidden") {
        return;
    }
    var pixTolerance = 20;
    var IE = document.all ? true : false;
    var dl = dynInfo.offsetLeft - pixTolerance;
    var dr = dynInfo.offsetLeft + dynInfo.offsetWidth + pixTolerance;
    var dt = dynInfo.offsetTop - pixTolerance;
    var db = dynInfo.offsetTop + dynInfo.offsetHeight + pixTolerance;

    if (IE) {
        tempX = event.clientX + document.body.scrollLeft
        tempY = event.clientY + document.body.scrollTop

    } else {

        tempX = e.pageX
        tempY = e.pageY
    }

    if (tempX > dl && tempX < dr && tempY > dt && tempY < db) {
        return;
    } else {
        dynInfo.style.visibility = "hidden";
    }
}

// Convert DEC angle to SEX DMS
function DECtoSEX(angle) {

    // Extract DMS
    var deg = parseInt(angle);
    var min = parseInt((angle - deg) * 60);
    var sec = (((angle - deg) * 60) - min) * 60;

    // Result in degrees sex (dd.mmss)
    return deg + min / 100 + sec / 10000;

}

// Convert Degrees angle to seconds
function DEGtoSEC(angle) {

    // Extract DMS
    var deg = parseInt(angle);
    var min = parseInt((angle - deg) * 100);
    var sec = (((angle - deg) * 100) - min) * 100;

    // Result in degrees sex (dd.mmss)
    return sec + min * 60 + deg * 3600;

}

// Convert WGS lat/long (° dec) to CH y
function WGStoCHy(lat, lng) {

    // Converts degrees dec to sex
    lat = DECtoSEX(lat);
    lng = DECtoSEX(lng);

    // Converts degrees to seconds (sex)
    lat = DEGtoSEC(lat);
    lng = DEGtoSEC(lng);

    // Axiliary values (% Bern)
    var lat_aux = (lat - 169028.66) / 10000;
    var lng_aux = (lng - 26782.5) / 10000;

    // Process Y
    y = 600072.37
        + 211455.93 * lng_aux
        - 10938.51 * lng_aux * lat_aux
        - 0.36 * lng_aux * Math.pow(lat_aux, 2)
        - 44.54 * Math.pow(lng_aux, 3);

    return y;
}

// Convert WGS lat/long (° dec) to CH x
function WGStoCHx(lat, lng) {

    // Converts degrees dec to sex
    lat = DECtoSEX(lat);
    lng = DECtoSEX(lng);

    // Converts degrees to seconds (sex)
    lat = DEGtoSEC(lat);
    lng = DEGtoSEC(lng);

    // Axiliary values (% Bern)
    var lat_aux = (lat - 169028.66) / 10000;
    var lng_aux = (lng - 26782.5) / 10000;

    // Process X
    x = 200147.07
        + 308807.95 * lat_aux
        + 3745.25 * Math.pow(lng_aux, 2)
        + 76.63 * Math.pow(lat_aux, 2)
        - 194.56 * Math.pow(lng_aux, 2) * lat_aux
        + 119.79 * Math.pow(lat_aux, 3);

    return x;

}

// Convert CH y/x to WGS lat
function CHtoWGSlat(y, x) {

    // Converts militar to civil and  to unit = 1000km
    // Axiliary values (% Bern)
    var y_aux = (y - 600000) / 1000000;
    var x_aux = (x - 200000) / 1000000;

    // Process lat
    lat = 16.9023892
        + 3.238272 * x_aux
        - 0.270978 * Math.pow(y_aux, 2)
        - 0.002528 * Math.pow(x_aux, 2)
        - 0.0447 * Math.pow(y_aux, 2) * x_aux
        - 0.0140 * Math.pow(x_aux, 3);

    // Unit 10000" to 1 " and converts seconds to degrees (dec)
    lat = lat * 100 / 36;

    return lat;

}

// Convert CH y/x to WGS long
function CHtoWGSlng(y, x) {

    // Converts militar to civil and  to unit = 1000km
    // Axiliary values (% Bern)
    var y_aux = (y - 600000) / 1000000;
    var x_aux = (x - 200000) / 1000000;

    // Process long
    lng = 2.6779094
        + 4.728982 * y_aux
        + 0.791484 * y_aux * x_aux
        + 0.1306 * y_aux * Math.pow(x_aux, 2)
        - 0.0436 * Math.pow(y_aux, 3);

    // Unit 10000" to 1 " and converts seconds to degrees (dec)
    lng = lng * 100 / 36;

    return lng;
}

function ValidURL(str) {
    var pattern = new RegExp('^(https?:\/\/)?' + // protocol
        '((([a-z\d]([a-z\d-]*[a-z\d])*)\.)+[a-z]{2,}|' + // domain name
        '((\d{1,3}\.){3}\d{1,3}))' + // OR ip (v4) address
        '(\:\d+)?(\/[-a-z\d%_.~+]*)*' + // port and path
        '(\?[;&a-z\d%_.~+=-]*)?' + // query string
        '(\#[-a-z\d_]*)?$', 'i'); // fragment locater
    if (!pattern.test(str)) {
        alert("Please enter a valid URL.");
        return false;
    } else {
        return true;
    }
}

function in_array(needle, haystack) {
    for (var key in haystack) {
        if (needle === haystack[key]) {
            return true;
        }
    }

    return false;
}

function getBestPosition(objDOM, pixelPos) {
    var mapWidth = parseInt(dojo.byId('mapContainer').style.width);
    var mapHeight = parseInt(dojo.byId('mapContainer').style.height);

    var mapPosX = Math.round(parseInt(dojo.byId('mapContainer').style.left));
    var mapPosY = Math.round(parseInt(dojo.byId('mapContainer').style.top) * parseInt(dojo.byId('mapContainer').style.height) / 100);
    var varLeft = pixelPos.x;
    var varTop = pixelPos.y;
    var dwidth = parseInt(objDOM.style.width);
    var dheight = parseInt(objDOM.style.height);
    var MaxWidth = mapWidth / 2;
    var MaxHeight = mapHeight / 2;

    dwidth = parseInt(objDOM.offsetWidth);

    if (dwidth > MaxWidth) {
        dwidth = parseInt(objDOM.offsetWidth);
    }

    dheight = parseInt(objDOM.clientHeight);

    if (dheight > MaxHeight) {
        dheight = parseInt(MaxHeight);
    }

    varPosX = parseInt(varLeft) + parseInt(mapPosX);
    varPosY = parseInt(varTop) + parseInt(mapPosY);

    if (varLeft < mapWidth / 2) {
        var PosX = (varPosX);
    } else {
        var PosX = (varPosX - (dwidth));
    }

    if (varTop < mapHeight / 2) {
        var PosY = (varPosY);
    } else {
        var PosY = (varPosY - (dheight));
    }
    var resp = new Array(PosX, PosY);
    return resp;
}

function colorIsDarkAdvanced(bgColor) {
    let color = (bgColor.charAt(0) === '#') ? bgColor.substring(1, 7) : bgColor;
    let r = parseInt(color.substring(0, 2), 16); // hexToR
    let g = parseInt(color.substring(2, 4), 16); // hexToG
    let b = parseInt(color.substring(4, 6), 16); // hexToB
    let uicolors = [r / 255, g / 255, b / 255];
    let c = uicolors.map((col) => {
      if (col <= 0.03928) {
        return col / 12.92;
      }
      return Math.pow((col + 0.055) / 1.055, 2.4);
    });
    let L = (0.2126 * c[0]) + (0.7152 * c[1]) + (0.0722 * c[2]);
    return L <= 0.179;
}
function openDialog(title, url, dbconn_id, fid, keyname, layername, dbtable, attr_editable, master_field_value, master_table, f_old, f_new, action) {
    var request = OpenLayers.Request.POST({
        url: url,
        data: new URLSearchParams({
            dbconn_id: dbconn_id,
            FID: fid,
            key: keyname,
            layer: layername,
            masterFldValue: master_field_value,
            masterTable: master_table,
            action: "",
            table: dbtable,
            editable: attr_editable,
            feature_old: f_old,
            feature_new: f_new,
            action: action
        }).toString(),
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
        callback: function(resp) {
            // do something with the response
            if (njs.AppManager.infoFloatWin) {
                njs.AppManager.infoFloatWin.setTitle("<table border='0' cellpadding='0 cellspacing='0'><tr><td>" + title + "</td><td><div id='infowin_wait' class='loading_infowin' style='display:none'></div></td></tr></table>");
                njs.AppManager.infoFloatWin.set('content', resp.responseText);
                njs.AppManager.infoFloatWin.resize({w: njs.AppManager.formFloatWinWidth, h: 250});
                dojo.byId("infowin_wait").style.display = 'none';
            }
        }
    });
}

function IsNumeric(input) {
    var RE = /^-{0,1}\d*\.{0,1}\d+$/;
    return (RE.test(input));
}


var datePattern = /^\d{4}-\d{2}-\d{2}$/;

//var datePattern = new RegExp("^\d{4}[\/\-](0?[1-9]|1[012])[\/\-](0?[1-9]|[12][0-9]|3[01])$");

function formatDate(d) {
    var year = d.substr(0, 4);
    var month = d.substr(5, 2);
    var day = d.substr(8, 2);

    return day + "." + month + "." + year
}

// thousand separates a digit-only string using commas
// by element:  onkeyup = "ThousandSeparate(this)"
// by ID:       onkeyup = "ThousandSeparate('txt1','lbl1')"
function ThousandSeparate(V) {
    var separator = "'";
    if (arguments.length == 1) {
        //var V = arguments[0].value;
        V = V.replace(/,/g, '');
        var R = new RegExp('(-?[0-9]+)([0-9]{3})');
        while (R.test(V)) {
            V = V.replace(R, "$1" + separator + "$2");
        }
        //arguments[0].value = V;
        return V;
    }
    else if (arguments.length == 2) {
        //var V = document.getElementById(arguments[0]).value;
        var R = new RegExp('(-?[0-9]+)([0-9]{3})');
        while (R.test(V)) {
            V = V.replace(R, "$1" + separator + "$2");
        }
        //document.getElementById(arguments[1]).innerHTML = V;
        return V;
    }
    else return false;
}

function getStyle(className) {
    var classes = document.styleSheets[2].rules || document.styleSheets[2].cssRules
    var resp = null;
    for (var x = 0; x < classes.length; x++) {
        if (classes[x].selectorText == className) {
            (classes[x].cssText) ? resp = classes[x].cssText : resp = classes[x].style.cssText;
        }
    }
    return resp;
}

function toogleDiv(div_name) {
    var oDiv = document.getElementById(div_name);
    if (oDiv.style.display == 'none') oDiv.style.display = 'block';
    else oDiv.style.display = 'none';
}

function utf8_encode(argString) {
    //   example 1: utf8_encode('Kevin van Zonneveld');
    //   returns 1: 'Kevin van Zonneveld'

    if (argString === null || typeof argString === 'undefined') {
        return '';
    }

    var string = (argString + ''); // .replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var utftext = '',
        start, end, stringl = 0;

    start = end = 0;
    stringl = string.length;
    for (var n = 0; n < stringl; n++) {
        var c1 = string.charCodeAt(n);
        var enc = null;

        if (c1 < 128) {
            end++;
        } else if (c1 > 127 && c1 < 2048) {
            enc = String.fromCharCode(
                (c1 >> 6) | 192, (c1 & 63) | 128
            );
        } else if ((c1 & 0xF800) != 0xD800) {
            enc = String.fromCharCode(
                (c1 >> 12) | 224, ((c1 >> 6) & 63) | 128, (c1 & 63) | 128
            );
        } else { // surrogate pairs
            if ((c1 & 0xFC00) != 0xD800) {
                throw new RangeError('Unmatched trail surrogate at ' + n);
            }
            var c2 = string.charCodeAt(++n);
            if ((c2 & 0xFC00) != 0xDC00) {
                throw new RangeError('Unmatched lead surrogate at ' + (n - 1));
            }
            c1 = ((c1 & 0x3FF) << 10) + (c2 & 0x3FF) + 0x10000;
            enc = String.fromCharCode(
                (c1 >> 18) | 240, ((c1 >> 12) & 63) | 128, ((c1 >> 6) & 63) | 128, (c1 & 63) | 128
            );
        }
        if (enc !== null) {
            if (end > start) {
                utftext += string.slice(start, end);
            }
            utftext += enc;
            start = end = n + 1;
        }
    }

    if (end > start) {
        utftext += string.slice(start, stringl);
    }

    return utftext;
}

function crc32(str) {
    // depends on: utf8_encode
    // example 1: crc32('Kevin van Zonneveld');
    // returns 1: 1249991249
    str = utf8_encode(str);
    var table =
        '00000000 77073096 EE0E612C 990951BA 076DC419 706AF48F E963A535 9E6495A3 0EDB8832 79DCB8A4 E0D5E91E 97D2D988 09B64C2B 7EB17CBD E7B82D07 90BF1D91 1DB71064 6AB020F2 F3B97148 84BE41DE 1ADAD47D 6DDDE4EB F4D4B551 83D385C7 136C9856 646BA8C0 FD62F97A 8A65C9EC 14015C4F 63066CD9 FA0F3D63 8D080DF5 3B6E20C8 4C69105E D56041E4 A2677172 3C03E4D1 4B04D447 D20D85FD A50AB56B 35B5A8FA 42B2986C DBBBC9D6 ACBCF940 32D86CE3 45DF5C75 DCD60DCF ABD13D59 26D930AC 51DE003A C8D75180 BFD06116 21B4F4B5 56B3C423 CFBA9599 B8BDA50F 2802B89E 5F058808 C60CD9B2 B10BE924 2F6F7C87 58684C11 C1611DAB B6662D3D 76DC4190 01DB7106 98D220BC EFD5102A 71B18589 06B6B51F 9FBFE4A5 E8B8D433 7807C9A2 0F00F934 9609A88E E10E9818 7F6A0DBB 086D3D2D 91646C97 E6635C01 6B6B51F4 1C6C6162 856530D8 F262004E 6C0695ED 1B01A57B 8208F4C1 F50FC457 65B0D9C6 12B7E950 8BBEB8EA FCB9887C 62DD1DDF 15DA2D49 8CD37CF3 FBD44C65 4DB26158 3AB551CE A3BC0074 D4BB30E2 4ADFA541 3DD895D7 A4D1C46D D3D6F4FB 4369E96A 346ED9FC AD678846 DA60B8D0 44042D73 33031DE5 AA0A4C5F DD0D7CC9 5005713C 270241AA BE0B1010 C90C2086 5768B525 206F85B3 B966D409 CE61E49F 5EDEF90E 29D9C998 B0D09822 C7D7A8B4 59B33D17 2EB40D81 B7BD5C3B C0BA6CAD EDB88320 9ABFB3B6 03B6E20C 74B1D29A EAD54739 9DD277AF 04DB2615 73DC1683 E3630B12 94643B84 0D6D6A3E 7A6A5AA8 E40ECF0B 9309FF9D 0A00AE27 7D079EB1 F00F9344 8708A3D2 1E01F268 6906C2FE F762575D 806567CB 196C3671 6E6B06E7 FED41B76 89D32BE0 10DA7A5A 67DD4ACC F9B9DF6F 8EBEEFF9 17B7BE43 60B08ED5 D6D6A3E8 A1D1937E 38D8C2C4 4FDFF252 D1BB67F1 A6BC5767 3FB506DD 48B2364B D80D2BDA AF0A1B4C 36034AF6 41047A60 DF60EFC3 A867DF55 316E8EEF 4669BE79 CB61B38C BC66831A 256FD2A0 5268E236 CC0C7795 BB0B4703 220216B9 5505262F C5BA3BBE B2BD0B28 2BB45A92 5CB36A04 C2D7FFA7 B5D0CF31 2CD99E8B 5BDEAE1D 9B64C2B0 EC63F226 756AA39C 026D930A 9C0906A9 EB0E363F 72076785 05005713 95BF4A82 E2B87A14 7BB12BAE 0CB61B38 92D28E9B E5D5BE0D 7CDCEFB7 0BDBDF21 86D3D2D4 F1D4E242 68DDB3F8 1FDA836E 81BE16CD F6B9265B 6FB077E1 18B74777 88085AE6 FF0F6A70 66063BCA 11010B5C 8F659EFF F862AE69 616BFFD3 166CCF45 A00AE278 D70DD2EE 4E048354 3903B3C2 A7672661 D06016F7 4969474D 3E6E77DB AED16A4A D9D65ADC 40DF0B66 37D83BF0 A9BCAE53 DEBB9EC5 47B2CF7F 30B5FFE9 BDBDF21C CABAC28A 53B39330 24B4A3A6 BAD03605 CDD70693 54DE5729 23D967BF B3667A2E C4614AB8 5D681B02 2A6F2B94 B40BBE37 C30C8EA1 5A05DF1B 2D02EF8D';
    var crc = 0;
    var x = 0;
    var y = 0;
    crc = crc ^ (-1);
    for (var i = 0, iTop = str.length; i < iTop; i++) {
        y = (crc ^ str.charCodeAt(i)) & 0xFF;
        x = '0x' + table.substr(y * 9, 8);
        crc = (crc >>> 8) ^ x;
    }
    return crc ^ (-1);
}

function cleanUpSpecialChars(str, lowercase) {
    str = str.replace(/[ÀÁÂÃÄÅ]/g, "A");
    str = str.replace(/[àáâãäå]/g, "a");
    str = str.replace(/[ÈÉÊË]/g, "E");
    str = str.replace(/[èéêë]/g, "e");
    str = str.replace(/[íìîï]/g, "i");
    str = str.replace(/[ÍÌÎÏ]/g, "I");
    str = str.replace(/[ÓÒÔÖ]/g, "O");
    str = str.replace(/[óòôö]/g, "o");
    str = str.replace(/[ÚÙÛÜ]/g, "U");
    str = str.replace(/[úùûü]/g, "u");

    if (lowercase) str = str.toLowerCase();


    return str.replace(/[^a-zA-Z0-9]/g, '_'); // final clean up
}



function toByteArray(str) {
    var bytes = [];
    for (var i = 0; i < str.length; ++i) {
        bytes.push(str.charCodeAt(i));
    }
    return bytes;
}

function getBool(val) {
    var isfalse = ["off", "no", "f"];
    if (isfalse.indexOf(String(val).toLowerCase()) >= 0) return false;
    var num = +val;
    return !isNaN(num) ? !!num : !!String(val).toLowerCase().replace(!!0, '');
}

/**
 * Encodes multi-byte Unicode string into utf-8 multiple single-byte characters
 * (BMP / basic multilingual plane only).
 *
 * Chars in range U+0080 - U+07FF are encoded in 2 chars, U+0800 - U+FFFF in 3 chars.
 *
 * Can be achieved in JavaScript by unescape(encodeURIComponent(str)),
 * but this approach may be useful in other languages.
 *
 * @param   {string} unicodeString - Unicode string to be encoded as UTF-8.
 * @returns {string} UTF8-encoded string.
 */
function utf8Encode(unicodeString) {
  if (typeof unicodeString != 'string') throw new TypeError('parameter ‘unicodeString’ is not a string');
  const utf8String = unicodeString.replace(
      /[\u0080-\u07ff]/g,  // U+0080 - U+07FF => 2 bytes 110yyyyy, 10zzzzzz
      function(c) {
          var cc = c.charCodeAt(0);
          return String.fromCharCode(0xc0 | cc>>6, 0x80 | cc&0x3f); }
  ).replace(
      /[\u0800-\uffff]/g,  // U+0800 - U+FFFF => 3 bytes 1110xxxx, 10yyyyyy, 10zzzzzz
      function(c) {
          var cc = c.charCodeAt(0);
          return String.fromCharCode(0xe0 | cc>>12, 0x80 | cc>>6&0x3F, 0x80 | cc&0x3f); }
  );
  return utf8String;
}

/**
* Decodes utf-8 encoded string back into multi-byte Unicode characters.
*
* Can be achieved JavaScript by decodeURIComponent(escape(str)),
* but this approach may be useful in other languages.
*
* @param   {string} utf8String - UTF-8 string to be decoded back to Unicode.
* @returns {string} Decoded Unicode string.
*/
function utf8Decode(utf8String) {
  if (typeof utf8String != 'string') throw new TypeError('parameter ‘utf8String’ is not a string');
  // note: decode 3-byte chars first as decoded 2-byte strings could appear to be 3-byte char!
  const unicodeString = utf8String.replace(
      /[\u00e0-\u00ef][\u0080-\u00bf][\u0080-\u00bf]/g,  // 3-byte chars
      function(c) {  // (note parentheses for precedence)
          var cc = ((c.charCodeAt(0)&0x0f)<<12) | ((c.charCodeAt(1)&0x3f)<<6) | ( c.charCodeAt(2)&0x3f);
          return String.fromCharCode(cc); }
  ).replace(
      /[\u00c0-\u00df][\u0080-\u00bf]/g,                 // 2-byte chars
      function(c) {  // (note parentheses for precedence)
          var cc = (c.charCodeAt(0)&0x1f)<<6 | c.charCodeAt(1)&0x3f;
          return String.fromCharCode(cc); }
  );
  return unicodeString;
}

function isTouchDevice() {
    return (('ontouchstart' in  document.documentElement));
}

function calculateGeometryCenter (geometry,centerofgravity=false) {
    let center, coordinates, minRadius;
    const type = geometry.getType();
    if (type === 'Polygon') {
      let x = 0;
      let y = 0;
      let i = 0;
      coordinates = geometry.getCoordinates()[0].slice(1);
      coordinates.forEach(function (coordinate) {
        x += coordinate[0];
        y += coordinate[1];
        i++;
      });
      center = [x / i, y / i];
    } else if (type === 'LineString') {
        let x = 0;
        let y = 0;
        let i = 0;
        coordinates = geometry.getCoordinates();
        if (centerofgravity){
            coordinates.forEach(function (coordinate) {
                x += coordinate[0];
                y += coordinate[1];
                i++;
            });
            center = [x / i, y / i];
        }else{
            center = geometry.getCoordinateAt(0.5);
        }
        
    } else {
      center = ol.extent.getCenter(geometry.getExtent());
    }
    let sqDistances;
    if (coordinates) {
      sqDistances = coordinates.map(function (coordinate) {
        const dx = coordinate[0] - center[0];
        const dy = coordinate[1] - center[1];
        return dx * dx + dy * dy;
      });
      minRadius = Math.sqrt(Math.max.apply(Math, sqDistances)) / 3;
    } else {
      minRadius =
        Math.max(
            ol.extent.getWidth(geometry.getExtent()),
            ol.extent.getHeight(geometry.getExtent())
        ) / 3;
    }
    return {
      center: center,
      coordinates: coordinates,
      minRadius: minRadius,
      sqDistances: sqDistances,
    };
  };

function RGBAToHexA(rgba, forceRemoveAlpha = false) {
    return "#" + rgba.replace(/^rgba?\(|\s+|\)$/g, '') // Get's rgba / rgb string values
      .split(',') // splits them at ","
      .filter((string, index) => !forceRemoveAlpha || index !== 3)
      .map(string => parseFloat(string)) // Converts them to numbers
      .map((number, index) => index === 3 ? Math.round(number * 255) : number) // Converts alpha to 255 number
      .map(number => number.toString(16)) // Converts numbers to hex
      .map(string => string.length === 1 ? "0" + string : string) // Adds 0 when length of one number is 1
      .join("") // Puts the array to togehter to a string
}

function formatLength(length) {
    let output;
    if (length > 1000) {
        output = Math.round(length / 1000 * 100) / 100 + ' ' + 'km';
    } else {
        output = Math.round(length * 100) / 100 + ' ' + 'm';
    }
    return output;
}

function formatArea(area) {
    let output;
    if (area > 100000) {
        output = Math.round(area / 1000000 * 100) / 100 + ' ' + 'km²';
    } else {
        output = Math.round(area * 100) / 100 + ' ' + 'm²';
    }
    return output;
}
//# sourceURL=mapplus://common.js 
