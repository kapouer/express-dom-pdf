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
		assert.equal(w, width, `bad paper width ${w}`);
		assert.equal(h, height, `bad paper height ${h}`);
	} finally {
		await unlink(pdfFile);
	}
}

describe("Autobreak", function () {
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
			autobreak: true,
			presets: {
				x3: {
					quality: 'prepress',
					scale: 4,
					icc: 'ISOcoated_v2_300_eci.icc',
					condition: 'FOGRA39L'
				}
			}
		})), staticMw, (err, req, res, next) => {
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

	it("test", async () => {
		const { statusCode, body, headers } = await request(`${host}/autobreak.html`);
		assert.equal(statusCode, 200);
		assert.equal(
			headers['content-disposition'],
			'attachment; filename="autobreak.pdf"'
		);
		const buf = await body.arrayBuffer();
		await require('node:fs/promises').writeFile('autobreak.pdf', buf);
		await assertBox(buf, 210, 297);
	});

});

