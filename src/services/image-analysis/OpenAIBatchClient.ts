const OPENAI_API_URL = "https://api.openai.com/v1";

export type OpenAIBatch = {
  id: string;
  status: "validating" | "failed" | "in_progress" | "finalizing" | "completed" | "expired" | "cancelling" | "cancelled";
  input_file_id: string;
  output_file_id?: string | null;
  error_file_id?: string | null;
  request_counts?: { total?: number; completed?: number; failed?: number };
  errors?: unknown;
};

export class OpenAIBatchClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: { apiKey?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
    this.apiKey = options.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    if (!this.apiKey) throw new Error("OPENAI_API_KEY não configurada.");
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("Timeout do Batch deve ser um inteiro positivo.");
    }
  }

  async enviarArquivoJsonl(conteudo: string) {
    const form = new FormData();
    form.set("purpose", "batch");
    form.set("file", new Blob([conteudo], { type: "application/jsonl" }), "estampas-batch.jsonl");
    const payload = await this.request<{ id: string }>("/files", { method: "POST", body: form });
    return payload.id;
  }

  async criarBatch(inputFileId: string, metadata: Record<string, string>) {
    return this.request<OpenAIBatch>("/batches", {
      method: "POST",
      body: JSON.stringify({
        input_file_id: inputFileId,
        endpoint: "/v1/responses",
        completion_window: "24h",
        metadata,
      }),
    });
  }

  async buscarBatch(providerBatchId: string) {
    return this.request<OpenAIBatch>(`/batches/${encodeURIComponent(providerBatchId)}`);
  }

  async baixarArquivo(fileId: string) {
    const response = await this.fetchImpl(`${OPENAI_API_URL}/files/${encodeURIComponent(fileId)}/content`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw await erroResposta(response);
    return response.text();
  }

  private async request<T>(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    if (typeof init.body === "string") headers.set("Content-Type", "application/json");
    const response = await this.fetchImpl(`${OPENAI_API_URL}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw await erroResposta(response);
    return response.json() as Promise<T>;
  }
}

async function erroResposta(response: Response) {
  const texto = await response.text().catch(() => "");
  return new Error(`OpenAI Batch HTTP ${response.status}: ${texto.slice(0, 500)}`);
}
