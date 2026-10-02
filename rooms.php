<?php
/**
 * Brain Audiovisual - Sincronização Global de Salas em Tempo Real (Rooms API)
 * Permite que sessões abertas em qualquer cidade do mundo sejam descobertas,
 * monitoradas e acessadas remotamente a partir de qualquer navegador.
 */

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Content-Type: application/json; charset=UTF-8");

if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$storageFile = __DIR__ . '/rooms_state.json';

function getStoredRooms($file) {
    if (!file_exists($file)) {
        return [];
    }
    $raw = @file_get_contents($file);
    if (!$raw) return [];
    $data = @json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function saveStoredRooms($file, $rooms) {
    $fp = @fopen($file, 'c+');
    if ($fp) {
        if (@flock($fp, LOCK_EX)) {
            @ftruncate($fp, 0);
            @fwrite($fp, json_encode(array_values($rooms), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            @fflush($fp);
            @flock($fp, LOCK_UN);
        }
        @fclose($fp);
    }
}

function getClientIp() {
    $keys = ['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'HTTP_CLIENT_IP', 'REMOTE_ADDR'];
    foreach ($keys as $k) {
        if (!empty($_SERVER[$k])) {
            $parts = explode(',', $_SERVER[$k]);
            $ip = trim($parts[0]);
            if (filter_var($ip, FILTER_VALIDATE_IP)) {
                return $ip;
            }
        }
    }
    return '127.0.0.1';
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// -------------------------------------------------------------
// GET: Retorna todas as salas ativas (com limpeza de inativas > 60s)
// -------------------------------------------------------------
if ($method === 'GET') {
    $rooms = getStoredRooms($storageFile);
    $nowMs = round(microtime(true) * 1000);
    $activeRooms = [];
    $changed = false;

    foreach ($rooms as $r) {
        if (!isset($r['id'])) continue;
        $lastSeen = isset($r['lastSeen']) ? (float)$r['lastSeen'] : 0;
        if ($lastSeen < 10000000000) {
            $lastSeen *= 1000;
        }
        
        // Se a sala não enviou heartbeat nos últimos 60 segundos, considera inativa
        if (($nowMs - $lastSeen) > 60000 || (isset($r['status']) && in_array($r['status'], ['archived', 'closed', 'deleted']))) {
            $changed = true;
            continue;
        }
        $r['lastSeen'] = $lastSeen;
        $activeRooms[] = $r;
    }

    if ($changed) {
        saveStoredRooms($storageFile, $activeRooms);
    }

    echo json_encode([
        'success' => true,
        'count' => count($activeRooms),
        'rooms' => $activeRooms,
        'serverTime' => $nowMs
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// -------------------------------------------------------------
// POST: Registra ou renova heartbeat de uma sala com localização
// -------------------------------------------------------------
if ($method === 'POST') {
    $body = @file_get_contents('php://input');
    $data = @json_decode($body, true);

    if (!$data || empty($data['id'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Identificador da sala (id) é obrigatório']);
        exit;
    }

    $roomId = preg_replace('/[^a-zA-Z0-9_-]/', '', $data['id']);
    if (empty($roomId)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'ID de sala inválido']);
        exit;
    }

    $action = $data['action'] ?? 'heartbeat';
    $rooms = getStoredRooms($storageFile);
    $now = time();

    // Se a ação for arquivar ou excluir
    if ($action === 'archive' || $action === 'delete') {
        $rooms = array_filter($rooms, function($r) use ($roomId) {
            return ($r['id'] ?? '') !== $roomId;
        });
        saveStoredRooms($storageFile, $rooms);
        echo json_encode(['success' => true, 'action' => $action, 'id' => $roomId]);
        exit;
    }

    // Localização geográfica do cliente
    $location = $data['location'] ?? [];
    if (empty($location['city']) && empty($location['country'])) {
        // Fallback básico para localização
        $location = [
            'city' => 'Local Remoto',
            'region' => '',
            'country' => 'Global',
            'ip' => getClientIp()
        ];
    } else {
        $location['ip'] = getClientIp();
    }

    $roomData = [
        'id' => $roomId,
        'title' => !empty($data['title']) ? trim(strip_tags($data['title'])) : ('Sessão de Tradução ' . $roomId),
        'sourceLanguage' => !empty($data['sourceLanguage']) ? $data['sourceLanguage'] : 'pt-BR',
        'targetLanguages' => !empty($data['targetLanguages']) && is_array($data['targetLanguages']) ? $data['targetLanguages'] : ['en-US', 'es-ES'],
        'autoDetectLanguage' => !empty($data['autoDetectLanguage']),
        'createdAt' => !empty($data['createdAt']) ? $data['createdAt'] : date('c'),
        'startTime' => !empty($data['startTime']) ? (int)$data['startTime'] : (time() * 1000),
        'elapsedSeconds' => isset($data['elapsedSeconds']) ? (int)$data['elapsedSeconds'] : 0,
        'isLive' => !empty($data['isLive']),
        'isMicActive' => !empty($data['isMicActive']),
        'audienceCount' => isset($data['audienceCount']) ? (int)$data['audienceCount'] : 0,
        'location' => $location,
        'status' => 'active',
        'lastSeen' => round(microtime(true) * 1000)
    ];

    $found = false;
    foreach ($rooms as &$r) {
        if (($r['id'] ?? '') === $roomId) {
            $r = array_merge($r, $roomData);
            $found = true;
            break;
        }
    }
    unset($r);

    if (!$found) {
        $rooms[] = $roomData;
    }

    saveStoredRooms($storageFile, $rooms);

    echo json_encode([
        'success' => true,
        'room' => $roomData,
        'serverTime' => round(microtime(true) * 1000)
    ], JSON_UNESCAPED_UNICODE);
    exit;
}
