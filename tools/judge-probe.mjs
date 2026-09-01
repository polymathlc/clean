// Temporary probe: why are ruled-line pixels not furniture? Delete after use.
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP || join(HERE, '..', 'index.html');
const BENCH = readFileSync(join(HERE, 'bench.mjs'), 'utf8');
const browserSideSrc = BENCH.slice(BENCH.indexOf('function browserSide()'), BENCH.indexOf('/* ============================================================\n   The run'));
const pageIndex = parseInt(process.argv[2] || '2', 10);
const probeY = process.argv[3] ? process.argv[3].split(',').map(Number) : null;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage();
page.on('pageerror', e => console.log('    [pageerror] ' + e.message));
await page.goto(pathToFileURL(APP).href);
await page.addScriptTag({ content: '(' + browserSideSrc + ')();' });
const seed = 20260901 + pageIndex * 7919;
const scheme = [3, 6, 7].includes(pageIndex % 8) ? 'colour' : 'pencil';
const out = await page.evaluate(async ([seed, scheme, probeY]) => {
  const b = window.bench, sc = window.scanCleaner;
  b.make(seed, scheme, false);
  const W = b.width, H = b.height;
  const doc = await sc.openDocument(await b.file());
  sc.state.plan = await sc.planFor(doc, () => {});
  const cleaned = sc.cleanRendered(b.scan, true);
  const comps = cleaned.marks.components, labels = cleaned.marks.labels;
  const scale = sc.markScale(comps, H);
  const furniture = sc.furnitureMask(labels, W, H, scale);
  const lines = [];
  // find rows that are ruled lines in the truth: rows with >= 200 print px in a straight run
  const rows = [];
  for (let y = 0; y < H; y++) {
    let n = 0, f = 0, ink = 0, runs = 0, cur = 0, maxRun = 0, maxStart = 0, curStart = 0;
    for (let x = 0; x < W; x++) {
      const q = y * W + x;
      if (b.print[q]) { n++; if (furniture[q]) f++; }
      if (labels[q] >= 0) { ink++; if (!cur) curStart = x; cur++; if (cur > maxRun) { maxRun = cur; maxStart = curStart; } } else { if (cur) runs++; cur = 0; }
    }
    if (cur) runs++;
    if (n >= 200 && maxRun >= 300 && (!probeY || probeY.includes(y))) {
      // tall at the middle of the longest run
      const mid = maxStart + Math.floor(maxRun / 2);
      let up = y, down = y;
      while (up > 0 && labels[(up - 1) * W + mid] >= 0) up--;
      while (down < H - 1 && labels[(down + 1) * W + mid] >= 0) down++;
      rows.push({ y, print: n, furn: f, ink, runs, maxRun, maxStart, tallAtMid: down - up + 1, mid });
    }
  }
  return { rows, line: scale.lineHeight };
}, [seed, scheme, probeY]);
console.log('page', pageIndex + 1, scheme, 'line', out.line);
for (const r of out.rows) console.log(`y=${r.y} print=${r.print} furn=${r.furn} ink=${r.ink} runs=${r.runs} maxRun=${r.maxRun}@${r.maxStart} mid=${r.mid} tallAtMid=${r.tallAtMid} ${r.maxRun >= r.tallAtMid * 40 ? '' : '<< FAILS aspect'}`);
await browser.close();
