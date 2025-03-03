# express-dom-pdf

PDF plugin for express-dom

Optionally converts pdf using ghostscript with presets.

## Usage

See express-dom documentation about how web pages are prerendered.

```js
const dom = require('express-dom');
const pdf = require('express-dom-pdf');
const express = require('express');
const app = express();

// unconditionally outputs a pdf

app.get('*.html', dom(pdf({
  presets: {
    // merged with pdf.presets
  },
  policies: {
    // merged with pdf.policies
  }
  plugins: ['custom'] // these plugins are added before 'pdf' plugin
})).route((phase, req, res) => {
  if (phase.visible) {
    phase.settings.pdf(req.query.pdf);
    // no need to keep the parameter during prerendering
    phase.location.searchParams.delete('pdf');
  } else {
    res.set('Content-Security-Policy', "default 'self' data:");
  }
}), express.static('public/'));
```

It is also possible to get a response stream directly without express,
in scenarios where pdf generation takes a long time:

```js
// res: { statusCode, headers } is a passthrough stream
const res = dom(pdf(opts))({
  url: 'http://localhost/custom.html',
  body: '<html>...</html>'
});
```

## Presets

Depends on the value of the `phase.settings.preset` parameter.
If not set, the "default" preset is used.
If a preset is unknown, an error with error.statusCode of 400 is thrown.

- default: the pdf as produced by browser (without ghostscript conversion)
- screen, ebook, printer, prepress:
  [See ghostscript pdf outputs](https://www.ghostscript.com/doc/current/VectorDevices.htm)

Ghostscript can produce a pdf/x-3 using this kind of preset:

```js
pdf.presets.fogra39l = {
 quality: 'printer',
 scale: 4,
 pdfx: true,
 icc: 'ISOcoated_v2_300_eci.icc',
 condition: 'FOGRA39L',
 others: [ "-dColorImageResolution=600" ]
};
```

[See also pdflib documentation](https://www.pdflib.com/pdf-knowledge-base/pdfx-output-intents/).

For pdf/a-2 output, a icc profile may be specified.

## Options

These settings can be changed globally, or for each instance.

- timeout: max time to wait for page load to finish (default 30000)
- parallel: number of parts to process pdf in parallel (default 1, experimental)
- iccdir: dir path for the icc profiles (on Debian, install `icc-profiles` to get some common profiles in `/usr/share/color/icc`)
- presets: map of presets
- plugins: load these dom plugins before media and pdf plugins
- policies: the csp for express-dom online phase

Presets accept these options:

- quality: false (boolean) or screen|ebook|prepress|printer (string)
- scale: device scale factor, changes value of window.devicePixelRatio
- pdfa: boolean
- pdfx: boolean
- icc: profile path relative to iccdir (for pdfa, pdfx)
  defaults to `ghostscript/default_cmyk.icc`
- condition: output condition identifier (for pdfa, pdfx, can be left empty)
  See [Registered CMYK characterization data sets](https://www.color.org/chardata/drsection1.xalter).
- others: additional gs arguments, see [ghostscript](https://ghostscript.readthedocs.io/en/latest/VectorDevices.html).
- pageCount: boolean, sets X-Page-Count HTTP response header.
  defaults to true for printer preset.

## Styling

A minimal stylesheet:

```css
@media only print {

 @page {
  size: 210mm 297mm;
  margin:1cm;
 }
 html, body {
  padding: 0;
  margin: 0;
 }
 body > .page {
  page-break-inside: avoid;
  page-break-after: always;
 }
}
```

## Autobreak (experimental)

Sample code of how to break pages at the DOM level, before printing, is available in test/public/autobreak.html (to actually see the result, just serve test/public and open autobreak.html).

This is more powerful than print breaks, because it allows one to style the resulting layout.

## fonts

On Debian, install `fonts-recommended` package.

System fonts rendering can have some bugs, especially regarding emojis or color fonts.
