/**
 * Public safety page `/safety` (task 17.1; Requirements 10.1, 10.2, 10.3, 10.7).
 *
 * Static server component served without authentication. Publishes:
 *  - the Safety Charter with a Safety Management System (SMS) section, a Crew
 *    Resource Management (CRM) rules section, and a recurrent-training
 *    requirements section (10.2); and
 *  - the Operations Manual table of contents listing each top-level module
 *    (10.3), sourced from the pure `@/lib/manual` core.
 */
import type { ReactNode } from "react";
import { OPERATIONS_MANUAL_TOC } from "@/lib/manual";

export const metadata = {
  title: "Safety Charter | Virtual HEMS",
};

export default function SafetyPage(): ReactNode {
  return (
    <main aria-label="Safety Charter and Operations Manual">
      <h1>Safety Charter</h1>
      <p>
        Virtual HEMS operates under a non-punitive safety culture. The Safety
        Charter defines how the program manages risk, coordinates crews, and
        keeps qualifications current.
      </p>

      <section aria-labelledby="sms-heading">
        <h2 id="sms-heading">Safety Management System (SMS)</h2>
        <p>
          The SMS framework establishes safety policy, risk management, safety
          assurance, and safety promotion. Hazards are identified and reported
          through the Virtual Incident Reporting System (VIRS); risks are
          assessed and mitigated; and safety performance is monitored
          continuously so lessons feed back into procedures.
        </p>
      </section>

      <section aria-labelledby="crm-heading">
        <h2 id="crm-heading">Crew Resource Management (CRM) rules</h2>
        <p>
          CRM defines how the crew communicates, allocates workload, maintains
          situational awareness, and makes decisions. Every crew member is
          empowered to voice a safety concern, any crew member may call for a
          go-around or mission abort, and briefings and sterile-cockpit
          discipline are mandatory during critical phases of flight.
        </p>
      </section>

      <section aria-labelledby="recurrent-training-heading">
        <h2 id="recurrent-training-heading">Recurrent training requirements</h2>
        <p>
          Crews complete recurrent training to keep procedural, systems, and
          clinical qualifications current. This includes periodic ground and
          simulator sessions, emergency-procedure and inadvertent-IMC recovery
          practice, and clinical and CRM refreshers on the published cadence.
        </p>
      </section>

      <section aria-labelledby="ops-manual-heading">
        <h2 id="ops-manual-heading">Operations Manual — table of contents</h2>
        <p>
          A public summary of the Virtual HEMS Operations Manual. Each entry is a
          top-level module of the manual.
        </p>
        <ol>
          {OPERATIONS_MANUAL_TOC.map((section) => (
            <li key={section.id}>
              <strong>
                {section.id}: {section.title}
              </strong>
              <span> — {section.summary}</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
