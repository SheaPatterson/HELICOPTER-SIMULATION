"use client";

/**
 * Shared client form for the `/register` and `/login` routes (task 17.2;
 * Requirement 10.6).
 *
 * A thin form bound to a server action (`registerAction` / `loginAction`). On a
 * SUCCESSFUL submit the action issues a server redirect to the canonical
 * operations dashboard, so the client never renders a success state — the
 * navigation is immediate (10.6). On failure the action returns an error
 * message which this form surfaces without navigating.
 *
 * This component owns no destination logic; the canonical redirect target lives
 * entirely in the pure `resolvePostAuthRedirect` invoked by the action.
 */

import { useFormState, useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import type { AuthActionState } from "./actions";

type AuthAction = (
  prev: AuthActionState,
  formData: FormData,
) => Promise<AuthActionState>;

const INITIAL_STATE: AuthActionState = { error: "" };

function SubmitButton({ label }: { label: string }): ReactNode {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Working…" : label}
    </button>
  );
}

export function AuthForm({
  action,
  submitLabel,
}: {
  action: AuthAction;
  submitLabel: string;
}): ReactNode {
  const [state, formAction] = useFormState(action, INITIAL_STATE);

  return (
    <form action={formAction}>
      <label>
        Email
        <input type="email" name="email" autoComplete="email" required />
      </label>
      <label>
        Password
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </label>
      {state.error.length > 0 ? (
        <p role="alert">{state.error}</p>
      ) : null}
      <SubmitButton label={submitLabel} />
    </form>
  );
}
