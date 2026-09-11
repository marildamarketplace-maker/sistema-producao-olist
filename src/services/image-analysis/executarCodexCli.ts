import { spawn } from "node:child_process";
import { ImageAnalysisProviderError } from "@/services/image-analysis/ImageAnalysisProviderError";

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

// Somente o contexto necessário ao CLI; não herda chaves de API, banco, Olist,
// NODE_OPTIONS nem variáveis de controle do processo Codex que iniciou o worker.
export function ambienteCodexCli(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: source.NODE_ENV ?? "production" };
  for (const key of [
    "PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot",
    "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TMPDIR", "TMP", "TEMP",
    "LANG", "LC_ALL", "CODEX_HOME", "SSL_CERT_FILE", "SSL_CERT_DIR",
  ]) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}

export function erroCodexCli(
  code: ImageAnalysisProviderError["code"],
  message: string,
  retriable = false,
) {
  return new ImageAnalysisProviderError(message, { code, provider: "codex-local", retriable });
}

// As mensagens do processo servem apenas para classificação: nunca são copiadas
// para logs/erros persistidos, pois podem conter prompt, imagem ou credenciais.
export function classificarFalhaCodexCli(message: string) {
  if (/unauthorized|unauthenticated|not logged in|login required|401|403|token.*expired|authentication|refresh token|invalid_grant/i.test(message)) {
    return erroCodexCli("AUTHENTICATION_ERROR", "Login do Codex indisponível ou expirado. Execute codex login com sua conta ChatGPT.");
  }
  if (/rate.?limit|usage.?limit|quota|429|too many requests|usage cap/i.test(message)) {
    return erroCodexCli("RATE_LIMIT", "Limite de uso do Codex atingido; o job seguirá o backoff do worker.", true);
  }
  if (/model.*(?:not supported|not found|does not exist|unavailable)|unsupported.*model|unexpected argument|unrecognized|invalid.*config/i.test(message)) {
    return erroCodexCli("CONFIGURATION_ERROR", "Modelo, versão ou configuração do Codex CLI incompatível. Confira CODEX_CLI_PRIMARY_MODEL e CODEX_CLI_FALLBACK_MODEL.");
  }
  if (/Error:.*(?:operation not permitted|permission denied|read-only (?:database|file system))/i.test(message)) {
    return erroCodexCli("CONFIGURATION_ERROR", "O sistema bloqueou a inicialização do Codex CLI. Confira as permissões do processo e o acesso ao diretório do Codex.");
  }
  return erroCodexCli("PROVIDER_TEMPORARY_ERROR", "O Codex CLI não concluiu a análise; o job seguirá o backoff do worker.", true);
}

export function executarCodexCli(options: {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  stdin?: string;
}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== "win32";
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      env: ambienteCodexCli(),
      shell: false,
      detached: grouped,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let failure: ImageAnalysisProviderError | undefined;

    const terminate = (error: ImageAnalysisProviderError) => {
      failure ??= error;
      try {
        // No macOS/Linux, encerra também os subprocessos do CLI.
        if (grouped && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timeout = setTimeout(() => {
      terminate(erroCodexCli("TIMEOUT", "Timeout na análise visual pelo Codex CLI.", true));
    }, options.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const collect = (chunk: string, stream: "stdout" | "stderr") => {
      if (failure) return;
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_OUTPUT_BYTES) {
        terminate(erroCodexCli("INVALID_RESPONSE", "Saída do Codex CLI excedeu o limite de 2 MiB."));
        return;
      }
      if (stream === "stdout") stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.on("data", (chunk: string) => collect(chunk, "stdout"));
    child.stderr.on("data", (chunk: string) => collect(chunk, "stderr"));
    child.once("error", () => {
      clearTimeout(timeout);
      reject(erroCodexCli("CONFIGURATION_ERROR", "Não foi possível executar o Codex CLI. Confira a instalação, permissões e CODEX_CLI_PATH."));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (failure) reject(failure);
      else if (code !== 0) reject(classificarFalhaCodexCli(`${stderr}\n${stdout}`));
      else resolve({ stdout, stderr });
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      // EPIPE é esperado quando o CLI encerra antes de ler o prompt.
      if (error.code !== "EPIPE") {
        terminate(erroCodexCli("PROVIDER_TEMPORARY_ERROR", "Falha ao enviar o prompt ao Codex CLI.", true));
      }
    });
    child.stdin.end(options.stdin ?? "");
  });
}
