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
const { spawn } = require('node:child_process');
const Path = require('node:path');
const getSlug = require('speakingurl');

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

	constructor(opts) {
		const policies = Object.assign({}, PdfHandler.policies, opts.policies);
		const presets = Object.assign({}, PdfHandler.presets, opts.presets);
		this.#settings = Object.assign({}, PdfHandler, opts, { policies, presets });
		this.chain = handler => this.#init(handler);
	}

	#init(handler) {
		const { online, plugins } = handler;
		plugins.pdf = (...args) => this.plugin(...args);

		const {
			timeout, policies, plugins: userPlugins
		} = this.#settings;

		if (userPlugins) for (const name of userPlugins) {
			online.plugins.add(name);
		}
		online.plugins.delete('html');
		online.plugins.add('pdf');
		online.hidden = false;
		online.timeout = timeout;
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
		}`);

		if (preset.scale) settings.scale = preset.scale;

		page.on('idle', async () => {
			const title = getSlug(await page.title() ?? page.location.pathname);

			const outputPath = tempfile('.pdf');

			debug("getting pdf", title, outputPath);
			res.attachment(title.substring(0, 123) + '.pdf');
			res.type('application/pdf');

			await page.emulateMedia({ media: 'print' });
			await page.pdf({
				preferCSSPageSize: true,
				printBackground: true,
				path: outputPath
			});
			let stream;
			if (preset.quality) {
				stream = await this.#ghostscript(title, outputPath, preset);
			} else {
				stream = createReadStream(outputPath);
			}
			return new Promise((resolve, reject) => {
				stream.once('error', reject);
				stream.once('finish', resolve);
				stream.pipe(res);
			}).finally(() => {
				unlink(outputPath);
			});
		});
	}

	async #ghostscript(title, inputPath, preset) {
		const { pdfx, iccdir } = this.#settings;
		const { quality, icc, condition } = preset;
		// http://milan.kupcevic.net/ghostscript-ps-pdf/
		// ALL OPTIONS http://ghostscript.com/doc/current/Ps2pdf.htm
		// http://ghostscript.com/doc/current/VectorDevices.htm#PDFWRITE
		// the images quality
		// screen: 72 dpi
		// ebook: 150 dpi
		// printer: 300 dpi
		// prepress: 300 dpi, color preserving
		const args = [
			"-q", // do not log to stdout
			"-sstdout=%stderr", // redirect postscript errors to stderr
			"-dBATCH",
			"-dNOPAUSE",
			"-dNOSAFER", // else absolute paths cannot be specified
			// "-dNOOUTERSAVE",
			// "-dCompatibilityLevel=1.4",
			"-dPDFSETTINGS=/" + quality,
			"-sDEVICE=pdfwrite",
			"-sOutputFile=-"
		];

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
