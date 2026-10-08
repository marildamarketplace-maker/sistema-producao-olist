import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Superfície exclusiva de loopback; nenhum caminho/comando vem do navegador.
const root = fileURLToPath(new URL("../", import.meta.url));
const token = randomUUID();
const origin = "http://127.0.0.1:4318";
let estado = "Pronto";
let ativo = false;
let ultimaSaida: number | null = null;
const server = createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
  if (req.headers.host !== "127.0.0.1:4318") { res.writeHead(403).end(); return; }
  const url = new URL(req.url ?? "/", origin);
  if (url.searchParams.get("token") !== token) { res.writeHead(403).end(); return; }
  if (req.method === "GET" && url.pathname === "/status") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ estado, ativo, ultimaSaida })); return;
  }
  if (req.method === "POST" && url.pathname === "/executar") {
    if (req.headers.origin !== origin) { res.writeHead(403).end(); return; }
    if (ativo) { res.writeHead(409).end("Piloto já em execução"); return; }
    ativo = true; estado = "Executando Sol/high, Astra/high e Luna/medium"; ultimaSaida = null;
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/piloto-modelos-estampas.ts", "amostra.json", "--provider=codex-local", "--executar"], { cwd: root, shell: false, stdio: ["ignore", "inherit", "inherit"] });
    child.once("error", () => { ativo = false; estado = "Falha ao iniciar; consulte o terminal"; });
    child.once("close", code => { ativo = false; ultimaSaida = code; estado = code === 0 ? "Concluído — relatório salvo em outputs/arquivo-pilotos/piloto-estampas" : "Falha — consulte o terminal e tente novamente após corrigir"; });
    res.writeHead(202).end("Iniciado"); return;
  }
  if (req.method !== "GET" || url.pathname !== "/") { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Piloto de estampas — Codex</title><style>body{font:18px system-ui;max-width:760px;margin:70px auto;padding:24px}button{font:inherit;padding:14px;cursor:pointer}pre{white-space:pre-wrap}</style><h1>Piloto de estampas</h1><p>GPT-6.1-Sol/high · GPT-6-Astra/high · GPT-6-Luna/medium · amostra.json</p><p>Executa sequencialmente, retoma respostas pendentes e salva no relatório conjunto do piloto.</p><button id="run">Executar amostra com Codex</button><pre id="status">Pronto</pre><script>const token=${JSON.stringify(token)};const button=document.getElementById('run');async function refresh(){try{const r=await fetch('/status?token='+token);const s=await r.json();document.getElementById('status').textContent=s.estado;button.disabled=s.ativo}catch{document.getElementById('status').textContent='Servidor local indisponível'}}button.onclick=async()=>{button.disabled=true;try{const r=await fetch('/executar?token='+token,{method:'POST'});if(!r.ok)document.getElementById('status').textContent=await r.text()}finally{await refresh()}};setInterval(refresh,2000);refresh();</script></html>`);
});
server.listen(4318, "127.0.0.1", () => console.info(`Piloto local: ${origin}/?token=${token}`));
server.once("error", error => { console.error(error.message); process.exitCode = 1; });
