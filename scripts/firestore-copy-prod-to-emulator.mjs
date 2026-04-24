#!/usr/bin/env node
/**
 * Copy top-level Firestore collections from production into the local Firestore emulator.
 *
 * What it copies: each document (fields only). Subcollections are not followed.
 *
 * Modes:
 *   --all                     Every root collection from prod (small default limit per collection).
 *   <collection> [...]       Only the listed collections.
 *
 * Flags:
 *   --limit=N                 Max documents per collection (--all default: 25; explicit list default: 500)
 *   --skip=a,b                With --all, skip these collection ids (comma-separated)
 *
 * Prerequisites: GOOGLE_APPLICATION_CREDENTIALS, emulators running (Firestore 8080).
 *
 * Examples:
 *   node scripts/firestore-copy-prod-to-emulator.mjs --all
 *   node scripts/firestore-copy-prod-to-emulator.mjs --all --limit=15
 *   node scripts/firestore-copy-prod-to-emulator.mjs projects orders --limit=30
 *
 * Optional env: FIRESTORE_EMULATOR_HOST (default 127.0.0.1:8080)
 */
import admin from "firebase-admin";
import { readFileSync } from "node:fs";

const DEFAULT_EMULATOR = "127.0.0.1:8080";
const DEFAULT_LIMIT_ALL = 25;
const DEFAULT_LIMIT_EXPLICIT = 500;

function parseArgs(argv) {
  let all = false;
  const collections = [];
  const skipExtra = new Set();
  /** @type {number | null} */
  let limitOverride = null;

  for (const a of argv) {
    if (a === "--all") {
      all = true;
    } else if (a.startsWith("--limit=")) {
      const n = Number(a.slice("--limit=".length));
      limitOverride = Number.isFinite(n) && n > 0 ? n : null;
    } else if (a.startsWith("--skip=")) {
      for (const s of a
        .slice("--skip=".length)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)) {
        skipExtra.add(s);
      }
    } else if (!a.startsWith("-")) {
      collections.push(a);
    }
  }

  const limit =
    limitOverride ??
    (all ? DEFAULT_LIMIT_ALL : DEFAULT_LIMIT_EXPLICIT);

  return { all, collections, limit, skipExtra };
}

function emulatorHostPort() {
  const raw = process.env.FIRESTORE_EMULATOR_HOST?.trim();
  if (!raw) return DEFAULT_EMULATOR;
  const noProto = raw.replace(/^https?:\/\//, "");
  return noProto.includes(":") ? noProto : `${noProto}:8080`;
}

const args = parseArgs(process.argv.slice(2));

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    "Missing GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON).",
  );
  process.exit(1);
}

if (!args.all && args.collections.length === 0) {
  console.error(
    "Usage:\n  node scripts/...mjs --all [--limit=N] [--skip=col1,col2]\n  node scripts/...mjs <collection> [...] [--limit=N]",
  );
  process.exit(1);
}

if (args.all && args.collections.length > 0) {
  console.error(
    "Do not pass collection names together with --all (use only --all or only explicit names).",
  );
  process.exit(1);
}

const cred = JSON.parse(
  readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"),
);

const prodApp = admin.initializeApp(
  {
    credential: admin.credential.cert(cred),
    projectId: cred.project_id,
  },
  "prod-seed",
);
const prodDb = prodApp.firestore();

process.env.FIRESTORE_EMULATOR_HOST = emulatorHostPort();

const emuApp = admin.initializeApp(
  { projectId: cred.project_id },
  "emu-seed",
);
const emuDb = emuApp.firestore();

const BATCH_SIZE = 400;

async function resolveCollectionIds() {
  if (args.all) {
    const refs = await prodDb.listCollections();
    const skip = new Set(args.skipExtra);
    const ids = refs
      .map((r) => r.id)
      .filter((id) => !skip.has(id))
      .sort();
    if (ids.length === 0) {
      console.log("No collections to copy (all skipped or empty project).");
    } else {
      const skipMsg =
        skip.size > 0 ? ` (skipped: ${[...skip].sort().join(", ")})` : "";
      console.log(
        `Discovered ${refs.length} root collection(s); copying ${ids.length}.${skipMsg}`,
      );
    }
    return ids;
  }
  return args.collections;
}

async function copyCollection(collectionId) {
  const snap = await prodDb.collection(collectionId).limit(args.limit).get();
  if (snap.empty) {
    console.log(`[${collectionId}] no documents (or none in first ${args.limit}).`);
    return;
  }

  let batch = emuDb.batch();
  let n = 0;
  let written = 0;

  for (const doc of snap.docs) {
    batch.set(emuDb.collection(collectionId).doc(doc.id), doc.data());
    n++;
    written++;
    if (n >= BATCH_SIZE) {
      await batch.commit();
      batch = emuDb.batch();
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
  console.log(`[${collectionId}] wrote ${written} document(s) to emulator.`);
}

async function main() {
  console.log(
    `Emulator: ${process.env.FIRESTORE_EMULATOR_HOST} | project: ${cred.project_id} | limit per collection: ${args.limit}`,
  );
  const ids = await resolveCollectionIds();
  for (const id of ids) {
    await copyCollection(id);
  }
  await Promise.all([prodApp.delete(), emuApp.delete()]);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
