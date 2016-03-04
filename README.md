# express-dom-pdf

PDF plugin for express-dom

Install
-------

npm install express-dom-pdf --save


Usage
-----

Once express-dom is setup to render web pages, and webkitgtk is native,
just render the pages through pdf helper and plugin. It automatically
pass to next route if not format=png query parameter is found.

```
var pdf = require('express-dom-pdf');
var app = require('express')();

app.get('*', dom(pdf.helper).load({
	plugins: [pdf.plugin]
}));

app.get('*', dom().load());
```


wget http://localhost:3000/mypage?format=pdf&orientation=landscape&margins=100

The added parameters are removed from query before making the sub-request.

