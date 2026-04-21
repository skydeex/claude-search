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
// Формат: 'язык' => [список папок]
$scanDirs = [
    'php' => [
        $rootDir . 'classes',
        $rootDir . 'cron',
    ],
    'js' => [
        $rootDir . 'react/source',
    ],
];

// Директории для поиска SQL-запросов (action: sql)
$sqlDirs = [
    $rootDir . 'classes/model',
    $rootDir . 'classes/service',
    $rootDir . 'cron',
];

// Директории для поискового индекса (actions: usages, class, raw, ...)
$searchDirs = [
    $rootDir . 'classes',
    $rootDir . 'cron',
    $rootDir . 'react/source',
    $rootDir . 'templates',
];

// Расширения файлов для поиска
$extensions = ['php', 'js', 'jsx', 'tpl', 'scss', 'css'];

// Файл роутера (action: route)
$routeFile = $rootDir . 'classes/router/GetRoute.php';
