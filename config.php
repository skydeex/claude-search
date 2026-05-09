<?php

// ---- Настройки проекта ----
// Изменить при переносе на другой проект

$rootDir = realpath(__DIR__ . '/../') . DIRECTORY_SEPARATOR;

// MySQL (для actions: schema, db)
define('CS_DB_HOST',   'localhost');
define('CS_DB_NAME',   'db_name');
define('CS_DB_USER',   'claude_ro');
define('CS_DB_PASS',   '1');

// SQLite-граф
$dbPath = __DIR__ . DIRECTORY_SEPARATOR . 'code_graph.sqlite';

// Директории для сканирования графа (buildGraph.php)
// Формат: 'парсер' => [список папок]
// Ключ = имя парсера (php|js|go|astro). По умолчанию парсер обрабатывает файлы
// с расширением = ключу. Для нескольких расширений — см. $scanExts ниже.
$scanDirs = [
    'php' => [
        $rootDir . 'classes',
        $rootDir . 'cron',
    ],
    'js' => [
        $rootDir . 'react/source',
    ],
    'go' => [
        $rootDir,               // корень проекта + internal/ рекурсивно (только *.go)
    ],
];

// Расширения файлов для каждого парсера (опционально).
// Если ключ не указан — используется сам ключ как расширение (обратная совместимость).
// Пример для TypeScript/Astro проекта:
// $scanExts = [
//     'js'    => ['ts', 'tsx', 'js', 'jsx'],
//     'astro' => ['astro'],
// ];
$scanExts = [];

// Директории для поиска SQL-запросов (action: sql)
$sqlDirs = [
    $rootDir . 'classes/model',
    $rootDir . 'classes/service',
    $rootDir . 'cron',
    $rootDir . 'internal',
];

// Директории для поискового индекса (actions: usages, class, raw, ...)
$searchDirs = [
    $rootDir . 'classes',
    $rootDir . 'cron',
    $rootDir . 'react/source',
    $rootDir . 'templates',
    $rootDir . 'internal',
    $rootDir,
];

// Расширения файлов для поиска
$extensions = ['php', 'js', 'jsx', 'tpl', 'scss', 'css', 'go'];

// Файл роутера (action: route)
$routeFile = $rootDir . 'classes/router/GetRoute.php';

// ---- Embeddings (опционально) ----
// Если не настроено — action 'similar' и индексация эмбеддингов отключены.
// Провайдеры: 'voyage' | 'openai' | 'ollama'
//
// define('CS_EMBED_PROVIDER', 'voyage');
// define('CS_EMBED_KEY',      'your-key-here');
//
// Для ollama (локально, без ключа):
// define('CS_EMBED_PROVIDER', 'ollama');
// define('CS_OLLAMA_URL',     'http://localhost:11434');  // опционально
// define('CS_OLLAMA_MODEL',   'nomic-embed-text');        // опционально
