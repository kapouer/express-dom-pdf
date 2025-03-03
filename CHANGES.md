# CHANGES

## 9.0.0

Add support for pdf/a-2b.

Breaking change: pdfx options is a boolean, not a file path.

## 8.14.0

Parallel processing of PDF is opt-in, using the new "parallel" option.

## 8.13.0

When using ghostview, divide the PDF to process pages in parallel,
using at most four threads, and always one thread less than the max available,
to avoid too much i/o.

## 8.12.1

Throw an error after document.fonts.ready times out (10 seconds).

## 8.12.0

icc can now accept a relative path to iccdir.

## 8.11.0

Disable inline images in pdf.

Allow generation of pdf from manual calls (since express-dom 8.11).

## 8.10.6

Set -dMaxShadingBitmapSize=4096000 for non-screen so rasterized gradients have better resolution

## 8.10.3

pdf=printer sets -sColorConversionStrategy=CMYK to ensure gradients are rasterized
