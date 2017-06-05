var expect = require('expect.js');
var express = require('express');
var request = require('request');

var host = "http://localhost";
var dom = require('express-dom');
var pdf = require('..')();

dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;

describe("Simple setup", function suite() {
	this.timeout(10000);
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

	after(function(done) {
		server.close();
		done();
	});


	it("should get a non-compressed pdf without gs", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/index.html?pdf'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.length).to.be.greaterThan(80000);
			done();
		});
	});

	it("should get a smaller pdf with gs screen quality", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/index.html?pdf[quality]=screen'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.length).to.be.lessThan(30000);
			done();
		});
	});

	it("should get a smaller pdf yet bigger than screen with gs prepress quality", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/index.html?pdf[quality]=prepress'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(body.length).to.be.greaterThan(30000);
			expect(body.length).to.be.lessThan(40000);
			done();
		});
	});

	it("should get a pdf with title as filename", function(done) {
		request({
			method: 'GET',
			url: host + ':' + port + '/index.html?pdf'
		}, function(err, res, body) {
			expect(res.statusCode).to.be(200);
			expect(res.headers['content-disposition']).to.be('attachment; filename="test-title.pdf"');
			expect(body.length).to.be.greaterThan(80000);
			done();
		});
	});

});

