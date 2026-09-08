# Loreforge webpage redesign — 2026-09-08

Completed locally; no deployment or publication.

## Delivered

- Warm paper, charcoal, olive and amber visual system; new wordmark treatment and favicon.
- Responsive hero with an accessible diagram showing two independent sessions sharing a record.
- Three-stage interactive workflow: record a finding, retrieve context, record a review.
- Capability overview, npm quick start, copy controls, source-installation instructions and native FAQ disclosures.
- Quick start and capability labels match the live published 0.2.0-alpha.1 alpha.
- Plain static assets, with all example content available without JavaScript.

## Verification

Inspected desktop and mobile screenshots in Chrome. Automated checks passed at
320, 390, 600, 768, 850, 1024, 1440 and 1920px, including switching all three
workflow stages at each width. No page-level horizontal overflow or diagram
text obscured by the shared-memory block remained.

Also passed:

- One h1; internal anchor targets exist; skip link works from the keyboard.
- Both meaningful session records appear in the accessibility tree.
- Workflow arrow-key, Home and End navigation; selected panel/ARIA state.
- Native FAQ keyboard open/close and repeated preview-setup link activation.
- Direct preview-setup URL opens its disclosure.
- All three clipboard commands preserve exact text, including initialization newlines.
- Missing/denied clipboard access announces manual-copy guidance and selects the command.
- JavaScript disabled: all three examples are visible; inactive controls are hidden.
- Reduced-motion preference disables smooth scrolling.
- No console errors, page exceptions or failed local resources.
- `node --check site/main.js` and `git diff --check -- site docs/landing/REDESIGN-REVIEW.md`.

Live npm dist-tags were checked during this work: latest and alpha both resolve to 0.2.0-alpha.1. The older preview wording was updated before delivery. A public npm link is used;
there are no GitHub links whose anonymous availability the page depends on.
This is Chrome-based local QA, not a claim of exhaustive browser/accessibility certification.

## Evidence

Local artifacts (temporary files, not shipped site dependencies):

- `/tmp/loreforge-web-redesign/verify.mjs`: browser verification script.
- `/tmp/loreforge-web-redesign/verification.json`: passing results.
- `/tmp/loreforge-web-redesign/1440.png` and `390.png`: full-page screenshots.
- `/tmp/loreforge-web-redesign/desktop-hero.png` and `mobile-hero.png`: final hero screenshots.

Preview: `python3 -m http.server 4173 --directory site`, then http://localhost:4173/.

Changed by the redesign: site/index.html, site/styles.css, site/main.js,
site/favicon.svg, site/README.md, and this report. Unrelated root README changes
were preserved. No package implementation edits, commits, or publication.
