var debug = require('debug')('express-dom-pdf');
var tempfile = require('tempfile');
var fs = require('fs');

exports.plugin = function(page, settings, request, response) {
	settings['auto-load-images'] = true;
	settings.style = null;

	page.when('idle', function(cb) {
		var fpath = tempfile('.pdf');
		page.pdf(fpath, settings.pdf, function(err) {
			if (err) {
				response.status(500);
				settings.output = err;
			} else {
				response.set('Content-Type', 'application/pdf');
				settings.output = fs.createReadStream(fpath);
				settings.output.on('close', function() {
					fs.unlink(fpath, function(err) {
						if (err) console.error("Error cleaning temp file", fpath, err);
					});
				});
			}
			cb(); // always call after setting state object
		});
	});
};



exports.helper = function(settings, request, response) {
	var qu = request.query;
	if (qu.format != "pdf") return Promise.reject('route');
	delete qu.format;
	var opts = {};
	['orientation', 'paper', 'margins'].forEach(function(key) {
		if (qu[key] !== undefined) {
			opts[key] = qu[key];
			delete qu[key];
		}
	});
	settings.pdf = opts;
	settings.view = settings.location; // as simple as that :)
};

