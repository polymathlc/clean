# Scan Cleaner

A single-page web app for **Polymath Learning Centre** that takes a scanned, marked-up
worksheet and gives you back the clean printed page — students' working and teachers'
red marks erased, scanner grime removed, printed text restored.

Open `index.html` in a browser. Nothing is uploaded: every scan is processed locally,
in the page.

---

## What it does

1. **Load** scans or a PDF (drag and drop, or click). Multi-page PDFs come in as pages.
2. **Auto-detect inks** — one click samples the student's pen, the teacher's red and the
   printer toner, and picks the right removal method for the scan.
3. **Tune** if you need to, with a live before/after divider.
4. **Download** a cleaned PDF, or the pages as PNG/JPEG images.

---

## How it tells the inks apart

### On a colour scan: the absorbance fingerprint

Printed toner, a blue ballpoint and a red marking pen all look *dark* to a scanner, and a
heavy pen press is darker than faint printed text — so no brightness threshold can separate
them. Colour helps, but only if you ask the right question: a faint blue stroke is a pale
blue-grey, which sits numerically close to grey toner.

So the app does not look at the colour of the **pixel**. It looks at the colour of the **ink**.
White paper reflects red, green and blue equally; ink subtracts from that. For each pixel we
measure how much of each channel went missing — its *absorbance* — and keep only the
proportions:

| ink | absorbs R | absorbs G | absorbs B |
|---|---|---|---|
| red pen | 0.10 | 0.45 | 0.45 |
| blue pen | 0.44 | 0.36 | 0.20 |
| black toner | 0.33 | 0.34 | 0.33 |

A faint stroke absorbs *less of everything*, but **in the same proportions**. The fingerprint
is therefore unchanged by pen pressure, stroke thickness, scanner exposure or the shadow
across the page — so one sample of an ink matches every stroke of it.

### On a black-and-white scan: handwriting by shape

With no colour to go on, the app reads regularity instead. Printed type is machine-regular:
every glyph the same height, every stroke the same width, every baseline exactly level.
Handwriting is none of those. Each connected mark is scored on

- height against the page's printed body height,
- stroke width against the page's printed stroke width (from a distance transform),
- **stroke-width irregularity** within the mark — the strongest single signal,
- how sparsely it fills its own bounding box,
- run-on width (cursive words joining up),
- whether it sits on a printed text line.

The threshold is **self-calibrating**: scores are divided by the median score on that same
page, so the setting means "this many times more irregular than a typical mark here" and
travels between scanners, fonts and resolutions. Long thin rules, page-spanning frames and
sparse dotted answer lines are recognised as printed furniture and protected. A lone mark no
taller than the print is only removed if the marks around it read as handwriting too —
handwriting arrives in words, not single letters.

### The rest of the pipeline

- **Paper flattening.** The paper's own brightness is measured on a grid across the page
  (82nd-percentile per cell, smoothed, bilinearly upsampled) and divided out, so shadows,
  a curled edge and yellowed paper become plain white before anything is classified.
- **Whole-mark decisions.** Connected marks vote, so a stroke does not dissolve into
  confetti — but a *confident* colour match is never voted down, which is what stops a
  red grade written across a printed rule from surviving.
- **Despeckle by company, not by size.** A dust speck and a full stop are the same few
  pixels; what separates them is company. Punctuation sits beside its word, dust sits alone
  in white space — so a small mark only goes if no substantial mark is near it. (Dust that
  clusters does not count as its own company.)
- **Print restoration.** Surviving toner is pushed back to solid black through a levels
  curve; gaps left where a pen crossed a printed letter can be closed with *Mend printed
  strokes*.

---

## Measured on synthetic worksheets

Generated worksheets with printed questions, wobbly handwriting of varying stroke width,
red ticks, uneven illumination, warm paper, grain and 500 dust specks:

| scan | student ink removed | teacher marks removed | **printed text kept** |
|---|---|---|---|
| colour, writing in the blank space | 100.0% | 98.5% | **99.9%** |
| colour, writing across the printed line | 99.9% | 98.3% | **91.9%** |
| black & white, writing in the blank space | 90.3% | 88.5% | **99.9%** |
| black & white, writing across the printed line | 90.3% | 88.5% | **75.0%** |

## Known limits

- **A pen stroke written across a printed word** joins it into one mark. Colour separation
  still resolves it pixel by pixel; shape detection has to decide the mark as a whole, so it
  takes the word with it. Use *Restore*, *Mend printed strokes*, or scan in colour.
- **Black pen or pencil on a colour scan** has genuinely the same fingerprint as the toner.
  The app measures the separation and says so, then switches to shape detection.
- Manual tools cover whatever is left: **Erase** and **Restore** brushes, and **Zap stroke**
  to click one whole mark away.

## Notes

- Everything is one self-contained file except **pdf.js**, loaded from cdnjs only when you
  open a PDF. Image files and PDF *writing* need no network at all — the PDF writer is built
  in, using `CompressionStream` for `/FlateDecode`, and emits 1-bit pages in Pure B&W mode
  (a few kB per page).
- Needs a current browser (`createImageBitmap`, `CompressionStream`, pointer events).
- Presets are stored in `localStorage`, so one scanner-and-pen setup can be reused each week.
- `window.scanCleaner` exposes the pipeline for automated testing.
