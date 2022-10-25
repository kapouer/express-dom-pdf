function autobreakFn(className) {
	// first find page size
	const selector = ".page";

	if (document.readyState != "complete") {
		window.addEventListener('load', autobreakFn);
		return;
	}
	window.removeEventListener('load', autobreakFn);

	// 1) activate media print rules, get @page size and margins
	// 2) just traverse and honour 'page-break-after: always', 'page-break-inside:avoid'
	// 3) page-break-inside: avoid nodes that can't fit must be broken anyway
	// 4) try to break text nodes, honour widows/orphans
	// 5) leaf nodes that can't fit must be resized ! (and a warning)


	function findRule(list, type, prop) {
		for (const rule of list) {
			if (rule.constructor.name == type && Boolean(rule.style[prop])) return rule;
			if (rule.cssRules) return findRule(rule.cssRules, type, prop);
		}
	}
	const pageRule = findRule(document.styleSheets, 'CSSPageRule', 'size');

	// TODO set style of nodes having print style
	// page-break-inside: avoid;
	// page -break-after: always;

	const effectiveSheet = new CSSStyleSheet();
	const atStyle = pageRule.style;
	const pageSize = getPageSize(atStyle.size);
	effectiveSheet.replaceSync(`
	html, body {
		padding: 0;
		margin: 0;
	}
	@media screen {
		html, body {
			background: gray;
		}
		${selector} {
			width: calc(${pageSize[0]} - ${atStyle['margin-left']} - ${atStyle['margin-right']});
			height:calc(${pageSize[1]} - ${atStyle['margin-top']} - ${atStyle['margin-bottom']});
			margin-left: ${atStyle['margin-left']};
			margin-right: ${atStyle['margin-right']};
			margin-top: ${atStyle['margin-top']};
			margin-bottom: ${atStyle['margin-bottom']};
			background: white;
		}
	}
	@media print {
		${selector} {
			height:100vh;
		}
	}`);
	document.adoptedStyleSheets.push(effectiveSheet);

	function getPageSize(str) {
		const [
			width = '210mm',
			height = '297mm'
		] = str?.split(' ') || [];
		return [width, height];
	}

	function fillPage(page) {
		const pageRect = page.getBoundingClientRect();
		const iter = document.createNodeIterator(page, NodeFilter.SHOW_ELEMENT, null);
		const range = new Range();
		let node;
		while ((node = iter.nextNode())) {
			if (node.children?.length) continue;
			const rect = node.getBoundingClientRect();
			if (Math.round((rect.bottom - pageRect.bottom) * 10) > 0) {
				range.setStartBefore(node);
				range.setEndAfter(page);
				break;
			}
		}
		if (!range.collapsed) {
			page.after(range.extractContents());
		}
	}

	for (const page of document.querySelectorAll(selector)) {
		fillPage(page);
	}
}
autobreakFn();
