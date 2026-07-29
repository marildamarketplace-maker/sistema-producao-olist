export type TokenOAuthOlist = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

export class ErroPayloadTokenOAuthOlist extends Error {
  constructor(readonly camposInvalidos: string[]) {
    super(
      `Resposta OAuth inválida da Olist: campos ausentes ou inválidos (${camposInvalidos.join(", ")}).`,
    );
    this.name = "ErroPayloadTokenOAuthOlist";
  }
}

export function validarPayloadTokenOAuthOlist(
  payload: unknown,
  opcoes: { exigirRefreshToken?: boolean } = {},
): TokenOAuthOlist {
  const data =
    payload && typeof payload === "object"
      ? payload as Record<string, unknown>
      : {};
  const camposInvalidos: string[] = [];

  const accessToken =
    typeof data.access_token === "string" && data.access_token.trim()
      ? data.access_token
      : null;
  if (!accessToken) camposInvalidos.push("access_token");

  const expiresIn =
    typeof data.expires_in === "number" &&
    Number.isFinite(data.expires_in) &&
    data.expires_in > 0
      ? data.expires_in
      : null;
  if (expiresIn === null) camposInvalidos.push("expires_in");

  const refreshTokenInformado =
    data.refresh_token !== undefined && data.refresh_token !== null;
  const refreshTokenValido =
    typeof data.refresh_token === "string" && Boolean(data.refresh_token.trim());

  if (
    (refreshTokenInformado && !refreshTokenValido) ||
    (opcoes.exigirRefreshToken && !refreshTokenValido)
  ) {
    camposInvalidos.push("refresh_token");
  }

  if (camposInvalidos.length > 0 || !accessToken || expiresIn === null) {
    throw new ErroPayloadTokenOAuthOlist(camposInvalidos);
  }

  return {
    access_token: accessToken,
    expires_in: expiresIn,
    ...(refreshTokenValido
      ? { refresh_token: data.refresh_token as string }
      : {}),
  };
}
