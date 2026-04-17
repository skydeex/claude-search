<?php









// Использование:
// php claudeSearch.php usages createApiSupply_per30sec
// php claudeSearch.php class OzonSupplyService
// php claudeSearch.php extends ASupplyService
// php claudeSearch.php implements ASupplyService
// php claudeSearch.php import ClusterRunList
// php claudeSearch.php raw "supplyResult"
// php claudeSearch.php method classes/service/supply/OzonSupplyService.php createApiSupply_per30sec
// php claudeSearch.php block react/source/CreateSupply/CreateSupply.js createSupply
// php claudeSearch.php outline classes/service/supply/OzonSupplyService.php
// php claudeSearch.php entity classes/entity/supply/SupplyCreateResult.php
// php claudeSearch.php route createSupply
// php claudeSearch.php sql supplies
// php claudeSearch.php context react/source/CreateSupply/CreateSupply.js 167 10
// php claudeSearch.php schema supplies
// php claudeSearch.php db "SELECT id, cluster_name, status_id FROM supplies LIMIT 10"
// php claudeSearch.php graph usages createApiSupply_per30sec
// php claudeSearch.php graph methods OzonSupplyService
// php claudeSearch.php graph callers OzonSupplyService::createApiSupply_per30sec
// php claudeSearch.php graph deps OzonSupplyService
// php claudeSearch.php graph chain OzonSupplyService
// php claudeSearch.php graph files SupplyCreateResult

$action = $argv[1] ?? null;
$term   = $argv[2] ?? null;
$term2  = $argv[3] ?? null;
$term3  = $argv[4] ?? null;

// Авто-обновление графа перед graph-запросами (инкрементальное, ~100-200ms)
if ($action === 'graph') {
    $null = PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null';
    exec(PHP_BINARY . ' ' . __DIR__ . '/buildGraph.php 2>' . $null);
}

if (!$action || !$term) {
    echo "Usage: php claudeSearch.php <action> <term>\n";
    echo "Actions: usages, class, extends, implements, import, raw, method, block, outline, entity, route, sql, context, schema, db, graph\n";
    exit(1);
}

$rootDir = __DIR__ . '/../../';


// Убрать содержимое строковых литералов и однострочных комментариев
// чтобы не считать {} внутри строк и JSX-атрибутов (style={{}})
function stripStringsAndComments(string $line): string {
    $line = preg_replace('/`[^`]*`|"[^"]*"|\'[^\']*\'/', '""', $line);
    $line = preg_replace('/\/\/.*$/', '', $line);
    return $line;
}

// Подсчёт баланса {} с учётом строк
function bracketDepth(string $line): int {
    $clean = stripStringsAndComments($line);
    return substr_count($clean, '{') - substr_count($clean, '}');
}

// Вывод таблицы из массива строк
function printTable(array $rows): void {
    if (!$rows) { echo "No rows\n"; return; }
    $cols   = array_keys($rows[0]);
    $widths = [];
    foreach ($cols as $c) {
        $max = strlen($c);
        foreach ($rows as $r) {
            $len = strlen((string)$r[$c]);
            if ($len > $max) $max = $len;
        }
        $widths[] = $max;
    }
    $sep = '+' . implode('+', array_map(function($w) { return str_repeat('-', $w + 2); }, $widths)) . '+';
    echo $sep . "\n";
    $header = '';
    foreach ($cols as $j => $c) $header .= '| ' . str_pad($c, $widths[$j]) . ' ';
    echo $header . "|\n";
    echo $sep . "\n";
    foreach ($rows as $row) {
        $line = '';
        foreach ($cols as $j => $c) $line .= '| ' . str_pad((string)$row[$c], $widths[$j]) . ' ';
        echo $line . "|\n";
    }
    echo $sep . "\n";
    echo count($rows) . " rows\n";
}


// --- method/block: найти блок кода метода/функции в конкретном файле ---
if ($action === 'method' || $action === 'block') {
    $filePath   = $rootDir . ltrim($term, '/');
    $methodName = $term2;

    if (!file_exists($filePath)) { echo "File not found: $term\n"; exit(1); }
    if (!$methodName)             { echo "Method name required\n"; exit(1); }

    $lines = file($filePath);
    $total = count($lines);
    $ext   = pathinfo($filePath, PATHINFO_EXTENSION);

    $jsKeywords = 'if|for|while|switch|catch|else|return|typeof|instanceof|new|delete|void|throw';
    $startPatterns = $ext === 'php'
        ? [
            "/function\s+{$methodName}\s*\(/",
        ]
        : [
            "/function\s+{$methodName}\s*\(/",                                                      // function foo(
            "/^\s*(?!(?:{$jsKeywords})\b)({$methodName})\s*[=:]\s*(async\s+)?(function|\()/",      // foo = function / foo = (
            "/^\s*(?:async\s+)?(?!(?:{$jsKeywords})\b)({$methodName})\s*\([^)]*\)\s*\{/",          // class method: foo() {
            "/^\s*({$methodName})\s*=\s*(?:async\s+)?\(/",                                         // class arrow: foo = () =>
        ];

    // ищем все совпадения, берём первое где имя совпадает точно
    $startLine = null;
    foreach ($lines as $i => $line) {
        $clean = stripStringsAndComments($line);
        foreach ($startPatterns as $p) {
            if (preg_match($p, $clean, $m)) {
                // убедимся что совпало именно имя, а не подстрока
                if (strpos($clean, $methodName) !== false) {
                    $startLine = $i + 1;
                    break 2;
                }
            }
        }
    }

    if (!$startLine) { echo "Method not found: $methodName\n"; exit(1); }

    // контекст: 3 строки до метода
    $contextStart = max(1, $startLine - 3);
    echo "=== context (lines {$contextStart}-" . ($startLine - 1) . ") ===\n";
    echo implode('', array_slice($lines, $contextStart - 1, $startLine - $contextStart));

    // конец блока по балансу {}
    $depth = 0; $endLine = $startLine; $started = false;
    for ($i = $startLine - 1; $i < $total; $i++) {
        $depth += bracketDepth($lines[$i]);
        if (!$started && $depth > 0) $started = true;
        if ($started && $depth <= 0) { $endLine = $i + 1; break; }
    }

    echo "=== method (lines {$startLine}-{$endLine}) ===\n";
    echo implode('', array_slice($lines, $startLine - 1, $endLine - $startLine + 1));
    exit(0);
}


// --- outline: все методы/функции/селекторы файла с номерами строк ---
if ($action === 'outline') {
    $filePath = $rootDir . ltrim($term, '/');
    if (!file_exists($filePath)) { echo "File not found: $term\n"; exit(1); }

    $lines = file($filePath);
    $ext   = pathinfo($filePath, PATHINFO_EXTENSION);

    // SCSS: только селекторы верхнего уровня (depth=0)
    if ($ext === 'scss' || $ext === 'css') {
        $depth = 0;
        foreach ($lines as $i => $line) {
            $open  = substr_count($line, '{');
            $close = substr_count($line, '}');
            if ($depth === 0 && $open > 0 && preg_match('/^\s*([^\/\*@][^{]+)\{/', $line, $m)) {
                printf("%-50s line %d\n", trim($m[1]), $i + 1);
            }
            $depth += $open - $close;
        }
        exit(0);
    }

    $jsKeywords = 'if|for|while|switch|catch|else|return|typeof|instanceof|new|delete|void|throw';
    $patterns = $ext === 'php'
        ? ["/(?:public|protected|private|static|\s)+function\s+(\w+)\s*\(/"]
        : [
            // class method: foo() { или async foo() {
            "/^\s*(?:async\s+)?(?!(?:{$jsKeywords})\s*[\(\s])([a-zA-Z_\$][a-zA-Z0-9_\$]*)\s*\([^)]*\)\s*[\{=]/",
            // const/let/var foo = function / () =>
            "/(?:const|let|var)\s+([a-zA-Z_\$][a-zA-Z0-9_\$]*)\s*=\s*(?:async\s+)?(?:function|\()/",
            // class arrow property: foo = () => / foo = async () =>
            "/^\s*([a-zA-Z_\$][a-zA-Z0-9_\$]*)\s*=\s*(?:async\s+)?\(/",
            // function foo(
            "/^\s*(?:async\s+)?function\s+([a-zA-Z_\$][a-zA-Z0-9_\$]*)\s*\(/",
        ];

    $seen = []; // не дублировать одну строку
    foreach ($lines as $i => $line) {
        $clean = stripStringsAndComments($line);
        foreach ($patterns as $p) {
            if (preg_match($p, $clean, $m)) {
                $name = end($m);
                if (in_array($i, $seen)) break;
                $seen[] = $i;
                printf("%-40s line %d\n", $name . '()', $i + 1);
                break;
            }
        }
    }
    exit(0);
}


// --- scss: извлечь блок селектора из SCSS/CSS файла ---
// php claudeSearch.php scss path/to/File.scss .selector
// php claudeSearch.php scss path/to/File.scss ".parent .child"
if ($action === 'scss') {
    $filePath = $rootDir . ltrim($term, '/');
    $selector = trim($term2 ?? '');

    if (!file_exists($filePath)) { echo "File not found: $term\n"; exit(1); }
    if (!$selector)               { echo "Selector required\n"; exit(1); }

    $lines = file($filePath);
    $total = count($lines);

    // ищем строку где встречается селектор перед {
    $needle = preg_quote(ltrim($selector, '.#&'), '/');
    $startLine = null;
    foreach ($lines as $i => $line) {
        if (preg_match('/[.#&\s]?' . $needle . '\s*[{,&]/', $line) ||
            preg_match('/' . preg_quote($selector, '/') . '\s*[{,]/', $line)) {
            $startLine = $i + 1;
            break;
        }
    }

    if (!$startLine) { echo "Selector not found: $selector\n"; exit(1); }

    // конец блока по балансу {}
    $depth = 0; $endLine = $startLine; $started = false;
    for ($i = $startLine - 1; $i < $total; $i++) {
        $open  = substr_count($lines[$i], '{');
        $close = substr_count($lines[$i], '}');
        $depth += $open - $close;
        if (!$started && $open > 0) $started = true;
        if ($started && $depth <= 0) { $endLine = $i + 1; break; }
    }

    echo "=== $term ($selector) lines {$startLine}-{$endLine} ===\n";
    echo implode('', array_slice($lines, $startLine - 1, $endLine - $startLine + 1));
    exit(0);
}


// --- entity: поля и конструктор класса-сущности ---
if ($action === 'entity') {
    $filePath = $rootDir . ltrim($term, '/');
    if (!file_exists($filePath)) { echo "File not found: $term\n"; exit(1); }

    $lines = file($filePath);
    $inConstructor = false;
    $depth = 0;

    foreach ($lines as $i => $line) {
        if (!$inConstructor && preg_match('/^\s*(public|protected|private|readonly).+?\$(\w+)/', $line)) {
            echo ($i + 1) . ': ' . trim($line) . "\n";
            continue;
        }
        if (preg_match('/function\s+__construct\s*\(/', $line))
            $inConstructor = true;
        if ($inConstructor) {
            echo ($i + 1) . ': ' . trim($line) . "\n";
            $depth += bracketDepth($line);
            if ($depth === 0 && strpos($line, '}') !== false)
                break;
        }
    }
    exit(0);
}


// --- context: N строк вокруг указанной строки файла ---
// php claudeSearch.php context path/to/File.php 167 10
if ($action === 'context') {
    $filePath  = $rootDir . ltrim($term, '/');
    $centerLine = (int)($term2 ?? 1);
    $radius    = (int)($term3 ?? 10);

    if (!file_exists($filePath)) { echo "File not found: $term\n"; exit(1); }

    $lines = file($filePath);
    $from  = max(0, $centerLine - $radius - 1);
    $to    = min(count($lines) - 1, $centerLine + $radius - 1);

    echo "=== {$term} lines " . ($from + 1) . "-" . ($to + 1) . " ===\n";
    for ($i = $from; $i <= $to; $i++) {
        $marker = ($i + 1 === $centerLine) ? '>>>' : '   ';
        printf("%s %4d: %s", $marker, $i + 1, $lines[$i]);
    }
    exit(0);
}


// --- route: найти URL-роут по имени метода контроллера ---
if ($action === 'route') {
    $routeFile = $rootDir . 'classes/router/GetRoute.php';
    if (!file_exists($routeFile)) { echo "GetRoute.php not found\n"; exit(1); }

    $lines = file($routeFile);
    foreach ($lines as $i => $line) {
        if (stripos($line, $term) !== false)
            echo ($i + 1) . ': ' . trim($line) . "\n";
    }
    exit(0);
}


// --- sql: найти все запросы к таблице (включая многострочные) ---
if ($action === 'sql') {
    $dirs = [
        $rootDir . 'classes/model',
        $rootDir . 'classes/service',
        $rootDir . 'cron',
    ];
    foreach ($dirs as $dir) {
        if (!is_dir($dir)) continue;
        $iter = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir));
        foreach ($iter as $file) {
            if ($file->getExtension() !== 'php') continue;
            $content = file_get_contents($file->getPathname());
            $relPath = str_replace(realpath($rootDir) . DIRECTORY_SEPARATOR, '', $file->getPathname());
            $relPath = str_replace('\\', '/', $relPath);

            // ищем SQL-блоки (строки и heredoc) содержащие имя таблицы
            $lines = explode("\n", $content);
            $inSql = false; $sqlStart = 0; $sqlBuf = '';
            foreach ($lines as $i => $line) {
                $isSqlLine = preg_match('/SELECT|INSERT|UPDATE|DELETE|FROM|INTO|JOIN|CREATE|ALTER/i', $line);
                $hasTable  = stripos($line, $term) !== false;

                if ($isSqlLine && !$inSql) {
                    $inSql = true; $sqlStart = $i + 1; $sqlBuf = '';
                }
                if ($inSql) {
                    $sqlBuf .= trim($line) . ' ';
                    // конец SQL-блока: пустая строка или строка без SQL-продолжения
                    if (!$isSqlLine && !preg_match('/WHERE|AND|OR|LEFT|RIGHT|INNER|ON|GROUP|ORDER|LIMIT|SET|VALUES|\)|\(/i', $line)) {
                        if (stripos($sqlBuf, $term) !== false)
                            echo "{$relPath}:{$sqlStart}: " . rtrim($sqlBuf) . "\n";
                        $inSql = false; $sqlBuf = '';
                    }
                } elseif ($hasTable && !$inSql) {
                    // одиночная строка с именем таблицы вне SQL-блока
                    echo "{$relPath}:" . ($i + 1) . ': ' . trim($line) . "\n";
                }
            }
        }
    }
    exit(0);
}


// --- schema: структура таблицы из БД ---
if ($action === 'schema') {
    try {
        $pdo = new PDO('mysql:host=localhost;dbname=skydee0l_oz;charset=utf8', 'claude_ro', '');
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $rows = $pdo->query("DESCRIBE `{$term}`")->fetchAll(PDO::FETCH_ASSOC);
        printTable($rows);
    } catch (Exception $e) {
        echo "DB error: " . $e->getMessage() . "\n";
    }
    exit(0);
}


// --- db: SELECT-запрос к БД через read-only юзера ---
if ($action === 'db') {
    $query = $term;

    if (!preg_match('/^\s*SELECT\s/i', $query)) {
        echo "Only SELECT queries allowed\n";
        exit(1);
    }

    try {
        // claude_ro — read-only юзер
        // Создать: CREATE USER 'claude_ro'@'localhost'; GRANT SELECT ON skydee0l_oz.* TO 'claude_ro'@'localhost';
        $pdo = new PDO('mysql:host=localhost;dbname=skydee0l_oz;charset=utf8', 'claude_ro', '');
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $rows = $pdo->query($query)->fetchAll(PDO::FETCH_ASSOC);
        printTable($rows);
    } catch (Exception $e) {
        echo "DB error: " . $e->getMessage() . "\n";
    }
    exit(0);
}


// --- graph: запросы к SQLite-графу кодовой базы ---
// php claudeSearch.php graph usages MethodName           — где вызывается метод/функция
// php claudeSearch.php graph methods ClassName           — все методы класса
// php claudeSearch.php graph callers ClassName::method   — кто вызывает конкретный метод
// php claudeSearch.php graph deps ClassName              — что использует класс (исходящие refs)
// php claudeSearch.php graph chain ClassName             — цепочка extends/implements
// php claudeSearch.php graph files ClassName             — в каких файлах упоминается
if ($action === 'graph') {
    $dbPath = $rootDir . 'cache/code_graph.sqlite';
    if (!file_exists($dbPath)) {
        echo "Graph not found: $dbPath\n";
        echo "Run: php classes/utils/buildGraph.php\n";
        exit(1);
    }

    $db = new PDO('sqlite:' . $dbPath);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    $subAction = $term;   // usages|methods|callers|deps|chain|files
    $name      = $term2;  // ClassName или MethodName или ClassName::method

    if (!$subAction || !$name) {
        echo "Usage: php claudeSearch.php graph <subaction> <name>\n";
        echo "Subactions: usages, methods, callers, deps, chain, files\n";
        exit(1);
    }

    // usages: где вызывается или импортируется символ (точное или ::name совпадение)
    if ($subAction === 'usages') {
        $rows = $db->query("
            SELECT r.ref_type, r.from_full_name, f.path, r.line
            FROM refs r
            JOIN files f ON f.id = r.file_id
            WHERE r.to_name = " . $db->quote($name) . "
               OR r.to_name LIKE " . $db->quote('%::' . $name) . "
            ORDER BY f.path, r.line
        ")->fetchAll(PDO::FETCH_ASSOC);
        if (!$rows) { echo "No usages: $name\n"; exit(0); }
        foreach ($rows as $r)
            printf("%-14s %-50s %s:%d\n", $r['ref_type'], $r['from_full_name'], $r['path'], $r['line']);
        echo "\n(" . count($rows) . " usages)\n";
        exit(0);
    }

    // methods: все методы/символы класса
    if ($subAction === 'methods') {
        $rows = $db->query("
            SELECT s.type, s.full_name, s.visibility, s.is_static, f.path, s.line
            FROM symbols s
            JOIN files f ON f.id = s.file_id
            WHERE s.full_name LIKE " . $db->quote($name . '::%') . "
               OR s.name = " . $db->quote($name) . "
            ORDER BY s.line
        ")->fetchAll(PDO::FETCH_ASSOC);
        if (!$rows) { echo "No symbols: $name\n"; exit(0); }
        foreach ($rows as $r) {
            $static = $r['is_static'] ? 'static ' : '';
            printf("%-10s %-10s %s%-50s %s:%d\n", $r['type'], $r['visibility'], $static, $r['full_name'], $r['path'], $r['line']);
        }
        echo "\n(" . count($rows) . " symbols)\n";
        exit(0);
    }

    // callers: кто вызывает конкретный full_name (ClassName::method или просто method)
    if ($subAction === 'callers') {
        $rows = $db->query("
            SELECT r.ref_type, r.from_full_name, f.path, r.line
            FROM refs r
            JOIN files f ON f.id = r.file_id
            WHERE r.to_name = " . $db->quote($name) . "
              AND r.ref_type IN ('call','static_call','jsx')
            ORDER BY f.path, r.line
        ")->fetchAll(PDO::FETCH_ASSOC);
        if (!$rows) { echo "No callers: $name\n"; exit(0); }
        foreach ($rows as $r)
            printf("%-12s %-50s %s:%d\n", $r['ref_type'], $r['from_full_name'], $r['path'], $r['line']);
        echo "\n(" . count($rows) . " callers)\n";
        exit(0);
    }

    // deps: что использует класс (исходящие refs от символов класса)
    if ($subAction === 'deps') {
        $rows = $db->query("
            SELECT r.ref_type, r.to_name, r.from_full_name, f.path, r.line
            FROM refs r
            JOIN files f ON f.id = r.file_id
            WHERE (r.from_full_name LIKE " . $db->quote($name . '::%') . "
               OR  r.from_full_name = " . $db->quote($name) . ")
            ORDER BY r.ref_type, r.to_name
        ")->fetchAll(PDO::FETCH_ASSOC);
        if (!$rows) { echo "No deps: $name\n"; exit(0); }
        foreach ($rows as $r)
            printf("%-14s %-40s from %-50s %s:%d\n", $r['ref_type'], $r['to_name'], $r['from_full_name'], $r['path'], $r['line']);
        echo "\n(" . count($rows) . " deps)\n";
        exit(0);
    }

    // chain: extends/implements цепочка
    if ($subAction === 'chain') {
        $visited = [];
        $queue   = [$name];
        $rows    = [];
        while ($queue) {
            $cur = array_shift($queue);
            if (isset($visited[$cur])) continue;
            $visited[$cur] = true;

            $res = $db->query("
                SELECT r.ref_type, r.to_name, f.path, r.line
                FROM refs r
                JOIN files f ON f.id = r.file_id
                WHERE r.from_full_name = " . $db->quote($cur) . "
                  AND r.ref_type IN ('extends','implements')
            ")->fetchAll(PDO::FETCH_ASSOC);

            foreach ($res as $r) {
                $rows[]  = $r + ['from' => $cur];
                $queue[] = $r['to_name'];
            }
        }
        if (!$rows) { echo "No chain: $name\n"; exit(0); }
        foreach ($rows as $r)
            printf("%-14s %-30s → %-30s %s:%d\n", $r['ref_type'], $r['from'], $r['to_name'], $r['path'], $r['line']);
        exit(0);
    }

    // files: в каких файлах упоминается (как символ или ref)
    if ($subAction === 'files') {
        $symFiles = $db->query("
            SELECT DISTINCT f.path, 'symbol' as kind, s.type, s.line
            FROM symbols s JOIN files f ON f.id = s.file_id
            WHERE s.name = " . $db->quote($name) . " OR s.full_name = " . $db->quote($name) . "
        ")->fetchAll(PDO::FETCH_ASSOC);

        $refFiles = $db->query("
            SELECT DISTINCT f.path, 'ref' as kind, r.ref_type as type, r.line
            FROM refs r JOIN files f ON f.id = r.file_id
            WHERE r.to_name = " . $db->quote($name) . "
        ")->fetchAll(PDO::FETCH_ASSOC);

        $all = array_merge($symFiles, $refFiles);
        if (!$all) { echo "Not found in graph: $name\n"; exit(0); }
        foreach ($all as $r)
            printf("%-8s %-14s %s:%d\n", $r['kind'], $r['type'], $r['path'], $r['line']);
        echo "\n(" . count($all) . " entries)\n";
        exit(0);
    }

    echo "Unknown subaction: $subAction\n";
    echo "Subactions: usages, methods, callers, deps, chain, files\n";
    exit(1);
}


// --- остальные actions: поиск по всему проекту ---
$dirs = [
    $rootDir . 'classes',
    $rootDir . 'cron',
    $rootDir . 'react/source',
    $rootDir . 'templates',
];
$extensions = ['php', 'js', 'tpl', 'scss', 'css'];

if ($action === 'usages')          $patterns = ["/{$term}\s*\(/", "/::{$term}\b/", "/\b{$term}\b/"];
elseif ($action === 'class')       $patterns = ["/class\s+{$term}\b/", "/new\s+{$term}\b/", "/use\s+[\\\\a-zA-Z\\\\]*{$term}\b/"];
elseif ($action === 'extends')     $patterns = ["/extends\s+{$term}\b/"];
elseif ($action === 'implements')  $patterns = ["/implements\s+[a-zA-Z,\s]*{$term}\b/"];
elseif ($action === 'import')      $patterns = ["/import\s+.*{$term}/", "/require\s*\(.*{$term}/"];
else                               $patterns = ["/".preg_quote($term, '/')."/"];

$results = [];
foreach ($dirs as $dir) {
    if (!is_dir($dir)) continue;
    $iter = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir));
    foreach ($iter as $file) {
        if (!in_array($file->getExtension(), $extensions)) continue;
        $lines   = file($file->getPathname());
        $relPath = str_replace(realpath($rootDir) . DIRECTORY_SEPARATOR, '', $file->getPathname());
        $relPath = str_replace('\\', '/', $relPath);
        foreach ($lines as $i => $line) {
            foreach ($patterns as $pattern) {
                if (preg_match($pattern, $line)) {
                    $results[] = sprintf("%s:%d: %s", $relPath, $i + 1, trim($line));
                    break;
                }
            }
        }
    }
}

$results = array_unique($results);
if (!$results) {
    echo "Not found: $term\n";
} else {
    echo implode("\n", $results) . "\n";
    echo "\n(" . count($results) . " matches)\n";
}
