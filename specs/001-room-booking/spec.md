# Feature Specification: RoomBook — Campus Study-Room Booking

**Feature Branch**: `001-room-booking`

**Created**: 2026-11-01

**Status**: Clarified

**Input**: User description: "Build RoomBook, a web application and HTTP API that lets members of a university book shared study rooms. Actors: students, staff, facilities administrators. Students and staff register with their university email address and a password, sign in, browse rooms (name, building, capacity, equipment), see a room's free and booked times for a given day, book a room for a time slot, see their upcoming bookings and cancel them. Booking rules: bookings are in 30-minute steps inside opening hours (08:00–22:00 campus time), cannot start in the past, cannot overlap another booking of the same room, party size cannot exceed room capacity, and students have tighter limits than staff on booking length, how far ahead they can book and how many upcoming bookings they can hold. Facilities administrators manage rooms (add, edit, take out of service) and can see and cancel any booking. Because the system stores personal data of EU users, users can download their data and delete their account. Repeated failed sign-ins must be throttled, and security-relevant events must be audit-logged."

## Clarifications

### Session 2026-11-01

Answers were given autonomously by the orchestrating agent acting as product owner, choosing the
option `/speckit-clarify` itself recommended; the team should review them.

- Q: What should happen to a room's future bookings when an administrator takes it out of service? → A: Cancel them automatically with reason "Room taken out of service"; bookings already in progress are unaffected.
- Q: Should deleting an account cancel the user's upcoming bookings automatically, or be refused until the user cancels them? → A: Cancel them automatically with reason "Account deleted", then erase the account.
- Q: Must an administrator give a reason when cancelling someone else's booking? → A: Yes, a reason of 1–200 characters, shown to the booking owner.
- Q: How long are anonymous past bookings and audit events kept? → A: 12 months after the booking ends / the event is recorded; then permanently deleted by an operator-run maintenance task.
- Q: Should there be a general per-client request limit in addition to the sign-in lockout? → A: Yes, 300 requests per minute per client address; excess requests get a "too many requests" answer with a retry time.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Book a study room (Priority: P1)

A signed-in student looks at the list of rooms, picks one that fits their group, checks which
times are free on a given day and books a slot. The booking appears in their list of upcoming
bookings.

**Why this priority**: Booking a room is the reason the system exists; without it nothing else
has value.

**Independent Test**: With one seeded room and one registered student, sign in, request the
room's availability for tomorrow, create a booking in a free slot, and see it in "my upcoming
bookings" and as busy in the room's availability.

**Acceptance Scenarios**:

1. **Given** a signed-in student and a room in service with capacity 6, **When** they book it for
   tomorrow 10:00–11:00 for 4 people, **Then** the booking is confirmed and shown in their
   upcoming bookings.
2. **Given** an existing booking of room A for 10:00–11:00, **When** another user books room A
   for 10:30–11:30, **Then** the request is rejected with a "slot not available" error and no
   booking is created.
3. **Given** an existing booking of room A for 10:00–11:00, **When** another user books room A
   for 11:00–12:00, **Then** the booking is confirmed (back-to-back bookings are allowed).
4. **Given** a signed-in student, **When** they request a booking that starts in the past,
   is not on a 30-minute boundary, ends after 22:00 campus time, or has a party size larger than
   the room capacity, **Then** the request is rejected with an error naming the violated rule.
5. **Given** a student who already holds 3 upcoming bookings, **When** they try to make a fourth,
   **Then** the request is rejected with a "booking quota reached" error.
6. **Given** a student, **When** they request a booking longer than 2 hours or starting more than
   7 days ahead, **Then** the request is rejected; **Given** a staff member, the same request up
   to 4 hours and 30 days ahead is accepted.
7. **Given** a room's availability for a date, **When** any signed-in user views it, **Then**
   they see the booked intervals and the free intervals within opening hours, but not who made
   the bookings.

---

### User Story 2 - Register, sign in and sign out securely (Priority: P1)

A new user creates an account with their university email address and a password, signs in to
receive a session, and signs out to end it.

**Why this priority**: Bookings are personal and quota-limited, so every booking action must be
attributable to an authenticated user. P1 together with Story 1 forms the MVP.

**Independent Test**: Register with a valid university address, sign in, call an authenticated
operation, sign out, and confirm the same session is no longer accepted.

**Acceptance Scenarios**:

1. **Given** no account for `alice@uni.example`, **When** she registers with a 12+ character
   password and a display name, **Then** an account with the role *student* is created and the
   password is never returned or shown.
2. **Given** an email address outside the allowed university domain(s), **When** registering,
   **Then** registration is rejected.
3. **Given** a registered user, **When** they sign in with the correct password, **Then** they
   receive a session that expires after 8 hours; with a wrong password they receive a generic
   "invalid email or password" error that does not reveal whether the email exists.
4. **Given** 5 failed sign-in attempts for the same account within 15 minutes, **When** a sixth
   attempt is made (even with the correct password), **Then** it is refused for 15 minutes from
   the last failure and the lockout is audit-logged.
5. **Given** a signed-in user, **When** they sign out, **Then** their session can no longer be
   used.

---

### User Story 3 - Manage my bookings (Priority: P2)

A user sees their upcoming bookings and cancels one they no longer need, freeing the slot for
others.

**Why this priority**: Without cancellation, rooms stay blocked and quotas fill up; it is the
second most frequent action.

**Independent Test**: Create a booking, list upcoming bookings, cancel it, and confirm the slot
is free again and the quota is restored.

**Acceptance Scenarios**:

1. **Given** a user with an upcoming booking, **When** they cancel it before its start time,
   **Then** it is marked cancelled, disappears from upcoming bookings and its slot becomes free.
2. **Given** a booking that has already started, **When** its owner tries to cancel it,
   **Then** the request is rejected.
3. **Given** a booking owned by Bob, **When** Alice (not an administrator) tries to cancel it,
   **Then** the request fails exactly as if the booking did not exist, and the booking is
   unchanged.

---

### User Story 4 - Administer rooms and bookings (Priority: P2)

A facilities administrator adds new rooms, edits room details, takes rooms out of service,
promotes users to staff or administrator, sees every booking for a day and cancels any booking.

**Why this priority**: Rooms must exist before anyone can book them, and facilities staff must be
able to react to maintenance and misuse.

**Independent Test**: As the seeded administrator, create a room, see it in the room list, take
it out of service, and confirm it can no longer be booked.

**Acceptance Scenarios**:

1. **Given** an administrator, **When** they create a room with a unique name, building,
   capacity (1–50) and equipment, **Then** the room appears in the room list.
2. **Given** a non-administrator, **When** they try any administrative operation, **Then** the
   request is refused as forbidden.
3. **Given** a room in service with future bookings, **When** an administrator takes it out of
   service, **Then** it can no longer be booked and its future bookings are cancelled with the
   reason "Room taken out of service", visible to their owners.
4. **Given** an administrator, **When** they view the bookings for a date, **Then** they see all
   rooms' bookings including who made each booking.
5. **Given** an administrator, **When** they change a user's role to *staff*, **Then** that user's
   subsequent bookings are subject to staff limits.

---

### User Story 5 - Control my personal data (Priority: P3)

A user downloads all personal data the system holds about them, and can delete their account.

**Why this priority**: Legally required (GDPR access and erasure rights) but used rarely.

**Independent Test**: Export data for a user with bookings and check it contains their profile
and bookings; delete the account and confirm sign-in fails and historic bookings no longer
reference the person.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they request a data export, **Then** they receive a
   machine-readable document with their profile and all their bookings, and no other user's data.
2. **Given** a signed-in user who confirms with their password, **When** they delete their
   account, **Then** they can no longer sign in, their sessions end, their personal data is
   removed and their past bookings remain only as anonymous room-usage records.
3. **Given** a user with upcoming bookings, **When** they delete their account, **Then** those
   bookings are cancelled and their slots become free for others.

---

### Edge Cases

- Booking that ends exactly when another begins (allowed) vs. one that overlaps by any amount
  (rejected); overlap is checked on half-open intervals [start, end).
- Booking whose start equals its end, or whose end is before its start (rejected).
- Booking that crosses midnight campus time or extends past 22:00 (rejected).
- Days on which campus time changes between summer and winter time: opening hours are applied in
  campus local time, so a 08:00 start maps to a different UTC instant than the day before.
- Two users submitting a booking for the same free slot at the same moment: exactly one succeeds.
- Booking a room that has been taken out of service, or that does not exist (rejected / not found).
- Cancelling a booking that is already cancelled or already started (rejected).
- Party size of 0 or negative, purpose text longer than 100 characters, unknown extra fields in
  a request (rejected).
- Purpose text containing markup such as `<script>`: stored as plain text and never executed when
  displayed.
- A session used after sign-out, after expiry, or after the account is deleted (rejected).
- The last remaining administrator trying to delete their account or lose the administrator role
  (rejected, so the system can never be left without an administrator).
- An administrator cancelling a booking without a reason, or with a reason over 200 characters
  (rejected).
- A client sending more than 300 requests in one minute (refused with a retry time).

## Requirements *(mandatory)*

### Functional Requirements

**Accounts & sessions**

- **FR-001**: System MUST let a person register with an email address in an allowed university
  domain, a display name (1–60 characters) and a password (12–128 characters, not equal to the
  email address). New accounts have the role *student*. Registering an email that already has an
  account MUST be rejected.
- **FR-002**: System MUST let registered users sign in with email and password and receive a
  session that expires 8 hours after sign-in.
- **FR-003**: System MUST let users sign out, after which the session is no longer accepted.
- **FR-004**: System MUST refuse sign-in for an account for 15 minutes after 5 failed attempts
  within 15 minutes, and MUST give the same error for unknown email and wrong password.
  Concurrent attempts MUST NOT bypass the limit: however many requests arrive at once, at most 5
  passwords per account are checked within a lock window. *(Amended after independent review, R-1)*

**Rooms**

- **FR-005**: Signed-in users MUST be able to list rooms that are in service with name, building, capacity and
  equipment, filtered optionally by minimum capacity, building and required equipment.
- **FR-006**: Signed-in users MUST be able to view a room's availability for a campus-local date:
  booked intervals (without booker identity) and free intervals within opening hours.
- **FR-007**: Administrators MUST be able to create rooms (unique name, building, capacity 1–50,
  equipment from: whiteboard, projector, display-screen, video-conferencing) and edit them.
- **FR-008**: Administrators MUST be able to take a room out of service and put it back in
  service. Rooms out of service are hidden from the room list and cannot be booked.

**Bookings**

- **FR-009**: Signed-in users MUST be able to book a room that is in service for a time slot with a party
  size and an optional purpose text (≤ 100 characters).
- **FR-010**: A booking MUST start and end on a 30-minute boundary, last at least 30 minutes,
  start in the future, lie within opening hours (08:00–22:00 campus time) on a single campus-local
  day, and have a party size between 1 and the room capacity.
- **FR-011**: A booking MUST NOT overlap any other non-cancelled booking of the same room.
- **FR-012**: Role limits MUST apply — *student*: at most 2 hours per booking, start at most 7 days
  ahead, at most 3 upcoming bookings; *staff* and *admin*: at most 4 hours, 30 days ahead,
  10 upcoming bookings. "Upcoming" means not cancelled and not yet ended.
- **FR-013**: Users MUST be able to list their own bookings in start-time order. By default only
  upcoming bookings are listed; on request, cancelled and past bookings are included, each showing
  its status and, when cancelled by an administrator or by the system, the cancellation reason.
- **FR-014**: Users MUST be able to cancel their own booking before it starts. Requests concerning
  another user's booking MUST be answered as if the booking did not exist.
- **FR-015**: Administrators MUST be able to list all bookings for a campus-local date, including
  booker display name and email, and cancel any booking that has not ended, giving a reason of
  1–200 characters that is shown to the booking owner.
- **FR-016**: When a room is taken out of service, all of its confirmed bookings that have not yet
  started MUST be cancelled automatically with the reason "Room taken out of service"; bookings
  already in progress are not affected.

**Administration**

- **FR-017**: Administrators MUST be able to change a user's role between *student*, *staff* and
  *admin*. The system MUST refuse any change that would leave it without an administrator.

**Personal data**

- **FR-018**: Users MUST be able to export all personal data held about them (profile and
  bookings) in a machine-readable format.
- **FR-019**: Users MUST be able to delete their account after re-entering their password. All
  sessions end, profile data is erased and past bookings are kept without any link to the person.
  Upcoming bookings are first cancelled automatically with the reason "Account deleted".
  Cancellation reasons on the user's bookings are erased as well, and no copy of the person's email
  or display name may remain in the database files afterwards (deleted content is overwritten and
  the write-ahead log is checkpointed). Wrong passwords entered for deletion count towards the
  FR-004 lock. *(Amended after independent review, R-2, R-7, R-10)*
- **FR-020**: System MUST record an audit event for: registration, successful and failed sign-in,
  lockout, sign-out, account deletion, role change, room creation/update/service change, and any
  cancellation by an administrator. Audit events MUST NOT contain passwords or session secrets.
  Administrators MUST be able to list audit events, newest first. Failed sign-in events identify the
  account only by its pseudonymous id (when it exists) and contain no value derived from the email
  address. *(Amended after independent review, R-3)*
- **FR-021**: Operators MUST be able to run a maintenance task that permanently deletes bookings
  that ended more than 12 months ago and audit events older than 12 months, plus sign-in failure
  records older than 24 hours and sessions that expired or were revoked more than 24 hours ago. *(Amended after independent review, R-9)*

### Non-Functional Requirements

- **NFR-001 (Performance)**: Room list and room-availability requests MUST complete within
  300 ms at the 95th percentile with 50 rooms, 5,000 bookings and 20 concurrent users on a
  developer laptop.
- **NFR-002 (Security — credentials)**: Passwords MUST be stored only as salted, memory-hard
  hashes; session secrets MUST be stored only in hashed form; neither may appear in any response
  or log. API responses MUST NOT be stored by browser or proxy caches. *(Amended after independent review, R-5)*
- **NFR-003 (Security — authorisation)**: Every operation on a booking or user MUST check that
  the caller owns the object or is an administrator.
- **NFR-004 (Security — input)**: Every request body and parameter MUST be validated against the
  published interface contract; unknown fields MUST be rejected; error responses MUST NOT reveal
  internal details (stack traces, queries). Dates outside 2000-01-01 … 2099-12-31 are invalid
  input. *(Amended after independent review, R-8)*
- **NFR-005 (Security — transport & browser)**: Responses MUST carry protective browser security
  headers (content-security policy without inline scripts, no MIME sniffing, no framing; base URI
  and form targets restricted to the site itself). *(Amended after independent review, R-12)*
- **NFR-006 (Reliability)**: Concurrent booking requests for the same slot MUST result in exactly
  one confirmed booking; no partially-written booking may ever be visible.
- **NFR-007 (Usability)**: A first-time user MUST be able to sign in and book a room in under
  2 minutes; every validation error MUST state which field or rule failed; all functions MUST be
  operable with the keyboard alone and on a 360-pixel-wide screen. All dates and times are shown in
  campus time with English formatting, and choosing a start time offers only end times after it. *(Amended after independent review, R-11, U-1, U-2)*
- **NFR-008 (Maintainability/Testability)**: Booking rules MUST be verifiable without a database,
  network or real clock; automated tests MUST cover at least 85 % of source lines.
- **NFR-009 (Privacy)**: Only email, display name, role and bookings are stored about a person;
  room availability shown to non-administrators MUST NOT reveal who booked.
- **NFR-010 (Security — resource consumption)**: Each client network address MUST be limited to
  300 requests per minute; excess requests MUST be refused with a "too many requests" answer that
  states when to retry.

### Key Entities

- **User**: a university member; email (unique), display name, role (student/staff/admin),
  credential, lockout state. Erasable.
- **Session**: a time-limited proof of sign-in belonging to one user; can be revoked.
- **Room**: a bookable space; unique name, building, capacity, equipment set, in-service flag.
- **Booking**: a reservation of one room by one user for a time interval; party size, optional
  purpose, status (confirmed / cancelled), who cancelled and when. May become anonymous after
  account deletion.
- **Audit Event**: what happened, when, which user (if any) acted, which object was affected.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100 % of the acceptance scenarios in this specification pass as automated tests.
- **SC-002**: A first-time user completes "sign in → find a room for 4 people tomorrow → book it"
  in under 2 minutes.
- **SC-003**: In a test where 20 identical booking requests for the same slot arrive at once,
  exactly 1 succeeds and 19 are rejected as unavailable.
- **SC-004**: Room list and availability views respond within 300 ms for 95 % of requests under
  the NFR-001 load.
- **SC-005**: An independent security review finds no open high-severity issue (broken access
  control, credential exposure, injection) at release.
- **SC-006**: After account deletion, a search of all stored data for the user's email and
  display name returns no results.

## Assumptions

- "Campus time" is a single configurable IANA time zone, default `Europe/Helsinki`; opening hours
  are 08:00–22:00 every day (configurable). Holidays/closures are out of scope.
- Allowed registration domains are configurable; examples use `uni.example`.
- Email verification and password reset by email are out of scope for this version (no mail
  service is available in the course environment); registration with an allowed domain is
  trusted. This is an accepted risk recorded for the security review.
- Rejecting duplicate registration reveals that an email has an account; this is accepted
  because university addresses are public in the staff/student directory, and sign-in errors stay
  generic.
- The first administrator account is created from configuration at installation time.
- Notifications (email/push) about cancellations are out of scope; affected users see the status
  and reason in their booking list.
- A single campus deployment serves at most a few thousand users; horizontal scaling is out of
  scope.
