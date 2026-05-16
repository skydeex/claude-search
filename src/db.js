import Database from 'better-sqlite3';

export function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createSchema(db);
  applyMigrations(db);
  return db;
}

// ── Schema ─────────────────────────────────────────────────────────────────

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id    INTEGER PRIMARY KEY,
      path  TEXT UNIQUE NOT NULL,
      mtime REAL NOT NULL,
      type  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS apex_classes (
      id                    INTEGER PRIMARY KEY,
      file_id               INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      name                  TEXT NOT NULL,
      type                  TEXT NOT NULL,
      visibility            TEXT,
      is_abstract           INTEGER DEFAULT 0,
      is_virtual            INTEGER DEFAULT 0,
      extends_class         TEXT,
      implements_interfaces TEXT,
      annotations           TEXT,
      trigger_object        TEXT,
      trigger_events        TEXT
    );

    CREATE TABLE IF NOT EXISTS apex_methods (
      id          INTEGER PRIMARY KEY,
      class_id    INTEGER NOT NULL REFERENCES apex_classes(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      visibility  TEXT,
      is_static   INTEGER DEFAULT 0,
      is_abstract INTEGER DEFAULT 0,
      is_virtual  INTEGER DEFAULT 0,
      is_override INTEGER DEFAULT 0,
      return_type TEXT,
      params      TEXT,
      annotations TEXT,
      line        INTEGER
    );

    CREATE TABLE IF NOT EXISTS apex_properties (
      id          INTEGER PRIMARY KEY,
      class_id    INTEGER NOT NULL REFERENCES apex_classes(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      type        TEXT,
      visibility  TEXT,
      is_static   INTEGER DEFAULT 0,
      annotations TEXT,
      line        INTEGER
    );

    CREATE TABLE IF NOT EXISTS apex_deps (
      id        INTEGER PRIMARY KEY,
      class_id  INTEGER NOT NULL REFERENCES apex_classes(id) ON DELETE CASCADE,
      dep_name  TEXT NOT NULL,
      dep_type  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sf_objects (
      id           INTEGER PRIMARY KEY,
      file_id      INTEGER REFERENCES files(id) ON DELETE CASCADE,
      api_name     TEXT UNIQUE NOT NULL,
      label        TEXT,
      plural_label TEXT,
      description  TEXT
    );

    CREATE TABLE IF NOT EXISTS sf_fields (
      id                INTEGER PRIMARY KEY,
      object_id         INTEGER NOT NULL REFERENCES sf_objects(id) ON DELETE CASCADE,
      file_id           INTEGER REFERENCES files(id) ON DELETE CASCADE,
      api_name          TEXT NOT NULL,
      label             TEXT,
      type              TEXT,
      required          INTEGER DEFAULT 0,
      unique_field      INTEGER DEFAULT 0,
      external_id       INTEGER DEFAULT 0,
      reference_to      TEXT,
      relationship_name TEXT,
      description       TEXT
    );

    CREATE TABLE IF NOT EXISTS sf_picklist_values (
      id         INTEGER PRIMARY KEY,
      field_id   INTEGER NOT NULL REFERENCES sf_fields(id) ON DELETE CASCADE,
      value      TEXT NOT NULL,
      label      TEXT,
      is_default INTEGER DEFAULT 0,
      active     INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sf_validation_rules (
      id              INTEGER PRIMARY KEY,
      object_id       INTEGER NOT NULL REFERENCES sf_objects(id) ON DELETE CASCADE,
      file_id         INTEGER REFERENCES files(id) ON DELETE CASCADE,
      full_name       TEXT,
      active          INTEGER DEFAULT 1,
      description     TEXT,
      error_message   TEXT,
      error_condition TEXT
    );

    -- Name lookups: NOCASE so WHERE name=? COLLATE NOCASE uses the index
    CREATE INDEX IF NOT EXISTS idx_apex_classes_name    ON apex_classes(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_apex_classes_extends ON apex_classes(extends_class COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_apex_methods_name    ON apex_methods(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_sf_objects_api_name  ON sf_objects(api_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_sf_fields_api_name   ON sf_fields(api_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_sf_fields_type       ON sf_fields(type);

    -- FK indexes for fast JOINs
    CREATE INDEX IF NOT EXISTS idx_apex_methods_class_id    ON apex_methods(class_id);
    CREATE INDEX IF NOT EXISTS idx_apex_properties_class_id ON apex_properties(class_id);
    CREATE INDEX IF NOT EXISTS idx_apex_deps_class_id       ON apex_deps(class_id);
    CREATE INDEX IF NOT EXISTS idx_apex_deps_dep_name       ON apex_deps(dep_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_sf_fields_object_id      ON sf_fields(object_id);
    CREATE INDEX IF NOT EXISTS idx_sf_picklist_field_id     ON sf_picklist_values(field_id);
    CREATE INDEX IF NOT EXISTS idx_sf_valrules_object_id    ON sf_validation_rules(object_id);
  `);
}

// ── Migrations ─────────────────────────────────────────────────────────────

function applyMigrations(db) {
  const cols = db.prepare('PRAGMA table_info(apex_classes)').all().map(c => c.name);
  if (!cols.includes('trigger_object'))
    db.exec('ALTER TABLE apex_classes ADD COLUMN trigger_object TEXT');
  if (!cols.includes('trigger_events'))
    db.exec('ALTER TABLE apex_classes ADD COLUMN trigger_events TEXT');

  // Recreate any old case-sensitive name indexes as NOCASE
  const idxSql = Object.fromEntries(
    db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all().map(r => [r.name, r.sql ?? ''])
  );
  const needNocase = [
    'idx_apex_classes_name', 'idx_apex_classes_extends',
    'idx_apex_methods_name', 'idx_apex_deps_dep_name',
    'idx_sf_objects_api_name', 'idx_sf_fields_api_name',
  ];
  for (const name of needNocase) {
    if (idxSql[name] && !idxSql[name].toUpperCase().includes('NOCASE')) {
      db.exec(`DROP INDEX IF EXISTS ${name}`);
    }
  }
  // Create any indexes that were just dropped (or missing FK indexes)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_apex_classes_name    ON apex_classes(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_apex_classes_extends ON apex_classes(extends_class COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_apex_methods_name    ON apex_methods(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_apex_deps_dep_name   ON apex_deps(dep_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_sf_objects_api_name  ON sf_objects(api_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_sf_fields_api_name   ON sf_fields(api_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_apex_methods_class_id    ON apex_methods(class_id);
    CREATE INDEX IF NOT EXISTS idx_apex_properties_class_id ON apex_properties(class_id);
    CREATE INDEX IF NOT EXISTS idx_apex_deps_class_id       ON apex_deps(class_id);
    CREATE INDEX IF NOT EXISTS idx_sf_picklist_field_id     ON sf_picklist_values(field_id);
    CREATE INDEX IF NOT EXISTS idx_sf_valrules_object_id    ON sf_validation_rules(object_id);
  `);
}

// ── Statement cache (P1) ───────────────────────────────────────────────────
// Prepared statements are compiled once per DB connection and reused.

function createStmts(db) {
  return {
    // files
    fileMtime:     db.prepare('SELECT mtime FROM files WHERE path = ?'),
    fileById:      db.prepare('SELECT id FROM files WHERE path = ?'),
    fileAllMtimes: db.prepare('SELECT path, mtime FROM files'),
    fileAllPaths:  db.prepare('SELECT path FROM files'),
    fileInsert:    db.prepare('INSERT INTO files (path, mtime, type) VALUES (?, ?, ?)'),
    fileUpdate:    db.prepare('UPDATE files SET mtime=?, type=? WHERE path=?'),
    fileDelete:    db.prepare('DELETE FROM files WHERE path = ?'),

    // apex_classes
    classInsert: db.prepare(`
      INSERT INTO apex_classes
        (file_id, name, type, visibility, is_abstract, is_virtual, extends_class,
         implements_interfaces, annotations, trigger_object, trigger_events)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),

    // apex_methods
    methodInsert: db.prepare(`
      INSERT INTO apex_methods
        (class_id, name, visibility, is_static, is_abstract, is_virtual, is_override,
         return_type, params, annotations, line)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),

    // apex_properties
    propInsert: db.prepare(`
      INSERT INTO apex_properties (class_id, name, type, visibility, is_static, annotations, line)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),

    // apex_deps
    depInsert: db.prepare('INSERT INTO apex_deps (class_id, dep_name, dep_type) VALUES (?, ?, ?)'),

    // sf_objects
    objByName:    db.prepare('SELECT id FROM sf_objects WHERE api_name = ?'),
    objInsert:    db.prepare('INSERT INTO sf_objects (file_id, api_name, label, plural_label, description) VALUES (?, ?, ?, ?, ?)'),
    objUpdate:    db.prepare('UPDATE sf_objects SET file_id=?, label=?, plural_label=?, description=? WHERE api_name=?'),
    objInsertBare: db.prepare('INSERT INTO sf_objects (api_name) VALUES (?)'),

    // sf_fields
    fieldInsert: db.prepare(`
      INSERT INTO sf_fields
        (object_id, file_id, api_name, label, type, required, unique_field, external_id,
         reference_to, relationship_name, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    fieldDeleteByFile: db.prepare('DELETE FROM sf_fields WHERE file_id = ?'),

    // sf_picklist_values
    pickInsert: db.prepare(
      'INSERT INTO sf_picklist_values (field_id, value, label, is_default, active) VALUES (?, ?, ?, ?, ?)'
    ),

    // sf_validation_rules
    ruleInsert: db.prepare(`
      INSERT INTO sf_validation_rules
        (object_id, file_id, full_name, active, description, error_message, error_condition)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    ruleDeleteByFile: db.prepare('DELETE FROM sf_validation_rules WHERE file_id = ?'),
  };
}

function getStmts(db) {
  db._sfStmts ??= createStmts(db);
  return db._sfStmts;
}

// ── Files ──────────────────────────────────────────────────────────────────

export function fileNeedsUpdate(db, filePath, mtime) {
  const row = getStmts(db).fileMtime.get(filePath);
  return !row || row.mtime !== mtime;
}

// Load all known mtimes into a plain object for O(1) lookup during full scans
export function loadAllMtimes(db) {
  return Object.fromEntries(
    getStmts(db).fileAllMtimes.all().map(r => [r.path, r.mtime])
  );
}

export function upsertFile(db, filePath, mtime, type) {
  const s = getStmts(db);
  const existing = s.fileById.get(filePath);
  if (existing) {
    s.fileUpdate.run(mtime, type, filePath);
    return existing.id;
  }
  return s.fileInsert.run(filePath, mtime, type).lastInsertRowid;
}

export function deleteFileByPath(db, filePath) {
  getStmts(db).fileDelete.run(filePath);
}

export function getAllFilePaths(db) {
  return getStmts(db).fileAllPaths.all().map(r => r.path);
}

export function getFileId(db, filePath) {
  return getStmts(db).fileById.get(filePath)?.id ?? null;
}

// ── Apex ───────────────────────────────────────────────────────────────────

export function insertApexClass(db, fileId, cls) {
  const s = getStmts(db);

  const classId = s.classInsert.run(
    fileId, cls.name, cls.type, cls.visibility ?? null,
    cls.isAbstract ? 1 : 0, cls.isVirtual ? 1 : 0,
    cls.extendsClass ?? null,
    JSON.stringify(cls.implementsInterfaces ?? []),
    JSON.stringify(cls.annotations ?? []),
    cls.triggerObject ?? null,
    cls.triggerEvents ? cls.triggerEvents.join(', ') : null
  ).lastInsertRowid;

  for (const m of cls.methods ?? []) {
    s.methodInsert.run(
      classId, m.name, m.visibility ?? null,
      m.isStatic ? 1 : 0, m.isAbstract ? 1 : 0,
      m.isVirtual ? 1 : 0, m.isOverride ? 1 : 0,
      m.returnType ?? null, JSON.stringify(m.params ?? []),
      JSON.stringify(m.annotations ?? []), m.line ?? null
    );
  }

  for (const p of cls.properties ?? []) {
    s.propInsert.run(
      classId, p.name, p.type ?? null, p.visibility ?? null,
      p.isStatic ? 1 : 0, JSON.stringify(p.annotations ?? []), p.line ?? null
    );
  }

  for (const d of cls.deps ?? []) {
    s.depInsert.run(classId, d.name, d.type);
  }

  return classId;
}

// ── SF Objects ─────────────────────────────────────────────────────────────

export function upsertSfObject(db, fileId, obj) {
  const s = getStmts(db);
  const existing = s.objByName.get(obj.apiName);
  if (existing) {
    s.objUpdate.run(fileId, obj.label ?? null, obj.pluralLabel ?? null, obj.description ?? null, obj.apiName);
    return existing.id;
  }
  return s.objInsert.run(fileId, obj.apiName, obj.label ?? null, obj.pluralLabel ?? null, obj.description ?? null).lastInsertRowid;
}

// Ensure an sf_objects row exists (used when a field file appears before the object-meta.xml)
export function ensureSfObject(db, apiName) {
  const s = getStmts(db);
  let row = s.objByName.get(apiName);
  if (!row) {
    s.objInsertBare.run(apiName);
    row = s.objByName.get(apiName);
  }
  return row;
}

export function insertSfField(db, objectId, fileId, field) {
  const s = getStmts(db);
  const fieldId = s.fieldInsert.run(
    objectId, fileId, field.apiName, field.label ?? null, field.type ?? null,
    field.required ? 1 : 0, field.unique ? 1 : 0, field.externalId ? 1 : 0,
    field.referenceTo ?? null, field.relationshipName ?? null, field.description ?? null
  ).lastInsertRowid;

  for (const v of field.picklistValues ?? []) {
    s.pickInsert.run(fieldId, v.value, v.label ?? v.value, v.isDefault ? 1 : 0, v.active !== false ? 1 : 0);
  }
  return fieldId;
}

export function deleteFieldsByFileId(db, fileId) {
  getStmts(db).fieldDeleteByFile.run(fileId);
}

export function insertValidationRule(db, objectId, fileId, rule) {
  getStmts(db).ruleInsert.run(
    objectId, fileId, rule.fullName ?? null,
    rule.active !== false ? 1 : 0,
    rule.description ?? null, rule.errorMessage ?? null, rule.errorCondition ?? null
  );
}

export function deleteValidationRulesByFileId(db, fileId) {
  getStmts(db).ruleDeleteByFile.run(fileId);
}
