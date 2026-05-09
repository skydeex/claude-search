<?php

// Парсер .astro файлов для buildGraph.php
// Frontmatter (между первой и второй ---) содержит TypeScript — парсится через parseJs().
// Шаблонная секция тоже передаётся в parseJs: <Component> рефы подхватываются автоматически.

function parseAstro(PDO $db, int $fileId, string $content, string $relPath): void {
    $lines   = explode("\n", $content);
    $fmCount = 0;

    // Заменяем --- разделители пустыми строками, чтобы сохранить номера строк,
    // затем парсим весь файл как JS/TS
    foreach ($lines as $i => $line) {
        if (trim($line) === '---') {
            $lines[$i] = '';
            if (++$fmCount >= 2) break;
        }
    }

    parseJs($db, $fileId, implode("\n", $lines), $relPath);
}
