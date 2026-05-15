import Database from 'better-sqlite3';

export function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createSchema(db);
  return db;
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id    INTEGER PRIMARY KEY,
      path  TEXT UNIQUE NOT NULL,
      mtime REAL NOT NULL,
      type  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS apex_classes (
      id                      INTEGER PRIMARY KEY,
      file_id                 INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      name                    TEXT NOT NULL,
      type                    TEXT NOT NULL,
      visibility              TEXT,
      is_abstract             INTEGER DEFAULT 0,
      is_virtual              INTEGER DEFAULT 0,
      extends_class           TEXT,
      implements_interfaces   TEXT,
      annotations             TEXT
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

    CREATE INDEX IF NOT EXISTS idx_apex_classes_name    ON apex_classes(name);
    CREATE INDEX IF NOT EXISTS idx_apex_methods_name    ON apex_methods(name);
    CREATE INDEX IF NOT EXISTS idx_apex_deps_dep_name   ON apex_deps(dep_name);
    CREATE INDEX IF NOT EXISTS idx_sf_objects_api_name  ON sf_objects(api_name);
    CREATE INDEX IF NOT EXISTS idx_sf_fields_object_id  ON sf_fields(object_id);
    CREATE INDEX IF NOT EXISTS idx_sf_fields_type       ON sf_fields(type);
  `);
}

// ── Files ──────────────────────────────────────────────────────────────────

export const stmts = {
  getFile:    null,
  upsertFile: null,
  deleteFile: null,
};

export function prepareStmts(db) {
  stmts.getFile    = db.prepare('SELECT id, mtime FROM files WHERE path = ?');
  stmts.upsertFile = db.prepare(
    'INSERT INTO files (path, mtime, type) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime RETURNING id'
  );
  stmts.deleteFile = db.prepare('DELETE FROM files WHERE path = ?');
}

export function fileNeedsUpdate(db, filePath, mtime) {
  const row = db.prepare('SELECT mtime FROM files WHERE path = ?').get(filePath);
  return !row || row.mtime !== mtime;
}

export function upsertFile(db, filePath, mtime, type) {
  const existing = db.prepare('SELECT id FROM files WHERE path = ?').get(filePath);
  if (existing) {
    db.prepare('UPDATE files SET mtime=?, type=? WHERE path=?').run(mtime, type, filePath);
    return existing.id;
  }
  const info = db.prepare('INSERT INTO files (path, mtime, type) VALUES (?, ?, ?)').run(filePath, mtime, type);
  return info.lastInsertRowid;
}

export function deleteFileByPath(db, filePath) {
  db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
}

export function getAllFilePaths(db) {
  return db.prepare('SELECT path FROM files').all().map(r => r.path);
}

// ── Apex ───────────────────────────────────────────────────────────────────

export function insertApexClass(db, fileId, cls) {
  const info = db.prepare(`
    INSERT INTO apex_classes
      (file_id, name, type, visibility, is_abstract, is_virtual, extends_class, implements_interfaces, annotations)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fileId, cls.name, cls.type, cls.visibility ?? null,
    cls.isAbstract ? 1 : 0, cls.isVirtual ? 1 : 0,
    cls.extendsClass ?? null,
    JSON.stringify(cls.implementsInterfaces ?? []),
    JSON.stringify(cls.annotations ?? [])
  );
  const classId = info.lastInsertRowid;

  const insertMethod = db.prepare(`
    INSERT INTO apex_methods
      (class_id, name, visibility, is_static, is_abstract, is_virtual, is_override, return_type, params, annotations, line)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const m of cls.methods ?? []) {
    insertMethod.run(
      classId, m.name, m.visibility ?? null,
      m.isStatic ? 1 : 0, m.isAbstract ? 1 : 0,
      m.isVirtual ? 1 : 0, m.isOverride ? 1 : 0,
      m.returnType ?? null, JSON.stringify(m.params ?? []),
      JSON.stringify(m.annotations ?? []), m.line ?? null
    );
  }

  const insertProp = db.prepare(`
    INSERT INTO apex_properties (class_id, name, type, visibility, is_static, annotations, line)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of cls.properties ?? []) {
    insertProp.run(
      classId, p.name, p.type ?? null, p.visibility ?? null,
      p.isStatic ? 1 : 0, JSON.stringify(p.annotations ?? []), p.line ?? null
    );
  }

  const insertDep = db.prepare('INSERT INTO apex_deps (class_id, dep_name, dep_type) VALUES (?, ?, ?)');
  for (const d of cls.deps ?? []) {
    insertDep.run(classId, d.name, d.type);
  }

  return classId;
}

// ── SF Objects ─────────────────────────────────────────────────────────────

export function upsertSfObject(db, fileId, obj) {
  const existing = db.prepare('SELECT id FROM sf_objects WHERE api_name = ?').get(obj.apiName);
  let objectId;
  if (existing) {
    db.prepare(
      'UPDATE sf_objects SET file_id=?, label=?, plural_label=?, description=? WHERE api_name=?'
    ).run(fileId, obj.label ?? null, obj.pluralLabel ?? null, obj.description ?? null, obj.apiName);
    objectId = existing.id;
  } else {
    const info = db.prepare(
      'INSERT INTO sf_objects (file_id, api_name, label, plural_label, description) VALUES (?, ?, ?, ?, ?)'
    ).run(fileId, obj.apiName, obj.label ?? null, obj.pluralLabel ?? null, obj.description ?? null);
    objectId = info.lastInsertRowid;
  }
  return objectId;
}

export function insertSfField(db, objectId, fileId, field) {
  const info = db.prepare(`
    INSERT INTO sf_fields
      (object_id, file_id, api_name, label, type, required, unique_field, external_id, reference_to, relationship_name, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    objectId, fileId, field.apiName, field.label ?? null, field.type ?? null,
    field.required ? 1 : 0, field.unique ? 1 : 0, field.externalId ? 1 : 0,
    field.referenceTo ?? null, field.relationshipName ?? null, field.description ?? null
  );
  const fieldId = info.lastInsertRowid;

  if (field.picklistValues?.length) {
    const ins = db.prepare(
      'INSERT INTO sf_picklist_values (field_id, value, label, is_default, active) VALUES (?, ?, ?, ?, ?)'
    );
    for (const v of field.picklistValues) {
      ins.run(fieldId, v.value, v.label ?? v.value, v.isDefault ? 1 : 0, v.active !== false ? 1 : 0);
    }
  }
  return fieldId;
}

export function deleteFieldsByFileId(db, fileId) {
  db.prepare('DELETE FROM sf_fields WHERE file_id = ?').run(fileId);
}

export function insertValidationRule(db, objectId, fileId, rule) {
  db.prepare(`
    INSERT INTO sf_validation_rules
      (object_id, file_id, full_name, active, description, error_message, error_condition)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    objectId, fileId, rule.fullName ?? null,
    rule.active !== false ? 1 : 0,
    rule.description ?? null, rule.errorMessage ?? null, rule.errorCondition ?? null
  );
}

export function deleteValidationRulesByFileId(db, fileId) {
  db.prepare('DELETE FROM sf_validation_rules WHERE file_id = ?').run(fileId);
}
