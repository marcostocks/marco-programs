// minimal static server — rooted at the repo, so it never depends on process cwd
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css',
  '.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml',
  '.woff2':'font/woff2','.pdf':'application/pdf'};
// Gate returns no access-control-allow-origin, so the browser cannot call it
// directly. Proxy it same-origin; the app falls back to its seeded price when
// this route is absent (opening index.html straight off disk, say).
function gateProxy(req, res) {
  const q = req.url.slice('/api/gate/tickers'.length);
  https.get('https://api.gateio.ws/api/v4/futures/usdt/tickers' + q, r => {
    let b = '';
    r.on('data', c => b += c);
    r.on('end', () => {
      res.writeHead(r.statusCode || 200, {'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'});
      res.end(b);
    });
  }).on('error', () => { res.writeHead(502).end('[]'); });
}
// PORT lets a second instance run beside one already holding 8099.
const PORT = Number(process.env.PORT) || 8099;
http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/api/gate/tickers') { gateProxy(req, res); return; }
  // A directory serves its index.html, the way any static host would — moonshot/
  // is a folder, so /moonshot/ has to resolve without the filename.
  const file = path.join(ROOT, rel.endsWith('/') ? rel + 'index.html' : rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'});
    res.end(buf);
  });
}).listen(PORT, () => console.log('serving ' + ROOT + ' on http://localhost:' + PORT));
