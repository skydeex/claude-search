#!/usr/bin/env node
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { openDb, getProjectRoot } from './db.js';
import { buildIndex } from './builder.js';

// DB path from env (can be overridden per tool call)
const DEFAULT_DB = process.env.SF_DB ?? path.join(process.cwd(), 'sf_index.sqlite');
const DEFAULT_PROJECT = process.env.SF_PROJECT ?? '';

// Cache open DB handles by path
const dbCache = new Map();
function getDb(dbPath) {
  const resolved = path.resolve(dbPath);
  if (!dbCache.has(resolved)) dbCache.set(resolved, openDb(resolved));
  return dbCache.get(resolved);
}

// ── MCP Server ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'sf-agent-search',
  version: '1.0.0',
});

// ── Tool: build_index ──────────────────────────────────────────────────────

server.tool(
  'build_index',
  'Build or incrementally update the SQLite index from a Salesforce SFDX project. Run this before querying if the project has changed.',
  {
    project_path: z.string().describe('Absolute path to the Salesforce project root (contains sfdx-project.json or force-app/)'),
    db_path:      z.string().optional().describe(`Path to SQLite output file (default: ${DEFAULT_DB})`),
    force:        z.boolean().optional().describe('If true, drop and rebuild all records (default: incremental)'),
  },
  async ({ project_path, db_path, force }) => {
    const dbPath  = db_path ?? DEFAULT_DB;
    const projDir = project_path ?? DEFAULT_PROJECT;
    if (!projDir) return { content: [{ type: 'text', text: 'Error: project_path is required.' }] };

    const db    = getDb(dbPath);
    const start = Date.now();
    const stats = buildIndex(db, path.resolve(projDir), { force: force ?? false, verbose: false });
    const ms    = Date.now() - start;

    return {
      content: [{
        type: 'text',
        text: [
          `Index built in ${ms}ms`,
          `  added:   ${stats.added}`,
          `  updated: ${stats.updated}`,
          `  deleted: ${stats.deleted}`,
          `  skipped: ${stats.skipped}`,
          `  errors:  ${stats.errors}`,
          `  db:      ${path.resolve(dbPath)}`,
        ].join('\n'),
      }],
    };
  }
);

// ── Tool: list_apex_classes ────────────────────────────────────────────────

server.tool(
  'list_apex_classes',
  'List all indexed Apex classes and triggers. Optionally filter by type or annotation.',
  {
    db_path:    z.string().optional().describe('Path to SQLite db'),
    type:       z.enum(['class','interface','enum','trigger']).optional().describe('Filter by type'),
    annotation: z.string().optional().describe('Filter classes that have this annotation (e.g. AuraEnabled, RestResource)'),
    limit:      z.number().optional().default(100).describe('Max rows to return (default 100)'),
  },
  async ({ db_path, type, annotation, limit }) => {
    const db   = getDb(db_path ?? DEFAULT_DB);
    const root = getProjectRoot(db);
    let sql  = `
      SELECT ac.name, ac.type, ac.visibility, ac.extends_class, ac.implements_interfaces,
             ac.annotations, f.path
      FROM apex_classes ac
      JOIN files f ON f.id = ac.file_id
    `;
    const params = [];
    const where  = [];
    if (type) { where.push('ac.type = ?'); params.push(type); }
    if (annotation) { where.push("ac.annotations LIKE ?"); params.push(`%${annotation}%`); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY ac.name LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    const lines = rows.map(r => {
      const ext  = r.extends_class ? ` extends ${r.extends_class}` : '';
      const impl = r.implements_interfaces ? ` implements ${JSON.parse(r.implements_interfaces).join(', ')}` : '';
      const ann  = r.annotations ? JSON.parse(r.annotations).join(' ') : '';
      return `${ann ? ann + '\n' : ''}${r.visibility ?? ''} ${r.type} ${r.name}${ext}${impl}  [${relPath(r.path, root)}]`.trim();
    });

    return { content: [{ type: 'text', text: lines.join('\n') || '(none found)' }] };
  }
);

// ── Tool: get_apex_class ───────────────────────────────────────────────────

server.tool(
  'get_apex_class',
  'Get full details of an Apex class: its methods, properties, dependencies, and class hierarchy.',
  {
    class_name: z.string().describe('Apex class or trigger name'),
    db_path:    z.string().optional(),
  },
  async ({ class_name, db_path }) => {
    const db  = getDb(db_path ?? DEFAULT_DB);
    const cls = db.prepare(`
      SELECT ac.*, f.path FROM apex_classes ac
      JOIN files f ON f.id = ac.file_id
      WHERE ac.name = ? COLLATE NOCASE
    `).get(class_name);

    if (!cls) return { content: [{ type: 'text', text: `Class "${class_name}" not found.` }] };

    const root = getProjectRoot(db);
    const methods = db.prepare(`
      SELECT name, visibility, is_static, is_abstract, is_virtual, is_override,
             return_type, params, annotations, line
      FROM apex_methods WHERE class_id = ? ORDER BY line
    `).all(cls.id);

    const props = db.prepare(`
      SELECT name, type, visibility, is_static, annotations, line
      FROM apex_properties WHERE class_id = ? ORDER BY line
    `).all(cls.id);

    const deps = db.prepare(`
      SELECT dep_name, dep_type FROM apex_deps WHERE class_id = ?
    `).all(cls.id);

    const lines = [
      `// File: ${relPath(cls.path, root)}`,
      formatClassDecl(cls),
      '',
    ];

    if (props.length) {
      lines.push('// Properties');
      for (const p of props) {
        const anns = JSON.parse(p.annotations ?? '[]').join(' ');
        lines.push(`  ${anns ? anns + ' ' : ''}${p.visibility ?? ''} ${p.is_static ? 'static ' : ''}${p.type ?? 'Object'} ${p.name};`);
      }
      lines.push('');
    }

    if (methods.length) {
      lines.push('// Methods');
      for (const m of methods) {
        const anns   = JSON.parse(m.annotations ?? '[]').join(' ');
        const params = JSON.parse(m.params ?? '[]').map(p => `${p.type} ${p.name}`).join(', ');
        const mods   = [m.visibility, m.is_static ? 'static' : null, m.is_abstract ? 'abstract' : null,
                        m.is_virtual ? 'virtual' : null, m.is_override ? 'override' : null]
                       .filter(Boolean).join(' ');
        lines.push(`  ${anns ? anns + '\n  ' : ''}${mods} ${m.return_type ?? 'void'} ${m.name}(${params})  // line ${m.line}`);
      }
      lines.push('');
    }

    if (deps.length) {
      lines.push('// Dependencies');
      const grouped = {};
      for (const d of deps) {
        (grouped[d.dep_type] ??= []).push(d.dep_name);
      }
      for (const [type, names] of Object.entries(grouped)) {
        lines.push(`  [${type}]: ${[...new Set(names)].join(', ')}`);
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── Tool: find_apex_usages ─────────────────────────────────────────────────

server.tool(
  'find_apex_usages',
  'Find all Apex classes that reference (instantiate, call, extend, implement) a given class or type.',
  {
    name:     z.string().describe('Class or type name to search for'),
    dep_type: z.enum(['instantiates', 'references', 'soql', 'extends', 'implements']).optional()
               .describe('Filter by dependency type'),
    limit:    z.number().optional().default(100).describe('Max rows to return (default 100)'),
    db_path:  z.string().optional(),
  },
  async ({ name, dep_type, limit, db_path }) => {
    const db   = getDb(db_path ?? DEFAULT_DB);
    const root = getProjectRoot(db);
    const rows = [];

    // FIX 1: extends and implements are stored in apex_classes, not apex_deps
    if (!dep_type || !['extends', 'implements'].includes(dep_type)) {
      let sql = `
        SELECT ac.name AS class_name, ac.type AS class_type, d.dep_type, f.path
        FROM apex_deps d
        JOIN apex_classes ac ON ac.id = d.class_id
        JOIN files f ON f.id = ac.file_id
        WHERE d.dep_name = ? COLLATE NOCASE
      `;
      const params = [name];
      if (dep_type) { sql += ' AND d.dep_type = ?'; params.push(dep_type); }
      rows.push(...db.prepare(sql).all(...params));
    }

    if (!dep_type || dep_type === 'extends') {
      rows.push(...db.prepare(`
        SELECT ac.name AS class_name, ac.type AS class_type, 'extends' AS dep_type, f.path
        FROM apex_classes ac
        JOIN files f ON f.id = ac.file_id
        WHERE ac.extends_class = ? COLLATE NOCASE
      `).all(name));
    }

    if (!dep_type || dep_type === 'implements') {
      // FIX 8: use json_each for exact match instead of LIKE '%name%'
      rows.push(...db.prepare(`
        SELECT ac.name AS class_name, ac.type AS class_type, 'implements' AS dep_type, f.path
        FROM apex_classes ac, json_each(ac.implements_interfaces) ji
        JOIN files f ON f.id = ac.file_id
        WHERE ji.value = ? COLLATE NOCASE
          AND ac.implements_interfaces IS NOT NULL
      `).all(name));
    }

    if (!rows.length) return { content: [{ type: 'text', text: `No usages of "${name}" found.` }] };

    rows.sort((a, b) => a.class_name.localeCompare(b.class_name));
    const limited = rows.slice(0, limit);
    const lines = limited.map(r => `${r.class_type} ${r.class_name}  [${r.dep_type}]  ${relPath(r.path, root)}`);
    const suffix = rows.length > limit ? `\n(showing ${limit} of ${rows.length})` : '';
    return { content: [{ type: 'text', text: `Usages of "${name}":\n` + lines.join('\n') + suffix }] };
  }
);

// ── Tool: get_class_hierarchy ──────────────────────────────────────────────

server.tool(
  'get_class_hierarchy',
  'Show the inheritance and interface chain for an Apex class (extends/implements, and who extends it).',
  {
    class_name: z.string().describe('Apex class name'),
    db_path:    z.string().optional(),
  },
  async ({ class_name, db_path }) => {
    const db  = getDb(db_path ?? DEFAULT_DB);
    const cls = db.prepare('SELECT * FROM apex_classes WHERE name = ? COLLATE NOCASE').get(class_name);
    if (!cls) return { content: [{ type: 'text', text: `Class "${class_name}" not found.` }] };

    const lines = [`Hierarchy for ${cls.type} ${cls.name}:`];

    if (cls.extends_class) lines.push(`  extends: ${cls.extends_class}`);
    const ifaces = JSON.parse(cls.implements_interfaces ?? '[]');
    if (ifaces.length) lines.push(`  implements: ${ifaces.join(', ')}`);

    // Who extends this class?
    const children = db.prepare(
      'SELECT name, type FROM apex_classes WHERE extends_class = ? COLLATE NOCASE ORDER BY name'
    ).all(class_name);
    if (children.length) {
      lines.push('  extended by:');
      children.forEach(c => lines.push(`    ${c.type} ${c.name}`));
    }

    // FIX 8: use json_each for exact interface match, not LIKE which gives false positives
    const implementors = db.prepare(`
      SELECT ac.name, ac.type
      FROM apex_classes ac, json_each(ac.implements_interfaces) ji
      WHERE ji.value = ? COLLATE NOCASE
        AND ac.implements_interfaces IS NOT NULL
      ORDER BY ac.name
    `).all(class_name);
    if (implementors.length) {
      lines.push('  implemented by:');
      implementors.forEach(c => lines.push(`    ${c.type} ${c.name}`));
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── Tool: find_by_annotation ───────────────────────────────────────────────

server.tool(
  'find_by_annotation',
  'Find Apex classes or methods that have a specific annotation (e.g. @AuraEnabled, @InvocableMethod, @RestResource).',
  {
    annotation: z.string().describe('Annotation name without @ (e.g. AuraEnabled)'),
    target:     z.enum(['class','method']).optional().describe('Search in classes or methods (default: both)'),
    db_path:    z.string().optional(),
  },
  async ({ annotation, target, db_path }) => {
    const db     = getDb(db_path ?? DEFAULT_DB);
    const root   = getProjectRoot(db);
    const like   = `%${annotation}%`;
    const lines  = [];

    if (!target || target === 'class') {
      const rows = db.prepare(`
        SELECT ac.name, ac.type, f.path FROM apex_classes ac
        JOIN files f ON f.id = ac.file_id
        WHERE ac.annotations LIKE ? ORDER BY ac.name
      `).all(like);
      if (rows.length) {
        lines.push(`Classes with @${annotation}:`);
        rows.forEach(r => lines.push(`  ${r.type} ${r.name}  [${relPath(r.path, root)}]`));
      }
    }

    if (!target || target === 'method') {
      const rows = db.prepare(`
        SELECT am.name AS method_name, ac.name AS class_name, am.visibility,
               am.is_static, am.return_type, am.line, f.path
        FROM apex_methods am
        JOIN apex_classes ac ON ac.id = am.class_id
        JOIN files f ON f.id = ac.file_id
        WHERE am.annotations LIKE ? ORDER BY ac.name, am.name
      `).all(like);
      if (rows.length) {
        if (lines.length) lines.push('');
        lines.push(`Methods with @${annotation}:`);
        rows.forEach(r => lines.push(
          `  ${r.class_name}.${r.method_name}  (${r.visibility ?? ''}${r.is_static ? ' static' : ''} ${r.return_type ?? 'void'})  line:${r.line}  [${relPath(r.path, root)}]`
        ));
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') || `No results for @${annotation}.` }] };
  }
);

// ── Tool: list_sf_objects ──────────────────────────────────────────────────

server.tool(
  'list_sf_objects',
  'List all Salesforce custom objects found in the project index.',
  {
    db_path: z.string().optional(),
  },
  async ({ db_path }) => {
    const db   = getDb(db_path ?? DEFAULT_DB);
    const rows = db.prepare(`
      SELECT o.api_name, o.label, o.plural_label,
             COUNT(f.id) AS field_count
      FROM sf_objects o
      LEFT JOIN sf_fields f ON f.object_id = o.id
      GROUP BY o.id ORDER BY o.api_name
    `).all();

    const lines = rows.map(r =>
      `${r.api_name}  "${r.label ?? ''}"  (${r.field_count} fields)`
    );
    return { content: [{ type: 'text', text: lines.join('\n') || '(no objects indexed)' }] };
  }
);

// ── Tool: get_sf_object ────────────────────────────────────────────────────

server.tool(
  'get_sf_object',
  'Get full details for a Salesforce object: all fields with types, relationships, and validation rules.',
  {
    object_name:       z.string().describe('Object API name (e.g. Account, Opportunity__c)'),
    include_picklists: z.boolean().optional().describe('Include picklist values (default false)'),
    db_path:           z.string().optional(),
  },
  async ({ object_name, include_picklists, db_path }) => {
    const db  = getDb(db_path ?? DEFAULT_DB);
    const obj = db.prepare('SELECT * FROM sf_objects WHERE api_name = ? COLLATE NOCASE').get(object_name);
    if (!obj) return { content: [{ type: 'text', text: `Object "${object_name}" not found.` }] };

    const fields = db.prepare(`
      SELECT api_name, label, type, required, unique_field, external_id,
             reference_to, relationship_name, description
      FROM sf_fields WHERE object_id = ? ORDER BY api_name
    `).all(obj.id);

    const rules = db.prepare(`
      SELECT full_name, active, description, error_condition, error_message
      FROM sf_validation_rules WHERE object_id = ? ORDER BY full_name
    `).all(obj.id);

    const lines = [
      `Object: ${obj.api_name}`,
      `  Label      : ${obj.label ?? ''}`,
      `  Plural     : ${obj.plural_label ?? ''}`,
      obj.description ? `  Description: ${obj.description}` : null,
      '',
      `Fields (${fields.length}):`,
    ].filter(l => l !== null);

    for (const f of fields) {
      let line = `  ${f.api_name}  [${f.type ?? '?'}]`;
      if (f.label && f.label !== f.api_name) line += `  "${f.label}"`;
      if (f.required) line += '  REQUIRED';
      if (f.unique_field) line += '  UNIQUE';
      if (f.external_id) line += '  EXTERNAL_ID';
      if (f.reference_to) line += `  → ${f.reference_to} (${f.relationship_name ?? ''})`;
      if (f.description) line += `  // ${f.description}`;
      lines.push(line);

      if (include_picklists && ['Picklist','MultiselectPicklist'].includes(f.type)) {
        const fieldRow = db.prepare('SELECT id FROM sf_fields WHERE object_id = ? AND api_name = ?').get(obj.id, f.api_name);
        if (fieldRow) {
          const values = db.prepare('SELECT value, label, is_default FROM sf_picklist_values WHERE field_id = ?').all(fieldRow.id);
          values.forEach(v => lines.push(`      • ${v.value}${v.label && v.label !== v.value ? ` (${v.label})` : ''}${v.is_default ? ' [default]' : ''}`));
        }
      }
    }

    if (rules.length) {
      lines.push('', `Validation Rules (${rules.length}):`);
      for (const r of rules) {
        lines.push(`  ${r.full_name}  [${r.active ? 'active' : 'inactive'}]`);
        if (r.description) lines.push(`    ${r.description}`);
        if (r.error_condition) lines.push(`    condition: ${r.error_condition}`);
        if (r.error_message)   lines.push(`    message:   ${r.error_message}`);
      }
    }

    // Relationships: other objects that lookup to this one
    const refBy = db.prepare(`
      SELECT o.api_name AS from_object, f.api_name AS field_name, f.relationship_name
      FROM sf_fields f
      JOIN sf_objects o ON o.id = f.object_id
      WHERE f.reference_to = ? COLLATE NOCASE
    `).all(object_name);
    if (refBy.length) {
      lines.push('', 'Referenced by:');
      refBy.forEach(r => lines.push(`  ${r.from_object}.${r.field_name}  (relationship: ${r.relationship_name ?? ''})`));
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── Tool: get_object_fields ────────────────────────────────────────────────

server.tool(
  'get_object_fields',
  'Get fields for a Salesforce object, optionally filtered by type.',
  {
    object_name: z.string().describe('Object API name'),
    type:        z.string().optional().describe('Filter by field type (e.g. Lookup, Text, Picklist, Currency)'),
    db_path:     z.string().optional(),
  },
  async ({ object_name, type, db_path }) => {
    const db  = getDb(db_path ?? DEFAULT_DB);
    const obj = db.prepare('SELECT id FROM sf_objects WHERE api_name = ? COLLATE NOCASE').get(object_name);
    if (!obj) return { content: [{ type: 'text', text: `Object "${object_name}" not found.` }] };

    let sql    = 'SELECT api_name, label, type, required, reference_to, relationship_name FROM sf_fields WHERE object_id = ?';
    const prms = [obj.id];
    if (type) { sql += ' AND type = ? COLLATE NOCASE'; prms.push(type); }
    sql += ' ORDER BY api_name';

    const fields = db.prepare(sql).all(...prms);
    const lines  = fields.map(f => {
      let s = `${f.api_name}  [${f.type ?? '?'}]`;
      if (f.label) s += `  "${f.label}"`;
      if (f.required) s += '  REQUIRED';
      if (f.reference_to) s += `  → ${f.reference_to}`;
      return s;
    });

    return { content: [{ type: 'text', text: lines.join('\n') || '(no fields found)' }] };
  }
);

// ── Tool: find_object_relationships ───────────────────────────────────────

server.tool(
  'find_object_relationships',
  'Show all Lookup and MasterDetail relationships in the project — which objects relate to which.',
  {
    object_name: z.string().optional().describe('Filter to relationships involving this object (as source or target)'),
    limit:       z.number().optional().default(100).describe('Max rows to return (default 100)'),
    db_path:     z.string().optional(),
  },
  async ({ object_name, limit, db_path }) => {
    const db = getDb(db_path ?? DEFAULT_DB);
    let sql  = `
      SELECT o.api_name AS from_object, f.api_name AS field_name,
             f.type, f.reference_to, f.relationship_name
      FROM sf_fields f
      JOIN sf_objects o ON o.id = f.object_id
      WHERE f.type IN ('Lookup','MasterDetail','Hierarchy')
    `;
    const prms = [];
    if (object_name) {
      sql += ' AND (o.api_name = ? COLLATE NOCASE OR f.reference_to = ? COLLATE NOCASE)';
      prms.push(object_name, object_name);
    }
    sql += ' ORDER BY o.api_name, f.api_name LIMIT ?';
    prms.push(limit);

    const rows  = db.prepare(sql).all(...prms);
    const lines = rows.map(r =>
      `${r.from_object}.${r.field_name}  [${r.type}]  → ${r.reference_to}  (${r.relationship_name ?? ''})`
    );

    return { content: [{ type: 'text', text: lines.join('\n') || '(no relationships found)' }] };
  }
);

// ── Tool: search_apex ─────────────────────────────────────────────────────

server.tool(
  'search_apex',
  'Search for Apex classes or methods by name (partial match).',
  {
    query:   z.string().describe('Search term (partial class or method name)'),
    limit:   z.number().optional().default(100).describe('Max rows per category (default 100)'),
    db_path: z.string().optional(),
  },
  async ({ query, limit, db_path }) => {
    const db   = getDb(db_path ?? DEFAULT_DB);
    const root = getProjectRoot(db);
    const like = `%${query}%`;

    const classes = db.prepare(`
      SELECT ac.name, ac.type, ac.visibility, f.path
      FROM apex_classes ac JOIN files f ON f.id = ac.file_id
      WHERE ac.name LIKE ? COLLATE NOCASE ORDER BY ac.name LIMIT ?
    `).all(like, limit);

    const methods = db.prepare(`
      SELECT am.name, am.visibility, am.return_type, am.line,
             ac.name AS class_name, f.path
      FROM apex_methods am
      JOIN apex_classes ac ON ac.id = am.class_id
      JOIN files f ON f.id = ac.file_id
      WHERE am.name LIKE ? COLLATE NOCASE ORDER BY ac.name, am.name LIMIT ?
    `).all(like, limit);

    const lines = [];
    if (classes.length) {
      lines.push(`Classes matching "${query}":`);
      classes.forEach(c => lines.push(`  ${c.type} ${c.name}  [${relPath(c.path, root)}]`));
    }
    if (methods.length) {
      if (lines.length) lines.push('');
      lines.push(`Methods matching "${query}":`);
      methods.forEach(m => lines.push(
        `  ${m.class_name}.${m.name}  (${m.visibility ?? ''} ${m.return_type ?? 'void'})  line:${m.line}  [${relPath(m.path, root)}]`
      ));
    }

    return { content: [{ type: 'text', text: lines.join('\n') || `No results for "${query}".` }] };
  }
);

// ── Tool: get_index_stats ──────────────────────────────────────────────────

server.tool(
  'get_index_stats',
  'Show statistics about the current index: counts of indexed classes, fields, objects, etc.',
  {
    db_path: z.string().optional(),
  },
  async ({ db_path }) => {
    const db = getDb(db_path ?? DEFAULT_DB);
    const q  = (sql) => db.prepare(sql).get();
    const lines = [
      `Apex classes   : ${q('SELECT COUNT(*) AS n FROM apex_classes WHERE type != "trigger"').n}`,
      `Apex triggers  : ${q('SELECT COUNT(*) AS n FROM apex_classes WHERE type = "trigger"').n}`,
      `Apex methods   : ${q('SELECT COUNT(*) AS n FROM apex_methods').n}`,
      `Apex properties: ${q('SELECT COUNT(*) AS n FROM apex_properties').n}`,
      `Apex deps      : ${q('SELECT COUNT(*) AS n FROM apex_deps').n}`,
      `SF objects     : ${q('SELECT COUNT(*) AS n FROM sf_objects').n}`,
      `SF fields      : ${q('SELECT COUNT(*) AS n FROM sf_fields').n}`,
      `Picklist values: ${q('SELECT COUNT(*) AS n FROM sf_picklist_values').n}`,
      `Validation rules: ${q('SELECT COUNT(*) AS n FROM sf_validation_rules').n}`,
      `Indexed files  : ${q('SELECT COUNT(*) AS n FROM files').n}`,
    ];
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── Helpers ────────────────────────────────────────────────────────────────

function relPath(absPath, root) {
  if (!root || !absPath) return absPath;
  const rel = path.relative(root, absPath);
  return rel.startsWith('..') ? absPath : rel;
}

function formatClassDecl(cls) {
  // FIX 2: show trigger object and events for triggers
  if (cls.type === 'trigger') {
    const events = cls.trigger_events ?? '';
    const obj    = cls.trigger_object ?? '?';
    return `trigger ${cls.name} on ${obj} (${events})`;
  }
  const anns   = JSON.parse(cls.annotations ?? '[]').join(' ');
  const ifaces = JSON.parse(cls.implements_interfaces ?? '[]');
  const mods   = [cls.visibility, cls.is_abstract ? 'abstract' : null, cls.is_virtual ? 'virtual' : null]
                 .filter(Boolean).join(' ');
  let decl = `${mods} ${cls.type} ${cls.name}`.trim();
  if (cls.extends_class) decl += ` extends ${cls.extends_class}`;
  if (ifaces.length)     decl += ` implements ${ifaces.join(', ')}`;
  return anns ? `${anns}\n${decl}` : decl;
}

// ── Start ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
