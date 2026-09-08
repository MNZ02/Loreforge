# Loreforge landing page (static preview)

One static page under `site/`: plain HTML + CSS and a small JavaScript
module (`main.js`, owned by the L2 Flash task). No framework, build step,
package dependency, or service.

## Local preview

From the repository root:

```bash
python3 -m http.server 4173 --directory site
```

Then open http://localhost:4173/ in a browser.

## Manual checks (no publication required)

- All approved sections render once; exactly one `h1`; nav anchors
  (`#how-it-works`, `#alpha-scope`, `#install`) resolve on click.
- No horizontal overflow at 320, 390, 768, and 1440px widths;
  capture 390px and 1440px screenshots for the handoff.
- Tab through every control: visible focus everywhere, native FAQ
  `<details>` rows open and close from the keyboard.
- With JavaScript disabled the page stays fully readable, anchors work,
  and the install command text remains selectable.
- Copy button behavior is owned by L2: hidden until its handler is
  installed; success and permission-denied paths both announced.
- Normal text contrast >= 4.5:1; illustration text is real HTML, not
  baked into an image; `prefers-reduced-motion` disables smooth scroll.
- No browser console errors; no broken local resources.
- `git diff --check -- site docs/landing` is clean and only L1-owned
  files (`site/index.html`, `site/styles.css`, `site/favicon.svg`,
  `site/README.md`) changed by this task.
