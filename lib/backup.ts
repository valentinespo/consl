import "server-only";
import pg from "pg";
import { createGzip } from "node:zlib";
import { once } from "node:events";
import { S3Client, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

/**
 * Nightly database backup: every table, one compressed newline-delimited JSON file each, plus a
 * manifest, in a dated folder of a DEDICATED bucket (R2_BACKUP_BUCKET, default "consl-backups" —
 * never the app's file bucket). Kept for BACKUP_RETENTION_DAYS (14). Written by the production
 * scheduler once a day after BACKUP_HOUR_UTC (04:00 UTC); restored with scripts/restore-backup.mts.
 *
 * Railway's own backups need a plan the founder doesn't have, so this is the safety net behind
 * "every push is live". A day's export is ~15 MB compressed at today's size (2026-09-16).
 *
 * Timestamps and numerics are exported as the database's own text, never as JavaScript values,
 * so a restore reproduces them exactly regardless of the machine's timezone.
 */

const BUCKET = process.env.R2_BACKUP_BUCKET?.trim() || "consl-backups";
const HOUR_UTC = Number(process.env.BACKUP_HOUR_UTC ?? 4);
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? 14);
const PREFIX = "nightly";

export type TableManifest = { name: string; rows: number; bytes: number; key: string; primaryKey: string[]; columns: { name: string; udt: string }[] };
export type Manifest = { day: string; prefix: string; startedAt: string; finishedAt: string; migration: string | null; tables: TableManifest[]; totalRows: number; totalBytes: number };

export function backupConfigured(): boolean {
  return !!(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.DATABASE_URL);
}

function s3(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  });
}

/** Text for the types JavaScript would otherwise mangle: timestamps (tz and not), numerics, bigints. */
const RAW_OIDS = new Set([1114, 1184, 1700, 20, 1082]);
const rawTypes = {
  getTypeParser: (oid: number, format?: string) =>
    RAW_OIDS.has(oid) ? (v: string) => v : (pg.types.getTypeParser as (o: number, f?: string) => (v: string) => unknown)(oid, format),
};

const q = (n: string) => `"${n}"`;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

let lastCompletedDay: string | null = null;

/** Called by every scheduler tick; does the day's backup once the hour has come, once. */
export async function runNightlyBackupIfDue(now = new Date()): Promise<void> {
  if (!backupConfigured()) return;
  const day = utcDay(now);
  if (now.getUTCHours() < HOUR_UTC || lastCompletedDay === day) return;
  const client = s3();
  if (await objectExists(client, `${PREFIX}/${day}/manifest.json`)) {
    lastCompletedDay = day;
    return;
  }
  const manifest = await exportDatabase({ day, prefix: PREFIX });
  lastCompletedDay = day;
  console.log(`[backup] ${day}: ${manifest.tables.length} tables, ${manifest.totalRows} rows, ${(manifest.totalBytes / 1e6).toFixed(1)} MB compressed`);
  await pruneOldBackups(now).catch((e) => console.error("[backup] prune failed:", (e as Error).message));
}

async function objectExists(client: S3Client, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Export every table of `databaseUrl` (default: the app's) into `<prefix>/<day>/`. */
export async function exportDatabase(opts: { day: string; prefix?: string; databaseUrl?: string }): Promise<Manifest> {
  const prefix = opts.prefix ?? PREFIX;
  const folder = `${prefix}/${opts.day}`;
  const client = s3();
  const db = new pg.Client({ connectionString: opts.databaseUrl ?? process.env.DATABASE_URL, types: rawTypes as never });
  await db.connect();
  const startedAt = new Date().toISOString();
  const tables: TableManifest[] = [];
  try {
    const names = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`)).rows.map((r) => r.table_name as string);
    const migration = (await db.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`).catch(() => ({ rows: [] as { migration_name: string }[] }))).rows[0]?.migration_name ?? null;

    for (const t of names) {
      const columns = (await db.query(`SELECT column_name, udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t])).rows.map((r) => ({ name: r.column_name as string, udt: r.udt_name as string }));
      const primaryKey = (await db.query(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)`, [q(t)])).rows.map((r) => r.attname as string);
      const order = (primaryKey.length ? primaryKey : columns.map((c) => c.name)).map(q).join(", ");
      const total = (await db.query(`SELECT count(*)::int AS n FROM ${q(t)}`)).rows[0].n as number;

      const gzip = createGzip({ level: 6 });
      const chunks: Buffer[] = [];
      gzip.on("data", (c: Buffer) => chunks.push(c));
      const done = new Promise<void>((resolve, reject) => {
        gzip.on("end", resolve);
        gzip.on("error", reject);
      });
      const batch = 5000;
      for (let offset = 0; offset < total; offset += batch) {
        const rows = (await db.query(`SELECT * FROM ${q(t)} ORDER BY ${order} LIMIT ${batch} OFFSET ${offset}`)).rows;
        if (!rows.length) break;
        if (!gzip.write(rows.map((r) => JSON.stringify(r)).join("\n") + "\n")) await once(gzip, "drain");
      }
      gzip.end();
      await done;
      const body = Buffer.concat(chunks);
      const key = `${folder}/${t}.ndjson.gz`;
      await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: "application/x-ndjson", ContentEncoding: "gzip" }));
      tables.push({ name: t, rows: total, bytes: body.length, key, primaryKey, columns });
    }

    const manifest: Manifest = {
      day: opts.day,
      prefix,
      startedAt,
      finishedAt: new Date().toISOString(),
      migration,
      tables,
      totalRows: tables.reduce((a, t) => a + t.rows, 0),
      totalBytes: tables.reduce((a, t) => a + t.bytes, 0),
    };
    // The manifest is written last: its presence means the folder is complete.
    await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${folder}/manifest.json`, Body: JSON.stringify(manifest, null, 1), ContentType: "application/json" }));
    return manifest;
  } finally {
    await db.end();
  }
}

/** Delete dated folders older than the retention window. */
export async function pruneOldBackups(now = new Date(), retentionDays = RETENTION_DAYS): Promise<string[]> {
  const client = s3();
  const cutoff = utcDay(new Date(now.getTime() - retentionDays * 86_400_000));
  const listing = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${PREFIX}/`, Delimiter: "/" }));
  const removed: string[] = [];
  for (const p of listing.CommonPrefixes ?? []) {
    const day = p.Prefix?.slice(PREFIX.length + 1).replace(/\/$/, "") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= cutoff) continue;
    let token: string | undefined;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: p.Prefix, ContinuationToken: token }));
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) await client.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys, Quiet: true } }));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    removed.push(day);
  }
  if (removed.length) console.log(`[backup] pruned ${removed.join(", ")}`);
  return removed;
}
