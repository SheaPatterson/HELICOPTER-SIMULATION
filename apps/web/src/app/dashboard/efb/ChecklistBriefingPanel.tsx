"use client";

/**
 * Interactive checklists + helipad navigation / LZ briefing panel for the
 * cockpit EFB (task 13.2; Requirement 6.7).
 *
 * Presentational shell. The interactive checklists hold per-item checked state
 * locally and delegate the toggle/completion logic to the pure `@/lib/efb`
 * checklist core; the helipad navigation / LZ briefing is derived from the
 * assigned mission's destination {@link Helipad} via {@link resolveHelipadBriefing}
 * — never fabricated. No derivation logic lives here.
 */

import { useState, type ReactNode } from "react";
import type { Helipad } from "@virtualhems/contracts";
import {
  checklistProgress,
  defaultMissionChecklists,
  resolveHelipadBriefing,
  toggleChecklistItem,
  type Checklist,
} from "@/lib/efb";

export interface ChecklistBriefingPanelProps {
  /** The assigned mission's destination helipad, when known (Requirement 6.7). */
  destinationHelipad?: Helipad | null;
  /** Initial checklists; defaults to the standard mission set. */
  initialChecklists?: Checklist[];
}

export function ChecklistBriefingPanel({
  destinationHelipad,
  initialChecklists,
}: ChecklistBriefingPanelProps): ReactNode {
  const [checklists, setChecklists] = useState<Checklist[]>(
    () => initialChecklists ?? defaultMissionChecklists(),
  );

  const briefing = resolveHelipadBriefing(destinationHelipad);

  const onToggle = (checklistId: string, itemId: string): void => {
    setChecklists((current) =>
      toggleChecklistItem(current, checklistId, itemId),
    );
  };

  return (
    <>
      <section aria-label="Checklists">
        <h2>Checklists</h2>
        {checklists.map((checklist) => {
          const progress = checklistProgress(checklist);
          return (
            <fieldset key={checklist.id} aria-label={checklist.title}>
              <legend>
                {checklist.title} ({progress.checked}/{progress.total})
                {progress.complete ? (
                  <span aria-label="checklist complete"> ✓</span>
                ) : null}
              </legend>
              <ul>
                {checklist.items.map((it) => (
                  <li key={it.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={it.checked}
                        aria-label={it.label}
                        onChange={() => onToggle(checklist.id, it.id)}
                      />
                      {it.label}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          );
        })}
      </section>

      <section aria-label="Helipad navigation and LZ briefing">
        <h2>Helipad navigation and LZ briefing</h2>
        {briefing.available ? (
          <>
            <dl>
              <dt>Facility</dt>
              <dd>{briefing.facilityName}</dd>
              <dt>FAA ID</dt>
              <dd>{briefing.faaId}</dd>
              <dt>Location</dt>
              <dd>
                {briefing.city}, {briefing.state}
              </dd>
              <dt>Coordinates</dt>
              <dd>
                {briefing.coordinates.lat.toFixed(5)},{" "}
                {briefing.coordinates.lon.toFixed(5)}
              </dd>
              <dt>Elevation</dt>
              <dd>{briefing.elevationFt} ft MSL</dd>
              <dt>Placement</dt>
              <dd>{briefing.placement}</dd>
              <dt>Surface</dt>
              <dd>{briefing.surface}</dd>
              <dt>Dimensions</dt>
              <dd>{briefing.dimensionsFt} ft</dd>
              <dt>Capability</dt>
              <dd>{briefing.capability}</dd>
            </dl>
            <ul aria-label="LZ briefing notes">
              {briefing.briefingNotes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </>
        ) : (
          <p aria-label="Briefing unavailable">{briefing.reason}</p>
        )}
      </section>
    </>
  );
}
