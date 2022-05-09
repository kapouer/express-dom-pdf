# express-dom-pdf

PDF plugin for express-dom

Prerenders html in visible mode, then outputs pdf,
and optionally use ghostscript to compress the pdf to predefined qualities.

If your ghostscript version supports it, pdf/x-3 output is supported.

## Usage

This plugin for express-dom can run aside other rendering engines, one just has
to install the middleware before the one that is actually rendering html.

```js
const pdf = require('express-dom-pdf');
const app = require('express')();

const pdfHelper = pdf({
 // a default value for quality forces gs conversion
 quality: 'screen',
 orientation: 'portrait',
 // a directory containing icc profiles
 iccdir: require('path').join(__dirname, 'icc')
}, {
 x3: {
  'fogra39l': {
   icc: 'ISOcoated_v2_300.icc',
   outputcondition: 'Commercial and specialty offset, paper type 1 and 2, gloss or matt coated paper, positive plates, tone value increase curves A (CMY) and B (K), white backing.',
   outputconditionid: 'FOGRA39L'
  }
 }
});

// pdf is rendered only if query does have some "pdf" query parameters
app.get('*', dom(pdf).load());
```

The pdf query parameters are removed from the page location.

## Options

Browser options:

- orientation: portrait, landscape
- paper: format iso_a3, iso_a4, iso_a5, iso_b5, na_letter, na_executive, na_legal...
- margin: single value or {top, right, left, bottom} object with css values

Ghostscript options:

- quality: default, screen, ebook, prepress, printer
- icc: profile filename found in iccdir

Constant iccdir option:

- `${iccdir}/${icc}` must be an existing file name
- `${iccdir}/sRGB.icc` must exists, because the default RGB profile is needed for conversion to CMYK.

The `quality` or `icc` parameters triggers ghostscript compression.
Ghostscript does not need to be installed unless this parameter is used.

## Example queries

> /mypage?pdf
> /mypage?pdf[orientation]=landscape
> /mypage?pdf[icc]=ISOcoated_v2_300.icc&pdf[outputcondition]=Commercial%20and%20specialty%20offset&pdf[outputconditionid]=FOGRA39L
> /mypage?pdf[margin]=2rem&pdf[x3]=fogra39l

## Styling

Set document width to a known value:

```css
html {
  width: calc((21cm - 3cm) * 2); /* double the printable area width */
}
```

See [the wiki](https://github.com/kapouer/express-dom-pdf/wiki) for known limitations.

```html
<link rel="stylesheet" href="style.css" media="print" />
```

or in a stylesheet, using a media query

```css
@media print {
  article {
    page-break-inside: avoid;
  }
}
```

Read also [page break properties](http://caniuse.com/#feat=css-page-break),
in particular note that all browsers support these styles quite well:

- page-break-before: auto | always
- page-break-after: auto | always
- page-break-inside: auto | avoid
