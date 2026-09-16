/**
 * Restore a nightly backup (lib/backup.ts) into a Postgres database that already has the schema
 * (a database that has run the migrations). Every table in the manifest is emptied and reloaded,
 * so the target ends up as an exact copy of the backup.
 *
 *   DAY=2026-09-16 TARGET_URL=postgresql://... npx tsx --tsconfig tsconfig.json scripts/restore-backup.mts
 *
 * Refuses to touch the production database unless FORCE_PRODUCTION=1 is set — restoring over live
 * data is a deliberate act. Reads R2_* from .env (or the environment); PREFIX defaults to "nightly".
 */
import "dotenv/config";
import pg from "pg";
import { gunzipSync } from "node:zlib";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const day = process.env.DAY;
const target = process.env.TARGET_URL;
const prefix = process.env.PREFIX ?? "nightly";
const bucket = process.env.R2_BACKUP_BUCKET?.trim() || "consl-backups";
if (!day || !target) throw new Error("DAY and TARGET_URL are required");
if (/hayabusa/.test(target) && process.env.FORCE_PRODUCTION !== "1") throw new Error("target looks like PRODUCTION — set FORCE_PRODUCTION=1 if you really mean it");

const s3 = new S3Client({ region: "auto", endpoint: process.env.R2_ENDPOINT, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } });
const fetchObject = async (key: string) => Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body!.transformToByteArray());

type Column = { name: string; udt: string };
type Manifest = { day: string; migration: string | null; tables: { name: string; rows: number; key: string; columns: Column[] }[]; totalRows: number };
const manifest = JSON.parse((await fetchObject(`${prefix}/${day}/manifest.json`)).toString()) as Manifest;
console.log(`backup ${day}: ${manifest.tables.length} tables, ${manifest.totalRows} rows, schema at ${manifest.migration}`);

const q = (n: string) => `"${n}"`;
const typeName = (udt: string) => (/[A-Z]/.test(udt) ? q(udt) : udt);
const castFor = (udt: string) => (udt.startsWith("_") ? `::${typeName(udt.slice(1))}[]` : `::${typeName(udt)}`);
const prep = (v: unknown, udt: string) => (v !== null && (udt === "json" || udt === "jsonb") ? JSON.stringify(v) : v);

const db = new pg.Client({ connectionString: target });
await db.connect();
let mismatches = 0;
try {
  const targetMigration = (await db.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`)).rows[0]?.migration_name ?? null;
  if (targetMigration !== manifest.migration) console.log(`NOTE: target schema is at ${targetMigration}, backup at ${manifest.migration} — run the migrations first if columns differ.`);
  await db.query(`SET session_replication_role = 'replica'`);
  await db.query(`TRUNCATE ${manifest.tables.map((t) => q(t.name)).join(", ")} CASCADE`);
  for (const t of manifest.tables) {
    const lines = gunzipSync(await fetchObject(t.key)).toString("utf8").split("\n").filter(Boolean);
    const names = t.columns.map((c) => q(c.name)).join(", ");
    const batch = Math.max(1, Math.floor(60000 / t.columns.length));
    for (let i = 0; i < lines.length; i += batch) {
      const rows = lines.slice(i, i + batch).map((l) => JSON.parse(l) as Record<string, unknown>);
      const values: unknown[] = [];
      const tuples = rows.map((r, ri) => `(${t.columns.map((c, ci) => { values.push(prep(r[c.name], c.udt)); return `$${ri * t.columns.length + ci + 1}${castFor(c.udt)}`; }).join(",")})`);
      await db.query(`INSERT INTO ${q(t.name)} (${names}) VALUES ${tuples.join(",")}`, values);
    }
    const n = (await db.query(`SELECT count(*)::int AS n FROM ${q(t.name)}`)).rows[0].n as number;
    if (n !== t.rows) mismatches++;
    console.log(`${t.name}: ${n}/${t.rows}${n !== t.rows ? "  MISMATCH" : ""}`);
  }
} finally {
  await db.query(`SET session_replication_role = 'origin'`).catch(() => {});
  await db.end();
}
console.log(mismatches ? `DONE with ${mismatches} mismatches` : "DONE — exact copy");
