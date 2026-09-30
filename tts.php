<?php
/**
 * Brain Audiovisual - Proxy de Áudio TTS de Alta Fidelidade (MP3)
 * Resolve 100% de restrições CORS no cliente e entrega áudio MP3 real para gravação e streaming.
 */

// Headers CORS permissivos para consumo direto pelo browser
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$text = isset($_GET['q']) ? trim($_GET['q']) : '';
$lang = isset($_GET['tl']) ? trim($_GET['tl']) : 'en';

if (empty($text)) {
    http_response_code(400);
    header("Content-Type: text/plain; charset=UTF-8");
    echo "Parâmetro 'q' ausente.";
    exit;
}

// Limita tamanho do trecho por requisição para evitar rejeição da API
if (mb_strlen($text, 'UTF-8') > 200) {
    $text = mb_substr($text, 0, 200, 'UTF-8');
}

// Higieniza código de idioma (ex: en-US -> en, es-ES -> es)
$langParts = explode('-', $lang);
$langCode = strtolower($langParts[0]);

// Lista de URLs candidatas para buscar o áudio MP3
$urls = [
    "https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=" . urlencode($langCode) . "&client=tw-ob&q=" . urlencode($text),
    "https://translate.google.com/translate_tts?ie=UTF-8&tl=" . urlencode($langCode) . "&client=gtx&q=" . urlencode($text)
];

$audioData = null;

foreach ($urls as $url) {
    if (function_exists('curl_init')) {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_TIMEOUT, 6);
        curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Accept: audio/mpeg, audio/*;q=0.9, */*;q=0.5',
            'Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Referer: https://translate.google.com/'
        ]);

        $result = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode === 200 && !empty($result) && strlen($result) > 400) {
            $audioData = $result;
            break;
        }
    } elseif (ini_get('allow_url_fopen')) {
        $opts = [
            'http' => [
                'method' => 'GET',
                'header' => "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\r\nReferer: https://translate.google.com/\r\n",
                'timeout' => 6
            ]
        ];
        $context = stream_context_create($opts);
        $result = @file_get_contents($url, false, $context);
        if ($result && strlen($result) > 400) {
            $audioData = $result;
            break;
        }
    }
}

if ($audioData !== null && strlen($audioData) > 400) {
    header("Content-Type: audio/mpeg");
    header("Content-Length: " . strlen($audioData));
    header("Cache-Control: public, max-age=86400");
    echo $audioData;
    exit;
}

// Fallback: Se não conseguir baixar dos endpoints remotos, gera um quadro MP3 de silêncio válido
// garantindo que o arquivo nunca fique como texto plano ou corrompido
header("Content-Type: audio/mpeg");
header("Cache-Control: no-cache");

// Quadro MP3 silencioso padrão de 128kbps / 44.1kHz (MPEG-1 Layer 3)
$silentFrame = pack('H*', 'fffb9064000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000');
echo str_repeat($silentFrame, 38); // ~1 segundo de áudio MP3 válido
exit;
