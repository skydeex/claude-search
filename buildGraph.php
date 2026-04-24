<?php

// Строит граф кодовой базы в SQLite
// Запуск: php buildGraph.php [--full]
// --full  — полная перестройка (игнорирует mtime)
//
// SQLite: code_graph.sqlite
// Парсеры: parsers/php.php, parsers/js.php

require_once __DIR__ . '/config.php';
$isFull  = in_array('--full', $argv);

// ---- Парсеры ----
// Чтобы добавить новый язык:
//   1. Создать parsers/go.php с функцией parseGo()
//   2. Добавить строку в $parsers и директории в $scanDirs в config.php

require_once __DIR__ . '/parsers/php.php';
require_once __DIR__ . '/parsers/js.php';
require_once __DIR__ . '/parsers/go.php';

$parsers = [
    'php' => 'parsePhp',
    'js'  => 'parseJs',
    'go'  => 'parseGo',
];


// ---- БД ----

$db = new PDO('sqlite:' . $dbPath);
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec('PRAGMA journal_mode=WAL');
$db->exec('PRAGMA synchronous=NORMAL');

$db->exec('
    CREATE TABLE IF NOT EXISTS files (
        id    INTEGER PRIMARY KEY,
        path  TEXT UNIQUE,
        mtime INTEGER,
        lang  TEXT
    );
    CREATE TABLE IF NOT EXISTS symbols (
        id         INTEGER PRIMARY KEY,
        file_id    INTEGER,
        type       TEXT,       -- class|method|function|property|component
        name       TEXT,       -- короткое имя
        full_name  TEXT,       -- ClassName::methodName
        line       INTEGER,
        visibility TEXT,       -- public|protected|private
        is_static  INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS refs (
        id             INTEGER PRIMARY KEY,
        file_id        INTEGER,
        from_full_name TEXT,   -- откуда (ClassName::methodName или file)
        to_name        TEXT,   -- что вызывается/импортируется
        ref_type       TEXT,   -- call|static_call|instantiate|extends|implements|import|jsx
        line           INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sym_name      ON symbols(name);
    CREATE INDEX IF NOT EXISTS idx_sym_full      ON symbols(full_name);
    CREATE INDEX IF NOT EXISTS idx_sym_file      ON symbols(file_id);
    CREATE INDEX IF NOT EXISTS idx_ref_to        ON refs(to_name);
    CREATE INDEX IF NOT EXISTS idx_ref_from      ON refs(from_full_name);
    CREATE INDEX IF NOT EXISTS idx_ref_file      ON refs(file_id);
');


// ---- Helpers (используются парсерами) ----

function relPath(string $path, string $rootDir): string {
    $real = realpath($rootDir) ?: $rootDir;
    $path = str_replace('\\', '/', $path);
    $real = str_replace('\\', '/', $real);
    return ltrim(str_replace($real, '', $path), '/');
}

function deleteFile(PDO $db, int $fileId): void {
    $db->exec("DELETE FROM symbols WHERE file_id = $fileId");
    $db->exec("DELETE FROM refs    WHERE file_id = $fileId");
}

function getOrCreateFile(PDO $db, string $relPath, int $mtime, string $lang): array {
    $row = $db->query("SELECT id, mtime FROM files WHERE path = " . $db->quote($relPath))->fetch(PDO::FETCH_ASSOC);
    if ($row) {
        return ['id' => (int)$row['id'], 'changed' => (int)$row['mtime'] !== $mtime];
    }
    $db->exec("INSERT INTO files (path, mtime, lang) VALUES ({$db->quote($relPath)}, $mtime, {$db->quote($lang)})");
    return ['id' => (int)$db->lastInsertId(), 'changed' => true];
}

function updateFileMtime(PDO $db, int $fileId, int $mtime): void {
    $db->exec("UPDATE files SET mtime = $mtime WHERE id = $fileId");
}

function insertSymbol(PDO $db, int $fileId, string $type, string $name, string $fullName, int $line, string $visibility = '', int $isStatic = 0): void {
    $db->exec("INSERT INTO symbols (file_id, type, name, full_name, line, visibility, is_static)
               VALUES ($fileId, {$db->quote($type)}, {$db->quote($name)}, {$db->quote($fullName)}, $line, {$db->quote($visibility)}, $isStatic)");
}

function insertRef(PDO $db, int $fileId, string $fromFull, string $toName, string $refType, int $line): void {
    if (!$toName) return;
    $db->exec("INSERT INTO refs (file_id, from_full_name, to_name, ref_type, line)
               VALUES ($fileId, {$db->quote($fromFull)}, {$db->quote($toName)}, {$db->quote($refType)}, $line)");
}


// ---- Сканирование файлов ----

$total = 0; $updated = 0; $skipped = 0;

foreach ($scanDirs as $lang => $dirs) {
    $parseFn = $parsers[$lang] ?? null;
    if (!$parseFn) continue;

    foreach ($dirs as $dir) {
        if (!is_dir($dir)) continue;
        $iter = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir));

        foreach ($iter as $file) {
            if ($file->getExtension() !== $lang) continue;

            $absPath = realpath($file->getPathname()) ?: $file->getPathname();
            $rel     = relPath($absPath, $rootDir);
            $mtime   = (int)$file->getMTime();
            $total++;

            $info   = getOrCreateFile($db, $rel, $mtime, $lang);
            $fileId = $info['id'];

            if (!$isFull && !$info['changed']) {
                $skipped++;
                continue;
            }

            $db->beginTransaction();
            deleteFile($db, $fileId);
            $parseFn($db, $fileId, file_get_contents($absPath), $rel);
            updateFileMtime($db, $fileId, $mtime);
            $db->commit();

            $updated++;
            echo "  parsed: $rel\n";
        }
    }
}

echo "\nDone. Total: $total, updated: $updated, skipped: $skipped\n";
echo "Graph: $dbPath\n";
