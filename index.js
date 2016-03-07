var debug = require('debug')('express-dom-pdf');
var tempfile = require('tempfile');
var fs = require('fs');
var child_process = require('child_process');

module.exports = function(opts) {
	return pdfHelper.bind(opts);
};

function pdfPlugin(page, settings, request, response) {
	settings['auto-load-images'] = true;
	settings.style = null;
	settings.stall = 2000;
	settings.stallInterval = 0;
	settings.stallTimeout = 0;
	settings.timeout = 5000;
	settings.runTimeout = 1000;


	page.when('load', function(cb) {
		var fpath = tempfile('.pdf');
		debug("getting pdf output of", settings.location.href);
		page.pdf(fpath, settings.pdf.page, function(err) {
			if (err) {
				response.status(500);
				settings.output = err;
			} else {
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
			}
			cb();
		});
	});
}


function pdfHelper(settings, request, response) {
	var qu = request.query;
	if (qu.format != "pdf") return Promise.reject('route');
	settings.load.plugins = [pdfPlugin];
	delete qu.format;
	var opts = {
		page: {},
		gs: {}
	};
	['orientation', 'paper', 'margins'].forEach(function(key) {
		importKey(Object.assign({}, qu, this), opts.page, key);
	});
	['quality'].forEach(function(key) {
		importKey(Object.assign({}, qu, this), opts.gs, key);
	});
	if (Object.keys(opts.gs).length == 0) delete opts.gs;
	settings.pdf = opts;
	// sets the view to be fetched from current request url, effectively doing a subrequest
	settings.view = settings.location;
};

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
		quality = "default";
	}
	var args = [
		"-q",
		"-dBATCH",
		"-dNOPAUSE",
		"-dSAFER",
		"-dMaxBitmap=10000000",
		"-sDEVICE=pdfwrite",
		"-dCompatibilityLevel=1.4",
		"-dPDFSETTINGS=/" + quality,
		"-sOutputFile=-",
		fpath
	];
	debug("gs", args.join(" "));

	var gs = child_process.spawn('gs', args);
	return gs.stdout;
}
