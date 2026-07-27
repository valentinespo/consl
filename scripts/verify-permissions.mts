/**
 * Proof for the permission model — the pure logic every guard leans on.
 * Run: npx tsx scripts/verify-permissions.mts
 */
import {
  RESOURCES,
  RESOURCE_KEYS,
  actionsOf,
  MEMBER_DEFAULT,
  fullPermissions,
  normalizePermissions,
  can,
  type Action,
  type Resource,
} from "../lib/permissions.ts";

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error("  ✗ " + msg);
};
const ALL_ACTIONS: Action[] = ["view", "create", "edit", "delete", "manage"];

// 1. Owner short-circuits to true for every resource/action, whatever perms say.
for (const r of RESOURCE_KEYS)
  for (const a of ALL_ACTIONS) {
    if (!can("owner", null, r, a)) fail(`owner denied ${r}.${a}`);
    if (!can("owner", {}, r, a)) fail(`owner with empty grants denied ${r}.${a}`);
  }

// 2. A member with null perms falls back to the default baseline (not "everything", not "nothing").
for (const r of RESOURCE_KEYS)
  for (const a of ALL_ACTIONS) {
    const viaNull = can("member", null, r, a);
    const viaDefault = (MEMBER_DEFAULT[r] ?? []).includes(a);
    if (viaNull !== viaDefault) fail(`null-perms member disagrees with MEMBER_DEFAULT on ${r}.${a}`);
  }

// 3. A member with empty grants can do nothing at all.
for (const r of RESOURCE_KEYS)
  for (const a of ALL_ACTIONS) if (can("member", {}, r, a)) fail(`empty-grants member allowed ${r}.${a}`);

// 4. fullPermissions grants exactly every real action, and a member holding it can do everything.
const full = fullPermissions();
for (const r of RESOURCE_KEYS) {
  const got = [...(full[r] ?? [])].sort();
  const want = [...actionsOf(r)].sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`fullPermissions ${r}: ${got} != ${want}`);
  for (const a of actionsOf(r)) if (!can("member", full, r, a)) fail(`full member denied real action ${r}.${a}`);
}

// 5. MEMBER_DEFAULT only names real resources and real actions of those resources.
for (const [r, acts] of Object.entries(MEMBER_DEFAULT)) {
  if (!(r in RESOURCES)) fail(`MEMBER_DEFAULT names unknown resource ${r}`);
  for (const a of acts ?? [])
    if (!actionsOf(r as Resource).includes(a)) fail(`MEMBER_DEFAULT gives ${r} the unsupported action ${a}`);
}

// 6. normalizePermissions drops unknown resources, unknown actions, dupes; survives garbage.
const dirty = {
  inventory: ["view", "edit", "edit", "bogus"], // dup + unknown action
  ghost: ["view"], // unknown resource
  dashboard: ["delete"], // action the resource doesn't support
  lots: "notanarray", // wrong shape
} as unknown;
const clean = normalizePermissions(dirty);
if ((clean as Record<string, unknown>).ghost) fail("normalize kept an unknown resource");
if ((clean.inventory ?? []).includes("bogus" as Action)) fail("normalize kept an unknown action");
if ((clean.inventory ?? []).filter((a) => a === "edit").length !== 1) fail("normalize didn't dedupe");
if ((clean.dashboard ?? []).length) fail("normalize kept an action the resource can't have");
for (const garbage of [null, undefined, 42, "x", [], { lots: 5 }]) {
  const out = normalizePermissions(garbage);
  if (typeof out !== "object" || Array.isArray(out)) fail(`normalize(${JSON.stringify(garbage)}) not a clean object`);
}

// 7. RESOURCE_KEYS matches RESOURCES exactly, and every resource lists at least "view".
if (RESOURCE_KEYS.length !== Object.keys(RESOURCES).length) fail("RESOURCE_KEYS out of sync with RESOURCES");
for (const r of RESOURCE_KEYS) if (!actionsOf(r).length) fail(`${r} has no actions`);

// 8. round-trip: normalize(fullPermissions) === fullPermissions (no real grant is dropped).
const rt = normalizePermissions(full);
for (const r of RESOURCE_KEYS) {
  const a = [...(rt[r] ?? [])].sort();
  const b = [...(full[r] ?? [])].sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) fail(`round-trip changed ${r}`);
}

const checks = RESOURCE_KEYS.length * ALL_ACTIONS.length * 3 + Object.keys(MEMBER_DEFAULT).length;
if (failures === 0) console.log(`✓ permission model OK — ${RESOURCE_KEYS.length} resources, ~${checks} assertions, 0 failures`);
else {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
