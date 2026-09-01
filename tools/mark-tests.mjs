/* ============================================================
   Pointing the marks out: does the third method actually erase the
   handwriting, and does it leave the printed page alone?

     node tools/mark-tests.mjs        (needs playwright and chromium)
     CHROMIUM_PATH=… node tools/mark-tests.mjs   (to name the browser)

   This mode exists because the other two fail in opposite directions — the
   ink cleaner keeps the artwork exactly and leaves the writing on a page it
   cannot read; the rebuild removes the writing and redraws the artwork. Here
   the model only ever says WHICH numbered marks are handwriting, and the
   erasing is done locally, so the failures worth hunting are different ones:

   • THE NUMBERING. A page whose marks all merge into one region cannot be
     answered usefully, and a page numbered into three hundred regions cannot
     be answered at all. The grouping has to land in between, on a real page.
   • THE ANSWER MUST NOT BE ABLE TO INVENT. Whatever comes back, the only two
     things that may happen to a pixel are "erased to paper" and "put back
     exactly as scanned". If a reply can produce a third thing, the mode has
     lost the one property it was built for.
   • SILENCE IS NOT A VOTE. A number in neither list keeps the ink cleaner's
     decision. A short reply, a lazy reply or half a reply must degrade to
     the old behaviour, never to a blank page.
   • THE PRINTED PAGE IS THE SCAN'S OWN PIXELS. Not redrawn, not typeset. The
     test for this is pixel identity, and nothing softer will do.
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

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', e => console.log('    [pageerror] ' + e.message));
await page.goto(pathToFileURL(APP).href);

/* ---------- a worksheet, printed and then written on ----------
   Drawn rather than rebuilt, because this mode never draws a page: what it
   is measured on is whether the SCAN's pixels survive, so the fixture has to
   be a scan. The printed half and the handwritten half are drawn separately
   so the test knows the ground truth for every pixel. */
await page.addScriptTag({ content: `
window.sheet = function (what, width, height) {
  width = width || 820; height = height || 1160;
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, width, height);

  const printed = () => {
    g.fillStyle = '#111';
    g.font = '20px Arial, sans-serif';
    g.fillText('32. Jie Lun bought a watch that had a sensor to track his', 60, 120);
    g.fillText('heart rate while he ran.', 60, 148);
    // a printed figure, which is the thing the rebuild path kept redrawing
    g.strokeStyle = '#111'; g.lineWidth = 3;
    g.strokeRect(190, 240, 430, 250);
    g.beginPath(); g.moveTo(250, 450); g.lineTo(590, 450); g.stroke();
    g.beginPath(); g.moveTo(250, 450); g.lineTo(250, 270); g.stroke();
    g.beginPath(); g.moveTo(250, 390); g.lineTo(360, 390); g.lineTo(470, 320); g.lineTo(590, 320); g.stroke();
    g.font = '15px Arial, sans-serif';
    g.fillText('Line F', 490, 310); g.fillText('Line G', 490, 380);
    g.font = '20px Arial, sans-serif';
    g.fillText('a) State which graph shows how his heart rate changed. [1]', 60, 548);
    g.fillText('b) Explain your answer in (a). [2]', 60, 680);
    // printed answer lines — furniture, and they must survive
    g.fillStyle = '#111';
    [596, 720, 764].forEach(y => g.fillRect(60, y, 680, 2));
  };

  const written = () => {
    // the student, in blue, ON the ruled lines
    g.strokeStyle = '#1b46c8'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(80, 588); g.bezierCurveTo(250, 556, 390, 616, 540, 576); g.stroke();
    g.beginPath(); g.moveTo(80, 712); g.bezierCurveTo(260, 680, 420, 740, 600, 696); g.stroke();
    g.beginPath(); g.moveTo(80, 756); g.bezierCurveTo(240, 726, 380, 780, 520, 742); g.stroke();
    // the teacher, in red, out in the margin
    g.strokeStyle = '#c81b1b'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(650, 110); g.lineTo(680, 142); g.lineTo(740, 60); g.stroke();
  };

  if (what === 'printed') printed();
  else if (what === 'written') written();
  else { printed(); written(); }
  return c;
};

/* The scan as a file, so the whole run can be driven end to end. */
window.sheetFile = async function () {
  const canvas = window.sheet('scan');
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  return new File([blob], 'worksheet.png', { type: 'image/png' });
};
` });

/* The ink cleaner reads its settings off a plan worked out from the document
   — which inks are on it, how far each one scatters — so the unit tests below
   have to have one, exactly as a real run would. Working from a hand-written
   plan instead would be testing settings no scan ever produces. */
await page.evaluate(async () => {
  const doc = await window.scanCleaner.openDocument(await window.sheetFile());
  window.scanCleaner.state.plan = await window.scanCleaner.planFor(doc, () => {});
});

console.log('\n1. the numbering — enough regions to be useful, few enough to be answerable');
const grouped = await page.evaluate(() => {
  const scan = window.sheet('scan');
  const cleaned = window.scanCleaner.cleanRendered(scan);
  const clusters = window.scanCleaner.groupMarks(cleaned.marks.components, scan.width, scan.height);
  return {
    count: clusters.length,
    max: window.scanCleaner.markMax,
    numbers: clusters.map(c => c.number),
    tops: clusters.map(c => c.minY),
    components: cleaned.stats.components
  };
});
check('the page really has many more marks than regions',
  grouped.components > grouped.count * 2, grouped.components + ' marks -> ' + grouped.count + ' regions');
check('there is more than one region — the page did not collapse into one box',
  grouped.count > 1, 'regions: ' + grouped.count);
check('and no more than the cap, so the reply stays answerable',
  grouped.count <= grouped.max, grouped.count + ' of at most ' + grouped.max);
check('the numbers run 1..n with none missing or repeated',
  grouped.numbers.join(',') === grouped.numbers.map((_, i) => i + 1).join(','), grouped.numbers.join(','));
check('they are numbered down the page, the way a reader looks',
  grouped.tops.every((y, i) => i === 0 || y >= grouped.tops[i - 1]), grouped.tops.join(','));

console.log('\n2. the picture the model is asked about');
const marked = await page.evaluate(() => {
  const scan = window.sheet('scan');
  const cleaned = window.scanCleaner.cleanRendered(scan);
  const clusters = window.scanCleaner.groupMarks(cleaned.marks.components, scan.width, scan.height);
  const shot = window.scanCleaner.drawMarkedScan(scan, clusters, 700);
  const big = window.scanCleaner.drawMarkedScan(scan, clusters, 4000);
  const g = shot.getContext('2d', { willReadFrequently: true });
  const px = g.getImageData(0, 0, shot.width, shot.height).data;
  let magenta = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] > 170 && px[i + 1] < 110 && px[i + 2] > 130) magenta++;
  }
  return { w: shot.width, h: shot.height, bigW: big.width, bigH: big.height, magenta, clusters: clusters.length };
});
check('it is drawn at the size it is sent at, so the numbers stay legible',
  Math.max(marked.w, marked.h) === 700, marked.w + 'x' + marked.h);
/* Upscaling a scan to reach the send size would only make a blurry picture a
   bigger blurry picture, and cost tokens for the privilege. */
check('but a small scan is never blown up to reach it',
  marked.bigW === 820 && marked.bigH === 1160, marked.bigW + 'x' + marked.bigH);
check('the boxes and numbers are actually on it', marked.magenta > 400, 'magenta pixels: ' + marked.magenta);

console.log('\n3. reading the reply — and what silence means');
const verdicts = await page.evaluate(() => {
  const r = (text, n) => window.scanCleaner.readMarkVerdict(text, n || 8);
  return {
    plain: r('{"handwriting":[2,5],"printed":[1,3]}'),
    fenced: r('```json\\n{"handwriting":[4],"printed":[]}\\n```'),
    chatty: r('Sure! Looking at the page, numbers 2 and 5 are handwriting.'),
    broken: r('{"handwriting":[2,'),
    empty: r(''),
    strings: r('{"handwriting":["2","#5"],"printed":["1"]}'),
    outOfRange: r('{"handwriting":[2,99,0,-1],"printed":[]}'),
    contradiction: r('{"handwriting":[3,4],"printed":[3]}'),
    duplicates: r('{"handwriting":[2,2,2],"printed":[]}'),
    allPrinted: r('{"handwriting":[],"printed":[1,2,3,4,5,6,7,8]}')
  };
});
check('a plain reply is read', verdicts.plain.read
  && verdicts.plain.handwriting.join() === '2,5' && verdicts.plain.printed.join() === '1,3',
  JSON.stringify(verdicts.plain));
check('a fenced reply is read', verdicts.fenced.read && verdicts.fenced.handwriting.join() === '4');
check('numbers written as strings are read', verdicts.strings.handwriting.join() === '2,5', JSON.stringify(verdicts.strings));
check('a number for a region that does not exist is dropped',
  verdicts.outOfRange.handwriting.join() === '2', JSON.stringify(verdicts.outOfRange));
check('a number in BOTH lists belongs to neither — a contradiction never erases',
  verdicts.contradiction.handwriting.join() === '4' && verdicts.contradiction.printed.join() === ''
  && verdicts.contradiction.contested.join() === '3', JSON.stringify(verdicts.contradiction));
check('a number said twice is counted once', verdicts.duplicates.handwriting.join() === '2');
check('a chatty reply erases nothing', !verdicts.chatty.read && verdicts.chatty.handwriting.length === 0);
check('broken JSON erases nothing', !verdicts.broken.read && verdicts.broken.handwriting.length === 0);
check('an empty reply erases nothing', !verdicts.empty.read);
check('"it is all printed" is a real answer, not an empty one',
  verdicts.allPrinted.read && verdicts.allPrinted.printed.length === 8);

console.log('\n4. applying it — the two things that may happen to a pixel, and no third');
const applied = await page.evaluate(() => {
  const scan = window.sheet('scan');
  const cleaned = window.scanCleaner.cleanRendered(scan);
  const clusters = window.scanCleaner.groupMarks(cleaned.marks.components, scan.width, scan.height);
  // say EVERY region is handwriting: the most destructive answer possible
  const all = clusters.map(c => c.number);
  const out = window.scanCleaner.applyMarkVerdict(
    cleaned.canvas, scan, cleaned.marks, clusters,
    { read: true, handwriting: all, printed: [] }, clusters.scale);

  const scanPx = scan.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, scan.width, scan.height).data;
  const outPx = out.canvas.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, scan.width, scan.height).data;
  const cleanPx = cleaned.canvas.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, scan.width, scan.height).data;

  // every pixel must be paper-white, the scan's own value, or untouched from
  // the ink cleaner's page. Anything else is a pixel that was INVENTED.
  let invented = 0;
  for (let i = 0; i < outPx.length; i += 4) {
    const white = outPx[i] > 250 && outPx[i + 1] > 250 && outPx[i + 2] > 250;
    const asScanned = outPx[i] === scanPx[i] && outPx[i + 1] === scanPx[i + 1] && outPx[i + 2] === scanPx[i + 2];
    const asCleaned = outPx[i] === cleanPx[i] && outPx[i + 1] === cleanPx[i + 1] && outPx[i + 2] === cleanPx[i + 2];
    if (!white && !asScanned && !asCleaned) invented++;
  }
  return { invented, erased: out.erased, marks: out.marks, regions: clusters.length };
}, );
check('even "erase everything" invents no pixel', applied.invented === 0, 'invented: ' + applied.invented);
check('it did erase something', applied.erased > 0, 'erased pixels: ' + applied.erased);

console.log('\n5. a printed rule keeps its veto — writing goes, the line stays');
const ruled = await page.evaluate(() => {
  const scan = window.sheet('scan');
  const cleaned = window.scanCleaner.cleanRendered(scan);
  const clusters = window.scanCleaner.groupMarks(cleaned.marks.components, scan.width, scan.height);
  const all = clusters.map(c => c.number);
  const out = window.scanCleaner.applyMarkVerdict(
    cleaned.canvas, scan, cleaned.marks, clusters,
    { read: true, handwriting: all, printed: [] }, clusters.scale);
  const px = out.canvas.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, scan.width, scan.height).data;
  // the printed rules were drawn at y = 596, 720, 764, two pixels tall
  const inkOn = y => {
    let dark = 0;
    for (let x = 70; x < 730; x++) {
      for (let yy = y; yy < y + 2; yy++) {
        const i = (yy * scan.width + x) * 4;
        if (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < 170) dark++;
      }
    }
    return dark;
  };
  return { first: inkOn(596), second: inkOn(720), third: inkOn(764) };
});
check('the printed answer lines are still there', ruled.first > 300 && ruled.second > 300 && ruled.third > 300,
  JSON.stringify(ruled));

console.log('\n5b. ... and the writing that was ON the line really does go');
/* The pair that has to hold together. Sparing the line is only worth doing if
   the answer written across it still comes off — otherwise the safe thing to
   do would be to spare the whole mark and clean nothing. */
const acrossTheLine = await page.evaluate(() => {
  const scan = window.sheet('scan');
  const cleaned = window.scanCleaner.cleanRendered(scan);
  const clusters = window.scanCleaner.groupMarks(cleaned.marks.components, scan.width, scan.height);
  const all = clusters.map(c => c.number);
  const out = window.scanCleaner.applyMarkVerdict(
    cleaned.canvas, scan, cleaned.marks, clusters,
    { read: true, handwriting: all, printed: [] }, clusters.scale);

  // the student's ink is blue; count it in the answer band before and after
  const blueIn = (canvas) => {
    const px = canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 540, scan.width, 260).data;
    let blue = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 2] > px[i] + 40 && px[i + 2] > 80) blue++;
    }
    return blue;
  };
  return { before: blueIn(scan), after: blueIn(out.canvas), spared: out.spared };
});
check('the scan really had blue writing in the answer band',
  acrossTheLine.before > 1500, 'blue before: ' + acrossTheLine.before);
check('almost all of it is gone',
  acrossTheLine.after < acrossTheLine.before * 0.05,
  acrossTheLine.before + ' -> ' + acrossTheLine.after);
/* `spared` is 0 here and that is correct: on this colour fixture the blue is
   a different ink from the rule, so the two are separate marks and the rule
   was never inside a mark being erased. The pixel-level rescue is for the
   case where they really are one mark, which is 5c. */
check('the rules were never at risk on this one', acrossTheLine.spared === 0,
  'spared: ' + acrossTheLine.spared);

console.log('\n5c. black pen drawn ACROSS a printed rule — one mark, two fates');
/* The case the pixel-level rescue exists for, and the one that cannot happen
   on a colour scan: the writing is the same black as the print, so it joins
   the rule into a single connected mark. Calling that mark handwriting is
   right — and erasing all of it would rub out the worksheet's answer line. */
const crossed = await page.evaluate(() => {
  const width = 820, height = 400;
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, width, height);
  // some printed type, so the page has a scale to be measured against
  g.fillStyle = '#111';
  g.font = '20px Arial, sans-serif';
  g.fillText('b) Explain your answer in part (a).', 60, 90);
  g.fillText('Give one reason for your choice.', 60, 120);
  // the printed answer line
  g.fillRect(60, 250, 680, 2);
  // and a black pen answer written across it
  g.strokeStyle = '#111'; g.lineWidth = 6; g.lineCap = 'round';
  g.beginPath();
  g.moveTo(80, 244); g.bezierCurveTo(250, 214, 400, 276, 560, 236);
  g.stroke();

  const cleaned = window.scanCleaner.cleanRendered(c);
  const clusters = window.scanCleaner.groupMarks(cleaned.marks.components, width, height);
  const all = clusters.map(k => k.number);
  const out = window.scanCleaner.applyMarkVerdict(
    cleaned.canvas, c, cleaned.marks, clusters,
    { read: true, handwriting: all, printed: [] }, clusters.scale);

  const px = out.canvas.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, width, height).data;
  const dark = (x0, x1, y0, y1) => {
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      if (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] < 170) n++;
    }
    return n;
  };
  // was the rule and the stroke really ONE mark?
  const labels = cleaned.marks.labels;
  const onRule = labels[251 * width + 700];      // rule, well clear of the writing
  // ... and is any ink well ABOVE the line part of that same mark? If it is,
  // the pen and the rule are one component and the rescue is the only thing
  // standing between the answer line and being rubbed out with the answer.
  let sharesWithStroke = false;
  for (let y = 195; y < 240 && !sharesWithStroke; y++) {
    for (let x = 70; x < 570; x++) {
      if (labels[y * width + x] === onRule) { sharesWithStroke = true; break; }
    }
  }
  return {
    oneMark: onRule >= 0 && sharesWithStroke,
    ruleLeft: dark(600, 740, 250, 252),          // rule, away from the writing
    ruleUnder: dark(100, 500, 250, 252),         // rule, where it was written over
    strokeAbove: dark(100, 540, 200, 240),       // the pen, above the line
    spared: out.spared
  };
});
check('the pen and the rule really are one connected mark', crossed.oneMark, JSON.stringify(crossed));
check('the pen stroke is gone', crossed.strokeAbove === 0, JSON.stringify(crossed));
check('the rule survives away from the writing', crossed.ruleLeft > 120, JSON.stringify(crossed));
check('and the rule survives UNDER the writing too', crossed.ruleUnder > 600, JSON.stringify(crossed));
check('pixels really were spared as printed line', crossed.spared > 0, 'spared: ' + crossed.spared);

console.log('\n6. the whole run, with the model mocked');
let asked = 0, sawPrompt = '';
await page.route('**', route => {
  const url = route.request().url();
  if (url.includes('api.openai.com')) {
    asked++;
    const body = JSON.parse(route.request().postData() || '{}');
    sawPrompt = body.messages[0].content.find(p => p.type === 'text').text;
    // say the LAST two regions are handwriting — on this fixture the written
    // answers are at the bottom of the sheet
    const n = (sawPrompt.match(/1 to (\d+)/) || [])[1] || '4';
    const count = parseInt(n, 10);
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content:
        JSON.stringify({ handwriting: [count - 1, count], printed: [1] }) } }] })
    });
  }
  return url.startsWith('file://') ? route.continue() : route.abort();
});

const run = await page.evaluate(async () => {
  localStorage.setItem('sq_openai_key', 'sk-test-not-a-real-key');
  localStorage.setItem('sq_openai_model', 'gpt-5.6-sol');
  document.getElementById('modeMark').checked = true;
  document.getElementById('modeMark').dispatchEvent(new Event('change'));
  await window.scanCleaner.handleFile(await window.sheetFile());
  const s = window.scanCleaner.state;
  return {
    mode: s.mode, pages: s.pages.length, pointed: s.pointed, markMarks: s.markMarks,
    markFell: s.markFell, rebuilt: s.rebuilt,
    isRebuild: s.pages[0] ? s.pages[0].rebuilt : null,
    bytes: s.pages[0] ? s.pages[0].bytes.length : 0,
    summary: document.getElementById('summary').textContent,
    note: document.getElementById('pageNote').textContent,
    notice: document.getElementById('idleNotice').textContent,
    done: !document.getElementById('stageDone').hidden
  };
});
check('the pointing-out mode really ran', run.mode === 'mark' && run.pointed === 1, JSON.stringify(run));
check('one page came out, and the run finished', run.pages === 1 && run.done && run.bytes > 200, JSON.stringify(run));
check('exactly one trip to OpenAI for the page', asked === 1, 'calls: ' + asked);
check('nothing was rebuilt — this mode never draws a page', run.rebuilt === 0);
check('marks were lifted off', run.markMarks > 0, 'marks: ' + run.markMarks);
check('the summary says what happened', /marks picked out by ChatGPT/.test(run.summary), run.summary);
check('the notice says the page is sent but only numbers come back',
  /only a list of which numbers are handwriting/.test(run.notice), run.notice);

console.log('\n7. what the prompt tells it');
check('it says the boxes were added afterwards and are not on the paper',
  /NOT on the paper/.test(sawPrompt));
check('it defines handwriting as the student AND the teacher',
  /teacher/i.test(sawPrompt) && /ticks/.test(sawPrompt));
check('an empty ruled line is printed, a written-on one is not',
  /An EMPTY ruled line is printed/.test(sawPrompt));
check('it asks to judge by how the mark was MADE, not by what it says',
  /how the mark was MADE/.test(sawPrompt));
check('it asks for JSON and nothing else', /Return ONLY JSON/.test(sawPrompt));
check('"I cannot tell" is allowed, rather than forced into a guess',
  /leave it out of both lists/.test(sawPrompt));

console.log('\n8. a reply that says nothing leaves the ink cleaner\'s page alone');
await page.unroute('**');
await page.route('**', route => {
  const url = route.request().url();
  if (url.includes('api.openai.com')) {
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: 'I am not able to help with that.' } }] }) });
  }
  return url.startsWith('file://') ? route.continue() : route.abort();
});
const mute = await page.evaluate(async () => {
  await window.scanCleaner.handleFile(await window.sheetFile());
  const s = window.scanCleaner.state;
  return {
    pages: s.pages.length, pointed: s.pointed, markFell: s.markFell,
    done: !document.getElementById('stageDone').hidden,
    summary: document.getElementById('summary').textContent,
    note: document.getElementById('pageNote').textContent
  };
});
check('the page is still there', mute.pages === 1 && mute.done, JSON.stringify(mute));
check('it fell back to the ink cleaner rather than to nothing',
  mute.markFell === 1 && mute.pointed === 0, JSON.stringify(mute));
check('and the summary says so', /only the ink cleaner ran/.test(mute.summary), mute.summary);

console.log('\n9. a rejected key stops the run here too');
await page.unroute('**');
await page.route('**', route => {
  const url = route.request().url();
  if (url.includes('api.openai.com')) {
    return route.fulfill({ status: 401, contentType: 'application/json',
      body: '{"error":{"message":"Incorrect API key provided."}}' });
  }
  return url.startsWith('file://') ? route.continue() : route.abort();
});
const badKey = await page.evaluate(async () => {
  await window.scanCleaner.handleFile(await window.sheetFile());
  return { notice: document.getElementById('idleNotice').textContent, idle: !document.getElementById('stageIdle').hidden };
});
check('the run stops and points at the key',
  badKey.idle && /key/i.test(badKey.notice), badKey.notice);

console.log('\n10. the version is on the page, and it is the newest one');
const version = await page.evaluate(() => {
  const releases = window.scanCleaner.releases;
  document.getElementById('versionChip').click();
  const shown = document.getElementById('changelog');
  const text = shown.textContent;
  return {
    version: window.scanCleaner.version,
    label: document.getElementById('versionLabel').textContent,
    newest: releases[0].version,
    open: !shown.hidden,
    saysYouAreRunningIt: /you are running this one/.test(text),
    releases: releases.length,
    title: document.title,
    everyReleaseHasChanges: releases.every(r => r.version && r.date && r.title && r.changes.length)
  };
});
check('the version is shown on the page', version.label === 'v' + version.version, version.label);
check('the running build is the newest in the history', version.version === version.newest,
  version.version + ' vs ' + version.newest);
check('the history opens, and names the build being run',
  version.open && version.saysYouAreRunningIt);
check('there is a real history, not one entry', version.releases >= 3, 'releases: ' + version.releases);
check('every release says what changed', version.everyReleaseHasChanges);
check('the tab title carries the version too', /v\d+\.\d+\.\d+/.test(version.title), version.title);

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
