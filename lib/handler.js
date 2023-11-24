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

const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').exec);

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
			scale: 4,
			others: [
				"-sColorConversionStrategy=CMYK"
			]
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
		this.#threads = cpus().length - 1;
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
				await document.fonts.ready;
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
			if (preset.pageCount) {
				res.set('X-Page-Count', await this.#pageCount(outputPath));
			}
			res.attachment(title.substring(0, 123) + '.pdf');
			res.type('application/pdf');

			let stream;
			if (preset.quality) {
				stream = await this.#ghostscript(title, outputPath, preset);
			} else {
				stream = createReadStream(outputPath);
			}
			try {
				await pipeline(stream, res);
			} finally {
				await unlink(outputPath);
			}
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

	async #ghostscript(title, inputPath, preset) {
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
		const isForScreen = ["screen", "ebook"].includes(quality) ? "true" : "false";
		const args = [
			"-q", // do not log to stdout
			"-sstdout=%stderr", // redirect postscript errors to stderr
			"-dBATCH",
			"-dNOPAUSE",
			"-dNOSAFER", // else absolute paths cannot be specified
			"-dNumRenderingThreads=" + this.#threads,
			"-dDetectDuplicateImages=false", // can be prohibitively slow
			"-dPreserveAnnots=" + isForScreen,
			"-dPDFSETTINGS=/" + quality,
			"-sDEVICE=pdfwrite",
			"-sOutputFile=-"
		];

		for (const arg of others) {
			if (arg) args.push(arg);
		}

		let pdfxDefPath;
		async function cleanTemp() {
			const it = pdfxDefPath;
			if (it) {
				pdfxDefPath = null;
				await unlink(it);
			}
		}
		if (icc) {
			/*
			 http://www.color.org/chardata/drsection1.xalter
			 and explanations about ICC, OutputConditionIdentifier is
			 https://stackoverflow.com/questions/35705099/ghostscript-why-must-i-provide-a-pdfa-def-ps-for-pdf-a-conversion
			 https://www.ghostscript.com/doc/9.56.1/VectorDevices.htm#PDFX
			*/
			const iccpath = Path.join(iccdir, Path.basename(icc));
			pdfxDefPath = tempfile('.ps');
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

			args.push(
				'-dPDFX=true',
				'-dRenderIntent=3',
				'-sColorConversionStrategy=CMYK',
				pdfxDefPath
			);
		}
		// set title
		args.push(
			"-c",
			`[ /Title (${escapePsString(title)}) /DOCINFO pdfmark`,
			"-f"
		);
		args.push(inputPath);

		debug("gs", args.join(" "));

		const gs = spawn('gs', args);
		gs.on('close', cleanTemp);
		if (gs.stdout == null || gs.stderr == null) {
			throw new Error("Cannot spawn ghostscript command: 'gs'");
		}

		const errors = [];
		gs.stderr.on('data', (data) => {
			errors.push(data.toString());
		});
		gs.on('exit', (code) => {
			cleanTemp();
			if (code !== 0 && errors.length) {
				gs.stdout.emit('error', new Error(errors.join('')));
			}
			errors.length = 0;
		});
		gs.stdout.on('end', () => {
			if (errors.length) {
				// that's a workaround for an ugly situation
				gs.stdout.emit('error', new Error(errors.join('')));
				errors.length = 0;
			}
		});

		return gs.stdout;
	}

};



function escapePsString(str) {
	return str.replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\//g, '\\/');
}
