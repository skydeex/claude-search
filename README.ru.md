# claudeSearch — инструмент навигации по кодовой базе для AI-ассистентов

🇬🇧 [Read in English](README.md)

Набор PHP-скриптов, которые дают AI-ассистенту (Claude, Cursor и др.) точный, малотокенный доступ к большой кодовой базе — **без чтения файлов целиком**.

Три взаимодополняющих режима поиска:
- **Структурный** — граф зависимостей в SQLite: кто что вызывает, цепочки наследования, все методы класса, файлы где упоминается символ. Ответ за < 10 мс.
- **Текстовый** — grep-поиск по файлам проекта на лету: использования метода, SQL-запросы к таблице, произвольный текст, роуты.
- **Семантический** — поиск по смыслу через векторные эмбеддинги (Voyage AI / OpenAI / Ollama): найти код по описанию, когда точное название неизвестно.

Вместо чтения файла на 500 строк ассистент делает один точечный запрос и получает 5–20 строк нужного вывода. Контекстное окно остаётся свободным для логики задачи.

> **Если ты AI-ассистент** — прочитай **[claudeSearch.md](claudeSearch.md)**. Там описан workflow, правила работы с файлами и все команды.

## Как это работает

- **`buildGraph.php`** — парсит PHP, JS и Go файлы, строит граф зависимостей в SQLite. Инкрементальный: повторный запуск обновляет только изменённые файлы (~100–200 мс). Если настроены эмбеддинги — автоматически индексирует новые символы.
- **`claudeSearch.php`** — CLI-интерфейс. Перед `graph`/`similar`-запросами автоматически вызывает `buildGraph.php`.
- **`config.php`** — единый файл настроек: корень проекта, доступ к MySQL, директории сканирования.
- **`cs.sh`** — bash-обёртка для удобного вызова.

---

## Структура файлов

```
claude-search/
  config.php            — все настройки (только этот файл нужно менять)
  buildGraph.php        — оркестратор: БД, helpers, сканирование, индексация эмбеддингов
  claudeSearch.php      — CLI-интерфейс всех команд
  embed.php             — провайдеры эмбеддингов (voyage, openai, ollama)
  claudeSearch.md       — инструкция для AI-ассистента (workflow, правила, команды)
  cs.sh                 — bash-обёртка для удобного вызова
  code_graph.sqlite     — SQLite-граф (генерируется автоматически, добавить в .gitignore)
  parsers/
    php.php             — парсер PHP (классы, методы, вызовы, use)
    js.php              — парсер JS/JSX (import, компоненты, функции)
    go.php              — парсер Go (struct, interface, func, receivers, import)
```

SQLite-граф хранится в `claude-search/code_graph.sqlite` проекта (путь задаётся в `config.php`).

---

## Установка

### 1. Разместить папку

Положи папку `-claude-search/` в удобное место внутри проекта (или рядом с ним, на том же уровне).

### 2. Отредактировать `config.php`

Это **единственный файл, который нужно менять**:

```php
// Корень проекта относительно этого файла
$rootDir = realpath(__DIR__ . '/../') . DIRECTORY_SEPARATOR;

// MySQL (для команд schema и db)
define('CS_DB_HOST', 'localhost');
define('CS_DB_NAME', 'your_database');
define('CS_DB_USER', 'claude_ro');
define('CS_DB_PASS', '');

// Путь к SQLite-графу
$dbPath = $rootDir . 'claude-search/code_graph.sqlite';

// Директории для индексации графа (buildGraph.php)
$scanDirs = [
    'php' => [$rootDir . 'src', $rootDir . 'app'],
    'js'  => [$rootDir . 'resources/js'],
];

// Директории для поиска SQL-запросов (команда sql)
$sqlDirs = [$rootDir . 'src/models', $rootDir . 'src/services'];

// Директории для текстового поиска (usages, class, raw, ...)
$searchDirs = [$rootDir . 'src', $rootDir . 'resources/js', $rootDir . 'templates'];

// Расширения файлов для поиска
$extensions = ['php', 'js', 'tpl', 'scss', 'css'];

// Файл роутера (команда route)
$routeFile = $rootDir . 'routes/web.php';
```

Папка `claude-search/` должна быть доступна на запись.

### 3. Поправить `$rootDir` при необходимости

По умолчанию `realpath(__DIR__ . '/../')` указывает на **родителя** папки `-claude-search/`. Измени `/../`, если папка размещена иначе.

### 4. Добавить новый язык

Поддержка Go уже встроена (`parsers/go.php`). Чтобы включить её в `config.php`:
```php
$scanDirs['go'] = [$rootDir . 'cmd', $rootDir . 'internal'];
$extensions[]   = 'go';
```

Чтобы добавить другой язык (например Python), создай `parsers/python.php` с функцией `parsePython()`, затем в `buildGraph.php`:
```php
require_once __DIR__ . '/parsers/python.php';
$parsers['py'] = 'parsePython';
```
И в `config.php` добавь директории и расширение.

### 5. PHP в PATH

**Linux/Mac:** PHP обычно уже в PATH.

**Windows (Git Bash):** добавь в `~/.bash_profile`:
```bash
export PATH="$PATH:/c/OSPanel/modules/php/PHP_8.x"
```

### 6. Read-only пользователь MySQL (для `schema` и `db`)

```sql
CREATE USER 'claude_ro'@'localhost' IDENTIFIED BY '';
GRANT SELECT ON your_database.* TO 'claude_ro'@'localhost';
```

### 7. Добавить в `.gitignore`

```
claude-search/code_graph.sqlite
```

---

## Все команды

```bash
# Поиск по файлам проекта (читаются на лету)
bash cs.sh usages    MethodName               # где вызывается метод/функция
bash cs.sh class     ClassName                # где определён и используется класс
bash cs.sh extends   ClassName                # наследники класса
bash cs.sh implements InterfaceName           # реализации интерфейса
bash cs.sh import    ComponentName            # JS-импорты компонента
bash cs.sh raw       "любой текст"            # прямой текстовый поиск

# Работа с конкретным файлом
bash cs.sh outline   path/to/File.php         # все методы с номерами строк
bash cs.sh outline   path/to/File.go          # все func/методы с номерами строк (Go)
bash cs.sh outline   path/to/File.scss        # все селекторы верхнего уровня
bash cs.sh method    path/to/File.php foo     # код метода foo (PHP)
bash cs.sh method    path/to/File.go  Foo     # код func/метода Foo (Go)
bash cs.sh block     path/to/File.js  bar     # код функции/компонента bar (JS)
bash cs.sh scss      path/to/File.scss .foo   # блок CSS-селектора (включая вложенные)
bash cs.sh entity    path/to/Entity.php       # поля класса и конструктор
bash cs.sh context   path/to/File.php 167 5   # ±5 строк вокруг строки 167

# БД и роуты
bash cs.sh route     methodName               # найти URL-роут по имени метода
bash cs.sh sql       table_name               # все SQL-запросы к таблице (многострочные тоже)
bash cs.sh schema    table_name               # DESCRIBE таблицы из MySQL
bash cs.sh db        "SELECT * FROM t LIMIT 5" # SELECT через read-only пользователя

# Граф зависимостей (SQLite, мгновенно, автообновление)
bash cs.sh graph usages  MethodName                    # где вызывается/импортируется
bash cs.sh graph methods ClassName                     # все методы и символы класса
bash cs.sh graph callers ClassName::method             # кто вызывает метод
bash cs.sh graph deps    ClassName                     # что использует класс (исходящие refs)
bash cs.sh graph chain   ClassName                     # цепочка extends/implements
bash cs.sh graph files   SymbolName                    # во всех файлах как символ или ref

# Семантический поиск (требует настройки CS_EMBED_PROVIDER в config.php)
bash cs.sh similar "расчёт налога 7%"                 # поиск по смыслу (текст)
bash cs.sh similar ClassName::methodName              # найти похожие на метод
```

### Запуск buildGraph.php напрямую

```bash
php claude-search/buildGraph.php          # инкрементальный (только изменённые файлы)
php claude-search/buildGraph.php --full   # полная пересборка графа
```

---

## Что парсит граф

**PHP:** классы, интерфейсы, методы, `new ClassName`, `ClassName::method`, `->method()`, `use`

**JS/JSX:** `import`, классы, функции (все виды объявлений), `<Component`, вызовы функций

**Go:** `type X struct`, `type X interface`, `func (r *T) Method(` → `T::Method`, top-level `func`, вызовы методов и функций, `&Type{}` инициализация, `import`

---

## Схема SQLite

```sql
-- Файлы проекта
files       (id, path, mtime, lang)

-- Символы: классы, методы, функции, компоненты
symbols     (id, file_id, type, name, full_name, line, visibility, is_static)
-- type: class | method | function | property | component
-- full_name: ClassName::methodName

-- Ссылки: вызовы, импорты, наследование
refs        (id, file_id, from_full_name, to_name, ref_type, line)
-- ref_type: call | static_call | instantiate | extends | implements | import | jsx

-- Эмбеддинги для семантического поиска (заполняется если настроен CS_EMBED_PROVIDER)
embeddings  (symbol_id, vector)
-- vector: JSON float[] — только INSERT для новых символов, никогда UPDATE
```

---

## Рекомендуемый workflow для AI-ассистента

Вместо чтения больших файлов целиком:

**Встретил новый класс:**
1. `graph files ClassName` → где определён и используется
2. `entity path/to/Class.php` → поля и конструктор
3. `graph methods ClassName` → все методы

**Нужно найти где вызывается метод:**
1. `graph usages MethodName` → мгновенно из SQLite (ищет точное имя и `ClassName::method`)

**Нужно прочитать метод/функцию/селектор:**
1. `outline path/to/File` → список методов с номерами строк (PHP, Go, JS)
2. `method path/to/File methodName` → код блока (PHP или Go)
3. `block path/to/File fnName` → код функции/компонента (JS)
4. `scss path/to/File.scss .selector` → блок CSS-селектора
5. `context path/to/File line 3` → ±3 строки (для проверки `old_string` перед Edit)

**Специфика Go:**
1. `graph methods StructName` → все методы структуры
2. `outline path/to/file.go` → все func/методы, вывод в формате `Type.Method()`
3. `method path/to/file.go FuncName` → код функции или метода Go

**Другие частые случаи:**
- `graph chain ClassName` — цепочка extends/implements
- `route controllerMethod` — найти URL роута
- `sql table_name` — все SQL-запросы к таблице

**Правила:**
- Никогда не читать файл целиком, если нужна только часть
- `Read` — только если задача затрагивает весь файл
- Независимые запросы запускать параллельно
- Не выдумывать методы и поля — проверять через `entity` или `graph methods`

---

## Пример настройки CLAUDE.md

После редактирования `config.php` добавь в `CLAUDE.md` раздел `## Работа с файлами`:

```markdown
## Работа с файлами

**Инструмент поиска:** `-claude-search/claudeSearch.php`
bash /path/to/project/-claude-search/cs.sh <action> <term>

**Приоритет действий:**

Встретил новый класс:
1. `graph files ClassName` → где определён и используется
2. `entity path/to/Class.php` → поля и конструктор
3. `graph methods ClassName` → все методы

Нужно найти где вызывается метод:
1. `graph usages MethodName` → мгновенно из SQLite

Нужно прочитать метод:
1. `outline path/to/File` → список методов с номерами строк
2. `method path/to/File methodName` → код блока
```

---

## Оценка эффективности

Основная проблема при работе AI-ассистента с большим проектом — быстрое заполнение контекстного окна чтением файлов. claudeSearch решает это точечными запросами вместо полного чтения.

### Экономия токенов

| Операция | Без инструмента | С claudeSearch | Экономия |
|---|---|---|---|
| Найти где вызывается метод | читать все файлы проекта (~50–200 КБ) | `graph usages Method` → 5–20 строк | **99%** |
| Прочитать один метод | читать весь файл (300–1000 строк) | `method File.php foo` → 10–40 строк | **95%** |
| Узнать поля класса | читать весь файл | `entity File.php` → 10–20 строк | **95%** |
| Список методов файла | читать весь файл | `outline File.php` → 1 строка на метод | **90%** |
| Найти SQL к таблице | читать все model/service файлы | `sql table_name` → только совпадения | **98%** |
| Структура таблицы БД | искать migrations или schema | `schema table_name` → мгновенно | **100%** |

### Влияние на качество работы

**Без инструмента:** AI быстро заполняет контекст чтением файлов → приходится сжимать историю → теряется контекст задачи → растёт число ошибок и «выдумывания» несуществующих методов.

**С claudeSearch:** контекст остаётся свободным для логики задачи. AI видит только нужные фрагменты и работает точнее на протяжении длинных сессий.

### Производительность графа

- Инкрементальное обновление: **100–200 мс** (только изменённые файлы)
- Полная пересборка ~500 файлов: **3–8 сек**
- Запрос к SQLite (`graph usages`, `graph methods`): **< 10 мс**

---

## Планы развития

Каждый язык — отдельный файл в `parsers/`. Добавление нового языка не затрагивает существующий код.

**C / C++** (`parsers/c.php`) — `struct`, `enum`, объявления функций, `.h`/`.hpp`, `#include`

**Python** (`parsers/python.php`) — `class`, `def`, декораторы, `import`

### Настройка эмбеддингов (`similar`)

Раскомментировать в `config.php`:
```php
// Voyage AI (лучше для кода):
define('CS_EMBED_PROVIDER', 'voyage');
define('CS_EMBED_KEY',      'pa-...');

// OpenAI:
define('CS_EMBED_PROVIDER', 'openai');
define('CS_EMBED_KEY',      'sk-...');

// Ollama (локально, без ключа):
define('CS_EMBED_PROVIDER', 'ollama');
// define('CS_OLLAMA_MODEL', 'nomic-embed-text');
```

После настройки запустить `php buildGraph.php` — новые символы проиндексируются автоматически.

---

## Примечания

> Извините, что на PHP — просто был под рукой 🙂

- `db` action — только SELECT-запросы. Другие запросы блокируются на уровне кода.
- `method`/`block` — находит блок по балансу `{}`, корректно игнорирует строки со `style={{}}` и JSX-атрибутами.
- `graph` и `similar` автоматически вызывают `buildGraph.php` инкрементально перед каждым запросом.
- На Windows `2>/dev/null` не работает — скрипт автоматически подставляет `NUL`.
- Требует PHP с расширениями `pdo_sqlite` и `pdo_mysql`.
- `similar` дополнительно требует расширение `curl` и настроенный `CS_EMBED_PROVIDER` в `config.php`.
