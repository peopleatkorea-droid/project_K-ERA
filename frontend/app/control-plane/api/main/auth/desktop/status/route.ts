import { desktopGoogleOAuthStatus } from "../../../../../../../lib/control-plane/main-app-bridge-desktop-auth";

export async function GET() {
  return Response.json(desktopGoogleOAuthStatus());
}
