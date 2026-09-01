# Scan Cleaner

Drop in a marked worksheet. Get the blank worksheet back.

`index.html` is the whole app — one file, no install, no server. Open it in a browser, drop a
PDF on it, and download the cleaned PDF.

There are **two ways to get the page back**, and they are not two settings on one method —
they are opposites, so the app asks which one and the notice under the dropzone changes with
the answer.

|  | **Rebuild it with ChatGPT** | **Lift the ink off the scan** |
|---|---|---|
| how | the page is **read and set out again** | the writing is **erased** from the scan |
| result | typeset — sharp at any size | the original page, minus the ink |
| the artwork | redrawn — and **checked against the scan** | kept exactly |
| pen written across a printed word | fine, the word is transcribed | the word can go with the writing |
| speed | six pages at a time, so about a minute for six | instant |
| checking | every page is measured against the scan, and read back against it | nothing to check — the page is the scan |
| the file | **every page is sent to OpenAI** | **never leaves the browser** |
| needs | an OpenAI key | nothing |

Lifting the ink off is the original method and is documented below. Rebuilding is the one to
reach for on a page that has been **worked over heavily**, where there is more handwriting
than print — which is exactly the case erasing cannot win.

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
- Both harnesses take `CHROMIUM_PATH` if the machine's chromium is not the build this
  `playwright` install expects: `CHROMIUM_PATH=… node tools/audit-tests.mjs`.
