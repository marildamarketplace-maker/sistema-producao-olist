type EnviarMensagemZApiInput = {
  telefone: string;
  mensagem: string;
};

export async function enviarMensagemZApi(input: EnviarMensagemZApiInput) {
  const instanceApi = getRequiredEnv("ZAPI_INSTANCE_API").replace(/\/+$/, "");
  const clientToken = getRequiredEnv("ZAPI_CLIENT_TOKEN");
  const telefone = input.telefone.replace(/\D/g, "");

  if (telefone.length < 10) {
    throw new Error(`Telefone inválido para envio Z-API: ${input.telefone}`);
  }

  const response = await fetch(`${instanceApi}/send-text`, {
    method: "POST",
    headers: {
      "Client-Token": clientToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phone: telefone, message: input.mensagem }),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Falha no envio Z-API (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload as { zaapId?: string; messageId?: string; id?: string } | null;
}

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável de ambiente ${name} não configurada.`);
  return value;
}
