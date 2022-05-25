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

dom.settings.verbose = true;

pdf.presets.x3 = {
	quality: 'prepress',
	scale: 4,
	icc: 'ISOcoated_v2_300_eci.icc',
	condition: 'FOGRA39L'
};


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
	this.timeout(10000);
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
		const buf = await body.arrayBuffer();
		const len = buf.length;
		assert.ok(len >= 100000);
		await assertBox(buf, 216, 279);
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
		assert.ok(buf.length >= 1500000);
		await assertBox(buf, 216, 279);
	});

});

