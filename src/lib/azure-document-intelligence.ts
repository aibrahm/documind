import type { AzureDocumentIntelligenceResponse } from "@/lib/extraction-v2-schema";

const DEFAULT_API_VERSION = "2024-11-30";
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 120;

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

function getAzureConfig() {
  const endpoint =
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT ||
    process.env.AZURE_DOCINTEL_ENDPOINT ||
    null;
  const key =
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY ||
    process.env.AZURE_DOCINTEL_KEY ||
    null;

  return {
    endpoint: endpoint ? normalizeEndpoint(endpoint) : null,
    key,
    apiVersion:
      process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION ||
      process.env.AZURE_DOCINTEL_API_VERSION ||
      DEFAULT_API_VERSION,
  };
}

export function isAzureDocumentIntelligenceConfigured(): boolean {
  const { endpoint, key } = getAzureConfig();
  return Boolean(endpoint && key);
}

function buildAnalyzeUrl(endpoint: string, apiVersion: string): string {
  const url = new URL(
    `${endpoint}/documentintelligence/documentModels/prebuilt-layout:analyze`,
  );
  url.searchParams.set("api-version", apiVersion);
  url.searchParams.set("outputContentFormat", "text");
  return url.toString();
}

function getRequiredHeader(headers: Headers, name: string): string {
  const value = headers.get(name);
  if (!value) {
    throw new Error(`Azure Document Intelligence response missing ${name} header`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function analyzeDocumentWithAzureLayout(
  fileBuffer: Buffer,
): Promise<AzureDocumentIntelligenceResponse> {
  const { endpoint, key, apiVersion } = getAzureConfig();
  if (!endpoint || !key) {
    throw new Error(
      "Azure Document Intelligence is not configured. Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY.",
    );
  }

  const analyzeResponse = await fetch(buildAnalyzeUrl(endpoint, apiVersion), {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Ocp-Apim-Subscription-Key": key,
    },
    body: new Uint8Array(fileBuffer),
  });

  if (!analyzeResponse.ok) {
    throw new Error(
      `Azure analyze request failed (${analyzeResponse.status}): ${await analyzeResponse.text()}`,
    );
  }

  const operationLocation = getRequiredHeader(
    analyzeResponse.headers,
    "operation-location",
  );

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const pollResponse = await fetch(operationLocation, {
      headers: {
        "Ocp-Apim-Subscription-Key": key,
      },
    });

    if (!pollResponse.ok) {
      throw new Error(
        `Azure analyze poll failed (${pollResponse.status}): ${await pollResponse.text()}`,
      );
    }

    const json = (await pollResponse.json()) as AzureDocumentIntelligenceResponse;
    const status = (json.status || "").toLowerCase();

    if (status === "succeeded") {
      return json;
    }
    if (status === "failed") {
      throw new Error(`Azure analyze operation failed: ${JSON.stringify(json).slice(0, 1000)}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error("Azure analyze operation timed out");
}
