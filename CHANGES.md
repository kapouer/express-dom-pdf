# CHANGES

## 9.1.0

Since PDF does not accept webp or avif, override HTTP request headers
so that images are only in svg, png, or jpg.

## 9.0.0

- Enable "-dPassThroughJPEGImages=true" for non-display devices.
  This avoids reencoding artifacts, and faster generation.
- Keep RGB for ColorConversionStrategy (except for pdf/x).
- Fix escaping of postscript strings.
- Add support for pdf/a-2b (pdfa option).
- Drop NOSAFER, use adhoc `--permit-file-read` instead.

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
