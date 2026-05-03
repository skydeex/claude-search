# claudeSearch — codebase navigation tool for AI assistants

🇷🇺 [Читать на русском](README.ru.md)

A set of PHP scripts that give an AI assistant (Claude, Cursor, etc.) precise, low-token access to a large codebase — **without reading entire files**.

Three complementary search modes:
- **Structural** — dependency graph in SQLite: who calls what, inheritance chains, all methods of a class, files where a symbol appears. Answers in < 10 ms.
- **Textual** — grep-style search across project files on the fly: method usages, SQL queries to a table, raw text, routes.
- **Semantic** — vector similarity search via embeddings (Voyage AI / OpenAI / Ollama): find code by meaning when you don't know the exact name.

Instead of reading a 500-line file, the assistant asks one targeted query and gets back 5–20 lines of relevant output. Context window stays free for actual task logic.

> **If you are an AI assistant** — read **[claudeSearch.md](claudeSearch.md)**. It contains the workflow, file-reading rules and all commands.

## How it works

- **`buildGraph.php`** — parses PHP, JS and Go files, builds a dependency graph in SQLite. Incremental: re-running only updates changed files (~100–200 ms). If embeddings are configured, automatically indexes new symbols.
- **`claudeSearch.php`** — CLI interface. Automatically calls `buildGraph.php` before any `graph` or `similar` query.
- **`config.php`** — single configuration file: project root, MySQL credentials, scan directories.
- **`cs.sh`** — bash wrapper for convenient invocation.

---

## File structure

```
claude-search/
  config.php            — all configuration (edit this to set up a new project)
  buildGraph.php        — orchestrator: DB, helpers, file scanning, embeddings indexing
  claudeSearch.php      — CLI interface for all commands
  embed.php             — embedding providers (voyage, openai, ollama)
  claudeSearch.md       — AI assistant guide (workflow, rules, commands)
  cs.sh                 — bash wrapper for convenient invocation
  code_graph.sqlite     — SQLite graph (auto-generated, add to .gitignore)
  parsers/
    php.php             — PHP parser (classes, methods, calls, use)
    js.php              — JS/JSX parser (import, components, functions)
    go.php              — Go parser (structs, interfaces, funcs, receivers, imports)
```

The SQLite graph is stored in the project's `code_graph.sqlite` (configured in `config.php`).

---

## Setup

### 1. Place the folder

Put the entire `-claude-search/` folder anywhere inside your project (or alongside it at the same level).

### 2. Edit `config.php`

This is the **only file you need to edit**:

```php
// Project root relative to this file
$rootDir = realpath(__DIR__ . '/../') . DIRECTORY_SEPARATOR;

// MySQL (for schema and db commands)
define('CS_DB_HOST', 'localhost');
define('CS_DB_NAME', 'your_database');
define('CS_DB_USER', 'claude_ro');
define('CS_DB_PASS', '');

// SQLite graph path
$dbPath = $rootDir . 'claude-search/code_graph.sqlite';

// Directories for graph indexing (buildGraph.php)
$scanDirs = [
    'php' => [$rootDir . 'src', $rootDir . 'app'],
    'js'  => [$rootDir . 'resources/js'],
];

// Directories for SQL search (sql command)
$sqlDirs = [$rootDir . 'src/models', $rootDir . 'src/services'];

// Directories for text search (usages, class, raw, ...)
$searchDirs = [$rootDir . 'src', $rootDir . 'resources/js', $rootDir . 'templates'];

// File extensions to search
$extensions = ['php', 'js', 'tpl', 'scss', 'css'];

// Router file (route command)
$routeFile = $rootDir . 'routes/web.php';
```

The `claude-search/` directory must be writable.

### 3. Adjust `$rootDir` if needed

The default `realpath(__DIR__ . '/../')` points to the **parent** of the `-claude-search/` folder. Adjust `/../` if your folder is placed differently.

### 4. Add a new language

Go support is already built in (`parsers/go.php`). To enable it in `config.php`:
```php
$scanDirs['go'] = [$rootDir . 'cmd', $rootDir . 'internal'];
$extensions[]   = 'go';
```

To add another language (e.g. Python), create `parsers/python.php` with a `parsePython()` function, then in `buildGraph.php`:
```php
require_once __DIR__ . '/parsers/python.php';
$parsers['py'] = 'parsePython';
```
And in `config.php` add scan directories and extension.

### 5. PHP in PATH

**Linux/Mac:** PHP is usually already in PATH.

**Windows (Git Bash):** add to `~/.bash_profile`:
```bash
export PATH="$PATH:/c/OSPanel/modules/php/PHP_8.x"
```

### 6. Read-only MySQL user (for `schema` and `db`)

```sql
CREATE USER 'claude_ro'@'localhost' IDENTIFIED BY '';
GRANT SELECT ON your_database.* TO 'claude_ro'@'localhost';
```

### 7. Add to `.gitignore`

```
claude-search/code_graph.sqlite
```

---

## All commands

```bash
# Search across project files (read on the fly)
bash cs.sh usages    MethodName               # where a method/function is called
bash cs.sh class     ClassName                # where a class is defined and used
bash cs.sh extends   ClassName                # subclasses
bash cs.sh implements InterfaceName           # implementations
bash cs.sh import    ComponentName            # JS imports of a component
bash cs.sh raw       "any text"               # raw text search

# Work with a specific file
bash cs.sh outline   path/to/File.php         # all methods with line numbers
bash cs.sh outline   path/to/File.go          # all funcs/methods with line numbers (Go)
bash cs.sh outline   path/to/File.scss        # all top-level selectors
bash cs.sh method    path/to/File.php foo     # code of method foo (PHP)
bash cs.sh method    path/to/File.go  Foo     # code of func/method Foo (Go)
bash cs.sh block     path/to/File.js  bar     # code of function/component bar (JS)
bash cs.sh scss      path/to/File.scss .foo   # CSS selector block (including nested)
bash cs.sh entity    path/to/Entity.php       # class fields and constructor
bash cs.sh context   path/to/File.php 167 5   # ±5 lines around line 167

# DB and routes
bash cs.sh route     methodName               # find URL route by controller method name
bash cs.sh sql       table_name               # all SQL queries to a table (multiline too)
bash cs.sh schema    table_name               # DESCRIBE table from MySQL
bash cs.sh db        "SELECT * FROM t LIMIT 5" # SELECT via read-only user

# Dependency graph (SQLite, instant, auto-updated)
bash cs.sh graph usages  MethodName                    # where it is called/imported
bash cs.sh graph methods ClassName                     # all methods and symbols of a class
bash cs.sh graph callers ClassName::method             # who calls a method
bash cs.sh graph deps    ClassName                     # what the class uses (outgoing refs)
bash cs.sh graph chain   ClassName                     # extends/implements chain
bash cs.sh graph files   SymbolName                    # all files where symbol appears

# Semantic search (requires CS_EMBED_PROVIDER in config.php)
bash cs.sh similar "calculate tax 7%"                 # search by meaning (text query)
bash cs.sh similar ClassName::methodName              # find symbols similar to a method
```

### Running buildGraph.php directly

```bash
php claude-search/buildGraph.php          # incremental (changed files only)
php claude-search/buildGraph.php --full   # full rebuild
```

---

## What the graph parses

**PHP:** classes, interfaces, methods, `new ClassName`, `ClassName::method`, `->method()`, `use`

**JS/JSX:** `import`, classes, functions (all declaration styles), `<Component`, function calls

**Go:** `type X struct`, `type X interface`, `func (r *T) Method(` → `T::Method`, top-level `func`, method/function calls, `&Type{}` instantiation, `import`

---

## SQLite schema

```sql
-- Project files
files       (id, path, mtime, lang)

-- Symbols: classes, methods, functions, components
symbols     (id, file_id, type, name, full_name, line, visibility, is_static)
-- type: class | method | function | property | component
-- full_name: ClassName::methodName

-- References: calls, imports, inheritance
refs        (id, file_id, from_full_name, to_name, ref_type, line)
-- ref_type: call | static_call | instantiate | extends | implements | import | jsx

-- Embeddings for semantic search (populated when CS_EMBED_PROVIDER is configured)
embeddings  (symbol_id, vector)
-- vector: JSON float[] — INSERT only for new symbols, never UPDATE
```

---

## Recommended workflow for AI assistants

Instead of reading large files in full:

**Encountered a new class:**
1. `graph files ClassName` → where it is defined and used
2. `entity path/to/Class.php` → fields and constructor
3. `graph methods ClassName` → all methods

**Need to find where a method is called:**
1. `graph usages MethodName` → instant from SQLite (matches exact name and `ClassName::method`)

**Need to read a method/function/selector:**
1. `outline path/to/File` → list of methods with line numbers (PHP, Go, JS)
2. `method path/to/File methodName` → method/function body (PHP or Go)
3. `block path/to/File fnName` → function/component body (JS)
4. `scss path/to/File.scss .selector` → CSS selector block
5. `context path/to/File line 3` → ±3 lines (to verify `old_string` before Edit)

**Go-specific:**
1. `graph methods StructName` → all methods of a struct
2. `outline path/to/file.go` → all funcs/methods, shown as `Type.Method()`
3. `method path/to/file.go FuncName` → Go function or method body

**Other common cases:**
- `graph chain ClassName` — extends/implements chain
- `route controllerMethod` — find URL route
- `sql table_name` — all SQL queries to a table

**Rules:**
- Never read an entire file if only a part is needed
- `Read` — only when the task involves the whole file
- Run independent queries in parallel
- Never invent methods or fields — verify via `entity` or `graph methods`

---

## CLAUDE.md setup example

After editing `config.php`, add a `## Working with files` section to `CLAUDE.md`:

```markdown
## Working with files

**Search tool:** `-claude-search/claudeSearch.php`
bash /path/to/project/-claude-search/cs.sh <action> <term>

**Priority actions:**

Encountered a new class:
1. `graph files ClassName` → where defined and used
2. `entity path/to/Class.php` → fields and constructor
3. `graph methods ClassName` → all methods

Need to find where a method is called:
1. `graph usages MethodName` → instant from SQLite

Need to read a method:
1. `outline path/to/File` → list of methods with line numbers
2. `method path/to/File methodName` → method body
```

---

## Efficiency

The core problem when an AI assistant works with a large project is context window exhaustion from reading files. claudeSearch solves this with targeted queries instead of full reads.

### Token savings

| Operation | Without tool | With claudeSearch | Savings |
|---|---|---|---|
| Find where a method is called | read all project files (~50–200 KB) | `graph usages Method` → 5–20 lines | **99%** |
| Read one method | read entire file (300–1000 lines) | `method File.php foo` → 10–40 lines | **95%** |
| Get class fields | read entire file | `entity File.php` → 10–20 lines | **95%** |
| List file methods | read entire file | `outline File.php` → 1 line per method | **90%** |
| Find SQL for a table | read all model/service files | `sql table_name` → matches only | **98%** |
| DB table structure | search migrations or schema | `schema table_name` → instant | **100%** |

### Impact on quality

**Without the tool:** AI fills context reading files → history gets compressed → task context is lost → more errors and hallucinated methods.

**With claudeSearch:** context stays free for task logic. AI sees only the relevant fragments and works more accurately throughout long sessions.

### Graph performance

- Incremental update: **100–200 ms** (changed files only)
- Full rebuild of ~500 files: **3–8 sec**
- SQLite query (`graph usages`, `graph methods`): **< 10 ms**

---

## Roadmap

Each language is a separate file in `parsers/` — adding one does not affect existing code.

**C / C++** (`parsers/c.php`) — `struct`, `enum`, function declarations, `.h`/`.hpp`, `#include`

**Python** (`parsers/python.php`) — `class`, `def`, decorators, `import`

### Enabling semantic search (`similar`)

Uncomment in `config.php`:
```php
// Voyage AI (best for code):
define('CS_EMBED_PROVIDER', 'voyage');
define('CS_EMBED_KEY',      'pa-...');

// OpenAI:
define('CS_EMBED_PROVIDER', 'openai');
define('CS_EMBED_KEY',      'sk-...');

// Ollama (local, no key required):
define('CS_EMBED_PROVIDER', 'ollama');
// define('CS_OLLAMA_MODEL', 'nomic-embed-text');
```

After configuring, run `php buildGraph.php` — new symbols will be indexed automatically.

---

## Notes

> Sorry for PHP — it was just the nearest tool at hand 🙂

- `db` action — SELECT only. Other queries are blocked at the code level.
- `method`/`block` — finds the block by `{}` balance, correctly ignores `style={{}}` and JSX attributes.
- `graph` and `similar` automatically run `buildGraph.php` incrementally before each query.
- On Windows `2>/dev/null` does not work — the script automatically substitutes `NUL`.
- Requires PHP with `pdo_sqlite` and `pdo_mysql` extensions.
- `similar` additionally requires the `curl` extension and `CS_EMBED_PROVIDER` configured in `config.php`.
