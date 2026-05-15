import fs from 'fs';
import path from 'path';
import { parseApexFile } from './parsers/apex.js';
import { parseFieldFile, parseObjectFile, parseValidationRuleFile } from './parsers/sfObject.js';
import {
  fileNeedsUpdate, upsertFile, deleteFileByPath, getAllFilePaths,
  insertApexClass, upsertSfObject, insertSfField, deleteFieldsByFileId,
  insertValidationRule, deleteValidationRulesByFileId,
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

function getMtime(filePath) {
  return fs.statSync(filePath).mtimeMs;
}

// ── Project structure discovery ────────────────────────────────────────────

function findSfdxDirs(projectRoot) {
  // Support both single-package and multi-package repos
  // Look for sfdx-project.json to find packageDirectories
  const sfdxJson = path.join(projectRoot, 'sfdx-project.json');
  let defaultPaths = [path.join(projectRoot, 'force-app', 'main', 'default')];

  if (fs.existsSync(sfdxJson)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(sfdxJson, 'utf8'));
      if (Array.isArray(cfg.packageDirectories)) {
        defaultPaths = cfg.packageDirectories.map(d =>
          path.join(projectRoot, d.path ?? d, 'main', 'default')
        );
      }
    } catch {}
  }

  // Also scan project root directly in case of non-standard layout
  return defaultPaths.filter(d => fs.existsSync(d));
}

// ── Build orchestrator ─────────────────────────────────────────────────────

export function buildIndex(db, projectRoot, { force = false, verbose = false } = {}) {
  const log = verbose ? console.error : () => {};
  const stats = { added: 0, updated: 0, deleted: 0, skipped: 0, errors: 0 };

  if (force) {
    db.exec('DELETE FROM files');
    log('[build] Full rebuild — all records cleared.');
  }

  // Collect existing paths for deletion detection
  const existingPaths = new Set(getAllFilePaths(db));
  const seenPaths     = new Set();

  const defaultDirs = findSfdxDirs(projectRoot);
  if (!defaultDirs.length) {
    // Fall back to scanning the whole project root
    defaultDirs.push(projectRoot);
  }
  log(`[build] Source dirs: ${defaultDirs.join(', ')}`);

  const processFile = db.transaction((filePath, mtime, handler) => {
    handler(filePath, mtime);
  });

  for (const baseDir of defaultDirs) {
    for (const filePath of walkDir(baseDir)) {
      seenPaths.add(filePath);

      const mtime = getMtime(filePath);
      const ext   = path.extname(filePath).toLowerCase();
      const base  = path.basename(filePath);

      let handler = null;

      if (ext === '.cls') {
        handler = handleApexFile;
      } else if (ext === '.trigger') {
        handler = handleApexFile;
      } else if (base.endsWith('.field-meta.xml')) {
        handler = handleFieldFile;
      } else if (base.endsWith('.object-meta.xml')) {
        handler = handleObjectFile;
      } else if (base.endsWith('.validationRule-meta.xml')) {
        handler = handleValidationRuleFile;
      }

      if (!handler) continue;

      if (!fileNeedsUpdate(db, filePath, mtime)) {
        stats.skipped++;
        continue;
      }

      try {
        handler(db, filePath, mtime, projectRoot, log);
        const isNew = !existingPaths.has(filePath);
        isNew ? stats.added++ : stats.updated++;
      } catch (err) {
        stats.errors++;
        log(`[error] ${filePath}: ${err.message}`);
      }
    }
  }

  // Delete records for files that no longer exist
  for (const p of existingPaths) {
    if (!seenPaths.has(p)) {
      deleteFileByPath(db, p);
      stats.deleted++;
      log(`[delete] ${p}`);
    }
  }

  return stats;
}

// ── Apex handler ───────────────────────────────────────────────────────────

function handleApexFile(db, filePath, mtime, projectRoot, log) {
  const ext     = path.extname(filePath).toLowerCase();
  const type    = ext === '.trigger' ? 'apex_trigger' : 'apex_class';
  const content = fs.readFileSync(filePath, 'utf8');

  // Remove old file record (cascades to apex_classes → methods/props/deps)
  deleteFileByPath(db, filePath);
  const fileId = upsertFile(db, filePath, mtime, type);

  const classes = parseApexFile(content, filePath);
  for (const cls of classes) {
    insertApexClass(db, fileId, cls);
    log(`[apex] ${cls.type} ${cls.name} — ${cls.methods?.length ?? 0} methods`);
  }
}

// ── Object handler ─────────────────────────────────────────────────────────

function handleObjectFile(db, filePath, mtime, projectRoot, log) {
  const content = fs.readFileSync(filePath, 'utf8');
  const obj = parseObjectFile(content, filePath);
  if (!obj) return;

  deleteFileByPath(db, filePath);
  const fileId = upsertFile(db, filePath, mtime, 'sf_object');
  upsertSfObject(db, fileId, obj);
  log(`[object] ${obj.apiName}`);
}

// ── Field handler ──────────────────────────────────────────────────────────

function handleFieldFile(db, filePath, mtime, projectRoot, log) {
  const content = fs.readFileSync(filePath, 'utf8');
  const field = parseFieldFile(content, filePath);
  if (!field) return;

  // Derive object API name: objects/<ObjectName>/fields/<Field>.field-meta.xml
  const objectApiName = path.basename(path.dirname(path.dirname(filePath)));

  // Ensure object exists in db (may not have an object-meta.xml yet)
  let objRow = db.prepare('SELECT id FROM sf_objects WHERE api_name = ?').get(objectApiName);
  if (!objRow) {
    db.prepare('INSERT INTO sf_objects (api_name) VALUES (?)').run(objectApiName);
    objRow = db.prepare('SELECT id FROM sf_objects WHERE api_name = ?').get(objectApiName);
  }

  // Remove old field record for this file
  const oldFile = db.prepare('SELECT id FROM files WHERE path = ?').get(filePath);
  if (oldFile) deleteFieldsByFileId(db, oldFile.id);
  deleteFileByPath(db, filePath);

  const fileId = upsertFile(db, filePath, mtime, 'sf_field');
  insertSfField(db, objRow.id, fileId, field);
  log(`[field] ${objectApiName}.${field.apiName} (${field.type})`);
}

// ── Validation Rule handler ────────────────────────────────────────────────

function handleValidationRuleFile(db, filePath, mtime, projectRoot, log) {
  const content = fs.readFileSync(filePath, 'utf8');
  const rule = parseValidationRuleFile(content, filePath);
  if (!rule) return;

  const objectApiName = path.basename(path.dirname(path.dirname(filePath)));

  let objRow = db.prepare('SELECT id FROM sf_objects WHERE api_name = ?').get(objectApiName);
  if (!objRow) {
    db.prepare('INSERT INTO sf_objects (api_name) VALUES (?)').run(objectApiName);
    objRow = db.prepare('SELECT id FROM sf_objects WHERE api_name = ?').get(objectApiName);
  }

  const oldFile = db.prepare('SELECT id FROM files WHERE path = ?').get(filePath);
  if (oldFile) deleteValidationRulesByFileId(db, oldFile.id);
  deleteFileByPath(db, filePath);

  const fileId = upsertFile(db, filePath, mtime, 'sf_validation_rule');
  insertValidationRule(db, objRow.id, fileId, rule);
  log(`[rule] ${objectApiName} / ${rule.fullName}`);
}
