// Servidor da Comunidade City — sem dependências (só Node 18+)
const http = require("http"), fs = require("fs"), path = require("path");
const PORT = process.env.PORT || 3000;
const ADM_PW = process.env.ADM_PW || "2600";
const FILE = path.join(process.env.DATA_DIR || __dirname, "data.json");
const STYLES = ["eletronica", "funk", "samba", "pop", "reggae"];
const FX = ["confete", "fogos", "laser", "strobe", "disco", "fumaca", "baloes", "chuva"];

let S = {
  ti: "🏙️ Comunidade City", su: "Cada pessoa que entra vira um morador",
  ct: "Você também quer participar daqui?", cp: "Siga o perfil e venha fazer parte da nossa cidade!",
  ig: "", s: 1, seed: 7, p: [], mfx: [], liveId: null, manual: false,
  ev: [
    { id: 1, n: "Festa na praça", m: "eletronica", u: "", at: "", d: 30 },
    { id: 2, n: "Noite de funk", m: "funk", u: "", at: "", d: 30 },
    { id: 3, n: "Roda de samba", m: "samba", u: "", at: "", d: 30 },
    { id: 4, n: "DJ Guilherme BR", m: "eletronica", t: "dj", u: "", at: "", d: 30 },
    { id: 5, n: "ADM Abuse", m: "pop", t: "adm", u: "", at: "", d: 30 },
  ],
};
try { Object.assign(S, JSON.parse(fs.readFileSync(FILE, "utf8"))); } catch (e) {}
if (!S.ev.some(e => e.t === "dj")) S.ev.push({ id: 4, n: "DJ Guilherme BR", m: "eletronica", t: "dj", u: "", at: "", d: 30 });
if (!S.ev.some(e => e.t === "adm")) S.ev.push({ id: 5, n: "ADM Abuse", m: "pop", t: "adm", u: "", at: "", d: 30 });

const clients = new Set();
// Banco externo gratuito (Upstash Redis): guarda os dados mesmo se o Render reiniciar
const RURL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, ""), RTOK = process.env.UPSTASH_REDIS_REST_TOKEN || "", RKEY = "comunidade-city";
let rt = null;
function remoteSave() {
  if (!RURL) return;
  clearTimeout(rt);
  rt = setTimeout(() => {
    fetch(RURL + "/set/" + RKEY, { method: "POST", headers: { Authorization: "Bearer " + RTOK }, body: JSON.stringify(S) })
      .catch(e => console.log("Falha ao salvar no banco:", e.message));
  }, 800);
}
async function remoteLoad() {
  if (!RURL) return;
  for (let i = 1; i <= 4; i++) {
    try {
      const r = await fetch(RURL + "/get/" + RKEY, { headers: { Authorization: "Bearer " + RTOK } });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      if (j.result) {
        Object.assign(S, JSON.parse(j.result));
        if (!S.ev.some(e => e.t === "dj")) S.ev.push({ id: 4, n: "DJ Guilherme BR", m: "eletronica", t: "dj", u: "", at: "", d: 30 });
        if (!S.ev.some(e => e.t === "adm")) S.ev.push({ id: 5, n: "ADM Abuse", m: "pop", t: "adm", u: "", at: "", d: 30 });
      }
      console.log("Dados carregados do banco");
      return;
    } catch (e) { console.log("Tentativa " + i + " de ler o banco falhou:", e.message); await new Promise(r => setTimeout(r, 1500)); }
  }
  console.log("Não consegui ler o banco; saindo para não apagar os dados."); process.exit(1);
}
const save = () => { fs.writeFile(FILE, JSON.stringify(S), () => {}); remoteSave(); };
function pub() {
  const msg = "data: " + JSON.stringify(S) + "\n\n";
  for (const r of clients) r.write(msg);
}
function commit() { save(); pub(); }

// eventos agendados começam sozinhos (se não houver um ligado à mão)
setInterval(() => {
  if (S.manual) return;
  const t = Date.now();
  const e = S.ev.find(e => e.at && t >= Date.parse(e.at) && t < Date.parse(e.at) + (e.d || 30) * 6e4);
  const id = e ? e.id : null;
  if (id !== S.liveId) { S.liveId = id; pub(); }
}, 1000);
setInterval(() => { for (const r of clients) r.write(": ping\n\n"); }, 25000);

// limite simples contra tentativas de senha
const fails = new Map();
function blocked(ip) { const f = fails.get(ip); return f && f.n >= 10 && Date.now() - f.t < 6e5; }
function fail(ip) { const f = fails.get(ip) || { n: 0, t: 0 }; f.n++; f.t = Date.now(); fails.set(ip, f); }

const str = (v, max) => String(v == null ? "" : v).slice(0, max);

function act(b) {
  switch (b.a) {
    case "login": return true;
    case "set":
      if (["ti", "su", "ct", "cp", "ig"].includes(b.k)) S[b.k] = str(b.v, 300);
      else if (b.k === "s") S.s = Math.min(3, Math.max(0.2, +b.v || 1));
      else return false;
      break;
    case "seed": S.seed = Math.floor(Math.random() * 99999) + 1; break;
    case "addev": {
      const e = b.ev || {};
      if (!e.n || !STYLES.includes(e.m) || S.ev.length >= 50) return false;
      const ev = { id: Date.now() + Math.floor(Math.random() * 1000), n: str(e.n, 60), m: e.m,
        u: /^https?:\/\//.test(e.u) ? str(e.u, 400) : "", at: str(e.at, 40), d: Math.min(600, Math.max(1, +e.d || 30)),
        t: ["dj", "adm"].includes(e.t) ? e.t : "festa" };
      if (Array.isArray(e.fx)) ev.fx = e.fx.filter(k => FX.includes(k));
      S.ev.push(ev); break;
    }
    case "delev":
      S.ev = S.ev.filter(e => e.id !== b.id);
      if (S.liveId === b.id) { S.liveId = null; S.manual = false; }
      break;
    case "live":
      if (b.id == null) { S.manual = false; S.liveId = null; }
      else if (S.ev.some(e => e.id === b.id)) { S.liveId = b.id; S.manual = true; }
      else return false;
      break;
    case "fx":
      if (!FX.includes(b.k)) return false;
      S.mfx = S.mfx.includes(b.k) ? S.mfx.filter(k => k !== b.k) : [...S.mfx, b.k];
      break;
    case "addp": {
      const n = str(b.n, 40).trim();
      if (!n || S.p.length >= 500 || S.p.some(p => p.n.toLowerCase() === n.toLowerCase())) return false;
      S.p.push({ n, g: b.g === "f" ? "f" : "m", hue: Math.floor(Math.random() * 360), l: Math.random(), k: Math.floor(Math.random() * 5) });
      break;
    }
    case "setg": { const p = S.p.find(p => p.n === b.n); if (!p) return false; p.g = b.g === "f" ? "f" : "m"; break; }
    case "delp": S.p = S.p.filter(p => p.n !== b.n); break;
    case "arrive": S.arr = { n: str(b.n, 40), ts: Date.now() }; break;
    default: return false;
  }
  commit();
  return true;
}

const server = http.createServer((req, res) => {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 2000\n\ndata: " + JSON.stringify(S) + "\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (req.method === "POST" && req.url === "/api/admin") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 20000) req.destroy(); });
    req.on("end", () => {
      let b; try { b = JSON.parse(body); } catch (e) { res.writeHead(400); return res.end(); }
      if (blocked(ip)) { res.writeHead(429); return res.end(); }
      if (b.pw !== ADM_PW) { fail(ip); res.writeHead(401); return res.end(); }
      fails.delete(ip);
      const ok = act(b);
      res.writeHead(ok ? 200 : 400); res.end(ok ? "ok" : "");
    });
    return;
  }
  if (req.method === "GET" && req.url === "/healthz") { res.writeHead(200); return res.end("ok"); }
  if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
    const pg = [path.join(__dirname, "index.html"), path.join(__dirname, "public", "index.html")].find(p => fs.existsSync(p)) || "";
    fs.readFile(pg, (err, d) => {
      if (err) { res.writeHead(500); return res.end("erro"); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(d);
    });
    return;
  }
  res.writeHead(404); res.end("nao encontrado");
});
remoteLoad().then(() => server.listen(PORT, () => console.log("Comunidade City na porta " + PORT)));
