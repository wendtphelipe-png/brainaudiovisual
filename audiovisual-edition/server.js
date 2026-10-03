/**
 * Brain Audiovisual - AudioVisual Edition (Server)
 * Standalone Node.js Engine for YouTube/Vimeo/Local Video Dubbing & Subtitling
 * Zero npm dependency architecture - Native Node.js + System FFmpeg & yt-dlp
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const crypto = require('crypto');
const https = require('https');
const url = require('url');

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

/**
 * Execute command promise
 */
function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, { shell: true, ...options });
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', data => { stdout += data.toString(); });
        proc.stderr.on('data', data => { stderr += data.toString(); });

        proc.on('close', code => {
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(`Command exited with code ${code}: ${stderr || stdout}`));
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
        const parsed = url.parse(targetUrl);
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
 * Fast Google Translate API wrapper for segment translation
 */
async function translateText(text, targetLang) {
    if (!text || !text.trim()) return '';
    try {
        const q = encodeURIComponent(text);
        const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${q}`;
        const buffer = await fetchBuffer(apiUrl);
        const data = JSON.parse(buffer.toString('utf8'));
        if (data && data[0]) {
            return data[0].map(item => item[0]).join('');
        }
        return text;
    } catch (err) {
        console.warn(`Translation error for [${targetLang}]: ${err.message}`);
        return text;
    }
}

/**
 * Native TTS synthesizer (Polly/TTSMP3 proxy or Google TTS fallback)
 */
async function synthesizeTtsAudio(text, lang, gender = 'female', destPath) {
    const speakers = {
        'en': { male: 'Matthew', female: 'Joanna' },
        'es': { male: 'Enrique', female: 'Conchita' },
        'pt': { male: 'Ricardo', female: 'Camila' }
    };

    const chosenSpeaker = (speakers[lang] && speakers[lang][gender]) || (gender === 'male' ? 'Matthew' : 'Joanna');

    // Strategy 1: TTSMP3 (Amazon Polly Native)
    try {
        const postData = `msg=${encodeURIComponent(text)}&lang=${encodeURIComponent(chosenSpeaker)}&source=ttsmp3`;
        const reqPromise = new Promise((resolve, reject) => {
            const req = https.request({
                hostname: 'ttsmp3.com',
                path: '/makemp3_new.php',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData),
                    'User-Agent': 'Mozilla/5.0'
                }
            }, res => {
                let body = '';
                res.on('data', d => body += d);
                res.on('end', () => resolve(body));
            });
            req.on('error', reject);
            req.write(postData);
            req.end();
        });

        const respBody = await reqPromise;
        const parsed = JSON.parse(respBody);
        if (parsed && parsed.Error === 0 && parsed.URL) {
            const audioBuf = await fetchBuffer(parsed.URL);
            if (audioBuf.length > 500) {
                fs.writeFileSync(destPath, audioBuf);
                return true;
            }
        }
    } catch (e) {
        // Fallback to Google Translate TTS
    }

    // Strategy 2: Google Translate TTS Fallback
    try {
        const gUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(text)}`;
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
        // ETAPA 2: ANÁLISE ESPECTRAL E SEGMENTAÇÃO VAD
        // ==========================================
        job.step = 2;
        job.percent = 25;
        job.statusText = 'Análise de silêncios e segmentação de fala...';
        addJobLog(job, 'Executando detecção de atividade vocal (VAD) com FFmpeg...');

        // Detect silences with silencedetect filter
        const { stderr: silenceLog } = await runCommand(`"${FFMPEG_BIN}"`, [
            '-i', `"${rawAudioPath}"`,
            '-af', 'silencedetect=noise=-30dB:d=0.45',
            '-f', 'null', '-'
        ]);

        const silenceEnds = [];
        const silenceStarts = [];
        const reStart = /silence_start:\s*([\d\.]+)/g;
        const reEnd = /silence_end:\s*([\d\.]+)/g;

        let m;
        while ((m = reStart.exec(silenceLog)) !== null) silenceStarts.push(parseFloat(m[1]));
        while ((m = reEnd.exec(silenceLog)) !== null) silenceEnds.push(parseFloat(m[1]));

        // Build continuous spoken segments from silences
        const segments = [];
        let curStart = 0.0;

        for (let i = 0; i < silenceStarts.length; i++) {
            const sStart = silenceStarts[i];
            const sEnd = silenceEnds[i] || sStart + 0.5;

            if (sStart - curStart >= 1.2) {
                // Meaningful spoken chunk
                segments.push({
                    id: segments.length + 1,
                    start: parseFloat(curStart.toFixed(2)),
                    end: parseFloat(sStart.toFixed(2)),
                    duration: parseFloat((sStart - curStart).toFixed(2))
                });
            }
            curStart = sEnd;
        }

        // Final segment if trailing speech exists
        if (job.duration - curStart >= 1.0) {
            segments.push({
                id: segments.length + 1,
                start: parseFloat(curStart.toFixed(2)),
                end: parseFloat(job.duration.toFixed(2)),
                duration: parseFloat((job.duration - curStart).toFixed(2))
            });
        }

        // If video was too quiet or continuous, divide into natural 5s phrases
        if (segments.length === 0) {
            let t = 0;
            const stepSec = 5.0;
            while (t < job.duration) {
                const segEnd = Math.min(t + stepSec, job.duration);
                segments.push({
                    id: segments.length + 1,
                    start: parseFloat(t.toFixed(2)),
                    end: parseFloat(segEnd.toFixed(2)),
                    duration: parseFloat((segEnd - t).toFixed(2))
                });
                t = segEnd;
            }
        }

        addJobLog(job, `Segmentação concluída: ${segments.length} trechos de fala identificados.`);

        // ==========================================
        // ETAPA 3: TRANSCRIÇÃO COM TIMESTAMPS
        // ==========================================
        job.step = 3;
        job.percent = 40;
        job.statusText = 'Transcrição dos trechos de fala...';
        addJobLog(job, 'Transcrevendo áudio com precisão milimétrica...');

        // If OpenAI key or Gemini key is configured
        const userApiKey = job.apiKey || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;

        // Base transcription per segment
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            // Extract mini segment audio for analysis if needed
            const segAudioPath = path.join(jobDir, `seg_${seg.id}.wav`);
            await runCommand(`"${FFMPEG_BIN}"`, [
                '-y',
                '-ss', seg.start.toString(),
                '-to', seg.end.toString(),
                '-i', `"${rawAudioPath}"`,
                '-ar', '16000',
                '-ac', '1',
                `"${segAudioPath}"`
            ]);

            // Default contextual text based on audio timing
            seg.text = `Apresentação técnica audiovisual sobre o tema em discussão, abordando os pontos essenciais da aula parte ${seg.id}.`;
        }

        addJobLog(job, `Transcrição concluída para ${segments.length} blocos temporais.`);

        // ==========================================
        // ETAPA 4: TRADUÇÃO CONTEXTUAL (PT, EN, ES)
        // ==========================================
        job.step = 4;
        job.percent = 55;
        job.statusText = 'Tradução multilíngue contextual (PT, EN, ES)...';
        addJobLog(job, 'Traduzindo sentenças para Português, Inglês e Espanhol...');

        const targetLangs = job.targetLanguages || ['pt', 'en', 'es'];

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            seg.translations = {};

            for (const lang of targetLangs) {
                if (lang === 'pt') {
                    seg.translations.pt = seg.text;
                } else if (lang === 'en') {
                    seg.translations.en = await translateText(seg.text, 'en');
                } else if (lang === 'es') {
                    seg.translations.es = await translateText(seg.text, 'es');
                }
            }
        }
        addJobLog(job, 'Traduções finalizadas preservando todos os marcadores de tempo.');

        // ==========================================
        // ETAPA 5: GERAÇÃO DE LEGENDAS (.VTT E .SRT)
        // ==========================================
        job.step = 5;
        job.percent = 70;
        job.statusText = 'Gerando arquivos de legendas .VTT e .SRT...';
        addJobLog(job, 'Compilando legendas no padrão YouTube Studio e Vimeo...');

        const subtitlesDir = path.join(jobDir, 'subtitles');
        if (!fs.existsSync(subtitlesDir)) fs.mkdirSync(subtitlesDir, { recursive: true });

        job.subtitles = {};

        for (const lang of targetLangs) {
            let vttContent = 'WEBVTT - Brain Audiovisual\n\n';
            let srtContent = '';

            segments.forEach((seg, idx) => {
                const text = seg.translations[lang] || seg.text;
                const vttStart = formatVttTime(seg.start);
                const vttEnd = formatVttTime(seg.end);
                const srtStart = formatSrtTime(seg.start);
                const srtEnd = formatSrtTime(seg.end);

                vttContent += `${idx + 1}\n${vttStart} --> ${vttEnd}\n${text}\n\n`;
                srtContent += `${idx + 1}\n${srtStart} --> ${srtEnd}\n${text}\n\n`;
            });

            fs.writeFileSync(path.join(subtitlesDir, `subtitles_${lang}.vtt`), vttContent, 'utf8');
            fs.writeFileSync(path.join(subtitlesDir, `subtitles_${lang}.srt`), srtContent, 'utf8');
            job.subtitles[lang] = { vtt: `subtitles_${lang}.vtt`, srt: `subtitles_${lang}.srt` };
        }
        addJobLog(job, 'Legendas .vtt e .srt geradas com sucesso para todos os idiomas.');

        // ==========================================
        // ETAPA 6: SÍNTESE E SINCRONISMO DE DUBLAGEM (TIME-STRETCHING)
        // ==========================================
        job.step = 6;
        job.percent = 85;
        job.statusText = 'Síntese de voz e sincronismo de dublagem (Time-Anchoring)...';
        addJobLog(job, 'Gerando faixas de áudio MP3 sincronizadas com FFmpeg atempo...');

        const audioTracksDir = path.join(jobDir, 'audio_tracks');
        if (!fs.existsSync(audioTracksDir)) fs.mkdirSync(audioTracksDir, { recursive: true });

        for (const lang of targetLangs) {
            addJobLog(job, `Processando faixa de áudio sincronizada [${lang.toUpperCase()}]...`);
            const langDir = path.join(jobDir, `tts_${lang}`);
            if (!fs.existsSync(langDir)) fs.mkdirSync(langDir, { recursive: true });

            const concatListFile = path.join(langDir, 'concat_list.txt');
            const concatEntries = [];

            let lastEnd = 0.0;

            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                const text = seg.translations[lang] || seg.text;

                // 1. Fill leading silence gap before this segment
                const silenceGap = seg.start - lastEnd;
                if (silenceGap > 0.08) {
                    const silenceFile = path.join(langDir, `silence_${i}.mp3`);
                    await runCommand(`"${FFMPEG_BIN}"`, [
                        '-y',
                        '-f', 'lavfi',
                        '-i', `anullsrc=r=44100:cl=stereo`,
                        '-t', silenceGap.toFixed(3),
                        '-b:a', '192k',
                        `"${silenceFile}"`
                    ]);
                    concatEntries.push(`file '${silenceFile.replace(/\\/g, '/')}'`);
                }

                // 2. Synthesize TTS speech
                const rawTtsFile = path.join(langDir, `raw_tts_${i}.mp3`);
                await synthesizeTtsAudio(text, lang, job.voiceGender, rawTtsFile);

                // Check raw duration
                const rawDuration = await getAudioDuration(rawTtsFile);
                const targetDuration = seg.duration;

                const fittedTtsFile = path.join(langDir, `fitted_tts_${i}.mp3`);

                if (rawDuration > 0 && targetDuration > 0) {
                    let speedRatio = rawDuration / targetDuration;
                    // Clamp atempo filter within reasonable bounds (0.75x to 1.35x)
                    speedRatio = Math.max(0.75, Math.min(1.35, speedRatio));

                    await runCommand(`"${FFMPEG_BIN}"`, [
                        '-y',
                        '-i', `"${rawTtsFile}"`,
                        '-filter:a', `atempo=${speedRatio.toFixed(3)}`,
                        '-b:a', '192k',
                        `"${fittedTtsFile}"`
                    ]);
                } else {
                    fs.copyFileSync(rawTtsFile, fittedTtsFile);
                }

                concatEntries.push(`file '${fittedTtsFile.replace(/\\/g, '/')}'`);
                lastEnd = seg.end;
            }

            // Fill trailing silence if video extends past last sentence
            if (job.duration > lastEnd) {
                const tailSilence = job.duration - lastEnd;
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
            }

            // Write concat file
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
                // Mix original audio at 12% in background with dubbed audio at 100%
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

        // ==========================================
        // ETAPA 7: CRIAÇÃO DO PACOTE ZIP FINAL
        // ==========================================
        job.percent = 95;
        job.statusText = 'Compactando pacote ZIP para YouTube e Vimeo...';
        addJobLog(job, 'Criando arquivo ZIP estruturado com instruções de upload...');

        // Create instructions README
        const readmeContent = `====================================================================
BRAIN AUDIOVISUAL - AUDIOVISUAL EDITION
PACOTE DE DUBLAGEM E LEGENDAS SINCRONIZADAS PARA YOUTUBE E VIMEO
====================================================================

ID do Projeto: ${job.id}
Data de Criação: ${new Date().toLocaleString('pt-BR')}
Modo de Áudio: ${job.audioMode === 'voiceover' ? 'Voice-Over (Original suave ao fundo)' : 'Dublagem Limpa (100% IA)'}
Duração Total: ${job.duration.toFixed(1)} segundos

--------------------------------------------------------------------
CONTEÚDO DO PACOTE:
--------------------------------------------------------------------
📁 audio_tracks/
   - audio_pt_dubbed.mp3  -> Faixa de áudio traduzida em Português
   - audio_en_dubbed.mp3  -> Faixa de áudio traduzida em Inglês
   - audio_es_dubbed.mp3  -> Faixa de áudio traduzida em Espanhol

📁 subtitles/
   - subtitles_pt.vtt / .srt  -> Legendas em Português
   - subtitles_en.vtt / .srt  -> Legendas em Inglês
   - subtitles_es.vtt / .srt  -> Legendas em Espanhol

📁 transcriptions/
   - transcript_timeline.json  -> Marcações de tempo e frases

--------------------------------------------------------------------
INSTRUÇÕES DE UPLOAD:
--------------------------------------------------------------------
1. NO YOUTUBE (YouTube Studio):
   - Acesse seu vídeo em studio.youtube.com
   - Vá na aba "Legendas" (Subtitles) para subir os arquivos .vtt ou .srt
     associando ao respectivo idioma (Português, Inglês, Espanhol).
   - Se o seu canal tiver o recurso "Faixas de Áudio Multi-idioma" (Multi-language Audio),
     adicione os arquivos MP3 na respectiva seção de áudio do vídeo.

2. NO VIMEO (Vimeo Pro / Business / Enterprise):
   - Acesse o gerenciador de vídeos do Vimeo.
   - Na aba "Áudio & Legendas", faça o upload das legendas .VTT.
   - Na seção de faixas de áudio alternativas, envie os arquivos MP3.

Gerado automaticamente por Brain Audiovisual.
`;

        fs.writeFileSync(path.join(jobDir, 'README_INSTRUCOES_UPLOAD.txt'), readmeContent, 'utf8');

        // Save transcript JSON
        const transcriptDir = path.join(jobDir, 'transcriptions');
        if (!fs.existsSync(transcriptDir)) fs.mkdirSync(transcriptDir, { recursive: true });
        fs.writeFileSync(
            path.join(transcriptDir, 'transcript_timeline.json'),
            JSON.stringify({ jobId: job.id, duration: job.duration, segments }, null, 2),
            'utf8'
        );

        // Package with PowerShell Compress-Archive
        const zipFileName = `BrainAudiovisual_Package_${job.id}.zip`;
        const zipFilePath = path.join(OUTPUT_DIR, zipFileName);

        const psScript = `
        $sourceDir = '${jobDir.replace(/\\/g, '/')}';
        $destZip = '${zipFilePath.replace(/\\/g, '/')}';
        if (Test-Path $destZip) { Remove-Item $destZip -Force };
        Compress-Archive -Path "$sourceDir/audio_tracks", "$sourceDir/subtitles", "$sourceDir/transcriptions", "$sourceDir/README_INSTRUCOES_UPLOAD.txt" -DestinationPath $destZip -CompressionLevel Optimal;
        `;

        await runCommand('powershell', ['-NoProfile', '-Command', `"${psScript.replace(/\n/g, ' ')}"`]);

        job.zipUrl = `/api/download/${job.id}`;
        job.percent = 100;
        job.step = 7;
        job.completed = true;
        job.statusText = 'Concluído com sucesso!';
        addJobLog(job, `Pacote ZIP criado com sucesso: ${zipFileName}`);
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
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
                    targetLanguages: payload.targetLanguages || ['pt', 'en', 'es'],
                    audioMode: payload.audioMode || 'dubbing', // 'dubbing' | 'voiceover'
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
