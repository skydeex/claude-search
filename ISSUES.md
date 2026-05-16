# Known Issues & Backlog

Issues found during code review. Sorted by priority within each section.

---

## ✅ Исправлено (v1.2 — performance)

| # | Описание |
|---|----------|
| P1 | Cached prepared statements через `getStmts(db)` + `db._sfStmts ??= createStmts(db)` |
| P2 | Транзакция на весь build: все INSERT/DELETE в одном `db.transaction()` |
| P3 | FK индексы: `apex_methods(class_id)`, `apex_properties(class_id)`, `apex_deps(class_id)`, `sf_picklist_values(field_id)`, `sf_validation_rules(object_id)` |
| P4 | NOCASE индексы: `name`, `extends_class`, `dep_name`, `api_name` — now используются при `COLLATE NOCASE` запросах |
| P5* | Частично: `idx_apex_deps_dep_name NOCASE` ускоряет `find_apex_usages`. FTS для аннотаций не реализован |
| P7 | Race condition в getMtime: `try { statSync } catch { return null }`, файл-призрак пропускается |

*P5 (FTS для аннотаций/поиска) остаётся открытым.

---

## 🟠 Performance (остаток)

### P5 — `LIKE '%query%'` без Full-Text Search
**Файл:** `src/index.js` — `find_by_annotation`, `search_apex`  
**Проблема:** Substring match без индекса — full scan. На базе 5 000+ методов с `@AuraEnabled` `find_by_annotation('AuraEnabled')` будет медленным.  
**Решение:** Создать FTS5-таблицу для аннотаций, либо нормализовать аннотации в отдельную таблицу `apex_annotations(class_id, method_id, annotation_name)`.

### P6 — Синхронный `walkDir` блокирует event loop MCP-сервера
**Файл:** `src/builder.js:13`  
**Проблема:** `readdirSync` — синхронная. При вызове `build_index` через MCP сервер event loop заблокирован на всё время сборки (для большого проекта — секунды).  
**Решение:** Переписать `walkDir` на async generator с `fs.promises.readdir`.

---

## 🟡 Context Economy (экономия токенов для ИИ)

### C1 — Полные абсолютные пути в каждой строке выдачи [КРИТИЧНО]
**Файл:** `src/index.js` — `list_apex_classes`, `find_apex_usages`, `find_by_annotation`, `search_apex`  
**Проблема:** `/Users/me/project/force-app/main/default/classes/MyClass.cls` — 70+ символов на строку. При 500 классах `list_apex_classes` даёт ~35 000 лишних символов.  
**Решение:** Хранить и отдавать пути относительно `projectRoot`. Добавить `project_root` в таблицу `files` или нормализовать при выдаче.

### C2 — Нет лимитов в `list_apex_classes`, `search_apex`, `find_object_relationships`, `find_apex_usages`
**Файл:** `src/index.js`  
**Проблема:** Поиск `search_apex(query='Service')` в большой базе вернёт сотни строк.  
**Решение:** Добавить параметр `limit: z.number().optional().default(50)` и `LIMIT ?` в SQL.

### C3 — `get_sf_object` всегда возвращает «Referenced by»
**Файл:** `src/index.js:392`  
**Проблема:** Для `Account` или `Contact` «Referenced by» может быть 50+ строк.  
**Решение:** Добавить параметр `include_referenced_by: z.boolean().optional().default(false)`.

### C4 — `get_apex_class` не поддерживает выборочные секции
**Файл:** `src/index.js:104`  
**Проблема:** Слабому ИИ часто нужны только методы или только зависимости, но выдаётся всё.  
**Решение:** Добавить параметр `sections: z.array(z.enum(['methods','properties','deps'])).optional()`.

### C5 — `\n\n` вместо `\n` в `list_apex_classes`
**Файл:** `src/index.js:98`  
**Проблема:** `lines.join('\n\n')` — удваивает переводы строк без пользы.  
**Решение:** `lines.join('\n')`.

### C6 — Длинные описания tools потребляют контекст при discovery
**Файл:** `src/index.js` — все `server.tool(name, description, ...)`  
**Проблема:** Описания вида «Get full details for a Salesforce object: all fields with types, relationships, and validation rules.» отправляются LLM при каждом tool discovery.  
**Решение:** Сократить до 5–8 слов. Детали — в параметрах.

---

## 🔵 Логические / Прочие

### L1 — `findSfdxDirs` хардкодит `/main/default` к путям из `packageDirectories`
**Файл:** `src/builder.js:38`  
**Проблема:** Если `packageDirectories[].path = "src"`, утилита ищет в `src/main/default` — что неверно для нестандартных layouts.  
**Решение:** Сканировать `path` напрямую, рекурсивно находить `classes/`, `triggers/`, `objects/` в любом поддиректории.

### L2 — `dbCache` не закрывает DB-хендлы при shutdown
**Файл:** `src/index.js:14`  
**Проблема:** При SIGTERM/SIGINT WAL-файлы могут остаться открытыми.  
**Решение:**
```javascript
process.on('SIGINT', () => { for (const db of dbCache.values()) db.close(); process.exit(0); });
process.on('SIGTERM', () => { for (const db of dbCache.values()) db.close(); process.exit(0); });
```

### L3 — `getDb()` молча создаёт пустую БД по неверному пути
**Файл:** `src/index.js:15`  
**Проблема:** При неверном `db_path` создастся пустая база без ошибки.  
**Решение:** Опционально проверять существование файла если не вызывался `build_index`.

### L4 — `upsertFile` делает лишний SELECT перед INSERT
**Файл:** `src/db.js:140`  
**Проблема:** Все обработчики уже вызывают `deleteFileByPath` перед `upsertFile`, поэтому SELECT внутри `upsertFile` всегда вернёт «не найдено» — лишний round-trip.  
**Решение:** Заменить `upsertFile` на чистый `INSERT` после `DELETE`, убрать SELECT.

### L5 — Аннотации хранятся как JSON-строки, поиск по LIKE неточен
**Файл:** `src/db.js`, `src/index.js`  
**Проблема:** `annotations LIKE '%AuraEnabled%'` найдёт также `@AuraEnabledCustom`. Связано с P5.  
**Решение:** Нормализовать аннотации в отдельную таблицу.

### L6 — Picklist: глобальные value sets не разрешаются
**Файл:** `src/parsers/sfObject.js:47`  
**Проблема:** Поля с `globalValueSet` имеют пустой список `picklistValues`. Значения хранятся в отдельном файле `globalValueSets/*.globalValueSet-meta.xml`.  
**Решение:** Добавить парсер `globalValueSet` файлов и разрешать референсы при сборке.

---

## ✅ Исправлено (v1.1)

| # | Описание |
|---|----------|
| 1 | `find_apex_usages` с `extends`/`implements` всегда возвращал пусто |
| 2 | Триггеры теряли `trigger_object` и `trigger_events` |
| 3 | Multi-line аннотации (`@AuraEnabled\n@InvocableMethod`) парсились только частично |
| 4 | Inner classes: находился только первый из нескольких |
| 5 | Properties с `{ get; set; }` не парсились |
| 6 | SOQL-зависимости терялись если класс уже был в deps как `instantiates` |
| 7 | Picklist `active` всегда `true` из-за сравнения строки с `false` |
| 8 | `implements_interfaces LIKE '%Name%'` давал ложные срабатывания |
| 9 | DML deps захватывали имена переменных (`acc`, `accounts`) вместо SObject-типов |
