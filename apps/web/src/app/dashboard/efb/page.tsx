/**
 * `/dashboard/efb` — cockpit Electronic Flight Bag (design Section 3.2 route
 * surface; task 13.1; Requirements 6.1, 6.2, 6.3, 6.4, 6.8).
 *
 * This route is the composition seam for the cockpit EFB. The authorization and
 * live-state logic live entirely in the pure core (`@/lib/efb`) and the client
 * component ({@link EfbClient}); this server component's only job is to obtain
 * the authenticated viewer, the authorized mission package, and the realtime
 * transport, then hand them to the client.
 *
 * The authenticated-session lookup, the Mission_Service package fetch, and the
 * Supabase-backed realtime transport are wired by later tasks (auth 16.x,
 * mission fetch, and the realtime client). Until then this route fails safe: it
 * renders a "not yet wired" notice rather than fabricating a mission or a
 * viewer — consistent with the no-fabrication contract (Requirement 6.8). The
 * seam below shows exactly where each dependency plugs in.
 */

import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function EfbPage(): ReactNode {
  // Wiring seam (later tasks):
  //   const viewer = await getAuthenticatedViewer();            // auth (16.x)
  //   const mission = await fetchAuthorizedMissionPackage(...);  // Mission_Service
  //   const transport = createSupabaseEfbTransport(...);         // realtime client
  //   const eventPorts = createEventDestinationPorts(...);       // Clinical/Mission adapters (6.5/6.6/6.6a)
  //   const destinationHelipad = await fetchDestinationHelipad(...); // helipad/LZ (6.7)
  //   return (
  //     <EfbClient
  //       mission={mission}
  //       viewer={viewer}
  //       transport={transport}
  //       eventPorts={eventPorts}
  //       destinationHelipad={destinationHelipad}
  //     />
  //   );
  //
  // resolveEfbMissionView(mission, viewer) then gates the package (6.1/6.2),
  // useEfbLiveState(missionId, transport) drives the refreshing live view
  // (6.3/6.4/6.8), submitCrewEvent/retryCrewEvent handle independent-destination
  // event capture (6.5/6.6/6.6a), and the checklist/briefing core serves 6.7.
  // See EfbClient.tsx, use-efb-live-state.ts, use-crew-event-capture.ts,
  // CrewEventCapture.tsx, and ChecklistBriefingPanel.tsx.

  return (
    <main aria-label="Cockpit EFB">
      <h1>Cockpit EFB</h1>
      <p>
        The cockpit EFB mission package is delivered to assigned crew once the
        authenticated session, mission package, and realtime transport are wired
        (later tasks). The authorization gate and live-state derivation are
        implemented and unit-tested in <code>@/lib/efb</code>.
      </p>
    </main>
  );
}
