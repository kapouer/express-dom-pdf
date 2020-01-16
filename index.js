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

exports = module.exports = function(defaults, mappings) {
	return function(mw, settings, request, response) {
		if (request.query.pdf == null) return Promise.reject('route');
		settings.pdf = {
			defaults: defaults,
			mappings: mappings,
			params: request.query.pdf
		};
		delete request.query.pdf;
		mw.load({plugins: [module.exports.plugin]});
		// sets the view to be fetched from current request url, effectively doing a subrequest
		settings.view = settings.location;
	};
};

exports.plugin = function(page, settings, request, response) {
	Object.assign(settings, {
		'auto-load-images': true,
		style: null,
		stall: 2000,
		stallInterval: 0,
		stallTimeout: 0,
		timeout: 5000,
		runTimeout: 1000
	});

	page.when('idle', function() {
		if (response.statusCode && response.statusCode == 200) {
			settings.output = true; // take over output
		} else {
			return;
		}
		var pdf = settings.pdf || {};
		var mappings = pdf.mappings;
		var clientCb;
		if (typeof mappings == "function") {
			clientCb = mappings;
			mappings = null;
		} else {
			clientCb = function(cb) {
				cb(null, {
					title: document.title
				});
			};
		}

		return page.run(clientCb).then(function(obj) {
			if (!obj) obj = {};
			var title = obj.title || page.uri;
			delete obj.title;
			title = getSlug(title);

			var opts = Object.assign({}, pdf.defaults || {}, pdf.params || {}, obj);

			if (mappings) Object.keys(mappings).forEach(function(key) {
				if (opts[key] === undefined) return;
				Object.assign(opts, mappings[key][opts[key]] || {});
			});


			var pdfOpts = {};
			['orientation', 'paper', 'margins'].forEach(function(prop) {
				if (opts[prop] != null) pdfOpts[prop] = opts[prop];
				delete opts[prop];
			});

			var withGs = 0;

			const qualities = ['screen', 'ebook', 'prepress', 'printer'];
			// the 'default' quality means not using gs at all
			if (opts.quality && qualities.includes(opts.quality) == false) {
				delete opts.quality;
			}

			['icc', 'quality'].forEach(function(prop) {
				if (opts[prop] != null) withGs++;
			});

			var fpath = tempfile('.pdf');
			debug("getting pdf with title", title, pdfOpts);
			response.attachment(title.substring(0, 123) + '.pdf');

			return page.pdf(fpath, pdfOpts).then(function() {
				debug("pdf ready");
				if (withGs) {
					settings.output = exports.gs(fpath, title, opts);
				} else {
					settings.output = fs.createReadStream(fpath);
				}
				settings.output.once('end', function() {
					debug('done sending pdf');
					fs.unlink(fpath, function(err) {
						if (err) console.error("Error cleaning temp file", fpath, err);
					});
				});
			});
		}).catch(function(err) {
			response.status(err.statusCode || err.status || 500);
			settings.output = err;
		});
	});
};

exports.gs = function(fpath, title, opts) {
	// http://milan.kupcevic.net/ghostscript-ps-pdf/
	// ALL OPTIONS http://ghostscript.com/doc/current/Ps2pdf.htm
	// http://ghostscript.com/doc/current/VectorDevices.htm#PDFWRITE
	// PDF/X-3 see also http://www.color.org/chardata/drsection1.xalter
	// and explanations about ICC, OutputConditionIdentifier is
	// https://stackoverflow.com/questions/35705099/ghostscript-why-must-i-provide-a-pdfa-def-ps-for-pdf-a-conversion
	// the images quality
	// screen: 72 dpi
	// ebook: 150 dpi
	// printer: 300 dpi
	// prepress: 300 dpi, color preserving
	// default: almost identical to screen
	var quality = opts.quality || 'default';
	if (opts.icc) quality = "printer";
	var args = [
		"-q", // do not log to stdout
		"-sstdout=%stderr", // redirect postscript errors to stderr
		"-dBATCH",
		"-dNOPAUSE",
		"-dNOSAFER", // or else absolute paths cannot be specified
		// "-dNOOUTERSAVE",
		// "-dCompatibilityLevel=1.4",
		// "-dFirstPage=" + opts.first,
		// "-dLastPage=" + opts.last,
		"-dNumRenderingThreads=4",
		"-dPDFSETTINGS=/" + quality,
		"-sDEVICE=pdfwrite",
		"-sOutputFile=-"
	];
	if (opts.icc) {
		var iccpath = Path.join(opts.iccdir, Path.basename(opts.icc));
		var pdfxDefPath = tempfile('.ps');
		var pdfxData = pdfxDefPs
			.replace('!ICC!', escapePsString(iccpath))
			.replace('!OUPUTCONDITION!', escapePsString(opts.outputcondition || opts.icc))
			.replace('!OUPUTCONDITIONID!', escapePsString(opts.outputconditionid || 'Custom'))
			.replace('!TITLE!', escapePsString(title));
		fs.writeFileSync(pdfxDefPath, pdfxData);

		var defaultIccPath = Path.join(opts.iccdir, 'sRGB.icc');
		args.push(
			'-dPDFX=true',
			'-sColorConversionStrategy=CMYK',
			'-dProcessColorModel=/DeviceCMYK',
			'-sDefaultRGBProfile=' + defaultIccPath,
			'-sOutputICCProfile=' + iccpath,
			pdfxDefPath
		);
	}

	args.push(fpath);

	debug("gs", args.join(" "));

	var gs = child_process.spawn('gs', args);

	var errors = [];
	gs.stderr.on('data', function(data) {
		errors.push(data.toString());
	});
	gs.on('exit', function(code) {
		if (code !== 0 && errors.length) gs.stdout.emit('error', new Error(errors.join('')));
		errors.length = 0;
	});
	gs.stdout.on('end', function() {
		if (errors.length) {
			// that's a workaround for an ugly situation
			gs.stdout.emit('error', new Error(errors.join('')));
			errors.length = 0;
		}
	});

	return gs.stdout;
};

function escapePsString(str) {
	return str.replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\//g, '\\/');
}
