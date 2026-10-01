const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = 8765;
const BASE = 'G:/Outros computadores/Meu laptop/Web Projects/BrainLingo';
const server = http.createServer((req, res) => {
  let fp = BASE + req.url.split('?')[0];
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
server.listen(PORT, '127.0.0.1', () => { require('fs').writeFileSync('server_ready.txt', 'ok'); });
