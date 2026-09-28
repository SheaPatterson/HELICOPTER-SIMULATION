/**
 * Registration route `/register` (task 17.2; Requirement 10.6).
 *
 * A pilot registers here; on success the bound `registerAction` verifies the
 * credential through the injectable auth seam and issues a server redirect to
 * the canonical operations dashboard (`/dashboard/command`) within the 3-second
 * bound (10.6). The destination is resolved by the pure `resolvePostAuthRedirect`
 * inside the action, so this page carries no destination logic.
 */
import type { ReactNode } from "react";
import { AuthForm } from "../AuthForm";
import { registerAction } from "../actions";

export const metadata = {
  title: "Register | Virtual HEMS",
};

export default function RegisterPage(): ReactNode {
  return (
    <main aria-label="Register">
      <h1>Create your pilot account</h1>
      <p>
        Register to access the Virtual HEMS operations dashboard. After
        registration you are taken straight to the command terminal.
      </p>
      <AuthForm action={registerAction} submitLabel="Register" />
    </main>
  );
}
