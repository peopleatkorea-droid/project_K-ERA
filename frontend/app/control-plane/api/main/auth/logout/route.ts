import { NextResponse } from "next/server";

import { clearMainAppAuthCookie } from "../../../../../../lib/control-plane/http";

export async function POST() {
  return clearMainAppAuthCookie(NextResponse.json({ ok: true }));
}
