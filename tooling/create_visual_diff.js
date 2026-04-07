// Create a visual diff image to see where DOSBox and ScummVM differ
const fs = require('fs');
const { PNG } = require('pngjs');

function loadPNG(path) {
  const data = fs.readFileSync(path);
  return PNG.sync.read(data);
}

console.log('Loading reference screenshots...\n');

const dosbox = loadPNG('CrusaderReference2/dosbox-staging-screenshot.png');
const scummvm = loadPNG('CrusaderReference2/scummvm-screenshot.png');

// Create diff image - size of the smaller image
const width = Math.min(dosbox.width, scummvm.width, 1500);
const height = Math.min(dosbox.height, scummvm.height, 1200);

const diff = new PNG({ width, height });

let totalDiff = 0;
let pixelCount = 0;

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (width * y + x) << 2;
    const idx1 = (dosbox.width * y + x) << 2;
    const idx2 = (scummvm.width * y + x) << 2;

    const r1 = dosbox.data[idx1];
    const g1 = dosbox.data[idx1 + 1];
    const b1 = dosbox.data[idx1 + 2];

    const r2 = scummvm.data[idx2];
    const g2 = scummvm.data[idx2 + 1];
    const b2 = scummvm.data[idx2 + 2];

    const diffVal = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
    totalDiff += diffVal;
    pixelCount++;

    // Show differences in red, similar areas in grayscale
    if (diffVal < 30) {
      // Similar - show original
      diff.data[idx] = r1;
      diff.data[idx + 1] = g1;
      diff.data[idx + 2] = b1;
      diff.data[idx + 3] = 255;
    } else {
      // Different - show in red
      diff.data[idx] = 255;
      diff.data[idx + 1] = 0;
      diff.data[idx + 2] = 0;
      diff.data[idx + 3] = 255;
    }
  }
}

const avgDiff = totalDiff / (pixelCount * 3);
console.log(`Average color difference per channel: ${avgDiff.toFixed(2)}/255\n`);

const diffBuffer = PNG.sync.write(diff);
fs.writeFileSync('reference_diff.png', diffBuffer);

console.log('Created reference_diff.png (differences shown in red)\n');

// Also create side-by-side comparison
const sideBySide = new PNG({ width: width * 2, height });

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    // Left side: DOSBox
    const idx1 = (dosbox.width * y + x) << 2;
    const idxLeft = (width * 2 * y + x) << 2;
    sideBySide.data[idxLeft] = dosbox.data[idx1];
    sideBySide.data[idxLeft + 1] = dosbox.data[idx1 + 1];
    sideBySide.data[idxLeft + 2] = dosbox.data[idx1 + 2];
    sideBySide.data[idxLeft + 3] = 255;

    // Right side: ScummVM
    const idx2 = (scummvm.width * y + x) << 2;
    const idxRight = (width * 2 * y + (x + width)) << 2;
    sideBySide.data[idxRight] = scummvm.data[idx2];
    sideBySide.data[idxRight + 1] = scummvm.data[idx2 + 1];
    sideBySide.data[idxRight + 2] = scummvm.data[idx2 + 2];
    sideBySide.data[idxRight + 3] = 255;
  }
}

const sxsBuffer = PNG.sync.write(sideBySide);
fs.writeFileSync('reference_sidebyside.png', sxsBuffer);

console.log('Created reference_sidebyside.png (DOSBox left, ScummVM right)\n');
