const PdfHandler = require('./lib/handler');

module.exports = new Proxy(PdfHandler, {
	apply: (target, thisArg, args) => {
		const h = new PdfHandler(...args);
		h.chain.router = phase => h.router(phase);
		return h.chain;
	},
	get(...args) {
		return Reflect.get(...args);
	},
	set(...args) {
		return Reflect.set(...args);
	}
});
