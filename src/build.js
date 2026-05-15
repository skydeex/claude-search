#!/usr/bin/env node
import path from 'path';
import { openDb } from './db.js';
import { buildIndex } from './builder.js';

const args = process.argv.slice(2);
const projectRoot = args.find(a => !a.startsWith('--')) ?? process.env.SF_PROJECT;
const dbPath      = args.find(a => a.startsWith('--db='))?.slice(5)
  ?? process.env.SF_DB
  ?? path.join(process.cwd(), 'sf_index.sqlite');
const force   = args.includes('--force');
const verbose = args.includes('--verbose') || args.includes('-v');

if (!projectRoot) {
  console.error('Usage: sf-build <projectRoot> [--db=path/to/db.sqlite] [--force] [-v]');
  process.exit(1);
}

console.error(`[build] Project : ${path.resolve(projectRoot)}`);
console.error(`[build] Database: ${path.resolve(dbPath)}`);
console.error(`[build] Mode    : ${force ? 'full rebuild' : 'incremental'}`);

const db    = openDb(dbPath);
const start = Date.now();
const stats = buildIndex(db, path.resolve(projectRoot), { force, verbose });
const ms    = Date.now() - start;

console.error(`[build] Done in ${ms}ms — added:${stats.added} updated:${stats.updated} deleted:${stats.deleted} skipped:${stats.skipped} errors:${stats.errors}`);
db.close();
