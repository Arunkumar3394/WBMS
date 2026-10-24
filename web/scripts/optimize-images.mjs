// Makes web-ready WebP copies of the photos in ../images (the originals are not changed
// and are not committed). Run again after adding photos:  npm run images
//
// Only images without other companies' branding or health claims are used. Image5.png
// is a collage; just its unbranded tiles are cut out. To add your own photo, put it in
// ../images and add a line to `outputs` below.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const src = (f) => path.join('..', 'images', f);
const out = (f) => path.join('public', 'images', f);

/** [source file, crop {left, top, width, height} or null, output path, max width] */
const outputs = [
  ['image3.jpeg', null, 'water-plant/ro-plant-steel.webp', 600],
  ['Image5.png', { left: 610, top: 700, width: 480, height: 320 }, 'water-plant/ro-plant-filters.webp', 480],
  ['Image5.png', { left: 4, top: 396, width: 458, height: 290 }, 'water-plant/bottling-line.webp', 458],
  ['Image5.png', { left: 816, top: 4, width: 300, height: 376 }, 'water-cans/can-on-dispenser.webp', 300],
  ['Image5.png', { left: 330, top: 700, width: 264, height: 320 }, 'branding/glass-of-water.webp', 264],
];

for (const [file, crop, target, maxWidth] of outputs) {
  await mkdir(path.dirname(out(target)), { recursive: true });
  let img = sharp(src(file));
  if (crop) img = img.extract(crop);
  const info = await img
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(out(target));
  console.log(`${target}  ${info.width}×${info.height}  ${(info.size / 1024).toFixed(0)} KB`);
}
