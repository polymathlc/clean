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
| the artwork | redrawn | kept exactly |
| pen written across a printed word | fine, the word is transcribed | the word can go with the writing |
| speed | about a minute a page | instant |
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

**A page that cannot be rebuilt falls back to the ink cleaner, and the summary says so.** A
call can be refused, be cut off mid-tag, or come back as markup that will not draw, and a
*missing* page is far worse than an imperfectly cleaned one. The one thing that does not fall
back is a **rejected key**: thirty pages quietly cleaned the other way is thirty pages of the
wrong answer, so that stops the run and says which of the two problems it is.

Run `node tools/rebuild-tests.mjs` after touching any of it (needs `playwright`). It drives a
real browser with OpenAI mocked and no network, and every case in it is silent in the app —
the page renders, the PDF downloads, and the PDF is wrong.

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
- It costs one model call a page and takes about a minute each, and **the page is sent to
  OpenAI**. Everything the pixel cleaner promises about privacy is off in this mode.

## Notes

- Needs a current browser (`createImageBitmap`, `CompressionStream`, pointer events, and — for
  rebuilding — `<foreignObject>` rasterisation, which Chrome and Safari both do).
- Output is grayscale unless the cleaned page turns out to hold real colour, in which case it
  stays in colour. Pages, page sizes and page count are preserved.
- `window.scanCleaner` exposes the pipeline for automated testing.
