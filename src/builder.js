import fs from 'fs';
import path from 'path';
import { parseApexFile } from './parsers/apex.js';
import { parseFieldFile, parseObjectFile, parseValidationRuleFile } from './parsers/sfObject.js';
import {
  loadAllMtimes, upsertFile, deleteFileByPath, getAllFilePaths,
  insertApexClass, upsertSfObject, insertSfField, deleteFieldsByFileId,
  insertValidationRule, deleteValidationRulesByFileId,
  ensureSfObject, getFileId,
} from './db.js';

// ── File scanner ───────────────────────────────────────────────────────────

function* walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkDir(full);
    else yield full;
  }
}

// P7: wrap in try/catch — file may disappear between walkDir and stat
function getMtime(filePath) {
  try { return fs.statSync(filePath).mtimeMs; } catch { return null; }
}

// ── Project structure discovery ────────────────────────────────────────────

function findSfdxDirs(projectRoot) {
  const sfdxJson = path.join(projectRoot, 'sfdx-project.json');
  let dirs = [path.join(projectRoot, 'force-app', 'main', 'default')];

  if (fs.existsSync(sfdxJson)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(sfdxJson, 'utf8'));
      if (Array.isArray(cfg.packageDirectories)) {
        dirs = cfg.packageDirectories.map(d =>
          path.join(projectRoot, d.path ?? d, 'main', 'default')
        );
      }
    } catch {}
  }

  return dirs.filter(d => fs.existsSync(d));
}

// ── Build orchestrator ─────────────────────────────────────────────────────

export function buildIndex(db, projectRoot, { force = false, verbose = false } = {}) {
  const log   = verbose ? console.error : () => {};
  const stats = { added: 0, updated: 0, deleted: 0, skipped: 0, errors: 0 };

  if (force) {
    db.exec('DELETE FROM files');
    log('[build] Full rebuild — all records cleared.');
  }

  const dirs = findSfdxDirs(projectRoot);
  if (!dirs.length) dirs.push(projectRoot);
  log(`[build] Source dirs: ${dirs.join(', ')}`);

  // P1: load all known mtimes in one query instead of one query per file
  const knownMtimes = loadAllMtimes(db);
  const existingPaths = new Set(Object.keys(knownMtimes));
  const seenPaths = new Set();

  // ── Collect phase: disk reads only, no DB writes ───────────────────────
  const toProcess = [];

  for (const baseDir of dirs) {
    for (const filePath of walkDir(baseDir)) {
      seenPaths.add(filePath);

      const ext  = path.extname(filePath).toLowerCase();
      const base = path.basename(filePath);

      let handler = null;
      if (ext === '.cls' || ext === '.trigger')          handler = handleApexFile;
      else if (base.endsWith('.field-meta.xml'))          handler = handleFieldFile;
      else if (base.endsWith('.object-meta.xml'))         handler = handleObjectFile;
      else if (base.endsWith('.validationRule-meta.xml')) handler = handleValidationRuleFile;
      if (!handler) continue;

      // P7: getMtime returns null if file disappeared between walk and stat
      const mtime = getMtime(filePath);
      if (mtime === null) continue;

      // P1: O(1) mtime check against in-memory map
      if (knownMtimes[filePath] === mtime) {
        stats.skipped++;
        continue;
      }

      toProcess.push({ filePath, mtime, handler });
    }
  }

  // ── Write phase: all DB mutations in one transaction (P2) ──────────────
  const runBatch = db.transaction(() => {
    for (const { filePath, mtime, handler } of toProcess) {
      try {
        handler(db, filePath, mtime, log);
        existingPaths.has(filePath) ? stats.updated++ : stats.added++;
      } catch (err) {
        stats.errors++;
        log(`[error] ${filePath}: ${err.message}`);
      }
    }

    for (const p of existingPaths) {
      if (!seenPaths.has(p)) {
        deleteFileByPath(db, p);
        stats.deleted++;
        log(`[delete] ${p}`);
      }
    }
  });

  runBatch();
  return stats;
}

// ── Apex handler ───────────────────────────────────────────────────────────

function handleApexFile(db, filePath, mtime, log) {
  const type    = path.extname(filePath).toLowerCase() === '.trigger' ? 'apex_trigger' : 'apex_class';
  const content = fs.readFileSync(filePath, 'utf8');

  deleteFileByPath(db, filePath);
  const fileId = upsertFile(db, filePath, mtime, type);

  for (const cls of parseApexFile(content, filePath)) {
    insertApexClass(db, fileId, cls);
    log(`[apex] ${cls.type} ${cls.name} — ${cls.methods?.length ?? 0} methods`);
  }
}

// ── Object handler ─────────────────────────────────────────────────────────

function handleObjectFile(db, filePath, mtime, log) {
  const obj = parseObjectFile(fs.readFileSync(filePath, 'utf8'), filePath);
  if (!obj) return;

  deleteFileByPath(db, filePath);
  const fileId = upsertFile(db, filePath, mtime, 'sf_object');
  upsertSfObject(db, fileId, obj);
  log(`[object] ${obj.apiName}`);
}

// ── Field handler ──────────────────────────────────────────────────────────

function handleFieldFile(db, filePath, mtime, log) {
  const field = parseFieldFile(fs.readFileSync(filePath, 'utf8'), filePath);
  if (!field) return;

  // objects/<ObjectName>/fields/<Field>.field-meta.xml
  const objectApiName = path.basename(path.dirname(path.dirname(filePath)));
  const objRow = ensureSfObject(db, objectApiName);

  const oldFileId = getFileId(db, filePath);
  if (oldFileId) deleteFieldsByFileId(db, oldFileId);
  deleteFileByPath(db, filePath);

  const fileId = upsertFile(db, filePath, mtime, 'sf_field');
  insertSfField(db, objRow.id, fileId, field);
  log(`[field] ${objectApiName}.${field.apiName} (${field.type})`);
}

// ── Validation Rule handler ────────────────────────────────────────────────

function handleValidationRuleFile(db, filePath, mtime, log) {
  const rule = parseValidationRuleFile(fs.readFileSync(filePath, 'utf8'), filePath);
  if (!rule) return;

  const objectApiName = path.basename(path.dirname(path.dirname(filePath)));
  const objRow = ensureSfObject(db, objectApiName);

  const oldFileId = getFileId(db, filePath);
  if (oldFileId) deleteValidationRulesByFileId(db, oldFileId);
  deleteFileByPath(db, filePath);

  const fileId = upsertFile(db, filePath, mtime, 'sf_validation_rule');
  insertValidationRule(db, objRow.id, fileId, rule);
  log(`[rule] ${objectApiName} / ${rule.fullName}`);
}
