# Known Issues & Backlog

Issues found during code review. Sorted by priority within each section.

---

## 🟠 Performance

### P1 — `db.prepare()` вызывается при каждом обращении к функции
**Файлы:** `src/db.js` — все функции (`fileNeedsUpdate`, `upsertFile`, `insertApexClass`, `insertSfField`, etc.)  
**Проблема:** `better-sqlite3` не кэширует prepared statements автоматически. При сборке 500 файлов × ~10 prepare = 5 000+ лишних компиляций SQL.  
**Решение:** Вынести statements в module-level объект (один раз per DB connection), использовать паттерн `db._stmts ??= { ... }`.

### P2 — Нет транзакции вокруг всей сборки (мёртвый код)
**Файл:** `src/builder.js:71`  
**Проблема:** `processFile = db.transaction(...)` создана, но **никогда не используется**. Каждая вставка — отдельный fsync. Для 500 файлов это 5–10× медленнее, чем нужно.  
**Решение:** Обернуть весь цикл `buildIndex` в одну транзакцию:
```javascript
const runBuild = db.transaction(() => { /* весь цикл */ });
runBuild();
```

### P3 — Отсутствуют индексы на foreign key колонках
**Файл:** `src/db.js` — конец `createSchema`  
**Проблема:** JOIN'ы по `class_id`, `object_id`, `field_id` делают full scan без индексов.  
**Решение:** Добавить:
```sql
CREATE INDEX IF NOT EXISTS idx_apex_methods_class_id    ON apex_methods(class_id);
CREATE INDEX IF NOT EXISTS idx_apex_properties_class_id ON apex_properties(class_id);
CREATE INDEX IF NOT EXISTS idx_apex_deps_class_id       ON apex_deps(class_id);
CREATE INDEX IF NOT EXISTS idx_sf_fields_object_id      ON sf_fields(object_id);
CREATE INDEX IF NOT EXISTS idx_sf_picklist_field_id     ON sf_picklist_values(field_id);
CREATE INDEX IF NOT EXISTS idx_sf_valrules_object_id    ON sf_validation_rules(object_id);
```

### P4 — `COLLATE NOCASE` запросы не используют существующие индексы
**Файл:** `src/db.js:110` и `src/index.js` повсеместно  
**Проблема:** `CREATE INDEX idx_apex_classes_name ON apex_classes(name)` — индекс case-sensitive. `WHERE name = ? COLLATE NOCASE` его не использует, делает full scan.  
**Решение:** Пересоздать как `ON apex_classes(name COLLATE NOCASE)`.

### P5 — `LIKE '%query%'` без Full-Text Search
**Файл:** `src/index.js` — `find_by_annotation`, `search_apex`  
**Проблема:** Substring match без индекса — full scan. На базе 5 000+ методов с `@AuraEnabled` `find_by_annotation('AuraEnabled')` будет медленным.  
**Решение:** Создать FTS5-таблицу для аннотаций, либо нормализовать аннотации в отдельную таблицу `apex_annotations(class_id, method_id, annotation_name)`.

### P6 — Синхронный `walkDir` блокирует event loop MCP-сервера
**Файл:** `src/builder.js:13`  
**Проблема:** `readdirSync` — синхронная. При вызове `build_index` через MCP сервер event loop заблокирован на всё время сборки (для большого проекта — секунды).  
**Решение:** Переписать `walkDir` на async generator с `fs.promises.readdir`.

### P7 — Race condition: файл может удалиться между `walkDir` и `getMtime`
**Файл:** `src/builder.js:23`  
**Проблема:** `fs.statSync(filePath)` бросит ENOENT если файл удалили в промежутке между enumerate и stat.  
**Решение:**
```javascript
function getMtime(filePath) {
  try { return fs.statSync(filePath).mtimeMs; } catch { return null; }
}
// и пропускать файл если mtime === null
```

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
