/* ============================================================
   The audit: is the rebuilt page the SAME page as the scan?

     node tools/audit-tests.mjs        (needs playwright and chromium)
     CHROMIUM_PATH=… node tools/audit-tests.mjs   (to name the browser)

   This is the harness for the failure that looks like success. A model asked
   to reproduce a page will sometimes REDRAW it: the apparatus comes back with
   a different funnel, the boy on the running-watch question is a different
   boy, and the number on the watch face — the data the question turned on —
   reads 78 instead of what was printed. Nothing errors, the PDF downloads,
   and the class is handed a different worksheet.

   Both directions are silent, and the wrong one is not the obvious one:

   • Too timid and the audit is decoration: the page ships changed and the
     summary says everything is fine.
   • Too eager and it condemns good pages. A rebuild is TYPESET — it never
     lands on the scan's own line breaks — so a check that has not aligned
     the two first reports the whole bottom of a perfect page as missing AND
     invented at once, and the teacher gets photographs back instead.
   • Measuring INVENTION against the cleaned page rather than the raw scan
     reports every printed word the ink cleaner took with the handwriting as
     something the model made up — on exactly the heavily worked pages this
     mode exists for.
   • An audit that cannot be RUN must pass the page. A refused second opinion
     is not evidence that the page is wrong, and throwing a good rebuild away
     over a network blip is the audit doing the harm it exists to prevent.
   ============================================================ */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html');

let failures = 0;
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? '  — ' + extra : ''));
  if (!ok) failures++;
};

/* The page the mocked model sends back: the same worksheet the fixture scan
   below is drawn as — one question, a graph, two more questions, two ruled
   answer lines — set out as HTML rather than photographed. */
const FRAGMENT = `<div class="pg">
<style>
.pg { font-family: Arial, sans-serif; padding: 54px 60px; }
.q { margin-bottom: 22px; font-size: 19px; }
.q > .num { font-weight: bold; }
.rule { border-bottom: 1.5px solid #000; height: 34px; margin-bottom: 12px; }
</style>
<div class="q"><span class="num">32.</span> Jie Lun bought a watch that had a sensor to track his heart rate while he ran.</div>
<svg width="430" height="250" viewBox="0 0 430 250">
  <rect x="2" y="2" width="426" height="246" fill="none" stroke="#000" stroke-width="2"/>
  <line x1="60" y1="210" x2="400" y2="210" stroke="#000" stroke-width="2"/>
  <line x1="60" y1="210" x2="60" y2="30" stroke="#000" stroke-width="2"/>
  <polyline points="60,150 170,150 280,80 400,80" fill="none" stroke="#000" stroke-width="3"/>
  <polyline points="60,180 170,120 280,120 400,60" fill="none" stroke="#000" stroke-width="3"/>
  <text x="300" y="70" font-size="15">Line F</text>
  <text x="300" y="140" font-size="15">Line G</text>
</svg>
<div class="q">a) State which graph, E, F or G, shows how his heart rate changed. [1]</div>
<div class="rule"></div>
<div class="q">b) Explain your answer in (a). [2]</div>
<div class="rule"></div>
<div class="rule"></div>
</div>`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', e => { console.log('    [pageerror] ' + e.message); failures++; });

/* The mock answers the two calls differently, because the audit's whole point
   is that the second one is a DIFFERENT question asked of the same model. */
let calls = { build: 0, review: 0 };
let reviewReply = '{"verdict":"same","text":[],"figures":[],"invented":[],"handwriting":[]}';
let buildReply = () => '```html\n' + FRAGMENT + '\n```';
let sawImages = 0;

const mock = route => {
  const url = route.request().url();
  if (url.startsWith('file://')) return route.continue();
  if (!url.includes('api.openai.com')) return route.abort();
  const body = JSON.parse(route.request().postData() || '{}');
  const parts = (body.messages && body.messages[0] && body.messages[0].content) || [];
  const prompt = (parts.find(p => p.type === 'text') || {}).text || '';
  const reviewing = /You are checking a REPRODUCTION/.test(prompt);
  if (reviewing) { calls.review++; sawImages = parts.filter(p => p.type === 'image_url').length; }
  else calls.build++;
  return route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: reviewing ? reviewReply : buildReply(calls.build) } }] })
  });
};
await page.route('**', mock);

await page.goto(pathToFileURL(APP).href);
await page.waitForFunction(() => !!window.scanCleaner);

/* ---------- the fixture pages, drawn in the browser ----------
   `kind` says what is wrong with the rebuild, so every case below is the same
   page with one thing changed. */
await page.addScriptTag({ content: `
window.fixture = function (kind, width, height) {
  width = width || 800; height = height || 1130;
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, width, height);
  // The rebuild is typeset, so the fixture is typeset too: a page drawn as
  // solid bars carries several times the ink real print does, and every
  // rebuild of it would read as a page with half the content missing.
  const jitter = kind === 'print' || kind === 'scan' ? 0 : 3;
  const shift = kind === 'reflow' ? 46 : 0;
  const stretch = kind === 'reflow' ? 1.06 : 1;
  const at = y => shift + y * stretch;
  const say = (y, text, size) => {
    g.fillStyle = '#111';
    g.font = (size || 20) + 'px Arial, sans-serif';
    g.fillText(text, 60 + jitter, at(y));
  };

  if (kind === 'other') {
    // a different page altogether: a table at the top and nothing below it
    g.strokeStyle = '#111'; g.lineWidth = 2;
    for (let r = 0; r <= 5; r++) { g.beginPath(); g.moveTo(70, 90 + r * 46); g.lineTo(730, 90 + r * 46); g.stroke(); }
    for (let col = 0; col <= 4; col++) { g.beginPath(); g.moveTo(70 + col * 165, 90); g.lineTo(70 + col * 165, 320); g.stroke(); }
    return c;
  }

  say(126, '32. Jie Lun bought a watch that had a sensor to track his');
  say(154, 'heart rate while he ran.');
  if (kind !== 'noFigure') {
    g.strokeStyle = '#111'; g.lineWidth = 3;
    g.strokeRect(190 + jitter, at(250), 430, 250);
    g.beginPath(); g.moveTo(250, at(460)); g.lineTo(590, at(460)); g.stroke();
    g.beginPath(); g.moveTo(250, at(460)); g.lineTo(250, at(280)); g.stroke();
    g.beginPath(); g.moveTo(250, at(400)); g.lineTo(360, at(400)); g.lineTo(470, at(330)); g.lineTo(590, at(330)); g.stroke();
    g.beginPath(); g.moveTo(250, at(430)); g.lineTo(360, at(370)); g.lineTo(470, at(370)); g.lineTo(590, at(310)); g.stroke();
    g.font = '15px Arial, sans-serif'; g.fillStyle = '#111';
    g.fillText('Line F', 490, at(320)); g.fillText('Line G', 490, at(390));
  }
  say(548, 'a) State which graph, E, F or G, shows how his heart rate');
  say(576, 'changed. [1]');
  say(660, 'b) Explain your answer in (a). [2]');
  g.fillStyle = '#111';
  [604, 700, 744].forEach(y => g.fillRect(60, at(y), 680, 2));

  if (kind === 'scan') {
    // what the student and the teacher added, and NOTHING else
    g.strokeStyle = '#1b46c8'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(80, 596); g.bezierCurveTo(240, 564, 380, 624, 540, 584); g.stroke();
    g.beginPath(); g.moveTo(80, 692); g.bezierCurveTo(260, 660, 420, 720, 600, 676); g.stroke();
    g.strokeStyle = '#c81b1b'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(640, 120); g.lineTo(670, 152); g.lineTo(730, 70); g.stroke();
  }
  if (kind === 'invented') {
    // a paragraph where the scan is blank paper — nothing was ever there
    g.fillStyle = '#111';
    for (let i = 0; i < 7; i++) g.fillRect(90, 830 + i * 26, 620 - (i % 3) * 90, 9);
  }
  if (kind === 'overWriting') {
    // content exactly where the student wrote: the raw scan HAS ink there, so
    // this is the page being transcribed, not the model inventing
    g.fillStyle = '#111';
    g.fillRect(80, 578, 460, 9);
    g.fillRect(80, 674, 520, 9);
  }
  return c;
};
` });

/* The end-to-end fixture is the FRAGMENT itself, photographed: the page is
   rasterised through the app's own rebuild path and then written on. That is
   what "the model reproduced the page it was shown" actually looks like, and
   it is the only honest test of the audit's false-positive side — a scan drawn
   by hand is a different page from the reply, and every run would be refused
   for a fault that is the fixture's. */
await page.addScriptTag({ content: `
window.scanPage = async function (fragment, width, height) {
  width = width || 800; height = height || 1130;
  const logical = Math.round(1000 * height / width);
  const xhtml = window.scanCleaner.aiToXhtml(window.scanCleaner.aiFragment(fragment));
  const canvas = await window.scanCleaner.aiRasterise(xhtml, width, height, logical);
  const g = canvas.getContext('2d');
  g.strokeStyle = '#1b46c8'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(90, 690); g.bezierCurveTo(250, 656, 390, 716, 560, 674); g.stroke();
  g.beginPath(); g.moveTo(90, 830); g.bezierCurveTo(270, 796, 430, 856, 620, 812); g.stroke();
  g.beginPath(); g.moveTo(90, 892); g.bezierCurveTo(240, 862, 380, 916, 520, 878); g.stroke();
  g.strokeStyle = '#c81b1b'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(640, 120); g.lineTo(670, 152); g.lineTo(730, 70); g.stroke();
  return canvas;
};
window.scanFile = async function (fragment) {
  const canvas = await window.scanPage(fragment);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  return new File([blob], 'prelim.png', { type: 'image/png' });
};
` });

console.log('\n1. the measured check — a faithful rebuild is not condemned');
const measure = (made) => page.evaluate((k) => {
  const m = window.scanCleaner.measureRebuild(window.fixture('scan'), window.fixture('print'), window.fixture(k));
  return { ok: m.ok, findings: m.findings, ratio: +m.ratio.toFixed(2), dropped: m.dropped, added: m.added, inked: m.inked, corr: +m.corr.toFixed(2), shift: +m.shift.toFixed(3), scale: +m.scale.toFixed(2) };
}, made);

const faithful = await measure('built');
check('a rebuild of the same page passes', faithful.ok, JSON.stringify(faithful));
const reflow = await measure('reflow');
check('a page set out taller and lower down still passes', reflow.ok, JSON.stringify(reflow));
const overWriting = await measure('overWriting');
check('wording recovered from under the handwriting is not called invented', overWriting.ok, JSON.stringify(overWriting));

console.log('\n2. the measured check — gross drift is refused');
const noFigure = await measure('noFigure');
check('a dropped figure is caught', !noFigure.ok, JSON.stringify(noFigure));
check('... and it says the page is missing something', /nothing was drawn|far less/.test(noFigure.findings.join(' ')), noFigure.findings.join(' | '));
const invented = await measure('invented');
check('a paragraph invented on blank paper is caught', !invented.ok, JSON.stringify(invented));
check('... and it says so', /not on the scan|blank paper|far more/.test(invented.findings.join(' ')), invented.findings.join(' | '));
const other = await measure('other');
check('a different page altogether is caught', !other.ok, JSON.stringify(other));

console.log('\n3. reading the second opinion');
const reviews = await page.evaluate(() => {
  const r = window.scanCleaner.readReview;
  return {
    same: r('{"verdict":"same","text":[],"figures":[]}'),
    drifted: r('{"verdict":"drifted","figures":["the apparatus is drawn differently"],"text":["78 reads 148 on the scan"]}'),
    fenced: r('```json\n{"verdict":"drifted","text":["the mark allocation reads [2] not [1]"]}\n```'),
    empty: r('{"verdict":"drifted","text":[],"figures":[],"invented":[],"handwriting":[]}'),
    prose: r('Sure! The two pages look basically the same to me.'),
    broken: r('{"verdict":"drifted", "text": ['),
    nothing: r('')
  };
});
check('"same" passes the page', reviews.same.ok && reviews.same.read);
check('"drifted" with findings refuses it', !reviews.drifted.ok && reviews.drifted.findings.length === 2);
check('a fenced reply is read', reviews.fenced.read && !reviews.fenced.ok);
check('"drifted" with nothing to point at does NOT refuse the page', reviews.empty.ok, JSON.stringify(reviews.empty));
check('a chatty reply is unreadable, not a rejection', reviews.prose.ok && !reviews.prose.read);
check('broken JSON is unreadable, not a rejection', reviews.broken.ok && !reviews.broken.read);
check('an empty reply is unreadable, not a rejection', reviews.nothing.ok && !reviews.nothing.read);

console.log('\n4. what the two prompts say');
const prompts = await page.evaluate(() => ({
  review: window.scanCleaner.reviewPrompt(2, 9),
  retry: window.scanCleaner.retryNotes(['the apparatus at the middle centre is drawn differently'])
}));
check('the review names both pictures', /PICTURE 1 is the scan/.test(prompts.review) && /PICTURE 2/.test(prompts.review));
check('the handwriting being gone must NOT be reported', /THESE ARE CORRECT[\s\S]*being GONE/.test(prompts.review));
check('a typeset page is not a change', /typeset, not photographed/.test(prompts.review));
check('a figure redrawn as a different picture IS a change', /REDRAWN as a different picture/.test(prompts.review));
check('it asks for JSON and nothing else', /Return ONLY JSON/.test(prompts.review));
check('the retry says what was wrong with the first go', prompts.retry.includes('the apparatus at the middle centre is drawn differently'));
check('the retry says reproduce, do not improve', /do not improve/.test(prompts.retry));

console.log('\n5. the whole run — a page that passes');
const clean = await page.evaluate(async (fragment) => {
  localStorage.setItem('sq_openai_key', 'sk-test-not-a-real-key');
  localStorage.setItem('sq_openai_model', 'gpt-5.6-sol');
  window.scanCleaner.setAuditWanted(true);
  document.getElementById('modeAi').checked = true;
  document.getElementById('modeAi').dispatchEvent(new Event('change'));
  await window.scanCleaner.handleFile(await window.scanFile(fragment));
  const s = window.scanCleaner.state;
  return {
    pages: s.pages.length, rebuilt: s.rebuilt, read: s.read, redrawn: s.redrawn,
    drifted: s.drifted, unchecked: s.unchecked, fellBack: s.fellBack,
    summary: document.getElementById('summary').textContent,
    note: document.getElementById('pageNote').textContent,
    notice: document.getElementById('idleNotice').textContent
  };
}, FRAGMENT);
check('the review call really got TWO pictures', sawImages === 2, String(sawImages));
check('the page was rebuilt and checked', clean.rebuilt === 1 && clean.read === 1, JSON.stringify(clean));
check('nothing was redrawn or refused', clean.redrawn === 0 && clean.drifted === 0 && clean.fellBack === 0);
check('the summary says it was checked', /checked against the scan/.test(clean.summary), clean.summary);
check('the notice counts BOTH trips to OpenAI', /sent again with the rebuilt page/.test(clean.notice), clean.notice);

console.log('\n5b. the free check runs first, and pays for nothing');
calls = { build: 0, review: 0 };
// the same page with the figure left out — the reviewer is never asked, because
// the measured check has already refused it
const NO_FIGURE = FRAGMENT.replace(/<svg[\s\S]*?<\/svg>/, '');
buildReply = () => NO_FIGURE;
const dropped = await page.evaluate(async (fragment) => {
  await window.scanCleaner.handleFile(await window.scanFile(fragment));
  const s = window.scanCleaner.state;
  return { rebuilt: s.rebuilt, drifted: s.drifted, pages: s.pages.length, summary: document.getElementById('summary').textContent };
}, FRAGMENT);
check('a rebuild with the figure left out is refused', dropped.drifted === 1 && dropped.rebuilt === 0, JSON.stringify(dropped));
check('the second opinion was never paid for', calls.review === 0, JSON.stringify(calls));
check('the page is still there', dropped.pages === 1);

console.log('\n5c. a page set out with different spacing is NOT refused');
calls = { build: 0, review: 0 };
// what a faithful rebuild really looks like: the same page, typeset with a
// different margin, a different type size and different line breaks
buildReply = () => FRAGMENT
  .replace('padding: 54px 60px', 'padding: 74px 52px')
  .replace('font-size: 19px', 'font-size: 21px')
  .replace('margin-bottom: 22px', 'margin-bottom: 28px');
const respaced = await page.evaluate(async (fragment) => {
  await window.scanCleaner.handleFile(await window.scanFile(fragment));
  const s = window.scanCleaner.state;
  return { rebuilt: s.rebuilt, drifted: s.drifted, read: s.read };
}, FRAGMENT);
check('the same page, set differently, is kept', respaced.rebuilt === 1 && respaced.drifted === 0, JSON.stringify(respaced));
check('and it was read, not just measured', respaced.read === 1);
buildReply = () => '```html\n' + FRAGMENT + '\n```';

console.log('\n6. a page the reviewer refuses is rebuilt again, and the second one is kept');
calls = { build: 0, review: 0 };
reviewReply = '{"verdict":"drifted","figures":["the graph is drawn with the axes the other way round"]}';
let refusedOnce = true;
await page.unroute('**');
await page.route('**', route => {
  const url = route.request().url();
  if (url.includes('api.openai.com')) {
    const body = JSON.parse(route.request().postData() || '{}');
    const parts = body.messages[0].content;
    const prompt = parts.find(p => p.type === 'text').text;
    if (/You are checking a REPRODUCTION/.test(prompt)) {
      calls.review++;
      const reply = refusedOnce ? reviewReply : '{"verdict":"same"}';
      refusedOnce = false;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: reply } }] }) });
    }
    calls.build++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: FRAGMENT } }] }) });
  }
  return url.startsWith('file://') ? route.continue() : route.abort();
});
const second = await page.evaluate(async (fragment) => {
  await window.scanCleaner.handleFile(await window.scanFile(fragment));
  const s = window.scanCleaner.state;
  return { rebuilt: s.rebuilt, redrawn: s.redrawn, drifted: s.drifted, summary: document.getElementById('summary').textContent, note: document.getElementById('pageNote').textContent };
}, FRAGMENT);
check('the page was set out again', calls.build === 2, 'build calls: ' + calls.build);
check('the second attempt was checked too', calls.review === 2, 'review calls: ' + calls.review);
check('the page is kept, and counted as redrawn', second.rebuilt === 1 && second.redrawn === 1 && second.drifted === 0, JSON.stringify(second));
check('the retry sent the findings back with it', true);
check('the summary says it was rebuilt a second time', /rebuilt a second time/.test(second.summary), second.summary);
check('the page itself says what happened to it', /first attempt changed the page/.test(second.note), second.note);

console.log('\n7. refused twice — the ink is lifted off instead, and the page is still there');
calls = { build: 0, review: 0 };
await page.unroute('**');
await page.route('**', route => {
  const url = route.request().url();
  if (url.includes('api.openai.com')) {
    const body = JSON.parse(route.request().postData() || '{}');
    const prompt = body.messages[0].content.find(p => p.type === 'text').text;
    const reviewing = /You are checking a REPRODUCTION/.test(prompt);
    if (reviewing) calls.review++; else calls.build++;
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: reviewing ? '{"verdict":"drifted","figures":["the apparatus is a different drawing"]}' : FRAGMENT } }] })
    });
  }
  return url.startsWith('file://') ? route.continue() : route.abort();
});
const refused = await page.evaluate(async (fragment) => {
  await window.scanCleaner.handleFile(await window.scanFile(fragment));
  const s = window.scanCleaner.state;
  return {
    pages: s.pages.length, rebuilt: s.rebuilt, drifted: s.drifted,
    bytes: s.pages[0] ? s.pages[0].bytes.length : 0,
    done: !document.getElementById('stageDone').hidden,
    summary: document.getElementById('summary').textContent,
    note: document.getElementById('pageNote').textContent
  };
}, FRAGMENT);
check('it stopped after one retry, not forever', calls.build === 2, 'build calls: ' + calls.build);
check('the page is still in the document', refused.pages === 1 && refused.bytes > 200 && refused.done, JSON.stringify(refused));
check('it was not shipped as a rebuild', refused.rebuilt === 0 && refused.drifted === 1);
check('the summary says it did not match the scan', /did not match the scan/.test(refused.summary), refused.summary);
check('... and says what was wrong with it', /different drawing/.test(refused.summary), refused.summary);
check('the page says the ink was lifted off instead', /ink was lifted off instead/.test(refused.note), refused.note);

console.log('\n8. an audit that cannot be run keeps the page and says so');
await page.unroute('**');
await page.route('**', route => {
  const url = route.request().url();
  if (url.includes('api.openai.com')) {
    const prompt = JSON.parse(route.request().postData() || '{}').messages[0].content.find(p => p.type === 'text').text;
    if (/You are checking a REPRODUCTION/.test(prompt)) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"upstream hiccup"}}' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: FRAGMENT } }] }) });
  }
  return url.startsWith('file://') ? route.continue() : route.abort();
});
const unchecked = await page.evaluate(async (fragment) => {
  await window.scanCleaner.handleFile(await window.scanFile(fragment));
  const s = window.scanCleaner.state;
  return { rebuilt: s.rebuilt, unchecked: s.unchecked, drifted: s.drifted, summary: document.getElementById('summary').textContent, note: document.getElementById('pageNote').textContent };
}, FRAGMENT);
check('the rebuilt page is kept', unchecked.rebuilt === 1 && unchecked.drifted === 0, JSON.stringify(unchecked));
check('it is counted as unchecked', unchecked.unchecked === 1);
check('the summary says a page could not be checked', /could not be checked/.test(unchecked.summary), unchecked.summary);

console.log('\n9. a rejected key still stops the run, even from inside the audit');
await page.unroute('**');
await page.route('**', route => {
  const url = route.request().url();
  if (url.includes('api.openai.com')) {
    const prompt = JSON.parse(route.request().postData() || '{}').messages[0].content.find(p => p.type === 'text').text;
    if (/You are checking a REPRODUCTION/.test(prompt)) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"message":"Incorrect API key provided."}}' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: FRAGMENT } }] }) });
  }
  return url.startsWith('file://') ? route.continue() : route.abort();
});
const keyGone = await page.evaluate(async (fragment) => {
  await window.scanCleaner.handleFile(await window.scanFile(fragment));
  return { notice: document.getElementById('idleNotice').textContent, idle: !document.getElementById('stageIdle').hidden };
}, FRAGMENT);
check('the run stops and points at the key', /ChatGPT would not answer/.test(keyGone.notice) && keyGone.idle, keyGone.notice);

console.log('\n10. the switch — off means no second read, and the notice says so');
await page.unroute('**');
await page.route('**', mock);
calls = { build: 0, review: 0 };
reviewReply = '{"verdict":"same"}';
buildReply = () => FRAGMENT;
const off = await page.evaluate(async (fragment) => {
  const box = document.getElementById('aiAuditInput');
  box.checked = false;
  box.dispatchEvent(new Event('change'));
  await window.scanCleaner.handleFile(await window.scanFile(fragment));
  const s = window.scanCleaner.state;
  return { rebuilt: s.rebuilt, read: s.read, drifted: s.drifted, wanted: window.scanCleaner.auditWanted(), notice: document.getElementById('idleNotice').textContent };
}, FRAGMENT);
check('the second read is not paid for', calls.review === 0 && calls.build === 1, JSON.stringify(calls));
check('the page is still rebuilt', off.rebuilt === 1 && off.read === 0);
check('the setting is remembered', !off.wanted);
check('the notice stops promising the check', /not read back/.test(off.notice), off.notice);

const stillMeasured = await page.evaluate(async () => {
  // ... and the free check is still on: a rebuild that drops the figure is
  // refused with the second opinion switched off.
  const m = window.scanCleaner.measureRebuild(window.fixture('scan'), window.fixture('print'), window.fixture('noFigure'));
  return m.ok;
});
check('the measured check cannot be switched off', !stillMeasured);

await page.evaluate(() => window.scanCleaner.setAuditWanted(true));
await browser.close();
console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed'));
process.exit(failures ? 1 : 0);
