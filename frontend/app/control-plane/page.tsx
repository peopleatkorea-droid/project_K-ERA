import { redirect } from "next/navigation";

import { ControlPlaneConsole } from "../../components/control-plane-console";
import { controlPlaneSandboxEnabled } from "../../lib/control-plane/config";

export default function ControlPlanePage() {
  if (!controlPlaneSandboxEnabled()) {
    redirect("/admin-login?next=%2F%3Fworkspace%3Doperations%26section%3Ddashboard");
  }
  return <ControlPlaneConsole />;
}
