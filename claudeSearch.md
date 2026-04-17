# Инструмент поиска по кодовой базе: claudeSearch.php + buildGraph.php


db — переключён на юзера claude_ro (read-only). Нужно создать его в MySQL когда БД включишь:
CREATE USER 'claude_ro'@'localhost' IDENTIFIED BY '';
GRANT SELECT ON skydee0l_oz.* TO 'claude_ro'@'localhost';


## Что это
Два PHP-скрипта для быстрой навигации по коду без чтения файлов целиком:
- **`buildGraph.php`** — парсит PHP и JS файлы, строит граф зависимостей в SQLite (`cache/code_graph.sqlite`). Инкрементальный: повторный запуск обновляет только изменённые файлы.
- **`claudeSearch.php`** — CLI-интерфейс для поиска. Перед `graph`-запросами автоматически вызывает `buildGraph.php`.

## Файлы

Положи оба скрипта в удобное место, например `tools/` или `scripts/`. Адаптируй пути.

### buildGraph.php

Настрой переменные в начале:
  ```php
  $rootDir  = __DIR__ . '/../../';          // корень проекта
  $dbPath   = $rootDir . 'cache/code_graph.sqlite';

  $scanDirs = [
      'php' => [
          $rootDir . 'src',                 // твои PHP-директории
          $rootDir . 'app',
      ],
      'js' => [
          $rootDir . 'resources/js',        // твои JS/JSX-директории
      ],
  ];
  ```

Папка `cache/` должна существовать и быть доступна на запись.

Запуск:
  ```bash
  php buildGraph.php          # инкрементальный
  php buildGraph.php --full   # полная пересборка
  ```

### claudeSearch.php

Настрой `$rootDir` и директории сканирования в конце файла (блок "остальные actions"):
  ```php
  $rootDir = __DIR__ . '/../../';

  $dirs = [
      $rootDir . 'src',
      $rootDir . 'app',
      $rootDir . 'resources/js',
  ];
  $extensions = ['php', 'js', 'scss', 'css'];  // нужные расширения
  ```

Для `route` — укажи путь к файлу роутов:
  ```php
  $routeFile = $rootDir . 'routes/web.php';
  ```

Для `schema` и `db` — настрой DSN и пользователя БД:
  ```php
  $pdo = new PDO('mysql:host=localhost;dbname=YOUR_DB;charset=utf8', 'read_only_user', '');
  ```

### cs.sh (обёртка)

Создай `cs.sh` в корне проекта:
  ```bash
  #!/bin/bash
  php "$(dirname "$0")/claudeSearch.php" "$@"
  ```

Требует PHP в PATH. На Windows (OSPanel) — два шага:

1. Добавить в `~/.bash_profile` (для git bash):
  ```bash
  echo 'export PATH="$PATH:/c/OSPanel/modules/php/PHP_VERSION"' >> ~/.bash_profile
  ```
2. Добавить в Windows PATH (для cmd/других инструментов):
  ```
  setx PATH "%PATH%;C:\OSPanel\modules\php\PHP_VERSION"
  ```
После — перезапустить терминал (или `source ~/.bash_profile` для текущей сессии).

Теперь вызов: `bash /path/to/project/cs.sh <action> <term>`

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

- **Никогда не читать файл целиком** через `Read`, если нужна только часть
- `Read` — только если задача затрагивает весь файл
- Перед `Edit`: если `old_string` неизвестен — `context file line 2`, не читать файл целиком
- Если структура уже известна из контекста сессии — делать `Edit` напрямую без чтения
- **Независимые запросы запускать параллельно** (несколько Bash в одном сообщении), не последовательно

## Что парсит граф

**PHP:** классы, интерфейсы, методы, `new ClassName`, `ClassName::method`, `->method()`, `use`

**JS/JSX:** `import`, классы, функции (все виды объявлений), `<Component`, вызовы функций

## Обнови CLAUDE.md прямо сейчас

Найди `CLAUDE.md` в корне проекта. Если файла нет — создай его.

Добавь раздел `## Работа с файлами` со следующим содержимым (адаптируй путь к `cs.sh`):

```
## Работа с файлами

**Инструмент поиска:** `classes/utils/claudeSearch.php`
bash /path/to/project/cs.sh <action> <term>

**Приоритет действий:**

Встретил новый класс:
1. `graph files ClassName` → где определён и используется
2. `entity path/to/Class.php` → поля и конструктор
3. `graph methods ClassName` → все методы

Нужно найти где вызывается метод:
1. `graph usages MethodName` → мгновенно из SQLite

Нужно прочитать метод/функцию/селектор:
1. `outline path/to/File` → список методов с номерами строк
2. `method path/to/File methodName` → код блока (PHP)
3. `block path/to/File fnName` → код функции/компонента (JS)
4. `scss path/to/File.scss .selector` → блок CSS-селектора
5. `context path/to/File line [radius]` → N строк вокруг строки

Другие частые случаи:
- `graph chain ClassName` — цепочка extends/implements
- `route methodName` — найти URL роута
- `sql tableName` — все SQL запросы к таблице

**Параллельность:**
- Независимые `cs.sh` запросы запускать параллельно (несколько Bash в одном сообщении), не последовательно

**Правила чтения файлов:**
- Никогда не читать файл целиком через Read, если нужна только часть
- Read — только если задача затрагивает весь файл
- Перед Edit: если точный текст old_string неизвестен — context file line 2, не читать файл целиком
- Никогда не выдумывать методы/поля — проверять через entity или graph methods
```

## Примечания

- `db` action — только SELECT. Создай read-only пользователя: `GRANT SELECT ON db.* TO 'ro_user'@'localhost';`
- `method`/`block` — находит блок кода по балансу `{}`, игнорирует строки со `style={{}}` и JSX
- `graph` автоматически запускает `buildGraph.php` (инкрементально) перед каждым запросом (~100-200ms)
- Граф хранится в `code_graph.sqlite` (путь задаётся в buildGraph.php), добавь в `.gitignore`
- На Windows `2>/dev/null` не работает — скрипт автоматически использует `NUL`
