import WebSocket from 'ws';
const [mode, user, token, port] = process.argv.slice(2);
const ws = new WebSocket(`ws://127.0.0.1:${port}/api/terminal`, { headers: { Cookie: `token=${token}` } });
let out = '';
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'start', mode, user: user || undefined, cols: 80, rows: 24 }));
  setTimeout(() => { console.log(out.slice(-400)); process.exit(0); }, 3500);
});
ws.on('message', (d) => { out += d.toString(); });
ws.on('error', (e) => { console.log('ERR', e.message); process.exit(1); });
