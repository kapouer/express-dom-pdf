(async function autobreakFn() {
	// first find page size

	if (document.readyState != "complete") {
		window.addEventListener('load', autobreakFn);
		return;
	}
	window.removeEventListener('load', autobreakFn);

	function findRules(sheet, type, list = []) {
		for (const rule of sheet.cssRules) {
			if (rule.constructor.name == type) list.push(rule);
			if (rule.cssRules) findRules(rule, type, list);
		}
		return list;
	}
	const pageRules = [];
	for (const sheet of document.styleSheets) {
		findRules(sheet, 'CSSPageRule', pageRules);
	}
	const pageRule = pageRules.find(rule => rule.style.size);
	const effectiveSheet = new CSSStyleSheet();
	const atStyle = pageRule.style;
	const pageSize = getPageSize(pageRule?.style?.size);
	effectiveSheet.replaceSync(`
	html, body {
		padding: 0;
		margin: 0;
	}
	@media screen {
		html, body {
			background: gray;
		}
		.page {
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
		.page {
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

	for (const page of document.querySelectorAll('body > .page')) {
		fillPage(page);
	}

	// removing style is not needed

})();

