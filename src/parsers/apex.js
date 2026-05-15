import path from 'path';

// ── Comment stripping ──────────────────────────────────────────────────────

function stripComments(code) {
  let result = '';
  let i = 0;
  const len = code.length;

  while (i < len) {
    // Single-quoted string (Apex string literal)
    if (code[i] === "'") {
      result += code[i++];
      while (i < len) {
        if (code[i] === '\\') { result += code[i++]; result += code[i++]; continue; }
        if (code[i] === "'") { result += code[i++]; break; }
        result += code[i++];
      }
      continue;
    }
    // Line comment
    if (code[i] === '/' && code[i + 1] === '/') {
      while (i < len && code[i] !== '\n') i++;
      continue;
    }
    // Block comment — preserve newlines for line-number accuracy
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

// ── Annotation collector ───────────────────────────────────────────────────

// Returns { annotations: string[], rest: string } consuming leading @Annotation[(args)] tokens
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

// ── Generic type-aware token reader ───────────────────────────────────────

// Read a type token that may contain generics: List<Map<String,Integer>>
function readType(s) {
  let i = 0;
  // word chars
  while (i < s.length && /\w/.test(s[i])) i++;
  if (s[i] === '<') {
    let depth = 0;
    while (i < s.length) {
      if (s[i] === '<') depth++;
      else if (s[i] === '>') { depth--; if (depth === 0) { i++; break; } }
      i++;
    }
  }
  // array brackets
  while (s[i] === '[' || s[i] === ']') i++;
  return s.slice(0, i);
}

// ── Class / Trigger declaration ────────────────────────────────────────────

const CLASS_RE = /^(public|private|global|protected)?\s*(?:with sharing|without sharing|inherited sharing)?\s*(abstract|virtual)?\s*(class|interface|enum)\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w\s,<>]+?))?(?:\s*\{|$)/im;

const TRIGGER_RE = /^\s*trigger\s+(\w+)\s+on\s+(\w+)\s*\(([^)]+)\)/im;

// ── Method parsing ─────────────────────────────────────────────────────────

const METHOD_MODS = new Set(['public', 'private', 'global', 'protected', 'static', 'abstract', 'virtual', 'override', 'final', 'transient', 'testmethod', 'webservice']);

function parseParams(paramStr) {
  paramStr = paramStr.trim();
  if (!paramStr) return [];
  const params = [];
  // Split on commas not inside generics
  let depth = 0, start = 0;
  for (let i = 0; i <= paramStr.length; i++) {
    const c = paramStr[i];
    if (c === '<') depth++;
    else if (c === '>') depth--;
    else if ((c === ',' || i === paramStr.length) && depth === 0) {
      const part = paramStr.slice(start, i).trim();
      if (part) {
        const tokens = part.replace(/\s+/g, ' ').split(' ');
        // last token = name, everything before = type
        params.push({ type: tokens.slice(0, -1).join(' '), name: tokens[tokens.length - 1] });
      }
      start = i + 1;
    }
  }
  return params;
}

// ── Extract dependencies from class body ──────────────────────────────────

function extractDeps(body, className) {
  const deps = new Map(); // name -> type (dedup)

  const add = (name, type) => {
    if (!name || name === className || isApexKeyword(name)) return;
    if (!deps.has(name)) deps.set(name, type);
  };

  // new ClassName(  /  new ClassName<...>(
  for (const m of body.matchAll(/\bnew\s+(\w+)\s*[<(]/g)) add(m[1], 'instantiates');

  // Static calls / references: ClassName.something
  for (const m of body.matchAll(/\b([A-Z]\w+)\.[\w(]/g)) add(m[1], 'references');

  // SOQL: FROM SObjectType  /  FROM SObjectType__c
  for (const m of body.matchAll(/\bFROM\s+(\w+)/gi)) add(m[1], 'soql');

  // DML operations
  for (const m of body.matchAll(/\b(insert|update|delete|upsert|merge|undelete)\s+(\w+)/gi))
    add(m[2], 'dml');

  return [...deps.entries()].map(([name, type]) => ({ name, type }));
}

const APEX_KEYWORDS = new Set([
  'string','integer','decimal','double','long','boolean','blob','date','datetime',
  'time','id','object','list','map','set','void','null','true','false',
  'this','super','return','new','if','else','for','while','do','try','catch',
  'finally','throw','break','continue','class','interface','enum','extends',
  'implements','public','private','protected','global','static','final',
  'abstract','virtual','override','with','without','sharing','inherited',
  'insert','update','delete','upsert','merge','undelete','select','from',
  'where','limit','offset','order','by','group','having','and','or','not',
  'like','in','includes','excludes','system','database','schema','test',
  'trigger','on','before','after',
]);

function isApexKeyword(name) {
  return APEX_KEYWORDS.has(name.toLowerCase());
}

// ── Balance-aware body extractor ──────────────────────────────────────────

// Given text starting at the opening '{', return the content inside the outer braces
function extractBody(text, startIdx) {
  let depth = 0, i = startIdx;
  let start = -1;
  while (i < text.length) {
    if (text[i] === '{') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i);
    }
    i++;
  }
  return text.slice(start < 0 ? startIdx : start);
}

// ── Line number helper ─────────────────────────────────────────────────────

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

// ── Main class body parser ────────────────────────────────────────────────

function parseClassBody(body, className) {
  const methods = [];
  const properties = [];
  const pendingAnnotations = [];
  const lines = body.split('\n');
  let lineNum = 0;

  // We work line-by-line at the top level of this class (depth 0)
  let depth = 0;
  let i = 0;

  // Collect tokens line by line at depth=0
  // We build "statements" — sequences of tokens separated by { or ;
  // at depth 0

  let buffer = '';
  let bufferLine = 1;

  const flush = (terminator) => {
    const raw = buffer.trim();
    buffer = '';
    if (!raw) return;

    const { annotations, rest } = collectAnnotations(raw);
    if (annotations.length && !rest) {
      pendingAnnotations.push(...annotations);
      return;
    }
    const allAnnotations = [...pendingAnnotations, ...annotations];
    pendingAnnotations.length = 0;

    // Try to parse as method or property
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
      if (buffer === '' && bufferLine === 1) bufferLine = lineNum + 1;
      buffer += ch;
    }
  }
  flush(';');

  return { methods, properties };
}

// ── Declaration parser ────────────────────────────────────────────────────

function tryParseDeclaration(text, annotations, line, terminator, className) {
  // Normalise whitespace
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s) return null;

  // Collect modifier keywords
  const tokens = s.split(' ');
  const mods = { visibility: null, isStatic: false, isAbstract: false, isVirtual: false, isOverride: false };
  let ti = 0;

  while (ti < tokens.length && METHOD_MODS.has(tokens[ti].toLowerCase())) {
    const t = tokens[ti].toLowerCase();
    if (['public','private','global','protected'].includes(t)) mods.visibility = t;
    else if (t === 'static') mods.isStatic = true;
    else if (t === 'abstract') mods.isAbstract = true;
    else if (t === 'virtual') mods.isVirtual = true;
    else if (t === 'override') mods.isOverride = true;
    ti++;
  }

  const rest = tokens.slice(ti).join(' ');
  if (!rest) return null;

  // If terminated by { → likely a method or inner class declaration
  if (terminator === '{') {
    // Check for inner class/interface/enum — skip
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
    const methodRe = /^([\w<>\[\],\s]+?)\s+(\w+)\s*\(([^)]*)\)\s*$/;
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
  }

  // Terminated by ; → property / field
  if (terminator === ';') {
    // Skip pure annotations, enum values, method calls, return statements
    if (!rest || /^(return|throw|if|for|while|else|do)\b/.test(rest)) return null;
    // Skip assignment expressions (contains method calls before =)
    // Property pattern: Type name  or  Type name = value
    const propRe = /^([\w<>\[\],\s]+?)\s+(\w+)\s*(?:=.*)?$/;
    const pm = propRe.exec(rest);
    if (pm) {
      const type = pm[1].trim();
      const name = pm[2];
      // Filter out obvious non-declarations
      if (!isApexKeyword(name) && /^[A-Za-z_]/.test(type)) {
        return { kind: 'property', name, type, ...mods, annotations, line };
      }
    }
  }

  return null;
}

// ── Public entry point ────────────────────────────────────────────────────

export function parseApexFile(content, filePath) {
  const stripped = stripComments(content);
  const fileName = path.basename(filePath, path.extname(filePath));

  // Trigger?
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

  return parseClassOrInterface(stripped, fileName);
}

function parseClassOrInterface(stripped, fileName) {
  const results = [];
  parseClassRecursive(stripped, fileName, results);
  return results;
}

function parseClassRecursive(code, defaultName, results) {
  const m = CLASS_RE.exec(code);
  if (!m) return;

  const visibility = m[1] ?? null;
  const modifier   = m[2]?.toLowerCase() ?? null;
  const classType  = m[3].toLowerCase(); // class | interface | enum
  const name       = m[4];
  const extendsClass         = m[5] ?? null;
  const implementsInterfaces = m[6]
    ? m[6].split(',').map(s => s.trim()).filter(Boolean)
    : [];

  // Collect leading annotations (before this match)
  const before = code.slice(0, m.index);
  const { annotations } = collectAnnotations(before.trim().split('\n').pop() ?? '');

  const classStart = m.index + m[0].length - 1; // points to opening {
  // find the actual {
  let braceIdx = code.indexOf('{', m.index + m[0].length - 1);
  if (braceIdx === -1) braceIdx = code.indexOf('{', m.index);

  const body = extractBody(code, braceIdx);

  const { methods, properties } = classType === 'enum'
    ? { methods: [], properties: [] }
    : parseClassBody(body, name);

  const deps = extractDeps(body, name);

  results.push({
    name,
    type: classType,
    visibility,
    isAbstract: modifier === 'abstract',
    isVirtual: modifier === 'virtual',
    extendsClass,
    implementsInterfaces,
    annotations,
    methods,
    properties,
    deps,
  });

  // Look for inner classes inside body (recurse)
  parseClassRecursive(body, name, results);
}
