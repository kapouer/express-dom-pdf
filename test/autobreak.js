const express = require("express");
const assert = require("node:assert").strict;
const { once } = require("node:events");
const { request } = require("undici");
const { promisify } = require("util");
const exec = promisify(require("node:child_process").exec);
const tempfile = require("tempfile");
const fs = require("node:fs/promises");

const dom = require("express-dom");
const pdf = require("..");
const { unlink, writeFile } = require("node:fs/promises");

dom.defaults.log = true;

async function getPages(pdfFile) {
	const cmd = await exec(
		`gs -dQUIET -dNODISPLAY -dNOSAFER -dBATCH -sFileName=${pdfFile} -c "FileName (r) file runpdfbegin 1 1 pdfpagecount = quit"`
	);
	return parseInt(cmd.stdout.trim());
}

async function assertPages(buf, count) {
	const pdfFile = tempfile(".pdf");
	await writeFile(pdfFile, buf);
	try {
		assert.equal(await getPages(pdfFile), count);
	} finally {
		await unlink(pdfFile);
	}
}

describe("Autobreak", function () {
	let server, host;

	before(async () => {
		const app = express();
		dom.debug = require("node:inspector").url() !== undefined;
		dom.debug = false;
		app.set("views", __dirname + "/public");
		const staticMw = express.static(app.get("views"));
		app.get(/\.(json|js|css|png|jpg)$/, staticMw);
		app.get(
			"/autobreak.html",
			dom.debug
				? (req, res, next) => next()
				: dom(
					pdf({
						policies: {
							script: "'self' 'unsafe-inline' https:",
						},
						presets: {
							x3: {
								quality: "prepress",
								scale: 4,
								icc: "ISOcoated_v2_300_eci.icc",
								condition: "FOGRA39L",
							},
						},
					}),
				),
			staticMw,
			(err, req, res, next) => {
				console.error(err);
				res.status(err.statusCode ?? 500);
				res.send(err.message);
			},
		);

		app.get(
			"/autobreak-leaf.html",
			dom.debug
				? (req, res, next) => next()
				: dom(
					pdf({
						policies: {
							script: "'self' 'unsafe-inline' https:",
						},
						presets: {
							x3: {
								quality: "prepress",
								scale: 4,
								icc: "ISOcoated_v2_300_eci.icc",
								condition: "FOGRA39L",
							},
						},
					}),
				),
			staticMw,
			(err, req, res, next) => {
				res.status(err.statusCode ?? 500);
				res.send(err.message);
			},
		);

		server = app.listen();
		await once(server, "listening");
		host = `http://localhost:${server.address().port}`;
	});

	after(async () => {
		server.close();
		await dom.destroy();
	});

	it("breaks into eight pages", async () => {
		this.timeout(dom.debug ? 0 : 15000);
		if (dom.debug) {
			console.info(`${host}/autobreak.html`);
			return new Promise((resolve) => {});
		}

		const { statusCode, body, headers } = await request(
			`${host}/autobreak.html`,
		);
		assert.equal(statusCode, 200);
		assert.equal(
			headers["content-disposition"],
			'attachment; filename="autobreak.pdf"',
		);
		const buf = await body.arrayBuffer();
		await assertPages(buf, 8);
	});

	it("does not break the unbreakable", async function () {
		this.timeout(dom.debug ? 0 : 15000);
		if (dom.debug) {
			console.info(`${host}/autobreak-leaf.html`);
			return new Promise((resolve) => {});
		}

		const { statusCode, body, headers } = await request(
			`${host}/autobreak-leaf.html`,
		);
		assert.equal(statusCode, 200);
		assert.equal(
			headers["content-disposition"],
			'attachment; filename="autobreak-leaf.pdf"',
		);
		const buf = await body.arrayBuffer();
		// await fs.writeFile('./autobreak.pdf', buf);
		await assertPages(buf, 2);
	});
});
