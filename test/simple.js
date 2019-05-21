var expect = require('expect.js');
var express = require('express');
var got = require('got');
var Path = require('path');
var fs = require('fs');

var host = "http://localhost";
var dom = require('express-dom');
var pdf = require('..')({
	iccdir: Path.join(__dirname, 'icc')
}, {
	x3: {
		fogra39l: {
			icc: 'ISOcoated_v2_300_eci.icc',
			outputcondition: 'Commercial and specialty offset, paper type 1 and 2, gloss or matt coated paper, positive plates, tone value increase curves A (CMY) and B (K), white backing.',
			outputconditionid: 'FOGRA39L'
		}
	}
});

dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;

describe("Simple setup", function suite() {
	this.timeout(20000);
	var server, port;

	before(function(done) {
		var app = express();
		app.set('views', __dirname + '/public');
		app.get(/\.html$/, dom(pdf));
		app.get(/\.(json|js|css|png|jpg|html)$/, express.static(app.get('views')));


		server = app.listen(function(err) {
			if (err) console.error(err);
			port = server.address().port;
			done();
		});
	});

	after(function() {
		server.close();
	});


	it("should get a non-compressed pdf without gs", function() {
		return got(host + ':' + port + '/index.html?pdf')
		.then(function(res) {
			expect(res.statusCode).to.be(200);
			expect(res.body.length).to.be.greaterThan(80000);
		});
	});

	it("should get a smaller pdf with gs screen quality", function() {
		return got(host + ':' + port + '/index.html?pdf[quality]=screen')
		.then(function(res) {
			expect(res.statusCode).to.be(200);
			expect(res.body.length).to.be.lessThan(30000);
		});
	});

	it("should get a smaller pdf yet bigger than screen with gs prepress quality", function() {
		return got(host + ':' + port + '/index.html?pdf[quality]=prepress')
		.then(function(res) {
			expect(res.statusCode).to.be(200);
			expect(res.body.length).to.be.greaterThan(30000);
			expect(res.body.length).to.be.lessThan(47000);
		});
	});

	it("should get printer quality pdf with predefined icc profile", function(done) {
		got.stream(host + ':' + port + '/index.html?pdf[x3]=fogra39l')
		.pipe(fs.createWriteStream(Path.join(__dirname, 'pdf', 'test.pdf')))
		.on('finish', done);
	});

	it("should get a pdf with title as filename", function() {
		return got(host + ':' + port + '/index.html?pdf')
		.then(function(res) {
			expect(res.statusCode).to.be(200);
			expect(res.headers['content-disposition']).to.be('attachment; filename="test-title.pdf"');
			expect(res.body.length).to.be.greaterThan(80000);
		});
	});

});

