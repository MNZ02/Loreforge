# Loreforge landing page

Static HTML, CSS, and progressive JavaScript enhancements. No build step,
framework, external fonts, or runtime services are required.

## Preview

From the repository root:

```sh
python3 -m http.server 4173 --directory site
```

Open http://localhost:4173/.

## Design and behavior

The page uses a warm paper background, charcoal and olive typography, amber
accents, and an illustrated session-to-session handoff. Workflow examples
have three keyboard-accessible tabs. They are illustrative and execute no
commands. All three examples remain readable without JavaScript.

The quick start describes the published 0.2.0-alpha.1 package, including
search, reviews, MCP, and backup/restore/export.
Verify npm dist-tags before changing these version statements. The source
installation instructions apply only to an existing local checkout.

Copy controls appear only after their handlers are installed. If clipboard
access fails, the command is selected and manual-copy guidance is announced.
The source-installation link opens its FAQ disclosure, including repeated clicks.

## Verification

- Inspect desktop and mobile renderings; check widths 320, 390, 600, 768,
  850, 1024, 1440, and 1920 for page overflow and obscured diagram text.
- Exercise all three workflow stages, arrow keys, Home/End, visible focus,
  native FAQ keyboard toggles, and the skip link.
- Verify all three copy controls, including unavailable/denied clipboard.
- Check direct and repeated source-installation navigation.
- Disable JavaScript: examples remain visible and inactive controls hidden.
- Enable reduced motion: smooth scrolling is disabled.
- Check internal anchors and local resources; inspect browser errors.
- Run `node --check site/main.js` and `git diff --check -- site`.

The 2026-09-08 redesign was checked in local headless Chrome. It has not been
published. Browser evidence and the verification script are recorded in
`docs/landing/REDESIGN-REVIEW.md`.
