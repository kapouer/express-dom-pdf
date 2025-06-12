const express = require('express');
const assert = require('node:assert').strict;
const { once } = require('node:events');
const { promisify } = require('util');
const exec = promisify(require('node:child_process').exec);

const dom = require('express-dom');
const pdf = require('..');

const { arrayBuffer } = require('node:stream/consumers');
const { unlink, writeFile, readFile } = require('node:fs/promises');
const tmp = require('tmp');

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
	const pdfFile = tmp.tmpNameSync({ postfix: 'test.pdf' });
	await writeFile(pdfFile, Buffer.from(buf));
	try {
		const output = await getText(pdfFile);
		assert.equal(output, text);
	} finally {
		await unlink(pdfFile);
	}
}

async function assertBox(buf, width, height) {
	const pdfFile = tmp.tmpNameSync({ postfix: 'test.pdf' });
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
			devicePixelRatio: 1,
			format: 'a4',
			others: [
				"-dColorImageResolution=32"
			]
		},
		prepress: {
			devicePixelRatio: 4,
			pageCount: true,
			quality: 'prepress',
			format: 'a4'
		},
		x3: {
			quality: 'prepress',
			devicePixelRatio: 4,
			pageCount: true,
			pdfx: true,
			icc: 'colord/FOGRA39L_coated.icc',
			condition: 'FOGRA39L',
			format: 'a4'
		},
		a2: {
			quality: 'prepress',
			devicePixelRatio: 4,
			pageCount: true,
			pdfa: true,
			format: 'a4'
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
			if (visible) {
				settings.browser = req.query.browser;
				settings.pdf(req.query.pdf);
			}
		}), staticMw, (err, req, res, next) => {
			console.error(err);
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
			'attachment; filename="Test écrit1.pdf"'
		);
		assert.ok(!res.headers.has('x-page-count'));
		const buf = await res.arrayBuffer();
		const len = buf.byteLength;
		assert.ok(len >= 100000);
		await assertBox(buf, 210, 297);
	});

	it("gets pdf without gs on firefox", async () => {
		const res = await fetch(`${host}/index.html?browser=firefox`);
		assert.equal(res.status, 200);
		assert.equal(
			res.headers.get('content-disposition'),
			'attachment; filename="Test écrit1.pdf"'
		);
		assert.ok(!res.headers.has('x-page-count'));
		const buf = await res.arrayBuffer();
		const len = buf.byteLength;
		assert.ok(len >= 100000);
		await assertBox(buf, 210, 297);
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
			'attachment; filename="Test écrit1.pdf"'
		);
		const buf = await arrayBuffer(res);
		const len = buf.byteLength;
		assert.ok(len >= 100000);
		await assertBox(buf, 210, 297);
	});

	it("sets page size from css", async () => {
		const res = await fetch(`${host}/page.html?size=a4&browser=firefox`);
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
		assert.ok(len <= 46000);
		await assertBox(buf, 210, 297);
	});

	it("compresses high-quality pdf with prepress quality", async () => {
		const res = await fetch(`${host}/index.html?pdf=prepress`);
		assert.equal(res.status, 200);
		assert.equal(
			res.headers.get('x-page-count'),
			'1'
		);
		const buf = await res.arrayBuffer();
		assert.ok(buf.byteLength <= 60000);
		assert.ok(buf.byteLength >= 50000);
		await assertBox(buf, 210, 297);
	});

	it("get a pdf/x3 with predefined icc profile", async () => {
		const res = await fetch(`${host}/index.html?pdf=x3`);
		assert.equal(res.status, 200);
		assert.equal(
			res.headers.get('content-disposition'),
			'attachment; filename="Test écrit4.pdf"',
			'Check devicePixelRatio to be 4'
		);
		assert.equal(
			res.headers.get('x-page-count'),
			'1'
		);
		const buf = await res.arrayBuffer();
		await assertBox(buf, 210, 297);
		assert.ok(buf.byteLength >= 440000);
	});

	it("get a pdf/a2 with chrome", async () => {
		const res = await fetch(`${host}/index.html?pdf=a2`);
		assert.equal(res.status, 200);
		assert.equal(
			res.headers.get('content-disposition'),
			'attachment; filename="Test écrit4.pdf"'
		);

		const buf = await res.arrayBuffer();
		await assertBox(buf, 210, 297);
		assert.equal(
			res.headers.get('x-page-count'),
			'1',
			'page count should be one'
		);
		assert.ok(buf.byteLength >= 50000);
		assert.ok(buf.byteLength < 63000);
	});

	it("get a pdf/a2 with firefox", async () => {
		const res = await fetch(`${host}/index.html?pdf=a2&browser=firefox`);
		assert.equal(res.status, 200);
		assert.equal(
			res.headers.get('content-disposition'),
			'attachment; filename="Test écrit4.pdf"'
		);

		const buf = await res.arrayBuffer();
		await assertBox(buf, 210, 297);
		assert.equal(
			res.headers.get('x-page-count'),
			'1',
			'page count should be one'
		);
		assert.ok(buf.byteLength >= 50000);
		assert.ok(buf.byteLength < 63000);
	});

	it("get a preset with very low color resolution", async () => {
		const res = await fetch(`${host}/index.html?pdf=low`);
		assert.equal(res.status, 200);
		const buf = await res.arrayBuffer();
		assert.ok(buf.byteLength < 36000);
		await assertBox(buf, 210, 297);
	});

	it("renders text with unicode emojis (experimental not trustworthy)", async () => {
		const res = await fetch(`${host}/unicode.html?pdf=low`);
		assert.equal(res.status, 200);
		const buf = await res.arrayBuffer();
		await assertText(buf, 'ATA\x84\x83\x86\x8B\x81');
	});

	it("renders correctly gradients with ghostscript", async () => {
		const res = await fetch(`${host}/gradient.html?pdf=x3`);
		assert.equal(res.status, 200);
		const buf = await res.arrayBuffer();
		assert.ok(
			buf.byteLength > 80000,
			"unconverted gradient takes less bytes"
		);
	});
});
