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

// app.get('*', dom(pdf())); // simply append format=pdf to url query to trigger

// or configure defaults and mappings
app.get('*', dom(pdf({
	// a default value for quality forces gs conversion
	quality: 'screen',
	orientation: 'portrait',
	iccdir: require('path').join(__dirname, 'icc') // a directory containing allowed icc profiles
}, {
	// the application happens to use that name, replace it by another one
	orientation: 'pivot'
})));

// if other html pages are rendered by express-dom - but could be anything else
app.get('*', dom().load());
```

The caught parameters are removed from subrequest's query.

The `quality` or `icc` parameters triggers ghostscript compression.

Ghostscript does not need to be installed unless this parameter is used.

Example query:

http://localhost:3000/mypage?format=pdf&orientation=landscape&margins=100&quality=prepress&icc=sugarcoated300.icc

The iccdir option can not be set through query, only the icc option can.
`"${iccdir}/${icc}"` must be an existing file name.


Styling
-------

```
<link rel="stylesheet" href="style.css" media="print" />
```

or in a stylesheet, using a media query

```
@media print {
  article {
    page-break-inside: avoid;
  }
}
```

Read also [page break properties](http://caniuse.com/#feat=css-page-break),
in particular note that all browsers support these styles quite well:
* page-break-before: auto | always
* page-break-after: auto | always
* page-break-inside: auto | avoid

