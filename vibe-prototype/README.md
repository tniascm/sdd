# RoomBook

A small web app for students to book campus study rooms.

## Run it

Requires Node.js 22.13 or newer. It uses Node's built-in SQLite, so there is nothing native to compile.

```sh
npm install
npm start          # http://localhost:3000
```

1. Sign up at `/signup` with an `@uni.example` address.
2. Click any green **Book** slot.

To give the facilities office admin rights, have them sign up first, then run this on the server:

```sh
npm run make-admin -- facilities@uni.example            # grant
npm run make-admin -- facilities@uni.example --remove   # revoke
```

Admin rights can only be granted this way, so nobody can claim them through the website.

Data is stored in `data/roombook.db`. If you are upgrading, an existing database is upgraded automatically on start and keeps all its data.

```sh
npm test           # integration tests (in-memory database, writes no files)
npm run dev        # restart automatically when files change
```

## What it does

### Students

- **Booking:** a time-by-room grid for each day, then book a free slot. The server rejects:
  - double bookings
  - a student booking two rooms at the same time
  - times in the past, outside opening hours or beyond the booking window
  - more than 3 upcoming bookings per student
- **My bookings:** upcoming bookings with a Cancel button, plus recent ones.
- **Notices:** if a booking is cancelled because a room closed, the student sees a message at the top of every page until they dismiss it.
- **Account page** (click your name in the top bar):
  - **Download my data:** a JSON file with your profile, bookings, notices, active sessions and recent failed logins to your account.
  - **Delete my account:** asks for your password, then permanently deletes the account, its bookings, notices and login records.

### Admins

The **Admin** page is shown only to admins. On it, admins can:

- **Add rooms** with a name, location, seat count and features.
- **Close a room** for a date range, or until further notice, with a reason.
  - Upcoming bookings in that period are cancelled, and each affected student gets a notice.
  - Students see the room as "Closed" in the grid and cannot book it.
- **Reopen** a room by removing its closure. No other data is touched.

### Security

- **Sign-ups:** only addresses at exactly `@uni.example` are accepted (configurable).
- **Passwords:**
  - at least 8 characters
  - common passwords are rejected, as are passwords that match the email
  - stored hashed with scrypt
- **Password guessing:**
  - After 5 failed logins for one email within 15 minutes, that email is locked for the rest of the window.
  - One IP address gets 20 failures in the window.
  - Each attempt is counted before the password is checked, so firing many requests at once doesn't get around the limit.
  - Unknown emails are counted the same way, so the lock doesn't reveal which accounts exist.
- **Other protections:**
  - every form is protected against cross-site request forgery
  - session cookies are HttpOnly and SameSite
  - security headers are set on every response
  - pages tell the browser not to store copies

## Configuration

Set these as environment variables, e.g. `PORT=8080 TZ=Europe/Berlin npm start`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `EMAIL_DOMAIN` | `uni.example` | Only addresses at exactly this domain can sign up |
| `OPEN_HOUR` / `CLOSE_HOUR` | `8` / `22` | Hours when rooms can be booked |
| `SLOT_MINUTES` | `30` | Booking granularity |
| `MAX_BOOKING_MINUTES` | `120` | Longest single booking |
| `MAX_ACTIVE_BOOKINGS` | `3` | Upcoming bookings a student may hold |
| `BOOKING_WINDOW_DAYS` | `14` | How far ahead students can book |
| `LOGIN_MAX_ATTEMPTS` | `5` | Failed logins per email before locking (an IP gets 4×) |
| `LOGIN_LOCK_MINUTES` | `15` | Length of the failed-login window and lock |
| `TRUST_PROXY` | off | Set when behind a reverse proxy (e.g. `1`) so the real client IP is used |
| `DB_PATH` | `data/roombook.db` | SQLite file |
| `TZ` | system | Time zone for opening hours, e.g. `Europe/Berlin` |
| `SECURE_COOKIES` | off | Set to `1` when serving over HTTPS |

`rooms.json` contains only the starter rooms, which are loaded into an empty database on its first start. After that, rooms are managed on the Admin page.

## Known limits

- **No email verification:** sign-up checks that an address ends in `@uni.example`, not that the person owns it. Add verification, or university single sign-on, before real use.
- **No password reset or password change.**
- **Room details can't be edited and rooms can't be deleted.** To retire a room, close it until further notice.
- **Past bookings are never deleted.** Consider a retention period for GDPR.
- **Single process:** the app is designed to run as one Node process.
