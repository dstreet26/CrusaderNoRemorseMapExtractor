// Brute-force test different global shape index offsets
// and compare color histograms against the reference screenshots
const fs = require('fs');
const { PNG } = require('pngjs');
const { execSync } = require('child_process');

// Get data path from command line argument or use default
const dataPath = process.argv[2] || 'gog/Crusader No Remorse';

function loadPNG(path) {
  const data = fs.readFileSync(path);
  return PNG.sync.read(data);
}

function buildColorHistogram(img) {
  const histogram = new Map();
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const idx = (img.width * y + x) << 2;
      const r = img.data[idx];
      const g = img.data[idx + 1];
      const b = img.data[idx + 2];
      const a = img.data[idx + 3];
      // Skip fully transparent / black background pixels
      if (a === 0 || (r === 0 && g === 0 && b === 0)) continue;
      const rKey = Math.floor(r / 16);
      const gKey = Math.floor(g / 16);
      const bKey = Math.floor(b / 16);
      const key = `${rKey},${gKey},${bKey}`;
      histogram.set(key, (histogram.get(key) || 0) + 1);
    }
  }
  return histogram;
}

function histogramIntersection(hist1, hist2) {
  const total1 = [...hist1.values()].reduce((a, b) => a + b, 0);
  const total2 = [...hist2.values()].reduce((a, b) => a + b, 0);
  if (total1 === 0 || total2 === 0) return 0;

  let intersection = 0;
  const allKeys = new Set([...hist1.keys(), ...hist2.keys()]);
  for (const key of allKeys) {
    intersection += Math.min(
      (hist1.get(key) || 0) / total1,
      (hist2.get(key) || 0) / total2
    );
  }
  return intersection;
}

// Load both reference screenshots, build histograms, average them
console.log('Loading reference screenshots...\n');
const dosbox = loadPNG('CrusaderReference2/dosbox-staging-screenshot.png');
const scummvm = loadPNG('CrusaderReference2/scummvm-screenshot.png');

// Exclude bottom ~15% (UI area) from references
function buildRefHistogram(img) {
  const histogram = new Map();
  const maxY = Math.floor(img.height * 0.85);
  for (let y = 0; y < maxY; y++) {
    for (let x = 0; x < img.width; x++) {
      const idx = (img.width * y + x) << 2;
      const r = img.data[idx];
      const g = img.data[idx + 1];
      const b = img.data[idx + 2];
      const rKey = Math.floor(r / 16);
      const gKey = Math.floor(g / 16);
      const bKey = Math.floor(b / 16);
      const key = `${rKey},${gKey},${bKey}`;
      histogram.set(key, (histogram.get(key) || 0) + 1);
    }
  }
  return histogram;
}

const refHistDosbox = buildRefHistogram(dosbox);
const refHistScummvm = buildRefHistogram(scummvm);

// Merge the two reference histograms (average)
const refHist = new Map();
const allRefKeys = new Set([...refHistDosbox.keys(), ...refHistScummvm.keys()]);
for (const key of allRefKeys) {
  refHist.set(key, ((refHistDosbox.get(key) || 0) + (refHistScummvm.get(key) || 0)) / 2);
}

console.log('Reference histogram built (averaged DOSBox + ScummVM)\n');

// Test different shape offsets
// Current code does: archiveIdx = shapeIdx - 1
// So offset -1 means "current behavior" (subtract 1)
// offset 0 means "use shape ID directly as index" (what ScummVM does)
// offset +1 means "add 1", etc.
const offsets = [-1, 0, 1, 2, 10, 100];

// Use the coordinates the user gave, zoomed in a bit
const x = 13892;
const y = 13528;
const width = 2000;  // zoomed in from 4344
const height = 1200; // zoomed in from 2308

console.log(`Rendering at (${x}, ${y}) ${width}x${height} with different shape offsets...\n`);

const results = [];

for (const offset of offsets) {
  const outputFile = `test_offset_${offset >= 0 ? '+' : ''}${offset}.png`;
  console.log(`Testing offset ${offset >= 0 ? '+' : ''}${offset}...`);

  // Modify renderer.ts line 84 to use the new offset
  // Current: const archiveIdx = shapeIdx - 1;
  // We want: const archiveIdx = shapeIdx + offset;
  const rendererSrc = fs.readFileSync('src/renderer.ts', 'utf-8');

  // Find the line with archiveIdx calculation and modify it
  const modified = rendererSrc.replace(
    /const archiveIdx = shapeIdx[^;]*;/,
    `const archiveIdx = shapeIdx + (${offset});`
  );
  fs.writeFileSync('src/renderer.ts', modified);

  try {
    // Build
    execSync('npx tsc', { stdio: 'pipe' });

    // Render
    execSync(
      `node dist/index.js render-area --input-data-dir="${dataPath}" --level=1 --x=${x} --y=${y} --width=${width} --height=${height} --output=${outputFile}`,
      { stdio: 'pipe', timeout: 60000 }
    );

    // Compare
    const rendered = loadPNG(outputFile);
    const renderedHist = buildColorHistogram(rendered);
    const similarity = histogramIntersection(refHist, renderedHist);

    console.log(`  Similarity: ${(similarity * 100).toFixed(2)}%`);
    results.push({ offset, similarity, file: outputFile });
  } catch (err) {
    console.log(`  Error: ${err.message.split('\n')[0]}`);
    results.push({ offset, similarity: 0, file: outputFile, error: true });
  }
}

// Restore original renderer.ts
const origRenderer = fs.readFileSync('src/renderer.ts', 'utf-8');
const restored = origRenderer.replace(
  /const archiveIdx = shapeIdx[^;]*;/,
  'const archiveIdx = shapeIdx - 1;'
);
fs.writeFileSync('src/renderer.ts', restored);
execSync('npx tsc', { stdio: 'pipe' });

// Sort results
results.sort((a, b) => b.similarity - a.similarity);

console.log('\n=== Results (sorted by similarity) ===\n');
for (const r of results) {
  const marker = r === results[0] ? ' <<<< BEST' : '';
  console.log(`  Offset ${r.offset >= 0 ? '+' : ''}${r.offset}: ${(r.similarity * 100).toFixed(2)}%${r.error ? ' (ERROR)' : ''}${marker}`);
}

console.log(`\nBest offset: ${results[0].offset} (${(results[0].similarity * 100).toFixed(2)}%)`);
console.log(`See: ${results[0].file}`);
