/**
 * Public contact page `/contact` (task 17.1; Requirements 10.1, 10.7).
 *
 * Static server component served without authentication.
 */
import type { ReactNode } from "react";

export const metadata = {
  title: "Contact | Virtual HEMS",
};

export default function ContactPage(): ReactNode {
  return (
    <main aria-label="Contact">
      <h1>Contact</h1>
      <p>
        Questions about the Virtual HEMS training platform, joining as a pilot,
        or the desktop bridge? Reach the program team through the channels below.
      </p>
      <dl>
        <dt>General inquiries</dt>
        <dd>
          <a href="mailto:info@virtualhems.example">info@virtualhems.example</a>
        </dd>
        <dt>Pilot onboarding</dt>
        <dd>
          <a href="mailto:pilots@virtualhems.example">
            pilots@virtualhems.example
          </a>
        </dd>
        <dt>Safety reporting</dt>
        <dd>
          Crew members submit safety reports through the in-app Virtual Incident
          Reporting System (VIRS) after signing in.
        </dd>
      </dl>
    </main>
  );
}
