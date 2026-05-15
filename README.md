# sf-agent-search

Node.js MCP server that indexes a Salesforce SFDX project into SQLite and exposes it to AI assistants (Claude, Cursor, etc.) via the Model Context Protocol.

## What it indexes

**Apex classes & triggers**
- Class/interface/enum/trigger declarations with visibility, modifiers, annotations
- Methods: name, visibility, static/abstract/virtual/override, return type, parameters, annotations, line number
- Properties/fields: name, type, visibility, static, annotations
- Dependencies: instantiations (`new X()`), static references (`X.method()`), SOQL objects (`FROM X`), DML targets

**Salesforce objects (SFDX format)**
- Object metadata: API name, label, plural label, description
- Fields: API name, label, type, required, unique, external ID, description
- Lookup/MasterDetail relationships: reference target, relationship name
- Picklist values: value, label, default, active
- Validation rules: formula, error message, active status

## Project structure expected

```
<projectRoot>/
  sfdx-project.json          <- optional, used to discover packageDirectories
  force-app/
    main/
      default/
        classes/
          MyClass.cls
        triggers/
          MyTrigger.trigger
        objects/
          MyObject__c/
            MyObject__c.object-meta.xml
            fields/
              Field__c.field-meta.xml
            validationRules/
              RuleName.validationRule-meta.xml
```

## Setup

```bash
npm install
```

## Build the index

```bash
# Incremental (only processes changed files)
node src/build.js /path/to/sf-project

# With custom DB path
node src/build.js /path/to/sf-project --db=./my_project.sqlite

# Full rebuild
node src/build.js /path/to/sf-project --force

# Verbose output
node src/build.js /path/to/sf-project -v
```

Environment variables: `SF_PROJECT`, `SF_DB`

## MCP server

```bash
SF_DB=./sf_index.sqlite node src/index.js
```

### Claude Code / claude_desktop_config.json

```json
{
  "mcpServers": {
    "sf-agent-search": {
      "command": "node",
      "args": ["/path/to/sf-agent-search/src/index.js"],
      "env": {
        "SF_DB": "/path/to/sf_index.sqlite"
      }
    }
  }
}
```

## Available MCP tools

| Tool | Description |
|------|-------------|
| `build_index` | Build or incrementally update the SQLite index from an SF project |
| `get_index_stats` | Show counts of indexed classes, fields, objects, etc. |
| `list_apex_classes` | List all Apex classes/triggers, filter by type or annotation |
| `get_apex_class` | Full details for a class: methods, properties, dependencies |
| `find_apex_usages` | Find classes that reference a given class or type |
| `get_class_hierarchy` | Show extends/implements chain and subclasses |
| `find_by_annotation` | Find classes/methods with a specific annotation (e.g. `@AuraEnabled`) |
| `search_apex` | Partial-name search across classes and methods |
| `list_sf_objects` | List all indexed SF objects with field counts |
| `get_sf_object` | Full object details: fields, relationships, validation rules, picklists |
| `get_object_fields` | List fields for an object, optionally filtered by type |
| `find_object_relationships` | Show all Lookup/MasterDetail relationships in the project |

## Incremental updates

The builder stores each file's `mtime`. On subsequent runs, only files whose modification time has changed are re-parsed. Deleted files are detected and their records removed. Pass `--force` (or `force: true` in `build_index`) for a full rebuild.

## SQLite schema

```
files                 -- indexed files with mtime
apex_classes          -- class/trigger declarations
apex_methods          -- methods with signatures and annotations
apex_properties       -- class-level properties/fields
apex_deps             -- dependencies between classes
sf_objects            -- Salesforce object metadata
sf_fields             -- object fields with types and relationships
sf_picklist_values    -- picklist field values
sf_validation_rules   -- validation rule formulas and messages
```
