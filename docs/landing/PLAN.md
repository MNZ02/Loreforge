# Loreforge landing page — implementation specification

Status: ready for implementation; no page implemented by the planner.
Date: 7 September 2026.
Repository: /Users/mnz/dev/loreforge.
Product owner: user. Planner: Codex. Implementers: Muse then Flash. Reviewer: Grok.

## Outcome and boundaries

A visitor should understand within ten seconds that Loreforge preserves context
between independent coding-agent sessions, see what the alpha actually supports,
and find a working install command or the source code.

Build one static page under `site/`, with plain HTML, CSS, and a small JavaScript
module. No framework, runtime service, package dependencies, account system,
analytics, newsletter form, or model integration. This scope keeps implementation
and later hosting simple. Hosting choice and deployment are a separate task.
No changes to CLI code, package metadata, root lockfile, or existing docs/templates.
Other agents are actively editing the notes milestone: do not touch that work.
Do not commit, push, publish, or launch another model.

## Product truth and approved copy

At planning time npm reports `loreforge@0.1.0-alpha.1` with an `alpha` tag.
The compiled release supports tasks, claims, handoffs, Q&A, decisions, Git evidence,
and task-linked context. New note-search code is in progress, not part of this
release. Never infer release status from uncommitted source files.
No measured token savings, user count, testimonials, native-provider certification,
or benchmark figures are available. Do not invent them.

Use this copy; change only punctuation for layout. Raise substantive edits as a
Loreforge question to `codex-landing-plan`.

Navigation: Loreforge | How it works | Alpha scope | GitHub
Eyebrow: OPEN SOURCE · EARLY ALPHA
H1: Give your next agent a head start.
Hero paragraph: Loreforge keeps a shared record of findings, decisions, and handoffs
so independent coding agents can pick up where another session left off.
Primary CTA: Try the alpha (anchor #install)
Secondary CTA: View on GitHub (https://github.com/MNZ02/Loreforge)
Support line: Local SQLite storage. Explicit CLI commands. Your agents stay independent.

Section heading: A useful finding should outlive the chat.
Body: An investigation can end with a fix, a failed attempt, or a decision worth
remembering. Preserve the reason and the evidence so the next session has a
starting point it can verify.

Workflow heading: Leave evidence. Pick up context. Keep working.
1. Record the finding — Save what changed, why it matters, and the files or checks
   that support it in a task handoff.
2. Retrieve the context — Another session reads that task and its linked handoffs.
3. Verify and continue — Check the evidence against the current code, then carry
   the work forward and leave the next handoff.

Scope heading: Small by design.
Available in the alpha: Task-linked handoffs; Questions and answers; Decisions
with file references; Git evidence; Local storage.
Next milestone: Searchable standalone notes; Corrections linked to older findings;
Relevant results without knowing an earlier task ID.
Footnote: These upcoming features are being implemented. They are not included in
the published alpha.

Install heading: Start with one project.
Command: npm install -g loreforge@alpha
Requirement: Node.js 24.15+ and Git.
Body: Follow the setup guide to register your project and add instructions to your
agent sessions. The alpha currently needs a separate state home for each project.
Link: Read the setup guide → https://github.com/MNZ02/Loreforge/blob/main/docs/usage.md

FAQ (native details/summary, no JS required):
- Does it run my agents? No. You start your CLI sessions. Loreforge stores and
  retrieves the context they explicitly record.
- Does it work across providers? Agents can use the same CLI and local state home.
  Each session must be instructed to read and write records; there is no automatic
  integration with every provider.
- Does it reduce token usage? It may reduce repeated investigation, but total token
  savings have not been measured. Writing and retrieving context also consumes tokens.
- Where is my data stored? In a local SQLite database in the configured state
  directory. An agent can send retrieved content to its model provider as context.

Footer: Loreforge · Shared context for independent agents.
Links: GitHub, npm (https://www.npmjs.com/package/loreforge), MIT license
(https://github.com/MNZ02/Loreforge/blob/main/LICENSE).
Verify each external destination before final delivery; report unavailable links,
and use an available truthful destination rather than publishing a broken link.

## Visual direction

A technical field notebook: warm paper, nearly black ink, a restrained rust accent,
and generous spacing. Avoid neon gradients, glass panels, robot art, vendor-logo
walls, fabricated dashboards, decorative charts, or repeating grids of cards.
The distinguishing feature is a legible piece of shared context, not a generic
SaaS illustration.

Tokens (define as CSS custom properties):
- page #F5F2EA; surface #FFFDF7
- text #20221F; secondary #55594F; accent #9A391F
- border #D8D4C8; muted surface #EBE7DC
- typography: Georgia for hero/section headings; system sans for body/navigation;
  ui-monospace for commands and record metadata. No webfont dependency.
- content max-width 1160px; desktop gutters 48px, tablet 32px, mobile 20px
- spacing scale 4/8/12/16/24/32/48/64/96px
- button min-height 44px; corner radius 6px; note-paper radius 3px
- body 17px/1.6; labels 12px/1.4; hero clamp(42px, 5.2vw, 72px), line-height 1.04
- strong visible focus outline with 3px offset; respect reduced motion

Desktop composition (>=960px):
1. Header, 76px tall: wordmark left, three text links right. Thin bottom rule.
2. Hero, approx. 600px content height without fixed height: 54% text / 46% example,
   vertically centered, 48px gap. H1 three lines maximum. CTAs beneath paragraph.
3. A full-width editorial paragraph section, 760px reading width, 80px vertical padding.
4. Three workflow steps across one ruled strip, numbers 01/02/03 and short body text.
5. Alpha scope: two columns labeled Available / Next milestone, ordinary lists.
6. Install: wide ink-colored band with light text and one command box. Avoid extra
   nested panels. Keep command text selectable and horizontally scrollable if needed.
7. FAQ: narrow reading width, four expanding rows with dividing rules.
8. Footer: quiet links and product line, 56px vertical padding.

Hero example: two offset paper records, slight 1deg rotation maximum on the rear
record, readable front record, subtle shadow. Explicit label: ILLUSTRATIVE HANDOFF.
Do not present it as a real tool screenshot or a measured customer result.
Record A: SESSION A / Finding / "Retrying after a partial write can leave access
missing." / Evidence: grant-user-plan.ts · regression test.
Record B: SESSION B / Context received / "Check the existing recovery fix before
changing the retry path." / Footer: Verify against the current commit.
Thin connecting line and small arrow may be CSS/SVG. No animated simulation and no
terminal-style fake lore search command. Decorative lines aria-hidden.

Mobile (<640px): header wraps links without a hamburger; hero becomes one column,
text first, example below; hero papers stack without rotation/overlap; buttons wrap
and remain >=44px high; steps and scope stack; sections use 56px vertical padding.
Tablet 640–959px: one-column hero, example max-width 620px; other columns only where
content fits. At 320px no page overflow and command can scroll within its own box.
At 200% text zoom no clipped heading, navigation, or controls.

## File contract and sequential assignments

L1 — Muse Spark 1.3 xhigh, page and appearance:
Own `site/index.html`, `site/styles.css`, `site/favicon.svg`, `site/README.md`.
Create complete semantic page, all approved copy, responsive styles, metadata,
favicon, anchor navigation, and native FAQ. Include `<script type="module"
src="./main.js"></script>` for the next task. Copy button is hidden initially via
`hidden`; Flash reveals it once handlers are installed. Command remains selectable.
Required HTML IDs: #how-it-works, #alpha-scope, #install, #install-command,
#copy-install, #copy-status. Status element: role=status, aria-live=polite.
Command element textContent is exactly `npm install -g loreforge@alpha`.
#copy-install type=button, initial text Copy command. No provider logo assets.
site/README explains local preview via `python3 -m http.server 4173 --directory site`
and lists the publication-independent manual checks.
Do not write main.js or modify another worker's files.

L2 — AGY Gemini 3.8 Flash high, enhancement and verification; after L1:
Own `site/main.js` and `docs/landing/FLASH-REPORT.md` only.
Implement copy command using navigator.clipboard.writeText from the DOM command.
On success, aria-live announces Copied install command. On unsupported API or
permission denial, announce Copy unavailable. Select the command and copy it manually.
Do not falsely report success. Keep label stable, no timer required. Unhide button
only after event listener registration. No fetch, tracking, external JS, storage,
or HTML injection. FAQ and anchors must work without JavaScript.
Check responsive page and keyboard flow. If HTML/CSS needs changes, record the
precise issue for Muse; do not edit outside ownership. Flash may complete its own
bounded task with such issues clearly in unresolved; review must still catch them.

L3 — Grok 4.6 high, independent review; after L2:
Own `docs/landing/GROK-REVIEW.md` only. Read the spec and actual files; do not assume
worker handoffs prove correctness. Inspect product claims against the published
alpha; review keyboard/screen-reader semantics, clipboard failure handling,
responsive layout, package isolation, and absence of tracking or external services.
Report concrete failures with file/line and reproduction. Do not implement fixes.
Route repair requests to owning model. Ordinary repair loop maximum two passes;
if still failing, report remaining blockers instead of expanding scope.

All sessions are not alone in this checkout. Preserve others' edits. Only touch
owned files. Claims coordinate tasks, not filesystem locks. No commits or deployment.
Each session registers its own identity, retrieves context before claiming, renews
its lease if necessary, and submits evidence with exact checks and honest limits.
Use questions for decisions that block work. Do not change product scope silently.

## Acceptance and evidence

- All approved sections and copy appear once; one h1; anchors resolve.
- Page works as static files; no npm dependency or root package modifications.
- No document overflow at 320, 390, 768, 1440px. Capture 390px and 1440px screenshots.
- Tab through every control. Visible focus; native FAQ opens with keyboard.
- Copy tested on success AND permission-denied/unsupported path; no-JS content useful.
- Normal text contrast >=4.5:1; large text/control boundaries appropriate to WCAG AA.
- Reduced-motion preference respected. No essential animation or hover-only content.
- No inaccessible text baked into an image; illustration text is real HTML.
- No browser console errors or broken local resources after L2.
- `node --check site/main.js` after L2; preview with the Python command above.
- `git diff --check -- site docs/landing`; inspect changed paths for ownership.
- Browser checks require an actual browser. If unavailable, report NOT RUN; screenshots
  and visual approval cannot be replaced by syntax checks. User visual approval is
  required before the separate deployment task, not before producing reviewable files.
- Existing CLI suite is unrelated to this static page; do not repeatedly run it for
  CSS/copy edits. If any root product files change, stop and report scope violation.

## Loreforge learning trial

L1 handoff must explain one consequential layout decision, evidence, and any browser
limits. L2 first fetches its context and cites the specific L1 finding it used, or
honestly says none was useful. L3 reports whether this reduced repeated discovery.
This checks linked-task continuity. It does not prove automatic search or net token
savings. If usage counters are available, record provider/model/settings, total
input/output/cached tokens, and all note/context overhead. Do not invent a baseline.
