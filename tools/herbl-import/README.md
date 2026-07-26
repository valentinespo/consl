# Herbl one-off migration tools

These scripts imported Herbl's original spreadsheet and PO archive into the app. They are
**not part of the product** — they hardcode one company's facility codes, product names,
material codes, and local file paths.

They live outside `lib/` and `scripts/` (and outside the `tsconfig` include set) so nothing in
the app can import them and they never reach a build. Keep it that way: when the next customer
needs a data import, write a generic importer driven by an uploaded file and a column mapping,
rather than extending these.

Run them with `node --import tsx tools/herbl-import/<script>.ts` from the app root, with
`DATABASE_URL` pointing at the intended database. Each script guards on the host name — check
that guard before running anything.
