# 0026: A second, cleaner page lives beside the first at `/next/`, and the first stays

**Context.** On 2026-11-14 the owner found the page carried far more than a visitor needs: long paragraphs, a
comparison with other entries, and every proof on one screen. He asked for a clean, task-first page with light and
dark themes, and asked to keep the current page rather than replace it.

**Decision.** The new page is a second Vite app in `web/next/` (React, hash routes `#/`, `#/t/:handle`,
`#/w/:id/check|copy`, `#/how`, `#/testnet`), built by `web/vite.next.config.ts` into `web/dist/next/` after the first
build, so one `npm run build -w web` produces both. It reuses the first page's data modules (`web/src/store.ts`,
`web/src/testnet.ts`, `web/src/Live.tsx`) instead of copying them, so both pages read the same chain and the same
`testnet-run.json`. Fonts are self-hosted from fontsource; the theme is `data-theme` on `<html>`, set before paint,
stored as `keyhole:theme`. Deployed at `/keyhole/next/` with the first page still at `/keyhole/`.

Not a rewrite in place: the first page is the one the judges' docs and screenshots describe, and the owner hadn't
chosen between them.

**Consequences.**

- Two front ends to keep correct. `npm run page-test` drives the first page only; the second was checked by hand in a
  browser (both themes, phone width), not by a script.
- A change to a shared module reaches both pages, so a fix there must be checked on both.
- Making `/next/` the default (and the first page `/classic/`) is a hosting change in near-lab's `site/deploy.sh`,
  not a change here.
