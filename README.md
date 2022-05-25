# express-dom-pdf

PDF plugin for express-dom

Optionally converts pdf using ghostscript with presets.

## Usage

See express-dom documentation about how web pages are prerendered.

Requesting `/page.html?pdf` will download a pdf of `/page.html`.

```js
const dom = require('express-dom');
const pdfDefaults = require('express-dom-pdf');

const app = require('express')();

app.get('*', dom('pdf').load());
```

## Presets

Depends on the value of the `?pdf=<preset>` parameter:

- default: the pdf as produced by browser (without ghostscript conversion)
- screen, ebook, printer, prepress:
  [See ghostscript pdf outputs](https://www.ghostscript.com/doc/current/VectorDevices.htm)

Ghostscript can produce a pdf/x-3 using this kind of preset:

```js
pdfDefaults.presets.fogra39l = {
 quality: 'prepress',
 scale: 4,
 icc: 'ISOcoated_v2_300.icc',
 condition: 'FOGRA39L'
};
```

[See also pdflib documentation](https://www.pdflib.com/pdf-knowledge-base/pdfx-output-intents/).

## Options

Defaults are stored in `dom.settings.pdf`, which is what is returned by the module.

- timeout: max time to wait for page load to finish (default 30000)
- pdfx: file path for the pdfx postscript template
- iccdir: dir path for the icc profiles
- presets: map of presets
- plugins: load these dom plugins before pdf plugin

Presets accept these options:

- quality: false (boolean) or screen|ebook|prepress|printer (string)
- scale: device scale factor (usually integers between 1 and 4)
- icc: profile file name found in iccdir (required for pdf/x-3)
- condition: output condition identifier (required for pdf/x-3)

## Styling

Page size and margin must be configured at the stylesheet level, e.g:

```css
@media only print {

 @page {
  size: a4 portrait;
  margin:0;
 }
 body {
  width:21mm;
 }
 body > .page {
   height: 29.7mm;
   page-break: avoid;
 }
}
```
