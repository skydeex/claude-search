<?php

// Парсер JS/JSX-файлов для buildGraph.php
// Использует insertSymbol() и insertRef() из buildGraph.php

function parseJs(PDO $db, int $fileId, string $content, string $relPath): void {
    $lines = explode("\n", $content);

    $currentClass  = '';
    $currentMethod = '';

    foreach ($lines as $i => $raw) {
        $line    = trim($raw);
        $lineNum = $i + 1;

        // import
        if (preg_match('/^import\s+(?:\{[^}]+\}|(\w+)|\*\s+as\s+\w+)(?:,\s*(?:\{[^}]+\}|(\w+)))?\s+from/', $line, $m)) {
            preg_match_all('/import\s+\{([^}]+)\}/', $line, $named);
            preg_match('/import\s+(\w+)/', $line, $def);

            if (!empty($named[1]))
                foreach (array_map('trim', explode(',', $named[1][0])) as $n)
                    insertRef($db, $fileId, $relPath, $n, 'import', $lineNum);

            if (!empty($def[1]) && $def[1] !== 'React')
                insertRef($db, $fileId, $relPath, $def[1], 'import', $lineNum);
        }

        // class definition
        if (preg_match('/(?:export\s+default\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/', $line, $m)) {
            $currentClass  = $m[1];
            $currentMethod = '';
            insertSymbol($db, $fileId, 'component', $currentClass, $currentClass, $lineNum);
            if (!empty($m[2]))
                insertRef($db, $fileId, $currentClass, $m[2], 'extends', $lineNum);
        }

        // function / method definition
        // async foo() { / foo() { / foo = () => / const foo = () =>
        if (preg_match('/(?:async\s+)?(?:function\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[=:]?\s*(?:async\s+)?(?:function\s*)?\(/', $line, $m)) {
            $jsKeywords = ['if','for','while','switch','catch','return','typeof','new','delete','void','throw','else','export','import','const','let','var','class'];
            $name = $m[1];
            if (!in_array($name, $jsKeywords) && preg_match('/^\s*(?:async\s+)?(?:(?:const|let|var)\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[=(]/', $raw, $mm)) {
                $currentMethod = $name;
                $fullName      = $currentClass ? "{$currentClass}::{$name}" : $name;
                insertSymbol($db, $fileId, 'function', $name, $fullName, $lineNum);
            }
        }

        $context = $currentClass ? ($currentMethod ? "{$currentClass}::{$currentMethod}" : $currentClass) : $relPath;

        // JSX компоненты <ComponentName
        if (preg_match_all('/<([A-Z][a-zA-Z0-9]*)[\s\/>]/', $line, $mm)) {
            foreach ($mm[1] as $comp)
                insertRef($db, $fileId, $context, $comp, 'jsx', $lineNum);
        }

        // вызовы функций/методов
        if (preg_match_all('/(?:this\.)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/', $line, $mm)) {
            $jsKeywords = ['if','for','while','switch','catch','function','class','return','typeof','new','delete','void','throw'];
            foreach ($mm[1] as $fn) {
                if (!in_array($fn, $jsKeywords))
                    insertRef($db, $fileId, $context, $fn, 'call', $lineNum);
            }
        }
    }
}
