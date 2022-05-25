const express = require('express');
const assert = require('node:assert').strict;
const { once } = require('node:events');
const { request } = require('undici');

const dom = require('express-dom');
const pdf = require('..');

dom.settings.verbose = true;

pdf.presets.x3 = {
	quality: 'prepress',
	scale: 4,
	icc: 'ISOcoated_v2_300_eci.icc',
	condition: 'FOGRA39L'
};

describe("Simple setup", () => {
	let server, host;

	before(async () => {
		const app = express();
		app.set('views', __dirname + '/public');
		app.get(/\.(json|js|css|png|jpg)$/, express.static(app.get('views')));
		app.get(/\.html$/, dom('pdf').load());

		server = app.listen();
		await once(server, 'listening');
		host = `http://localhost:${server.address().port}`;
	});

	after(async () => {
		server.close();
		await dom.destroy();
	});

	it("gets pdf without gs", async () => {
		const { statusCode, body, headers } = await request(`${host}/index.html?pdf`);
		assert.equal(statusCode, 200);
		assert.equal(
			headers['content-disposition'],
			'attachment; filename="test-title.pdf"'
		);
		const len = (await body.arrayBuffer()).length;
		assert.ok(len >= 100000);
	});

	it("compresses pdf with gs screen quality", async () => {
		const {
			statusCode, body
		} = await request(`${host}/index.html?pdf=screen`);
		assert.equal(statusCode, 200);
		const len = (await body.arrayBuffer()).length;
		assert.ok(len <= 45000);
	});

	it("compresses high-quality pdf with prepress quality", async () => {
		const {
			statusCode, body
		} = await request(`${host}/index.html?pdf=prepress`);
		assert.equal(statusCode, 200);
		const buf = await body.arrayBuffer();
		await require('fs/promises').writeFile('test.pdf', buf);
		assert.ok(buf.length <= 65000);
		assert.ok(buf.length >= 55000);
	});

	it("get a pdf x3 pdf with predefined icc profile", async () => {
		const {
			statusCode,
			// body // TODO check pdf format
		} = await request(`${host}/index.html?pdf=x3`);
		assert.equal(statusCode, 200);
	});

});

