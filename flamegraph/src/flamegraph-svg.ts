/**
 * SVG flame graph generation for flamegraph action.
 *
 * Generates interactive SVG flame graphs from collapsed stack trace data.
 *
 * @module flamegraph-svg
 */

import * as traceCommands from 'trace-commands';

import { type ArrayMap } from './stack-collapse';
import { SVG, colorScale, colorMap, getColor, flow } from './svg-utils';

export { Event, ArrayMap, stackCollapseChromeTracing } from './stack-collapse';
export { SVG } from './svg-utils';

/**
 * Result of generating an SVG flame graph.
 */
export interface GenerateSVGFlameGraphResult {
    /** Stack identifiers for the flame graph */
    stackIdentifiers: ArrayMap;
    /** Generated SVG content */
    SVGContent: string;
}

/**
 * Generates a flame graph SVG from stack identifiers.
 *
 * @param stackIdentifiers - Map of call stacks to durations
 * @returns SVG string for the flame graph
 * @throws Error if there are too few samples for the flame graph
 */
export function generateFlameGraph(stackIdentifiers: ArrayMap): string {
    const fnlog = traceCommands.scoped('generateFlameGraph');

    const interactive = true;

    // font type (default "Verdana")
    const fonttype = 'Verdana';

    // max width, pixels / width of image (default 1200)
    const imagewidth = 1200;

    // max height is dynamic / height of each frame (default 16)
    const frameheight = 16;

    // base text size / font size (default 12)
    const fontsize = 12;

    // avg width relative to fontsize
    const fontwidth = 0.59;

    // min function width, pixels or percentage of time
    // omit smaller functions. In pixels or use "%" for
    // percentage of time (default 0.1 pixels)
    const minwidth = 0.1;

    // name type label (default "Function:")
    // what are the names in the data?
    const nametype = 'Time:';

    // count type label (default "samples")
    // what are the counts in the data?
    const countname = 'µs';

    // set color palette. choices are = hot (default), mem
    // io, wakeup, chain, java, js, perl, red, green, blue
    // aqua, yellow, purple, orange
    // color theme
    const colors: string = 'hot';

    // set background colors. gradient choices are yellow,
    // blue, green, grey; flat colors use "#rrggbb"
    // By default, the background color matches the colors
    let bgcolors = '';

    // factor to scale counts by
    const factor = 1;

    // colors are keyed by function name hash
    // color by function name
    const hash = false;

    // colors are randomly generated
    // color randomly
    const rand = false;

    // use consistent palette
    // if we use consistent palettes (default off)
    const palette = false;

    // change title text
    // centered heading
    const titletext = 'Flame Graph';

    // second level title (optional)
    const subtitletext = '';

    // color for search highlighting
    const searchcolor = 'rgb(230,0,230)';

    // add notes comment in SVG (for debugging)
    // embedded notes in SVG
    const notestext = '';
    if (/[<>]/.test(notestext)) {
        throw new Error('Notes string can\'t contain < or >');
    }

    // pad top, include title
    const ypad1 = fontsize * 3;

    // pad bottom, include labels
    const ypad2 = fontsize * 2 + 10;

    // pad top, include subtitle (optional)
    const ypad3 = fontsize * 2;

    // pad left and right
    const xpad = 10;

    // vertical padding for frames
    const framepad = 1;
    let depthmax = 0;

    // Background colors:
    // - yellow gradient: default (hot, java, js, perl)
    // - green gradient: mem
    // - blue gradient: io, wakeup, chain
    // - gray gradient: flat colors (red, green, blue, ...)
    if (bgcolors === '') {
        // Choose a default
        if (colors === 'mem') {
            bgcolors = 'green';
        } else if (/^(io|wakeup|chain)$/.test(colors)) {
            bgcolors = 'blue';
        } else if (/^(red|green|blue|aqua|yellow|purple|orange)$/.test(colors)) {
            bgcolors = 'grey';
        } else {
            bgcolors = 'yellow';
        }
    }

    let bgcolor1: string, bgcolor2: string;
    if (bgcolors === 'yellow') {
        // background color gradient start
        bgcolor1 = '#eeeeee';
        // background color gradient stop
        bgcolor2 = '#eeeeb0';
    } else if (bgcolors === 'blue') {
        bgcolor1 = '#eeeeee';
        bgcolor2 = '#e0e0ff';
    } else if (bgcolors === 'green') {
        bgcolor1 = '#eef2ee';
        bgcolor2 = '#e0ffe0';
    } else if (bgcolors === 'grey') {
        bgcolor1 = '#f8f8f8';
        bgcolor2 = '#e8e8e8';
    } else if (/^#[0-9a-fA-F]{6}$/.test(bgcolors)) {
        bgcolor1 = bgcolor2 = bgcolors;
    } else {
        // Default to grey if unrecognized
        bgcolor1 = '#f8f8f8';
        bgcolor2 = '#e8e8e8';
    }

    // parse input
    interface DataEntry {
        stack: string;
        duration: number;
    }
    const Data: DataEntry[] = [];
    let last: string[] = [];
    let time = 0;
    const delta = undefined;
    const maxdelta = 1;
    // Hash of merged frame data
    const Node: Record<string, { stime?: number; delta?: number }> = {};
    const Tmp: Record<string, { stime?: number; delta?: number }> = {};

    // Convert stackIdentifiers directly into Data array
    for (const [stack, duration] of stackIdentifiers) {
        const stackString = stack.join(';');
        Data.push({ stack: stackString, duration: duration });
    }

    // Process Data array
    const SortedData: DataEntry[] = Data.slice().sort((a, b) => a.stack.localeCompare(b.stack));

    // process and merge frames
    let ignored = 0;
    for (let i = 0; i < SortedData.length; i++) {
        const entry = SortedData[i];
        let stack = entry.stack;
        const samples = entry.duration;

        if (samples === undefined || stack === undefined || samples <= 0) {
            ignored++;
            continue;
        }

        // For chain graphs, annotate waker frames with "_[w]", for later
        // coloring. This is a hack, but has a precedent ("_[k]" from perf).
        if (colors === 'chain') {
            const parts = stack.split(';--;');
            const newparts: string[] = [];
            stack = parts.shift()!;
            stack += ';--;';
            for (let j = 0; j < parts.length; j++) {
                let part = parts[j];
                part = part.replace(/;/g, '_[w];');
                part += '_[w]';
                newparts.push(part);
            }
            stack += newparts.join(';--;');
        }

        // Merge frames and populate Node
        last = flow(last, ['', ...stack.split(';')], time, delta, Node, Tmp);

        time += samples;
    }

    // Final flow call to merge remaining frames
    flow(last, [], time, delta, Node, Tmp);

    if (time < 100) {
        fnlog(`Stack count is low (${time}). Did something go wrong?`);
    }

    if (ignored > 0) {
        fnlog(`Ignored ${ignored} lines with invalid format`);
    }

    if (time === 0) {
        fnlog('ERROR: No stack counts found');
        const im = new SVG();
        const imageheight = fontsize * 5;
        im.header(imagewidth, imageheight);
        im.stringTTF(undefined, imagewidth / 2, fontsize * 2, 'ERROR: No valid input provided.');
        return im.getSVG();
    }

    const timemax = time;

    const widthpertime = (imagewidth - 2 * xpad) / timemax;

    // Treat as a percentage of time if the string ends in a "%".
    const minwidthTime = minwidth / widthpertime;

    // Sort "Node" by keys
    const sortedNode = Object.keys(Node).sort().reduce((acc, key) => {
        acc[key] = Node[key];
        return acc;
    }, {} as Record<string, { stime?: number; delta?: number }>);

    // Prune blocks that are too narrow and determine max depth
    for (const [id, node] of Object.entries(sortedNode)) {
        const idParts = id.split(';');
        const depth = idParts[1];
        const etime = idParts[2];
        const etimeNum = parseFloat(etime);
        const stime = node.stime;
        if (stime === undefined) {
            throw new Error(`missing start for ${id}`);
        }

        if ((etimeNum - stime) < minwidthTime) {
            delete sortedNode[id];
            continue;
        }
        depthmax = Math.max(parseInt(depth), depthmax);
    }

    let imageheight = ((depthmax + 1) * frameheight) + ypad1 + ypad2;
    if (subtitletext !== '') {
        imageheight += ypad3;
    }

    // Define variables
    const titlesize = fontsize + 5;

    // Create a new SVG instance
    const im = new SVG();

    // Allocate colors using the SVG instance
    // RGB(0, 0, 0)
    const black = im.colorAllocate(0, 0, 0);
    // RGB(160, 160, 160)
    const vdgrey = im.colorAllocate(160, 160, 160);
    // RGB(200, 200, 200)
    const dgrey = im.colorAllocate(200, 200, 200);

    // Set the dimensions of the SVG image
    im.header(imagewidth, imageheight);

    const inc = `
<defs>
	<linearGradient id="background" y1="0" y2="1" x1="0" x2="0" >
		<stop stop-color="${bgcolor1}" offset="5%" />
		<stop stop-color="${bgcolor2}" offset="95%" />
	</linearGradient>
</defs>
<style type="text/css">
	text { font-family:${fonttype}; font-size:${fontsize}px; fill:${black}; }
	#search, #ignorecase { opacity:0.1; cursor:pointer; }
	#search:hover, #search.show, #ignorecase:hover, #ignorecase.show { opacity:1; }
	#subtitle { text-anchor:middle; font-color:${vdgrey}; }
	#title { text-anchor:middle; font-size:${titlesize}px}
	#unzoom { cursor:pointer; }
	#frames > *:hover { stroke:black; stroke-width:0.5; cursor:pointer; }
	.hide { display:none; }
	.parent { opacity:0.5; }
</style>
<script type="text/ecmascript">
<![CDATA[
	"use strict";
	var details, searchbtn, unzoombtn, matchedtxt, svg, searching, currentSearchTerm, ignorecase, ignorecaseBtn;
	function init(evt) {
		details = document.getElementById("details").firstChild;
		searchbtn = document.getElementById("search");
		ignorecaseBtn = document.getElementById("ignorecase");
		unzoombtn = document.getElementById("unzoom");
		matchedtxt = document.getElementById("matched");
		svg = document.getElementsByTagName("svg")[0];
		searching = 0;
		currentSearchTerm = null;

		// use GET parameters to restore a flamegraphs state.
		var params = get_params();
		if (params.x && params.y)
			zoom(find_group(document.querySelector('[x="' + params.x + '"][y="' + params.y + '"]')));
                if (params.s) search(params.s);
	}

	// event listeners
	window.addEventListener("click", function(e) {
		var target = find_group(e.target);
		if (target) {
			if (target.nodeName == "a") {
				if (e.ctrlKey === false) return;
				e.preventDefault();
			}
			if (target.classList.contains("parent")) unzoom(true);
			zoom(target);
			if (!document.querySelector('.parent')) {
				// we have basically done a clearzoom so clear the url
				var params = get_params();
				if (params.x) delete params.x;
				if (params.y) delete params.y;
				history.replaceState(null, null, parse_params(params));
				unzoombtn.classList.add("hide");
				return;
			}

			// set parameters for zoom state
			var el = target.querySelector("rect");
			if (el && el.attributes && el.attributes.y && el.attributes._orig_x) {
				var params = get_params()
				params.x = el.attributes._orig_x.value;
				params.y = el.attributes.y.value;
				history.replaceState(null, null, parse_params(params));
			}
		}
		else if (e.target.id == "unzoom") clearzoom();
		else if (e.target.id == "search") search_prompt();
		else if (e.target.id == "ignorecase") toggle_ignorecase();
	}, false)

	// mouse-over for info
	// show
	window.addEventListener("mouseover", function(e) {
		var target = find_group(e.target);
		if (target) details.nodeValue = "${nametype} " + g_to_text(target);
	}, false)

	// clear
	window.addEventListener("mouseout", function(e) {
		var target = find_group(e.target);
		if (target) details.nodeValue = ' ';
	}, false)

	// ctrl-F for search
	// ctrl-I to toggle case-sensitive search
	window.addEventListener("keydown",function (e) {
		if (e.keyCode === 114 || (e.ctrlKey && e.keyCode === 70)) {
			e.preventDefault();
			search_prompt();
		}
		else if (e.ctrlKey && e.keyCode === 73) {
			e.preventDefault();
			toggle_ignorecase();
		}
	}, false)

	// functions
	function get_params() {
		var params = {};
		var paramsarr = window.location.search.substr(1).split('&');
		for (var i = 0; i < paramsarr.length; ++i) {
			var tmp = paramsarr[i].split("=");
			if (!tmp[0] || !tmp[1]) continue;
			params[tmp[0]]  = decodeURIComponent(tmp[1]);
		}
		return params;
	}
	function parse_params(params) {
		var uri = "?";
		for (var key in params) {
			uri += key + '=' + encodeURIComponent(params[key]) + '&';
		}
		if (uri.slice(-1) == "&")
			uri = uri.substring(0, uri.length - 1);
		if (uri == '?')
			uri = window.location.href.split('?')[0];
		return uri;
	}
	function find_child(node, selector) {
		var children = node.querySelectorAll(selector);
		if (children.length) return children[0];
	}
	function find_group(node) {
		var parent = node.parentElement;
		if (!parent) return;
		if (parent.id == "frames") return node;
		return find_group(parent);
	}
	function orig_save(e, attr, val) {
		if (e.attributes["_orig_" + attr] != undefined) return;
		if (e.attributes[attr] == undefined) return;
		if (val == undefined) val = e.attributes[attr].value;
		e.setAttribute("_orig_" + attr, val);
	}
	function orig_load(e, attr) {
		if (e.attributes["_orig_"+attr] == undefined) return;
		e.attributes[attr].value = e.attributes["_orig_" + attr].value;
		e.removeAttribute("_orig_"+attr);
	}
	function g_to_text(e) {
		var text = find_child(e, "title").firstChild.nodeValue;
		return (text)
	}
	function g_to_func(e) {
		var func = g_to_text(e);
		// if there's any manipulation we want to do to the function
		// name before it's searched, do it here before returning.
		return (func);
	}
	function update_text(e) {
		var r = find_child(e, "rect");
		var t = find_child(e, "text");
		var w = parseFloat(r.attributes.width.value) -3;
		var txt = find_child(e, "title").textContent.replace(/\\([^(]*\\)\$/,"");
		t.attributes.x.value = parseFloat(r.attributes.x.value) + 3;

		// Smaller than this size won't fit anything
		if (w < 2 * ${fontsize} * ${fontwidth}) {
			t.textContent = "";
			return;
		}

		t.textContent = txt;
		var sl = t.getSubStringLength(0, txt.length);
		// check if only whitespace or if we can fit the entire string into width w
		if (/^ *\$/.test(txt) || sl < w)
			return;

		// this isn't perfect, but gives a good starting point
		// and avoids calling getSubStringLength too often
		var start = Math.floor((w/sl) * txt.length);
		for (var x = start; x > 0; x = x-2) {
			if (t.getSubStringLength(0, x + 2) <= w) {
				t.textContent = txt.substring(0, x) + "..";
				return;
			}
		}
		t.textContent = "";
	}

	// zoom
	function zoom_reset(e) {
		if (e.attributes != undefined) {
			orig_load(e, "x");
			orig_load(e, "width");
		}
		if (e.childNodes == undefined) return;
		for (var i = 0, c = e.childNodes; i < c.length; i++) {
			zoom_reset(c[i]);
		}
	}
	function zoom_child(e, x, ratio) {
		if (e.attributes != undefined) {
			if (e.attributes.x != undefined) {
				orig_save(e, "x");
				e.attributes.x.value = (parseFloat(e.attributes.x.value) - x - ${xpad}) * ratio + ${xpad};
				if (e.tagName == "text")
					e.attributes.x.value = find_child(e.parentNode, "rect[x]").attributes.x.value + 3;
			}
			if (e.attributes.width != undefined) {
				orig_save(e, "width");
				e.attributes.width.value = parseFloat(e.attributes.width.value) * ratio;
			}
		}

		if (e.childNodes == undefined) return;
		for (var i = 0, c = e.childNodes; i < c.length; i++) {
			zoom_child(c[i], x - ${xpad}, ratio);
		}
	}
	function zoom_parent(e) {
		if (e.attributes) {
			if (e.attributes.x != undefined) {
				orig_save(e, "x");
				e.attributes.x.value = ${xpad};
			}
			if (e.attributes.width != undefined) {
				orig_save(e, "width");
				e.attributes.width.value = parseInt(svg.width.baseVal.value) - (${xpad} * 2);
			}
		}
		if (e.childNodes == undefined) return;
		for (var i = 0, c = e.childNodes; i < c.length; i++) {
			zoom_parent(c[i]);
		}
	}
	function zoom(node) {
		var attr = find_child(node, "rect").attributes;
		var width = parseFloat(attr.width.value);
		var xmin = parseFloat(attr.x.value);
		var xmax = parseFloat(xmin + width);
		var ymin = parseFloat(attr.y.value);
		var ratio = (svg.width.baseVal.value - 2 * ${xpad}) / width;

		// XXX: Workaround for JavaScript float issues (fix me)
		var fudge = 0.0001;

		unzoombtn.classList.remove("hide");

		var el = document.getElementById("frames").children;
		for (var i = 0; i < el.length; i++) {
			var e = el[i];
			var a = find_child(e, "rect").attributes;
			var ex = parseFloat(a.x.value);
			var ew = parseFloat(a.width.value);
			var upstack;
			// Is it an ancestor
            upstack = parseFloat(a.y.value) > ymin;
			if (upstack) {
				// Direct ancestor
				if (ex <= xmin && (ex+ew+fudge) >= xmax) {
					e.classList.add("parent");
					zoom_parent(e);
					update_text(e);
				}
				// not in current path
				else
					e.classList.add("hide");
			}
			// Children maybe
			else {
				// no common path
				if (ex < xmin || ex + fudge >= xmax) {
					e.classList.add("hide");
				}
				else {
					zoom_child(e, xmin, ratio);
					update_text(e);
				}
			}
		}
		search();
	}
	function unzoom(dont_update_text) {
		unzoombtn.classList.add("hide");
		var el = document.getElementById("frames").children;
		for(var i = 0; i < el.length; i++) {
			el[i].classList.remove("parent");
			el[i].classList.remove("hide");
			zoom_reset(el[i]);
			if(!dont_update_text) update_text(el[i]);
		}
		search();
	}
	function clearzoom() {
		unzoom();

		// remove zoom state
		var params = get_params();
		if (params.x) delete params.x;
		if (params.y) delete params.y;
		history.replaceState(null, null, parse_params(params));
	}

	// search
	function toggle_ignorecase() {
		ignorecase = !ignorecase;
		if (ignorecase) {
			ignorecaseBtn.classList.add("show");
		} else {
			ignorecaseBtn.classList.remove("show");
		}
		reset_search();
		search();
	}
	function reset_search() {
		var el = document.querySelectorAll("#frames rect");
		for (var i = 0; i < el.length; i++) {
			orig_load(el[i], "fill")
		}
		var params = get_params();
		delete params.s;
		history.replaceState(null, null, parse_params(params));
	}
	function search_prompt() {
		if (!searching) {
			var term = prompt("Enter a search term (regexp " +
			    "allowed, eg: ^ext4_)"
			    + (ignorecase ? ", ignoring case" : "")
			    + "\\nPress Ctrl-i to toggle case sensitivity", "");
			if (term != null) search(term);
		} else {
			reset_search();
			searching = 0;
			currentSearchTerm = null;
			searchbtn.classList.remove("show");
			searchbtn.firstChild.nodeValue = "Search"
			matchedtxt.classList.add("hide");
			matchedtxt.firstChild.nodeValue = ""
		}
	}
	function search(term) {
		if (term) currentSearchTerm = term;

		var re = new RegExp(currentSearchTerm, ignorecase ? 'i' : '');
		var el = document.getElementById("frames").children;
		var matches = new Object();
		var maxwidth = 0;
		for (var i = 0; i < el.length; i++) {
			var e = el[i];
			var func = g_to_func(e);
			var rect = find_child(e, "rect");
			if (func == null || rect == null)
				continue;

			// Save max width. Only works as we have a root frame
			var w = parseFloat(rect.attributes.width.value);
			if (w > maxwidth)
				maxwidth = w;

			if (func.match(re)) {
				// highlight
				var x = parseFloat(rect.attributes.x.value);
				orig_save(rect, "fill");
				rect.attributes.fill.value = "${searchcolor}";

				// remember matches
				if (matches[x] == undefined) {
					matches[x] = w;
				} else {
					if (w > matches[x]) {
						// overwrite with parent
						matches[x] = w;
					}
				}
				searching = 1;
			}
		}
		if (!searching)
			return;
		var params = get_params();
		params.s = currentSearchTerm;
		history.replaceState(null, null, parse_params(params));

		searchbtn.classList.add("show");
		searchbtn.firstChild.nodeValue = "Reset Search";

		// calculate percent matched, excluding vertical overlap
		var count = 0;
		var lastx = -1;
		var lastw = 0;
		var keys = Array();
		for (k in matches) {
			if (matches.hasOwnProperty(k))
				keys.push(k);
		}
		// sort the matched frames by their x location
		// ascending, then width descending
		keys.sort(function(a, b){
			return a - b;
		});
		// Step through frames saving only the biggest bottom-up frames
		// thanks to the sort order. This relies on the tree property
		// where children are always smaller than their parents.
		var fudge = 0.0001;	// JavaScript floating point
		for (var k in keys) {
			var x = parseFloat(keys[k]);
			var w = matches[keys[k]];
			if (x >= lastx + lastw - fudge) {
				count += w;
				lastx = x;
				lastw = w;
			}
		}
		// display matched percent
		matchedtxt.classList.remove("hide");
		var pct = 100 * count / maxwidth;
		if (pct != 100) pct = pct.toFixed(1)
		matchedtxt.firstChild.nodeValue = "Matched: " + pct + "%";
	}
]]>
</script>
`;

    if (interactive) {
        im.include(inc);
    }

    // Fill the background with a gradient
    im.filledRectangle(0, 0, imagewidth, imageheight, 'url(#background)');

    // Draw title text
    im.stringTTF('title', Math.floor(imagewidth / 2), fontsize * 2, titletext, '');

    // Draw subtitle text if it exists
    if (subtitletext !== '') {
        im.stringTTF('subtitle', Math.floor(imagewidth / 2), fontsize * 4, subtitletext, '');
    }

    if (interactive) {
        // Draw details text
        im.stringTTF('details', xpad, imageheight - (ypad2 / 2), ' ', '');

        // Draw unzoom button with class "hide"
        im.stringTTF('unzoom', xpad, fontsize * 2, 'Reset Zoom', 'class="hide"');

        // Draw search text
        im.stringTTF('search', imagewidth - xpad - 100, fontsize * 2, 'Search', '');

        // Draw ignore case text
        im.stringTTF('ignorecase', imagewidth - xpad - 16, fontsize * 2, 'ic', '');

        // Draw matched text
        im.stringTTF('matched', imagewidth - xpad - 100, imageheight - (ypad2 / 2), ' ', '');
    }

    // Draw frames
    im.groupStart({ id: 'frames' });

    // Iterate over Node objects
    for (const [id, node] of Object.entries(sortedNode)) {
        const [func, depth, etime] = id.split(';');
        const depthNum = parseInt(depth);
        const etimeNum = parseFloat(etime);
        const stime = node.stime!;
        const deltaVal = node.delta;

        const adjustedEtime = (func === '' && depthNum === 0) ? timemax : etimeNum;
        const x1 = xpad + stime * widthpertime;
        const x2 = xpad + adjustedEtime * widthpertime;

        const y1 = imageheight - ypad2 - (depthNum + 1) * frameheight + framepad;
        const y2 = imageheight - ypad2 - depthNum * frameheight;

        // Format samples with commas
        const samples = Math.round((adjustedEtime - stime) * factor);

        const formatWithCommas = (number: number) => {
            return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        };

        const samplesTxt = formatWithCommas(samples);

        let info: string;
        if (func === '' && parseInt(depth) === 0) {
            info = `all (${samplesTxt} ${countname}, 100%)`;
        } else {
            const pct = ((100 * samples) / (timemax * factor)).toFixed(2);
            const escapedFunc = func
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/_\[[kwij]\]$/, '');
            if (deltaVal === undefined) {
                info = `${escapedFunc} (${samplesTxt} ${countname}, ${pct}%)`;
            } else {
                const d = deltaVal;
                const deltPct = ((100 * d) / (timemax * factor)).toFixed(2);
                const signDeltPct = d > 0 ? `+${deltPct}` : deltPct;
                info = `${escapedFunc} (${samplesTxt} ${countname}, ${pct}%; ${signDeltPct}%)`;
            }
        }

        // Create name attributes
        const nameAttr: Record<string, string> = {};
        nameAttr.title = info;
        im.groupStart(nameAttr);

        // Determine color
        let color: string;
        if (func === '--') {
            color = vdgrey;
        } else if (func === '-') {
            color = dgrey;
        } else if (deltaVal !== undefined) {
            color = colorScale(deltaVal, maxdelta);
        } else if (palette) {
            const paletteMap: Record<string, string> = {};
            color = colorMap(colors, func, paletteMap, hash, rand);
        } else {
            color = getColor(colors, hash, func, rand);
        }
        im.filledRectangle(x1, y1, x2, y2, color, 'rx="2" ry="2"');

        // Draw text
        const chars = Math.floor((x2 - x1) / (fontsize * fontwidth));
        let text = '';
        // room for one char plus two dots
        if (chars >= 3) {
            const truncatedFunc = func.replace(/_\[[kwij]\]$/, '');
            text = truncatedFunc.substring(0, chars);
            if (chars < truncatedFunc.length) {
                text = text.substring(0, text.length - 2) + '..';
            }
            text = text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }
        im.stringTTF(undefined, x1 + 3, 3 + (y1 + y2) / 2, text, '');

        im.groupEnd(nameAttr);
    }
    im.groupEnd({});

    return im.getSVG();
}
