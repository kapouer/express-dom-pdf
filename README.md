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

