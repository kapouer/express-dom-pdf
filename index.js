var debug = require('debug')('express-dom-pdf');
var tempfile = require('tempfile');
var fs = require('fs');
var child_process = require('child_process');
var Path = require('path');
var getSlug = require('speakingurl');

var pdfxDefPs = fs.readFileSync(Path.join(__dirname, 'PDFX_def.ps')).toString();

// * express-dom-pdf static options *
// iccdir: base directory for icc profiles

// * express-dom-pdf dynamic options *
// disposition: inline, attachment

// * webkitgtk dynamic options *
// orientation: portrait, landscape
// paper: iso_a3, iso_a4, iso_a5, iso_b5, na_letter, na_executive, na_legal...
//  see https://developer.gnome.org/gtk3/stable/GtkPaperSize.html
// margins: number in pt, or string with mm, in, pt unit
// margins: an object with unit, left, top, right, bottom properties

// * ghostscript dynamic options *
// quality: default, screen, ebook, prepress, printer
// icc: profile filename found in iccdir

module.exports = function(defaults, mappings) {
	return function(mw, settings, request, response) {
		var opts = request.query.pdf;
		if (opts == null) return Promise.reject('route');
		delete request.query.pdf;
		Object.assign(opts, defaults);

		mw.load({plugins: [pdfPlugin.bind(opts)]});
		// sets the view to be fetched from current request url, effectively doing a subrequest
		settings.view = settings.location;
	};
};

function pdfPlugin(page, settings, request, response) {
	Object.assign(settings, {
		'auto-load-images': true,
		style: null,
		stall: 2000,
		stallInterval: 0,
		stallTimeout: 0,
		timeout: 5000,
		runTimeout: 1000
	});

	var opts = this;

	var pdfOpts = {};
	['orientation', 'paper', 'margins'].forEach(function(prop) {
		if (opts[prop] != null) pdfOpts[prop] = opts[prop];
	});

	var withGs = 0;
	['icc', 'quality'].forEach(function(prop) {
		if (opts[prop] != null) withGs++;
	});

	page.when('idle', function() {
		return page.run('document.title').then(function(title) {
			debug("title of page", title);
			if (!title) title = page.uri;
			title = getSlug(title);
			var fpath = tempfile('.pdf');
			debug("getting pdf output of", page.uri);
			return page.pdf(fpath, pdfOpts).then(function() {
				debug("pdf ready");
				response.attachment(title + '.pdf');

				if (withGs) {
					settings.output = throughGS(fpath, title, opts);
				} else {
					settings.output = fs.createReadStream(fpath);
				}
				settings.output.on('close', function() {
					fs.unlink(fpath, function(err) {
						if (err) console.error("Error cleaning temp file", fpath, err);
					});
				});
			});
		}).catch(function(err) {
			response.status(500);
			settings.output = err;
		});
	});
}

function throughGS(fpath, title, opts) {
	// http://milan.kupcevic.net/ghostscript-ps-pdf/
	// ALL OPTIONS http://ghostscript.com/doc/current/Ps2pdf.htm
	// http://ghostscript.com/doc/current/VectorDevices.htm#PDFWRITE
	// PDF/X-3 see also http://www.color.org/chardata/drsection1.xalter
	// the images quality
	// screen: 72 dpi
	// ebook: 150 dpi
	// printer: 300 dpi
	// prepress: 300 dpi, color preserving
	// default: almost identical to screen
	var quality = opts.quality;
	if (!quality) quality = "default";
	if (opts.icc) quality = "printer";
	var args = [
		"-q",
		"-dBATCH",
		"-dNOPAUSE",
		"-dSAFER",
		// "-dNOOUTERSAVE",
		// "-dCompatibilityLevel=1.4",
		// "-dFirstPage=" + opts.first,
		// "-dLastPage=" + opts.last,
		"-dNumRenderingThreads=8",
		"-dPDFSETTINGS=/" + quality,
		"-sDEVICE=pdfwrite",
		"-sOutputFile=-"
	];
	if (opts.icc) {
		var iccpath = Path.join(opts.iccdir, Path.basename(opts.icc));
		var pdfxDefPath = tempfile('.ps');
		var pdfxData = pdfxDefPs
			.replace('!ICC!', iccpath.replace(/ /g, '\ '))
			.replace('!OUPUTCONDITION!', opts.outputcondition || 'unknown')
			.replace('!OUPUTCONDITIONID!', opts.outputconditionid || 'unknown')
			.replace('!TITLE!', title);
		fs.writeFileSync(pdfxDefPath, pdfxData);

		var defaultIccPath = Path.join(opts.iccdir, 'sRGB.icc');
		args.push(
			'-dPDFX=true',
			'-dProcessColorModel=/DeviceCMYK',
			'-sDefaultRGBProfile=' + defaultIccPath,
			'-sOutputICCProfile=' + iccpath,
			pdfxDefPath
		);
	}

	args.push(fpath);

	debug("gs", args.join(" "));

	var gs = child_process.spawn('gs', args);

	gs.stderr.on('data', function(data) {
		console.error(data.toString());
	});

	return gs.stdout;
}
