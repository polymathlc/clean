# Scan Cleaner

Drop in a marked worksheet. Get the blank worksheet back.

`index.html` is the whole app — one file, no install, no server. Open it in a browser, drop a
PDF on it, and download the cleaned PDF.

## Which version am I running?

**The version is at the bottom of the app**, with the history behind it. This matters more than
it sounds: the app is one file served from GitHub Pages, and a browser holding on to yesterday's
copy is indistinguishable from a change that did not work. Both look like *"I asked for that to
be fixed and it still does the same thing."*

If the version on the page is not the newest one in that list, the browser is serving a cached
copy — **Ctrl/Cmd + Shift + R** settles it.

---

There are **three ways to get the page back**. The app asks which one, and the notice under the
dropzone changes with the answer, because the three make genuinely different promises about the
file.

|  | **Point out the marks** | **Rebuild it with ChatGPT** | **Lift the ink off** |
|---|---|---|---|
| how | ChatGPT says **which marks** are handwriting; they are erased here | the page is **read and set out again** | the writing is **erased** by rule |
| result | the original page, minus the writing | typeset — sharp at any size | the original page, minus the ink |
| the artwork | **kept exactly** — it is the scan's own pixels | redrawn, and checked against the scan | kept exactly |
| can it change the page? | **no — it never draws anything** | yes, and that is what the audit is for | no |
| a black-and-white scan | fine — it is reading shapes, not colour | fine | the weak case |
| pen written across a printed word | the word survives, the pen goes | fine, the word is transcribed | the word can go with the writing |
| speed | six pages at a time, a few calls each | six at a time, up to four calls each | instant |
| the file | **every page is sent to OpenAI** | **every page is sent to OpenAI** | **never leaves the browser** |
| needs | an OpenAI key | an OpenAI key | nothing |

**Pointing out the marks is the one to reach for**, and it is what the app picks by default when
a key is present. It is the only one of the three that both removes the writing reliably *and*
cannot alter the printed page. Rebuilding is still there for a page so heavily worked that the
print underneath cannot be recovered at all. Lifting the ink off is the original method, needs
no key, and never sends anything anywhere.

---

## Pointing out the marks

The two older methods fail in opposite directions, and both failures land on the same page.

**Lifting the ink off** keeps the artwork exactly, because it never draws anything — it decides,
mark by mark, what to erase. But it decides by *rule*: the colour an ink absorbs, the regularity
of a printed glyph. On a black-and-white scan of a page worked over in pencil there is no colour
to go on and not much regularity either, and it leaves the writing where it is.

**Rebuilding** sees the page as a reader does and has no trouble telling writing from print. But
it hands back a page it has *drawn*, and a model asked to reproduce a diagram will sometimes
reproduce a different diagram.

Neither failure is in the same half of the job. One method is good at deciding and bad at
drawing; the other is only in trouble because it draws at all. So: **let the model decide, and
do the erasing here.**

### How it asks

Not *"where is the handwriting, in pixels"* — that is the one thing these models are measurably
bad at. Asked to regress a bounding box, GPT-4o-class models land within even a loose overlap of
the truth about a fifth of the time, and they systematically *under-cover*: the box comes back
smaller than the thing it is around. An under-covered box is writing left on the page; a mislaid
one is printed text erased. Neither is acceptable here.

What they are good at is answering about something **already marked for them**. That is
[Set-of-Mark prompting](https://arxiv.org/abs/2310.11441): overlay the picture with numbered
regions and ask a question whose answer is a set of *numbers*. It turns a regression the model is
bad at into a multiple choice it is good at, and it beat purpose-built grounding models when it
was published.

This app is unusually well placed to use it, because the regions do not have to be guessed or
segmented by a second network — **the ink cleaner has already found every connected mark on the
page.** So the page goes to the model with its own marks boxed and numbered in magenta, the reply
is a list of numbers, and the erasing happens here.

### What that buys

- **The printed page is the scan's own pixels.** Not redrawn, not typeset, not approximated — a
  photograph stays a photograph and a scale drawing keeps its scale. Nothing can be invented,
  because nothing is drawn.
- **It works with no colour to go on.** The model is reading shapes as a person does, which is
  exactly what the shape rules approximate badly.
- **Silence is not a vote.** A number the model does not mention keeps whatever the ink cleaner
  decided, so a short, lazy or unparseable reply degrades to the old behaviour rather than to a
  blank page. A number in *both* lists is a contradiction and never erases.

### The printed line under the answer

A pen stroke written across a ruled line is **one connected mark**, so calling that mark
handwriting would rub out the worksheet's answer line along with the answer. So furniture — a
rule, an underline, a table border, an axis — is decided **per pixel**, and a furniture pixel is
never erased whatever mark it belongs to. The ink on top goes; the line comes out from under it.

What makes a line a line is its **aspect**: it is very much longer than it is thick. That test is
deliberately scale-free, and two calibrated versions of it were tried first and both leaked:

- *"long enough"* alone protects a handwritten answer, because an answer written across the sheet
  is nearly horizontal for most of its length, so its rows are long runs too;
- *"long, and thinner than the page's typical ink"* needs a stroke width, and both obvious ways to
  measure one are wrong here. Component geometry says a page of run-together words is drawn in a
  6px pen; the thickness map says the same, because the vertical run through the stem of an `l` is
  the *height* of the letter, not the width of its stroke.

A ruled answer line is some hundreds of pixels long and two thick — a ratio in the hundreds. The
flattest stretch of a biro stroke might run 150px, but it is 6px thick doing it, and 25 is not
340.

### Every mark is judged close up

The first version of this asked once, about the whole page, and looked closer only where the
model said print and pen were mixed. A page came back with the whole pencilled answer still on
it and two printed words gone, and both had the same root: **at whole-page zoom a box is a
guess.** The model called a box of printed words handwriting because a teacher's mark sat in it;
it called the answer "both" because the ruled line it was written on was in the box; and a
"handwriting" call on a small box erased its print with no second look. So now there is no
first look.

The page is cut into **strips** of a few lines each, and in every strip:

1. **Furniture is taken out first** — ruled lines, table borders, axes — decided per pixel by
   aspect (a line is at least forty times longer than it is thick). It is never numbered, never
   chained to anything, never erased, and put back if the ink cleaner had taken it. Left in the
   mask, a ruled answer line chained every letter written across it into one piece the width of
   the page — which is how a whole answer came back as one box, was called "both", and stayed.
2. **Touching marks are cut apart.** A pencil line written just above a sentence touches the tops
   of the tall letters, and at scan resolution the letters of a line run into each other, so one
   touch chains the pencil to the whole line. A one-pixel erosion breaks those thin junctions
   while the strokes survive; the pieces are labelled and every ink pixel handed back to the piece
   it grew from.
3. **Pieces are regrouped so letters join into words and nothing else does** — the fine grouping
   asks for real vertical overlap, because the letters of a word share most of their height and a
   pencil line resting on their tops shares almost none.
4. **Every word or stroke gets its own number**, at most two dozen to a picture (density is the
   documented failure of numbered overlays: the model reads a neighbour's number), with the
   badges stepping aside from one another. Two pictures go to the model: the crop **as scanned**,
   to judge the ink by, and the same crop **numbered**, to read the numbers off — boxes drawn on
   a stroke's edge sit exactly where the grain and width variation live.
5. **The prompt names the cues** that tell pencil from toner on a scan — grain, pressure, stroke
   width varying within a letter, letters that differ each time, a wobbling baseline, tapered
   ends — and what the teacher's marks look like, including a single long diagonal tick across a
   whole answer and a tick inside a printed checkbox. It asks for **one key per number**, so
   nothing can be skipped, with `U` for "cannot tell" folding into a closer look rather than a
   guess.
6. **Numbers left out are asked about once more.** A piece the model still calls both — a stroke
   that genuinely *crosses* into a letter — is cut along the **band of height shared by the
   printed words on the same line**: inside the band is the letter, outside it is the pencil.

Two exclusions were removed because each was quietly costing pages. A **"confident toner"**
rule skipped marks the colour pass was sure were print — but that pass runs whenever a page has
any colour on it, one red tick is enough, and black pencil has the same neutral fingerprint as
toner, so on a marked page the pencilled answer was never asked about at all. And the rule test
was **"thin"** when it should have been **"straight"**: a teacher's underline drawn by hand is
thin, and wobbles, and was filed as furniture.

### Measured

`tools/bench.mjs` draws worksheet pages with the print and the handwriting on separate layers,
so every pixel's truth is known, then runs the app with an **oracle** standing in for the model —
it answers each numbered box from the ground truth — and scores the output per pixel. With a
perfect oracle every residual error is the pipeline's, not the model's, which is what makes it
worth measuring. Eight pages, five in pencil and three in colour:

| | handwriting removed | print kept |
|---|---|---|
| mean over pages | **99.6%** | **99.99%** |
| student's writing | 99.8% | |
| teacher's marks | 98.5% | |

Of half a million printed pixels, 46 are lost. The path from 98.1% to this was an independent
judge instrumenting every residual pixel, and every one of its findings was a pipeline defect
rather than a model one: a rule's thickness sampled at a single middle pixel, where a crossing
letter or a table column un-protected the whole line (four fifths of all print ever lost); a big
frame excluded from numbering with the teacher's tick inside it; the band cut *putting back*
ticks the ink cleaner had rightly removed; fine grouping measuring overlap against the shorter
piece, so a tall tick swallowed its neighbours; and boxes called "both" being cut when asking
about their pieces one at a time settles most of them. The cost is calls: about fifty pictures
a page, sent six at a time.

Run it with `node tools/bench.mjs`; `BENCH_NOISE=0.1` flips a tenth of the oracle's answers to
show how the pipeline degrades under a fallible model.

### What it does not fix

A mark the ink cleaner is confident is printed toner is never numbered and never erased by this
path — the last safeguard for a pen written over a word — so such a word may keep a trace of the
pen. The model can still be wrong about a number, and when it is, one piece is erased or kept
wrongly. The summary counts the regions asked about, the areas looked at close up, and the
questions to ChatGPT in all, so a page that took a lot of asking is a page to glance at.

Run `node tools/mark-tests.mjs` after touching any of it. The case to keep green is *"a printed
line under the pencil keeps its words"*: it drives the whole three-round path with a mocked model
that answers by looking at where the boxes really are.

---

## Rebuilding it with ChatGPT

Nothing is erased, because nothing has to be: the model is shown the scan and writes the
**printed** page back as HTML, and the handwriting is simply never transcribed. That HTML is
laid out in a `<foreignObject>`, rasterised onto a canvas at the scan's own resolution, and
goes into the same PDF writer as everything else — so the compare slider, the page sizes and
the download all work unchanged.

**The key is the one the other Polymath apps already use.** The four subject portals and this
app are folders on one GitHub Pages origin, so they share one `localStorage`; this reads the
very slots `polymathlc/cer` reads — `sq_openai_key` and `sq_openai_model` (default
`gpt-5.6-sol`). A key pasted into the Science portal is therefore already here, and there is
nothing to type. It is kept in that browser only and **is never in this repo**: this is a
public static site, so a key committed here is a key given away.

**Nothing is invented.** The prompt is really one instruction said many ways — reproduce what
was printed, remove what was written, and never answer the question. A model that helpfully
fills in a blank has handed the class the answer, which is the only failure here that looks
like success.

**A page that cannot be rebuilt at all falls back to the ink cleaner, and the summary says
so.** A call can be refused, be cut off mid-tag, or come back as markup that will not draw, and
a *missing* page is far worse than an imperfectly cleaned one. What no longer sends a page that
way is the audit merely being unhappy with it — see [the audit](#is-it-the-same-page--the-audit)
below, because that turns out to be the difference between a cleaned page and a photocopy of the
marked one.

**A rate limit is waited out, not paid for with the page.** Six pages go at once, so a 429 is
ordinary. It is not a rejected key, so it was never fatal — it was "this page's problem", and
this page's problem meant the ink cleaner. A burst of rate limiting therefore came back as a
handful of pages with the student's answers still on them, under a summary that said only that
they "could not be rebuilt". Every call now rides out a 429 (four attempts, backing off, and
`Retry-After` is obeyed), and the number of pages in the air halves when the account pushes
back and comes up again after a quiet spell.

The one thing that does not wait and does not fall back is a **rejected key**: thirty pages
quietly cleaned the other way is thirty pages of the wrong answer, so that stops the run and
says which of the two problems it is.

Run `node tools/rebuild-tests.mjs` after touching any of it (needs `playwright`). It drives a
real browser with OpenAI mocked and no network, and every case in it is silent in the app —
the page renders, the PDF downloads, and the PDF is wrong.

---

## Is it the same page? — the audit

A model asked to *reproduce* a page will sometimes **redraw** it. The apparatus comes back with
the funnel a different shape; the boy on the running-watch question is a different boy in
different clothes; the number on the watch face — which was the data the question turned on —
reads 78 instead of what was printed. Nothing errors, the page lays out, the PDF downloads, and
what the class is handed is a **different worksheet that looks like a very tidy version of the
right one**.

That is the only failure in this app that looks like success, so **no page leaves the rebuild
path without being checked against the scan it came from.** There are two checks, and they
answer different questions.

**The measured check is free, and cannot be switched off.** The ink cleaner is run on the page
anyway — it is what a refused rebuild falls back to — so the printed page is already in hand as
a picture, and the rebuild is compared against it: how much is on the page, where on the page it
is, and whether the two read the same way down the sheet. The rebuild is *typeset*, so it never
lands on the scan's own line breaks: the two are aligned first (the best shift and stretch down
the page) and then compared over a grid of big cells. It is a test for **gross** drift — a
figure dropped, a page that came back a third of the size of the one that went in, a page
rearranged — and it is deliberately generous, because a page condemned wrongly is a page the
teacher gets back as a photograph when a typeset one was available.

The two references are **different pictures on purpose**:

| the question | measured against | why |
|---|---|---|
| is something **missing**? | the **cleaned** page | that is the printed page |
| is something **invented**? | the **raw** scan | the scan holds everything that was ever on the paper, so ink in the rebuild with blank paper under it came from nowhere |

Measuring invention against the cleaned page instead would report every printed word the ink
cleaner took with the handwriting as an invention — on exactly the heavily worked pages this
mode exists for.

**The read check is a second opinion, and it is the only one that can see that a drawing is the
wrong drawing.** The scan and the rebuilt page go back together as two pictures, and the model
is asked what changed. It is told in as many words which changes are *the job* — the handwriting
is gone; the page is typeset, not photographed — and which are *the fault*: wording, numbers,
labels, a figure whose parts or values are not the same, a figure redrawn as a different picture
of the same idea, an answer space missing or added, any handwriting that survived, anything
filled in that the page left blank. It costs a second read of each page and can be switched off
under **ChatGPT settings**; the measured check stays on either way, and the notice under the
dropzone counts the trips to OpenAI honestly.

**The audit's answer to a fault is a repair, not a retreat.** A page that fails is **set out
again** — twice if it has to be — told exactly what was wrong with the attempt before it, and
the best of the attempts is the one that ships.

What the audit does *not* do is hand back the ink cleaner's page, and this is the correction to
how it used to work. It used to read as caution: refused twice, so have the safe one instead.
It is not caution. **The pages that get rebuilt are the pages the ink cleaner cannot win** —
that is the whole reason the mode exists — so on a heavily worked sheet "fall back to the ink
cleaner" means handing back the scan with the student's answers and the teacher's ticks still
on it. It arrives looking as though the app did nothing at all, and the summary called it a
safety measure. A figure drawn a little differently is a blemish on a worksheet; a page of
somebody's working handed round the class is not a worksheet.

So a rebuild the audit is still unhappy with **ships, and says so**: the page names what was
still wrong with it, and the summary counts it and asks for it to be looked at. One page to
check beats a page nobody can explain.

**The one exception is a page that is not there.** A rebuild that comes back *ruined* — most of
the sheet blank, the print simply not in it — does fall back, because a blemished page beats a
blank one but a blank one beats nothing. That test is deliberately far tighter than the audit's
own: it asks "is this a page?", not "is this the same page?". A dropped figure does not trip it
and neither does a page laid out differently; only under a quarter of the print's ink, or most
of the comparison grid coming back empty, does. A call that failed outright, markup that would
not draw and a page that rasterised blank go the same way, and they are the only routes from
here to the ink cleaner.

Every path still ends in a page, the summary counts each outcome, and the page itself says which
one it was — including, when a page did have to go the ink cleaner's way, how little of the ink
came off it.

**An audit that cannot be run passes the page and says so.** A refused second opinion, a reply
that will not parse, a network blip — none of them is evidence that the page is wrong, and
throwing away a good rebuild over one is the audit doing the harm it exists to prevent. The page
is kept and counted as unchecked. A *rejected key* still stops the run, from inside the audit as
much as from the rebuild.

Run `node tools/audit-tests.mjs` after touching any of it. Both directions are silent, and the
wrong one is not the obvious one: too timid and the audit is decoration, too eager and the
teacher gets the marked-up scan back instead of a page. The harness holds *refused* and *ruined*
apart on purpose — if `ruined` ever creeps out to cover ordinary drift, the app is quietly back
to returning scans with the writing still on them.

---

## What happens to a page — lifting the ink off

1. **Read.** Each page of the PDF is rendered at 200 dpi. (pdf.js is bundled into the file, so
   this works with no internet connection.)
2. **Straighten.** Text lines pile up into sharp peaks in the horizontal projection only when
   they are level, so the angle that makes those peaks sharpest is the page's skew. Measured to
   about a twentieth of a degree, and only corrected when the evidence is clear.
3. **Flatten the paper.** The paper's own brightness is measured across a grid of the page and
   divided out, so shadows, a curled edge and yellowed paper all become plain white.
4. **Separate the inks** (below).
5. **Sweep the impurities.** Dust, toner splatter and scanner grit go; punctuation stays.
6. **Restore the print.** Surviving toner is pushed back to solid black.
7. **Write the PDF.** Built in, using `CompressionStream` for `/FlateDecode`. Page size and
   count are preserved.

## Telling the writing from the worksheet

**On a colour scan — the absorbance fingerprint.** Printed toner, a blue ballpoint and a red
marking pen all look *dark* to a scanner, so no brightness threshold separates them. Instead of
the colour of a *pixel*, the app measures how much red, green and blue each pixel lost against
white paper, and keeps only the proportions:

| ink | absorbs R | absorbs G | absorbs B |
|---|---|---|---|
| red pen | 0.10 | 0.45 | 0.45 |
| blue pen | 0.44 | 0.36 | 0.20 |
| black toner | 0.33 | 0.34 | 0.33 |

A faint stroke absorbs *less of everything, in the same proportions*. The fingerprint therefore
does not change with pen pressure, stroke thickness or scanner exposure.

Each ink also gets a tolerance sized to **its own measured scatter on that document**. A real
scan is not a swatch book: JPEG compression and resampling smear an ink's fingerprint, and a red
tick can have nine tenths of its pixels smeared past recognition. A fixed tolerance either drops
half of every tick or lets foreign ink in.

**On a black-and-white scan — handwriting by shape.** With no colour to go on, the app reads
regularity. Printed type is machine-regular: every glyph the same height, every stroke the same
width, every baseline level. Each connected mark is scored on stroke-width irregularity, height,
how sparsely it fills its box, run-on width and baseline drift — all measured against the page's
own printed regularity, so the judgement travels between scanners, fonts and resolutions.

**Deciding a whole mark.** Marks are settled as a whole so a stroke does not dissolve into
confetti, under three rules learned from getting them wrong:

- A pixel that matched no ink **abstains** rather than voting to keep. Counting abstentions as
  keep-votes is what lets a noisy scan flip a whole red tick from erased to untouched.
- A vote needs a **quorum** — an absolute floor, not a share of the mark, so the tenth of a tick
  that still reads as red may speak for it, while one or two stray pixels may not.
- A **printed rule, underline or table frame is furniture**: never handwriting, never marking
  ink. Something written across one is settled pixel by pixel, so the ink on top goes and the
  rule underneath stays.

## Measured

Synthetic worksheets — printed questions, handwriting of varying stroke width, red ticks, uneven
lighting, warm paper, grain, 500 dust specks — encoded as JPEG inside a PDF, rendered back
through pdf.js, and scored against the ground-truth ink layers:

| scan | student ink removed | teacher marks removed | **printed text kept** |
|---|---|---|---|
| colour, square on the glass | 99.5% | 93.7% | **100%** |
| colour, 0.9° skew | 99.7% | 92.4% | **100%** |
| colour, 2.0° skew | 99.8% | 88.4% | **100%** |
| colour, 3.5° skew | 99.8% | 88.4% | **100%** |
| black & white, square | 90.3% | 88.5% | **98.1%** |
| black & white, 1.5° skew | 90.3% | 88.5% | **100%** |

Skew detection: 1.5° → 1.44°, −2.3° → −2.24°, 0.6° → 0.56°, 0° → 0°.

The output PDF is read back with pdf.js on every test run, and its structure checked separately
in Node — every xref offset resolves, stream lengths match, and the inflated image is exactly
the declared geometry.

## Known limits

**Lifting the ink off:**

- Where a pen stroke is written **across a printed word**, the two are one connected mark.
  Colour separation still resolves it pixel by pixel; shape detection has to decide the mark as
  a whole and takes the word with it. Rebuilding is the answer to this one.
- **Black pen or pencil on a colour scan** genuinely shares the toner's fingerprint. The app
  detects this and switches to shape detection.
- Ink written over a printed rule leaves a faint trace, because the rule is protected.

**Rebuilding with ChatGPT:**

- The page is **redrawn, not photographed**, so a photograph, a detailed illustration or a
  complicated scale drawing comes back as line art approximating it rather than as itself.
  Where the figure matters more than the text, lift the ink off instead.
- Printed wording buried under heavy working is transcribed as far as it can be read and left
  as blank space where it cannot. It is never guessed at — but it is also not recovered.
- The audit catches a figure **dropped, moved or replaced**, and a second opinion catches one
  **redrawn wrong**. Neither is a pixel comparison of two drawings, and neither can be: the
  rebuilt figure is line art and the scan's is a photograph of print. A small change inside an
  otherwise faithful figure can still get through, which is why a page that turns on a detail of
  its artwork is a page to lift the ink off instead.
- A page the audit could not get right in three attempts **is still shipped**, flagged. That is
  deliberate and it is explained above, but it does mean the flagged pages in a batch are pages
  to look at rather than pages already dealt with. The summary names the first fault and the
  page carries its own.
- It costs one model call a page, two with the second opinion, and up to three more if a page
  has to be set out again. Six pages go at once, so a paper takes about a minute per six rather
  than a minute per page — but **every one of those pages is sent to OpenAI**. Everything the
  pixel cleaner promises about privacy is off in this mode.

## Notes

- Needs a current browser (`createImageBitmap`, `CompressionStream`, pointer events, and — for
  rebuilding — `<foreignObject>` rasterisation, which Chrome and Safari both do).
- Output is grayscale unless the cleaned page turns out to hold real colour, in which case it
  stays in colour. Pages, page sizes and page count are preserved.
- `window.scanCleaner` exposes the pipeline for automated testing.
- All three harnesses take `CHROMIUM_PATH` if the machine's chromium is not the build this
  `playwright` install expects: `CHROMIUM_PATH=… node tools/audit-tests.mjs`.
- `tools/mark-tests.mjs` covers the pointing-out method and the version history;
  `tools/audit-tests.mjs` the rebuild audit and the concurrency; `tools/rebuild-tests.mjs` the
  rebuild path itself; `tools/bench.mjs` measures the pointing-out method against ground truth.
