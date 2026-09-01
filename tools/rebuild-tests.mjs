/* ============================================================
   The ChatGPT rebuild path, in a real browser, with OpenAI mocked.
   Nothing here reaches the network: every request but the app's own file:
   URL is aborted, and api.openai.com is answered from this file.

     node tools/rebuild-tests.mjs        (needs playwright and chromium)

   Every failure this harness pins is SILENT in the app — it renders, it
   downloads a PDF, and the PDF is wrong:

   • aiToXhtml is the one with no error message of its own. A <foreignObject>
     is parsed as XML, so an unclosed <br> makes the whole SVG fail to load
     with nothing logged and the page comes out BLANK; and XMLSerializer
     escapes the text inside <style>, so a descendant combinator returns as
     `&gt;` and every rule after it stops matching — a page that lays out as
     unstyled text and still looks like a page.
   • A network <img> or webfont left in TAINTS the canvas, and the taint is
     not thrown here: it is thrown several steps later inside the PDF writer,
     as an exception about nothing to do with pictures.
   • aiFatal decides whether ONE page falls back or the whole run stops. Get
     it wrong in the timid direction and a rejected key quietly pixel-cleans
     thirty pages, which is thirty pages of the wrong answer with a green
     tick on it.
   • The notice under the dropzone is the app's promise about the file. The
     two modes make OPPOSITE promises, so a notice that does not follow the
     mode is a privacy claim that is false half the time.
   ============================================================ */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html');
const OUT = tmpdir();

let failures = 0;
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? '  — ' + extra : ''));
  if (!ok) failures++;
};

/* A fragment shaped like what the model returns, including the two things
   that break naive XHTML serialisation: an unclosed <br> and a child
   combinator inside <style>. */
const FRAGMENT = `<div class="pg">
<style>
.pg { font-family: Arial, sans-serif; padding: 60px; }
.q { margin-bottom: 26px; }
.q > .num { font-weight: bold; }
.rule { border-bottom: 1px solid #000; height: 30px; }
</style>
<div class="q"><span class="num">32.</span> Jie Lun bought a watch that had a sensor to track his heart rate.</div>
<svg width="420" height="200" viewBox="0 0 420 200">
  <line x1="40" y1="170" x2="400" y2="170" stroke="#000" stroke-width="2"/>
  <line x1="40" y1="170" x2="40" y2="20" stroke="#000" stroke-width="2"/>
  <polyline points="40,90 150,90 260,60 400,60" fill="none" stroke="#000" stroke-width="2"/>
  <text x="300" y="52" font-size="14">Line F</text>
</svg>
<div class="q">a) State which graph, E, F or G, shows how his heart rate changed. [1]<br>
Graph: ______</div>
<div class="q">b) Explain your answer in (a). [2]</div>
<div class="rule"></div>
<div class="rule"></div>
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('console', m => { if (m.type() === 'error') console.log('    [console] ' + m.text()); });
page.on('pageerror', e => { console.log('    [pageerror] ' + e.message); failures++; });

// Block every outbound request except the app itself.
await page.route('**', route => {
  const url = route.request().url();
  if (url.startsWith('file://')) return route.continue();
  if (url.includes('api.openai.com')) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: '```html\n' + FRAGMENT + '\n```' } }] })
    });
  }
  return route.abort();
});

await page.goto(pathToFileURL(APP).href);
await page.waitForFunction(() => !!window.scanCleaner);

console.log('\n1. the helpers');

const frag = await page.evaluate(f => window.scanCleaner.aiFragment('Here is the page:\n```html\n' + f + '\n```\nHope that helps.'), FRAGMENT);
check('a code fence and the prose around it are stripped', frag.startsWith('<div class="pg">') && frag.endsWith('</div>'), frag.slice(0, 30));

const xhtml = await page.evaluate(f => window.scanCleaner.aiToXhtml(window.scanCleaner.aiFragment(f)), FRAGMENT);
check('the unclosed <br> is closed', /<br\s*\/>/.test(xhtml));
check('the child combinator survives serialisation', xhtml.includes('.q > .num'), xhtml.includes('&gt;') ? 'found &gt; in the CSS' : '');
check('the XHTML namespace is on the root', xhtml.includes('http://www.w3.org/1999/xhtml'));

const stripped = await page.evaluate(() => window.scanCleaner.aiToXhtml(
  '<div><script>alert(1)<\/script><img src="https://example.com/a.png"/><link rel="stylesheet" href="https://x/y.css"/><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="/><p>kept</p></div>'
));
check('a <script> is dropped', !/<script/i.test(stripped));
check('a network <img> is dropped', !stripped.includes('example.com'));
check('a <link> is dropped', !stripped.includes('y.css'));
check('a data: image is kept', stripped.includes('data:image/gif'));
check('the real content is kept', stripped.includes('kept'));

const fatal = await page.evaluate(() => {
  const f = window.scanCleaner.aiFatal;
  const withStatus = (s) => { const e = new Error('x'); e.status = s; return e; };
  return {
    unauthorised: f(withStatus(401)),
    notFound: f(withStatus(404)),
    quota: f(new Error('You exceeded your current quota, insufficient_quota')),
    rateLimited: f(withStatus(429)),
    blank: f(new Error('the rebuilt page came out blank')),
    server: f(withStatus(500))
  };
});
check('a 401 stops the run', fatal.unauthorised);
check('a model this account cannot reach stops the run', fatal.notFound);
check('no credit stops the run', fatal.quota);
check('a rate limit does NOT stop the run', !fatal.rateLimited);
check('a blank rebuild does NOT stop the run', !fatal.blank);
check('a 500 does NOT stop the run', !fatal.server);

console.log('\n2. the prompt');
const prompt = await page.evaluate(() => window.scanCleaner.rebuildPrompt(3, 37, 1414));
check('names the page and the total', prompt.includes('page 3 of 37'));
check('forbids answering the question', /NEVER answer the question/.test(prompt));
check('forbids rewording what was printed', /never correct, reword/.test(prompt));
check('asks for the handwriting to go', /REMOVE COMPLETELY/.test(prompt));
check('forbids an external address', /no external address of any kind/.test(prompt));
check('gives the sheet size', prompt.includes('1000 px wide') && prompt.includes('1414 px tall'));

console.log('\n3. rasterising the rebuilt page — the step with no error message of its own');
const raster = await page.evaluate(async (f) => {
  const x = window.scanCleaner.aiToXhtml(window.scanCleaner.aiFragment(f));
  const canvas = await window.scanCleaner.aiRasterise(x, 1000, 1414, 1414);
  return {
    width: canvas.width, height: canvas.height,
    hasInk: window.scanCleaner.canvasHasInk(canvas),
    isColour: window.scanCleaner.canvasIsColour(canvas),
    png: canvas.toDataURL('image/png')
  };
}, FRAGMENT);
check('the canvas is the size asked for', raster.width === 1000 && raster.height === 1414);
check('the rebuilt page is not blank', raster.hasInk);
check('black-on-white is stored as grey, not RGB', !raster.isColour);
writeFileSync(join(OUT, 'scan-cleaner-rebuilt.png'), Buffer.from(raster.png.split(',')[1], 'base64'));

const blank = await page.evaluate(async () => {
  const canvas = await window.scanCleaner.aiRasterise(window.scanCleaner.aiToXhtml('<div></div>'), 400, 500, 500);
  return window.scanCleaner.canvasHasInk(canvas);
});
check('an empty fragment is caught as blank', !blank);

console.log('\n4. the whole run, end to end');
const run = await page.evaluate(async () => {
  // a one-page "scan" as an image file, so openDocument takes the image path
  const c = document.createElement('canvas');
  c.width = 800; c.height = 1130;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#111'; g.font = '22px serif';
  g.fillText('32. Jie Lun bought a watch.', 60, 120);
  g.strokeStyle = '#1b46c8'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(70, 300); g.bezierCurveTo(180, 240, 300, 360, 420, 290); g.stroke();
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'prelim.png', { type: 'image/png' });

  localStorage.setItem('sq_openai_key', 'sk-test-not-a-real-key');
  localStorage.setItem('sq_openai_model', 'gpt-5.6-sol');
  document.getElementById('modeAi').checked = true;
  document.getElementById('modeAi').dispatchEvent(new Event('change'));

  const notice = document.getElementById('idleNotice').textContent;
  await window.scanCleaner.handleFile(file);
  const s = window.scanCleaner.state;
  return {
    notice: notice,
    pages: s.pages.length,
    rebuilt: s.rebuilt,
    fellBack: s.fellBack,
    fallbackWhy: s.fallbackWhy,
    mode: s.mode,
    summary: document.getElementById('summary').textContent,
    doneShown: !document.getElementById('stageDone').hidden,
    pdf: (function () {
      const specs = s.pages.map(p => ({
        bytes: p.bytes, filter: p.filter, colourSpace: p.colourSpace, bits: p.bits,
        width: p.width, height: p.height, pageWidth: 595.28, pageHeight: 841.89
      }));
      return specs.length ? specs[0].bytes.length : 0;
    })()
  };
});
check('the notice tells the truth about the mode', /sent to OpenAI/.test(run.notice), run.notice);
check('one page came out', run.pages === 1);
check('it was rebuilt, not pixel-cleaned', run.rebuilt === 1 && run.fellBack === 0, run.fallbackWhy);
check('the summary says ChatGPT set it out again', /set out again by ChatGPT/.test(run.summary), run.summary);
check('the done stage is shown', run.doneShown);
check('the page carries encoded bytes', run.pdf > 200, String(run.pdf));

console.log('\n5. a PDF really comes out, and pdf.js reads it back');
const pdfBytes = await page.evaluate(async () => {
  const s = window.scanCleaner.state;
  const specs = s.pages.map(p => ({
    bytes: p.bytes, filter: p.filter, colourSpace: p.colourSpace, bits: p.bits,
    width: p.width, height: p.height, pageWidth: 595.28, pageHeight: 841.89
  }));
  const blob = window.scanCleaner.buildPdf(specs);
  const buf = new Uint8Array(await blob.arrayBuffer());
  return Array.from(buf);
});
const pdf = Buffer.from(pdfBytes);
writeFileSync(join(OUT, 'scan-cleaner-rebuilt.pdf'), pdf);
check('it starts with a PDF header', pdf.slice(0, 5).toString() === '%PDF-');
check('it ends with an EOF marker', pdf.slice(-20).toString().includes('%%EOF'));
const reread = await page.evaluate(async (bytes) => {
  // through openDocument, so the bundled worker is the one that reads it
  const file = new File([new Uint8Array(bytes)], 'out.pdf', { type: 'application/pdf' });
  const doc = await window.scanCleaner.openDocument(file);
  const rendered = await doc.renderPage(0);
  return { pages: doc.pageCount, w: rendered.canvas.width, h: rendered.canvas.height, ink: window.scanCleaner.canvasHasInk(rendered.canvas) };
}, pdfBytes);
check('pdf.js reads it back as one page', reread.pages === 1, JSON.stringify(reread));
check('the page in the PDF still has the worksheet on it', reread.ink);

console.log('\n6. a refused key stops the run and says which problem it is');
await page.unroute('**');
await page.route('**', route => {
  const url = route.request().url();
  if (url.startsWith('file://')) return route.continue();
  if (url.includes('api.openai.com')) {
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Incorrect API key provided.' } }) });
  }
  return route.abort();
});
const refused = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 600; c.height = 850;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 850);
  g.fillStyle = '#000'; g.font = '20px serif'; g.fillText('Q1', 40, 80);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  await window.scanCleaner.handleFile(new File([blob], 'p3.png', { type: 'image/png' }));
  return { notice: document.getElementById('idleNotice').textContent, idleShown: !document.getElementById('stageIdle').hidden };
});
check('the run stops rather than silently pixel-cleaning', /ChatGPT would not answer/.test(refused.notice), refused.notice);
check('it points at the key, not at the file', /Check the key/.test(refused.notice));

console.log('\n7. a page that cannot be rebuilt falls back to the ink cleaner');
await page.unroute('**');
await page.route('**', route => {
  const url = route.request().url();
  if (url.startsWith('file://')) return route.continue();
  if (url.includes('api.openai.com')) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"upstream hiccup"}}' });
  return route.abort();
});
const fallback = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 700; c.height = 990;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 700, 990);
  g.fillStyle = '#111'; g.font = '20px serif'; g.fillText('Question 1 — name the process.', 50, 100);
  g.strokeStyle = '#c81b1b'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(400, 200); g.lineTo(430, 230); g.lineTo(490, 160); g.stroke();
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  await window.scanCleaner.handleFile(new File([blob], 'p4.png', { type: 'image/png' }));
  const s = window.scanCleaner.state;
  return { pages: s.pages.length, rebuilt: s.rebuilt, fellBack: s.fellBack, summary: document.getElementById('summary').textContent, done: !document.getElementById('stageDone').hidden };
});
check('the page is still there', fallback.pages === 1 && fallback.done);
check('it was cleaned instead of rebuilt', fallback.rebuilt === 0 && fallback.fellBack === 1);
check('the summary says so', /could not be rebuilt/.test(fallback.summary), fallback.summary);

console.log('\n8. no key means no rebuild mode, and the private promise comes back');
const noKey = await page.evaluate(() => {
  localStorage.removeItem('sq_openai_key');
  document.getElementById('aiForgetBtn').click();
  return {
    disabled: document.getElementById('modeAi').disabled,
    pixelChecked: document.getElementById('modePixel').checked,
    notice: document.getElementById('idleNotice').textContent,
    state: document.getElementById('aiKeyState').textContent
  };
});
check('the rebuild option is switched off', noKey.disabled && noKey.pixelChecked);
check('the notice goes back to "never leaves this browser"', /never leaves this browser/.test(noKey.notice), noKey.notice);
check('the page says why rebuilding is off', /No ChatGPT key/.test(noKey.state));

console.log('\n9. no key is anywhere in the repo');
const src = readFileSync(APP, 'utf-8');
check('no OpenAI-shaped key in the source', !/\bsk-[A-Za-z0-9_-]{20,}/.test(src));

await browser.close();
console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed'));
process.exit(failures ? 1 : 0);
