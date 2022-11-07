function autobreakFn(opts = {}) {
	if (!opts.page) opts.page = ".page";

	// 1) activate media print rules, get @page size and margins
	// 2) traverse, "page" nodes have 'page-break-after: always', 'page-break-inside:avoid'
	// 3) page node too long is broken in several pages
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

	const innerPageSize = {
		width: `calc(${pageSize.width} - ${atStyle.marginLeft || '0px'} - ${atStyle.marginInlineStart || '0px'} - ${atStyle.marginRight || '0px'} - ${atStyle.marginInlineEnd || '0px'})`,
		height: `calc(${pageSize.height} - ${atStyle.marginTop || '0px'}  - ${atStyle.marginBlockStart || '0px'} - ${atStyle.marginBottom || '0px'} - ${atStyle.marginBlockEnd || '0px'})`
	};
	const printSheet = `
	html, body {
		padding: 0;
		margin: 0;
	}
	@media screen {
		html, body {
			background: gray;
		}
		${opts.page} {
			width: ${innerPageSize.width};
			height: ${innerPageSize.height};
			margin-left: ${atStyle.marginLeft || '0px'};
			margin-inline-start: ${atStyle.marginInlineStart || '0px'};
			margin-right: ${atStyle.marginRight || '0px'};
			margin-inline-end: ${atStyle.marginInlineEnd || '0px'};
			margin-top: ${atStyle.marginTop || '0px'};
			margin-block-start: ${atStyle.marginBlockStart || '0px'};
			margin-bottom: ${atStyle.marginBottom || '0px'};
			margin-block-end: ${atStyle.marginBlockEnd || '0px'};
			background: white;
		}
	}
	@media print {
		${opts.page} {
			width: ${innerPageSize.width};
			height: ${innerPageSize.height};
			overflow: hidden;
		}
	}`;

	effectiveSheet.replaceSync(printSheet);
	document.adoptedStyleSheets.push(effectiveSheet);

	function getPageSize(str) {
		const [
			width = '210mm',
			height = '297mm'
		] = str?.split(' ') || [];
		return { width, height };
	}

	function fillPage(page) {
		const pageRect = page.getBoundingClientRect();
		const iter = document.createNodeIterator(page, NodeFilter.SHOW_ELEMENT, null);
		const range = new Range();
		let node;
		while ((node = iter.nextNode())) {
			if (node.children?.length) continue;
			const rect = node.getBoundingClientRect();
			if (Math.round((rect.bottom - pageRect.bottom) * 10) <= 0) continue;
			// TODO split text nodes using this technique:
			// https://www.bennadel.com/blog/4310-detecting-rendered-line-breaks-in-a-text-node-in-javascript.htm
			// honour orphans/widows
			if (node.previousSibling) {
				range.setStartBefore(node);
				range.setEndAfter(page);
				break;
			} else {
				Object.assign(node.style, {
					width: '100%',
					height: 'auto',
					maxWidth: innerPageSize.width,
					maxHeight: innerPageSize.height
				});
			}
		}
		if (!range.collapsed) {
			const contents = range.extractContents();
			const nextPage = contents.firstElementChild;
			if (opts.sibling) nextPage.classList.add(opts.sibling);
			page.after(nextPage);
			fillPage(nextPage);
		}
	}

	for (const page of document.querySelectorAll(opts.page)) {
		fillPage(page);
	}
}
