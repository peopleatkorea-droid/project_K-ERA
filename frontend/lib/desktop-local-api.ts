"use client";

import { hasDesktopRuntime, invokeDesktop, throwIfAborted } from "./desktop-ipc";

type QueryValue = string | number | boolean | null | undefined;

type DesktopLocalApiQueryParam = {
  name: string;
  value: string;
};

type DesktopLocalApiFilePayload = {
  field_name: string;
  file_name: string;
  content_type?: string | null;
  bytes: number[];
};

type DesktopLocalApiBinaryResponse = {
  bytes: number[];
  media_type?: string | null;
};

export type DesktopLocalApiFileInput = {
  fieldName: string;
  file: File | Blob;
  fileName?: string;
  contentType?: string | null;
};

function normalizeQuery(
  query?: URLSearchParams | Record<string, QueryValue>,
): DesktopLocalApiQueryParam[] | undefined {
  if (!query) {
    return undefined;
  }
  if (query instanceof URLSearchParams) {
    const items = Array.from(query.entries()).map(([name, value]) => ({ name, value }));
    return items.length > 0 ? items : undefined;
  }
  const items = Object.entries(query)
    .flatMap(([name, value]) => {
      if (value === null || value === undefined) {
        return [];
      }
      return [{ name, value: String(value) }];
    });
  return items.length > 0 ? items : undefined;
}

async function normalizeFiles(files: DesktopLocalApiFileInput[]): Promise<DesktopLocalApiFilePayload[]> {
  const payloads: DesktopLocalApiFilePayload[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.file.arrayBuffer());
    const name =
      file.fileName?.trim() ||
      ("name" in file.file && typeof file.file.name === "string" ? file.file.name.trim() : "") ||
      "upload.bin";
    payloads.push({
      field_name: file.fieldName,
      file_name: name,
      content_type: file.contentType ?? file.file.type ?? null,
      bytes: Array.from(bytes),
    });
  }
  return payloads;
}

function binaryToBlob(response: DesktopLocalApiBinaryResponse) {
  return new Blob([Uint8Array.from(response.bytes ?? [])], {
    type: response.media_type?.trim() || "application/octet-stream",
  });
}

export function canUseDesktopLocalApiTransport() {
  return hasDesktopRuntime();
}

export async function requestDesktopLocalApiJson<T>(
  path: string,
  token: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    query?: URLSearchParams | Record<string, QueryValue>;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
) {
  throwIfAborted(options.signal);
  return invokeDesktop<T>(
    "request_local_json",
    {
      payload: {
        method: options.method ?? "GET",
        path,
        token,
        query: normalizeQuery(options.query),
        body: options.body ?? null,
      },
    },
    options.signal,
  );
}

export async function requestDesktopLocalApiBinary(
  path: string,
  token: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    query?: URLSearchParams | Record<string, QueryValue>;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
) {
  throwIfAborted(options.signal);
  const response = await invokeDesktop<DesktopLocalApiBinaryResponse>(
    "request_local_binary",
    {
      payload: {
        method: options.method ?? "GET",
        path,
        token,
        query: normalizeQuery(options.query),
        body: options.body ?? null,
      },
    },
    options.signal,
  );
  throwIfAborted(options.signal);
  return binaryToBlob(response);
}

export async function requestDesktopLocalApiMultipart<T>(
  path: string,
  token: string,
  options: {
    query?: URLSearchParams | Record<string, QueryValue>;
    fields?: Record<string, QueryValue>;
    files: DesktopLocalApiFileInput[];
    signal?: AbortSignal;
  },
) {
  throwIfAborted(options.signal);
  const files = await normalizeFiles(options.files);
  throwIfAborted(options.signal);
  return invokeDesktop<T>(
    "request_local_multipart",
    {
      payload: {
        path,
        token,
        query: normalizeQuery(options.query),
        fields: normalizeQuery(options.fields),
        files,
      },
    },
    options.signal,
  );
}
