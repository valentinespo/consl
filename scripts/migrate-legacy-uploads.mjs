// One-shot boot step: move tenant files that were historically committed into the repo
// (legacy-uploads/) onto the persistent tenant volume (UPLOAD_DIR), where uploads belong.
// Tenant data must not live inside the application image — herbl is a tenant like any other.
//
// Idempotent and boot-safe: skips files that already exist, never throws (a failure here must
// not take the app down — the media route still falls back to legacy-uploads while it exists),
// and once legacy-uploads is removed from the repo this becomes a natural no-op.
import { cpSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

function countFiles(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += countFiles(p);
    else if (e.isFile()) n++;
  }
  return n;
}

try {
  const dest = process.env.UPLOAD_DIR;
  const src = path.join(process.cwd(), "legacy-uploads");
  if (!dest) {
    console.log("[legacy-uploads] no UPLOAD_DIR — local dev, nothing to do");
  } else if (!existsSync(src)) {
    console.log(`[legacy-uploads] no legacy dir in image — volume holds ${existsSync(dest) ? countFiles(dest) : 0} files`);
  } else {
    const before = existsSync(dest) ? countFiles(dest) : 0;
    cpSync(src, dest, { recursive: true, force: false, errorOnExist: false });
    const after = countFiles(dest);
    console.log(`[legacy-uploads] volume ${before} -> ${after} files (+${after - before} copied from image, src has ${countFiles(src)})`);
  }
} catch (e) {
  console.error("[legacy-uploads] copy failed (app boots anyway):", e?.message);
}
