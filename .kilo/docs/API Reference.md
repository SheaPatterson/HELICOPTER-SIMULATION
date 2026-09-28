# **API Reference**

**Base URL:** *`https://hems.base44.app/api`*

```bash
npm install @base44/sdk
```

```javascript
import { createClient } from '@base44/sdk';
```

# Setup

```css
import { createClient } from '@base44/sdk';

const base44 = createClient({
  appId: "691942d07f68103164a78844",
  headers: {
    "Authorization": "Bearer b44u_2649daf3c03761656392c387ca588d4e0e6bcd5a7fc5ffe8b6ed01230797b5bc"
  }
});
```

---

# UserReputation

### Schema

| **Field**            | **Type** | **Required** | **Description**                       |
| -------------------- | -------- | ------------ | ------------------------------------- |
| `user_email`         | string   | Yes          |                                       |
| `reputation_points`  | number   |              |                                       |
| `posts_created`      | number   |              |                                       |
| `helpful_votes`      | number   |              |                                       |
| `wiki_contributions` | number   |              |                                       |
| `badges`             | array    |              |                                       |
| `is_moderator`       | boolean  |              |                                       |
| `id`                 | string   |              | Unique record identifier              |
| `created_date`       | string   |              | Record creation timestamp             |
| `updated_date`       | string   |              | Record last update timestamp          |
| `created_by_id`      | string   |              | ID of the user who created the record |

### Endpoints

### `GET /entities/UserReputation`

List UserReputation records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.UserReputation.list();
```

### `POST /entities/UserReputation`

Create a UserReputation record

```javascript
const record = await base44.entities.UserReputation.create({
  // your data
});
```

### `DELETE /entities/UserReputation`

Delete multiple UserReputation records

```javascript
await base44.entities.UserReputation.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  user_email: "Example user_email"
});
```

### `POST /entities/UserReputation/bulk`

Bulk create UserReputation records

```javascript
const records = await base44.entities.UserReputation.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/UserReputation/bulk`

Bulk update UserReputation records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/UserReputation/update-many`

Update many UserReputation records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/UserReputation/{UserReputation_id}`

Get a UserReputation record by ID

**Parameters:**

- `UserReputation_id` (path): Record ID

```javascript
const record = await base44.entities.UserReputation.get(recordId);
```

### `PUT /entities/UserReputation/{UserReputation_id}`

Update a UserReputation record

**Parameters:**

- `UserReputation_id` (path): Record ID

```javascript
const record = await base44.entities.UserReputation.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/UserReputation/{UserReputation_id}`

Delete a UserReputation record

**Parameters:**

- `UserReputation_id` (path): Record ID

```javascript
await base44.entities.UserReputation.delete(recordId);
```

### `PUT /entities/UserReputation/{UserReputation_id}/restore`

Restore a deleted UserReputation record

**Parameters:**

- `UserReputation_id` (path): Record ID

```javascript
const record = await base44.entities.UserReputation.restore(recordId);
```

---

# Mission

### Schema

| **Field**                 | **Type**                                                                                | **Required** | **Description**                               |
| ------------------------- | --------------------------------------------------------------------------------------- | ------------ | --------------------------------------------- |
| `mission_number`          | string                                                                                  | Yes          | Unique mission identifier (e.g., HEMS-873848) |
| `status`                  | `Planning`, `Dispatched`, `En Route`, `On Scene`, `Returning`, `Completed`, `Cancelled` |              |                                               |
| `go_no_go_status`         | `GO`, `NO-GO`, `STANDBY`                                                                |              |                                               |
| `mission_type`            | `Scene Response`, `Hospital Transfer`, `Standby`                                        |              |                                               |
| `call_time`               | string                                                                                  |              | Time mission was called in                    |
| `base_id`                 | string                                                                                  |              | Reference to Base entity                      |
| `aircraft_id`             | string                                                                                  |              | Reference to Aircraft entity                  |
| `origin_hospital_id`      | string                                                                                  |              | Departure hospital/base reference             |
| `destination_hospital_id` | string                                                                                  |              | Destination hospital reference                |
| `scene_location`          | object                                                                                  |              |                                               |
| `crew`                    | object                                                                                  |              |                                               |
| `patient_info`            | object                                                                                  |              |                                               |
| `flight_plan`             | object                                                                                  |              |                                               |
| `aircraft_specs`          | object                                                                                  |              |                                               |
| `weather_briefing`        | object                                                                                  |              |                                               |
| `times`                   | object                                                                                  |              |                                               |
| `fuel_tracking`           | object                                                                                  |              |                                               |
| `weight_balance`          | object                                                                                  |              |                                               |
| `notes`                   | string                                                                                  |              |                                               |
| `special_considerations`  | array                                                                                   |              |                                               |
| `id`                      | string                                                                                  |              | Unique record identifier                      |
| `created_date`            | string                                                                                  |              | Record creation timestamp                     |
| `updated_date`            | string                                                                                  |              | Record last update timestamp                  |
| `created_by_id`           | string                                                                                  |              | ID of the user who created the record         |

### Endpoints

### `GET /entities/Mission`

List Mission records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.Mission.list();
```

### `POST /entities/Mission`

Create a Mission record

```javascript
const record = await base44.entities.Mission.create({
  // your data
});
```

### `DELETE /entities/Mission`

Delete multiple Mission records

```javascript
await base44.entities.Mission.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  mission_number: "Example mission_number"
});
```

### `POST /entities/Mission/bulk`

Bulk create Mission records

```javascript
const records = await base44.entities.Mission.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/Mission/bulk`

Bulk update Mission records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/Mission/update-many`

Update many Mission records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/Mission/{Mission_id}`

Get a Mission record by ID

**Parameters:**

- `Mission_id` (path): Record ID

```javascript
const record = await base44.entities.Mission.get(recordId);
```

### `PUT /entities/Mission/{Mission_id}`

Update a Mission record

**Parameters:**

- `Mission_id` (path): Record ID

```javascript
const record = await base44.entities.Mission.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/Mission/{Mission_id}`

Delete a Mission record

**Parameters:**

- `Mission_id` (path): Record ID

```javascript
await base44.entities.Mission.delete(recordId);
```

### `PUT /entities/Mission/{Mission_id}/restore`

Restore a deleted Mission record

**Parameters:**

- `Mission_id` (path): Record ID

```javascript
const record = await base44.entities.Mission.restore(recordId);
```

---

# FlightTelemetry

### Schema

| **Field**                | **Type**                   | **Required** | **Description**                                        |
| ------------------------ | -------------------------- | ------------ | ------------------------------------------------------ |
| `mission_id`             | string                     |              | Associated mission ID if applicable                    |
| `user_callsign`          | string                     |              | Pilot email address (used to link telemetry to a user) |
| `aircraft_type`          | string                     |              | Aircraft model from simulator                          |
| `simulator`              | `MSFS`, `X-Plane`, `Other` |              | Simulator type                                         |
| `latitude`               | number                     | Yes          |                                                        |
| `longitude`              | number                     | Yes          |                                                        |
| `altitude_ft`            | number                     | Yes          |                                                        |
| `heading_degrees`        | number                     |              |                                                        |
| `ground_speed_kts`       | number                     |              |                                                        |
| `vertical_speed_fpm`     | number                     |              |                                                        |
| `indicated_airspeed_kts` | number                     |              |                                                        |
| `on_ground`              | boolean                    |              |                                                        |
| `engine_running`         | boolean                    |              |                                                        |
| `fuel_quantity_gal`      | number                     |              |                                                        |
| `session_id`             | string                     | Yes          | Unique flight session identifier                       |
| `timestamp`              | string                     |              |                                                        |
| `id`                     | string                     |              | Unique record identifier                               |
| `created_date`           | string                     |              | Record creation timestamp                              |
| `updated_date`           | string                     |              | Record last update timestamp                           |
| `created_by_id`          | string                     |              | ID of the user who created the record                  |

### Endpoints

### `GET /entities/FlightTelemetry`

List FlightTelemetry records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.FlightTelemetry.list();
```

### `POST /entities/FlightTelemetry`

Create a FlightTelemetry record

```javascript
const record = await base44.entities.FlightTelemetry.create({
  // your data
});
```

### `DELETE /entities/FlightTelemetry`

Delete multiple FlightTelemetry records

```javascript
await base44.entities.FlightTelemetry.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  latitude: 0
});
```

### `POST /entities/FlightTelemetry/bulk`

Bulk create FlightTelemetry records

```javascript
const records = await base44.entities.FlightTelemetry.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/FlightTelemetry/bulk`

Bulk update FlightTelemetry records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/FlightTelemetry/update-many`

Update many FlightTelemetry records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/FlightTelemetry/{FlightTelemetry_id}`

Get a FlightTelemetry record by ID

**Parameters:**

- `FlightTelemetry_id` (path): Record ID

```javascript
const record = await base44.entities.FlightTelemetry.get(recordId);
```

### `PUT /entities/FlightTelemetry/{FlightTelemetry_id}`

Update a FlightTelemetry record

**Parameters:**

- `FlightTelemetry_id` (path): Record ID

```javascript
const record = await base44.entities.FlightTelemetry.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/FlightTelemetry/{FlightTelemetry_id}`

Delete a FlightTelemetry record

**Parameters:**

- `FlightTelemetry_id` (path): Record ID

```javascript
await base44.entities.FlightTelemetry.delete(recordId);
```

### `PUT /entities/FlightTelemetry/{FlightTelemetry_id}/restore`

Restore a deleted FlightTelemetry record

**Parameters:**

- `FlightTelemetry_id` (path): Record ID

```javascript
const record = await base44.entities.FlightTelemetry.restore(recordId);
```

---

# Airport

### Schema

| **Field**          | **Type**                                                                        | **Required** | **Description**                       |
| ------------------ | ------------------------------------------------------------------------------- | ------------ | ------------------------------------- |
| `identifier`       | string                                                                          | Yes          | Airport identifier (ICAO or FAA)      |
| `name`             | string                                                                          | Yes          |                                       |
| `type`             | `Large Airport`, `Medium Airport`, `Small Airport`, `Heliport`, `Seaplane Base` |              |                                       |
| `city`             | string                                                                          |              |                                       |
| `state`            | string                                                                          |              |                                       |
| `country`          | string                                                                          |              |                                       |
| `latitude`         | number                                                                          | Yes          |                                       |
| `longitude`        | number                                                                          | Yes          |                                       |
| `elevation_ft`     | number                                                                          |              |                                       |
| `tower_frequency`  | string                                                                          |              |                                       |
| `unicom_frequency` | string                                                                          |              |                                       |
| `atis_frequency`   | string                                                                          |              |                                       |
| `has_fuel`         | boolean                                                                         |              |                                       |
| `fuel_types`       | array                                                                           |              |                                       |
| `has_maintenance`  | boolean                                                                         |              |                                       |
| `remarks`          | string                                                                          |              |                                       |
| `id`               | string                                                                          |              | Unique record identifier              |
| `created_date`     | string                                                                          |              | Record creation timestamp             |
| `updated_date`     | string                                                                          |              | Record last update timestamp          |
| `created_by_id`    | string                                                                          |              | ID of the user who created the record |

### Endpoints

### `GET /entities/Airport`

List Airport records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.Airport.list();
```

### `POST /entities/Airport`

Create a Airport record

```javascript
const record = await base44.entities.Airport.create({
  // your data
});
```

### `DELETE /entities/Airport`

Delete multiple Airport records

```javascript
await base44.entities.Airport.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  identifier: "Example identifier"
});
```

### `POST /entities/Airport/bulk`

Bulk create Airport records

```javascript
const records = await base44.entities.Airport.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/Airport/bulk`

Bulk update Airport records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/Airport/update-many`

Update many Airport records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/Airport/{Airport_id}`

Get a Airport record by ID

**Parameters:**

- `Airport_id` (path): Record ID

```javascript
const record = await base44.entities.Airport.get(recordId);
```

### `PUT /entities/Airport/{Airport_id}`

Update a Airport record

**Parameters:**

- `Airport_id` (path): Record ID

```javascript
const record = await base44.entities.Airport.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/Airport/{Airport_id}`

Delete a Airport record

**Parameters:**

- `Airport_id` (path): Record ID

```javascript
await base44.entities.Airport.delete(recordId);
```

### `PUT /entities/Airport/{Airport_id}/restore`

Restore a deleted Airport record

**Parameters:**

- `Airport_id` (path): Record ID

```javascript
const record = await base44.entities.Airport.restore(recordId);
```

---

# DispatchMessage

### Schema

| **Field**                 | **Type**                                   | **Required** | **Description**                                          |
| ------------------------- | ------------------------------------------ | ------------ | -------------------------------------------------------- |
| `mission_id`              | string                                     | Yes          | Associated mission ID                                    |
| `sender`                  | string                                     | Yes          | Message sender (DISPATCH, pilot email, DISPATCH_CONTROL) |
| `recipient`               | string                                     |              | Message recipient email                                  |
| `message_type`            | `text`, `voice`, `alert`, `remote_command` |              |                                                          |
| `content`                 | string                                     | Yes          | Message content or transcription                         |
| `audio_url`               | string                                     |              | Voice message audio file URL                             |
| `priority`                | `normal`, `urgent`, `emergency`            |              |                                                          |
| `read`                    | boolean                                    |              |                                                          |
| `requires_acknowledgment` | boolean                                    |              |                                                          |
| `acknowledged`            | boolean                                    |              |                                                          |
| `acknowledged_at`         | string                                     |              |                                                          |
| `id`                      | string                                     |              | Unique record identifier                                 |
| `created_date`            | string                                     |              | Record creation timestamp                                |
| `updated_date`            | string                                     |              | Record last update timestamp                             |
| `created_by_id`           | string                                     |              | ID of the user who created the record                    |

### Endpoints

### `GET /entities/DispatchMessage`

List DispatchMessage records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.DispatchMessage.list();
```

### `POST /entities/DispatchMessage`

Create a DispatchMessage record

```javascript
const record = await base44.entities.DispatchMessage.create({
  // your data
});
```

### `DELETE /entities/DispatchMessage`

Delete multiple DispatchMessage records

```javascript
await base44.entities.DispatchMessage.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  mission_id: "Example mission_id"
});
```

### `POST /entities/DispatchMessage/bulk`

Bulk create DispatchMessage records

```javascript
const records = await base44.entities.DispatchMessage.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/DispatchMessage/bulk`

Bulk update DispatchMessage records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/DispatchMessage/update-many`

Update many DispatchMessage records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/DispatchMessage/{DispatchMessage_id}`

Get a DispatchMessage record by ID

**Parameters:**

- `DispatchMessage_id` (path): Record ID

```javascript
const record = await base44.entities.DispatchMessage.get(recordId);
```

### `PUT /entities/DispatchMessage/{DispatchMessage_id}`

Update a DispatchMessage record

**Parameters:**

- `DispatchMessage_id` (path): Record ID

```javascript
const record = await base44.entities.DispatchMessage.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/DispatchMessage/{DispatchMessage_id}`

Delete a DispatchMessage record

**Parameters:**

- `DispatchMessage_id` (path): Record ID

```javascript
await base44.entities.DispatchMessage.delete(recordId);
```

### `PUT /entities/DispatchMessage/{DispatchMessage_id}/restore`

Restore a deleted DispatchMessage record

**Parameters:**

- `DispatchMessage_id` (path): Record ID

```javascript
const record = await base44.entities.DispatchMessage.restore(recordId);
```

---

# FlightRoute

### Schema

| **Field**             | **Type** | **Required** | **Description**                            |
| --------------------- | -------- | ------------ | ------------------------------------------ |
| `route_name`          | string   | Yes          | Name of the saved route                    |
| `waypoints`           | array    | Yes          | Ordered list of waypoints in route         |
| `total_distance_nm`   | number   |              | Total route distance in nautical miles     |
| `estimated_time_min`  | number   |              | Estimated flight time in minutes           |
| `route_description`   | string   |              | Text description of route                  |
| `aircraft_type`       | string   |              |                                            |
| `cruise_altitude_ft`  | number   |              |                                            |
| `airspace_notes`      | array    |              | Notes about airspace along route           |
| `terrain_warnings`    | array    |              |                                            |
| `fuel_required_gal`   | number   |              |                                            |
| `created_for_mission` | string   |              | Mission ID if created for specific mission |
| `id`                  | string   |              | Unique record identifier                   |
| `created_date`        | string   |              | Record creation timestamp                  |
| `updated_date`        | string   |              | Record last update timestamp               |
| `created_by_id`       | string   |              | ID of the user who created the record      |

### Endpoints

### `GET /entities/FlightRoute`

List FlightRoute records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.FlightRoute.list();
```

### `POST /entities/FlightRoute`

Create a FlightRoute record

```javascript
const record = await base44.entities.FlightRoute.create({
  // your data
});
```

### `DELETE /entities/FlightRoute`

Delete multiple FlightRoute records

```javascript
await base44.entities.FlightRoute.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  route_name: "Example route_name"
});
```

### `POST /entities/FlightRoute/bulk`

Bulk create FlightRoute records

```javascript
const records = await base44.entities.FlightRoute.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/FlightRoute/bulk`

Bulk update FlightRoute records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/FlightRoute/update-many`

Update many FlightRoute records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/FlightRoute/{FlightRoute_id}`

Get a FlightRoute record by ID

**Parameters:**

- `FlightRoute_id` (path): Record ID

```javascript
const record = await base44.entities.FlightRoute.get(recordId);
```

### `PUT /entities/FlightRoute/{FlightRoute_id}`

Update a FlightRoute record

**Parameters:**

- `FlightRoute_id` (path): Record ID

```javascript
const record = await base44.entities.FlightRoute.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/FlightRoute/{FlightRoute_id}`

Delete a FlightRoute record

**Parameters:**

- `FlightRoute_id` (path): Record ID

```javascript
await base44.entities.FlightRoute.delete(recordId);
```

### `PUT /entities/FlightRoute/{FlightRoute_id}/restore`

Restore a deleted FlightRoute record

**Parameters:**

- `FlightRoute_id` (path): Record ID

```javascript
const record = await base44.entities.FlightRoute.restore(recordId);
```

---

# Waypoint

### Schema

| **Field**       | **Type**                                                  | **Required** | **Description**                            |
| --------------- | --------------------------------------------------------- | ------------ | ------------------------------------------ |
| `identifier`    | string                                                    | Yes          | Waypoint identifier from SkyVector         |
| `name`          | string                                                    |              | Full name of waypoint                      |
| `type`          | `GPS`, `RNAV`, `VFR Checkpoint`, `Custom`, `Intersection` | Yes          | Type of waypoint                           |
| `latitude`      | number                                                    | Yes          |                                            |
| `longitude`     | number                                                    | Yes          |                                            |
| `usage`         | string                                                    |              | When/where this waypoint is typically used |
| `region`        | string                                                    |              | Geographic region                          |
| `notes`         | string                                                    |              |                                            |
| `id`            | string                                                    |              | Unique record identifier                   |
| `created_date`  | string                                                    |              | Record creation timestamp                  |
| `updated_date`  | string                                                    |              | Record last update timestamp               |
| `created_by_id` | string                                                    |              | ID of the user who created the record      |

### Endpoints

### `GET /entities/Waypoint`

List Waypoint records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.Waypoint.list();
```

### `POST /entities/Waypoint`

Create a Waypoint record

```javascript
const record = await base44.entities.Waypoint.create({
  // your data
});
```

### `DELETE /entities/Waypoint`

Delete multiple Waypoint records

```javascript
await base44.entities.Waypoint.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  identifier: "Example identifier"
});
```

### `POST /entities/Waypoint/bulk`

Bulk create Waypoint records

```javascript
const records = await base44.entities.Waypoint.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/Waypoint/bulk`

Bulk update Waypoint records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/Waypoint/update-many`

Update many Waypoint records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/Waypoint/{Waypoint_id}`

Get a Waypoint record by ID

**Parameters:**

- `Waypoint_id` (path): Record ID

```javascript
const record = await base44.entities.Waypoint.get(recordId);
```

### `PUT /entities/Waypoint/{Waypoint_id}`

Update a Waypoint record

**Parameters:**

- `Waypoint_id` (path): Record ID

```javascript
const record = await base44.entities.Waypoint.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/Waypoint/{Waypoint_id}`

Delete a Waypoint record

**Parameters:**

- `Waypoint_id` (path): Record ID

```javascript
await base44.entities.Waypoint.delete(recordId);
```

### `PUT /entities/Waypoint/{Waypoint_id}/restore`

Restore a deleted Waypoint record

**Parameters:**

- `Waypoint_id` (path): Record ID

```javascript
const record = await base44.entities.Waypoint.restore(recordId);
```

---

# UserAlertPreferences

### Schema

| **Field**                     | **Type**                            | **Required** | **Description**                          |
| ----------------------------- | ----------------------------------- | ------------ | ---------------------------------------- |
| `user_email`                  | string                              | Yes          |                                          |
| `push_notifications_enabled`  | boolean                             |              |                                          |
| `email_notifications_enabled` | boolean                             |              |                                          |
| `alert_types`                 | object                              |              |                                          |
| `priority_threshold`          | `all`, `medium`, `high`, `critical` |              | Minimum priority level for notifications |
| `quiet_hours`                 | object                              |              |                                          |
| `sound_enabled`               | boolean                             |              |                                          |
| `id`                          | string                              |              | Unique record identifier                 |
| `created_date`                | string                              |              | Record creation timestamp                |
| `updated_date`                | string                              |              | Record last update timestamp             |
| `created_by_id`               | string                              |              | ID of the user who created the record    |

### Endpoints

### `GET /entities/UserAlertPreferences`

List UserAlertPreferences records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.UserAlertPreferences.list();
```

### `POST /entities/UserAlertPreferences`

Create a UserAlertPreferences record

```javascript
const record = await base44.entities.UserAlertPreferences.create({
  // your data
});
```

### `DELETE /entities/UserAlertPreferences`

Delete multiple UserAlertPreferences records

```javascript
await base44.entities.UserAlertPreferences.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  user_email: "Example user_email"
});
```

### `POST /entities/UserAlertPreferences/bulk`

Bulk create UserAlertPreferences records

```javascript
const records = await base44.entities.UserAlertPreferences.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/UserAlertPreferences/bulk`

Bulk update UserAlertPreferences records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/UserAlertPreferences/update-many`

Update many UserAlertPreferences records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/UserAlertPreferences/{UserAlertPreferences_id}`

Get a UserAlertPreferences record by ID

**Parameters:**

- `UserAlertPreferences_id` (path): Record ID

```javascript
const record = await base44.entities.UserAlertPreferences.get(recordId);
```

### `PUT /entities/UserAlertPreferences/{UserAlertPreferences_id}`

Update a UserAlertPreferences record

**Parameters:**

- `UserAlertPreferences_id` (path): Record ID

```javascript
const record = await base44.entities.UserAlertPreferences.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/UserAlertPreferences/{UserAlertPreferences_id}`

Delete a UserAlertPreferences record

**Parameters:**

- `UserAlertPreferences_id` (path): Record ID

```javascript
await base44.entities.UserAlertPreferences.delete(recordId);
```

### `PUT /entities/UserAlertPreferences/{UserAlertPreferences_id}/restore`

Restore a deleted UserAlertPreferences record

**Parameters:**

- `UserAlertPreferences_id` (path): Record ID

```javascript
const record = await base44.entities.UserAlertPreferences.restore(recordId);
```

---

# IncidentReport

### Schema

| **Field**               | **Type**                                                                  | **Required** | **Description**                       |
| ----------------------- | ------------------------------------------------------------------------- | ------------ | ------------------------------------- |
| `mission_id`            | string                                                                    | Yes          | Reference to the Mission              |
| `report_number`         | string                                                                    | Yes          | Unique report identifier              |
| `report_date`           | string                                                                    |              |                                       |
| `report_type`           | `Routine`, `Incident`, `Near Miss`, `Safety Concern`, `Equipment Failure` | Yes          |                                       |
| `mission_outcome`       | object                                                                    |              |                                       |
| `critical_events`       | array                                                                     |              |                                       |
| `aircraft_performance`  | object                                                                    |              |                                       |
| `crew_performance`      | object                                                                    |              |                                       |
| `medical_interventions` | array                                                                     |              | List of medical procedures performed  |
| `attachments`           | array                                                                     |              |                                       |
| `lessons_learned`       | string                                                                    |              |                                       |
| `recommendations`       | string                                                                    |              |                                       |
| `reviewed_by`           | string                                                                    |              |                                       |
| `review_date`           | string                                                                    |              |                                       |
| `review_status`         | `Pending`, `Under Review`, `Approved`, `Requires Follow-up`               |              |                                       |
| `id`                    | string                                                                    |              | Unique record identifier              |
| `created_date`          | string                                                                    |              | Record creation timestamp             |
| `updated_date`          | string                                                                    |              | Record last update timestamp          |
| `created_by_id`         | string                                                                    |              | ID of the user who created the record |

### Endpoints

### `GET /entities/IncidentReport`

List IncidentReport records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.IncidentReport.list();
```

### `POST /entities/IncidentReport`

Create a IncidentReport record

```javascript
const record = await base44.entities.IncidentReport.create({
  // your data
});
```

### `DELETE /entities/IncidentReport`

Delete multiple IncidentReport records

```javascript
await base44.entities.IncidentReport.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  mission_id: "Example mission_id"
});
```

### `POST /entities/IncidentReport/bulk`

Bulk create IncidentReport records

```javascript
const records = await base44.entities.IncidentReport.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/IncidentReport/bulk`

Bulk update IncidentReport records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/IncidentReport/update-many`

Update many IncidentReport records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/IncidentReport/{IncidentReport_id}`

Get a IncidentReport record by ID

**Parameters:**

- `IncidentReport_id` (path): Record ID

```javascript
const record = await base44.entities.IncidentReport.get(recordId);
```

### `PUT /entities/IncidentReport/{IncidentReport_id}`

Update a IncidentReport record

**Parameters:**

- `IncidentReport_id` (path): Record ID

```javascript
const record = await base44.entities.IncidentReport.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/IncidentReport/{IncidentReport_id}`

Delete a IncidentReport record

**Parameters:**

- `IncidentReport_id` (path): Record ID

```javascript
await base44.entities.IncidentReport.delete(recordId);
```

### `PUT /entities/IncidentReport/{IncidentReport_id}/restore`

Restore a deleted IncidentReport record

**Parameters:**

- `IncidentReport_id` (path): Record ID

```javascript
const record = await base44.entities.IncidentReport.restore(recordId);
```

---

# AssetMaintenance

### Schema

| **Field**              | **Type**                                                | **Required** | **Description**                         |
| ---------------------- | ------------------------------------------------------- | ------------ | --------------------------------------- |
| `asset_id`             | string                                                  | Yes          | Reference to Aircraft or other asset    |
| `asset_type`           | `aircraft`, `vehicle`, `equipment`                      | Yes          |                                         |
| `maintenance_type`     | `scheduled`, `preventative`, `corrective`, `inspection` | Yes          |                                         |
| `status`               | `scheduled`, `in_progress`, `completed`, `overdue`      |              |                                         |
| `scheduled_date`       | string                                                  |              |                                         |
| `completed_date`       | string                                                  |              |                                         |
| `next_due_date`        | string                                                  |              |                                         |
| `hours_at_maintenance` | number                                                  |              | Flight hours at time of maintenance     |
| `maintenance_items`    | array                                                   |              |                                         |
| `technician`           | string                                                  |              |                                         |
| `cost`                 | number                                                  |              |                                         |
| `notes`                | string                                                  |              |                                         |
| `ai_recommendation`    | string                                                  |              | AI-generated maintenance recommendation |
| `id`                   | string                                                  |              | Unique record identifier                |
| `created_date`         | string                                                  |              | Record creation timestamp               |
| `updated_date`         | string                                                  |              | Record last update timestamp            |
| `created_by_id`        | string                                                  |              | ID of the user who created the record   |

### Endpoints

### `GET /entities/AssetMaintenance`

List AssetMaintenance records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.AssetMaintenance.list();
```

### `POST /entities/AssetMaintenance`

Create a AssetMaintenance record

```javascript
const record = await base44.entities.AssetMaintenance.create({
  // your data
});
```

### `DELETE /entities/AssetMaintenance`

Delete multiple AssetMaintenance records

```javascript
await base44.entities.AssetMaintenance.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  asset_id: "Example asset_id"
});
```

### `POST /entities/AssetMaintenance/bulk`

Bulk create AssetMaintenance records

```javascript
const records = await base44.entities.AssetMaintenance.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/AssetMaintenance/bulk`

Bulk update AssetMaintenance records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/AssetMaintenance/update-many`

Update many AssetMaintenance records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/AssetMaintenance/{AssetMaintenance_id}`

Get a AssetMaintenance record by ID

**Parameters:**

- `AssetMaintenance_id` (path): Record ID

```javascript
const record = await base44.entities.AssetMaintenance.get(recordId);
```

### `PUT /entities/AssetMaintenance/{AssetMaintenance_id}`

Update a AssetMaintenance record

**Parameters:**

- `AssetMaintenance_id` (path): Record ID

```javascript
const record = await base44.entities.AssetMaintenance.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/AssetMaintenance/{AssetMaintenance_id}`

Delete a AssetMaintenance record

**Parameters:**

- `AssetMaintenance_id` (path): Record ID

```javascript
await base44.entities.AssetMaintenance.delete(recordId);
```

### `PUT /entities/AssetMaintenance/{AssetMaintenance_id}/restore`

Restore a deleted AssetMaintenance record

**Parameters:**

- `AssetMaintenance_id` (path): Record ID

```javascript
const record = await base44.entities.AssetMaintenance.restore(recordId);
```

---

# Alert

### Schema

| **Field**         | **Type**                                                                                                          | **Required** | **Description**                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------- |
| `alert_type`      | `emergency`, `mission_critical`, `system_failure`, `weather_warning`, `aircraft_issue`, `dispatch_urgent`, `info` | Yes          | Type of alert                             |
| `priority`        | `critical`, `high`, `medium`, `low`                                                                               | Yes          |                                           |
| `title`           | string                                                                                                            | Yes          | Alert title                               |
| `message`         | string                                                                                                            | Yes          | Alert message content                     |
| `mission_id`      | string                                                                                                            |              | Related mission if applicable             |
| `aircraft_id`     | string                                                                                                            |              | Related aircraft if applicable            |
| `triggered_by`    | string                                                                                                            |              | User who triggered alert or 'system'      |
| `acknowledged`    | boolean                                                                                                           |              |                                           |
| `acknowledged_by` | string                                                                                                            |              |                                           |
| `acknowledged_at` | string                                                                                                            |              |                                           |
| `requires_action` | boolean                                                                                                           |              |                                           |
| `action_taken`    | string                                                                                                            |              |                                           |
| `expires_at`      | string                                                                                                            |              |                                           |
| `recipients`      | array                                                                                                             |              | User emails who should receive this alert |
| `metadata`        | object                                                                                                            |              | Additional context data                   |
| `id`              | string                                                                                                            |              | Unique record identifier                  |
| `created_date`    | string                                                                                                            |              | Record creation timestamp                 |
| `updated_date`    | string                                                                                                            |              | Record last update timestamp              |
| `created_by_id`   | string                                                                                                            |              | ID of the user who created the record     |

### Endpoints

### `GET /entities/Alert`

List Alert records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.Alert.list();
```

### `POST /entities/Alert`

Create a Alert record

```javascript
const record = await base44.entities.Alert.create({
  // your data
});
```

### `DELETE /entities/Alert`

Delete multiple Alert records

```javascript
await base44.entities.Alert.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  alert_type: "emergency"
});
```

### `POST /entities/Alert/bulk`

Bulk create Alert records

```javascript
const records = await base44.entities.Alert.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/Alert/bulk`

Bulk update Alert records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/Alert/update-many`

Update many Alert records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/Alert/{Alert_id}`

Get a Alert record by ID

**Parameters:**

- `Alert_id` (path): Record ID

```javascript
const record = await base44.entities.Alert.get(recordId);
```

### `PUT /entities/Alert/{Alert_id}`

Update a Alert record

**Parameters:**

- `Alert_id` (path): Record ID

```javascript
const record = await base44.entities.Alert.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/Alert/{Alert_id}`

Delete a Alert record

**Parameters:**

- `Alert_id` (path): Record ID

```javascript
await base44.entities.Alert.delete(recordId);
```

### `PUT /entities/Alert/{Alert_id}/restore`

Restore a deleted Alert record

**Parameters:**

- `Alert_id` (path): Record ID

```javascript
const record = await base44.entities.Alert.restore(recordId);
```

## 

---

# PilotAPIKey

### Schema

| **Field**        | **Type**                                   | **Required** | **Description**                             |
| ---------------- | ------------------------------------------ | ------------ | ------------------------------------------- |
| `pilot_email`    | string                                     | Yes          | Email of the pilot this API key belongs to  |
| `api_key`        | string                                     | Yes          | Generated API key for plugin authentication |
| `simulator_type` | `X-Plane`, `MSFS`, `Prepar3D`, `Universal` |              |                                             |
| `last_used`      | string                                     |              | Last time this API key was used             |
| `active`         | boolean                                    |              |                                             |
| `plugin_version` | string                                     |              |                                             |
| `id`             | string                                     |              | Unique record identifier                    |
| `created_date`   | string                                     |              | Record creation timestamp                   |
| `updated_date`   | string                                     |              | Record last update timestamp                |
| `created_by_id`  | string                                     |              | ID of the user who created the record       |

### Endpoints

### `GET /entities/PilotAPIKey`

List PilotAPIKey records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.PilotAPIKey.list();
```

### `POST /entities/PilotAPIKey`

Create a PilotAPIKey record

```javascript
const record = await base44.entities.PilotAPIKey.create({
  // your data
});
```

### `DELETE /entities/PilotAPIKey`

Delete multiple PilotAPIKey records

```javascript
await base44.entities.PilotAPIKey.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  pilot_email: "Example pilot_email"
});
```

### `POST /entities/PilotAPIKey/bulk`

Bulk create PilotAPIKey records

```javascript
const records = await base44.entities.PilotAPIKey.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/PilotAPIKey/bulk`

Bulk update PilotAPIKey records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/PilotAPIKey/update-many`

Update many PilotAPIKey records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/PilotAPIKey/{PilotAPIKey_id}`

Get a PilotAPIKey record by ID

**Parameters:**

- `PilotAPIKey_id` (path): Record ID

```javascript
const record = await base44.entities.PilotAPIKey.get(recordId);
```

### `PUT /entities/PilotAPIKey/{PilotAPIKey_id}`

Update a PilotAPIKey record

**Parameters:**

- `PilotAPIKey_id` (path): Record ID

```javascript
const record = await base44.entities.PilotAPIKey.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/PilotAPIKey/{PilotAPIKey_id}`

Delete a PilotAPIKey record

**Parameters:**

- `PilotAPIKey_id` (path): Record ID

```javascript
await base44.entities.PilotAPIKey.delete(recordId);
```

### `PUT /entities/PilotAPIKey/{PilotAPIKey_id}/restore`

Restore a deleted PilotAPIKey record

**Parameters:**

- `PilotAPIKey_id` (path): Record ID

```javascript
const record = await base44.entities.PilotAPIKey.restore(recordId);
```

---

# Country

### Schema

| **Field**       | **Type** | **Required** | **Description**                       |
| --------------- | -------- | ------------ | ------------------------------------- |
| `country_name`  | string   | Yes          |                                       |
| `country_code`  | string   | Yes          | ISO 2-letter code (e.g., US)          |
| `continent`     | string   |              |                                       |
| `id`            | string   |              | Unique record identifier              |
| `created_date`  | string   |              | Record creation timestamp             |
| `updated_date`  | string   |              | Record last update timestamp          |
| `created_by_id` | string   |              | ID of the user who created the record |

### Endpoints

### `GET /entities/Country`

List Country records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.Country.list();
```

### `POST /entities/Country`

Create a Country record

```javascript
const record = await base44.entities.Country.create({
  // your data
});
```

### `DELETE /entities/Country`

Delete multiple Country records

```javascript
await base44.entities.Country.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  country_name: "Example country_name"
});
```

### `POST /entities/Country/bulk`

Bulk create Country records

```javascript
const records = await base44.entities.Country.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/Country/bulk`

Bulk update Country records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/Country/update-many`

Update many Country records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/Country/{Country_id}`

Get a Country record by ID

**Parameters:**

- `Country_id` (path): Record ID

```javascript
const record = await base44.entities.Country.get(recordId);
```

### `PUT /entities/Country/{Country_id}`

Update a Country record

**Parameters:**

- `Country_id` (path): Record ID

```javascript
const record = await base44.entities.Country.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/Country/{Country_id}`

Delete a Country record

**Parameters:**

- `Country_id` (path): Record ID

```javascript
await base44.entities.Country.delete(recordId);
```

### `PUT /entities/Country/{Country_id}/restore`

Restore a deleted Country record

**Parameters:**

- `Country_id` (path): Record ID

```javascript
const record = await base44.entities.Country.restore(recordId);
```

---

# Runway

### Schema

| **Field**            | **Type**                                        | **Required** | **Description**                       |
| -------------------- | ----------------------------------------------- | ------------ | ------------------------------------- |
| `airport_id`         | string                                          | Yes          | Reference to Airport                  |
| `runway_designation` | string                                          | Yes          | e.g., 10/28, 14R/32L                  |
| `length_ft`          | number                                          | Yes          |                                       |
| `width_ft`           | number                                          |              |                                       |
| `surface_type`       | `Asphalt`, `Concrete`, `Gravel`, `Turf`, `Dirt` |              |                                       |
| `lighted`            | boolean                                         |              |                                       |
| `marking_type`       | string                                          |              |                                       |
| `remarks`            | string                                          |              |                                       |
| `id`                 | string                                          |              | Unique record identifier              |
| `created_date`       | string                                          |              | Record creation timestamp             |
| `updated_date`       | string                                          |              | Record last update timestamp          |
| `created_by_id`      | string                                          |              | ID of the user who created the record |

### Endpoints

### `GET /entities/Runway`

List Runway records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.Runway.list();
```

### `POST /entities/Runway`

Create a Runway record

```javascript
const record = await base44.entities.Runway.create({
  // your data
});
```

### `DELETE /entities/Runway`

Delete multiple Runway records

```javascript
await base44.entities.Runway.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  airport_id: "Example airport_id"
});
```

### `POST /entities/Runway/bulk`

Bulk create Runway records

```javascript
const records = await base44.entities.Runway.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/Runway/bulk`

Bulk update Runway records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/Runway/update-many`

Update many Runway records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/Runway/{Runway_id}`

Get a Runway record by ID

**Parameters:**

- `Runway_id` (path): Record ID

```javascript
const record = await base44.entities.Runway.get(recordId);
```

### `PUT /entities/Runway/{Runway_id}`

Update a Runway record

**Parameters:**

- `Runway_id` (path): Record ID

```javascript
const record = await base44.entities.Runway.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/Runway/{Runway_id}`

Delete a Runway record

**Parameters:**

- `Runway_id` (path): Record ID

```javascript
await base44.entities.Runway.delete(recordId);
```

### `PUT /entities/Runway/{Runway_id}/restore`

Restore a deleted Runway record

**Parameters:**

- `Runway_id` (path): Record ID

```javascript
const record = await base44.entities.Runway.restore(recordId);
```

---

# CrewMember

### Schema

| **Field**           | **Type**                                                                                     | **Required** | **Description**                       |
| ------------------- | -------------------------------------------------------------------------------------------- | ------------ | ------------------------------------- |
| `full_name`         | string                                                                                       | Yes          |                                       |
| `employee_id`       | string                                                                                       |              |                                       |
| `role`              | `Pilot`, `Flight Nurse`, `Flight Paramedic`, `Flight Physician`, `Communications Specialist` | Yes          |                                       |
| `email`             | string                                                                                       |              |                                       |
| `phone`             | string                                                                                       |              |                                       |
| `base_id`           | string                                                                                       |              | Assigned base                         |
| `avatar_url`        | string                                                                                       |              |                                       |
| `certifications`    | array                                                                                        |              |                                       |
| `flight_hours`      | number                                                                                       |              |                                       |
| `status`            | `Available`, `On Shift`, `On Mission`, `Off Duty`, `On Leave`, `Training`                    |              |                                       |
| `current_shift`     | object                                                                                       |              |                                       |
| `active_mission_id` | string                                                                                       |              | Currently assigned mission ID         |
| `notes`             | string                                                                                       |              |                                       |
| `active`            | boolean                                                                                      |              |                                       |
| `id`                | string                                                                                       |              | Unique record identifier              |
| `created_date`      | string                                                                                       |              | Record creation timestamp             |
| `updated_date`      | string                                                                                       |              | Record last update timestamp          |
| `created_by_id`     | string                                                                                       |              | ID of the user who created the record |

### Endpoints

### `GET /entities/CrewMember`

List CrewMember records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.CrewMember.list();
```

### `POST /entities/CrewMember`

Create a CrewMember record

```javascript
const record = await base44.entities.CrewMember.create({
  // your data
});
```

### `DELETE /entities/CrewMember`

Delete multiple CrewMember records

```javascript
await base44.entities.CrewMember.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  full_name: "Example full_name"
});
```

### `POST /entities/CrewMember/bulk`

Bulk create CrewMember records

```javascript
const records = await base44.entities.CrewMember.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/CrewMember/bulk`

Bulk update CrewMember records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/CrewMember/update-many`

Update many CrewMember records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/CrewMember/{CrewMember_id}`

Get a CrewMember record by ID

**Parameters:**

- `CrewMember_id` (path): Record ID

```javascript
const record = await base44.entities.CrewMember.get(recordId);
```

### `PUT /entities/CrewMember/{CrewMember_id}`

Update a CrewMember record

**Parameters:**

- `CrewMember_id` (path): Record ID

```javascript
const record = await base44.entities.CrewMember.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/CrewMember/{CrewMember_id}`

Delete a CrewMember record

**Parameters:**

- `CrewMember_id` (path): Record ID

```javascript
await base44.entities.CrewMember.delete(recordId);
```

### `PUT /entities/CrewMember/{CrewMember_id}/restore`

Restore a deleted CrewMember record

**Parameters:**

- `CrewMember_id` (path): Record ID

```javascript
const record = await base44.entities.CrewMember.restore(recordId);
```

## TrainingRecommendation

### Schema

| **Field**               | **Type** | **Required** | **Description**                           |
| ----------------------- | -------- | ------------ | ----------------------------------------- |
| `pilot_email`           | string   | Yes          |                                           |
| `generated_date`        | string   |              |                                           |
| `analysis_summary`      | string   |              | AI-generated summary of pilot performance |
| `strengths`             | array    |              |                                           |
| `areas_for_improvement` | array    |              |                                           |
| `recommended_training`  | array    |              |                                           |
| `missions_analyzed`     | number   |              |                                           |
| `flight_hours_analyzed` | number   |              |                                           |
| `performance_metrics`   | object   |              |                                           |
| `id`                    | string   |              | Unique record identifier                  |
| `created_date`          | string   |              | Record creation timestamp                 |
| `updated_date`          | string   |              | Record last update timestamp              |
| `created_by_id`         | string   |              | ID of the user who created the record     |

### Endpoints

### `GET /entities/TrainingRecommendation`

List TrainingRecommendation records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.TrainingRecommendation.list();
```

### `POST /entities/TrainingRecommendation`

Create a TrainingRecommendation record

```javascript
const record = await base44.entities.TrainingRecommendation.create({
  // your data
});
```

### `DELETE /entities/TrainingRecommendation`

Delete multiple TrainingRecommendation records

```javascript
await base44.entities.TrainingRecommendation.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  pilot_email: "Example pilot_email"
});
```

### `POST /entities/TrainingRecommendation/bulk`

Bulk create TrainingRecommendation records

```javascript
const records = await base44.entities.TrainingRecommendation.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/TrainingRecommendation/bulk`

Bulk update TrainingRecommendation records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/TrainingRecommendation/update-many`

Update many TrainingRecommendation records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/TrainingRecommendation/{TrainingRecommendation_id}`

Get a TrainingRecommendation record by ID

**Parameters:**

- `TrainingRecommendation_id` (path): Record ID

```javascript
const record = await base44.entities.TrainingRecommendation.get(recordId);
```

### `PUT /entities/TrainingRecommendation/{TrainingRecommendation_id}`

Update a TrainingRecommendation record

**Parameters:**

- `TrainingRecommendation_id` (path): Record ID

```javascript
const record = await base44.entities.TrainingRecommendation.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/TrainingRecommendation/{TrainingRecommendation_id}`

Delete a TrainingRecommendation record

**Parameters:**

- `TrainingRecommendation_id` (path): Record ID

```javascript
await base44.entities.TrainingRecommendation.delete(recordId);
```

### `PUT /entities/TrainingRecommendation/{TrainingRecommendation_id}/restore`

Restore a deleted TrainingRecommendation record

**Parameters:**

- `TrainingRecommendation_id` (path): Record ID

```javascript
const record = await base44.entities.TrainingRecommendation.restore(recordId);
```

---

# Hospital

### Schema

| **Field**         | **Type**                                                | **Required** | **Description**                                                   |
| ----------------- | ------------------------------------------------------- | ------------ | ----------------------------------------------------------------- |
| `name`            | string                                                  | Yes          | Hospital name                                                     |
| `faa_identifier`  | string                                                  | Yes          | FAA heliport identifier                                           |
| `city`            | string                                                  | Yes          |                                                                   |
| `state`           | string                                                  |              |                                                                   |
| `county`          | string                                                  |              |                                                                   |
| `latitude`        | number                                                  | Yes          |                                                                   |
| `longitude`       | number                                                  | Yes          |                                                                   |
| `elevation_ft`    | number                                                  |              | Elevation in feet MSL                                             |
| `surface`         | `CONCRETE`, `ASPHALT`, `CONCRETE/MAT`, `GRASS`, `OTHER` |              | Helipad surface type                                              |
| `placement`       | `ROOFTOP`, `GROUND`                                     |              | Helipad placement                                                 |
| `helipad_size`    | string                                                  |              | Helipad dimensions                                                |
| `lighting`        | `None`, `Edge Lights`, `Flood Lights`, `Both`           |              |                                                                   |
| `capabilities`    | array                                                   |              | Medical capabilities (Trauma Center Level, Stroke, Cardiac, etc.) |
| `radio_frequency` | string                                                  |              |                                                                   |
| `approach_notes`  | string                                                  |              | Special approach considerations                                   |
| `parking_notes`   | string                                                  |              |                                                                   |
| `google_maps_url` | string                                                  |              |                                                                   |
| `active`          | boolean                                                 |              |                                                                   |
| `id`              | string                                                  |              | Unique record identifier                                          |
| `created_date`    | string                                                  |              | Record creation timestamp                                         |
| `updated_date`    | string                                                  |              | Record last update timestamp                                      |
| `created_by_id`   | string                                                  |              | ID of the user who created the record                             |

### Endpoints

### `GET /entities/Hospital`

List Hospital records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.Hospital.list();
```

### `POST /entities/Hospital`

Create a Hospital record

```javascript
const record = await base44.entities.Hospital.create({
  // your data
});
```

### `DELETE /entities/Hospital`

Delete multiple Hospital records

```javascript
await base44.entities.Hospital.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  name: "Example name"
});
```

### `POST /entities/Hospital/bulk`

Bulk create Hospital records

```javascript
const records = await base44.entities.Hospital.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/Hospital/bulk`

Bulk update Hospital records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/Hospital/update-many`

Update many Hospital records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/Hospital/{Hospital_id}`

Get a Hospital record by ID

**Parameters:**

- `Hospital_id` (path): Record ID

```javascript
const record = await base44.entities.Hospital.get(recordId);
```

### `PUT /entities/Hospital/{Hospital_id}`

Update a Hospital record

**Parameters:**

- `Hospital_id` (path): Record ID

```javascript
const record = await base44.entities.Hospital.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/Hospital/{Hospital_id}`

Delete a Hospital record

**Parameters:**

- `Hospital_id` (path): Record ID

```javascript
await base44.entities.Hospital.delete(recordId);
```

### `PUT /entities/Hospital/{Hospital_id}/restore`

Restore a deleted Hospital record

**Parameters:**

- `Hospital_id` (path): Record ID

```javascript
const record = await base44.entities.Hospital.restore(recordId);
```

---

# TrainingScenario

### Schema

| **Field**          | **Type**                                                                                                                               | **Required** | **Description**                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------- |
| `title`            | string                                                                                                                                 | Yes          |                                                             |
| `description`      | string                                                                                                                                 | Yes          |                                                             |
| `difficulty`       | `Beginner`, `Intermediate`, `Advanced`, `Expert`                                                                                       | Yes          |                                                             |
| `category`         | `Scene Response`, `Hospital Transfer`, `Night Operations`, `IMC Operations`, `Mass Casualty`, `Mechanical Emergency`, `Weather Divert` | Yes          |                                                             |
| `duration_min`     | number                                                                                                                                 |              |                                                             |
| `objectives`       | array                                                                                                                                  |              |                                                             |
| `scoring_criteria` | array                                                                                                                                  |              |                                                             |
| `preset_mission`   | object                                                                                                                                 |              | Pre-filled mission data to use when launching this scenario |
| `briefing_text`    | string                                                                                                                                 |              |                                                             |
| `debrief_guidance` | string                                                                                                                                 |              |                                                             |
| `tags`             | array                                                                                                                                  |              |                                                             |
| `active`           | boolean                                                                                                                                |              |                                                             |
| `times_flown`      | number                                                                                                                                 |              |                                                             |
| `id`               | string                                                                                                                                 |              | Unique record identifier                                    |
| `created_date`     | string                                                                                                                                 |              | Record creation timestamp                                   |
| `updated_date`     | string                                                                                                                                 |              | Record last update timestamp                                |
| `created_by_id`    | string                                                                                                                                 |              | ID of the user who created the record                       |

### Endpoints

### `GET /entities/TrainingScenario`

List TrainingScenario records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.TrainingScenario.list();
```

### `POST /entities/TrainingScenario`

Create a TrainingScenario record

```javascript
const record = await base44.entities.TrainingScenario.create({
  // your data
});
```

### `DELETE /entities/TrainingScenario`

Delete multiple TrainingScenario records

```javascript
await base44.entities.TrainingScenario.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  title: "Example title"
});
```

### `POST /entities/TrainingScenario/bulk`

Bulk create TrainingScenario records

```javascript
const records = await base44.entities.TrainingScenario.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/TrainingScenario/bulk`

Bulk update TrainingScenario records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/TrainingScenario/update-many`

Update many TrainingScenario records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/TrainingScenario/{TrainingScenario_id}`

Get a TrainingScenario record by ID

**Parameters:**

- `TrainingScenario_id` (path): Record ID

```javascript
const record = await base44.entities.TrainingScenario.get(recordId);
```

### `PUT /entities/TrainingScenario/{TrainingScenario_id}`

Update a TrainingScenario record

**Parameters:**

- `TrainingScenario_id` (path): Record ID

```javascript
const record = await base44.entities.TrainingScenario.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/TrainingScenario/{TrainingScenario_id}`

Delete a TrainingScenario record

**Parameters:**

- `TrainingScenario_id` (path): Record ID

```javascript
await base44.entities.TrainingScenario.delete(recordId);
```

### `PUT /entities/TrainingScenario/{TrainingScenario_id}/restore`

Restore a deleted TrainingScenario record

**Parameters:**

- `TrainingScenario_id` (path): Record ID

```javascript
const record = await base44.entities.TrainingScenario.restore(recordId);
```

---

# Base

### Schema

| **Field**           | **Type**                                                 | **Required** | **Description**                                           |
| ------------------- | -------------------------------------------------------- | ------------ | --------------------------------------------------------- |
| `name`              | string                                                   | Yes          | Base name (e.g., Stat MedEvac 1, AHN Lifeflight)          |
| `provider`          | string                                                   | Yes          | Provider organization                                     |
| `base_type`         | `Hospital Based`, `Airport Based`, `Standalone Facility` |              | Type of base location                                     |
| `location_type`     | `hospital`, `airport`                                    | Yes          | Whether based at hospital or airport                      |
| `hospital_id`       | string                                                   |              | Reference to home hospital if hospital-based              |
| `airport_id`        | string                                                   |              | Reference to airport if airport-based                     |
| `faa_identifier`    | string                                                   |              | FAA identifier of the base location                       |
| `latitude`          | number                                                   | Yes          |                                                           |
| `longitude`         | number                                                   | Yes          |                                                           |
| `elevation_ft`      | number                                                   |              |                                                           |
| `aircraft`          | object                                                   |              | Integrated aircraft information                           |
| `backup_aircraft`   | object                                                   |              | Backup helicopter information (same structure as primary) |
| `radio_frequency`   | string                                                   |              |                                                           |
| `phone`             | string                                                   |              |                                                           |
| `operational_hours` | string                                                   |              |                                                           |
| `coverage_area`     | string                                                   |              | Geographic coverage area                                  |
| `service_radius_nm` | number                                                   |              | Maximum service radius in nautical miles                  |
| `crew`              | object                                                   |              |                                                           |
| `active`            | boolean                                                  |              |                                                           |
| `id`                | string                                                   |              | Unique record identifier                                  |
| `created_date`      | string                                                   |              | Record creation timestamp                                 |
| `updated_date`      | string                                                   |              | Record last update timestamp                              |
| `created_by_id`     | string                                                   |              | ID of the user who created the record                     |

### Endpoints

### `GET /entities/Base`

List Base records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.Base.list();
```

### `POST /entities/Base`

Create a Base record

```javascript
const record = await base44.entities.Base.create({
  // your data
});
```

### `DELETE /entities/Base`

Delete multiple Base records

```javascript
await base44.entities.Base.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  name: "Example name"
});
```

### `POST /entities/Base/bulk`

Bulk create Base records

```javascript
const records = await base44.entities.Base.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/Base/bulk`

Bulk update Base records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/Base/update-many`

Update many Base records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/Base/{Base_id}`

Get a Base record by ID

**Parameters:**

- `Base_id` (path): Record ID

```javascript
const record = await base44.entities.Base.get(recordId);
```

### `PUT /entities/Base/{Base_id}`

Update a Base record

**Parameters:**

- `Base_id` (path): Record ID

```javascript
const record = await base44.entities.Base.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/Base/{Base_id}`

Delete a Base record

**Parameters:**

- `Base_id` (path): Record ID

```javascript
await base44.entities.Base.delete(recordId);
```

### `PUT /entities/Base/{Base_id}/restore`

Restore a deleted Base record

**Parameters:**

- `Base_id` (path): Record ID

```javascript
const record = await base44.entities.Base.restore(recordId);
```

---

# Aircraft

### Schema

| **Field**            | **Type**                                               | **Required** | **Description**                        |
| -------------------- | ------------------------------------------------------ | ------------ | -------------------------------------- |
| `tail_number`        | string                                                 | Yes          | Aircraft registration number           |
| `model`              | string                                                 | Yes          | Aircraft model (e.g., Bell 407, EC135) |
| `cruise_speed_kts`   | number                                                 | Yes          | Cruise speed in knots                  |
| `fuel_capacity_gal`  | number                                                 | Yes          | Total fuel capacity in gallons         |
| `fuel_burn_rate_gph` | number                                                 | Yes          | Fuel burn rate in gallons per hour     |
| `max_range_nm`       | number                                                 |              | Maximum range in nautical miles        |
| `patient_capacity`   | number                                                 |              |                                        |
| `base_location`      | string                                                 |              | Home base hospital FAA identifier      |
| `status`             | `Available`, `In Flight`, `Maintenance`, `Unavailable` |              |                                        |
| `equipment`          | array                                                  |              | Medical equipment on board             |
| `id`                 | string                                                 |              | Unique record identifier               |
| `created_date`       | string                                                 |              | Record creation timestamp              |
| `updated_date`       | string                                                 |              | Record last update timestamp           |
| `created_by_id`      | string                                                 |              | ID of the user who created the record  |

### Endpoints

### `GET /entities/Aircraft`

List Aircraft records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.Aircraft.list();
```

### `POST /entities/Aircraft`

Create a Aircraft record

```javascript
const record = await base44.entities.Aircraft.create({
  // your data
});
```

### `DELETE /entities/Aircraft`

Delete multiple Aircraft records

```javascript
await base44.entities.Aircraft.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  tail_number: "Example tail_number"
});
```

### `POST /entities/Aircraft/bulk`

Bulk create Aircraft records

```javascript
const records = await base44.entities.Aircraft.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/Aircraft/bulk`

Bulk update Aircraft records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/Aircraft/update-many`

Update many Aircraft records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/Aircraft/{Aircraft_id}`

Get a Aircraft record by ID

**Parameters:**

- `Aircraft_id` (path): Record ID

```javascript
const record = await base44.entities.Aircraft.get(recordId);
```

### `PUT /entities/Aircraft/{Aircraft_id}`

Update a Aircraft record

**Parameters:**

- `Aircraft_id` (path): Record ID

```javascript
const record = await base44.entities.Aircraft.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/Aircraft/{Aircraft_id}`

Delete a Aircraft record

**Parameters:**

- `Aircraft_id` (path): Record ID

```javascript
await base44.entities.Aircraft.delete(recordId);
```

### `PUT /entities/Aircraft/{Aircraft_id}/restore`

Restore a deleted Aircraft record

**Parameters:**

- `Aircraft_id` (path): Record ID

```javascript
const record = await base44.entities.Aircraft.restore(recordId);
```

---

# Navaid

### Schema

| **Field**            | **Type**                                   | **Required** | **Description**                        |
| -------------------- | ------------------------------------------ | ------------ | -------------------------------------- |
| `identifier`         | string                                     | Yes          | Navaid identifier (e.g., AGC, BFD)     |
| `name`               | string                                     |              |                                        |
| `type`               | `VOR`, `VORTAC`, `VOR-DME`, `NDB`, `TACAN` | Yes          |                                        |
| `frequency`          | string                                     | Yes          |                                        |
| `latitude`           | number                                     | Yes          |                                        |
| `longitude`          | number                                     | Yes          |                                        |
| `elevation_ft`       | number                                     |              |                                        |
| `magnetic_variation` | number                                     |              |                                        |
| `range_nm`           | number                                     |              | Service volume range in nautical miles |
| `region`             | string                                     |              |                                        |
| `remarks`            | string                                     |              |                                        |
| `id`                 | string                                     |              | Unique record identifier               |
| `created_date`       | string                                     |              | Record creation timestamp              |
| `updated_date`       | string                                     |              | Record last update timestamp           |
| `created_by_id`      | string                                     |              | ID of the user who created the record  |

### Endpoints

### `GET /entities/Navaid`

List Navaid records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.Navaid.list();
```

### `POST /entities/Navaid`

Create a Navaid record

```javascript
const record = await base44.entities.Navaid.create({
  // your data
});
```

### `DELETE /entities/Navaid`

Delete multiple Navaid records

```javascript
await base44.entities.Navaid.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  identifier: "Example identifier"
});
```

### `POST /entities/Navaid/bulk`

Bulk create Navaid records

```javascript
const records = await base44.entities.Navaid.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/Navaid/bulk`

Bulk update Navaid records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/Navaid/update-many`

Update many Navaid records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/Navaid/{Navaid_id}`

Get a Navaid record by ID

**Parameters:**

- `Navaid_id` (path): Record ID

```javascript
const record = await base44.entities.Navaid.get(recordId);
```

### `PUT /entities/Navaid/{Navaid_id}`

Update a Navaid record

**Parameters:**

- `Navaid_id` (path): Record ID

```javascript
const record = await base44.entities.Navaid.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/Navaid/{Navaid_id}`

Delete a Navaid record

**Parameters:**

- `Navaid_id` (path): Record ID

```javascript
await base44.entities.Navaid.delete(recordId);
```

### `PUT /entities/Navaid/{Navaid_id}/restore`

Restore a deleted Navaid record

**Parameters:**

- `Navaid_id` (path): Record ID

```javascript
const record = await base44.entities.Navaid.restore(recordId);
```

---

# CommunityPost

### Schema

| **Field**       | **Type**                                                 | **Required** | **Description**                       |
| --------------- | -------------------------------------------------------- | ------------ | ------------------------------------- |
| `title`         | string                                                   | Yes          | Post title                            |
| `content`       | string                                                   | Yes          | Post content                          |
| `category`      | `general`, `tips`, `questions`, `scenarios`, `technical` |              |                                       |
| `author_name`   | string                                                   |              |                                       |
| `likes`         | number                                                   |              |                                       |
| `replies`       | array                                                    |              |                                       |
| `id`            | string                                                   |              | Unique record identifier              |
| `created_date`  | string                                                   |              | Record creation timestamp             |
| `updated_date`  | string                                                   |              | Record last update timestamp          |
| `created_by_id` | string                                                   |              | ID of the user who created the record |

### Endpoints

### `GET /entities/CommunityPost`

List CommunityPost records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.CommunityPost.list();
```

### `POST /entities/CommunityPost`

Create a CommunityPost record

```javascript
const record = await base44.entities.CommunityPost.create({
  // your data
});
```

### `DELETE /entities/CommunityPost`

Delete multiple CommunityPost records

```javascript
await base44.entities.CommunityPost.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  title: "Example title"
});
```

### `POST /entities/CommunityPost/bulk`

Bulk create CommunityPost records

```javascript
const records = await base44.entities.CommunityPost.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/CommunityPost/bulk`

Bulk update CommunityPost records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/CommunityPost/update-many`

Update many CommunityPost records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/CommunityPost/{CommunityPost_id}`

Get a CommunityPost record by ID

**Parameters:**

- `CommunityPost_id` (path): Record ID

```javascript
const record = await base44.entities.CommunityPost.get(recordId);
```

### `PUT /entities/CommunityPost/{CommunityPost_id}`

Update a CommunityPost record

**Parameters:**

- `CommunityPost_id` (path): Record ID

```javascript
const record = await base44.entities.CommunityPost.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/CommunityPost/{CommunityPost_id}`

Delete a CommunityPost record

**Parameters:**

- `CommunityPost_id` (path): Record ID

```javascript
await base44.entities.CommunityPost.delete(recordId);
```

### `PUT /entities/CommunityPost/{CommunityPost_id}/restore`

Restore a deleted CommunityPost record

**Parameters:**

- `CommunityPost_id` (path): Record ID

```javascript
const record = await base44.entities.CommunityPost.restore(recordId);
```

---

# UserProfile

### Schema

| **Field**           | **Type** | **Required** | **Description**                                               |
| ------------------- | -------- | ------------ | ------------------------------------------------------------- |
| `user_email`        | string   | Yes          | User's email address                                          |
| `full_name`         | string   | Yes          |                                                               |
| `bio`               | string   |              | User biography                                                |
| `avatar_url`        | string   |              |                                                               |
| `cover_photo_url`   | string   |              | Cover banner photo URL                                        |
| `role_title`        | string   |              | Job title or role (e.g., Flight Paramedic, Pilot, Dispatcher) |
| `certifications`    | array    |              | Professional certifications                                   |
| `license_number`    | string   |              |                                                               |
| `years_experience`  | number   |              |                                                               |
| `phone`             | string   |              |                                                               |
| `emergency_contact` | object   |              |                                                               |
| `assigned_base`     | string   |              | Primary base assignment                                       |
| `location`          | string   |              | City, State                                                   |
| `interests`         | array    |              | Aviation interests, hobbies                                   |
| `social_links`      | object   |              |                                                               |
| `photos`            | array    |              | Community photo gallery                                       |
| `active`            | boolean  |              |                                                               |
| `id`                | string   |              | Unique record identifier                                      |
| `created_date`      | string   |              | Record creation timestamp                                     |
| `updated_date`      | string   |              | Record last update timestamp                                  |
| `created_by_id`     | string   |              | ID of the user who created the record                         |

### Endpoints

### `GET /entities/UserProfile`

List UserProfile records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.UserProfile.list();
```

### `POST /entities/UserProfile`

Create a UserProfile record

```javascript
const record = await base44.entities.UserProfile.create({
  // your data
});
```

### `DELETE /entities/UserProfile`

Delete multiple UserProfile records

```javascript
await base44.entities.UserProfile.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  user_email: "Example user_email"
});
```

### `POST /entities/UserProfile/bulk`

Bulk create UserProfile records

```javascript
const records = await base44.entities.UserProfile.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/UserProfile/bulk`

Bulk update UserProfile records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/UserProfile/update-many`

Update many UserProfile records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/UserProfile/{UserProfile_id}`

Get a UserProfile record by ID

**Parameters:**

- `UserProfile_id` (path): Record ID

```javascript
const record = await base44.entities.UserProfile.get(recordId);
```

### `PUT /entities/UserProfile/{UserProfile_id}`

Update a UserProfile record

**Parameters:**

- `UserProfile_id` (path): Record ID

```javascript
const record = await base44.entities.UserProfile.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/UserProfile/{UserProfile_id}`

Delete a UserProfile record

**Parameters:**

- `UserProfile_id` (path): Record ID

```javascript
await base44.entities.UserProfile.delete(recordId);
```

### `PUT /entities/UserProfile/{UserProfile_id}/restore`

Restore a deleted UserProfile record

**Parameters:**

- `UserProfile_id` (path): Record ID

```javascript
const record = await base44.entities.UserProfile.restore(recordId);
```

---

# MedicalCondition

### Schema

| **Field**                        | **Type**                                                                              | **Required** | **Description**                                   |
| -------------------------------- | ------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------- |
| `condition_name`                 | string                                                                                | Yes          | Medical condition or chief complaint              |
| `category`                       | `Trauma`, `Cardiac`, `Stroke`, `Respiratory`, `Pediatric`, `OB/GYN`, `Burns`, `Other` | Yes          |                                                   |
| `acuity_level`                   | `Critical`, `Emergent`, `Urgent`, `Non-Urgent`                                        |              |                                                   |
| `required_hospital_capabilities` | array                                                                                 |              | Required hospital capabilities for this condition |
| `typical_equipment_needed`       | array                                                                                 |              |                                                   |
| `transport_considerations`       | string                                                                                |              |                                                   |
| `time_critical`                  | boolean                                                                               |              |                                                   |
| `id`                             | string                                                                                |              | Unique record identifier                          |
| `created_date`                   | string                                                                                |              | Record creation timestamp                         |
| `updated_date`                   | string                                                                                |              | Record last update timestamp                      |
| `created_by_id`                  | string                                                                                |              | ID of the user who created the record             |

### Endpoints

### `GET /entities/MedicalCondition`

List MedicalCondition records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.MedicalCondition.list();
```

### `POST /entities/MedicalCondition`

Create a MedicalCondition record

```javascript
const record = await base44.entities.MedicalCondition.create({
  // your data
});
```

### `DELETE /entities/MedicalCondition`

Delete multiple MedicalCondition records

```javascript
await base44.entities.MedicalCondition.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  condition_name: "Example condition_name"
});
```

### `POST /entities/MedicalCondition/bulk`

Bulk create MedicalCondition records

```javascript
const records = await base44.entities.MedicalCondition.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/MedicalCondition/bulk`

Bulk update MedicalCondition records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/MedicalCondition/update-many`

Update many MedicalCondition records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/MedicalCondition/{MedicalCondition_id}`

Get a MedicalCondition record by ID

**Parameters:**

- `MedicalCondition_id` (path): Record ID

```javascript
const record = await base44.entities.MedicalCondition.get(recordId);
```

### `PUT /entities/MedicalCondition/{MedicalCondition_id}`

Update a MedicalCondition record

**Parameters:**

- `MedicalCondition_id` (path): Record ID

```javascript
const record = await base44.entities.MedicalCondition.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/MedicalCondition/{MedicalCondition_id}`

Delete a MedicalCondition record

**Parameters:**

- `MedicalCondition_id` (path): Record ID

```javascript
await base44.entities.MedicalCondition.delete(recordId);
```

### `PUT /entities/MedicalCondition/{MedicalCondition_id}/restore`

Restore a deleted MedicalCondition record

**Parameters:**

- `MedicalCondition_id` (path): Record ID

```javascript
const record = await base44.entities.MedicalCondition.restore(recordId);
```

---

# WikiArticle

### Schema

| **Field**       | **Type**                                                     | **Required** | **Description**                       |
| --------------- | ------------------------------------------------------------ | ------------ | ------------------------------------- |
| `title`         | string                                                       | Yes          |                                       |
| `content`       | string                                                       | Yes          |                                       |
| `excerpt`       | string                                                       |              |                                       |
| `category`      | `procedures`, `aircraft`, `medical`, `navigation`, `weather` |              |                                       |
| `contributors`  | array                                                        |              |                                       |
| `id`            | string                                                       |              | Unique record identifier              |
| `created_date`  | string                                                       |              | Record creation timestamp             |
| `updated_date`  | string                                                       |              | Record last update timestamp          |
| `created_by_id` | string                                                       |              | ID of the user who created the record |

### Endpoints

### `GET /entities/WikiArticle`

List WikiArticle records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.WikiArticle.list();
```

### `POST /entities/WikiArticle`

Create a WikiArticle record

```javascript
const record = await base44.entities.WikiArticle.create({
  // your data
});
```

### `DELETE /entities/WikiArticle`

Delete multiple WikiArticle records

```javascript
await base44.entities.WikiArticle.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  title: "Example title"
});
```

### `POST /entities/WikiArticle/bulk`

Bulk create WikiArticle records

```javascript
const records = await base44.entities.WikiArticle.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/WikiArticle/bulk`

Bulk update WikiArticle records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/WikiArticle/update-many`

Update many WikiArticle records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/WikiArticle/{WikiArticle_id}`

Get a WikiArticle record by ID

**Parameters:**

- `WikiArticle_id` (path): Record ID

```javascript
const record = await base44.entities.WikiArticle.get(recordId);
```

### `PUT /entities/WikiArticle/{WikiArticle_id}`

Update a WikiArticle record

**Parameters:**

- `WikiArticle_id` (path): Record ID

```javascript
const record = await base44.entities.WikiArticle.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/WikiArticle/{WikiArticle_id}`

Delete a WikiArticle record

**Parameters:**

- `WikiArticle_id` (path): Record ID

```javascript
await base44.entities.WikiArticle.delete(recordId);
```

### `PUT /entities/WikiArticle/{WikiArticle_id}/restore`

Restore a deleted WikiArticle record

**Parameters:**

- `WikiArticle_id` (path): Record ID

```javascript
const record = await base44.entities.WikiArticle.restore(recordId);
```

---

# Region

### Schema

| **Field**          | **Type**                                                | **Required** | **Description**                              |
| ------------------ | ------------------------------------------------------- | ------------ | -------------------------------------------- |
| `region_name`      | string                                                  | Yes          | e.g., Western Pennsylvania, Allegheny County |
| `region_type`      | `State`, `County`, `Metropolitan Area`, `Coverage Zone` | Yes          |                                              |
| `state`            | string                                                  |              |                                              |
| `country`          | string                                                  |              |                                              |
| `center_latitude`  | number                                                  |              |                                              |
| `center_longitude` | number                                                  |              |                                              |
| `description`      | string                                                  |              |                                              |
| `id`               | string                                                  |              | Unique record identifier                     |
| `created_date`     | string                                                  |              | Record creation timestamp                    |
| `updated_date`     | string                                                  |              | Record last update timestamp                 |
| `created_by_id`    | string                                                  |              | ID of the user who created the record        |

### Endpoints

### `GET /entities/Region`

List Region records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.Region.list();
```

### `POST /entities/Region`

Create a Region record

```javascript
const record = await base44.entities.Region.create({
  // your data
});
```

### `DELETE /entities/Region`

Delete multiple Region records

```javascript
await base44.entities.Region.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  region_name: "Example region_name"
});
```

### `POST /entities/Region/bulk`

Bulk create Region records

```javascript
const records = await base44.entities.Region.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/Region/bulk`

Bulk update Region records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/Region/update-many`

Update many Region records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/Region/{Region_id}`

Get a Region record by ID

**Parameters:**

- `Region_id` (path): Record ID

```javascript
const record = await base44.entities.Region.get(recordId);
```

### `PUT /entities/Region/{Region_id}`

Update a Region record

**Parameters:**

- `Region_id` (path): Record ID

```javascript
const record = await base44.entities.Region.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/Region/{Region_id}`

Delete a Region record

**Parameters:**

- `Region_id` (path): Record ID

```javascript
await base44.entities.Region.delete(recordId);
```

### `PUT /entities/Region/{Region_id}/restore`

Restore a deleted Region record

**Parameters:**

- `Region_id` (path): Record ID

```javascript
const record = await base44.entities.Region.restore(recordId);
```

---

# ContentManagement

### Schema

| **Field**                   | **Type**                                                       | **Required** | **Description**                       |
| --------------------------- | -------------------------------------------------------------- | ------------ | ------------------------------------- |
| `content_type`              | `document`, `photo`, `handbook`, `scenery`, `download`, `page` | Yes          | Type of content                       |
| `title`                     | string                                                         | Yes          |                                       |
| `description`               | string                                                         |              |                                       |
| `file_url`                  | string                                                         |              | URL to uploaded file                  |
| `thumbnail_url`             | string                                                         |              |                                       |
| `category`                  | string                                                         |              | Category or tag                       |
| `tags`                      | array                                                          |              |                                       |
| `related_entity_id`         | string                                                         |              | Related aircraft, hospital, etc.      |
| `related_entity_type`       | string                                                         |              | Type of related entity                |
| `file_size_bytes`           | number                                                         |              |                                       |
| `download_count`            | number                                                         |              |                                       |
| `version`                   | string                                                         |              |                                       |
| `release_date`              | string                                                         |              |                                       |
| `platform`                  | `X-Plane`, `MSFS`, `Universal`, `N/A`                          |              |                                       |
| `installation_instructions` | string                                                         |              |                                       |
| `active`                    | boolean                                                        |              |                                       |
| `sort_order`                | number                                                         |              |                                       |
| `id`                        | string                                                         |              | Unique record identifier              |
| `created_date`              | string                                                         |              | Record creation timestamp             |
| `updated_date`              | string                                                         |              | Record last update timestamp          |
| `created_by_id`             | string                                                         |              | ID of the user who created the record |

### Endpoints

### `GET /entities/ContentManagement`

List ContentManagement records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.ContentManagement.list();
```

### `POST /entities/ContentManagement`

Create a ContentManagement record

```javascript
const record = await base44.entities.ContentManagement.create({
  // your data
});
```

### `DELETE /entities/ContentManagement`

Delete multiple ContentManagement records

```javascript
await base44.entities.ContentManagement.deleteMany({
  // query filter — WARNING: empty {} deletes ALL records
  content_type: "document"
});
```

### `POST /entities/ContentManagement/bulk`

Bulk create ContentManagement records

```javascript
const records = await base44.entities.ContentManagement.bulkCreate([
  { /* record 1 */ },
  { /* record 2 */ },
]);
```

### `PUT /entities/ContentManagement/bulk`

Bulk update ContentManagement records

```javascript
// bulk-update is not available via SDK — use the REST API
```

### `PATCH /entities/ContentManagement/update-many`

Update many ContentManagement records by query

```javascript
// update-many is not available via SDK — use the REST API
```

### `GET /entities/ContentManagement/{ContentManagement_id}`

Get a ContentManagement record by ID

**Parameters:**

- `ContentManagement_id` (path): Record ID

```javascript
const record = await base44.entities.ContentManagement.get(recordId);
```

### `PUT /entities/ContentManagement/{ContentManagement_id}`

Update a ContentManagement record

**Parameters:**

- `ContentManagement_id` (path): Record ID

```javascript
const record = await base44.entities.ContentManagement.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/ContentManagement/{ContentManagement_id}`

Delete a ContentManagement record

**Parameters:**

- `ContentManagement_id` (path): Record ID

```javascript
await base44.entities.ContentManagement.delete(recordId);
```

### `PUT /entities/ContentManagement/{ContentManagement_id}/restore`

Restore a deleted ContentManagement record

**Parameters:**

- `ContentManagement_id` (path): Record ID

```javascript
const record = await base44.entities.ContentManagement.restore(recordId);
```

---

# User

### Schema

| **Field**       | **Type**        | **Required** | **Description**                       |
| --------------- | --------------- | ------------ | ------------------------------------- |
| `role`          | `admin`, `user` | Yes          | The role of the user in the app       |
| `email`         | string          | Yes          | The email of the user                 |
| `full_name`     | string          | Yes          | The full name of the user             |
| `id`            | string          |              | Unique record identifier              |
| `created_date`  | string          |              | Record creation timestamp             |
| `updated_date`  | string          |              | Record last update timestamp          |
| `created_by_id` | string          |              | ID of the user who created the record |

### Endpoints

### `GET /entities/User`

List User records

**Parameters:**

- `q` (query): JSON query filter, e.g. {"status":"active"}
- `limit` (query): Maximum number of records to return
- `skip` (query): Number of records to skip (pagination)
- `sort_by` (query): Field name to sort by. Prefix with '-' for descending order, e.g. -created_date

```javascript
const records = await base44.entities.User.list();
```

### `POST /entities/User`

Create a User record

```javascript
const record = await base44.entities.User.create({
  // your data
});
```

### `GET /entities/User/{User_id}`

Get a User record by ID

**Parameters:**

- `User_id` (path): Record ID

```javascript
const record = await base44.entities.User.get(recordId);
```

### `PUT /entities/User/{User_id}`

Update a User record

**Parameters:**

- `User_id` (path): Record ID

```javascript
const record = await base44.entities.User.update(recordId, {
  // fields to update
});
```

### `DELETE /entities/User/{User_id}`

Delete a User record

**Parameters:**

- `User_id` (path): Record ID

```javascript
await base44.entities.User.delete(recordId);
```

