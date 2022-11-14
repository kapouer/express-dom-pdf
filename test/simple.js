const express = require('express');
const assert = require('node:assert').strict;
const { once } = require('node:events');
const { request } = require('undici');
const { promisify } = require('util');
const exec = promisify(require('node:child_process').exec);
const tempfile = require('tempfile');

const dom = require('express-dom');
const pdf = require('..');
const { unlink, writeFile } = require('node:fs/promises');

dom.defaults.console = true;
dom.debug = require('node:inspector').url() !== undefined;


async function getBox(pdfFile) {
	const bbox = await exec(`gs -dQUIET -dNOSAFER -dBATCH -sFileName=${pdfFile} -c "FileName (r) file runpdfbegin 1 1 pdfpagecount {pdfgetpage /MediaBox get {=print ( ) print} forall (\n) print} for quit"`);
	const [x, y, w, h] = bbox.stdout.trim().split(' ').map(x => Math.round(x * 0.35277778));
	return { x, y, w, h };
}

async function assertBox(buf, width, height) {
	const pdfFile = tempfile(".pdf");
	await writeFile(pdfFile, buf);
	try {
		const { w, h } = await getBox(pdfFile);
		assert.equal(w, width, "bad paper width");
		assert.equal(h, height, "bad paper height");
	} finally {
		await unlink(pdfFile);
	}
}

describe("Simple setup", function () {
	this.timeout(15000);
	let server, host;

	before(async () => {
		const app = express();
		app.set('views', __dirname + '/public');
		const staticMw = express.static(app.get('views'));
		app.get(/\.(json|js|css|png|jpg)$/, staticMw);
		app.get(/\.html$/, dom(pdf({
			policies: {
				script: "'self' 'unsafe-inline' https:"
			},
			presets: {
				low: {
					quality: 'screen',
					scale: 1,
					others: [
						"-dColorImageResolution=32"
					]
				},
				x3: {
					quality: 'prepress',
					scale: 4,
					icc: 'ISOcoated_v2_300_eci.icc',
					condition: 'FOGRA39L'
				}
			}
		})).route((phase, req) => {
			phase.settings.pdf(req.query.pdf);
		}), staticMw, (err, req, res, next) => {
			res.status(err.statusCode ?? 500);
			res.send(err.message);
		});

		server = app.listen();
		await once(server, 'listening');
		host = `http://localhost:${server.address().port}`;
	});

	after(async () => {
		server.close();
		await dom.destroy();
	});

	it("gets pdf without gs", async () => {
		const { statusCode, body, headers } = await request(`${host}/index.html`);
		assert.equal(statusCode, 200);
		assert.equal(
			headers['content-disposition'],
			'attachment; filename="test-title.pdf"'
		);
		const buf = await body.arrayBuffer();
		const len = buf.length;
		assert.ok(len >= 100000);
		await assertBox(buf, 216, 279);
	});

	it("sets page size from css", async () => {
		const { statusCode, body } = await request(`${host}/page.html?size=a4`);
		assert.equal(statusCode, 200);
		const buf = await body.arrayBuffer();
		await assertBox(buf, 210, 297);
	});

	it("sets page orientation from css", async () => {
		const { statusCode, body } = await request(`${host}/page.html?size=a4&orientation=landscape`);
		assert.equal(statusCode, 200);
		const buf = await body.arrayBuffer();
		await assertBox(buf, 297, 210);
	});

	it("rejects bad preset value", async () => {
		const { statusCode, body } = await request(`${host}/page.html?pdf=toto`);
		assert.equal(statusCode, 400);
		assert.equal(await body.text(), "Unknown preset: toto");
	});

	it("compresses pdf with gs screen quality", async () => {
		const {
			statusCode, body
		} = await request(`${host}/index.html?pdf=screen`);
		assert.equal(statusCode, 200);
		const buf = await body.arrayBuffer();
		const len = buf.length;
		assert.ok(len <= 45000);
		await assertBox(buf, 216, 279);
	});

	it("compresses high-quality pdf with prepress quality", async () => {
		const {
			statusCode, body
		} = await request(`${host}/index.html?pdf=prepress`);
		assert.equal(statusCode, 200);
		const buf = await body.arrayBuffer();
		assert.ok(buf.length <= 65000);
		assert.ok(buf.length >= 55000);
		await assertBox(buf, 216, 279);
	});

	it("get a pdf x3 pdf with predefined icc profile", async () => {
		const {
			statusCode, body
		} = await request(`${host}/index.html?pdf=x3`);
		assert.equal(statusCode, 200);
		const buf = await body.arrayBuffer();
		assert.ok(buf.length >= 2000000);
		await assertBox(buf, 216, 279);
	});

	it("get a preset with very low color resolution", async () => {
		const {
			statusCode, body
		} = await request(`${host}/index.html?pdf=low`);
		assert.equal(statusCode, 200);
		const buf = await body.arrayBuffer();
		assert.ok(buf.length < 31000);
		await assertBox(buf, 216, 279);
	});

});

