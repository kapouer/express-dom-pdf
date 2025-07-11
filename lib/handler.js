const debug = require('debug')('express-dom-pdf');
const {
	promises: fs,
	createReadStream
} = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { cpus } = require('node:os');
const util = require('node:util');
const exec = util.promisify(require('node:child_process').exec);
const tmp = require('tmp');

const Path = require('node:path');

module.exports = class PdfHandler {
	static timeout = 30000;
	static pdfxDef = Path.join(__dirname, '..', 'PDFX_def.ps');
	static pdfaDef = Path.join(__dirname, '..', 'PDFA_def.ps');
	static iccdir = '/usr/share/color/icc';
	static plugins = new Set(['console']);
	static presets = {
		default: {
			quality: false,
			devicePixelRatio: 1,
			format: 'A4',
			distiller: {
				PreserveAnnots: true,
				DetectDuplicateImages: false
			}
		},
		screen: {
			quality: 'screen',
			devicePixelRatio: 1,
			format: 'A4',
			distiller: {
				PreserveAnnots: true,
				DetectDuplicateImages: false
			}
		},
		ebook: {
			quality: 'ebook',
			devicePixelRatio: 2,
			format: 'A4',
			distiller: {
				PreserveAnnots: true,
				DetectDuplicateImages: false
			}
		},
		printer: {
			pageCount: true,
			quality: 'printer',
			devicePixelRatio: 4,
			format: 'A4',
			distiller: {
				PreserveAnnots: false,
				DetectDuplicateImages: false,
				MaxInlineImageSize: 0
			}
		},
		prepress: {
			quality: 'prepress',
			devicePixelRatio: 4,
			format: 'A4',
			distiller: {
				PreserveAnnots: false,
				DetectDuplicateImages: false,
				MaxInlineImageSize: 0
			}
		}
	};
	static policies = {
		script: "'self' https:",
		connect: "'self' https:",
		img: "'self' https: data:",
		font: "'self' https: data:",
		style: "'self' 'unsafe-inline' https:"
	};

	#settings;
	#threads;
	#parallel;

	constructor(opts) {
		const policies = Object.assign({}, PdfHandler.policies, opts.policies);
		const presets = Object.assign({}, PdfHandler.presets, opts.presets);
		this.#settings = Object.assign({}, PdfHandler, opts, { policies, presets });
		this.chain = handler => this.#init(handler);
		this.#parallel = opts.parallel ?? 1;
		this.#threads = Math.min(4, Math.max(cpus().length - 1, 1));
	}

	#init(handler) {
		const { online, plugins } = handler;
		plugins.pdf = (...args) => this.plugin(...args);

		const {
			timeout, policies, plugins: userPlugins, presets
		} = this.#settings;

		if (userPlugins) for (const name of userPlugins) {
			online.plugins.add(name);
		}
		online.plugins.delete('html');
		online.plugins.add('pdf');
		online.hidden = false;
		online.timeout = timeout;

		online.pdf = function (name) {
			this.preset = name;
			const preset = presets[name];
			if (!preset) return;
			if (preset.devicePixelRatio) this.devicePixelRatio = preset.devicePixelRatio;
			if (preset.browser) this.browser = preset.browser;
		};
		Object.assign(online.policies, policies);
	}

	plugin(page, settings, req, res) {
		const { presets } = this.#settings;
		const preset = presets[settings.preset ?? 'default'];
		if (!preset) {
			const err = new Error("Unknown preset: " + settings.preset);
			err.statusCode = 400;
			throw err;
		}
		if (preset.quality && ["screen", "ebook", "printer", "prepress"].includes(preset.quality) == false) {
			console.warn("Uknown pdf preset quality", preset.quality);
			delete preset.quality;
		}

		settings.styles.push(`html {
			-webkit-print-color-adjust: exact !important;
			print-color-adjust: exact !important;
		}`);

		if (preset.browser) settings.browser = preset.browser;

		if (preset.pdfa && settings.browser == "firefox") {
			settings.styles.push(`* {
				image-rendering: crisp-edges !important;
			}`);
		}

		page.on('request', request => {
			const headers = request.headers();
			if (headers['accept']?.startsWith('image/')) {
				return request.continue({
					headers: {
						...headers,
						accept: 'image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5'
					}
				});
			}
		});

		page.on('idle', async () => {
			if (res.statusCode != 200) {
				const err = new Error(res.statusText);
				err.statusCode = res.statusCode;
				throw err;
			}
			await page.evaluate(async () => {
				if (document.fonts.status == "loaded") return;
				let resolver;
				const abort = new Promise((resolve, reject) => {
					const toId = setTimeout(() => {
						const err = new Error("Fonts timeout");
						err.statusCode = 500;
						reject(err);
					}, 10000);
					resolver = function () {
						clearTimeout(toId);
						resolve();
					};
				});
				await Promise.all([document.fonts.ready.finally(resolver), abort]);
			});

			const outputPath = tmp.tmpNameSync({ postfix: 'browser.pdf' });

			await page.pdf({
				preferCSSPageSize: true,
				printBackground: true,
				path: outputPath,
				format: preset.format,
				timeout: this.#settings.timeout
			});

			const title = await page.title() || Path.basename(
				page.location.pathname, Path.extname(page.location.pathname)
			);

			debug("getting pdf", title, outputPath);
			const pageCount = preset.pageCount || preset.quality && this.#parallel > 1
				? await this.#pageCount(outputPath)
				: null;
			if (pageCount) {
				res.set('X-Page-Count', pageCount);
			}
			res.attachment(title.substring(0, 123) + '.pdf');
			res.type('application/pdf');

			if (preset.quality) {
				await this.#ghostscript(title, outputPath, preset, pageCount);
			}
			const stream = createReadStream(outputPath);

			// cannot await output during idle event
			pipeline(stream, res).catch(err => {
				if (err.code != 'ERR_STREAM_PREMATURE_CLOSE') {
					console.error(err);
				}
			}).finally(() => {
				fs.unlink(outputPath);
			});
		});
	}

	async #pageCount(path) {
		const cmd = `gs -dQUIET -dNODISPLAY -dNOSAFER -dBATCH -sFileName='${path}' -c "FileName (r) file runpdfbegin 1 1 pdfpagecount = quit"`;
		const { stdout, stderr } = await exec(cmd);
		if (stderr) throw new Error("Cannot spawn ghostscript command: 'gs' or bad path");
		const n = parseInt(stdout.trim());
		if (Number.isNaN(n)) throw new Error("Could not get page count");
		return n;
	}

	async #ghostscript(title, inputPath, preset, pageCount) {
		const { pdfxDef, pdfaDef, iccdir } = this.#settings;
		const {
			quality,
			icc = 'ghostscript/default_rgb.icc',
			condition = '',
			pdfx, pdfa,
			distiller = {},
			others = []
		} = preset;
		// http://milan.kupcevic.net/ghostscript-ps-pdf/
		// ALL OPTIONS http://ghostscript.com/doc/current/Ps2pdf.htm
		// http://ghostscript.com/doc/current/VectorDevices.htm#PDFWRITE
		// the images quality
		// screen: 72 dpi
		// ebook: 150 dpi
		// printer: 300 dpi
		// prepress: 300 dpi, color preserving
		const isForScreen = ["screen", "ebook"].includes(quality);
		const args = [
			"gs",
			"-q", // do not log to stdout
			"-sstdout=%stderr", // redirect postscript errors to stderr
			"-dBATCH",
			"-dNOPAUSE",
			"-dNumRenderingThreads=" + this.#threads,
			"-dPDFSETTINGS=/" + quality,
			"-sDEVICE=pdfwrite"
		];
		for (const [key, str] of Object.entries(distiller)) {
			args.push(`-d${key}=${str}`);
		}

		for (const arg of others) {
			if (arg) args.push(arg);
		}
		const temps = [];
		const args2 = [];
		const iccPath = Path.join(iccdir, icc);
		if (!iccPath.startsWith(iccdir)) {
			throw new Error("Forbidden icc path: " + icc);
		}
		// TODO this part, and the next one (setting title)
		// should be done when regrouping the files
		if (pdfx) {
			const pdfxDefPath = tmp.tmpNameSync({ postfix: 'pdfx.ps' });
			if (iccPath) args.push('--permit-file-read=' + iccPath);
			const pdfxData = (await fs.readFile(pdfxDef)).toString()
				.replace('!ICC!', escapePsString(iccPath))
				.replace('!CONDITION!', escapePsString(condition))
				.replace('!TITLE!', escapePsString(title));
			await fs.writeFile(pdfxDefPath, pdfxData);
			temps.push(pdfxDefPath);
			args.push('-sColorConversionStrategy=CMYK');
			args2.push(
				'-dPDFX=true',
				'-dRenderIntent=3',
				pdfxDefPath
			);
		} else if (pdfa) {
			const pdfaDefPath = tmp.tmpNameSync({ postfix: 'pdfa.ps' });
			if (iccPath) args.push('--permit-file-read=' + iccPath);
			const pdfaData = (await fs.readFile(pdfaDef)).toString()
				.replace('!ICC!', escapePsString(iccPath))
				.replace('!CONDITION!', escapePsString(condition))
				.replace('!TITLE!', escapePsString(title));
			await fs.writeFile(pdfaDefPath, pdfaData);
			temps.push(pdfaDefPath);
			args.push('-sColorConversionStrategy=RGB');
			args2.push(
				'-dPDFA=2',
				'-dPDFACompatibilityPolicy=1',
				'-dRenderIntent=3',
				pdfaDefPath
			);
		} else if (!isForScreen) {
			args.push('-sColorConversionStrategy=RGB');
		}
		// set title
		args2.push(
			"-c",
			`"[ /Title (${escapePsString(title)}) /DOCINFO pdfmark"`,
			"-c",
			`50000000 setvmthreshold`,
			"-f"
		);
		debug("gs", args);
		const outParts = Path.parse(inputPath);
		delete outParts.base;
		outParts.name += "-%d";
		const outputPattern = Path.format(outParts);
		const inputs = [];
		if (this.#parallel > 1) {
			const { stderr } = await exec(`pdfseparate "${inputPath}" "${outputPattern}"`);
			if (stderr) throw new Error(stderr);

			const files = [];
			const subCount = Math.ceil(pageCount / this.#parallel);
			let startPage = 0;
			let lastPage = subCount;
			do {
				const outputFile = tmp.tmpNameSync({ postfix: 'out.pdf' });
				for (let i = startPage; i < Math.min(lastPage, pageCount); i++) {
					inputs.push(util.format(outputPattern, i + 1));
				}
				files.push(this.#processFiles(
					args, args2, inputs, outputFile
				));
				startPage = lastPage;
				lastPage += subCount;
			} while (startPage < pageCount);

			try {
				return this.#groupFiles(await Promise.all(files), inputPath);
			} catch (err) {
				console.error(err);
				throw err;
			} finally {
				this.#clean(temps);
			}
		} else {
			inputs.push(util.format(outputPattern, 1));
			await fs.rename(inputPath, inputs[0]);
			await this.#processFiles(
				args, args2, inputs, inputPath
			);
		}
	}

	async #groupFiles(list, output) {
		const ins = list.map(str => `"${str}"`).join(' ');
		try {
			const { stderr } = await exec(`pdfunite ${ins} "${output}"`);
			if (stderr?.length) throw new Error(stderr);
		} finally {
			this.#clean(list);
		}
	}

	async #processFiles(args, args2, inputs, outputFile) {
		args = args.slice();
		args.push(`-sOutputFile="${outputFile}"`, ...args2, ...inputs);
		try {
			const { stderr } = await exec(args.join(' '));
			if (stderr?.length) throw new Error(stderr);
		} finally {
			await this.#clean(inputs);
		}
		return outputFile;
	}

	#clean(list) {
		list.map(str => fs.unlink(str).catch(err => {
			console.error(err);
		}));
	}
};



function escapePsString(str) {
	// eslint-disable-next-line no-control-regex
	return str.replaceAll(/[^\x48-\x7E]|[\x60]/g, char => '\\' + char.charCodeAt(0).toString(8));
}
