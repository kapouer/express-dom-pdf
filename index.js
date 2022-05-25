const debug = require('debug')('express-dom-pdf');
const tempfile = require('tempfile');
const { once } = require('node:events');
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
const dom = require('express-dom');

const pdfxCache = new Map();

dom.helpers.pdf = pdfHelper;
dom.plugins.pdf = pdfPlugin;
dom.settings.pdf = {
	timeout: 30000, // pdf might load many images
	pdfx: Path.join(__dirname, 'PDFX_def.ps'),
	iccdir: Path.join(__dirname, 'icc'),
	plugins: [],
	presets: {
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
	},
	policies: {
		script: "'self' https:",
		connect: "'self' https:",
		img: "'self' https: data:",
		font: "'self' https: data:",
		style: "'self' 'unsafe-inline' https:"
	}
};

module.exports = dom.settings.pdf;

async function pdfHelper(mw, settings, req, res) {
	const { presets, plugins } = dom.settings.pdf;
	const { pdf } = req.query;
	if (pdf === undefined) return;
	const preset = presets[pdf || 'default'];
	if (!preset) return;
	if (preset.quality && ["screen", "ebook", "printer", "prepress"].includes(preset.quality) == false) {
		console.warn("Uknown pdf preset quality", preset.quality);
		delete preset.quality;
	}

	Object.assign(settings.load, {
		preset,
		plugins: plugins.concat(['pdf']),
		hide: false
	});
	settings.location.searchParams.delete('pdf');
}

async function pdfPlugin(page, settings, req, res) {
	page.addStyleTag({
		content: `html {
			-webkit-print-color-adjust: exact !important;
		}`});

	const { policies, location, preset } = settings;

	if (preset.scale) settings.scale = preset.scale;

	Object.assign(policies, dom.settings.pdf.policies);

	page.on('idle', async () => {
		const title = getSlug(await page.title() ?? location.pathname);

		const outputPath = tempfile('.pdf');

		debug("getting pdf", title, outputPath);
		res.attachment(title.substring(0, 123) + '.pdf');

		await page.emulateMedia({ media: 'print' });
		await page.pdf({
			preferCSSPageSize: true,
			printBackground: true,
			path: outputPath
		});

		if (preset.quality) {
			settings.output = await ghostscript(title, outputPath, preset);
		} else {
			settings.output = createReadStream(outputPath);
		}
		once(settings.output, 'finish').then(() => unlink(outputPath));
	});
}

async function ghostscript(title, inputPath, preset) {
	const { pdfx, iccdir } = dom.settings.pdf;
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
		if (!pdfxCache.has(pdfx)) {
			const pdfxBuf = await readFile(pdfx);
			pdfxCache.set(pdfx, pdfxBuf.toString());
		}
		const pdfxData = pdfxCache.get(pdfx)
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

function escapePsString(str) {
	return str.replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\//g, '\\/');
}
