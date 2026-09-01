// Temporary instrumentation for the judge report. Delete after use.
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html');
const BENCH = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'bench.mjs'), 'utf8');
// lift browserSide() out of bench.mjs verbatim
const start = BENCH.indexOf('function browserSide()');
const end = BENCH.indexOf('/* ============================================================\n   The run');
const browserSideSrc = BENCH.slice(start, end);

const PAGE_INDEXES = (process.argv[2] || '0,1,2,3,4,5,6,7').split(',').map(Number);
const SEED = 20260901;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', e => console.log('    [pageerror] ' + e.message));
page.on('console', m => { if (m.type() === 'log' && m.text().startsWith('DBG')) console.log(m.text()); });
await page.goto(pathToFileURL(APP).href);
await page.addScriptTag({ content: '(' + browserSideSrc + ')();' });

await page.evaluate(() => {
  localStorage.setItem('sq_openai_key', 'sk-bench-not-a-real-key');
  localStorage.setItem('sq_openai_model', 'gpt-5.6-sol');
  window.__boxesByImage = {};
  window.__drawn = [];
  window.scanCleaner.markHooks.drew = function (sent, clusters, closer) {
    const boxes = clusters.map(k => ({ minX: k.minX, minY: k.minY, maxX: k.maxX, maxY: k.maxY, area: k.area, n: k.ids.length }));
    window.__boxesByImage[sent] = boxes;
    window.__drawn.push({ boxes, closer, labels: null });
  };
});

await page.route('**', async route => {
  const url = route.request().url();
  if (!url.includes('api.openai.com')) return url.startsWith('file://') ? route.continue() : route.abort();
  const body = JSON.parse(route.request().postData() || '{}');
  const parts = body.messages[0].content;
  const prompt = parts.find(p => p.type === 'text').text;
  const image = parts.filter(p => p.type === 'image_url').map(p => p.image_url.url).pop();
  const count = parseInt((prompt.match(/1 to (\d+)/) || [])[1] || '0', 10);
  const looked = await page.evaluate(u => {
    const boxes = window.__boxesByImage[u] || null;
    const labels = window.bench.judge(boxes);
    const d = window.__drawn.find(x => x.boxes === boxes);
    if (d) d.labels = labels;
    return { labels };
  }, image);
  const verdict = { handwriting: [], printed: [], both: [] };
  for (let n = 1; n <= count; n++) {
    let label = looked.labels && looked.labels[n - 1];
    if (!label) label = 'both';
    verdict[label].push(n);
  }
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(verdict) } }] }) });
});

for (const i of PAGE_INDEXES) {
  const seed = SEED + i * 7919;
  const scheme = [3, 6, 7].includes(i % 8) ? 'colour' : 'pencil';
  await page.evaluate(([s, sch]) => { window.__boxesByImage = {}; window.__drawn = []; return window.bench.make(s, sch, false); }, [seed, scheme]);
  const out = await page.evaluate(async () => {
    const b = window.bench, sc = window.scanCleaner;
    const W = b.width, H = b.height;
    const doc = await sc.openDocument(await b.file());
    sc.state.plan = await sc.planFor(doc, () => {});
    const cleaned = sc.cleanRendered(b.scan, true);
    const res = await sc.erasePage(b.scan, cleaned, 1, 1, () => {});
    const outData = res.canvas.getContext('2d').getImageData(0, 0, W, H).data;
    const clData = cleaned.canvas.getContext('2d').getImageData(0, 0, W, H).data;
    const luma = (px, j) => 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
    const comps = cleaned.marks.components, labels = cleaned.marks.labels;
    const scale = sc.markScale(comps, H);
    const line = Math.max(6, scale.lineHeight);
    const cand = new Set(sc.markCandidates(comps, scale, W, H));
    const furniture = sc.furnitureMask(labels, W, H, scale);

    // per-component tallies
    const per = new Map();
    const get = id => { let r = per.get(id); if (!r) { r = { id, hwLeft: 0, prLost: 0, hand: 0, print: 0, teach: 0, furn: 0, hwLeftFurn: 0, prLostFurn: 0, cleanerRemoved: 0 }; per.set(id, r); } return r; };
    let hwLeftNoComp = 0, prLostNoComp = 0;
    for (let p = 0, j = 0; p < W * H; p++, j += 4) {
      const id = labels[p];
      const lo = luma(outData, j);
      if (b.hand[p]) {
        if (id < 0) { if (lo <= 200) hwLeftNoComp++; continue; }
        const r = get(id); r.hand++; if (b.teach[p]) r.teach++;
        if (furniture[p]) r.furn++;
        if (luma(clData, j) > 200) r.cleanerRemoved++;
        if (lo <= 200) { r.hwLeft++; if (furniture[p]) r.hwLeftFurn++; }
      } else if (b.print[p] && luma(clData, j) < 170) {
        if (id < 0) { if (lo >= 170) prLostNoComp++; continue; }
        const r = get(id); r.print++;
        if (furniture[p]) r.furn++;
        if (lo >= 170) { r.prLost++; if (furniture[p]) r.prLostFurn++; }
      }
    }
    const bad = [];
    per.forEach(r => {
      if (r.hwLeft < 3 && r.prLost < 3) return;
      const c = comps[r.id];
      // which drawn boxes overlap this component's bbox, and what the oracle said
      const boxes = [];
      window.__drawn.forEach((d, di) => d.boxes.forEach((bx, k) => {
        if (bx.minX <= c.maxX && bx.maxX >= c.minX && bx.minY <= c.maxY && bx.maxY >= c.minY) {
          // how much of this component's ink is inside the box
          let inside = 0;
          for (let y = Math.max(bx.minY, c.minY); y <= Math.min(bx.maxY, c.maxY); y++) for (let x = Math.max(bx.minX, c.minX); x <= Math.min(bx.maxX, c.maxX); x++) if (labels[y * W + x] === r.id) inside++;
          if (!inside) return;
          // oracle ingredients
          const S = window.bench;
          const box = { minX: bx.minX, minY: bx.minY, maxX: bx.maxX, maxY: bx.maxY };
          // recompute p/h with the same boxSum via judge internals: replicate
          let pp = 0, hh = 0, rr = 0;
          for (let y = bx.minY; y <= bx.maxY; y++) for (let x = bx.minX; x <= bx.maxX; x++) { const q = y * W + x; if (S.print[q]) { pp++; } if (S.hand[q]) hh++; }
          boxes.push({ call: di, n: k + 1, label: d.labels && d.labels[k], box: [bx.minX, bx.minY, bx.maxX, bx.maxY], w: bx.maxX - bx.minX + 1, h: bx.maxY - bx.minY + 1, inside, printPxInBox: pp, handPxInBox: hh, pieces: bx.n });
        }
      }));
      bad.push({
        id: r.id, bbox: [c.minX, c.minY, c.maxX, c.maxY], w: c.width, h: c.height, area: c.area,
        hand: r.hand, teach: r.teach, print: r.print, hwLeft: r.hwLeft, hwLeftFurn: r.hwLeftFurn, prLost: r.prLost, prLostFurn: r.prLostFurn,
        furn: r.furn, cleanerRemovedHand: r.cleanerRemoved,
        candidate: cand.has(r.id), furnitureLike: sc.looksLikeFurniture(c, scale), isRule: !!c.isRule, isHandwriting: !!c.isHandwriting, decision: c.decision,
        boxes
      });
    });
    bad.sort((a, b) => (b.hwLeft + b.prLost) - (a.hwLeft + a.prLost));
    return { line, hwLeftNoComp, prLostNoComp, method: sc.state.plan.method, straddled: res.straddled, swept: res.swept, pieces: res.pieces, bad };
  });
  console.log('\n===== page ' + (i + 1) + ' ' + scheme + ' line=' + out.line + ' method=' + out.method + ' straddled=' + out.straddled + ' swept=' + out.swept + ' pieces=' + out.pieces + ' hwLeftNoComp=' + out.hwLeftNoComp + ' prLostNoComp=' + out.prLostNoComp);
  for (const c of out.bad.slice(0, 25)) {
    console.log(`  comp ${c.id} bbox=[${c.bbox}] ${c.w}x${c.h} area=${c.area} hand=${c.hand}(t${c.teach}) print=${c.print} hwLeft=${c.hwLeft}(furn ${c.hwLeftFurn}) prLost=${c.prLost}(furn ${c.prLostFurn}) furn=${c.furn} cand=${c.candidate} furnLike=${c.furnitureLike} isRule=${c.isRule} isHw=${c.isHandwriting} dec=${c.decision} cleanerRemovedHand=${c.cleanerRemovedHand}`);
    for (const bx of c.boxes.slice(0, 8)) console.log(`      box call${bx.call}#${bx.n} [${bx.box}] ${bx.w}x${bx.h} pieces=${bx.pieces} inside=${bx.inside} print=${bx.printPxInBox} hand=${bx.handPxInBox} -> ${bx.label}`);
    if (c.boxes.length > 8) console.log('      ... ' + (c.boxes.length - 8) + ' more boxes');
  }
}
await browser.close();
