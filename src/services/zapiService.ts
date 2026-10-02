import axios, { AxiosResponse } from "axios";

type EnviarMensagemZApiInput = {
  telefone: string;
  mensagem: string;
};

type EnviarMensagemZApiResponse = {
  zaapId?: string;
  messageId?: string;
  id?: string;
};

export async function enviarMensagemZApi(input: EnviarMensagemZApiInput) {
  const instanceApi = getRequiredEnv("ZAPI_INSTANCE_API").replace(/\/+$/, "");
  const clientToken = getRequiredEnv("ZAPI_CLIENT_TOKEN");
  const telefone = input.telefone.replace(/\D/g, "");

  if (telefone.length < 10) {
    throw new Error(`Telefone inválido para envio Z-API: ${input.telefone}`);
  }

  const endpoint = instanceApi.endsWith("/send-text")
    ? instanceApi
    : `${instanceApi}/send-text`;
  let response: AxiosResponse<unknown>;
  try {
    response = await axios.post(
      endpoint,
      { phone: telefone, message: input.mensagem },
      {
        headers: {
          Accept: "application/json",
          "Client-Token": clientToken,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? "sem status";
      throw new Error(
        `Falha no envio Z-API (${status}): ${descreverResposta(error.response?.data ?? error.message)}`,
      );
    }
    throw error;
  }

  const payload = response.data;
  if (!isRespostaEnvioValida(payload)) {
    throw new Error(
      `A Z-API respondeu ${response.status}, mas não confirmou o envio com zaapId ou messageId: ${descreverResposta(payload)}`,
    );
  }

  return payload;
}

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável de ambiente ${name} não configurada.`);
  return value;
}

function isRespostaEnvioValida(
  payload: unknown,
): payload is EnviarMensagemZApiResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  const response = payload as Record<string, unknown>;
  return [response.zaapId, response.messageId, response.id].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

function descreverResposta(payload: unknown) {
  const serializado = typeof payload === "string"
    ? payload
    : JSON.stringify(payload);
  const descricao = serializado ?? String(payload ?? "");
  return descricao.slice(0, 1_000) || "resposta vazia";
}
