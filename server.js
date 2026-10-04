const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = 8765;
const BASE = __dirname;

const server = http.createServer((req, res) => {
  // 1. Endpoint de API para alternância de dispositivo de áudio no Windows
  if (req.url.startsWith('/api/set-audio-device')) {
    const urlObj = new URL(req.url, 'http://127.0.0.1:8765');
    const target = urlObj.searchParams.get('device') || 'cable';
    const psCmd = (target === 'mic')
      ? 'Import-Module AudioDeviceCmdlets -ErrorAction SilentlyContinue; Set-AudioDevice -Index 6; Get-AudioDevice -Recording'
      : 'Import-Module AudioDeviceCmdlets -ErrorAction SilentlyContinue; Set-AudioDevice -Index 5; Get-AudioDevice -Recording';

    const { exec } = require('child_process');
    exec(`powershell -Command "${psCmd}"`, (err, stdout, stderr) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      if (err) {
        res.end(JSON.stringify({ ok: false, error: stderr || err.message }));
      } else {
        res.end(JSON.stringify({ ok: true, device: target, output: (stdout || '').trim() }));
      }
    });
    return;
  }

  // 2. Proxy transparente para o motor audiovisual standalone (:3050)
  if (req.url.startsWith('/api/')) {
    
    // Suporte CORS total
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      return res.end();
    }

    const proxyReq = http.request({
      host: '127.0.0.1',
      port: 3050,
      path: req.url,
      method: req.method,
      headers: req.headers
    }, proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', err => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          success: false,
          error: 'O motor audiovisual local (porta 3050) está iniciando ou offline: ' + err.message
        }));
      }
    });

    req.pipe(proxyReq);
    return;
  }

  // 3. Roteamento de arquivos estáticos e rotas de SPA
  let cleanPath = req.url.split('?')[0];
  if (cleanPath === '/audiovisual' || cleanPath.startsWith('/audiovisual')) {
    res.writeHead(302, { 'Location': 'http://127.0.0.1:3050' });
    return res.end();
  }
  let fp;
  if (cleanPath === '/admin' || cleanPath.startsWith('/admin') || cleanPath === '/' || cleanPath.startsWith('/meeting') || cleanPath.startsWith('/portal') || cleanPath.startsWith('/listener') || cleanPath.startsWith('/audience') || cleanPath.startsWith('/telao')) {
    fp = BASE + '/index.html';
  } else {
    fp = BASE + cleanPath;
  }
  if (fp.endsWith('/')) fp += 'index.html';
  const ext = path.extname(fp);
  const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.mp3':'audio/mpeg'};
  const ct = mime[ext] || 'text/plain';
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + fp); return; }
    res.writeHead(200, {'Content-Type':ct,'Access-Control-Allow-Origin':'*'});
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => { 
  require('fs').writeFileSync('server_ready.txt', 'ok'); 
  console.log(`BrainLingo Hub running on http://127.0.0.1:${PORT}`);
});
