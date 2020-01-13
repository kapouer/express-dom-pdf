# express-dom-pdf

PDF plugin for express-dom

Uses webkitgtk addon to render html pages to pdf, and optionally uses
ghostscript's 'gs' executable to compress or convert the pdf.

New in version 1.0:
- validable pdf/x-3 with custom output ICC profile, output condition, and
  output condition identifier
- filename is automatically built from document title or page uri
- query parameters are stored in "pdf" object
- a second argument of pdf() can be a map of parameters sets,
  allowing easier configurations selection

Breaking changes from 0.x versions:
- filename parameter is ignored, pdf file is always attached
- query parameters can no longer be renamed
- query parameters must all belong to pdf object and "format" parameter no
  longer exists. Use an empty "?pdf" query parameter to print without options.


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
	iccdir: require('path').join(__dirname, 'icc') // a directory containing icc profiles
}, {
	x3: {
		'fogra39l': {
			icc: 'ISOcoated_v2_300.icc',
			outputcondition: 'Commercial and specialty offset, paper type 1 and 2, gloss or matt coated paper, positive plates, tone value increase curves A (CMY) and B (K), white backing.',
			outputconditionid: 'FOGRA39L'
		}
	}
})));

// or use a custom function that is called inside the prerendered DOM, after idle, and can return settings
// depending on the loaded document.
app.get('*', dom(pdf(defaults, function() {
  return {
    title: document.title, // converted to a file name
    quality: new URLSearchParams(document.location.search).get('pdf.quality')
  };
})));

// if other html pages are rendered by express-dom - but could be anything else
app.get('*', dom().load());
```

The caught parameters are removed from subrequest's query.

The `quality` or `icc` parameters triggers ghostscript compression.

Ghostscript does not need to be installed unless this parameter is used.

Example queries:
```
http://localhost:3000/mypage?pdf
http://localhost:3000/mypage?pdf[orientation]=landscape
http://localhost:3000/mypage?pdf[icc]=ISOcoated_v2_300.icc&pdf[outputcondition]=Commercial%20and%20specialty%20offset&pdf[outputconditionid]=FOGRA39L
http://localhost:3000/mypage?pdf[margins]=20&pdf[x3]=fogra39l
```

The iccdir option can not be set through query, only the icc option can.
- `${iccdir}/${icc}` must be an existing file name
- `${iccdir}/sRGB.icc` must exists, because the default RGB profile is needed for conversion to CMYK.


Styling
-------

You really want to set document width to a fixed value !

```
html {
  width: calc((21cm - 3cm) * 2); /* double the printable area width */
}
```

See [the wiki](https://github.com/kapouer/express-dom-pdf/wiki) for known limitations.

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

Unsupported as of webkit2gtk <= 2.17:
- css multicolumn layout is only supported when not printing, so even if it is
  rendered nicely using webkitgtk, it won't be rendered in the pdf.

