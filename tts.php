<?php
/**
 * Brain Audiovisual - Proxy de Áudio TTS Multilíngue de Alta Fidelidade (MP3)
 * Suporte a Vozes Nativas Masculinas (Arthur / Polly) e Femininas (Sofia / Polly)
 * Resolve restrições CORS no cliente e entrega áudio MP3 nativo real para gravação e streaming.
 */

// Headers CORS permissivos para consumo direto pelo browser
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$text = isset($_GET['q']) ? trim($_GET['q']) : (isset($_POST['q']) ? trim($_POST['q']) : '');
$lang = isset($_GET['tl']) ? trim($_GET['tl']) : (isset($_POST['tl']) ? trim($_POST['tl']) : 'en');
$gender = isset($_GET['gender']) ? strtolower(trim($_GET['gender'])) : (isset($_GET['voice']) ? strtolower(trim($_GET['voice'])) : 'female');

if (empty($text)) {
    http_response_code(400);
    header("Content-Type: text/plain; charset=UTF-8");
    echo "Parâmetro 'q' ausente.";
    exit;
}

// Limita tamanho do trecho por requisição para garantir síntese rápida e fluida
if (mb_strlen($text, 'UTF-8') > 300) {
    $text = mb_substr($text, 0, 300, 'UTF-8');
}

// Higieniza código de idioma (ex: en-US -> en, es-ES -> es, pt-BR -> pt)
$langParts = explode('-', $lang);
$langCode = strtolower($langParts[0]);

// Mapeamento de vozes nativas de estúdio (Amazon Polly Neural/Standard) por idioma e gênero
$speakers = [
    'en' => ['male' => 'Matthew', 'female' => 'Joanna'],
    'es' => ['male' => 'Enrique', 'female' => 'Conchita'],
    'pt' => ['male' => 'Ricardo', 'female' => 'Camila'],
    'fr' => ['male' => 'Mathieu', 'female' => 'Celine'],
    'de' => ['male' => 'Hans', 'female' => 'Marlene'],
    'it' => ['male' => 'Giorgio', 'female' => 'Carla'],
    'ja' => ['male' => 'Takumi', 'female' => 'Mizuki']
];

$chosenSpeaker = isset($speakers[$langCode][$gender]) ? $speakers[$langCode][$gender] : ($gender === 'male' ? 'Matthew' : 'Joanna');

$audioData = null;

// ESTRATÉGIA 1: Síntese com Voz Nativa Direta via TTSMP3 (Amazon Polly nativa)
if (function_exists('curl_init')) {
    $postFields = http_build_query([
        'msg' => $text,
        'lang' => $chosenSpeaker,
        'source' => 'ttsmp3'
    ]);

    $ch = curl_init('https://ttsmp3.com/makemp3_new.php');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $postFields);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_TIMEOUT, 6);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/x-www-form-urlencoded',
        'Referer: https://ttsmp3.com/'
    ]);

    $jsonResp = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200 && !empty($jsonResp)) {
        $parsed = json_decode($jsonResp, true);
        if ($parsed && isset($parsed['Error']) && $parsed['Error'] === 0 && !empty($parsed['URL'])) {
            $mp3Url = $parsed['URL'];
            // Baixa o binário do MP3 gerado
            $chAudio = curl_init($mp3Url);
            curl_setopt($chAudio, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($chAudio, CURLOPT_FOLLOWLOCATION, true);
            curl_setopt($chAudio, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($chAudio, CURLOPT_TIMEOUT, 6);
            curl_setopt($chAudio, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            $downloadedAudio = curl_exec($chAudio);
            $audioCode = curl_getinfo($chAudio, CURLINFO_HTTP_CODE);
            curl_close($chAudio);

            if ($audioCode === 200 && !empty($downloadedAudio) && strlen($downloadedAudio) > 400) {
                $audioData = $downloadedAudio;
            }
        }
    }
}

// ESTRATÉGIA 2 (FALLBACK): Google Translate TTS caso o Polly falhe
if ($audioData === null) {
    $fallbackUrls = [
        "https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=" . urlencode($langCode) . "&client=tw-ob&q=" . urlencode($text),
        "https://translate.google.com/translate_tts?ie=UTF-8&tl=" . urlencode($langCode) . "&client=gtx&q=" . urlencode($text)
    ];

    foreach ($fallbackUrls as $url) {
        if (function_exists('curl_init')) {
            $ch = curl_init();
            curl_setopt($ch, CURLOPT_URL, $url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_TIMEOUT, 5);
            curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                'Accept: audio/mpeg, audio/*;q=0.9, */*;q=0.5',
                'Referer: https://translate.google.com/'
            ]);
            $res = curl_exec($ch);
            $c = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($c === 200 && !empty($res) && strlen($res) > 400) {
                $audioData = $res;
                break;
            }
        } elseif (ini_get('allow_url_fopen')) {
            $opts = [
                'http' => [
                    'method' => 'GET',
                    'header' => "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\r\nReferer: https://translate.google.com/\r\n",
                    'timeout' => 5
                ]
            ];
            $context = stream_context_create($opts);
            $res = @file_get_contents($url, false, $context);
            if ($res && strlen($res) > 400) {
                $audioData = $res;
                break;
            }
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

// ESTRATÉGIA 3 (FALLBACK SEGURO): Quadro MP3 silencioso padrão de 128kbps / 44.1kHz (MPEG-1 Layer 3)
header("Content-Type: audio/mpeg");
header("Cache-Control: no-cache");
$silentFrame = pack('H*', 'fffb9064000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000');
echo str_repeat($silentFrame, 38); // ~1 segundo de MP3 silencioso válido
exit;
