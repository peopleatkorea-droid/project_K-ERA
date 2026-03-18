import { NextRequest } from "next/server";

import {
  controlPlaneLlmApiKey,
  controlPlaneLlmBaseUrl,
  controlPlaneLlmModel,
  controlPlaneLlmTimeoutMs,
} from "../../../../../lib/control-plane/config";
import { jsonError, requireControlPlaneNode, requireControlPlaneUser } from "../../../../../lib/control-plane/http";

async function isAuthorized(request: NextRequest): Promise<boolean> {
  try {
    await requireControlPlaneUser(request);
    return true;
  } catch {
    try {
      await requireControlPlaneNode(request);
      return true;
    } catch {
      return false;
    }
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return jsonError("Authentication is required.", 401);
  }
  const apiKey = controlPlaneLlmApiKey();
  if (!apiKey) {
    return jsonError("LLM relay is not configured.", 503);
  }
  try {
    const body = (await request.json()) as {
      input?: string;
      system?: string;
      model?: string;
    };
    if (!body.input?.trim()) {
      return jsonError("input is required.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), controlPlaneLlmTimeoutMs());
    const response = await fetch(controlPlaneLlmBaseUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: body.model?.trim() || controlPlaneLlmModel(),
        input: [
          ...(body.system?.trim()
            ? [{ role: "system", content: [{ type: "input_text", text: body.system.trim() }] }]
            : []),
          { role: "user", content: [{ type: "input_text", text: body.input.trim() }] },
        ],
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
    if (!response.ok) {
      const detail = await response.text();
      return jsonError(detail || "LLM relay request failed.", response.status);
    }
    const payload = (await response.json()) as {
      id?: string;
      output_text?: string;
    };
    return Response.json({
      id: payload.id || null,
      model: body.model?.trim() || controlPlaneLlmModel(),
      output_text: payload.output_text || "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LLM relay request failed.";
    return jsonError(message, 502);
  }
}
