<?php

// Провайдеры эмбеддингов для семантического поиска (action: similar)
//
// Настройка в config.php:
//   define('CS_EMBED_PROVIDER', 'voyage');          // 'voyage' | 'openai' | 'ollama'
//   define('CS_EMBED_KEY',      'your-key-here');   // для voyage и openai
//   define('CS_OLLAMA_URL',     'http://localhost:11434'); // для ollama (опционально)
//   define('CS_OLLAMA_MODEL',   'nomic-embed-text');       // для ollama (опционально)

function isEmbedEnabled(): bool {
    if (!defined('CS_EMBED_PROVIDER')) return false;
    if (CS_EMBED_PROVIDER === 'ollama') return true;
    return defined('CS_EMBED_KEY') && CS_EMBED_KEY !== '';
}

function getEmbedding(string $text): ?array {
    switch (CS_EMBED_PROVIDER) {
        case 'voyage': return _embedVoyage($text);
        case 'openai': return _embedOpenAI($text);
        case 'ollama': return _embedOllama($text);
        default:
            echo "Unknown CS_EMBED_PROVIDER: " . CS_EMBED_PROVIDER . "\n";
            return null;
    }
}

function cosineSimilarity(array $a, array $b): float {
    $dot = 0.0; $normA = 0.0; $normB = 0.0;
    $n = min(count($a), count($b));
    for ($i = 0; $i < $n; $i++) {
        $dot   += $a[$i] * $b[$i];
        $normA += $a[$i] * $a[$i];
        $normB += $b[$i] * $b[$i];
    }
    if ($normA === 0.0 || $normB === 0.0) return 0.0;
    return $dot / (sqrt($normA) * sqrt($normB));
}


// ---- Провайдеры ----

function _embedVoyage(string $text): ?array {
    $result = _httpPost('https://api.voyageai.com/v1/embeddings', [
        'Authorization: Bearer ' . CS_EMBED_KEY,
        'Content-Type: application/json',
    ], [
        'input' => [$text],
        'model' => 'voyage-code-3',
    ]);
    return $result['data'][0]['embedding'] ?? null;
}

function _embedOpenAI(string $text): ?array {
    $result = _httpPost('https://api.openai.com/v1/embeddings', [
        'Authorization: Bearer ' . CS_EMBED_KEY,
        'Content-Type: application/json',
    ], [
        'input' => $text,
        'model' => 'text-embedding-3-small',
    ]);
    return $result['data'][0]['embedding'] ?? null;
}

function _embedOllama(string $text): ?array {
    $url   = (defined('CS_OLLAMA_URL')   ? CS_OLLAMA_URL   : 'http://localhost:11434') . '/api/embeddings';
    $model =  defined('CS_OLLAMA_MODEL') ? CS_OLLAMA_MODEL : 'nomic-embed-text';
    $result = _httpPost($url, ['Content-Type: application/json'], [
        'model'  => $model,
        'prompt' => $text,
    ]);
    return $result['embedding'] ?? null;
}

function _httpPost(string $url, array $headers, array $data): ?array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($data),
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 30,
    ]);
    $body = curl_exec($ch);
    if (curl_errno($ch)) {
        echo "Embed request failed: " . curl_error($ch) . "\n";
        curl_close($ch);
        return null;
    }
    curl_close($ch);
    return $body ? json_decode($body, true) : null;
}
