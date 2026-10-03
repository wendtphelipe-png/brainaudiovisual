/**
 * Brain Audiovisual - AudioVisual Edition (Client Logic PRO)
 * Batch Queue, Parallel Multiprocessing, Hardware Monitor & Crash Recovery
 */

let currentIngestTab = 'links';
let queueEventSource = null;
let currentQueue = {
    concurrency: 2,
    outputDir: 'D:\\downloads\\BrainAudiovisual_Saida',
    generateDubbedAudio: false,
    isProcessing: false,
    items: []
};

let extractedVideosCache = [];

// Stopwatch state
let stopwatchStartTime = null;
let stopwatchElapsedTime = 0;
let stopwatchInterval = null;

let currentTheme = localStorage.getItem('brain_av_theme') || 'light';

function applyTheme(theme) {
    currentTheme = theme;
    try { localStorage.setItem('brain_av_theme', theme); } catch (_) {}
    const icon = document.getElementById('themeToggleIcon');
    const text = document.getElementById('themeToggleText');

    if (theme === 'dark') {
        document.body.classList.remove('light-theme');
        document.body.classList.add('dark-theme');
        if (icon) icon.innerText = '☀️';
        if (text) text.innerText = 'Modo Claro';
    } else {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
        if (icon) icon.innerText = '🌙';
        if (text) text.innerText = 'Modo Escuro';
    }
}

function toggleTheme() {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

document.addEventListener('DOMContentLoaded', () => {
    applyTheme(currentTheme);
    initQueueStream();
    startHardwareMonitor();
    setupQueueDropzone();
});

// ==========================================
// 1. HARDWARE RESOURCE MONITOR & STOPWATCH
// ==========================================
function startHardwareMonitor() {
    updateSystemStats();
    setInterval(updateSystemStats, 1500);
}

async function updateSystemStats() {
    try {
        const res = await fetch('/api/system-stats');
        const data = await res.json();
        if (!data.success) return;

        // CPU
        if (data.cpu) {
            const cpuVal = data.cpu.usagePercent || 0;
            const cpuModelShort = (data.cpu.model || 'CPU').split(' ')[0] + ' ' + (data.cpu.cores ? `${data.cpu.cores}C` : '');
            document.getElementById('cpuModel').innerText = cpuModelShort;
            document.getElementById('cpuVal').innerText = `${cpuVal}%`;
            document.getElementById('cpuBar').style.width = `${cpuVal}%`;
            document.getElementById('cpuBar').className = 'monitor-bar-fill' + (cpuVal > 85 ? ' high' : (cpuVal > 50 ? ' mid' : ''));
        }

        // GPU
        if (data.gpu && data.gpu.available) {
            const gpuVal = data.gpu.usagePercent || 0;
            const gpuShortName = (data.gpu.name || 'GPU').replace('NVIDIA GeForce ', '');
            document.getElementById('gpuModel').innerText = gpuShortName;
            document.getElementById('gpuVal').innerText = `${gpuVal}%`;
            document.getElementById('gpuBar').style.width = `${gpuVal}%`;
            document.getElementById('gpuBar').className = 'monitor-bar-fill' + (gpuVal > 85 ? ' high' : (gpuVal > 50 ? ' mid' : ''));
        } else {
            document.getElementById('gpuModel').innerText = 'GPU Integrada/N-A';
            document.getElementById('gpuVal').innerText = '0%';
            document.getElementById('gpuBar').style.width = '0%';
        }

        // RAM
        if (data.ram) {
            const ramVal = data.ram.usagePercent || 0;
            document.getElementById('ramVal').innerText = `${ramVal}% (${data.ram.usedGb}GB)`;
            document.getElementById('ramBar').style.width = `${ramVal}%`;
            document.getElementById('ramBar').className = 'monitor-bar-fill' + (ramVal > 85 ? ' high' : (ramVal > 60 ? ' mid' : ''));
        }

        // Engines status
        const ffmpegEl = document.getElementById('ffmpegStatus');
        const ytdlpEl = document.getElementById('ytdlpStatus');
        if (data.ffmpeg) {
            ffmpegEl.innerHTML = `<span class="status-dot active"></span><span>FFmpeg 7.1 Ativo</span>`;
        } else {
            ffmpegEl.innerHTML = `<span class="status-dot error"></span><span>FFmpeg Ausente</span>`;
        }
        if (data.ytdlp) {
            ytdlpEl.innerHTML = `<span class="status-dot active"></span><span>yt-dlp Engine Ativo</span>`;
        } else {
            ytdlpEl.innerHTML = `<span class="status-dot error"></span><span>yt-dlp Ausente</span>`;
        }

    } catch (e) {
        // Fallback silently if offline briefly
    }
}

function updateStopwatch() {
    const totalMs = stopwatchElapsedTime + (stopwatchStartTime ? (Date.now() - stopwatchStartTime) : 0);
    const totalSecs = Math.floor(totalMs / 1000);
    const hours = String(Math.floor(totalSecs / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, '0');
    const seconds = String(totalSecs % 60).padStart(2, '0');
    document.getElementById('stopwatchVal').innerText = `${hours}:${minutes}:${seconds}`;
}

function startStopwatch() {
    if (!stopwatchInterval) {
        stopwatchStartTime = Date.now();
        stopwatchInterval = setInterval(updateStopwatch, 500);
        document.getElementById('stopwatchStatus').innerText = 'Em processamento...';
        document.getElementById('stopwatchStatus').style.color = 'var(--primary-cyan)';
    }
}

function pauseStopwatch() {
    if (stopwatchInterval) {
        clearInterval(stopwatchInterval);
        stopwatchInterval = null;
        if (stopwatchStartTime) {
            stopwatchElapsedTime += (Date.now() - stopwatchStartTime);
            stopwatchStartTime = null;
        }
        document.getElementById('stopwatchStatus').innerText = 'Pausado';
        document.getElementById('stopwatchStatus').style.color = 'var(--text-muted)';
        updateStopwatch();
    }
}

// ==========================================
// 2. QUEUE STREAM & REAL-TIME SYNC (SSE)
// ==========================================
function initQueueStream() {
    if (queueEventSource) {
        try { queueEventSource.close(); } catch (_) {}
    }

    queueEventSource = new EventSource('/api/queue/stream');

    queueEventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleQueueUpdate(data);
        } catch (e) {
            console.error('Error parsing queue stream data:', e);
        }
    };

    queueEventSource.onerror = () => {
        // Fallback polling if SSE disconnects
        setTimeout(fetchQueueState, 3000);
    };

    // Initial fetch
    fetchQueueState();
}

async function fetchQueueState() {
    try {
        const res = await fetch('/api/queue');
        const data = await res.json();
        if (data.success) {
            handleQueueUpdate(data);
        }
    } catch (_) {}
}

function handleQueueUpdate(state) {
    currentQueue = state;

    // Sync input controls if not currently focused
    const destInput = document.getElementById('destinationFolderInput');
    if (destInput && document.activeElement !== destInput && state.outputDir) {
        destInput.value = state.outputDir;
    }

    const concurrencySelect = document.getElementById('concurrencySelect');
    if (concurrencySelect && state.concurrency) {
        concurrencySelect.value = String(state.concurrency);
    }

    const dubbedToggle = document.getElementById('generateDubbedAudioToggle');
    if (dubbedToggle) {
        dubbedToggle.checked = !!state.generateDubbedAudio;
    }

    // Toggle Start/Pause buttons
    const startBtn = document.getElementById('startQueueBtn');
    const pauseBtn = document.getElementById('pauseQueueBtn');

    if (state.isProcessing) {
        startBtn.style.display = 'none';
        pauseBtn.style.display = 'inline-flex';
        startStopwatch();
    } else {
        startBtn.style.display = 'inline-flex';
        pauseBtn.style.display = 'none';
        
        // If nothing is active, check if finished
        const hasActive = (state.items || []).some(i => i.status === 'processing');
        if (!hasActive) {
            pauseStopwatch();
        }
    }

    // Render badges
    const items = state.items || [];
    const totalCount = items.length;
    const queuedCount = items.filter(i => i.status === 'queued').length;
    const processingCount = items.filter(i => i.status === 'processing').length;
    const completedCount = items.filter(i => i.status === 'completed').length;

    document.getElementById('badgeTotal').innerText = `${totalCount} Total`;
    document.getElementById('badgeQueued').innerText = `${queuedCount} Na fila`;
    document.getElementById('badgeProcessing').innerText = `${processingCount} Processando`;
    document.getElementById('badgeCompleted').innerText = `${completedCount} Concluídos`;

    renderQueueItems(items);
}

// ==========================================
// 3. QUEUE RENDERING WITH INDIVIDUAL PROGRESS BARS
// ==========================================
function renderQueueItems(items) {
    const container = document.getElementById('queueItemsList');
    const emptyState = document.getElementById('queueEmptyState');

    if (!items || items.length === 0) {
        emptyState.style.display = 'flex';
        // Remove old cards
        const cards = container.querySelectorAll('.queue-item-card');
        cards.forEach(c => c.remove());
        return;
    }

    emptyState.style.display = 'none';

    // Preserve existing cards to avoid layout jitter, or create/update them
    const existingCards = new Map();
    container.querySelectorAll('.queue-item-card').forEach(el => {
        existingCards.set(el.getAttribute('data-id'), el);
    });

    // Remove cards no longer in items
    const currentIds = new Set(items.map(i => i.id));
    for (const [id, el] of existingCards.entries()) {
        if (!currentIds.has(id)) {
            el.remove();
        }
    }

    // Update or insert each item card in order
    items.forEach((item, index) => {
        let card = existingCards.get(item.id);
        const isNew = !card;

        if (isNew) {
            card = document.createElement('div');
            card.className = `queue-item-card status-${item.status}`;
            card.setAttribute('data-id', item.id);
            container.appendChild(card);
        } else {
            card.className = `queue-item-card status-${item.status}`;
        }

        // Status badge configuration
        let badgeHtml = '';
        if (item.status === 'queued') {
            badgeHtml = `<span class="item-badge badge-queued">Na fila #${index + 1}</span>`;
        } else if (item.status === 'processing') {
            badgeHtml = `<span class="item-badge badge-processing"><span class="pulse-dot"></span>Processando...</span>`;
        } else if (item.status === 'completed') {
            badgeHtml = `<span class="item-badge badge-completed">✅ Concluído</span>`;
        } else if (item.status === 'error') {
            badgeHtml = `<span class="item-badge badge-error">❌ Erro</span>`;
        }

        const percent = Math.min(100, Math.max(0, item.percent || 0));
        const statusText = item.statusText || (item.status === 'queued' ? 'Aguardando vez na esteira...' : '');

        // Action buttons
        let actionsHtml = '';
        if (item.status === 'completed') {
            actionsHtml = `
                <button type="button" class="btn-card-action btn-open-dest" onclick="openItemDestination('${item.id}')" title="Abrir pasta onde o vídeo foi salvo">
                    📂 Abrir Pasta
                </button>
                ${item.zipUrl ? `<a href="${item.zipUrl}" class="btn-card-action btn-download-zip" download title="Baixar Pacote ZIP">📥 Baixar ZIP</a>` : ''}
                <button type="button" class="btn-card-action btn-retry" onclick="retryQueueItem('${item.id}')" title="Reprocessar este vídeo">🔄</button>
                <button type="button" class="btn-card-action btn-remove" onclick="removeQueueItem('${item.id}')" title="Remover da lista">✕</button>
            `;
        } else if (item.status === 'error') {
            actionsHtml = `
                <button type="button" class="btn-card-action btn-retry" onclick="retryQueueItem('${item.id}')">🔄 Tentar Novamente</button>
                <button type="button" class="btn-card-action btn-remove" onclick="removeQueueItem('${item.id}')">✕</button>
            `;
        } else if (item.status === 'processing') {
            actionsHtml = `
                <span class="active-processing-indicator">Executando etapa ${item.step || 1}/7...</span>
            `;
        } else { // queued
            actionsHtml = `
                <button type="button" class="btn-card-action btn-remove" onclick="removeQueueItem('${item.id}')" title="Remover da fila">✕</button>
            `;
        }

        card.innerHTML = `
            <div class="card-top-row">
                <div class="card-title-group">
                    <span class="card-icon">${item.sourceType === 'file' ? '📁' : '🎬'}</span>
                    <div class="card-title-text" title="${escapeHtml(item.title || item.url)}">
                        ${escapeHtml(item.title || item.url)}
                    </div>
                </div>
                <div class="card-badges">
                    ${badgeHtml}
                </div>
            </div>

            <!-- INDIVIDUAL PROGRESS BAR -->
            <div class="card-progress-section">
                <div class="card-progress-track">
                    <div class="card-progress-fill ${item.status}" style="width: ${percent}%"></div>
                </div>
                <div class="card-progress-labels">
                    <span class="card-status-text">${escapeHtml(statusText)}</span>
                    <span class="card-percent">${percent}%</span>
                </div>
            </div>

            <div class="card-footer-row">
                <div class="card-meta">
                    ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" class="card-url-link">🔗 Ver link original</a>` : ''}
                    ${item.outputPath ? `<span class="card-saved-path" title="${escapeHtml(item.outputPath)}">💾 Salvo em: ${escapeHtml(item.outputPath.split('\\').pop())}</span>` : ''}
                </div>
                <div class="card-actions">
                    ${actionsHtml}
                </div>
            </div>
        `;
    });
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ==========================================
// 4. QUEUE CONTROLS & API ACTIONS
// ==========================================
async function saveQueueSettings() {
    const destInput = document.getElementById('destinationFolderInput').value.trim();
    const concurrency = parseInt(document.getElementById('concurrencySelect').value, 10) || 2;
    const generateDubbedAudio = document.getElementById('generateDubbedAudioToggle').checked;

    const targetLangs = ['pt'];
    if (document.getElementById('queueLangEn').checked) targetLangs.push('en');
    if (document.getElementById('queueLangEs').checked) targetLangs.push('es');

    try {
        const res = await fetch('/api/queue/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                outputDir: destInput,
                concurrency,
                generateDubbedAudio,
                targetLanguages: targetLangs
            })
        });
        const data = await res.json();
        if (data.success) {
            appendLog(`Configurações salvas: Concorrência=${concurrency}, Dublagem=${generateDubbedAudio ? 'Sim' : 'Não (Rápido)'}, Destino=${destInput}`);
        }
    } catch (e) {
        console.error('Error saving queue settings:', e);
    }
}

async function openRootDestinationFolder() {
    const destInput = document.getElementById('destinationFolderInput').value.trim();
    try {
        await fetch('/api/open-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath: destInput })
        });
        appendLog(`Abrindo pasta no Windows Explorer: ${destInput}`);
    } catch (e) {
        alert('Erro ao abrir pasta: ' + e.message);
    }
}

async function openItemDestination(itemId) {
    const item = (currentQueue.items || []).find(i => i.id === itemId);
    const folder = (item && item.outputPath) ? item.outputPath : currentQueue.outputDir;
    try {
        await fetch('/api/open-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath: folder })
        });
    } catch (e) {
        alert('Erro ao abrir pasta do item: ' + e.message);
    }
}

async function startQueueExecution() {
    await saveQueueSettings();
    try {
        const res = await fetch('/api/queue/start', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            appendLog('▶️ Esteira de processamento iniciada!');
            fetchQueueState();
        }
    } catch (e) {
        alert('Erro ao iniciar fila: ' + e.message);
    }
}

async function pauseQueueExecution() {
    try {
        const res = await fetch('/api/queue/pause', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            appendLog('⏸️ Esteira de processamento pausada.');
            fetchQueueState();
        }
    } catch (e) {
        alert('Erro ao pausar fila: ' + e.message);
    }
}

async function clearCompletedQueue() {
    try {
        await fetch('/api/queue/clear-completed', { method: 'POST' });
        appendLog('Itens concluídos limpos da mesa.');
        fetchQueueState();
    } catch (e) {
        console.error(e);
    }
}

async function clearAllQueue() {
    if (!confirm('Deseja realmente limpar todos os itens da fila que não estejam em processamento?')) return;
    try {
        await fetch('/api/queue/clear-all', { method: 'POST' });
        appendLog('Fila de vídeos reiniciada.');
        fetchQueueState();
    } catch (e) {
        console.error(e);
    }
}

async function removeQueueItem(id) {
    try {
        await fetch('/api/queue/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        fetchQueueState();
    } catch (e) {
        console.error(e);
    }
}

async function retryQueueItem(id) {
    try {
        await fetch('/api/queue/retry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        appendLog(`Item ${id} re-enfileirado para processamento.`);
        fetchQueueState();
    } catch (e) {
        console.error(e);
    }
}

// ==========================================
// 5. INGESTION TAB: BATCH LINKS
// ==========================================
function switchIngestTab(tab) {
    currentIngestTab = tab;
    document.getElementById('tabBatchLinksBtn').classList.toggle('active', tab === 'links');
    document.getElementById('tabPlaylistBtn').classList.toggle('active', tab === 'playlist');
    document.getElementById('tabFilesBtn').classList.toggle('active', tab === 'files');

    document.getElementById('tabContentLinks').classList.toggle('active', tab === 'links');
    document.getElementById('tabContentPlaylist').classList.toggle('active', tab === 'playlist');
    document.getElementById('tabContentFiles').classList.toggle('active', tab === 'files');
}

async function pasteLinksToTextarea() {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            const current = document.getElementById('batchUrlsInput').value;
            document.getElementById('batchUrlsInput').value = (current ? current + '\n' : '') + text.trim();
        }
    } catch (_) {
        alert('Cole os links usando Ctrl+V no campo de texto.');
    }
}

async function addBatchLinksToQueue() {
    const rawText = document.getElementById('batchUrlsInput').value.trim();
    if (!rawText) {
        alert('Por favor, cole ao menos um link de vídeo.');
        return;
    }

    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && l.startsWith('http'));
    if (lines.length === 0) {
        alert('Nenhum link válido (iniciando com http/https) foi encontrado.');
        return;
    }

    const cookieData = document.getElementById('batchCookieInput').value.trim();

    try {
        const res = await fetch('/api/queue/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                urls: lines,
                cookieData
            })
        });
        const data = await res.json();
        if (data.success) {
            appendLog(`➕ ${data.addedCount} vídeo(s) adicionado(s) à fila com sucesso!`);
            document.getElementById('batchUrlsInput').value = '';
            fetchQueueState();
        } else {
            alert('Erro ao adicionar à fila: ' + data.error);
        }
    } catch (e) {
        alert('Erro ao conectar com o servidor: ' + e.message);
    }
}

// ==========================================
// 6. INGESTION TAB: PLAYLIST / SHOWCASE IMPORTER
// ==========================================
async function pastePlaylistUrl() {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            document.getElementById('playlistUrlInput').value = text.trim();
        }
    } catch (_) {
        alert('Cole o link usando Ctrl+V.');
    }
}

async function extractPlaylistVideos() {
    const url = document.getElementById('playlistUrlInput').value.trim();
    if (!url) {
        alert('Por favor, informe a URL da playlist do YouTube ou Showcase/Pasta do Vimeo.');
        return;
    }

    const btn = document.getElementById('extractPlaylistBtn');
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner"></span> <span>Analisando pasta e extraindo vídeos...</span>`;
    appendLog(`Extraindo vídeos da playlist: ${url}...`);

    try {
        const cookieData = (document.getElementById('playlistCookieInput') ? document.getElementById('playlistCookieInput').value.trim() : '') || (document.getElementById('batchCookieInput') ? document.getElementById('batchCookieInput').value.trim() : '');
        const res = await fetch('/api/extract-playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, cookieData })
        });
        const data = await res.json();

        if (!data.success) throw new Error(data.error || 'Falha ao extrair playlist');

        extractedVideosCache = data.videos || [];
        appendLog(`Sucesso! ${extractedVideosCache.length} vídeos identificados na pasta.`);

        renderExtractedVideosList(extractedVideosCache);

    } catch (e) {
        alert('Erro ao extrair playlist: ' + e.message);
        appendLog(`Erro na extração da playlist: ${e.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span>PUXAR TODOS OS VÍDEOS DA PASTA</span>`;
    }
}

function renderExtractedVideosList(videos) {
    const wrap = document.getElementById('extractedPreviewWrap');
    const container = document.getElementById('extractedListContainer');
    const countTitle = document.getElementById('extractedCountTitle');

    if (!videos || videos.length === 0) {
        wrap.style.display = 'none';
        alert('Nenhum vídeo encontrado nesta playlist ou pasta.');
        return;
    }

    countTitle.innerText = `${videos.length} vídeo(s) encontrado(s)`;
    wrap.style.display = 'block';

    container.innerHTML = videos.map((v, i) => `
        <label class="extracted-item-row">
            <input type="checkbox" class="extracted-cb" data-index="${i}" checked>
            <span class="extracted-num">#${i + 1}</span>
            <span class="extracted-title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</span>
            <span class="extracted-link-preview">${escapeHtml(v.url)}</span>
        </label>
    `).join('');
}

let allExtractedSelected = true;
function toggleSelectAllExtracted() {
    allExtractedSelected = !allExtractedSelected;
    const cbs = document.querySelectorAll('.extracted-cb');
    cbs.forEach(cb => cb.checked = allExtractedSelected);
}

async function addSelectedExtractedToQueue() {
    const cbs = document.querySelectorAll('.extracted-cb:checked');
    if (cbs.length === 0) {
        alert('Selecione ao menos um vídeo para adicionar à fila.');
        return;
    }

    const cookieData = (document.getElementById('playlistCookieInput') ? document.getElementById('playlistCookieInput').value.trim() : '') || (document.getElementById('batchCookieInput') ? document.getElementById('batchCookieInput').value.trim() : '');
    const itemsToAdd = [];
    cbs.forEach(cb => {
        const idx = parseInt(cb.getAttribute('data-index'), 10);
        const video = extractedVideosCache[idx];
        if (video) {
            itemsToAdd.push({
                url: video.url,
                title: video.title,
                cookieData: cookieData
            });
        }
    });

    try {
        const res = await fetch('/api/queue/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: itemsToAdd })
        });
        const data = await res.json();
        if (data.success) {
            appendLog(`➕ ${data.addedCount} vídeos da playlist adicionados à fila!`);
            document.getElementById('extractedPreviewWrap').style.display = 'none';
            document.getElementById('playlistUrlInput').value = '';
            fetchQueueState();
        }
    } catch (e) {
        alert('Erro ao adicionar à fila: ' + e.message);
    }
}

// ==========================================
// 7. INGESTION TAB: LOCAL FILE DRAG & DROP
// ==========================================
function setupQueueDropzone() {
    const dropzone = document.getElementById('queueDropzone');
    if (!dropzone) return;

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
        handleQueueFilesSelected(files);
    });
}

async function handleQueueFilesSelected(files) {
    if (!files || files.length === 0) return;

    appendLog(`Enviando ${files.length} arquivo(s) local(is) para a fila...`);

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        appendLog(`Upload de arquivo ${i + 1}/${files.length}: ${file.name}...`);

        try {
            const uploadRes = await fetch('/api/upload', {
                method: 'POST',
                headers: {
                    'Content-Type': file.type || 'application/octet-stream',
                    'X-File-Name': encodeURIComponent(file.name)
                },
                body: file
            });
            const uploadData = await uploadRes.json();
            if (!uploadData.success) throw new Error(uploadData.error || 'Erro no upload');

            await fetch('/api/queue/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: [{
                        sourceType: 'file',
                        title: file.name,
                        uploadedFilePath: uploadData.uploadedFilePath,
                        uploadedFileName: file.name
                    }]
                })
            });

            appendLog(`Arquivo ${file.name} inserido na fila.`);
        } catch (e) {
            appendLog(`Erro no upload de ${file.name}: ${e.message}`, 'error');
        }
    }

    fetchQueueState();
}

// ==========================================
// 8. LOGS HELPER
// ==========================================
function clearLogs() {
    const terminal = document.getElementById('terminalLogs');
    if (terminal) terminal.innerHTML = '';
}

function appendLog(message, type = 'info') {
    const terminal = document.getElementById('terminalLogs');
    if (!terminal) return;
    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    const time = new Date().toLocaleTimeString('pt-BR');
    line.innerHTML = `<span class="log-time">[${time}]</span> ${escapeHtml(message)}`;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
}
