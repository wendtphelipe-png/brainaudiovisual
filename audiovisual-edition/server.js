/**
 * Brain Audiovisual - AudioVisual Edition (Server)
 * Standalone Node.js Engine for YouTube/Vimeo/Local Video Dubbing & Subtitling
 * Zero npm dependency architecture - Native Node.js + System FFmpeg & yt-dlp
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec, execFile } = require('child_process');
const crypto = require('crypto');
const https = require('https');
const url = require('url');
const os = require('os');

let prevCpuTimes = os.cpus();

function getCpuUsagePercent() {
    const currentCpus = os.cpus();
    let idleDiff = 0;
    let totalDiff = 0;
    for (let i = 0; i < currentCpus.length; i++) {
        const prev = prevCpuTimes[i] ? prevCpuTimes[i].times : { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
        const curr = currentCpus[i].times;
        const prevTotal = Object.values(prev).reduce((a, b) => a + b, 0);
        const currTotal = Object.values(curr).reduce((a, b) => a + b, 0);
        idleDiff += (curr.idle - prev.idle);
        totalDiff += (currTotal - prevTotal);
    }
    prevCpuTimes = currentCpus;
    if (totalDiff <= 0) return 1;
    const usage = Math.round(100 - (100 * idleDiff / totalDiff));
    return Math.max(1, Math.min(100, usage));
}

function getGpuStats() {
    return new Promise((resolve) => {
        execFile('nvidia-smi', [
            '--query-gpu=name,utilization.gpu,utilization.memory,memory.used,memory.total',
            '--format=csv,noheader,nounits'
        ], { timeout: 1200 }, (err, stdout) => {
            if (err || !stdout) {
                return resolve(null);
            }
            try {
                const parts = stdout.trim().split(',').map(s => s.trim());
                if (parts.length >= 5) {
                    const name = parts[0];
                    const gpuUsage = parseInt(parts[1], 10) || 0;
                    const vramUsage = parseInt(parts[2], 10) || 0;
                    const memUsed = parseInt(parts[3], 10) || 0;
                    const memTotal = parseInt(parts[4], 10) || 0;
                    const memPct = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;
                    return resolve({
                        available: true,
                        name: name,
                        usagePercent: gpuUsage,
                        vramPercent: vramUsage,
                        memoryUsedMb: memUsed,
                        memoryTotalMb: memTotal,
                        memoryPercent: memPct
                    });
                }
            } catch (_) {}
            resolve(null);
        });
    });
}

const PORT = process.env.PORT || 3050;
const BASE_DIR = __dirname;
const PUBLIC_DIR = path.join(BASE_DIR, 'public');
const TEMP_DIR = path.join(BASE_DIR, 'temp');
const OUTPUT_DIR = path.join(BASE_DIR, 'output');

// Ensure necessary directories exist
[PUBLIC_DIR, TEMP_DIR, OUTPUT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Locate system binaries
const FFMPEG_BIN = fs.existsSync('C:\\Users\\pires\\AppData\\Local\\Programs\\Python\\Python314\\Scripts\\ffmpeg.exe')
    ? 'C:\\Users\\pires\\AppData\\Local\\Programs\\Python\\Python314\\Scripts\\ffmpeg.exe'
    : 'ffmpeg';

const YTDLP_BIN = fs.existsSync('C:\\Users\\pires\\AppData\\Local\\Programs\\Python\\Python314\\Scripts\\yt-dlp.exe')
    ? 'C:\\Users\\pires\\AppData\\Local\\Programs\\Python\\Python314\\Scripts\\yt-dlp.exe'
    : 'yt-dlp';

// In-memory job state store
const jobs = new Map();

/**
 * Log helper for a specific job
 */
function addJobLog(job, message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    const entry = { timestamp, message, type };
    job.logs.push(entry);
    console.log(`[Job ${job.id}] [${timestamp}] ${message}`);
    broadcastJobUpdate(job);
    if (job.onProgress) {
        try { job.onProgress(job.percent, job.step, job.statusText); } catch (_) {}
    }
}

function broadcastJobUpdate(job) {
    if (!job.clients) return;
    const data = JSON.stringify({
        id: job.id,
        step: job.step,
        percent: job.percent,
        statusText: job.statusText,
        logs: job.logs.slice(-15),
        completed: job.completed,
        error: job.error,
        title: job.title,
        duration: job.duration,
        tracks: job.tracks || {},
        zipUrl: job.zipUrl || null,
        subtitles: job.subtitles || {}
    });

    job.clients.forEach(res => {
        try {
            res.write(`event: progress\ndata: ${data}\n\n`);
        } catch (e) {
            // Client closed connection
        }
    });
}

// ==========================================
// PERSISTÊNCIA DA FILA & MULTIPROCESSAMENTO
// ==========================================
const QUEUE_STATE_FILE = path.join(TEMP_DIR, 'queue_state.json');
const DEFAULT_OUTPUT_DIR = 'D:\\downloads\\BrainAudiovisual_Saida';

// Garante existência da pasta de saída padrão
try {
    if (!fs.existsSync(DEFAULT_OUTPUT_DIR)) fs.mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
} catch (_) {}

let queueState = {
    concurrency: 2,
    outputDir: DEFAULT_OUTPUT_DIR,
    generateDubbedAudio: false, // Padrão solicitado: sem áudios dubbed e sem .srt para máxima velocidade
    sourceLanguage: 'pt-BR',
    voiceProfile: 'female_studio',
    targetLanguages: ['en', 'es'],
    isProcessing: false,
    items: []
};

const queueClients = new Set();

function broadcastQueueUpdate() {
    const payload = `data: ${JSON.stringify(queueState)}\n\n`;
    for (const client of queueClients) {
        try {
            client.write(payload);
        } catch (_) {
            queueClients.delete(client);
        }
    }
}

function loadQueueState() {
    try {
        if (fs.existsSync(QUEUE_STATE_FILE)) {
            const raw = fs.readFileSync(QUEUE_STATE_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (data && Array.isArray(data.items)) {
                queueState.concurrency = data.concurrency || 2;
                queueState.outputDir = data.outputDir || DEFAULT_OUTPUT_DIR;
                queueState.generateDubbedAudio = !!data.generateDubbedAudio;
                queueState.sourceLanguage = data.sourceLanguage || 'pt-BR';
                queueState.voiceProfile = data.voiceProfile || 'female_studio';
                queueState.targetLanguages = data.targetLanguages || ['en', 'es'];
                
                // Em caso de reinicialização ou perda de energia, restaura o estado:
                queueState.items = data.items.map(item => {
                    if (item.status === 'processing') {
                        return { ...item, status: 'queued', percent: 0, statusText: 'Pronto para retomar' };
                    }
                    return item;
                });
                console.log(`[Queue] Carregada fila persistente com ${queueState.items.length} itens do disco.`);
            }
        }
    } catch (e) {
        console.warn(`[Queue] Aviso ao ler estado persistente: ${e.message}`);
    }
}

function saveQueueState() {
    try {
        fs.writeFileSync(QUEUE_STATE_FILE, JSON.stringify(queueState, null, 2), 'utf8');
    } catch (e) {
        console.error(`[Queue] Erro ao salvar estado da fila: ${e.message}`);
    }
    broadcastQueueUpdate();
}

function sanitizeFilename(name) {
    if (!name) return 'video_' + Date.now();
    return name
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^[._]+|[._]+$/g, '')
        .substring(0, 100) || ('video_' + Date.now());
}

let activeQueueWorkers = 0;

async function processNextQueueItems() {
    if (!queueState.isProcessing) return;
    const maxConcurrency = Math.max(1, Math.min(4, queueState.concurrency || 2));

    while (activeQueueWorkers < maxConcurrency && queueState.isProcessing) {
        const nextItem = queueState.items.find(i => i.status === 'queued');
        if (!nextItem) break;

        nextItem.status = 'processing';
        nextItem.percent = 5;
        nextItem.statusText = 'Iniciando processamento na esteira...';
        nextItem.startedAt = Date.now();
        activeQueueWorkers++;
        saveQueueState();

        // Worker assíncrono paralelo
        (async (item) => {
            try {
                const job = {
                    id: item.id,
                    sourceType: item.sourceType || 'url',
                    url: item.url || '',
                    title: item.title || '',
                    cookieData: item.cookieData || '',
                    sourceLanguage: item.sourceLanguage || queueState.sourceLanguage || 'pt-BR',
                    targetLanguages: item.targetLanguages || queueState.targetLanguages || ['en', 'es'],
                    audioMode: item.audioMode || 'dubbing',
                    voiceProfile: item.voiceProfile || queueState.voiceProfile || 'female_studio',
                    voiceGender: 'female',
                    generateDubbedAudio: item.generateDubbedAudio !== undefined ? item.generateDubbedAudio : queueState.generateDubbedAudio,
                    outputDir: item.outputDir || queueState.outputDir || DEFAULT_OUTPUT_DIR,
                    uploadedFilePath: item.uploadedFilePath || '',
                    uploadedFileName: item.uploadedFileName || 'video.mp4',
                    step: 0,
                    percent: 5,
                    statusText: 'Iniciando...',
                    logs: [],
                    tracks: {},
                    completed: false,
                    error: null,
                    clients: new Set(),
                    onProgress: (pct, stp, txt) => {
                        item.percent = pct;
                        item.step = stp;
                        item.statusText = txt;
                        broadcastQueueUpdate();
                    }
                };

                jobs.set(job.id, job);
                await processJob(job);

                item.status = 'completed';
                item.percent = 100;
                item.title = job.title || item.title;
                item.statusText = 'Concluído com sucesso!';
                item.completedAt = Date.now();
                item.elapsedMs = item.completedAt - item.startedAt;
                item.outputPath = job.savedToFolder || '';
                item.zipUrl = job.zipUrl || '';
            } catch (err) {
                console.error(`[Queue Item ${item.id}] Erro:`, err);
                item.status = 'error';
                item.error = err.message || 'Falha no processamento';
                item.statusText = `Erro: ${item.error}`;
            } finally {
                activeQueueWorkers--;
                saveQueueState();
                if (queueState.isProcessing) {
                    processNextQueueItems();
                }
            }
        })(nextItem);
    }
}

// Inicializa a fila salva no disco
loadQueueState();

/**
 * Execute command promise
 */
function runCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
        const cleanCmd = typeof command === 'string' ? command.replace(/^"|"$/g, '') : command;
        const cleanArgs = (args || []).map(a => typeof a === 'string' ? a.replace(/^"|"$/g, '') : a);
        const proc = spawn(cleanCmd, cleanArgs, { shell: false, ...options });
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', data => { stdout += data.toString(); });
        proc.stderr.on('data', data => { stderr += data.toString(); });

        proc.on('close', code => {
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(`Command ${cleanCmd} exited with code ${code}: ${stderr || stdout}`));
        });

        proc.on('error', err => reject(err));
    });
}

/**
 * Format milliseconds to WebVTT timestamp (00:00:00.000)
 */
function formatVttTime(seconds) {
    const totalMs = Math.round(seconds * 1000);
    const ms = String(totalMs % 1000).padStart(3, '0');
    const totalSecs = Math.floor(totalMs / 1000);
    const s = String(totalSecs % 60).padStart(2, '0');
    const totalMins = Math.floor(totalSecs / 60);
    const m = String(totalMins % 60).padStart(2, '0');
    const h = String(Math.floor(totalMins / 60)).padStart(2, '0');
    return `${h}:${m}:${s}.${ms}`;
}

/**
 * Format milliseconds to SRT timestamp (00:00:00,000)
 */
function formatSrtTime(seconds) {
    return formatVttTime(seconds).replace('.', ',');
}

/**
 * HTTP helper to download binary
 */
function fetchBuffer(targetUrl) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(targetUrl);
        const client = parsed.protocol === 'https:' ? https : http;
        client.get(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(fetchBuffer(res.headers.location));
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP error ${res.statusCode}`));
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * HTTP POST helper to send JSON and retrieve audio buffer
 */
function postJsonBuffer(targetUrl, jsonString, headers = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(targetUrl);
        const client = parsed.protocol === 'https:' ? https : http;
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
                'User-Agent': 'BrainAudiovisual/1.0',
                ...headers
            }
        };

        const req = client.request(options, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(Buffer.concat(chunks));
                } else {
                    reject(new Error(`API responded with ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
                }
            });
            res.on('error', reject);
        });

        req.on('error', reject);
        if (jsonString) req.write(jsonString);
        req.end();
    });
}

/**
 * Fast Google Translate API wrapper for segment translation
 */
async function translateText(text, targetLang, sourceLang = 'auto') {
    if (!text || !text.trim()) return '';
    try {
        const q = encodeURIComponent(text);
        const sl = sourceLang ? sourceLang.split('-')[0].toLowerCase() : 'auto';
        const tl = targetLang ? targetLang.split('-')[0].toLowerCase() : 'en';
        if (sl === tl) return text;
        const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${q}`;
        const buffer = await fetchBuffer(apiUrl);
        const data = JSON.parse(buffer.toString('utf8'));
        if (data && data[0]) {
            return data[0].map(item => item[0]).join('');
        }
        return text;
    } catch (err) {
        console.warn(`Translation error for [${sourceLang} -> ${targetLang}]: ${err.message}`);
        return text;
    }
}

/**
 * Studio Neural TTS synthesizer - 100% Gratuito & Ilimitado
 * Padrão de vozes humanizadas com consistência absoluta de gênero entre todos os idiomas
 */
async function synthesizeTtsAudio(text, lang, voiceProfile = 'female_studio', destPath) {
    if (!text || !text.trim()) return false;

    const l = (lang || 'pt').toLowerCase().split('-')[0];

    // Perfis universais de voz que garantem consistência de gênero em todos os idiomas
    const voiceProfiles = {
        'female_studio': {
            'pt': 'pt-BR-FranciscaNeural', // Estúdio / Notícias / Máxima clareza fonética
            'en': 'en-US-AvaMultilingualNeural', // Calorosa / Natural
            'es': 'es-ES-ElviraNeural', // Estúdio / Clara
            'pt-pt': 'pt-PT-RaquelNeural'
        },
        'female_expressive': {
            'pt': 'pt-BR-ThalitaMultilingualNeural', // Expressiva / Conversacional
            'en': 'en-US-JennyNeural', // Estúdio Broadcast
            'es': 'es-MX-DaliaNeural', // Expressiva Latina
            'pt-pt': 'pt-PT-RaquelNeural'
        },
        'male_medical': {
            'pt': 'pt-BR-AntonioNeural', // Médico / Confiante / Formal
            'en': 'en-US-BrianMultilingualNeural', // Profundo / Médico / Narrador
            'es': 'es-ES-AlvaroNeural', // Confiante / Médico
            'pt-pt': 'pt-PT-DuarteNeural'
        },
        'male_speaker': {
            'pt': 'pt-BR-AntonioNeural', // Médico / Palestrante
            'en': 'en-US-AndrewMultilingualNeural', // Palestrante / Expressivo
            'es': 'es-MX-JorgeNeural', // Latino Amigável
            'pt-pt': 'pt-PT-DuarteNeural'
        }
    };

    const vp = (voiceProfile || 'female_studio').toLowerCase();
    let chosenVoice = null;

    if (voiceProfiles[vp] && voiceProfiles[vp][l]) {
        chosenVoice = voiceProfiles[vp][l];
    } else {
        // Mapeamento por gênero derivado caso venha o nome direto de uma voz
        const isFemale = vp.includes('female') || vp.includes('francisca') || vp.includes('thalita') || 
                         vp.includes('ava') || vp.includes('elvira') || vp.includes('jenny') || vp.includes('dalia');
        if (isFemale) {
            if (l === 'pt') chosenVoice = vp.includes('thalita') ? 'pt-BR-ThalitaMultilingualNeural' : 'pt-BR-FranciscaNeural';
            else if (l === 'en') chosenVoice = 'en-US-AvaMultilingualNeural';
            else if (l === 'es') chosenVoice = 'es-ES-ElviraNeural';
            else chosenVoice = 'pt-BR-FranciscaNeural';
        } else {
            // Masculino padrão
            if (l === 'pt') chosenVoice = 'pt-BR-AntonioNeural';
            else if (l === 'en') chosenVoice = vp.includes('andrew') ? 'en-US-AndrewMultilingualNeural' : 'en-US-BrianMultilingualNeural';
            else if (l === 'es') chosenVoice = vp.includes('jorge') ? 'es-MX-JorgeNeural' : 'es-ES-AlvaroNeural';
            else chosenVoice = 'pt-BR-AntonioNeural';
        }
    }

    const textTmpPath = destPath + '.txt';
    try {
        fs.writeFileSync(textTmpPath, text, 'utf8');
        await runCommand('python', [
            '-m', 'edge_tts',
            '--voice', chosenVoice,
            '-f', textTmpPath,
            '--write-media', destPath
        ]);
        if (fs.existsSync(textTmpPath)) try { fs.unlinkSync(textTmpPath); } catch (_) {}
        if (fs.existsSync(destPath) && fs.statSync(destPath).size > 400) {
            return true;
        }
    } catch (e) {
        if (fs.existsSync(textTmpPath)) try { fs.unlinkSync(textTmpPath); } catch (_) {}
    }

    // Fallback: Google Translate TTS
    try {
        const gUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(text.substring(0, 200))}`;
        const gBuf = await fetchBuffer(gUrl);
        if (gBuf.length > 500) {
            fs.writeFileSync(destPath, gBuf);
            return true;
        }
    } catch (e) {
        console.warn(`TTS fallback failed for ${lang}: ${e.message}`);
    }

    return false;
}

/**
 * Get Audio Duration using FFmpeg
 */
async function getAudioDuration(filePath) {
    try {
        const { stderr } = await runCommand(`"${FFMPEG_BIN}"`, ['-i', `"${filePath}"`, '-f', 'null', '-']);
        const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
        if (match) {
            const hours = parseFloat(match[1]);
            const mins = parseFloat(match[2]);
            const secs = parseFloat(match[3]);
            return hours * 3600 + mins * 60 + secs;
        }
    } catch (e) {
        // Ignore
    }
    return 0;
}

/**
 * Main Job Processor Pipeline
 */
async function processJob(job) {
    const jobDir = path.join(TEMP_DIR, job.id);
    if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

    try {
        // ==========================================
        // ETAPA 1: INGESTÃO DE MÍDIA (DOWNLOAD / LOCAL)
        // ==========================================
        job.step = 1;
        job.percent = 10;
        job.statusText = 'Ingestão e download de mídia...';
        addJobLog(job, `Iniciando job ${job.id} [Modo: ${job.audioMode}]`);

        const rawAudioPath = path.join(jobDir, 'raw_audio.mp3');

        if (job.sourceType === 'url') {
            try {
                const { stdout: titleOut } = await runCommand(YTDLP_BIN, ['--print', '%(title)s', '--no-warnings', job.url]);
                if (titleOut && titleOut.trim()) {
                    job.title = titleOut.trim().split(/\r?\n/)[0];
                    addJobLog(job, `Título do vídeo detectado: "${job.title}"`);
                }
            } catch (_) {}

            addJobLog(job, `Baixando fluxo de áudio via yt-dlp: ${job.url}`);
            const ytdlpArgs = [
                '-x',
                '--audio-format', 'mp3',
                '--audio-quality', '0',
                '--no-playlist',
                '-o', `"${path.join(jobDir, 'downloaded.%(ext)s')}"`,
                `"${job.url}"`
            ];

            // If custom cookies provided
            if (job.cookieData && job.cookieData.trim()) {
                const trimmed = job.cookieData.trim();
                if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                    addJobLog(job, 'Aviso: Foi inserida uma URL no campo de cookies em vez do conteúdo de cookies Netscape. A extração continuará sem cookies.', 'warn');
                } else if (trimmed.includes('\t') || trimmed.includes('# Netscape') || trimmed.includes('.vimeo.com') || trimmed.includes('.youtube.com')) {
                    const cookieFile = path.join(jobDir, 'cookies.txt');
                    fs.writeFileSync(cookieFile, trimmed, 'utf8');
                    ytdlpArgs.push('--cookies', `"${cookieFile}"`);
                    addJobLog(job, 'Cookies de autenticação aplicados para vídeo privado.');
                } else {
                    addJobLog(job, 'Aviso: Formato de cookies não reconhecido (deve ser formato Netscape). Prosseguindo sem cookies.', 'warn');
                }
            }

            try {
                await runCommand(`"${YTDLP_BIN}"`, ytdlpArgs);
            } catch (dlErr) {
                const msg = String(dlErr.message || dlErr);
                if (msg.includes('The web client only works when logged-in') || msg.includes('HTTP Error 401') || msg.includes('Private video') || msg.includes('Unauthorized')) {
                    throw new Error('Este vídeo do Vimeo é privado ou protegido por login da sua conta. Para processá-lo: baixe o vídeo pelo seu navegador e envie diretamente pela aba "Arquivo Local (Upload do Computador)", ou forneça cookies Netscape da sua sessão do Vimeo.');
                }
                throw dlErr;
            }

            // Find the extracted mp3
            const files = fs.readdirSync(jobDir);
            const downloadedMp3 = files.find(f => f.startsWith('downloaded') && f.endsWith('.mp3'));
            if (!downloadedMp3) throw new Error('Não foi possível extrair o áudio do link fornecido.');

            fs.renameSync(path.join(jobDir, downloadedMp3), rawAudioPath);
            addJobLog(job, 'Download de áudio concluído com sucesso!');
        } else {
            // Local file already uploaded
            addJobLog(job, `Extraindo áudio do arquivo local enviado: ${job.uploadedFileName}`);
            await runCommand(`"${FFMPEG_BIN}"`, [
                '-y',
                '-i', `"${job.uploadedFilePath}"`,
                '-vn',
                '-ar', '44100',
                '-ac', '2',
                '-b:a', '192k',
                `"${rawAudioPath}"`
            ]);
            addJobLog(job, 'Áudio extraído do arquivo local com sucesso!');
        }

        // Measure total duration
        job.duration = await getAudioDuration(rawAudioPath);
        addJobLog(job, `Duração total detectada: ${job.duration.toFixed(1)} segundos (${(job.duration / 60).toFixed(1)} min)`);

        // Save original track for in-browser playback
        const originalTrackPath = path.join(jobDir, 'audio_original.mp3');
        fs.copyFileSync(rawAudioPath, originalTrackPath);
        job.tracks = { original: `/api/audio/${job.id}/original` };

        // ==========================================
        // ETAPA 2: ANÁLISE ESPECTRAL E SEGMENTAÇÃO VAD COM PADDING PRO
        // ==========================================
        job.step = 2;
        job.percent = 25;
        job.statusText = 'Análise de silêncios e segmentação contextual com padding...';
        addJobLog(job, 'Executando detecção de atividade vocal (VAD) com FFmpeg...');

        // Detect silences with silencedetect: noise=-34dB:d=0.55 (preserva palavras baixas e respiração)
        const { stderr: silenceLog } = await runCommand(FFMPEG_BIN, [
            '-i', rawAudioPath,
            '-af', 'silencedetect=noise=-34dB:d=0.55',
            '-f', 'null', '-'
        ]);

        const silenceEnds = [];
        const silenceStarts = [];
        const reStart = /silence_start:\s*([\d\.]+)/g;
        const reEnd = /silence_end:\s*([\d\.]+)/g;

        let m;
        while ((m = reStart.exec(silenceLog)) !== null) silenceStarts.push(parseFloat(m[1]));
        while ((m = reEnd.exec(silenceLog)) !== null) silenceEnds.push(parseFloat(m[1]));

        // Build continuous spoken chunks
        const rawChunks = [];
        let curStart = 0.0;

        for (let i = 0; i < silenceStarts.length; i++) {
            const sStart = silenceStarts[i];
            const sEnd = silenceEnds[i] || sStart + 0.55;

            if (sStart - curStart >= 0.8) {
                rawChunks.push({
                    start: parseFloat(curStart.toFixed(2)),
                    end: parseFloat(sStart.toFixed(2))
                });
            }
            curStart = sEnd;
        }

        // Final chunk if trailing speech exists
        if (job.duration - curStart >= 0.8) {
            rawChunks.push({
                start: parseFloat(curStart.toFixed(2)),
                end: parseFloat(job.duration.toFixed(2))
            });
        }

        // Fusão de orações próximas (pausas <= 0.60s) para manter frases completas e coerência de contexto
        const mergedChunks = [];
        for (let i = 0; i < rawChunks.length; i++) {
            const cur = rawChunks[i];
            if (mergedChunks.length === 0) {
                mergedChunks.push({ ...cur });
            } else {
                const prev = mergedChunks[mergedChunks.length - 1];
                const pause = cur.start - prev.end;
                if (pause <= 0.60 && (cur.end - prev.start) <= 20.0) {
                    prev.end = cur.end; // Une orações de mesma linha de raciocínio
                } else {
                    mergedChunks.push({ ...cur });
                }
            }
        }

        // Aplicação de Padding de Segurança (Garante que a última palavra NUNCA seja cortada)
        const segments = mergedChunks.map((seg, idx) => {
            const paddedStart = Math.max(0, parseFloat((seg.start - 0.15).toFixed(2)));
            const paddedEnd = Math.min(job.duration, parseFloat((seg.end + 0.40).toFixed(2)));
            return {
                id: idx + 1,
                start: paddedStart,
                end: paddedEnd,
                duration: parseFloat((paddedEnd - paddedStart).toFixed(2)),
                // Margem estendida para extração de áudio STT (+0.50s de rabo de fala)
                wavStart: Math.max(0, parseFloat((seg.start - 0.20).toFixed(2))),
                wavEnd: Math.min(job.duration, parseFloat((seg.end + 0.50).toFixed(2)))
            };
        });

        // Caso o áudio seja contínuo sem silêncios detectados, divide em blocos naturais de 6s
        if (segments.length === 0) {
            let t = 0;
            const stepSec = 6.0;
            while (t < job.duration) {
                const segEnd = Math.min(t + stepSec, job.duration);
                segments.push({
                    id: segments.length + 1,
                    start: parseFloat(t.toFixed(2)),
                    end: parseFloat(segEnd.toFixed(2)),
                    duration: parseFloat((segEnd - t).toFixed(2)),
                    wavStart: parseFloat(t.toFixed(2)),
                    wavEnd: parseFloat(segEnd.toFixed(2))
                });
                t = segEnd;
            }
        }

        addJobLog(job, `Segmentação contextual concluída: ${segments.length} blocos com padding de segurança.`);

        // ==========================================
        // ETAPA 3: TRANSCRIÇÃO REAL COM TIMESTAMPS
        // ==========================================
        job.step = 3;
        job.percent = 40;
        job.statusText = 'Extraindo áudios e transcrevendo fala com IA...';
        addJobLog(job, `Extraindo ${segments.length} trechos de áudio para transcrição Speech-to-Text...`);

        // Extrai cada mini-segmento .wav (16kHz mono para STT com margem de segurança)
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const segAudioPath = path.join(jobDir, `seg_${seg.id}.wav`);
            const extractStart = (seg.wavStart !== undefined ? seg.wavStart : seg.start).toFixed(3);
            const extractEnd = (seg.wavEnd !== undefined ? seg.wavEnd : seg.end).toFixed(3);

            await runCommand(FFMPEG_BIN, [
                '-y',
                '-i', rawAudioPath,
                '-ss', extractStart,
                '-to', extractEnd,
                '-ar', '16000',
                '-ac', '1',
                segAudioPath
            ]);
        }

        // Gera o manifesto JSON para o transcritor Python
        const manifestPath = path.join(jobDir, 'transcribe_manifest.json');
        const manifestData = {
            language: job.sourceLanguage || 'pt-BR',
            engine: job.transcribeEngine || 'google',
            openaiApiKey: job.openaiApiKey || '',
            geminiApiKey: job.geminiApiKey || '',
            segments: segments.map(s => ({
                id: s.id,
                path: path.join(jobDir, `seg_${s.id}.wav`)
            }))
        };
        fs.writeFileSync(manifestPath, JSON.stringify(manifestData), 'utf8');

        addJobLog(job, `Executando Speech-to-Text neural [Motor: ${(job.transcribeEngine || 'Google Neural').toUpperCase()}]...`);

        const pythonScript = path.join(__dirname, 'transcribe.py');
        let transcriptions = {};
        try {
            const { stdout: rawOutput } = await runCommand('python', [pythonScript, manifestPath, job.sourceLanguage || 'pt-BR']);
            const jsonMatch = (rawOutput || '').match(/\{"success":\s*true[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                transcriptions = parsed.transcriptions || {};
            }
        } catch (sttErr) {
            addJobLog(job, `Aviso no Speech-to-Text: ${sttErr.message}`, 'warn');
        }

        let validSpeechCount = 0;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const recognized = transcriptions[String(seg.id)] ? transcriptions[String(seg.id)].trim() : '';
            seg.text = recognized;
            if (recognized) {
                validSpeechCount++;
                addJobLog(job, `[${formatVttTime(seg.start)} - ${formatVttTime(seg.end)}] "${recognized.substring(0, 50)}${recognized.length > 50 ? '...' : ''}"`);
            }
        }

        addJobLog(job, `Transcrição concluída com sucesso: ${validSpeechCount} de ${segments.length} blocos com fala ativa.`);

        // ==========================================
        // ETAPA 4: TRADUÇÃO CONTEXTUAL MULTILÍNGUE
        // ==========================================
        job.step = 4;
        job.percent = 55;
        job.statusText = 'Tradução multilíngue contextual...';
        const targetLangs = job.targetLanguages || ['pt', 'en', 'es'];
        addJobLog(job, `Traduzindo sentenças para os idiomas selecionados [${targetLangs.map(l => l.toUpperCase()).join(', ')}]...`);

        const sourceLangRaw = job.sourceLanguage || 'pt-BR';
        const sourceBase = sourceLangRaw.split('-')[0].toLowerCase();

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            seg.translations = {};

            if (!seg.text || !seg.text.trim()) {
                for (const lang of targetLangs) seg.translations[lang] = '';
                continue;
            }

            for (const lang of targetLangs) {
                if (lang === sourceBase) {
                    seg.translations[lang] = seg.text;
                } else {
                    seg.translations[lang] = await translateText(seg.text, lang, sourceBase);
                }
            }
        }
        addJobLog(job, 'Traduções finalizadas preservando todos os marcadores de tempo.');

        // ==========================================
        // ETAPA 5: GERAÇÃO DE LEGENDAS NATIVAS (.VTT)
        // ==========================================
        job.step = 5;
        job.percent = 70;
        job.statusText = 'Gerando arquivos de legendas .VTT...';
        addJobLog(job, 'Compilando legendas .VTT no padrão YouTube Studio e Vimeo (arquivos SRT excluídos)...');

        const subtitlesDir = path.join(jobDir, 'subtitles');
        if (!fs.existsSync(subtitlesDir)) fs.mkdirSync(subtitlesDir, { recursive: true });

        job.subtitles = {};

        for (const lang of targetLangs) {
            let vttContent = 'WEBVTT - Brain Audiovisual\n\n';
            let cueIndex = 1;

            segments.forEach((seg) => {
                const text = (seg.translations[lang] || seg.text || '').trim();
                if (!text) return; // Não gera legenda vazia para pausas

                const vttStart = formatVttTime(seg.start);
                const vttEnd = formatVttTime(seg.end);

                vttContent += `${cueIndex}\n${vttStart} --> ${vttEnd}\n${text}\n\n`;
                cueIndex++;
            });

            fs.writeFileSync(path.join(subtitlesDir, `subtitles_${lang}.vtt`), vttContent, 'utf8');
            job.subtitles[lang] = { vtt: `subtitles_${lang}.vtt` };
        }
        addJobLog(job, 'Legendas .VTT geradas com sucesso para todos os idiomas selecionados.');

        // ==========================================
        // ETAPA 6: SÍNTESE E SINCRONISMO DE DUBLAGEM
        // ==========================================
        const audioTracksDir = path.join(jobDir, 'audio_tracks');
        if (!fs.existsSync(audioTracksDir)) fs.mkdirSync(audioTracksDir, { recursive: true });

        if (!job.generateDubbedAudio) {
            addJobLog(job, 'Áudio dubbed desativado para economia de tempo e recursos do PC. Pulando síntese de voz.');
            job.step = 6;
            job.percent = 90;
            job.statusText = 'Modo ultra-rápido: áudios dubbed ignorados com sucesso.';
        } else {
            job.step = 6;
            job.percent = 85;
            job.statusText = 'Síntese de voz e sincronismo de dublagem (Time-Anchoring)...';
            addJobLog(job, 'Gerando faixas de áudio MP3 sincronizadas com FFmpeg atempo...');

            for (const lang of targetLangs) {
                addJobLog(job, `Processando faixa de áudio sincronizada [${lang.toUpperCase()}]...`);
                const langDir = path.join(jobDir, `tts_${lang}`);
                if (!fs.existsSync(langDir)) fs.mkdirSync(langDir, { recursive: true });

                const concatListFile = path.join(langDir, 'concat_list.txt');
                const concatEntries = [];

                let currentTrackPos = 0.0;

                for (let i = 0; i < segments.length; i++) {
                    const seg = segments[i];
                    const text = seg.translations[lang] || seg.text;

                    // 1. Preenchimento de silêncio exato para que este segmento inicie precisamente em seg.start
                    const neededSilence = seg.start - currentTrackPos;
                    if (neededSilence > 0.03) {
                        const silenceFile = path.join(langDir, `silence_${i}.mp3`);
                        await runCommand(`"${FFMPEG_BIN}"`, [
                            '-y',
                            '-f', 'lavfi',
                            '-i', `anullsrc=r=44100:cl=stereo`,
                            '-t', neededSilence.toFixed(3),
                            '-b:a', '192k',
                            `"${silenceFile}"`
                        ]);
                        concatEntries.push(`file '${silenceFile.replace(/\\/g, '/')}'`);
                        currentTrackPos += neededSilence;
                    }

                    // 2. Síntese de voz TTS
                    if (!text || !text.trim()) {
                        const silenceFile = path.join(langDir, `empty_${i}.mp3`);
                        await runCommand(`"${FFMPEG_BIN}"`, [
                            '-y',
                            '-f', 'lavfi',
                            '-i', `anullsrc=r=44100:cl=stereo`,
                            '-t', seg.duration.toFixed(3),
                            '-b:a', '192k',
                            `"${silenceFile}"`
                        ]);
                        concatEntries.push(`file '${silenceFile.replace(/\\/g, '/')}'`);
                        currentTrackPos += seg.duration;
                        continue;
                    }

                    const rawTtsFile = path.join(langDir, `raw_tts_${i}.mp3`);
                    const synthesized = await synthesizeTtsAudio(text, lang, job.voiceProfile || job.voiceGender, rawTtsFile);

                    if (!synthesized || !fs.existsSync(rawTtsFile)) {
                        const silenceFile = path.join(langDir, `empty_${i}.mp3`);
                        await runCommand(FFMPEG_BIN, [
                            '-y',
                            '-f', 'lavfi',
                            '-i', `anullsrc=r=44100:cl=stereo`,
                            '-t', seg.duration.toFixed(3),
                            '-b:a', '192k',
                            silenceFile
                        ]);
                        concatEntries.push(`file '${silenceFile.replace(/\\/g, '/')}'`);
                        currentTrackPos += seg.duration;
                        continue;
                    }

                    const rawDuration = await getAudioDuration(rawTtsFile);
                    const targetDuration = seg.duration;
                    const fittedTtsFile = path.join(langDir, `fitted_tts_${i}.mp3`);

                    // Ajuste inteligente de tempo para coincidir com a janela de fala e a legenda
                    if (targetDuration > 0.4 && rawDuration > targetDuration) {
                        const speedRatio = Math.min(1.40, Math.max(0.85, rawDuration / targetDuration));
                        await runCommand(FFMPEG_BIN, [
                            '-y',
                            '-i', rawTtsFile,
                            '-filter:a', `atempo=${speedRatio.toFixed(3)}`,
                            '-b:a', '192k',
                            fittedTtsFile
                        ]);
                    } else {
                        fs.copyFileSync(rawTtsFile, fittedTtsFile);
                    }

                    // Registra a duração real inserida no concat para que o próximo silêncio seja perfeito
                    const actualSnippetDuration = await getAudioDuration(fittedTtsFile);
                    concatEntries.push(`file '${fittedTtsFile.replace(/\\/g, '/')}'`);
                    currentTrackPos += actualSnippetDuration;
                }

                if (job.duration > currentTrackPos) {
                    const tailSilence = job.duration - currentTrackPos;
                    if (tailSilence > 0.05) {
                        const tailFile = path.join(langDir, `tail_silence.mp3`);
                        await runCommand(`"${FFMPEG_BIN}"`, [
                            '-y',
                            '-f', 'lavfi',
                            '-i', `anullsrc=r=44100:cl=stereo`,
                            '-t', tailSilence.toFixed(3),
                            '-b:a', '192k',
                            `"${tailFile}"`
                        ]);
                        concatEntries.push(`file '${tailFile.replace(/\\/g, '/')}'`);
                        currentTrackPos += tailSilence;
                    }
                }

                fs.writeFileSync(concatListFile, concatEntries.join('\n'), 'utf8');

                const dubbedCleanPath = path.join(audioTracksDir, `audio_${lang}_clean.mp3`);
                await runCommand(`"${FFMPEG_BIN}"`, [
                    '-y',
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', `"${concatListFile}"`,
                    '-c:a', 'libmp3lame',
                    '-b:a', '192k',
                    `"${dubbedCleanPath}"`
                ]);

                const finalTrackPath = path.join(audioTracksDir, `audio_${lang}_dubbed.mp3`);

                if (job.audioMode === 'voiceover') {
                    await runCommand(`"${FFMPEG_BIN}"`, [
                        '-y',
                        '-i', `"${dubbedCleanPath}"`,
                        '-i', `"${rawAudioPath}"`,
                        '-filter_complex', `"[1:a]volume=0.12[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2"`,
                        '-b:a', '192k',
                        `"${finalTrackPath}"`
                    ]);
                    addJobLog(job, `Mixagem Voice-Over finalizada para [${lang.toUpperCase()}].`);
                } else {
                    fs.copyFileSync(dubbedCleanPath, finalTrackPath);
                    addJobLog(job, `Faixa de Dublagem limpa finalizada para [${lang.toUpperCase()}].`);
                }

                job.tracks[lang] = `/api/audio/${job.id}/${lang}`;
            }
        }

        // ==========================================
        // ETAPA 7: SALVAMENTO NA PASTA DE DESTINO E PACOTE ZIP
        // ==========================================
        job.percent = 95;
        job.statusText = 'Salvando na pasta de destino selecionada...';
        addJobLog(job, 'Exportando arquivos estruturados para a pasta final...');

        // Identifica pasta de destino e nome limpo do vídeo
        const targetBaseDir = job.outputDir || queueState.outputDir || DEFAULT_OUTPUT_DIR;
        const videoFolderName = sanitizeFilename(job.title || `video_${job.id}`);
        const destinationFolder = path.join(targetBaseDir, videoFolderName);
        if (!fs.existsSync(destinationFolder)) fs.mkdirSync(destinationFolder, { recursive: true });

        // Determina sigla do idioma de origem (ex: PT, EN, ES)
        const sourceLangTag = (job.sourceLanguage || 'pt-BR').split('-')[0].toUpperCase();

        // Copia legendas .VTT para a pasta de destino com SIGLA DO IDIOMA NO INÍCIO
        const destSubtitlesDir = path.join(destinationFolder, 'legendas_vtt');
        if (!fs.existsSync(destSubtitlesDir)) fs.mkdirSync(destSubtitlesDir, { recursive: true });
        
        for (const lang of targetLangs) {
            const langUpper = lang.toUpperCase();
            const srcVtt = path.join(subtitlesDir, `subtitles_${lang}.vtt`);
            if (fs.existsSync(srcVtt)) {
                // Nome oficial solicitado: sigla do idioma sempre no início do título
                const formattedVttName = `${langUpper}_${videoFolderName}.vtt`;
                fs.copyFileSync(srcVtt, path.join(destSubtitlesDir, formattedVttName));
                fs.copyFileSync(srcVtt, path.join(destinationFolder, formattedVttName));
            }
        }

        // Copia áudio original com a SIGLA DO IDIOMA NO INÍCIO
        if (fs.existsSync(originalTrackPath)) {
            const originalAudioName = `${sourceLangTag}_${videoFolderName}_audio_original.mp3`;
            fs.copyFileSync(originalTrackPath, path.join(destinationFolder, originalAudioName));
            fs.copyFileSync(originalTrackPath, path.join(destinationFolder, 'audio_original.mp3')); // compatibilidade do player
        }

        // Se gerou dublagens, copia faixas de áudio com a SIGLA DO IDIOMA NO INÍCIO
        if (job.generateDubbedAudio && fs.existsSync(audioTracksDir)) {
            const destAudioDir = path.join(destinationFolder, 'audio_dublado');
            if (!fs.existsSync(destAudioDir)) fs.mkdirSync(destAudioDir, { recursive: true });
            for (const lang of targetLangs) {
                const langUpper = lang.toUpperCase();
                const dubbedFile = path.join(audioTracksDir, `audio_${lang}_dubbed.mp3`);
                if (fs.existsSync(dubbedFile)) {
                    const formattedDubbedName = `${langUpper}_${videoFolderName}_audio_dublado.mp3`;
                    fs.copyFileSync(dubbedFile, path.join(destAudioDir, formattedDubbedName));
                    fs.copyFileSync(dubbedFile, path.join(destinationFolder, formattedDubbedName));
                }
            }
        }

        // Create instructions README
        const readmeContent = `====================================================================
BRAIN AUDIOVISUAL - AUDIOVISUAL EDITION
PACOTE DE LEGENDAS E ÁUDIO PARA YOUTUBE E VIMEO
====================================================================

ID do Projeto: ${job.id}
Título: ${job.title || 'Vídeo sem título'}
Data de Criação: ${new Date().toLocaleString('pt-BR')}
Duração Total: ${job.duration.toFixed(1)} segundos (${(job.duration / 60).toFixed(1)} min)
Áudios Dublados: ${job.generateDubbedAudio ? 'Gerados com sucesso' : 'Desativados para economia de tempo'}

--------------------------------------------------------------------
CONTEÚDO DO DIRETÓRIO:
--------------------------------------------------------------------
📁 legendas_vtt/
   - subtitles_*.vtt  -> Legendas WebVTT nativas para cada idioma

🎵 audio_original.mp3 -> Áudio original extraído em alta fidelidade (192kbps)
${job.generateDubbedAudio ? '📁 audio_dublado/\n   - Faixas MP3 dubladas sincronizadas\n' : ''}
📁 transcriptions/
   - transcript_timeline.json  -> Marcações completas de tempo, texto e traduções

--------------------------------------------------------------------
INSTRUÇÕES DE UPLOAD:
--------------------------------------------------------------------
1. NO YOUTUBE (YouTube Studio):
   - Acesse seu vídeo em studio.youtube.com
   - Vá na aba "Legendas" (Subtitles) para subir os arquivos .VTT
     associando ao respectivo idioma.

2. NO VIMEO (Vimeo Pro / Business / Enterprise):
   - Acesse o gerenciador de vídeos do Vimeo.
   - Na aba "Áudio & Legendas", faça o upload das legendas .VTT.

Gerado automaticamente por Brain Audiovisual.
`;

        fs.writeFileSync(path.join(destinationFolder, 'README_INSTRUCOES_UPLOAD.txt'), readmeContent, 'utf8');

        // Save transcript JSON
        const transcriptDir = path.join(jobDir, 'transcriptions');
        if (!fs.existsSync(transcriptDir)) fs.mkdirSync(transcriptDir, { recursive: true });
        const transcriptPayload = JSON.stringify({ jobId: job.id, title: job.title || '', duration: job.duration, segments }, null, 2);
        fs.writeFileSync(path.join(transcriptDir, 'transcript_timeline.json'), transcriptPayload, 'utf8');
        fs.writeFileSync(path.join(destinationFolder, 'transcript_timeline.json'), transcriptPayload, 'utf8');

        // Package with PowerShell Compress-Archive
        const zipFileName = `${videoFolderName}_BrainAudiovisual.zip`;
        const zipFilePath = path.join(OUTPUT_DIR, zipFileName);

        const psScript = `
        $destFolder = '${destinationFolder.replace(/\\/g, '/')}';
        $destZip = '${zipFilePath.replace(/\\/g, '/')}';
        if (Test-Path $destZip) { Remove-Item $destZip -Force };
        Compress-Archive -Path "$destFolder/*" -DestinationPath $destZip -CompressionLevel Optimal;
        `;

        try {
            await runCommand('powershell.exe', ['-NoProfile', '-Command', psScript.replace(/\n/g, ' ')]);
            if (fs.existsSync(zipFilePath)) {
                fs.copyFileSync(zipFilePath, path.join(destinationFolder, zipFileName));
            }
        } catch (e) {
            console.warn(`[Job ${job.id}] Aviso ao gerar ZIP complementar: ${e.message}`);
        }

        job.savedToFolder = destinationFolder;
        job.zipUrl = `/api/download/${job.id}`;
        job.percent = 100;
        job.step = 7;
        job.completed = true;
        job.statusText = 'Concluído com sucesso!';
        addJobLog(job, `Arquivos salvos automaticamente na pasta: ${destinationFolder}`);
        addJobLog(job, `Pacote ZIP gerado: ${zipFileName}`);
        broadcastJobUpdate(job);

    } catch (err) {
        console.error(`Erro no processamento do Job ${job.id}:`, err);
        job.error = err.message || 'Erro durante o processamento do vídeo.';
        job.statusText = `Erro: ${job.error}`;
        addJobLog(job, `FALHA: ${job.error}`, 'error');
        broadcastJobUpdate(job);
    }
}

/**
 * Native Simple HTTP Server
 */
const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = reqUrl.pathname;

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    // 0. API: System Resources (CPU, GPU, RAM) & Binary Status
    if (pathname === '/api/system-stats' || pathname === '/api/status') {
        const cpuPercent = getCpuUsagePercent();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const ramStats = {
            totalGb: (totalMem / (1024 ** 3)).toFixed(1),
            usedGb: (usedMem / (1024 ** 3)).toFixed(1),
            freeGb: (freeMem / (1024 ** 3)).toFixed(1),
            usagePercent: Math.round((usedMem / totalMem) * 100)
        };
        const cpus = os.cpus();
        const cpuInfo = {
            model: cpus.length > 0 ? cpus[0].model.trim() : 'CPU',
            cores: cpus.length,
            usagePercent: cpuPercent
        };
        const gpuInfo = await getGpuStats();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            success: true,
            ffmpeg: fs.existsSync(FFMPEG_BIN),
            ytdlp: fs.existsSync(YTDLP_BIN),
            cpu: cpuInfo,
            ram: ramStats,
            gpu: gpuInfo
        }));
    }

    // ==========================================
    // API: FILA PERSISTENTE E PROCESSAMENTO EM LOTE
    // ==========================================

    // 0.1 GET /api/queue - Consulta estado atual da fila
    if (pathname === '/api/queue' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, ...queueState }));
    }

    // 0.2 GET /api/queue/stream - SSE em tempo real da fila
    if (pathname === '/api/queue/stream') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        res.write(`data: ${JSON.stringify(queueState)}\n\n`);
        queueClients.add(res);
        req.on('close', () => queueClients.delete(res));
        return;
    }

    // 0.3 POST /api/queue/config - Atualização das preferências da fila
    if (pathname === '/api/queue/config' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                if (payload.concurrency !== undefined) queueState.concurrency = Math.max(1, Math.min(4, parseInt(payload.concurrency, 10) || 2));
                if (payload.outputDir) queueState.outputDir = payload.outputDir.trim();
                if (payload.generateDubbedAudio !== undefined) queueState.generateDubbedAudio = !!payload.generateDubbedAudio;
                if (payload.sourceLanguage) queueState.sourceLanguage = payload.sourceLanguage;
                if (payload.voiceProfile) queueState.voiceProfile = payload.voiceProfile;
                if (Array.isArray(payload.targetLanguages)) queueState.targetLanguages = payload.targetLanguages;

                try {
                    if (!fs.existsSync(queueState.outputDir)) fs.mkdirSync(queueState.outputDir, { recursive: true });
                } catch (_) {}

                saveQueueState();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, queueState }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    // 0.4 POST /api/queue/add - Adiciona múltiplos links ou itens à fila
    if (pathname === '/api/queue/add' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const incoming = Array.isArray(payload.items) ? payload.items : (Array.isArray(payload.urls) ? payload.urls.map(u => ({ url: u })) : []);
                let addedCount = 0;

                for (const item of incoming) {
                    const rawUrl = (item.url || '').trim();
                    if (!rawUrl && !item.uploadedFilePath) continue;

                    const itemId = `q_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
                    const queueItem = {
                        id: itemId,
                        sourceType: item.sourceType || (item.uploadedFilePath ? 'file' : 'url'),
                        url: rawUrl,
                        title: (item.title || rawUrl.split('/').pop() || 'Vídeo').substring(0, 150),
                        cookieData: item.cookieData || payload.cookieData || '',
                        sourceLanguage: item.sourceLanguage || queueState.sourceLanguage || 'pt-BR',
                        targetLanguages: item.targetLanguages || queueState.targetLanguages || ['en', 'es'],
                        audioMode: item.audioMode || 'dubbing',
                        voiceProfile: item.voiceProfile || queueState.voiceProfile || 'female_studio',
                        generateDubbedAudio: item.generateDubbedAudio !== undefined ? item.generateDubbedAudio : queueState.generateDubbedAudio,
                        outputDir: item.outputDir || queueState.outputDir || DEFAULT_OUTPUT_DIR,
                        uploadedFilePath: item.uploadedFilePath || '',
                        uploadedFileName: item.uploadedFileName || 'video.mp4',
                        status: 'queued',
                        percent: 0,
                        step: 0,
                        statusText: 'Na fila',
                        outputPath: '',
                        zipUrl: '',
                        error: null,
                        addedAt: Date.now()
                    };

                    queueState.items.push(queueItem);
                    addedCount++;
                }

                saveQueueState();

                if (queueState.isProcessing) {
                    processNextQueueItems();
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, addedCount, totalItems: queueState.items.length }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    // 0.5 POST /api/queue/start - Inicia ou retoma a esteira de processamento
    if (pathname === '/api/queue/start' && req.method === 'POST') {
        queueState.isProcessing = true;
        saveQueueState();
        processNextQueueItems();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, isProcessing: true }));
    }

    // 0.6 POST /api/queue/pause - Pausa a esteira
    if (pathname === '/api/queue/pause' && req.method === 'POST') {
        queueState.isProcessing = false;
        saveQueueState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, isProcessing: false }));
    }

    // 0.7 POST /api/queue/clear-completed - Limpa itens concluídos
    if (pathname === '/api/queue/clear-completed' && req.method === 'POST') {
        queueState.items = queueState.items.filter(i => i.status !== 'completed');
        saveQueueState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, items: queueState.items }));
    }

    // 0.8 POST /api/queue/clear-all - Limpa tudo que não estiver processando
    if (pathname === '/api/queue/clear-all' && req.method === 'POST') {
        queueState.items = queueState.items.filter(i => i.status === 'processing');
        saveQueueState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, items: queueState.items }));
    }

    // 0.9 POST /api/queue/remove - Remove item específico
    if (pathname === '/api/queue/remove' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { id } = JSON.parse(body);
                queueState.items = queueState.items.filter(i => i.id !== id || i.status === 'processing');
                saveQueueState();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    // 0.10 POST /api/queue/retry - Reprocessar item que falhou ou terminou
    if (pathname === '/api/queue/retry' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { id } = JSON.parse(body);
                const item = queueState.items.find(i => i.id === id);
                if (item && item.status !== 'processing') {
                    item.status = 'queued';
                    item.percent = 0;
                    item.statusText = 'Na fila para reprocessar';
                    item.error = null;
                    saveQueueState();
                    if (queueState.isProcessing) {
                        processNextQueueItems();
                    }
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    // 0.11 POST /api/extract-playlist - Extrai todos os vídeos de uma playlist/showcase (YouTube / Vimeo)
    if (pathname === '/api/extract-playlist' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { url: playlistUrl, cookieData } = JSON.parse(body);
                if (!playlistUrl || !playlistUrl.trim()) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, error: 'URL da playlist ou showcase é obrigatória.' }));
                }

                const args = ['--flat-playlist', '--no-warnings', '--print', '%(id)s\t%(title)s\t%(url)s'];

                let cookieFile = null;
                if (cookieData && cookieData.trim()) {
                    cookieFile = path.join(TEMP_DIR, `cookie_${Date.now()}.txt`);
                    fs.writeFileSync(cookieFile, cookieData.trim(), 'utf8');
                    args.push('--cookies', cookieFile);
                }

                args.push(playlistUrl.trim());

                const { stdout } = await runCommand(YTDLP_BIN, args);
                if (cookieFile && fs.existsSync(cookieFile)) {
                    try { fs.unlinkSync(cookieFile); } catch (_) {}
                }

                const lines = stdout.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
                const videos = lines.map(line => {
                    const parts = line.split('\t');
                    const id = parts[0] || '';
                    const title = parts[1] || `Vídeo ${id}`;
                    let videoUrl = parts[2] || '';
                    if (videoUrl && !videoUrl.startsWith('http')) {
                        if (playlistUrl.includes('vimeo.com')) {
                            videoUrl = `https://vimeo.com/${videoUrl}`;
                        } else {
                            videoUrl = `https://www.youtube.com/watch?v=${videoUrl}`;
                        }
                    } else if (!videoUrl && id) {
                        if (playlistUrl.includes('vimeo.com')) {
                            videoUrl = `https://vimeo.com/${id}`;
                        } else {
                            videoUrl = `https://www.youtube.com/watch?v=${id}`;
                        }
                    }
                    return { id, title, url: videoUrl };
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, count: videos.length, videos }));
            } catch (e) {
                console.error('[Playlist Extract Error]', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message || 'Erro ao extrair playlist.' }));
            }
        });
        return;
    }

    // 0.12 POST /api/open-folder - Abre a pasta no Windows Explorer
    if (pathname === '/api/open-folder' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { folderPath } = JSON.parse(body || '{}');
                const targetPath = (folderPath && folderPath.trim()) ? folderPath.trim() : (queueState.outputDir || DEFAULT_OUTPUT_DIR);
                if (!fs.existsSync(targetPath)) {
                    fs.mkdirSync(targetPath, { recursive: true });
                }
                spawn('explorer.exe', [targetPath], { detached: true, stdio: 'ignore' }).unref();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, folder: targetPath }));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    // 1. API: Process Job Request (JSON)
    if (pathname === '/api/process' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const jobId = `job_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

                const job = {
                    id: jobId,
                    sourceType: payload.sourceType || 'url',
                    url: payload.url || '',
                    cookieData: payload.cookieData || '',
                    sourceLanguage: payload.sourceLanguage || 'pt-BR',
                    targetLanguages: (Array.isArray(payload.targetLanguages) && payload.targetLanguages.length > 0) ? payload.targetLanguages : ['en', 'es'],
                    audioMode: payload.audioMode || 'dubbing', // 'dubbing' | 'voiceover'
                    voiceProfile: payload.voiceProfile || 'female_studio',
                    voiceGender: payload.voiceGender || 'female',
                    apiKey: payload.apiKey || '',
                    uploadedFilePath: payload.uploadedFilePath || '',
                    uploadedFileName: payload.uploadedFileName || 'video_local.mp4',
                    step: 0,
                    percent: 0,
                    statusText: 'Iniciando fila...',
                    logs: [],
                    tracks: {},
                    completed: false,
                    error: null,
                    clients: new Set()
                };

                jobs.set(jobId, job);

                // Run async pipeline in background
                processJob(job);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, jobId }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
        });
        return;
    }

    // 2. API: File Upload Endpoint
    if (pathname === '/api/upload' && req.method === 'POST') {
        const uploadId = `upload_${Date.now()}`;
        const tempUploadPath = path.join(TEMP_DIR, `${uploadId}.mp4`);
        const fileStream = fs.createWriteStream(tempUploadPath);

        req.pipe(fileStream);

        fileStream.on('finish', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, uploadedFilePath: tempUploadPath }));
        });

        fileStream.on('error', err => {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
        });
        return;
    }

    // 3. API: Server-Sent Events (SSE) Progress Feed
    if (pathname.startsWith('/api/progress/')) {
        const jobId = pathname.replace('/api/progress/', '');
        const job = jobs.get(jobId);

        if (!job) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Job not found' }));
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        res.write('\n');
        job.clients.add(res);

        // Send initial state immediately
        broadcastJobUpdate(job);

        req.on('close', () => {
            job.clients.delete(res);
        });
        return;
    }

    // 4. API: Stream Audio Track for In-Browser Playback
    if (pathname.startsWith('/api/audio/')) {
        const parts = pathname.replace('/api/audio/', '').split('/');
        const jobId = parts[0];
        const track = parts[1]; // 'original', 'pt', 'en', 'es'

        const jobDir = path.join(TEMP_DIR, jobId);
        let audioFile = '';

        if (track === 'original') audioFile = path.join(jobDir, 'audio_original.mp3');
        else audioFile = path.join(jobDir, 'audio_tracks', `audio_${track}_dubbed.mp3`);

        if (fs.existsSync(audioFile)) {
            const stat = fs.statSync(audioFile);
            res.writeHead(200, {
                'Content-Type': 'audio/mpeg',
                'Content-Length': stat.size,
                'Cache-Control': 'no-cache'
            });
            fs.createReadStream(audioFile).pipe(res);
            return;
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('Faixa de áudio ainda não gerada ou não encontrada.');
        }
    }

    // 5. API: Download ZIP Package
    if (pathname.startsWith('/api/download/')) {
        const jobId = pathname.replace('/api/download/', '');
        const zipFile = path.join(OUTPUT_DIR, `BrainAudiovisual_Package_${jobId}.zip`);

        if (fs.existsSync(zipFile)) {
            const stat = fs.statSync(zipFile);
            res.writeHead(200, {
                'Content-Type': 'application/zip',
                'Content-Length': stat.size,
                'Content-Disposition': `attachment; filename="BrainAudiovisual_Package_${jobId}.zip"`
            });
            fs.createReadStream(zipFile).pipe(res);
            return;
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('Arquivo ZIP não encontrado ou processamento ainda em andamento.');
        }
    }

    // 6. API: System Status & Diagnostic Check
    if (pathname === '/api/status') {
        let ffmpegOk = false;
        let ytdlpOk = false;
        try {
            await runCommand(`"${FFMPEG_BIN}"`, ['-version']);
            ffmpegOk = true;
        } catch (e) {}
        try {
            await runCommand(`"${YTDLP_BIN}"`, ['--version']);
            ytdlpOk = true;
        } catch (e) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            status: 'online',
            ffmpeg: ffmpegOk,
            ytdlp: ytdlpOk,
            ffmpegPath: FFMPEG_BIN,
            ytdlpPath: YTDLP_BIN,
            activeJobs: jobs.size
        }));
    }

    // 7. Static Files Serving (public/ directory)
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) {
        filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html; charset=UTF-8',
        '.css': 'text/css; charset=UTF-8',
        '.js': 'application/javascript; charset=UTF-8',
        '.json': 'application/json; charset=UTF-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File Not Found');
    }
});

server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` 🎬 BRAIN AUDIOVISUAL - AUDIOVISUAL EDITION (v1.0 Pro) `);
    console.log(` Servidor ativo em: http://localhost:${PORT}`);
    console.log(` FFmpeg detectado: ${FFMPEG_BIN}`);
    console.log(` yt-dlp detectado: ${YTDLP_BIN}`);
    console.log(`=======================================================`);
});
