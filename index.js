var debug = require('debug')('express-dom-pdf');
var tempfile = require('tempfile');
var fs = require('fs');
var child_process = require('child_process');
var Path = require('path');

module.exports = function(defaults, mappings) {
	return function(mw, settings, request, response) {
		var qu = request.query;
		if (qu.format != "pdf") return Promise.reject('route');
		mw.load({plugins: [pdfPlugin]});
		delete qu.format;
		var opts = {
			page: Object.assign({}, defaults),
			gs: Object.assign({}, defaults)
		};
		['orientation', 'paper', 'margins'].forEach(function(key) {
			importKey(qu, opts.page, key);
		});
		['quality', 'icc'].forEach(function(key) {
			importKey(qu, opts.gs, key);
		});
		if (Object.keys(opts.gs).length == 0) delete opts.gs;
		settings.pdf = opts;
		// sets the view to be fetched from current request url, effectively doing a subrequest
		settings.view = settings.location;
	};
};

function pdfPlugin(page, settings, request, response) {
	settings['auto-load-images'] = true;
	settings.style = null;
	settings.stall = 2000;
	settings.stallInterval = 0;
	settings.stallTimeout = 0;
	settings.timeout = 5000;
	settings.runTimeout = 1000;


	page.when('load', function() {
		var fpath = tempfile('.pdf');
		debug("getting pdf output of", page.uri);
		return page.pdf(fpath, settings.pdf.page).then(function() {
			debug("pdf ready");
			response.set('Content-Type', 'application/pdf');
			if (settings.pdf.gs) {
				settings.output = throughGS(fpath, settings.pdf.gs);
			} else {
				settings.output = fs.createReadStream(fpath);
			}
			settings.output.on('close', function() {
				fs.unlink(fpath, function(err) {
					if (err) console.error("Error cleaning temp file", fpath, err);
				});
			});
		}).catch(function(err) {
			response.status(500);
			settings.output = err;
		});
	});
}

function importKey(from, to, key) {
	if (from[key] !== undefined) {
		to[key] = from[key];
		delete from[key];
	}
}

function throughGS(fpath, opts) {
	// http://milan.kupcevic.net/ghostscript-ps-pdf/
	// ALL OPTIONS http://ghostscript.com/doc/current/Ps2pdf.htm
	// PDF/X-3 see also http://www.color.org/chardata/drsection1.xalter
	// the images quality
	// screen: 72 dpi
	// ebook: 150 dpi
	// printer: 300 dpi
	// prepress: 300 dpi, color preserving
	// default: almost identical to screen
	var quality = opts.quality;
	if ([
		"screen", "ebook", "printer", "prepress", "default"
	].indexOf(quality) < 0) {
		quality = opts.icc ? "printer" : "default";
	}
	var args = [
		"-q",
		"-dBATCH",
		"-dNOPAUSE",
		"-dSAFER",
		"-dMaxBitmap=10000000",
		"-sDEVICE=pdfwrite",
		"-dCompatibilityLevel=1.4",
		"-dNumRenderingThreads=4",
		"-dPDFSETTINGS=/" + quality
	];
	if (opts.icc) {
		var iccpath = Path.join(opts.iccdir, Path.basename(opts.icc));
		var defaultIccPath = Path.join(opts.iccdir, 'sRGB.icc');
		args.push(
			'-dPDFX=true',
			//'-dPDFUseOldCMS=true',
			//'-sColorConversionStrategy=/CMYK',
			'-dAutoFilterColorImages=false', // or else most images go wrong
			'-dAutoFilterGrayImages=false',
			'-dColorImageFilter=/FlateEncode',
			'-dGrayImageFilter=/FlateEncode',
			'-sDefaultRGBProfile=' + defaultIccPath,
			'-sOutputICCProfile=' + iccpath
		);
		if (quality != "printer") {
			console.warn("express-dom-pdf with ICC profile should use printer instead of", quality);
		}
	}
	args.push(
		"-sOutputFile=-",
		fpath
	);

	debug("gs", args.join(" "));

	var gs = child_process.spawn('gs', args);

	gs.stderr.on('data', function(data) {
		console.error(data.toString());
	});

	return gs.stdout;
}
