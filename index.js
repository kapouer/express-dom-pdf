const debug = require('debug')('express-dom-pdf');
const tempfile = require('tempfile');
const { once } = require('events');
const {
	promises: {
		writeFile,
		readFile,
		unlink
	},
	createReadStream
} = require('fs');
const child_process = require('child_process');
const Path = require('path');
const getSlug = require('speakingurl');

const pdfxCache = new Map();

module.exports = function register(dom) {
	dom.settings.pdf = {
		plugins: ['pdf'],
		pdfx: Path.join(__dirname, 'PDFX_def.ps'),
		defaults: {},
		mappings: {}
	};
	dom.helpers.pdf = pdfHelper;
	dom.plugins.pdf = pdfPlugin;
	return dom.settings.pdf;
};

async function pdfHelper(mw, settings, request, response) {
	if (request.query.pdf != null) {
		settings.pdf = Object.assign(
			{},
			mw.constructor.settings.pdf,
			settings.pdf ?? {}
		);
		settings.load.plugins = settings.pdf.plugins;
		settings.location.searchParams.delete('pdf');
	}
}

async function pdfPlugin(page, settings, req, res) {
	const defs = {
		hide: false,
		stall: 5000,
		timeout: 5000
	};
	for (const key in defs) if (settings[key] == null) settings[key] = defs[key];

	page.on('idle', async () => {
		if (res.statusCode == 200) {
			settings.output = true; // take over output
		} else {
			return;
		}
		const pdf = settings.pdf || {};

		const title = getSlug(await page.title() ?? settings.location.pathname);
		const pdfParams = typeof req.query.pdf == "string" ? {} : req.query.pdf;
		const opts = {
			...pdf.defaults,
			...pdfParams
		};

		const { mappings } = pdf;

		if (!mappings.paper) mappings.paper = 'format';
		if (!mappings.ranges) mappings.ranges = 'pageRanges';
		opts.landscape = opts.orientation == "landscape";

		for (const [key, obj] of Object.entries(pdf.mappings || [])) {
			if (opts[key] === undefined) continue;
			Object.assign(opts, obj[opts[key]] ?? {});
		}

		const pdfOpts = {
			preferCSSPageSize: false
		};
		if (typeof opts.margin == "string") opts.margin = {
			left: opts.margin, right: opts.margin,
			top: opts.margin, bottom: opts.margin
		};
		for (const prop of ['format', 'margin', 'landscape', 'pageRanges']) {
			if (opts[prop] != null) pdfOpts[prop] = opts[prop];
			delete opts[prop];
		}

		let withGs = 0;
		const qualities = ['screen', 'ebook', 'prepress', 'printer'];
		// the 'default' quality means not using gs at all
		if (opts.quality && qualities.includes(opts.quality) == false) {
			delete opts.quality;
		}

		['icc', 'quality'].forEach((prop) => {
			if (opts[prop] != null) withGs++;
		});

		debug("getting pdf with title", title, pdfOpts);
		res.attachment(title.substring(0, 123) + '.pdf');

		pdfOpts.path = tempfile('.pdf');

		await page.pdf(pdfOpts);
		debug("pdf ready");
		if (withGs) {
			settings.output = await ghostscript({
				path: pdfOpts.path,
				title,
				pdfx: pdf.pdfx
			}, opts);
		} else {
			settings.output = createReadStream(pdfOpts.path);
		}
		once(settings.output, 'end').then(() => unlink(pdfOpts.path));
	});
}

async function ghostscript({ path, title, pdfx }, opts) {
	// http://milan.kupcevic.net/ghostscript-ps-pdf/
	// ALL OPTIONS http://ghostscript.com/doc/current/Ps2pdf.htm
	// http://ghostscript.com/doc/current/VectorDevices.htm#PDFWRITE
	// the images quality
	// screen: 72 dpi
	// ebook: 150 dpi
	// printer: 300 dpi
	// prepress: 300 dpi, color preserving
	// default: almost identical to screen
	let quality = opts.quality || 'default';
	if (opts.icc) quality = "printer";
	const args = [
		"-q", // do not log to stdout
		"-sstdout=%stderr", // redirect postscript errors to stderr
		"-dBATCH",
		"-dNOPAUSE",
		// "-dNOSAFER", // or else absolute paths cannot be specified
		// "-dNOOUTERSAVE",
		// "-dCompatibilityLevel=1.4",
		// "-dFirstPage=" + opts.first,
		// "-dLastPage=" + opts.last,
		// "-dNumRenderingThreads=4",
		"-dPDFSETTINGS=/" + quality,
		"-sDEVICE=pdfwrite",
		"-sOutputFile=-"
	];
	if (opts.icc) {
		/*
		 http://www.color.org/chardata/drsection1.xalter
		 and explanations about ICC, OutputConditionIdentifier is
		 https://stackoverflow.com/questions/35705099/ghostscript-why-must-i-provide-a-pdfa-def-ps-for-pdf-a-conversion
		 https://www.ghostscript.com/doc/9.56.1/VectorDevices.htm#PDFX
		*/
		const iccpath = Path.join(opts.iccdir, Path.basename(opts.icc));
		const pdfxDefPath = tempfile('.ps');
		if (!pdfxCache.has(pdfx)) {
			const pdfxBuf = await readFile(pdfx);
			pdfxCache.set(pdfx, pdfxBuf.toString());
		}
		const pdfxData = pdfxCache.get(pdfx)
			.replace('!ICC!', escapePsString(iccpath))
			.replace('!OUPUTCONDITION!', escapePsString(opts.outputcondition || opts.icc))
			.replace('!OUPUTCONDITIONID!', escapePsString(opts.outputconditionid || 'Custom'))
			.replace('!TITLE!', escapePsString(title));

		await writeFile(pdfxDefPath, pdfxData);

		args.push(
			'-dPDFX=true',
			'-dRenderIntent=3',
			'-sColorConversionStrategy=CMYK',
			'-sOutputICCProfile=' + iccpath,
			pdfxDefPath
		);
	}

	args.push(path);

	debug("gs", args.join(" "));

	const gs = child_process.spawn('gs', args);

	const errors = [];
	gs.stderr.on('data', (data) => {
		errors.push(data.toString());
	});
	gs.on('exit', (code) => {
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
