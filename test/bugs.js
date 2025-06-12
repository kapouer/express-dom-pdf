const express = require('express');
const assert = require('node:assert').strict;
const { once } = require('node:events');

const dom = require('express-dom');
const pdf = require('..');


const domConfig = pdf({
	policies: {
		script: "'self' 'unsafe-inline' https:"
	},
	presets: {
		printer: {
			devicePixelRatio: 4,
			pageCount: true,
			quality: 'printer'
		}
	}
});

describe("Bugs", function () {
	this.timeout(5000);
	let server, host;

	before(async () => {
		const app = express();
		app.set('views', __dirname + '/public');
		const staticMw = express.static(app.get('views'));
		app.get(/\.(json|js|css|png|jpg)$/, staticMw);
		app.get(/\.html$/, dom(domConfig).route((phase, req) => {
			const { visible, settings } = phase;
			if (visible) {
				settings.plugins.delete('pdf');
				settings.plugins.add('isitdone');
				settings.plugins.add('pdf');
				phase.handler.plugins.isitdone = (page, settings, req, res) => {
					page.on('idle', () => {
						res.on('pipe', () => {
							res.destroy();
						});
					});
				};
				settings.pdf(req.query.pdf);
			}
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
		await dom?.destroy();
	});

	it("handles response closed prematurely", async () => {
		await assert.rejects(async () => {
			const res = await fetch(`${host}/index.html?pdf=printer`);
			if (res.statusCode) {
				throw new Error("Could not abort");
			}
		}, {
			name: 'TypeError',
			message: 'fetch failed',
		});
		let unhandled = false;
		await new Promise(resolve => {
			process.on("unhandledRejection", () => unhandled = true);
			setTimeout(resolve, 1500);
		});
		assert.ok(!unhandled);
	});

});
