# Requirements Document

## Introduction

Community Profiles layers a member-facing community experience on top of the already-approved Virtual HEMS platform (`.kiro/specs/helicopter-simulation/`). It gives each authenticated member a rich, editable simulation persona: display name, callsign, biography, crew role, home base, avatar and cover photos, and a flight-log and statistics summary derived from existing mission and logbook data. It exposes public-facing, de-identified member profile pages and a member directory so the community can see who flies in the network, while preserving every privacy, authorization, and simulation-only data boundary established by the existing spec.

The feature reuses the existing `profiles` table (`id`, `full_name`, `callsign`, `role`, `hems_credential_id`, `total_hours`, `total_dispatches`, `home_base_id`, timestamps) and extends the community-facing persona through additional profile fields and new community tables. It reuses the existing Supabase Auth identity, PostgreSQL Row Level Security (RLS) least-privilege model, PostGIS spatial data, Supabase Storage, and Next.js Web Terminal described in the helicopter-simulation design (`.kiro/specs/helicopter-simulation/design.md`, Sections 5.1–5.3 and 9) and the project documentation under `.kilo/docs` (notably `ARCHITECTURE.md`, `BLUEPRINT.md`, `APP-MAP.md`, `TECH-STACK.md`, `DOCUMENT-STRUCTURE.md`, `HEMS Service Overview.md`, and `Western Pennsylvania Healthcare.md`).

This feature also establishes reproducible, idempotent seed and demo data for every platform data table — existing tables and the new community tables — so that no user-interface view renders an empty state. Seed avatars and community images are sourced from the media asset folders `.kilo/docs/media/avatars/` and `.kilo/docs/media/gallery/` through a documented, filename-independent mapping convention.

This is a simulation and training system. All member personas, biographies, statistics, and community content describe simulated flight-operations activity only. The feature is not a real-world dispatch, medical, or aviation authority and uses only simulated, minimized data. It never exposes patient, clinical, or Virtual Incident Reporting System (VIRS) records.

The core, must-have scope is Requirements 1 through 8, which now includes Direct Messages Between Members (Requirement 7) and reproducible demo seed data for all tables (Requirement 8). The secondary requirements (Requirements 9 and 10) are marked OPTIONAL. They are presented for the user to accept or drop and are not assumed as core scope.

## Glossary

- **Platform**: The complete Virtual HEMS system, comprising the desktop bridge, cloud backend, and Web Terminal, as defined in the helicopter-simulation spec.
- **Web_Terminal**: The Next.js web application that hosts public, authentication, and authenticated operational routes, including the new community routes.
- **Member**: An authenticated user of the Platform who holds a `profiles` record and participates in the community.
- **Profile_Service**: The service that reads, validates, and persists member profile data, including the extended community persona fields.
- **Profile_Record**: The persisted representation of a Member's persona, comprising the existing `profiles` fields plus the extended community fields (display name, biography, crew role, avatar reference, cover-photo reference, profile visibility).
- **Crew_Role**: The Member's simulated operational role, selected from the defined role set (pilot in command, second pilot, flight nurse, flight paramedic, communications specialist, mechanic, trainee), consistent with the personnel roles described in `HEMS Service Overview.md`.
- **Flight_Stats_Summary**: A read-only summary of a Member's simulated activity (for example total flight hours, total dispatches or missions, landings, and most-recent mission outcome) derived from existing mission, telemetry, logbook, and after-action records.
- **Avatar**: A Member's profile picture image.
- **Cover_Photo**: A Member's profile banner or cover image.
- **Storage_Service**: The Supabase Storage subsystem that stores and serves Avatar, Cover_Photo, and other community image objects under access-controlled buckets.
- **Profile_Media_Object**: An uploaded image object (Avatar or Cover_Photo) stored in the Storage_Service and referenced from a Profile_Record.
- **Allowed_Image_Type**: A member-uploadable image content type from the configured allow-list (`image/png`, `image/jpeg`, `image/webp`).
- **Max_Image_Size**: The configured maximum accepted upload size for a Profile_Media_Object, defaulting to 5 megabytes and configurable within 1 to 10 megabytes inclusive.
- **Member_Directory**: The listing view that presents Members as public, de-identified persona cards.
- **Public_Profile_Page**: The public, unauthenticated view of a single Member's persona, showing only permitted simulation-persona fields.
- **Profile_Visibility**: A per-Member setting controlling whether that Member's Public_Profile_Page and directory card are publicly visible (`public`) or restricted to authenticated Members (`members_only`).
- **RLS**: PostgreSQL Row Level Security, as established in the helicopter-simulation design Section 5.3.
- **Authorized_Operational_Role**: An explicitly authorized role (for example instructor or admin) permitted broader mutation scope under the existing authorization model.
- **Seed_Runner**: The idempotent, re-runnable process that populates every platform data table with realistic demo data.
- **Seed_Dataset**: The realistic demo data drawn from `.kilo/docs` used by the Seed_Runner to populate the Platform.
- **Avatar_Manifest**: A documented mapping artifact that associates each seeded Member persona with an Avatar (and optional Cover_Photo) file in the media asset folders, independent of specific filenames.
- **Media_Asset_Folder**: A source folder for seed images: `.kilo/docs/media/avatars/` for Avatars and `.kilo/docs/media/gallery/` for other community and mission images.
- **Placeholder_Avatar**: The default fallback image displayed when a Member has no Avatar or the referenced Profile_Media_Object is unavailable.
- **De-identified_Data**: Data containing no patient, clinical, or VIRS record and no field identifying a real individual, patient, or incident, consistent with helicopter-simulation Requirement 8.
- **Direct_Message**: A private text message sent by one Member (the sender) to another Member (the recipient), persisted with sender identifier, recipient identifier, body, and submission timestamp, readable only by its sender and recipient.
- **Conversation**: The ordered set of Direct_Messages exchanged between two Members, presented as a single thread and identified by the pair of participant identifiers.
- **Messaging_Service**: The service that validates, persists, lists, and retrieves Direct_Messages and Conversations under the Platform authorization and RLS model.

## Requirements

### Requirement 1: Editable Community Profile

**User Story:** As a Member, I want to edit a rich community profile with my display name, callsign, biography, crew role, and home base, so that other Members can see who I am within the simulated HEMS network.

Extends the existing `profiles` entity (helicopter-simulation design Section 5.1) with community persona fields, and reuses the authorization model of Section 5.3.

#### Acceptance Criteria

1. WHEN an authenticated Member opens the profile edit form, THE Profile_Service SHALL populate the form with that Member's current Profile_Record values for display name, callsign, biography, Crew_Role, home base, Avatar reference, Cover_Photo reference, and Profile_Visibility.
2. WHEN an authenticated Member submits the profile edit form with a display name of 1 to 80 characters, a callsign of 1 to 40 characters, a biography of 0 to 2,000 characters, a Crew_Role from the defined role set, and a home base that references an existing `hems_bases` record, THE Profile_Service SHALL persist the submitted values to that Member's Profile_Record and record the update timestamp.
3. IF a submitted profile field is missing a required value, exceeds its defined length bound, specifies a Crew_Role outside the defined role set, or specifies a home base that does not reference an existing `hems_bases` record, THEN THE Profile_Service SHALL reject the submission, SHALL persist none of the submitted values, and SHALL return a validation error identifying each failed field while retaining the Member's entered values.
4. WHEN a Member submits a callsign that is already assigned to a different Profile_Record, THE Profile_Service SHALL reject the submission and SHALL return a validation error indicating the callsign is already in use, preserving the callsign uniqueness constraint of the `profiles` table.
5. IF a biography or display name submitted for a Profile_Record contains a detectable real-world patient identifier, THEN THE Profile_Service SHALL reject the submission under the simulation-only data policy, return an error indicating the input violates the simulation-only data policy, and persist none of the submitted input.
6. WHERE a Member has not set an optional biography or Cover_Photo, THE Profile_Service SHALL store the Profile_Record with an empty biography value and an absent Cover_Photo reference and SHALL treat the Profile_Record as valid.

### Requirement 2: Profile Authorization and Ownership

**User Story:** As a platform operator, I want profile edits restricted to each Member's own record under least privilege, so that community persona data is mutated only by its owner or an explicitly authorized role.

Aligns with helicopter-simulation Requirement 8 (Security, Privacy, and Authorization) and design Section 5.3.

#### Acceptance Criteria

1. WHEN a Member requests to create, update, or delete a Profile_Record, THE Platform SHALL validate the presented authentication credential and SHALL grant the mutation only if the credential is valid and unexpired.
2. IF an unauthenticated client requests to create, update, or delete any Profile_Record or Profile_Media_Object, THEN THE Platform SHALL deny the request and return an error response indicating authentication is required, mutating no record.
3. THE Platform SHALL enforce RLS so that a Member can create, update, or delete only the Profile_Record and Profile_Media_Objects whose owner identifier equals that Member's identifier.
4. IF a Member attempts to create, update, or delete a Profile_Record or Profile_Media_Object whose owner identifier does not equal that Member's identifier and the Member holds no Authorized_Operational_Role for that record, THEN THE Platform SHALL reject the mutation, return an error response indicating the operation is not authorized, and leave the target record unchanged.
5. WHERE a Member holds an Authorized_Operational_Role that is explicitly permitted broader profile access, THE Platform SHALL permit that role to mutate Profile_Records beyond the acting Member's own record, limited to the record scope defined for that role.

### Requirement 3: Avatar and Cover Photo Upload and Validation

**User Story:** As a Member, I want to upload and change my profile picture and cover photo, so that my community persona is recognizable, while the Platform validates and safely stores my images.

Reuses the Supabase Storage approach and secret-handling constraints from helicopter-simulation design Section 9 and Requirement 8.

#### Acceptance Criteria

1. WHEN an authenticated Member uploads an Avatar or Cover_Photo whose content type is an Allowed_Image_Type and whose size is at most Max_Image_Size, THE Storage_Service SHALL store the image as a Profile_Media_Object and THE Profile_Service SHALL update the Member's Profile_Record to reference the stored object.
2. IF a Member uploads an image whose content type is not an Allowed_Image_Type, THEN THE Profile_Service SHALL reject the upload, store no Profile_Media_Object, and return a validation error identifying the unsupported content type.
3. IF a Member uploads an image whose size exceeds Max_Image_Size, THEN THE Profile_Service SHALL reject the upload, store no Profile_Media_Object, and return a validation error identifying the size limit.
4. WHEN a Member replaces an existing Avatar or Cover_Photo, THE Profile_Service SHALL update the Profile_Record to reference the new Profile_Media_Object and SHALL remove or dereference the superseded Profile_Media_Object so that it is no longer served.
5. THE Storage_Service SHALL restrict write access to Profile_Media_Objects so that a Member can upload, replace, or delete only Profile_Media_Objects whose owner identifier equals that Member's identifier, unless the acting Member holds an Authorized_Operational_Role permitted broader access.
6. THE Platform SHALL keep Storage_Service service-role secrets out of the browser client bundle, performing privileged storage operations only through server-side code.
7. WHEN a Public_Profile_Page or Member_Directory card displays a Member who has no Avatar or whose referenced Profile_Media_Object is unavailable, THE Web_Terminal SHALL display the Placeholder_Avatar in place of the missing image.

### Requirement 4: Flight-Log and Statistics Summary

**User Story:** As a Member, I want my profile to show a flight-log and statistics summary derived from my missions and logbook, so that my community persona reflects my simulated activity.

Derives read-only values from existing `profiles`, `missions`, `flight_telemetry`, and `aar_reports` data (helicopter-simulation design Section 5.1).

#### Acceptance Criteria

1. WHEN the Web_Terminal renders a Member's profile, THE Profile_Service SHALL compute the Flight_Stats_Summary for that Member solely from existing mission, telemetry, logbook, and after-action records associated with that Member.
2. THE Profile_Service SHALL derive the Flight_Stats_Summary values deterministically from the recorded source data, such that identical source data always produces an identical Flight_Stats_Summary.
3. WHERE a Member has no recorded missions, THE Profile_Service SHALL return a Flight_Stats_Summary with zero-valued totals rather than an absent or error result.
4. THE Profile_Service SHALL treat the Flight_Stats_Summary as read-only and SHALL NOT allow a Member to directly edit any Flight_Stats_Summary value through the profile edit form.
5. THE Profile_Service SHALL derive every Flight_Stats_Summary value solely from recorded source data and SHALL NOT substitute a fabricated value for any summary metric.

### Requirement 5: Public Member Profile Pages and De-identification

**User Story:** As a member of the public, I want to view member profile pages that show simulation personas, so that I can learn about the community without any patient, clinical, or incident data being exposed.

Aligns with helicopter-simulation Requirement 8 (public routes return only aggregate or de-identified data) and Requirement 10 (Public and Marketing Surfaces).

#### Acceptance Criteria

1. WHEN an unauthenticated visitor requests a Public_Profile_Page for a Member whose Profile_Visibility is `public`, THE Web_Terminal SHALL serve the page displaying only the Member's display name, callsign, biography, Crew_Role, home base name, Avatar, Cover_Photo, and Flight_Stats_Summary.
2. THE Web_Terminal SHALL return only De-identified_Data on any Public_Profile_Page and Member_Directory route, containing no patient, clinical, or VIRS record and no field that identifies a real individual, patient, or incident.
3. IF an unauthenticated visitor requests a Public_Profile_Page for a Member whose Profile_Visibility is `members_only`, THEN THE Web_Terminal SHALL withhold that Member's persona details and SHALL return an indication that authentication is required to view the profile.
4. THE Web_Terminal SHALL exclude the Member's `hems_credential_id` and any Platform authentication identifier from every Public_Profile_Page and Member_Directory response.
5. WHEN the Web_Terminal serves a Public_Profile_Page or Member_Directory route, THE Web_Terminal SHALL respond within 3 seconds without prompting for or requiring authentication for `public` Members.

### Requirement 6: Member Directory

**User Story:** As a Member or visitor, I want a directory of community members, so that I can browse and find other people who fly in the simulated HEMS network.

Aligns with helicopter-simulation Requirement 10 public-surface behavior and reuses the de-identification boundary of Requirement 5.

#### Acceptance Criteria

1. WHEN a visitor requests the Member_Directory, THE Web_Terminal SHALL display a persona card for each Member whose Profile_Visibility is `public`, each card showing that Member's display name, callsign, Crew_Role, home base name, and Avatar or Placeholder_Avatar.
2. THE Web_Terminal SHALL exclude from the Member_Directory any Member whose Profile_Visibility is `members_only` when the requester is unauthenticated.
3. WHEN an authenticated Member requests the Member_Directory, THE Web_Terminal SHALL include persona cards for Members whose Profile_Visibility is `public` and, where policy permits, Members whose Profile_Visibility is `members_only`, applying the same De-identified_Data boundary as Requirement 5.
4. WHEN a visitor selects a persona card whose Member is visible to that visitor, THE Web_Terminal SHALL navigate to that Member's Public_Profile_Page.
5. WHERE the Member_Directory contains more Members than the configured page size, THE Web_Terminal SHALL paginate the results and SHALL order Members deterministically by callsign so that identical data produces identical ordering.

### Requirement 7: Direct Messages Between Members

**User Story:** As a Member, I want to send direct messages to other Members and view my conversations, so that I can coordinate and socialize within the community.

Reuses the Supabase Auth identity, PostgreSQL RLS least-privilege model, and realtime delivery patterns from the helicopter-simulation design (Sections 5.3 and 9).

#### Acceptance Criteria

1. WHEN an authenticated Member sends a Direct_Message of 1 to 5,000 characters to another Member, THE Messaging_Service SHALL persist the Direct_Message with its sender identifier, recipient identifier, body, and submission timestamp, and SHALL make the Direct_Message retrievable by the sender and the recipient.
2. WHEN an authenticated Member requests the list of Conversations, THE Messaging_Service SHALL return every Conversation in which that Member is a participant, each identified by the other participant and ordered deterministically by the submission timestamp of its most recent Direct_Message.
3. WHEN an authenticated Member requests a Conversation with another Member, THE Messaging_Service SHALL return the Direct_Messages exchanged between the two Members ordered by submission timestamp ascending.
4. WHEN a Member sends a Direct_Message to a recipient with an open view of that Conversation, THE Messaging_Service SHALL deliver the Direct_Message to the recipient in realtime through the existing Supabase realtime channel, or within 3 seconds where realtime delivery is unavailable.
5. THE Platform SHALL enforce RLS so that a Member can retrieve only Direct_Messages and Conversations where that Member is the sender or the recipient.
6. WHEN a Member requests to send or retrieve a Direct_Message, THE Platform SHALL validate the presented authentication credential and SHALL grant the operation only if the credential is valid and unexpired.
7. IF an unauthenticated client requests to send, list, or retrieve a Direct_Message or Conversation, THEN THE Platform SHALL deny the request and return an error indicating authentication is required, persisting and returning no message.
8. IF a Direct_Message body is empty or exceeds 5,000 characters, THEN THE Messaging_Service SHALL reject the Direct_Message, persist nothing, and return a validation error identifying the invalid field.
9. THE Web_Terminal SHALL exclude all Direct_Message and Conversation content from every public or unauthenticated route.
10. IF a Direct_Message contains a detectable real-world patient identifier, THEN THE Messaging_Service SHALL reject the Direct_Message under the simulation-only data policy and persist none of the submitted content.

### Requirement 8: Reproducible Demo Seed Data for All Tables

**User Story:** As a developer or demonstrator, I want every platform table seeded with realistic, re-runnable demo data mapped to profile photos, so that no UI view shows an empty state and demos are reproducible.

Seeds the existing tables (`profiles`, `hems_bases`, `hospitals`, `medical_conditions`, `missions`, `flight_telemetry`, `mission_events`, `clinical_snapshots`, `tactical_briefings`, `aar_reports`, `virs_reports`, `audit_log`) and the new community tables, including the direct-messaging tables that store Direct_Messages and Conversations (Requirement 7), drawing content from `.kilo/docs`.

#### Acceptance Criteria

1. WHEN the Seed_Runner executes against an empty database, THE Seed_Runner SHALL populate every platform data table, including the existing tables and the new community tables, with realistic Seed_Dataset records drawn from `.kilo/docs` such that no UI view renders an empty state.
2. WHEN the Seed_Runner seeds the direct-messaging tables, THE Seed_Runner SHALL create realistic seeded Conversations and Direct_Messages between seeded Members so that the messaging UI does not render an empty state, drawing only De-identified_Data and simulated content.
3. WHEN the Seed_Runner executes more than once against the same database, THE Seed_Runner SHALL produce the same final seeded state as a single execution and SHALL NOT create duplicate Seed_Dataset records, making the seed operation idempotent and re-runnable.
4. WHEN the Seed_Runner seeds Profile_Records, THE Seed_Runner SHALL associate each seeded Member with an Avatar by resolving the Avatar_Manifest mapping against the files present in `.kilo/docs/media/avatars/`, without depending on any hardcoded filename.
5. IF the Avatar referenced by the Avatar_Manifest for a seeded Member is absent from `.kilo/docs/media/avatars/`, THEN THE Seed_Runner SHALL seed that Member with an absent Avatar reference so that the Web_Terminal displays the Placeholder_Avatar, and SHALL record a diagnostic identifying the unmapped Member without aborting the remaining seed operation.
6. THE Seed_Runner SHALL document the Avatar_Manifest mapping convention so that adding an image file to a Media_Asset_Folder and updating the manifest deterministically associates that image with a seeded persona.
7. WHEN the Seed_Runner seeds community and mission demo content, THE Seed_Runner SHALL draw persona names, providers, crew roles, bases, and narrative content from `.kilo/docs` sources so that seeded records are realistic for the Western Pennsylvania HEMS setting.
8. THE Seed_Dataset SHALL contain only De-identified_Data and simulated content and SHALL contain no real-world patient identifier, consistent with the simulation-only data policy.
9. IF the Seed_Runner encounters a record that violates a table constraint during seeding, THEN THE Seed_Runner SHALL reject that record, record a diagnostic identifying the failed record and constraint, and continue seeding the remaining records without leaving the database in a partially inconsistent seeded state for other tables.

### Requirement 9: Community Forum and Discussion Board (Optional)

**User Story:** As a Member, I want a community forum with topics and replies, so that Members can hold public discussions about missions, procedures, and the community.

This requirement is OPTIONAL and is presented for the user to accept or drop. It is not part of the confirmed core scope.

#### Acceptance Criteria

1. WHEN an authenticated Member creates a forum topic with a title of 1 to 200 characters and a body of 1 to 20,000 characters, THE Platform SHALL persist the topic with its author identifier, title, body, and creation timestamp.
2. WHEN an authenticated Member posts a reply of 1 to 20,000 characters to an existing forum topic, THE Platform SHALL persist the reply with its author identifier, parent topic reference, body, and creation timestamp.
3. THE Platform SHALL enforce RLS so that a Member can edit or delete only forum topics and replies whose author identifier equals that Member's identifier, unless the Member holds an Authorized_Operational_Role permitted broader moderation access.
4. IF an unauthenticated client requests to create, edit, or delete a forum topic or reply, THEN THE Platform SHALL deny the request and return an error indicating authentication is required, mutating no record.
5. WHERE forum topics and replies are displayed on a public route, THE Platform SHALL return only De-identified_Data and SHALL exclude any patient, clinical, or VIRS record.
6. IF a forum topic or reply contains a detectable real-world patient identifier, THEN THE Platform SHALL reject the submission under the simulation-only data policy and persist none of the submitted content.

### Requirement 10: Enhanced Public Member Directory Discovery (Optional)

**User Story:** As a visitor, I want to search and filter the member directory by callsign, crew role, or home base, so that I can find specific members more easily.

This requirement is OPTIONAL and is presented for the user to accept or drop. Requirement 6 already establishes the core directory; this requirement adds discovery features on top of it.

#### Acceptance Criteria

1. WHEN a visitor searches the Member_Directory by a callsign query, THE Web_Terminal SHALL return only Members visible to that visitor whose callsign matches the query, applying the De-identified_Data boundary of Requirement 5.
2. WHEN a visitor filters the Member_Directory by Crew_Role or home base, THE Web_Terminal SHALL return only Members visible to that visitor who match the selected filter.
3. WHEN a Member_Directory search or filter yields no visible Members, THE Web_Terminal SHALL return an explicit empty-result indication and SHALL suggest clearing or broadening the search or filter.
4. THE Web_Terminal SHALL exclude from every search and filter result any Member not visible to the requester under the Profile_Visibility rules of Requirements 5 and 6.

## Notes on Optional Scope

Requirements 9 (Community Forum) and 10 (Enhanced Directory Discovery) are optional. The confirmed core scope is the rich editable profile (Requirement 1), profile authorization (Requirement 2), avatars and cover photos (Requirement 3), the flight-log and statistics summary (Requirement 4), public de-identified profile pages (Requirement 5), the core member directory (Requirement 6), direct messages between members (Requirement 7), and full reproducible seed data for every table including the direct-messaging tables (Requirement 8). The user may accept or drop each optional requirement without affecting the core requirements.
