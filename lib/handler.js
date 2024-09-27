const debug = require('debug')('express-dom-pdf');
const tempfile = require('tempfile');
const {
	promises: {
		writeFile,
		readFile,
		unlink
	},
	createReadStream
} = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { cpus } = require('node:os');
const { spawn } = require('node:child_process');
const util = require('node:util');
const exec = util.promisify(require('node:child_process').exec);

const Path = require('node:path');

module.exports = class PdfHandler {
	static #pdfxCache = new Map();

	static timeout = 30000;
	static pdfx = Path.join(__dirname, '..', 'PDFX_def.ps');
	static iccdir = '/usr/share/color/icc';
	static plugins = new Set(['console']);
	static presets = {
		default: {
			quality: false
		},
		screen: {
			quality: 'screen',
			scale: 1
		},
		ebook: {
			quality: 'ebook',
			scale: 2
		},
		printer: {
			pageCount: true,
			quality: 'printer',
			scale: 4
		},
		prepress: {
			quality: 'prepress',
			scale: 4
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

	constructor(opts) {
		const policies = Object.assign({}, PdfHandler.policies, opts.policies);
		const presets = Object.assign({}, PdfHandler.presets, opts.presets);
		this.#settings = Object.assign({}, PdfHandler, opts, { policies, presets });
		this.chain = handler => this.#init(handler);
		this.#threads = Math.max(cpus().length - 1, 1);
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
		online.plugins.add('media');
		online.plugins.add('pdf');
		online.media = { media: 'print' };
		online.hidden = false;
		online.timeout = timeout;

		online.pdf = function (name) {
			const preset = presets[name] ?? presets.default;
			this.scale = preset.scale;
			this.preset = name;
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
					}
				});
				await Promise.all([document.fonts.ready.finally(resolver), abort]);
			});
			const outputPath = tempfile('.pdf');
			await page.pdf({
				preferCSSPageSize: true,
				printBackground: true,
				path: outputPath
			});

			const title = await page.title() || Path.basename(
				page.location.pathname, Path.extname(page.location.pathname)
			);

			debug("getting pdf", title, outputPath);
			const pageCount = preset.pageCount || preset.quality && this.#threads > 1
				? await this.#pageCount(outputPath)
				: null;
			if (pageCount) {
				res.set('X-Page-Count', pageCount);
			}
			res.attachment(title.substring(0, 123) + '.pdf');
			res.type('application/pdf');

			let stream;
			if (preset.quality) {
				await this.#ghostscript(title, outputPath, preset, pageCount);
			}
			stream = createReadStream(outputPath);

			pipeline(stream, res).catch(e => {
				if (e.code != 'ERR_STREAM_PREMATURE_CLOSE') {
					console.error(e);
				}
			}).finally(async () => {
				await unlink(outputPath);
			})
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
		const { pdfx, iccdir } = this.#settings;
		const { quality, icc, condition, others = [] } = preset;
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
			"-dNOSAFER", // else absolute paths cannot be specified
			"-dNumRenderingThreads=" + this.#threads,
			"-dMaxInlineImageSize=0",
			"-dDetectDuplicateImages=false", // can be prohibitively slow
			"-dPreserveAnnots=" + (isForScreen ? "true" : "false"),
			"-dPDFSETTINGS=/" + quality,
			"-dCompatibilityLevel=1.7",
			"-sDEVICE=pdfwrite"
		];
		if (!isForScreen) {
			args.push(
				'-sColorConversionStrategy=CMYK',
				'-dMaxShadingBitmapSize=4096000'
			);
		}

		for (const arg of others) {
			if (arg) args.push(arg);
		}
		const temps = [];
		const args2 = [];
		if (icc) {
			/*
			 http://www.color.org/chardata/drsection1.xalter
			 and explanations about ICC, OutputConditionIdentifier is
			 https://stackoverflow.com/questions/35705099/ghostscript-why-must-i-provide-a-pdfa-def-ps-for-pdf-a-conversion
			 https://www.ghostscript.com/doc/9.56.1/VectorDevices.htm#PDFX
			*/
			const iccpath = Path.join(iccdir, icc);
			if (!iccpath.startsWith(iccdir)) {
				throw new Error("Forbidden icc path: " + icc);
			}
			const pdfxDefPath = tempfile('.ps');
			const cache = PdfHandler.#pdfxCache;
			if (!cache.has(pdfx)) {
				const pdfxBuf = await readFile(pdfx);
				cache.set(pdfx, pdfxBuf.toString());
			}
			const pdfxData = cache.get(pdfx)
				.replace('!ICC!', escapePsString(iccpath))
				.replace('!CONDITION!', escapePsString(condition))
				.replace('!TITLE!', escapePsString(title));

			await writeFile(pdfxDefPath, pdfxData);
			temps.push(pdfxDefPath);

			args2.push(
				'-dPDFX=true',
				'-dRenderIntent=3',
				pdfxDefPath
			);
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
		const { stderr } = await exec(`pdfseparate "${inputPath}" "${outputPattern}"`);
		if (stderr) throw new Error(stderr);

		const files = [];
		const subCount = Math.ceil(pageCount / this.#threads);
		let startPage = 0;
		let lastPage = subCount;
		do {
			const outputFile = tempfile('.pdf');
			const inputs = [];
			for (let i = startPage; i < lastPage; i++) {
				inputs.push(util.format(outputPattern, i + 1));
			}
			files.push(this.#processFiles(
				args, args2, inputs, outputFile
			));
			startPage = lastPage;
			lastPage += subCount;
		} while (lastPage < pageCount);

		if (files.length > this.#threads) {
			console.warn("More inputs than threads", files.length);
		} else if (!files.length) {
			throw new Error("No pages");
		}
		try {
			return this.#groupFiles(await Promise.all(files), inputPath);
		} catch (err) {
			console.error(err);
			throw err;
		} finally {
			this.#clean(temps);
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
		list.map(str => unlink(str).catch(err => {
			console.error(err);
		}));
	}
};



function escapePsString(str) {
	return str.replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\//g, '\\/');
}
