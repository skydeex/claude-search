<?php

// Парсер Go-файлов для buildGraph.php
// Использует insertSymbol() и insertRef() из buildGraph.php

function parseGo(PDO $db, int $fileId, string $content, string $relPath): void {
    $lines = explode("\n", $content);

    $currentType   = '';  // текущий struct/interface (receiver type)
    $currentMethod = '';  // текущий метод или функция

    foreach ($lines as $i => $raw) {
        $line    = trim($raw);
        $lineNum = $i + 1;

        // import одиночный: import "pkg/name"
        if (preg_match('/^import\s+"([\w.\-\/]+)"/', $line, $m)) {
            $parts = explode('/', $m[1]);
            insertRef($db, $fileId, $relPath, end($parts), 'import', $lineNum);
            continue;
        }

        // import в блоке: \t"pkg/name" или \t alias "pkg/name"
        if (preg_match('/^\s*(?:\w+\s+)?"([\w.\-\/]+)"/', $line, $m) && strpos($line, 'import') === false) {
            $parts = explode('/', $m[1]);
            insertRef($db, $fileId, $relPath, end($parts), 'import', $lineNum);
        }

        // type X struct
        if (preg_match('/^type\s+(\w+)\s+struct\b/', $line, $m)) {
            $currentType   = $m[1];
            $currentMethod = '';
            insertSymbol($db, $fileId, 'class', $currentType, $currentType, $lineNum, 'public');
            continue;
        }

        // type X interface
        if (preg_match('/^type\s+(\w+)\s+interface\b/', $line, $m)) {
            $currentType   = $m[1];
            $currentMethod = '';
            insertSymbol($db, $fileId, 'class', $currentType, $currentType, $lineNum, 'public');
            continue;
        }

        // метод с receiver: func (r *ReceiverType) MethodName(
        if (preg_match('/^func\s+\(\w+\s+\*?(\w+)\)\s+(\w+)\s*\(/', $line, $m)) {
            $currentType   = $m[1];
            $currentMethod = $m[2];
            $fullName      = "{$currentType}::{$currentMethod}";
            insertSymbol($db, $fileId, 'method', $currentMethod, $fullName, $lineNum, 'public');
            continue;
        }

        // top-level функция: func FunctionName(
        if (preg_match('/^func\s+(\w+)\s*[\(\[]/', $line, $m)) {
            $currentType   = '';
            $currentMethod = $m[1];
            insertSymbol($db, $fileId, 'function', $currentMethod, $currentMethod, $lineNum, 'public');
            continue;
        }

        $context = $currentType
            ? ($currentMethod ? "{$currentType}::{$currentMethod}" : $currentType)
            : ($currentMethod ?: $relPath);

        // instantiation: &TypeName{ или TypeName{
        if (preg_match_all('/&?([A-Z]\w+)\s*\{/', $line, $mm)) {
            foreach ($mm[1] as $cls)
                insertRef($db, $fileId, $context, $cls, 'instantiate', $lineNum);
        }

        // вызовы через точку: obj.Method(
        if (preg_match_all('/\.(\w+)\s*\(/', $line, $mm)) {
            foreach ($mm[1] as $method)
                insertRef($db, $fileId, $context, $method, 'call', $lineNum);
        }

        // вызовы top-level функций и пакетных вызовов: pkg.Func( уже покрыт выше,
        // дополнительно: FuncName( (строчные, чтобы не дублировать типы)
        if (preg_match_all('/\b([a-z]\w*)\s*\(/', $line, $mm)) {
            $goKeywords = ['if','for','switch','select','case','return','defer','go','func',
                           'range','make','new','append','len','cap','close','delete','copy',
                           'panic','recover','print','println','var','type','map','chan'];
            foreach ($mm[1] as $fn) {
                if (!in_array($fn, $goKeywords))
                    insertRef($db, $fileId, $context, $fn, 'call', $lineNum);
            }
        }
    }
}
