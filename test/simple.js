const express = require('express');
const assert = require('node:assert').strict;
const { once } = require('node:events');
const Path = require('node:path');
const { request } = require('undici');

const dom = require('express-dom');
const pdf = require('..')(dom);
pdf.defaults.iccdir = Path.join(__dirname, 'icc');
pdf.mappings = {
	x3: {
		fogra39l: {
			icc: 'ISOcoated_v2_300_eci.icc',
			outputcondition: 'Commercial and specialty offset, paper type 1 and 2, gloss or matt coated paper, positive plates, tone value increase curves A (CMY) and B (K), white backing.',
			outputconditionid: 'FOGRA39L'
		}
	}
};

dom.settings.stall = 5000;
dom.settings.allow = 'all';
dom.settings.timeout = 10000;
dom.settings.console = true;

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
		} = await request(`${host}/index.html?pdf[quality]=screen&pdf[paper]=a4`);
		assert.equal(statusCode, 200);
		const len = (await body.arrayBuffer()).length;
		assert.ok(len <= 45000);
	});

	it("compresses high-quality pdf with prepress quality", async () => {
		const {
			statusCode, body
		} = await request(`${host}/index.html?pdf[quality]=prepress`);
		assert.equal(statusCode, 200);
		const len = (await body.arrayBuffer()).length;
		assert.ok(len <= 65000);
		assert.ok(len >= 55000);
	});

	it("get a pdf x3 pdf with predefined icc profile", async () => {
		const {
			statusCode,
			// body // TODO check pdf format
		} = await request(`${host}/index.html?pdf[x3]=fogra39l`);
		assert.equal(statusCode, 200);
	});

});

