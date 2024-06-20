# CHANGES

## 8.10.3

pdf=printer sets -sColorConversionStrategy=CMYK to ensure gradients are rasterized

## 8.10.6

Set -dMaxShadingBitmapSize=4096000 for non-screen so rasterized gradients have better resolution

## 8.11.0

Disable inline images in pdf.

Allow generation of pdf from manual calls (since express-dom 8.11).

## 8.12.0

icc can now accept a relative path to iccdir.
