import { NextResponse } from "next/server";

import { controlPlaneDatabaseUrl, controlPlaneDevAuthEnabled } from "../../../../lib/control-plane/config";
import { controlPlaneSql } from "../../../../lib/control-plane/db";

export async function GET() {
  try {
    const sql = await controlPlaneSql();
    await sql`select 1`;
    return NextResponse.json({
      status: "ok",
      service: "kera-control-plane",
      database_configured: Boolean(controlPlaneDatabaseUrl()),
      dev_auth_enabled: controlPlaneDevAuthEnabled(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        service: "kera-control-plane",
        detail: error instanceof Error ? error.message : "Control plane health check failed.",
      },
      { status: 503 },
    );
  }
}
