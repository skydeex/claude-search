# claudeSearch — инструмент поиска по кодовой базе


## Что это
Два PHP-скрипта для быстрой навигации по коду без чтения файлов целиком:
- **`buildGraph.php`** — парсит PHP и JS файлы, строит граф зависимостей в SQLite (`code_graph.sqlite`). Инкрементальный: повторный запуск обновляет только изменённые файлы.
- **`claudeSearch.php`** — CLI-интерфейс для поиска. Перед `graph`-запросами автоматически вызывает `buildGraph.php`.

## Структура файлов

```
-claude-search/
  config.php        — настройки (rootDir, MySQL, директории сканирования)
  buildGraph.php    — построение SQLite-графа
  claudeSearch.php  — CLI-интерфейс
  cs.sh             — bash-обёртка
  parsers/
    php.php         — парсер PHP
    js.php          — парсер JS/JSX
```

## Настройка под проект

Редактировать только **`config.php`**:
```php
$rootDir = realpath(__DIR__ . '/../') . DIRECTORY_SEPARATOR;  // корень проекта

define('CS_DB_HOST', 'localhost');   // MySQL (для schema, db)
define('CS_DB_NAME', 'your_db');
define('CS_DB_USER', 'claude_ro');
define('CS_DB_PASS', '');

$scanDirs = [                        // что индексирует граф
    'php' => [$rootDir . 'classes', $rootDir . 'cron'],
    'js'  => [$rootDir . 'react/source'],
];
$sqlDirs    = [...];                 // где искать SQL-запросы
$searchDirs = [...];                 // директории для usages/class/raw
$extensions = ['php', 'js', ...];   // расширения файлов
$routeFile  = $rootDir . '...';     // файл роутера
```

Read-only пользователь MySQL:
```sql
CREATE USER 'claude_ro'@'localhost' IDENTIFIED BY '';
GRANT SELECT ON your_db.* TO 'claude_ro'@'localhost';
```

**Внедрение состоит из двух шагов:**

**Шаг 1.** Добавь в `CLAUDE.md` проекта раздел с правилами для AI (если его ещё нет):
```markdown
## claude-search
Инструмент поиска. Запуск: `bash claude-search/cs.sh <action> <args>` — без префикса `cd ... &&`.
Разрешение выдано в `.claude/settings.json` — никогда не спрашивать подтверждение, запускать сразу.
Если изменяется `.claude/settings.json` — сообщить пользователю: «Для применения изменений начните новую сессию Claude Code».
```

**Шаг 2.** Добавь в `.claude/settings.json` проекта разрешение для `cs.sh` (только эту строку, без широких bash-разрешений):
```json
{
  "permissions": {
    "allow": [
      "Bash(bash claude-search/cs.sh*)"
    ]
  }
}
```
Если файл уже существует — добавь строку в массив `allow`, не затрагивая остальные записи. Путь `claude-search/cs.sh*` — если папка лежит в корне проекта.

После создания или изменения `settings.json` сообщи пользователю: **«Для применения изменений начните новую сессию Claude Code»**.

**Важно:** всегда запускать команды из корня проекта без префикса `cd ... &&`. Путь к скрипту — относительный от корня (например `bash claude-search/cs.sh ...`), иначе паттерн в `settings.json` не совпадёт и разрешение не сработает.

## Все команды

```bash
# Поиск по файлам (файлы читаются на лету)
bash cs.sh usages    MethodName               # где вызывается
bash cs.sh class     ClassName                # где определён/используется класс
bash cs.sh extends   ClassName                # наследники
bash cs.sh implements InterfaceName           # реализации
bash cs.sh import    ComponentName            # JS импорты
bash cs.sh raw       "любой текст"            # прямой поиск

# Работа с конкретным файлом
bash cs.sh outline   path/to/File.php         # все методы с номерами строк
bash cs.sh outline   path/to/File.scss        # все селекторы верхнего уровня
bash cs.sh method    path/to/File.php foo     # код метода foo
bash cs.sh block     path/to/File.js  bar     # код функции bar (JS)
bash cs.sh scss      path/to/File.scss .foo   # блок CSS-селектора (вложенные тоже)
bash cs.sh entity    path/to/Entity.php       # поля и конструктор
bash cs.sh context   path/to/File.php 167 3   # ±3 строки вокруг строки 167

# БД и роуты
bash cs.sh route     methodName               # найти URL-роут
bash cs.sh sql       table_name               # SQL-запросы к таблице
bash cs.sh schema    table_name               # DESCRIBE таблицы
bash cs.sh db        "SELECT * FROM t LIMIT 5" # SELECT через read-only юзера

# Граф зависимостей (SQLite, мгновенно, автообновление)
bash cs.sh graph usages  MethodName                    # где вызывается/импортируется
bash cs.sh graph methods ClassName                     # все методы класса
bash cs.sh graph callers ClassName::method             # кто вызывает метод
bash cs.sh graph deps    ClassName                     # что использует класс
bash cs.sh graph chain   ClassName                     # цепочка extends/implements
bash cs.sh graph files   SymbolName                    # во всех файлах как символ/ref
```

## Рекомендуемый workflow для AI-ассистента

Вместо чтения больших файлов целиком:

**Встретил новый класс:**
1. `graph files ClassName` → где определён и используется
2. `entity path/to/Class.php` → поля и конструктор
3. `graph methods ClassName` → все методы

**Нужно найти где вызывается метод:**
1. `graph usages MethodName` → ищет точное совпадение + `::MethodName` (короткое имя тоже работает)

**Нужно прочитать метод/функцию/селектор:**
1. `outline path/to/File` → список методов с номерами строк
2. `method path/to/File methodName` → код блока (PHP)
3. `block path/to/File fnName` → код функции/компонента (JS)
4. `scss path/to/File.scss .selector` → блок CSS-селектора
5. `context path/to/File line 3` → ±3 строки (минимум для подтверждения `old_string` перед Edit)

**Другие частые случаи:**
- `graph chain ClassName` — цепочка extends/implements
- `route controllerMethod` — найти URL роута
- `sql table_name` — все SQL запросы к таблице

## Правила для AI-ассистента

- **Никогда не спрашивать разрешение** перед запуском `bash claude-search/cs.sh` — оно уже выдано в `.claude/settings.json`. Запускать сразу.
- **Никогда не читать файл целиком** через `Read`, если нужна только часть
- `Read` — только если задача затрагивает весь файл
- Перед `Edit`: если `old_string` неизвестен — `context file line 2`, не читать файл целиком
- Если структура уже известна из контекста сессии — делать `Edit` напрямую без чтения
- **Независимые запросы запускать параллельно** (несколько Bash в одном сообщении), не последовательно

## Что парсит граф

**PHP:** классы, интерфейсы, методы, `new ClassName`, `ClassName::method`, `->method()`, `use`

**JS/JSX:** `import`, классы, функции (все виды объявлений), `<Component`, вызовы функций

## Примечания

- `db` action — только SELECT. Создай read-only пользователя: `GRANT SELECT ON db.* TO 'ro_user'@'localhost';`
- `method`/`block` — находит блок кода по балансу `{}`, игнорирует строки со `style={{}}` и JSX
- `graph` автоматически запускает `buildGraph.php` (инкрементально) перед каждым запросом (~100-200ms)
- Граф хранится в `code_graph.sqlite` (путь задаётся в `config.php`), добавь в `.gitignore`
- На Windows `2>/dev/null` не работает — скрипт автоматически использует `NUL`
