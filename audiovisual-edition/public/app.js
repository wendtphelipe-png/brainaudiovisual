/**
 * Brain Audiovisual - AudioVisual Edition (Client Logic)
 */

let currentSourceTab = 'url';
let selectedLocalFile = null;
let currentJobId = null;
let currentEventSource = null;
let activeAudioTracks = {};

document.addEventListener('DOMContentLoaded', () => {
    checkSystemStatus();
    setupDropzone();
});

// Check FFmpeg and yt-dlp status
async function checkSystemStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        
        const ffmpegEl = document.getElementById('ffmpegStatus');
        const ytdlpEl = document.getElementById('ytdlpStatus');

        if (data.ffmpeg) {
            ffmpegEl.innerHTML = `<span class="status-dot active"></span><span>FFmpeg 7.1 Ativo</span>`;
        } else {
            ffmpegEl.innerHTML = `<span class="status-dot" style="background:#ef4444"></span><span>FFmpeg Não Encontrado</span>`;
        }

        if (data.ytdlp) {
            ytdlpEl.innerHTML = `<span class="status-dot active"></span><span>yt-dlp Ativo</span>`;
        } else {
            ytdlpEl.innerHTML = `<span class="status-dot" style="background:#ef4444"></span><span>yt-dlp Não Encontrado</span>`;
        }
    } catch (e) {
        console.warn('Status check failed:', e);
    }
}

// Switch tabs: Link vs File
function switchSourceTab(tab) {
    currentSourceTab = tab;
    document.getElementById('tabUrlBtn').classList.toggle('active', tab === 'url');
    document.getElementById('tabFileBtn').classList.toggle('active', tab === 'file');
    document.getElementById('urlTabContent').classList.toggle('active', tab === 'url');
    document.getElementById('fileTabContent').classList.toggle('active', tab === 'file');
}

// Clipboard helper
async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            document.getElementById('videoUrl').value = text;
        }
    } catch (err) {
        alert('Por favor, permita o acesso à área de transferência ou cole manualmente (Ctrl+V).');
    }
}

// Dropzone file handling
function setupDropzone() {
    const dropzone = document.getElementById('dropzone');
    
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dragover');
        }, false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFileSelected(files);
    });
}

function handleFileSelected(files) {
    if (!files || files.length === 0) return;
    const file = files[0];
    selectedLocalFile = file;

    document.getElementById('selectedFileName').innerText = file.name;
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    document.getElementById('selectedFileSize').innerText = `${sizeMb} MB`;

    document.getElementById('dropzone').style.display = 'none';
    document.getElementById('selectedFileInfo').style.display = 'flex';
}

function removeSelectedFile() {
    selectedLocalFile = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('dropzone').style.display = 'block';
    document.getElementById('selectedFileInfo').style.display = 'none';
}

function clearLogs() {
    document.getElementById('terminalLogs').innerHTML = '';
}

function appendLog(message, type = 'info') {
    const terminal = document.getElementById('terminalLogs');
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    const time = new Date().toLocaleTimeString('pt-BR');
    line.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}

// Main processing start
async function startProcessing() {
    const startBtn = document.getElementById('startBtn');
    const audioMode = document.querySelector('input[name="audioMode"]:checked').value;
    const voiceGender = document.getElementById('voiceGender').value;
    
    // Languages selection
    const targetLangs = ['pt'];
    if (document.getElementById('langEn').checked) targetLangs.push('en');
    if (document.getElementById('langEs').checked) targetLangs.push('es');

    let payload = {
        sourceType: currentSourceTab,
        audioMode,
        voiceGender,
        targetLanguages: targetLangs
    };

    if (currentSourceTab === 'url') {
        const videoUrl = document.getElementById('videoUrl').value.trim();
        if (!videoUrl) {
            alert('Por favor, informe a URL do YouTube ou Vimeo.');
            return;
        }
        payload.url = videoUrl;
        payload.cookieData = document.getElementById('cookieInput').value.trim();
    } else {
        if (!selectedLocalFile) {
            alert('Por favor, selecione um arquivo de vídeo ou áudio do computador.');
            return;
        }
        appendLog(`Enviando arquivo local: ${selectedLocalFile.name}...`, 'info');
        startBtn.disabled = true;

        try {
            // Direct streaming upload
            const uploadRes = await fetch('/api/upload', {
                method: 'POST',
                headers: {
                    'Content-Type': selectedLocalFile.type || 'application/octet-stream',
                    'X-File-Name': encodeURIComponent(selectedLocalFile.name)
                },
                body: selectedLocalFile
            });
            const uploadData = await uploadRes.json();
            if (!uploadData.success) throw new Error(uploadData.error || 'Erro no upload');
            
            payload.uploadedFilePath = uploadData.uploadedFilePath;
            payload.uploadedFileName = selectedLocalFile.name;
            appendLog('Upload concluído com sucesso. Iniciando pipeline...', 'info');
        } catch (err) {
            alert('Falha ao enviar arquivo local: ' + err.message);
            startBtn.disabled = false;
            return;
        }
    }

    startBtn.disabled = true;
    resetUIForNewJob();

    try {
        appendLog('Criando nova solicitação de job de áudio...', 'info');
        const res = await fetch('/api/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        currentJobId = data.jobId;
        appendLog(`Job registrado com sucesso! ID: ${currentJobId}`, 'info');

        // Connect SSE live stream
        connectLiveStream(currentJobId);

    } catch (err) {
        alert('Erro ao iniciar processamento: ' + err.message);
        startBtn.disabled = false;
    }
}

function resetUIForNewJob() {
    // Reset steps
    for (let i = 1; i <= 6; i++) {
        const el = document.getElementById(`step${i}`);
        el.className = 'step-item';
    }
    document.getElementById('step1').classList.add('active');
    document.getElementById('progressBarFill').style.width = '0%';
    document.getElementById('percentLabel').innerText = '0%';
    document.getElementById('statusMessage').innerText = 'Iniciando pipeline...';
    document.getElementById('previewCard').style.display = 'none';
    document.getElementById('downloadCard').style.display = 'none';
}

function connectLiveStream(jobId) {
    if (currentEventSource) {
        currentEventSource.close();
    }

    currentEventSource = new EventSource(`/api/progress/${jobId}`);

    currentEventSource.addEventListener('progress', (e) => {
        const data = JSON.parse(e.data);
        updateProgressUI(data);
    });

    currentEventSource.onerror = (e) => {
        console.warn('SSE connection error:', e);
    };
}

function updateProgressUI(data) {
    // Progress bar and labels
    document.getElementById('progressBarFill').style.width = `${data.percent}%`;
    document.getElementById('percentLabel').innerText = `${data.percent}%`;
    if (data.statusText) {
        document.getElementById('statusMessage').innerText = data.statusText;
    }

    // Stepper updates
    for (let i = 1; i <= 6; i++) {
        const stepEl = document.getElementById(`step${i}`);
        if (i < data.step) {
            stepEl.className = 'step-item completed';
        } else if (i === data.step) {
            stepEl.className = 'step-item active';
        } else {
            stepEl.className = 'step-item';
        }
    }

    // Terminal logs
    if (data.logs && data.logs.length > 0) {
        const terminal = document.getElementById('terminalLogs');
        terminal.innerHTML = '';
        data.logs.forEach(log => {
            const line = document.createElement('div');
            line.className = `log-line ${log.type || 'info'}`;
            line.innerHTML = `<span class="log-time">[${log.timestamp}]</span> ${log.message}`;
            terminal.appendChild(line);
        });
        terminal.scrollTop = terminal.scrollHeight;
    }

    // If audio tracks are ready, unlock player
    if (data.tracks && Object.keys(data.tracks).length > 0) {
        activeAudioTracks = data.tracks;
        const previewCard = document.getElementById('previewCard');
        if (previewCard.style.display === 'none') {
            previewCard.style.display = 'block';
            switchAudioTrack('original');
        }
    }

    // If completed
    if (data.completed) {
        document.getElementById('startBtn').disabled = false;
        document.getElementById('downloadCard').style.display = 'flex';
        document.getElementById('downloadZipBtn').href = data.zipUrl;
        if (currentEventSource) {
            currentEventSource.close();
        }
    }

    // If error
    if (data.error) {
        document.getElementById('startBtn').disabled = false;
        document.getElementById('statusMessage').innerText = `Erro: ${data.error}`;
        document.getElementById('statusMessage').style.color = '#ef4444';
        if (currentEventSource) {
            currentEventSource.close();
        }
    }
}

// Audio player track switching
function switchAudioTrack(trackKey) {
    const tabs = document.querySelectorAll('.track-tab');
    tabs.forEach(tab => tab.classList.remove('active'));

    const activeTab = Array.from(tabs).find(t => t.innerText.toLowerCase().includes(trackKey.toLowerCase()));
    if (activeTab) activeTab.classList.add('active');

    const player = document.getElementById('audioPreviewPlayer');
    const trackUrl = activeAudioTracks[trackKey];
    if (trackUrl) {
        player.src = trackUrl;
        player.play().catch(() => {});
    } else {
        alert('Esta faixa ainda está sendo processada ou não foi selecionada.');
    }
}
