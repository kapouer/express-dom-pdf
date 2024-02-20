const express = require('express');
const assert = require('node:assert').strict;
const { once } = require('node:events');
const { promisify } = require('util');
const exec = promisify(require('node:child_process').exec);
const tempfile = require('tempfile');

const dom = require('express-dom');
const pdf = require('..');

const { arrayBuffer } = require('node:stream/consumers');
const { createWriteStream } = require('node:fs');
const { unlink, writeFile, readFile } = require('node:fs/promises');

dom.defaults.console = true;
dom.debug = require('node:inspector').url() !== undefined;


async function getBox(pdfFile) {
	const task = await exec(`gs -dQUIET -dNOPAUSE -dNODISPLAY -dNOSAFER -dBATCH -sFileName=${pdfFile} -c "FileName (r) file runpdfbegin 1 1 pdfpagecount {pdfgetpage /MediaBox get {=print ( ) print} forall (\n) print} for quit"`);
	const [x, y, w, h] = task.stdout.trim().split(' ').map(x => Math.round(x * 0.35277778));
	return { x, y, w, h };
}

async function getText(pdfFile) {
	const task = await exec(`gs -sDEVICE=txtwrite -sOutputFile=- -sFONTPATH=/usr/share/fonts -dQUIET -dNOPAUSE -dNOSAFER -dBATCH ${pdfFile}`);
	return task.stdout.trim();
}

async function assertText(buf, text) {
	const pdfFile = tempfile(".pdf");
	await writeFile(pdfFile, Buffer.from(buf));
	try {
		const output = await getText(pdfFile);
		assert.equal(output, text);
	} finally {
		await unlink(pdfFile);
	}
}

async function assertBox(buf, width, height) {
	const pdfFile = tempfile(".pdf");
	await writeFile(pdfFile, Buffer.from(buf));
	try {
		const { w, h } = await getBox(pdfFile);
		assert.equal(w, width, "bad paper width");
		assert.equal(h, height, "bad paper height");
	} finally {
		await unlink(pdfFile);
	}
}


const domConfig = pdf({
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
		gradient: {
			scale: 1,
			quality: 'printer'
		},
		prepress: {
			scale: 4,
			pageCount: true,
			quality: 'prepress'
		},
		x3: {
			quality: 'prepress',
			scale: 4,
			pageCount: true,
			icc: 'ISOcoated_v2_300_eci.icc',
			condition: 'FOGRA39L'
		}
	}
});

describe("Simple setup", function () {
	this.timeout(15000);
	let server, host;

	before(async () => {
		const app = express();
		app.set('views', __dirname + '/public');
		const staticMw = express.static(app.get('views'));
		app.get(/\.(json|js|css|png|jpg)$/, staticMw);
		app.get(/\.html$/, dom(domConfig).route(({ visible, settings }, req) => {
			if (visible) settings.pdf(req.query.pdf);
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
		const res = await fetch(`${host}/index.html`);
		assert.equal(res.status, 200);
		assert.equal(
			res.headers.get('content-disposition'),
			'attachment; filename="test title1.pdf"'
		);
		assert.ok(!res.headers.has('x-page-count'));
		const buf = await res.arrayBuffer();
		const len = buf.byteLength;
		assert.ok(len >= 100000);
		await assertBox(buf, 216, 279);
	});

	it("gets pdf without gs manually", async () => {
		// in that case, we want to stream directly to a file
		const res = await dom(domConfig)({
			url: host + '/toto.html',
			body: await readFile(__dirname + '/public/index.html'),
		});
		assert.equal(res.statusCode, 200);
		assert.equal(
			res.get('Content-Disposition'),
			'attachment; filename="test title1.pdf"'
		);
		const buf = await arrayBuffer(res);
		const len = buf.byteLength;
		assert.ok(len >= 100000);
		await assertBox(buf, 216, 279);
	});

	it("sets page size from css", async () => {
		const res = await fetch(`${host}/page.html?size=a4`);
		assert.equal(res.status, 200);
		const buf = await res.arrayBuffer();
		await assertBox(buf, 210, 297);
	});

	it("sets page orientation from css", async () => {
		const res = await fetch(`${host}/page.html?size=a4&orientation=landscape`);
		assert.equal(res.status, 200);
		assert.ok(!res.headers.has('x-page-count'));
		await assertBox(await res.arrayBuffer(), 297, 210);
	});

	it("rejects bad preset value", async () => {
		const res = await fetch(`${host}/page.html?pdf=toto`);
		assert.equal(res.status, 400);
		assert.equal(await res.text(), "Unknown preset: toto");
	});

	it("compresses pdf with gs screen quality", async () => {
		const res = await fetch(`${host}/index.html?pdf=screen`);
		assert.equal(res.status, 200);
		const buf = await res.arrayBuffer();
		const len = buf.byteLength;
		assert.ok(len <= 45000);
		await assertBox(buf, 216, 279);
	});

	it("compresses high-quality pdf with prepress quality", async () => {
		const res = await fetch(`${host}/index.html?pdf=prepress`);
		assert.equal(res.status, 200);
		assert.equal(
			res.headers.get('x-page-count'),
			'1'
		);
		const buf = await res.arrayBuffer();
		assert.ok(buf.byteLength <= 90000);
		assert.ok(buf.byteLength >= 75000);
		await assertBox(buf, 216, 279);
	});

	it("get a pdf x3 pdf with predefined icc profile", async () => {
		const res = await fetch(`${host}/index.html?pdf=x3`);
		assert.equal(res.status, 200);
		assert.equal(
			res.headers.get('content-disposition'),
			'attachment; filename="test title4.pdf"'
		);
		assert.equal(
			res.headers.get('x-page-count'),
			'1'
		);
		const buf = await res.arrayBuffer();
		assert.ok(buf.byteLength >= 2000000);
		await assertBox(buf, 216, 279);
	});

	it("get a preset with very low color resolution", async () => {
		const res = await fetch(`${host}/index.html?pdf=low`);
		assert.equal(res.status, 200);
		assert.ok(!res.headers.has('x-page-count'));
		const buf = await res.arrayBuffer();
		assert.ok(buf.byteLength < 31100);
		await assertBox(buf, 216, 279);
	});

	it("renders text with unicode emojis (experimental not trustworthy)", async () => {
		const res = await fetch(`${host}/unicode.html?pdf=low`);
		assert.equal(res.status, 200);
		const buf = await res.arrayBuffer();
		await assertText(buf, 'ATA\x84\x83\x86\x8B\x81');
	});

	it("renders correctly gradients with ghostscript", async () => {
		const res = await fetch(`${host}/gradient.html?pdf=gradient`);
		assert.equal(res.status, 200);
		const buf = await res.arrayBuffer();
		assert.ok(
			buf.byteLength > 80000,
			"unconverted gradient takes less bytes"
		);
	});
});
