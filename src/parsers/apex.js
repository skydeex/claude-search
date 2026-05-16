import path from 'path';

// ── Comment stripping ──────────────────────────────────────────────────────

function stripComments(code) {
  let result = '';
  let i = 0;
  const len = code.length;

  while (i < len) {
    if (code[i] === "'") {
      result += code[i++];
      while (i < len) {
        if (code[i] === '\\') { result += code[i++]; result += code[i++]; continue; }
        if (code[i] === "'") { result += code[i++]; break; }
        result += code[i++];
      }
      continue;
    }
    if (code[i] === '/' && code[i + 1] === '/') {
      while (i < len && code[i] !== '\n') i++;
      continue;
    }
    if (code[i] === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < len) {
        if (code[i] === '\n') result += '\n';
        if (code[i] === '*' && code[i + 1] === '/') { i += 2; break; }
        i++;
      }
      continue;
    }
    result += code[i++];
  }
  return result;
}

// ── Annotation handling ────────────────────────────────────────────────────

function collectAnnotations(text) {
  const annotations = [];
  let s = text.trimStart();
  const re = /^@(\w+)(?:\s*\([^)]*\))?\s*/;
  let m;
  while ((m = re.exec(s))) {
    annotations.push(m[0].trim());
    s = s.slice(m[0].length).trimStart();
  }
  return { annotations, rest: s };
}

// FIX 3: collect ALL consecutive @Annotation lines immediately before a declaration
function collectLeadingAnnotations(before) {
  const lines = before.split('\n');
  const annotLines = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('@')) {
      annotLines.unshift(trimmed);
    } else if (trimmed === '') {
      continue;
    } else {
      break;
    }
  }
  const { annotations } = collectAnnotations(annotLines.join('\n'));
  return annotations;
}

// ── Modifier keywords ──────────────────────────────────────────────────────

const METHOD_MODS = new Set([
  'public', 'private', 'global', 'protected',
  'static', 'abstract', 'virtual', 'override',
  'final', 'transient', 'testmethod', 'webservice',
]);

// ── Parameter parsing ──────────────────────────────────────────────────────

function parseParams(paramStr) {
  paramStr = paramStr.trim();
  if (!paramStr) return [];
  const params = [];
  let depth = 0, start = 0;
  for (let i = 0; i <= paramStr.length; i++) {
    const c = paramStr[i];
    if (c === '<') depth++;
    else if (c === '>') depth--;
    else if ((c === ',' || i === paramStr.length) && depth === 0) {
      const part = paramStr.slice(start, i).trim();
      if (part) {
        const tokens = part.replace(/\s+/g, ' ').split(' ');
        params.push({ type: tokens.slice(0, -1).join(' '), name: tokens[tokens.length - 1] });
      }
      start = i + 1;
    }
  }
  return params;
}

// ── Dependency extraction ──────────────────────────────────────────────────

// FIX 6: deduplicate by (name, type) pair so SOQL and instantiates for same class both survive
// FIX 9: removed DML extraction — it captures variable names, not SObject types
function extractDeps(body, className) {
  const seen = new Set();
  const deps = [];

  const add = (name, type) => {
    if (!name || name === className || isApexKeyword(name)) return;
    const key = `${name}:${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    deps.push({ name, type });
  };

  for (const m of body.matchAll(/\bnew\s+(\w+)\s*[<(]/g))
    add(m[1], 'instantiates');

  for (const m of body.matchAll(/\b([A-Z]\w+)\.[\w(]/g))
    add(m[1], 'references');

  for (const m of body.matchAll(/\bFROM\s+(\w+)/gi))
    add(m[1], 'soql');

  return deps;
}

// ── Apex keywords (used to filter false-positive dependency and property names) ──

const APEX_KEYWORDS = new Set([
  'string', 'integer', 'decimal', 'double', 'long', 'boolean', 'blob', 'date', 'datetime',
  'time', 'id', 'object', 'list', 'map', 'set', 'void', 'null', 'true', 'false',
  'this', 'super', 'return', 'new', 'if', 'else', 'for', 'while', 'do', 'try', 'catch',
  'finally', 'throw', 'break', 'continue', 'class', 'interface', 'enum', 'extends',
  'implements', 'public', 'private', 'protected', 'global', 'static', 'final',
  'abstract', 'virtual', 'override', 'with', 'without', 'sharing', 'inherited',
  'insert', 'update', 'delete', 'upsert', 'merge', 'undelete', 'select', 'from',
  'where', 'limit', 'offset', 'order', 'by', 'group', 'having', 'and', 'or', 'not',
  'like', 'in', 'includes', 'excludes', 'system', 'database', 'schema', 'test',
  'trigger', 'on', 'before', 'after',
]);

function isApexKeyword(name) {
  return APEX_KEYWORDS.has(name.toLowerCase());
}

// ── Body extractor ─────────────────────────────────────────────────────────

// FIX 4: returns both body content and end position so caller can advance past closing }
function extractBodyWithEnd(text, startIdx) {
  let depth = 0, i = startIdx;
  let start = -1;
  while (i < text.length) {
    if (text[i] === '{') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0) return { body: text.slice(start ?? startIdx, i), end: i + 1 };
    }
    i++;
  }
  return { body: text.slice(start ?? startIdx), end: text.length };
}

// ── Class / Trigger declaration regexes ───────────────────────────────────

// FIX: \s* at start handles indented inner classes; removed ^ anchor that blocked them
const CLASS_RE = /^\s*(public|private|global|protected)?\s*(?:with sharing|without sharing|inherited sharing)?\s*(abstract|virtual)?\s*(class|interface|enum)\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w\s,<>]+?))?(?:\s*\{|$)/im;

const TRIGGER_RE = /^\s*trigger\s+(\w+)\s+on\s+(\w+)\s*\(([^)]+)\)/im;

// ── Class body parser ──────────────────────────────────────────────────────

function parseClassBody(body, className) {
  const methods = [];
  const properties = [];
  const pendingAnnotations = [];

  let depth = 0;
  let buffer = '';
  let bufferLine = 1;
  let lineNum = 0;

  const flush = (terminator) => {
    const raw = buffer.trim();
    buffer = '';
    if (!raw) { pendingAnnotations.length = 0; return; }

    const { annotations, rest } = collectAnnotations(raw);
    if (annotations.length && !rest.trim()) {
      pendingAnnotations.push(...annotations);
      return;
    }
    const allAnnotations = [...pendingAnnotations, ...annotations];
    pendingAnnotations.length = 0;

    const parsed = tryParseDeclaration(rest, allAnnotations, bufferLine, terminator, className);
    if (parsed?.kind === 'method') methods.push(parsed);
    else if (parsed?.kind === 'property') properties.push(parsed);
  };

  for (let ci = 0; ci < body.length; ci++) {
    const ch = body[ci];
    if (ch === '\n') lineNum++;

    if (ch === '{') {
      if (depth === 0) {
        flush('{');
        bufferLine = lineNum + 1;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
    } else if (ch === ';' && depth === 0) {
      flush(';');
      bufferLine = lineNum + 1;
    } else if (depth === 0) {
      buffer += ch;
    }
  }
  flush(';');

  return { methods, properties };
}

// ── Declaration classifier ─────────────────────────────────────────────────

function tryParseDeclaration(text, annotations, line, terminator, className) {
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s) return null;

  const tokens = s.split(' ');
  const mods = { visibility: null, isStatic: false, isAbstract: false, isVirtual: false, isOverride: false };
  let ti = 0;

  while (ti < tokens.length && METHOD_MODS.has(tokens[ti].toLowerCase())) {
    const t = tokens[ti].toLowerCase();
    if (['public', 'private', 'global', 'protected'].includes(t)) mods.visibility = t;
    else if (t === 'static') mods.isStatic = true;
    else if (t === 'abstract') mods.isAbstract = true;
    else if (t === 'virtual') mods.isVirtual = true;
    else if (t === 'override') mods.isOverride = true;
    ti++;
  }

  const rest = tokens.slice(ti).join(' ');
  if (!rest) return null;

  if (terminator === '{') {
    if (/\b(class|interface|enum)\b/.test(rest)) return null;

    // Constructor: ClassName(...)
    const ctorRe = new RegExp(`^${className}\\s*\\(([^)]*)\\)\\s*$`, 'i');
    const ctorM = ctorRe.exec(rest);
    if (ctorM) {
      return {
        kind: 'method', name: className, ...mods,
        returnType: null, params: parseParams(ctorM[1]),
        annotations, line, isConstructor: true,
      };
    }

    // Method: ReturnType name(params)
    const methodRe = /^([\w<>\[\],\s]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w,\s]+)?\s*$/;
    const mm = methodRe.exec(rest);
    if (mm) {
      const returnType = mm[1].trim();
      const name = mm[2];
      if (!isApexKeyword(name) && name !== className) {
        return {
          kind: 'method', name, ...mods,
          returnType, params: parseParams(mm[3]),
          annotations, line,
        };
      }
    }

    // FIX 5: auto-property with { get; set; } — no parentheses, so not a method
    const autoPropRe = /^([\w<>\[\],\s]+?)\s+(\w+)\s*$/;
    const apm = autoPropRe.exec(rest);
    if (apm) {
      const type = apm[1].trim();
      const name = apm[2];
      if (!isApexKeyword(name) && /^[A-Za-z_]/.test(type)) {
        return { kind: 'property', name, type, ...mods, annotations, line };
      }
    }
  }

  if (terminator === ';') {
    if (!rest || /^(return|throw|if|for|while|else|do)\b/.test(rest)) return null;
    const propRe = /^([\w<>\[\],\s]+?)\s+(\w+)\s*(?:=.*)?$/;
    const pm = propRe.exec(rest);
    if (pm) {
      const type = pm[1].trim();
      const name = pm[2];
      if (!isApexKeyword(name) && /^[A-Za-z_]/.test(type)) {
        return { kind: 'property', name, type, ...mods, annotations, line };
      }
    }
  }

  return null;
}

// ── Main entry point ───────────────────────────────────────────────────────

export function parseApexFile(content, filePath) {
  const stripped = stripComments(content);

  const triggerM = stripped.match(TRIGGER_RE);
  if (triggerM) {
    return [{
      name: triggerM[1],
      type: 'trigger',
      visibility: null,
      isAbstract: false,
      isVirtual: false,
      extendsClass: null,
      implementsInterfaces: [],
      annotations: [],
      triggerObject: triggerM[2],
      triggerEvents: triggerM[3].split(',').map(e => e.trim()),
      methods: [],
      properties: [],
      deps: extractDeps(stripped, triggerM[1]),
    }];
  }

  const results = [];
  parseClassRecursive(stripped, results);
  return results;
}

// FIX 4: loop through ALL class declarations at each nesting level (not just the first)
function parseClassRecursive(code, results) {
  let remaining = code;

  while (remaining.length > 0) {
    const m = CLASS_RE.exec(remaining);
    if (!m) break;

    const visibility = m[1] ?? null;
    const modifier   = m[2]?.toLowerCase() ?? null;
    const classType  = m[3].toLowerCase();
    const name       = m[4];
    const extendsClass = m[5] ?? null;
    const implementsInterfaces = m[6]
      ? m[6].split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // FIX 3: collect ALL consecutive annotation lines before the declaration
    const before      = remaining.slice(0, m.index);
    const annotations = collectLeadingAnnotations(before);

    const braceIdx = remaining.indexOf('{', m.index + m[0].length - 1);
    if (braceIdx === -1) {
      remaining = remaining.slice(m.index + m[0].length);
      continue;
    }

    const { body, end } = extractBodyWithEnd(remaining, braceIdx);

    const { methods, properties } = classType === 'enum'
      ? { methods: [], properties: [] }
      : parseClassBody(body, name);

    results.push({
      name,
      type: classType,
      visibility,
      isAbstract: modifier === 'abstract',
      isVirtual:  modifier === 'virtual',
      extendsClass,
      implementsInterfaces,
      annotations,
      methods,
      properties,
      deps: extractDeps(body, name),
    });

    // Recurse into body for inner classes (they will also be looped through)
    parseClassRecursive(body, results);

    // FIX 4: advance past this class's closing brace to find the next sibling class
    remaining = remaining.slice(end);
  }
}
