<?php

// Парсер PHP-файлов для buildGraph.php
// Использует insertSymbol() и insertRef() из buildGraph.php

function parsePhp(PDO $db, int $fileId, string $content, string $relPath): void {
    $lines = explode("\n", $content);

    $currentClass  = '';
    $currentMethod = '';
    $namespace     = '';

    foreach ($lines as $i => $raw) {
        $line = trim($raw);
        $lineNum = $i + 1;

        // namespace
        if (preg_match('/^namespace\s+([\w\\\\]+)/', $line, $m))
            $namespace = $m[1];

        // class definition
        if (preg_match('/^(?:abstract\s+|final\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/', $line, $m)) {
            $currentClass  = $m[1];
            $currentMethod = '';
            insertSymbol($db, $fileId, 'class', $currentClass, $currentClass, $lineNum);

            if (!empty($m[2]))
                insertRef($db, $fileId, $currentClass, trim($m[2]), 'extends', $lineNum);

            if (!empty($m[3])) {
                foreach (array_map('trim', explode(',', $m[3])) as $iface)
                    insertRef($db, $fileId, $currentClass, $iface, 'implements', $lineNum);
            }
        }

        // interface definition
        if (preg_match('/^interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?/', $line, $m)) {
            $currentClass = $m[1];
            insertSymbol($db, $fileId, 'class', $currentClass, $currentClass, $lineNum);
            if (!empty($m[2])) {
                foreach (array_map('trim', explode(',', $m[2])) as $parent)
                    insertRef($db, $fileId, $currentClass, $parent, 'extends', $lineNum);
            }
        }

        // method definition
        if (preg_match('/^(public|protected|private)?\s*(static\s+)?function\s+(\w+)\s*\(/', $line, $m)) {
            $visibility    = $m[1] ?: 'public';
            $isStatic      = !empty($m[2]) ? 1 : 0;
            $currentMethod = $m[3];
            $fullName      = $currentClass ? "{$currentClass}::{$currentMethod}" : $currentMethod;
            insertSymbol($db, $fileId, 'method', $currentMethod, $fullName, $lineNum, $visibility, $isStatic);
        }

        $context = $currentClass ? ($currentMethod ? "{$currentClass}::{$currentMethod}" : $currentClass) : $relPath;

        // new ClassName
        if (preg_match_all('/new\s+([A-Z]\w+)\s*[(\[]/', $line, $mm)) {
            foreach ($mm[1] as $cls)
                insertRef($db, $fileId, $context, $cls, 'instantiate', $lineNum);
        }

        // ClassName::method (статический вызов)
        if (preg_match_all('/([A-Z]\w+)::(\w+)/', $line, $mm)) {
            foreach ($mm[1] as $j => $cls) {
                if ($cls === 'self' || $cls === 'parent' || $cls === 'static') continue;
                insertRef($db, $fileId, $context, "{$cls}::{$mm[2][$j]}", 'static_call', $lineNum);
            }
        }

        // $this->method( или ->method(
        if (preg_match_all('/->(\w+)\s*\(/', $line, $mm)) {
            foreach ($mm[1] as $method)
                insertRef($db, $fileId, $context, $method, 'call', $lineNum);
        }

        // use ClassName (import)
        if (preg_match('/^use\s+([\w\\\\]+)/', $line, $m)) {
            $parts = explode('\\', $m[1]);
            insertRef($db, $fileId, $relPath, end($parts), 'import', $lineNum);
        }
    }
}
