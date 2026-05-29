import { createSign } from "node:crypto";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_STORAGE_UPLOAD_URL = "https://storage.googleapis.com/upload/storage/v1";
const GOOGLE_STORAGE_API_URL = "https://storage.googleapis.com/storage/v1";
const GOOGLE_STORAGE_PUBLIC_URL = "https://storage.googleapis.com";
const STORAGE_SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type UploadToGoogleStorageInput = {
  path: string;
  buffer: Buffer;
  contentType: string;
  bucket?: string;
};

export type UploadedGoogleStorageObject = {
  bucket: string;
  path: string;
  publicUrl: string;
};

export type GoogleStorageObjectInfo = UploadedGoogleStorageObject & {
  exists: boolean;
};

export class GoogleStorageServiceError extends Error {
  status?: number;
  details?: unknown;

  constructor(message: string, options?: { status?: number; details?: unknown; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "GoogleStorageServiceError";
    this.status = options?.status;
    this.details = options?.details;
  }
}

export async function uploadToGoogleStorage(
  input: UploadToGoogleStorageInput,
): Promise<UploadedGoogleStorageObject> {
  const bucket = input.bucket || getRequiredEnv("GOOGLE_CLOUD_STORAGE_BUCKET");
  const objectPath = normalizeObjectPath(input.path);
  const accessToken = await getGoogleAccessToken();
  const uploadUrl = `${GOOGLE_STORAGE_UPLOAD_URL}/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`;

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": input.contentType,
      "Content-Length": String(input.buffer.length),
    },
    body: input.buffer,
  });

  if (!response.ok) {
    throw new GoogleStorageServiceError("Nao foi possivel enviar imagem para o Google Cloud Storage.", {
      status: response.status,
      details: await readResponseDetails(response),
    });
  }

  return {
    bucket,
    path: objectPath,
    publicUrl: `${GOOGLE_STORAGE_PUBLIC_URL}/${bucket}/${objectPath}`,
  };
}

export async function deleteGoogleStorageObject(
  path: string,
  bucket = getRequiredEnv("GOOGLE_CLOUD_STORAGE_BUCKET"),
) {
  const objectPath = normalizeObjectPath(path);
  const accessToken = await getGoogleAccessToken();
  const url = `${GOOGLE_STORAGE_API_URL}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 404) {
    return;
  }

  if (!response.ok) {
    throw new GoogleStorageServiceError("Nao foi possivel substituir imagem no Google Cloud Storage.", {
      status: response.status,
      details: await readResponseDetails(response),
    });
  }
}

export async function getGoogleStorageObjectInfo(
  path: string,
  bucket = getRequiredEnv("GOOGLE_CLOUD_STORAGE_BUCKET"),
): Promise<GoogleStorageObjectInfo> {
  const objectPath = normalizeObjectPath(path);
  const accessToken = await getGoogleAccessToken();
  const url = `${GOOGLE_STORAGE_API_URL}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 404) {
    return {
      bucket,
      path: objectPath,
      publicUrl: `${GOOGLE_STORAGE_PUBLIC_URL}/${bucket}/${objectPath}`,
      exists: false,
    };
  }

  if (!response.ok) {
    throw new GoogleStorageServiceError("Nao foi possivel consultar imagem no Google Cloud Storage.", {
      status: response.status,
      details: await readResponseDetails(response),
    });
  }

  return {
    bucket,
    path: objectPath,
    publicUrl: `${GOOGLE_STORAGE_PUBLIC_URL}/${bucket}/${objectPath}`,
    exists: true,
  };
}

async function getGoogleAccessToken() {
  const assertion = buildServiceAccountJwt();
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json()) as GoogleTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new GoogleStorageServiceError("Nao foi possivel autenticar no Google Cloud Storage.", {
      status: response.status,
      details: payload,
    });
  }

  return payload.access_token;
}

function buildServiceAccountJwt() {
  const clientEmail = getRequiredEnv("GOOGLE_CLOUD_CLIENT_EMAIL");
  const privateKey = getRequiredEnv("GOOGLE_CLOUD_PRIVATE_KEY").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: clientEmail,
    scope: STORAGE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const unsignedToken = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = createSign("RSA-SHA256").update(unsignedToken).sign(privateKey);

  return `${unsignedToken}.${base64Url(signature)}`;
}

function normalizeObjectPath(path: string) {
  const normalized = path.replace(/^\/+/, "").replace(/\\/g, "/");

  if (!normalized || normalized.includes("..")) {
    throw new GoogleStorageServiceError("Caminho de upload invalido.");
  }

  return normalized;
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function readResponseDetails(response: Response) {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new GoogleStorageServiceError(`Variavel de ambiente ${name} nao configurada.`);
  }

  return value;
}
