// Compare color histograms of DOSBox and ScummVM screenshots
const fs = require('fs');
const { PNG } = require('pngjs');

function loadPNG(path) {
  const data = fs.readFileSync(path);
  return PNG.sync.read(data);
}

function buildColorHistogram(img, excludeBottomPercent = 0.15) {
  const histogram = new Map();
  const maxY = Math.floor(img.height * (1 - excludeBottomPercent));

  for (let y = 0; y < maxY; y++) {
    for (let x = 0; x < img.width; x++) {
      const idx = (img.width * y + x) << 2;
      const r = img.data[idx];
      const g = img.data[idx + 1];
      const b = img.data[idx + 2];

      // Quantize colors to 16 levels per channel to group similar colors
      const rKey = Math.floor(r / 16);
      const gKey = Math.floor(g / 16);
      const bKey = Math.floor(b / 16);
      const key = `${rKey},${gKey},${bKey}`;

      histogram.set(key, (histogram.get(key) || 0) + 1);
    }
  }

  return histogram;
}

function compareHistograms(hist1, hist2) {
  // Normalize histograms
  const total1 = [...hist1.values()].reduce((a, b) => a + b, 0);
  const total2 = [...hist2.values()].reduce((a, b) => a + b, 0);

  const norm1 = new Map();
  const norm2 = new Map();

  for (const [key, count] of hist1) {
    norm1.set(key, count / total1);
  }
  for (const [key, count] of hist2) {
    norm2.set(key, count / total2);
  }

  // Calculate histogram intersection (similarity measure)
  let intersection = 0;
  const allKeys = new Set([...norm1.keys(), ...norm2.keys()]);

  for (const key of allKeys) {
    const val1 = norm1.get(key) || 0;
    const val2 = norm2.get(key) || 0;
    intersection += Math.min(val1, val2);
  }

  return intersection;
}

function topColors(histogram, n = 10) {
  const sorted = [...histogram.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, n);
}

console.log('Loading reference screenshots...\n');

const dosbox = loadPNG('CrusaderReference2/dosbox-staging-screenshot.png');
const scummvm = loadPNG('CrusaderReference2/scummvm-screenshot.png');

console.log(`DOSBox screenshot: ${dosbox.width}x${dosbox.height}`);
console.log(`ScummVM screenshot: ${scummvm.width}x${scummvm.height}\n`);

console.log('Building color histograms (excluding bottom 15% for UI)...\n');

const hist1 = buildColorHistogram(dosbox);
const hist2 = buildColorHistogram(scummvm);

console.log(`DOSBox unique colors (quantized): ${hist1.size}`);
console.log(`ScummVM unique colors (quantized): ${hist2.size}\n`);

const similarity = compareHistograms(hist1, hist2);

console.log(`Histogram intersection (similarity): ${(similarity * 100).toFixed(2)}%\n`);

console.log('Top 10 colors in DOSBox:');
const top1 = topColors(hist1);
for (let i = 0; i < top1.length; i++) {
  const [key, count] = top1[i];
  const [r, g, b] = key.split(',').map(k => parseInt(k) * 16);
  const pct = ((count / [...hist1.values()].reduce((a, b) => a + b, 0)) * 100).toFixed(2);
  console.log(`  ${i + 1}. RGB(${r}, ${g}, ${b}): ${pct}%`);
}

console.log('\nTop 10 colors in ScummVM:');
const top2 = topColors(hist2);
for (let i = 0; i < top2.length; i++) {
  const [key, count] = top2[i];
  const [r, g, b] = key.split(',').map(k => parseInt(k) * 16);
  const pct = ((count / [...hist2.values()].reduce((a, b) => a + b, 0)) * 100).toFixed(2);
  console.log(`  ${i + 1}. RGB(${r}, ${g}, ${b}): ${pct}%`);
}

if (similarity >= 0.9) {
  console.log('\n✓ Color distributions are >90% similar - references are consistent!');
} else if (similarity >= 0.8) {
  console.log('\n⚠ Color distributions are ~80-90% similar - minor differences');
} else {
  console.log('\n✗ Color distributions differ significantly');
}
