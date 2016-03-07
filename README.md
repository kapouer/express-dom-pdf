# express-dom-pdf

PDF plugin for express-dom

Uses webkitgtk addon to render html pages to pdf, and optionally uses
ghostscript's 'gs' executable to compress or convert the pdf.

Install
-------

npm install express-dom-pdf --save


Usage
-----

This plugin for express-dom can run aside other rendering engines, one just has
to install the middleware before the one that is actually rendering html.

```
var pdf = require('express-dom-pdf');
var app = require('express')();

// only triggered by format=pdf in url query, otherwise goes to next route
app.get('*', dom(pdf.helper).load({
	plugins: [pdf.plugin]
}));

// if other html pages are rendered by express-dom - but could be anything else
app.get('*', dom().load());
```

The caught parameters are removed from subrequest's query.

The `quality` parameter triggers ghostscript compression.

Ghostscript does not need to be installed unless this parameter is used.

Example query:

http://localhost:3000/mypage?format=pdf&orientation=landscape&margins=100&quality=prepress


Stylesheets
-----------

<link rel="stylesheet" href="style.css" media="print" />

or in a stylesheet, using a media query

```
@media print {
  article {
    page-break-inside: avoid;
  }
}
```

Read also [page break properties](http://caniuse.com/#feat=css-page-break),
in particular note that:

* all browsers supports the page-break-* alias from the CSS 2.1 specification,
but not the break-* properties from the latest spec.

* all browsers but opera mini do not support avoid for page-break-before & page-break-after
(only page-break-inside)

* almost all browsers treats the left and right values like always
