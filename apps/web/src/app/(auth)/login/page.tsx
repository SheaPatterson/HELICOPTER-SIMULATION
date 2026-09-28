/**
 * Login route `/login` (task 17.2; Requirement 10.6).
 *
 * Complementary to `/register`. On a successful sign-in the bound `loginAction`
 * verifies the credential through the injectable auth seam and issues a server
 * redirect to the canonical operations dashboard (`/dashboard/command`) within
 * the 3-second bound (10.6). The destination is resolved by the pure
 * `resolvePostAuthRedirect` inside the action.
 */
import type { ReactNode } from "react";
import { AuthForm } from "../AuthForm";
import { loginAction } from "../actions";

export const metadata = {
  title: "Sign in | Virtual HEMS",
};

export default function LoginPage(): ReactNode {
  return (
    <main aria-label="Sign in">
      <h1>Sign in</h1>
      <p>
        Sign in to return to the Virtual HEMS operations dashboard and command
        terminal.
      </p>
      <AuthForm action={loginAction} submitLabel="Sign in" />
    </main>
  );
}
