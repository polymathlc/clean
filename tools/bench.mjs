/* ============================================================
   Benchmark: how much of the handwriting does the pointing-out method take
   off a worksheet, and how much of the print does it leave standing?

     CHROMIUM_PATH=… node tools/bench.mjs              (8 pages: 5 pencil, 3 colour)
     CHROMIUM_PATH=… node tools/bench.mjs --pages 12
     BENCH_NOISE=0.1 node tools/bench.mjs              (the oracle lies 10% of the time)

   The tests in mark-tests.mjs ask whether each piece of the method works. This
   asks how well the whole thing works, in numbers, on pages that look like
   real marked worksheets — and it can only do that because every page is
   DRAWN here in two layers, so the truth for every pixel is known: printed,
   handwritten, or paper.

   The model is replaced by an ORACLE that answers from that truth. So what is
   measured is the machinery around the model — the numbering, the closer
   look, the furniture veto, the erasing — given a model that is right. With
   BENCH_NOISE it is given a model that is wrong some of the time instead.

   Scores, per page and overall:
   • handwriting removed — handwriting pixels that came out white
   • print kept — print pixels still dark, measured against the INK CLEANER's
     page rather than the scan, because the cleaner thickens toner and "no
     lighter than that" is the real claim
   Before / after / diff PNGs (red = handwriting left, blue = print lost) are
   written for a person to look at.

   Env:  BENCH_HW / BENCH_PRINT  thresholds in percent (default 99 / 99)
         BENCH_NOISE             probability the oracle flips a label (default 0)
         BENCH_SEED              base seed (default 20260901)
         BENCH_OUT               where the PNGs go
         BENCH_ORACLE=strict     count ruled-line pixels as print when judging a
                                 box (default: a written-on ruled line is
                                 handwriting, as the prompt tells the model)
   ============================================================ */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html');

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback; };
const PAGES = Math.max(1, parseInt(flag('--pages', '8'), 10) || 8);
const NOISE = Math.min(1, Math.max(0, parseFloat(process.env.BENCH_NOISE || '0') || 0));
const HW_MIN = parseFloat(process.env.BENCH_HW || '99');
const PRINT_MIN = parseFloat(process.env.BENCH_PRINT || '99');
const SEED = parseInt(process.env.BENCH_SEED || '20260901', 10);
const STRICT = process.env.BENCH_ORACLE === 'strict';
const OUT = process.env.BENCH_OUT
  || '/tmp/claude-0/-home-user-clean/2ac05548-465b-59a7-9847-20f6fd12bc31/scratchpad/bench';
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? '  — ' + extra : ''));
  if (!ok) failures++;
};

/* ---------- a seeded PRNG, used on both sides ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================================================
   The browser side: drawing a marked worksheet in layers, judging boxes
   against the truth, and scoring the result. Injected as source, so it is
   written as an ordinary function here rather than as a string.
   ============================================================ */
function browserSide() {
  const W = 1240, H = 1750;     // ~150 dpi A4
  const PRINT = '#111';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const ctx = c => c.getContext('2d', { willReadFrequently: true });
  const layer = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };

  /* ---------- pen strokes: sampled curves, width varying along them ---------- */
  const lerp = (a, b, t) => a + (b - a) * t;
  function line(p0, p1, n) {
    const pts = [];
    for (let k = 0; k <= n; k++) pts.push([lerp(p0[0], p1[0], k / n), lerp(p0[1], p1[1], k / n)]);
    return pts;
  }
  function quad(p0, c, p1, n) {
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n, u = 1 - t;
      pts.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]);
    }
    return pts;
  }
  function cubic(p0, c1, c2, p1, n) {
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n, u = 1 - t;
      pts.push([
        u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
        u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]]);
    }
    return pts;
  }
  function arc(cx, cy, rx, ry, a0, a1, n, R, wobble) {
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const a = lerp(a0, a1, k / n);
      const j = wobble ? (R() - 0.5) * wobble : 0;
      pts.push([cx + Math.cos(a) * (rx + j), cy + Math.sin(a) * (ry + j)]);
    }
    return pts;
  }
  /* One stroke of a pen: the width drifts from w0 to w1 and wobbles on the way. */
  function stroke(g, pts, colour, w0, w1, phase, lo, hi) {
    g.strokeStyle = colour; g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      const t = i / (pts.length - 1);
      const w = w0 + (w1 - w0) * t + 0.35 * Math.sin(phase + t * Math.PI * 3);
      g.lineWidth = Math.min(hi || 4.5, Math.max(lo || 2.5, w));
      g.beginPath(); g.moveTo(pts[i - 1][0], pts[i - 1][1]); g.lineTo(pts[i][0], pts[i][1]); g.stroke();
    }
  }
  const pen = (g, colour, R) => pts => stroke(g, pts, colour, R(2.5, 4.5), R(2.5, 4.5), R(0, 6.3));

  /* ---------- letters: a small alphabet of shapes, not glyphs ---------- */
  const KINDS = ['arch', 'arch', 'arch', 'bowl', 'bowl', 'bowl', 'stem', 'stem', 'loop', 't', 'desc', 'zig', 'c', 'c', 'm'];
  function letter(g, colour, kind, x, base, h, R) {
    const S = pen(g, colour, R);
    let adv = 0.8 * h, top = base - h, bottom = base;
    switch (kind) {
      case 'arch': S(quad([x, base], [x + 0.4 * h, base - 2.1 * h], [x + 0.8 * h, base], 10)); break;
      case 'm': S(quad([x, base], [x + 0.35 * h, base - 2.0 * h], [x + 0.7 * h, base], 9));
        S(quad([x + 0.7 * h, base], [x + 1.05 * h, base - 2.0 * h], [x + 1.4 * h, base], 9)); adv = 1.45 * h; break;
      case 'bowl': S(arc(x + 0.42 * h, base - 0.5 * h, 0.42 * h, 0.55 * h, 0.2, Math.PI * 2 + 0.6, 14, R, 0.8)); adv = 0.95 * h; break;
      case 'c': S(arc(x + 0.45 * h, base - 0.5 * h, 0.45 * h, 0.55 * h, -0.9, Math.PI * 1.55, 10, R, 0.6)); adv = 0.9 * h; break;
      case 'stem': S(quad([x + 0.1 * h, base - 1.7 * h], [x - 0.1 * h, base - 0.8 * h], [x + 0.1 * h, base], 8));
        adv = 0.4 * h; top = base - 1.7 * h; break;
      case 'loop': S(cubic([x, base], [x + 0.75 * h, base - 2.7 * h], [x - 0.6 * h, base - 2.7 * h], [x + 0.25 * h, base], 14));
        adv = 0.45 * h; top = base - 2.0 * h; break;
      case 't': S(quad([x + 0.15 * h, base - 1.4 * h], [x, base - 0.6 * h], [x + 0.2 * h, base], 8));
        S(line([x - 0.15 * h, base - 0.95 * h], [x + 0.5 * h, base - 1.05 * h], 4)); adv = 0.55 * h; top = base - 1.4 * h; break;
      case 'desc': S(quad([x, base - h], [x + 0.15 * h, base + 0.15 * h], [x + 0.5 * h, base - 0.9 * h], 9));
        S(cubic([x + 0.5 * h, base - 0.9 * h], [x + 0.6 * h, base + 0.7 * h], [x + 0.3 * h, base + 1.05 * h], [x - 0.05 * h, base + 0.75 * h], 10));
        adv = 0.7 * h; bottom = base + h; break;
      case 'zig': S([[x, base - h], [x + 0.32 * h, base + 0.05 * h], [x + 0.64 * h, base - h], [x + 0.96 * h, base], [x + 1.25 * h, base - h]]);
        adv = 1.3 * h; break;
    }
    return { adv: adv, top: top, bottom: bottom, end: [x + adv, base] };
  }
  /* A word: letters chained with baseline jitter (±3px) and height variance (±25%). */
  function word(g, colour, x0, base0, h0, R, style) {
    const n = Math.floor(R(2, 8));
    let x = x0, prev = null, top = 1e9, bottom = -1e9;
    for (let i = 0; i < n; i++) {
      const h = h0 * (1 + (R(0, 1) - 0.5) * 0.5);
      const base = base0 + R(-3, 3);
      const kind = KINDS[Math.floor(R(0, KINDS.length))];
      if (style === 'cursive' && prev) {
        stroke(g, quad(prev, [(prev[0] + x) / 2, base - 0.45 * h], [x + 0.05 * h, base], 5), colour, R(2.5, 3.2), R(2.5, 3.2), R(0, 6.3));
      }
      const r = letter(g, colour, kind, x, base, h, R);
      top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom);
      x += r.adv + (style === 'cursive' ? 0.05 * h : 0.18 * h);
      prev = r.end;
    }
    return { x0: x0, x1: x, top: top, bottom: bottom };
  }
  /* Words along a ruled line, from x0 to about `fill` of the way to x1. */
  function writeLine(g, colour, x0, x1, base0, h0, R, style, fill, record) {
    let x = x0 + R(4, 30);
    const stop = x0 + (x1 - x0) * fill;
    while (x < stop - 2 * h0) {
      const w = word(g, colour, x, base0, h0, R, style);
      if (record) record.push(w);
      x = w.x1 + h0 * R(0.7, 1.1);
    }
  }
  /* Digits and a few capitals, for table cells, circled marks and margin notes. */
  function symbol(g, colour, ch, x, base, h, R) {
    const S = pen(g, colour, R);
    switch (ch) {
      case '0': S(arc(x + 0.35 * h, base - 0.7 * h, 0.35 * h, 0.72 * h, 0.3, Math.PI * 2 + 0.5, 14, R, 0.8)); return 0.85 * h;
      case '1': S(quad([x + 0.35 * h, base - 1.4 * h], [x + 0.3 * h, base - 0.7 * h], [x + 0.4 * h, base], 7)); return 0.7 * h;
      case '2': S(quad([x, base - 1.05 * h], [x + 0.95 * h, base - 1.7 * h], [x + 0.05 * h, base], 10));
        S(line([x + 0.05 * h, base], [x + 0.75 * h, base - 0.05 * h], 4)); return 0.9 * h;
      case '3': S(arc(x + 0.35 * h, base - 1.05 * h, 0.35 * h, 0.35 * h, Math.PI * 1.2, Math.PI * 2.4, 8, R, 0.5));
        S(arc(x + 0.35 * h, base - 0.35 * h, 0.4 * h, 0.38 * h, Math.PI * 1.6, Math.PI * 2.9, 9, R, 0.5)); return 0.9 * h;
      case '4': S([[x + 0.55 * h, base], [x + 0.6 * h, base - 1.4 * h], [x, base - 0.45 * h], [x + 0.8 * h, base - 0.4 * h]]); return 0.9 * h;
      case '7': S([[x, base - 1.35 * h], [x + 0.75 * h, base - 1.4 * h], [x + 0.25 * h, base]]); return 0.85 * h;
      case 'M': S([[x, base], [x + 0.05 * h, base - 1.4 * h], [x + 0.5 * h, base - 0.3 * h], [x + 0.95 * h, base - 1.45 * h], [x + 1.0 * h, base]]); return 1.2 * h;
      case 'C': S(arc(x + 0.55 * h, base - 0.7 * h, 0.55 * h, 0.75 * h, 0.35 * Math.PI, 1.65 * Math.PI, 12, R, 0.8)); return 1.05 * h;
      case 'V': S([[x, base - 1.4 * h], [x + 0.45 * h, base + 0.05 * h], [x + 0.95 * h, base - 1.4 * h]]); return 1.1 * h;
    }
    return 0.8 * h;
  }
  function note(g, colour, text, x, base, h, R) {
    for (const ch of text) x += symbol(g, colour, ch, x, base + R(-2, 2), h * R(0.85, 1.15), R) + 0.15 * h;
  }
  /* The marker's tick: two strokes, the second much longer than the first. */
  function tick(g, colour, x, y, s, R) {
    const S = pts => stroke(g, pts, colour, R(3, 4.5), R(3, 4.5), R(0, 6.3), 2.5, 5);
    const k = [x + 0.3 * s, y + 0.3 * s];
    S(quad([x, y], [x + 0.1 * s, y + 0.2 * s], k, 6));
    S(quad(k, [x + 0.7 * s, y - 0.3 * s], [x + s, y - 0.75 * s], 10));
  }
  function cross(g, colour, x, y, s, R) {
    const S = pen(g, colour, R);
    S(quad([x, y], [x + 0.5 * s + R(-4, 4), y + 0.5 * s], [x + s, y + s], 6));
    S(quad([x + s, y + R(-3, 3)], [x + 0.5 * s, y + 0.5 * s + R(-4, 4)], [x, y + s], 6));
  }

  /* ---------- the page ---------- */
  const SENTENCES = [
    'A student heats 50 g of water in a beaker and records the temperature every minute.',
    'Explain why the temperature stops rising once the water begins to boil.',
    'The table shows the results of an experiment on the extension of a spring.',
    'State one variable that must be kept constant in this investigation.',
    'Describe how the seeds of Plant Z are dispersed, and give one reason for your answer.',
    'Calculate the average speed of the trolley between the two markers. Show your working.',
    'Suggest one improvement to the method that would make the results more reliable.',
    'Name the process by which water vapour in the air becomes liquid on a cold surface.',
    'Mina wanted to find out how the presence of water affects the time taken for the fruits to split.',
    'Using the graph, state the time at which the reaction was complete.',
    'Jie Lun bought a watch that had a sensor to track his heart rate while he ran.',
    'The diagram shows the apparatus used. Label the part that is not drawn to scale.',
    'Give two reasons why the results for trial 3 should not be included in the average.',
    'Predict what would happen to the reading if the mass were doubled. Explain your answer.'
  ];
  const HEADERS = ['Trial', 'Time / s', 'Mass / g', 'Temp / °C', 'Length / cm', 'Volume / cm³', 'Reading', 'Distance / m'];

  const bench = { scan: null, print: null, hand: null, teach: null, width: W, height: H };
  window.bench = bench;

  bench.make = function (seed, scheme, strictOracle) {
    const rnd = mulberry32(seed);
    const R = (a, b) => a + rnd() * (b - a);
    const RI = (a, b) => Math.floor(a + rnd() * (b - a + 1));
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    const grey = () => { const v = RI(0x22, 0x33); return 'rgb(' + v + ',' + v + ',' + v + ')'; };
    const studentInk = () => scheme === 'colour' ? '#1b46c8' : grey();
    const teacherInk = () => scheme === 'colour' ? '#c81b1b' : grey();

    const print = layer(), student = layer(), teacher = layer(), rules = layer();
    const gp = ctx(print), gs = ctx(student), gt = ctx(teacher), gr = ctx(rules);

    const printWords = [];      // for the wobbly underline
    const studentWords = [];    // for the crossing-out
    const answers = [];         // { lines: [{x0, x1, y}], textBase, number }
    const cellsFilled = [];     // for small ticks
    const LEFT = 100, RIGHT = 1140, INDENT = 140;

    const text = (str, x, y, size, align, weight) => {
      gp.font = (weight || '') + ' ' + size + 'px Arial, Helvetica, sans-serif';
      gp.fillStyle = PRINT; gp.textBaseline = 'alphabetic'; gp.textAlign = align || 'left';
      gp.fillText(str, x, y);
      if ((align || 'left') === 'left') {
        let cx = x;
        for (const w of str.split(' ')) {
          const ww = gp.measureText(w).width;
          if (w.length >= 4 && /^[a-z]+$/i.test(w)) printWords.push({ x0: cx, x1: cx + ww, base: y, size: size });
          cx += ww + gp.measureText(' ').width;
        }
      }
    };
    const wrap = (str, maxWidth, size) => {
      gp.font = size + 'px Arial, Helvetica, sans-serif';
      const out = []; let cur = '';
      for (const w of str.split(' ')) {
        const trial = cur ? cur + ' ' + w : w;
        if (gp.measureText(trial).width > maxWidth && cur) { out.push(cur); cur = w; } else cur = trial;
      }
      if (cur) out.push(cur);
      return out;
    };
    const rule = (x, y, w) => { gp.fillStyle = PRINT; gp.fillRect(x, y, w, 2); gr.fillStyle = '#000'; gr.fillRect(x, y, w, 2); };

    // header: name and class on ruled lines, the student's name written on one
    let y = 84;
    text('Name:', LEFT, y, 22); rule(170, y + 4, 450);
    text('Class:', 700, y, 22); rule(780, y + 4, 230);
    writeLine(gs, studentInk(), 180, 610, y + 8, R(15, 20), R, 'cursive', R(0.5, 0.8), studentWords);
    note(gs, studentInk(), pick(['4', '1', '3']) + pick(['C', 'M', 'V']), 800, y + 6, 22, R);
    y += 58;
    text(pick(['Section B', 'Section A', 'Part 2']) + ' — Answer ALL the questions in this section.', LEFT, y, 24, 'left', 'bold');
    y += 54;

    const nQ = RI(4, 8);
    const tableAt = RI(0, nQ - 1);
    const diagramAt = rnd() < 0.55 ? RI(0, nQ - 1) : -1;
    const checkboxAt = rnd() < 0.7 ? RI(0, nQ - 1) : -1;
    const brushAt = RI(0, nQ - 1);
    let number = RI(1, 20);
    let questions = 0;

    for (let q = 0; q < nQ; q++) {
      const size = RI(22, 26), lh = Math.round(size * 1.45);
      const sentences = [pick(SENTENCES)]; if (rnd() < 0.5) sentences.push(pick(SENTENCES));
      if (q === tableAt) sentences.push('Complete the table below with the missing values.');
      if (q === checkboxAt) sentences.push('Tick one box.');
      const lines = wrap(sentences.join(' '), RIGHT - INDENT - 60, size);
      let lineCount = q === tableAt ? 0 : RI(2, 4);
      const extra = (q === tableAt ? RI(3, 5) * 42 + 36 : 0) + (q === checkboxAt ? 56 : 0);
      const needed = lines.length * lh + extra + lineCount * 46 + 40;
      if (y + needed > 1650) {
        if (questions >= 4) break;
        lineCount = Math.max(1, Math.floor((1650 - y - lines.length * lh - extra - 40) / 46));
      }
      questions++;
      // the question
      text(number + '.', LEFT, y, size);
      lines.forEach((ln, i) => text(ln, INDENT, y + i * lh, size));
      const textBase = y + (lines.length - 1) * lh;
      text('[' + RI(1, 2) + ']', RIGHT, textBase, size, 'right');
      y = textBase;

      // a figure, when there is room for one
      if (q === diagramAt && y + 290 + 120 < 1650) {
        const fx = 340, fy = y + 30;
        gp.strokeStyle = PRINT; gp.lineWidth = 2;
        gp.strokeRect(fx, fy, 520, 220);
        gp.beginPath(); gp.moveTo(fx + 60, fy + 25); gp.lineTo(fx + 60, fy + 185); gp.lineTo(fx + 490, fy + 185); gp.stroke();
        // the frame and axes are furniture: the prompt tells the model a printed
        // line passing through a box does not make it "both", so the oracle
        // must not count them either
        gr.strokeStyle = '#000'; gr.lineWidth = 2;
        gr.strokeRect(fx, fy, 520, 220);
        gr.beginPath(); gr.moveTo(fx + 60, fy + 25); gr.lineTo(fx + 60, fy + 185); gr.lineTo(fx + 490, fy + 185); gr.stroke();
        gp.beginPath();
        const pts = RI(3, 6);
        for (let k = 0; k <= pts; k++) {
          const px = fx + 60 + (430 * k) / pts, py = fy + 45 + R(0, 130);
          if (k === 0) gp.moveTo(px, py); else gp.lineTo(px, py);
        }
        gp.stroke();
        text(pick(['Time / s', 'Distance / m']), fx + 250, fy + 210, 16);
        text(pick(['Temperature / °C', 'Speed / m/s']), fx + 70, fy + 18, 16);
        y = fy + 220;
        answers.push({ lines: [], textBase: y, number: number, figure: true });
      }

      // the table, printed numbers with a few blanks for the student
      if (q === tableAt) {
        const cols = RI(3, 5), rows = RI(3, 5), cw = 150, ch = 42, tx = INDENT, ty = y + 26;
        gp.strokeStyle = PRINT; gp.lineWidth = 2;
        for (let r = 0; r <= rows; r++) { gp.beginPath(); gp.moveTo(tx, ty + r * ch); gp.lineTo(tx + cols * cw, ty + r * ch); gp.stroke(); }
        for (let c = 0; c <= cols; c++) { gp.beginPath(); gp.moveTo(tx + c * cw, ty); gp.lineTo(tx + c * cw, ty + rows * ch); gp.stroke(); }
        gr.strokeStyle = '#000'; gr.lineWidth = 2;   // the grid is furniture too
        for (let r = 0; r <= rows; r++) { gr.beginPath(); gr.moveTo(tx, ty + r * ch); gr.lineTo(tx + cols * cw, ty + r * ch); gr.stroke(); }
        for (let c = 0; c <= cols; c++) { gr.beginPath(); gr.moveTo(tx + c * cw, ty); gr.lineTo(tx + c * cw, ty + rows * ch); gr.stroke(); }
        const heads = HEADERS.slice().sort(() => rnd() - 0.5).slice(0, cols);
        heads.forEach((h, c) => text(h, tx + c * cw + 12, ty + 29, 19));
        for (let r = 1; r < rows; r++) for (let c = 0; c < cols; c++) {
          const cx = tx + c * cw, cy = ty + r * ch;
          if (c > 0 && rnd() < 0.3) {
            // a blank the student fills in
            const ink = studentInk(); let x = cx + R(14, 30); const base = cy + ch - R(9, 13);
            const digits = RI(1, 3);
            for (let d = 0; d < digits; d++) x += symbol(gs, ink, pick(['0', '1', '2', '3', '4', '7']), x, base + R(-2, 2), R(15, 20), R) + 3;
            cellsFilled.push({ x: x, y: cy + ch / 2 });
          } else {
            text(c === 0 ? String(r) : (rnd() < 0.5 ? String(RI(0, 99)) : (RI(0, 999) / 10).toFixed(1)), cx + 14, cy + 29, 20);
          }
        }
        y = ty + rows * ch + 10;
      }

      // checkboxes, one of them ticked
      if (q === checkboxAt) {
        const by = y + 22, ticked = RI(0, 2);
        gp.strokeStyle = PRINT; gp.lineWidth = 2;
        ['A', 'B', 'C'].forEach((label, k) => {
          const bx = INDENT + k * 220;
          gp.strokeRect(bx, by, 26, 26);
          gr.strokeStyle = '#000'; gr.lineWidth = 2; gr.strokeRect(bx, by, 26, 26);   // a printed box is furniture
          text(label + '  ' + pick(['12 V', '0.5 A', 'series', 'parallel', 'yes', 'no']), bx + 40, by + 21, 20);
          if (k === ticked) tick(gs, studentInk(), bx - R(2, 6), by + R(8, 14), R(22, 30), R);
        });
        y = by + 30;
      }

      // the ruled answer lines
      const answer = { lines: [], textBase: textBase, number: number, brush: q === brushAt };
      if (lineCount) {
        const w = RI(600, 900);
        for (let k = 0; k < lineCount; k++) {
          const ly = y + 44 + k * 46;
          rule(INDENT, ly, w);
          answer.lines.push({ x0: INDENT, x1: INDENT + w, y: ly });
        }
        y += 44 + (lineCount - 1) * 46;
      }
      answers.push(answer);
      y += 44 + RI(0, 16);
      number++;
    }
    // footer
    text('Continue on the next page', RIGHT, 1708, 20, 'right');
    text(String(RI(2, 14)), 620, 1708, 20);

    // ---- the student: answers written ON the ruled lines
    let brushed = false;
    answers.forEach(a => {
      if (!a.lines.length) return;
      if (rnd() > 0.85 && !a.brush) return;          // a question left blank
      const style = rnd() < 0.6 ? 'cursive' : 'print';
      const h0 = R(14, 22);
      const ink = studentInk();
      const written = a.brush ? a.lines.length : RI(1, a.lines.length);
      for (let k = 0; k < written; k++) {
        const ln = a.lines[k];
        let h = h0, base = ln.y + 4;
        if (a.brush && k === 0 && ln.y - a.textBase < 60) {
          // the tops of the tall letters reach up to brush the printed line above
          h = Math.max(h0, (base - (a.textBase + 3)) / 1.9);
          brushed = true;
        }
        const fill = k === written - 1 ? R(0.3, 0.9) : R(0.75, 1.0);
        writeLine(gs, ink, ln.x0, ln.x1, base, h, R, style, fill, studentWords);
      }
    });
    // a crossing-out over one handwritten word
    if (studentWords.length) {
      const w = studentWords[RI(0, studentWords.length - 1)];
      const pts = []; let up = true;
      for (let x = w.x0 - 2; x <= w.x1 + 2; x += R(5, 9)) { pts.push([x, (up ? w.top - 2 : w.bottom + 2) + R(-2, 2)]); up = !up; }
      if (pts.length > 2) stroke(gs, pts, studentInk(), 3, 3.5, R(0, 6.3));
    }

    // ---- the teacher
    const answered = answers.filter(a => a.lines.length);
    answered.forEach(a => {
      if (rnd() < 0.55) {
        const s = R(60, 160);
        const mid = a.lines[Math.floor(a.lines.length / 2)];
        tick(gt, teacherInk(), R(820, 1060 - s * 0.6), mid.y - R(0, 20), s, R);
      } else if (rnd() < 0.5) {
        cross(gt, teacherInk(), R(1060, 1110), a.textBase + R(10, 40), R(25, 40), R);
      }
    });
    cellsFilled.forEach(c => { if (rnd() < 0.6) tick(gt, teacherInk(), c.x + 4, c.y, R(20, 30), R); });
    // a circled mark in the left margin
    if (answered.length) {
      const a = answered[RI(0, answered.length - 1)];
      const cx = R(44, 62), cy = a.lines[0].y - R(0, 20), r = R(17, 22);
      stroke(gt, arc(cx, cy, r, r * 1.08, -0.4, Math.PI * 2 + 0.3, 26, R, 2), teacherInk(), R(2.5, 3.5), R(2.5, 3.5), R(0, 6.3));
      symbol(gt, teacherInk(), pick(['1', '2', '0']), cx - r * 0.35, cy + r * 0.55, r * 0.8, R);
    }
    // a wobbly underline under a printed word, once or twice
    for (let n = 0; n < RI(1, 2) && printWords.length; n++) {
      const w = printWords[RI(0, printWords.length - 1)];
      const pts = [];
      for (let x = w.x0 - 3; x <= w.x1 + 3; x += 5) pts.push([x, w.base + 6 + Math.sin(x / 7) * 1.6 + R(-0.6, 0.6)]);
      stroke(gt, pts, teacherInk(), R(2.5, 3.5), R(2.5, 3.5), R(0, 6.3));
    }
    // a short note in the margin
    if (answered.length) {
      const a = answered[RI(0, answered.length - 1)];
      note(gt, teacherInk(), pick(['CV', 'M1', 'M2', 'C1']), 1150, a.lines[0].y + R(-10, 30), R(24, 32), R);
    }

    // ---- the scan, and the truth
    const scan = layer();
    const g = ctx(scan);
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.drawImage(print, 0, 0); g.drawImage(student, 0, 0); g.drawImage(teacher, 0, 0);

    const pa = gp.getImageData(0, 0, W, H).data, sa = gs.getImageData(0, 0, W, H).data;
    const ta = gt.getImageData(0, 0, W, H).data, ra = gr.getImageData(0, 0, W, H).data;
    const N = W * H;
    const printMask = new Uint8Array(N), hand = new Uint8Array(N), teach = new Uint8Array(N), vote = new Uint8Array(N);
    let printPx = 0, handPx = 0, teachPx = 0;
    for (let i = 0; i < N; i++) {
      const p = pa[i * 4 + 3] > 127;
      if (p) { printMask[i] = 1; printPx++; if (strictOracle || ra[i * 4 + 3] <= 127) vote[i] = 1; continue; }
      if (ta[i * 4 + 3] > 127) { hand[i] = 1; teach[i] = 1; handPx++; teachPx++; }
      else if (sa[i * 4 + 3] > 127) { hand[i] = 1; handPx++; }
    }
    bench.scan = scan; bench.print = printMask; bench.hand = hand; bench.teach = teach;
    bench.sumPrint = integral(vote); bench.sumHand = integral(hand);
    return { questions: questions, answered: answered.length, printPx: printPx, handPx: handPx, teachPx: teachPx, brushed: brushed };
  };

  /* Summed-area tables, so a box is judged in constant time. */
  function integral(mask) {
    const S = new Int32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        row += mask[y * W + x];
        S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row;
      }
    }
    return S;
  }
  function boxSum(S, b) {
    const x0 = Math.max(0, Math.floor(b.minX)), y0 = Math.max(0, Math.floor(b.minY));
    const x1 = Math.min(W - 1, Math.ceil(b.maxX)), y1 = Math.min(H - 1, Math.ceil(b.maxY));
    if (x1 < x0 || y1 < y0) return 0;
    const s = (x, y) => S[y * (W + 1) + x];
    return s(x1 + 1, y1 + 1) - s(x0, y1 + 1) - s(x1 + 1, y0) + s(x0, y0);
  }
  /* The oracle: a box is handwriting if ≥90% of its ink is, printed if ≥90%
     is, and both otherwise. */
  bench.judge = function (boxes) {
    if (!boxes) return null;
    return boxes.map(b => {
      const p = boxSum(bench.sumPrint, b), h = boxSum(bench.sumHand, b), t = p + h;
      if (!t) return 'printed';
      if (h >= 0.9 * t) return 'handwriting';
      if (p >= 0.9 * t) return 'printed';
      return 'both';
    });
  };

  bench.file = async function () {
    const blob = await new Promise(r => bench.scan.toBlob(r, 'image/png'));
    return new File([blob], 'bench.png', { type: 'image/png' });
  };

  /* Pixel scoring against the truth, and the diff picture. */
  bench.score = function (out, cleaned) {
    const o = ctx(out).getImageData(0, 0, W, H).data;
    const c = ctx(cleaned).getImageData(0, 0, W, H).data;
    const diff = layer(); const gd = ctx(diff); const d = gd.createImageData(W, H); const dd = d.data;
    const luma = (px, i) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    let hwAll = 0, hwWhite = 0, teAll = 0, teWhite = 0, prDark = 0, prKept = 0;
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      const lo = luma(o, j);
      let r = 255, gch = 255, b = 255;
      if (lo < 170) { r = gch = b = 205; }
      if (bench.hand[i]) {
        hwAll++;
        const white = lo > 200;
        if (white) hwWhite++; else { r = 220; gch = 30; b = 30; }
        if (bench.teach[i]) { teAll++; if (white) teWhite++; }
      } else if (bench.print[i] && luma(c, j) < 170) {
        prDark++;
        if (lo < 170) prKept++; else { r = 30; gch = 60; b = 230; }
      }
      dd[j] = r; dd[j + 1] = gch; dd[j + 2] = b; dd[j + 3] = 255;
    }
    gd.putImageData(d, 0, 0);
    return {
      hwAll: hwAll, hwWhite: hwWhite, teAll: teAll, teWhite: teWhite, prDark: prDark, prKept: prKept,
      before: bench.scan.toDataURL('image/png'), after: out.toDataURL('image/png'), diff: diff.toDataURL('image/png')
    };
  };
}

/* ============================================================
   The run
   ============================================================ */
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', e => console.log('    [pageerror] ' + e.message));
await page.goto(pathToFileURL(APP).href);
await page.addScriptTag({ content: '(' + browserSide.toString() + ')();' });

/* The app calls this with every picture as it is sent and the boxes numbered
   on it — in PAGE coordinates, for the close-ups too — so the oracle can look
   its own picture up. Several are in flight at once; the data URL is the key. */
await page.evaluate(() => {
  localStorage.setItem('sq_openai_key', 'sk-bench-not-a-real-key');
  localStorage.setItem('sq_openai_model', 'gpt-5.6-sol');
  window.__boxesByImage = {};
  window.scanCleaner.markHooks.drew = function (sent, clusters) {
    window.__boxesByImage[sent] = clusters.map(k => ({ minX: k.minX, minY: k.minY, maxX: k.maxX, maxY: k.maxY }));
  };
});

/* The oracle. With BENCH_NOISE, each label is flipped with that probability —
   decided from the box's own coordinates so the run stays deterministic
   whatever order the requests arrive in. */
const tally = { calls: 0, whole: 0, close: 0, misses: 0, flips: 0, labels: 0, seed: 0 };
const OTHER = { handwriting: ['printed', 'both'], printed: ['handwriting', 'both'], both: ['handwriting', 'printed'] };
await page.route('**', async route => {
  const url = route.request().url();
  if (!url.includes('api.openai.com')) return url.startsWith('file://') ? route.continue() : route.abort();
  const body = JSON.parse(route.request().postData() || '{}');
  const parts = body.messages[0].content;
  const prompt = parts.find(p => p.type === 'text').text;
  const image = parts.filter(p => p.type === 'image_url').map(p => p.image_url.url).pop();
  const count = parseInt((prompt.match(/1 to (\d+)/) || [])[1] || '0', 10);
  const closer = /CLOSE-UP/.test(prompt);
  tally.calls++; if (closer) tally.close++; else tally.whole++;
  const looked = await page.evaluate(u => ({ boxes: window.__boxesByImage[u] || null, labels: window.bench.judge(window.__boxesByImage[u]) }), image);
  const verdict = { handwriting: [], printed: [], both: [] };
  for (let n = 1; n <= count; n++) {
    let label = looked.labels && looked.labels[n - 1];
    if (!label) { tally.misses++; label = 'both'; }
    else if (NOISE > 0) {
      const b = looked.boxes[n - 1];
      const h = (tally.seed ^ Math.imul(b.minX | 0, 73856093) ^ Math.imul(b.minY | 0, 19349663)
        ^ Math.imul(b.maxX | 0, 83492791) ^ Math.imul(b.maxY | 0, 2654435761)) >>> 0;
      const r = mulberry32(h);
      if (r() < NOISE) { label = OTHER[label][r() < 0.5 ? 0 : 1]; tally.flips++; }
    }
    tally.labels++;
    verdict[label].push(n);
  }
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(verdict) } }] }) });
});

console.log('\nbench: ' + PAGES + ' page(s), seed ' + SEED + (NOISE ? ', oracle noise ' + NOISE : ', oracle exact')
  + (STRICT ? ', strict boxes' : '') + ', thresholds hw ≥ ' + HW_MIN + '% print ≥ ' + PRINT_MIN + '%');
console.log('pictures -> ' + OUT + '\n');

const rows = [];
const pct = (a, b) => b ? (100 * a / b) : 100;
const fmt = (v, w, d) => (typeof v === 'number' ? v.toFixed(d === undefined ? 2 : d) : String(v)).padStart(w);
const writePng = (name, dataUrl) => writeFileSync(join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));

for (let i = 0; i < PAGES; i++) {
  const seed = SEED + i * 7919;
  const scheme = [3, 6, 7].includes(i % 8) ? 'colour' : 'pencil';
  const before = { calls: tally.calls, whole: tally.whole, close: tally.close, misses: tally.misses, flips: tally.flips };
  tally.seed = seed;

  const made = await page.evaluate(([s, sch, strict]) => {
    window.__boxesByImage = {};
    return window.bench.make(s, sch, strict);
  }, [seed, scheme, STRICT]);

  const run = await page.evaluate(async () => {
    const b = window.bench, sc = window.scanCleaner;
    const doc = await sc.openDocument(await b.file());
    sc.state.plan = await sc.planFor(doc, () => {});
    const t0 = performance.now();
    const cleaned = sc.cleanRendered(b.scan, true);
    const tClean = performance.now() - t0;
    const out = await sc.erasePage(b.scan, cleaned, 1, 1, () => {});
    const ms = performance.now() - t0;
    const score = b.score(out.canvas, cleaned.canvas);
    return Object.assign(score, {
      ms: ms, tClean: tClean, method: sc.state.plan.method,
      regions: out.regions || 0, refined: out.refined || 0, pieces: out.pieces || 0,
      failed: out.failed || 0, calls: out.calls || 0, swept: out.swept || 0
    });
  });

  const stem = 'page-' + String(i + 1).padStart(2, '0') + '-' + scheme;
  writePng(stem + '-before.png', run.before);
  writePng(stem + '-after.png', run.after);
  writePng(stem + '-diff.png', run.diff);

  const row = {
    n: i + 1, seed: seed, scheme: scheme, method: run.method, questions: made.questions, brushed: made.brushed,
    hwAll: run.hwAll, hwWhite: run.hwWhite, teAll: run.teAll, teWhite: run.teWhite, prDark: run.prDark, prKept: run.prKept,
    hw: pct(run.hwWhite, run.hwAll), student: pct(run.hwWhite - run.teWhite, run.hwAll - run.teAll), teacher: pct(run.teWhite, run.teAll),
    print: pct(run.prKept, run.prDark),
    regions: run.regions, refined: run.refined, pieces: run.pieces, failed: run.failed,
    calls: tally.calls - before.calls, whole: tally.whole - before.whole, close: tally.close - before.close,
    misses: tally.misses - before.misses, flips: tally.flips - before.flips,
    appCalls: run.calls, seconds: run.ms / 1000, cleanSeconds: run.tClean / 1000
  };
  rows.push(row);
  console.log('  page ' + row.n + ' ' + scheme.padEnd(6) + ' seed ' + seed + ': ' + made.questions + ' questions, '
    + made.handPx + ' handwriting px (' + made.teachPx + ' teacher), ' + made.printPx + ' print px'
    + (made.brushed ? ', one answer brushes the print' : '')
    + ' -> hw removed ' + row.hw.toFixed(2) + '%, print kept ' + row.print.toFixed(2) + '%, '
    + row.calls + ' calls, ' + row.seconds.toFixed(1) + 's');
}

/* ---------- the table ---------- */
console.log('\n  #  ink     plan    regions  calls (whole+close)  refined  pieces  failed   hw removed  student  teacher   print kept    time');
rows.forEach(r => {
  console.log('  ' + String(r.n).padStart(2) + '  ' + r.scheme.padEnd(7) + ' ' + String(r.method || '?').padEnd(7)
    + fmt(r.regions, 8, 0) + fmt(r.calls, 7, 0) + ' (' + r.whole + '+' + r.close + ')'.padEnd(12 - String(r.whole + '+' + r.close).length)
    + fmt(r.refined, 6, 0) + fmt(r.pieces, 8, 0) + fmt(r.failed, 8, 0)
    + fmt(r.hw, 12) + '%' + fmt(r.student, 8) + '%' + fmt(r.teacher, 8) + '%' + fmt(r.print, 12) + '%' + fmt(r.seconds, 7, 1) + 's');
});
const mean = key => rows.reduce((t, r) => t + r[key], 0) / rows.length;
const sum = key => rows.reduce((t, r) => t + r[key], 0);
const meanHw = mean('hw'), meanPrint = mean('print');
const pixHw = pct(sum('hwWhite'), sum('hwAll')), pixPrint = pct(sum('prKept'), sum('prDark'));
console.log('\n  mean over pages:     handwriting removed ' + meanHw.toFixed(2) + '%   (student ' + mean('student').toFixed(2)
  + '%, teacher ' + mean('teacher').toFixed(2) + '%)   print kept ' + meanPrint.toFixed(2) + '%');
console.log('  over all pixels:     handwriting removed ' + pixHw.toFixed(2) + '%   print kept ' + pixPrint.toFixed(2) + '%');
console.log('  handwriting left:    ' + (sum('hwAll') - sum('hwWhite')) + ' px of ' + sum('hwAll')
  + '      print lost: ' + (sum('prDark') - sum('prKept')) + ' px of ' + sum('prDark'));
console.log('  calls to the mock:   ' + sum('calls') + ' in all, ' + mean('calls').toFixed(1) + ' a page ('
  + mean('whole').toFixed(1) + ' whole-page, ' + mean('close').toFixed(1) + ' close-up); ' + sum('refined') + ' areas looked at close up');
console.log('  time:                ' + mean('seconds').toFixed(1) + 's a page (' + mean('cleanSeconds').toFixed(1)
  + 's of it the ink cleaner), ' + sum('seconds').toFixed(0) + 's in all'
  + (NOISE ? '\n  oracle noise:        ' + sum('flips') + ' of ' + tally.labels + ' labels flipped' : ''));
const byScheme = s => rows.filter(r => r.scheme === s);
['pencil', 'colour'].forEach(s => {
  const rs = byScheme(s); if (!rs.length) return;
  console.log('  ' + (s + ' pages:').padEnd(21) + 'handwriting removed ' + (rs.reduce((t, r) => t + r.hw, 0) / rs.length).toFixed(2)
    + '%   print kept ' + (rs.reduce((t, r) => t + r.print, 0) / rs.length).toFixed(2) + '%   (' + rs.length + ' pages)');
});

console.log('\nchecks');
check('every page had handwriting on it, and the app asked about every page',
  rows.every(r => r.hwAll > 0 && r.regions > 0 && r.calls > 0), rows.map(r => r.regions + '/' + r.calls).join(' '));
check('the oracle found the boxes for every picture it was asked about', sum('misses') === 0, 'lookups missed: ' + sum('misses'));
check('at least one page had an answer brushing the printed line above it', rows.some(r => r.brushed));
check('handwriting removed ≥ ' + HW_MIN + '% (mean over pages)', meanHw >= HW_MIN, meanHw.toFixed(2) + '%');
check('print kept ≥ ' + PRINT_MIN + '% (mean over pages)', meanPrint >= PRINT_MIN, meanPrint.toFixed(2) + '%');

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
