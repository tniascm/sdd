# RoomBook

A small web app for students to book campus study rooms.

## Run it

Requires Node.js 22.13 or newer. It uses Node's built-in SQLite, so there is nothing native to compile.

```sh
npm install
npm start          # http://localhost:3000
```

Create an account at `/signup`, then click any green **Book** slot.
Data is stored in `data/roombook.db`, which is created on first start.

```sh
npm test           # integration tests (in-memory database)
npm run dev        # restart automatically when files change
```

## What it does

- **Accounts:** sign up with name, email and password, then log in and out. Passwords are hashed with scrypt, and sessions are kept in the database.
- **Day view:** a time-by-room grid for any day in the booking window. It shows free slots, other people's bookings (without names) and your own bookings.
- **Booking:** pick a room, date, start time and length. The server rejects:
  - overlapping bookings for the same room
  - a student booking two rooms at the same time
  - times in the past, outside opening hours or beyond the booking window
  - more than the allowed number of upcoming bookings per student
- **My bookings:** a list of your upcoming bookings with a Cancel button, plus your recent past bookings.

## Configuration

Set these as environment variables, e.g. `EMAIL_DOMAIN=myuni.edu PORT=8080 npm start`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `EMAIL_DOMAIN` | *(any)* | Only allow sign-ups from this domain or its subdomains |
| `OPEN_HOUR` / `CLOSE_HOUR` | `8` / `22` | Hours when rooms can be booked |
| `SLOT_MINUTES` | `30` | Booking granularity |
| `MAX_BOOKING_MINUTES` | `120` | Longest single booking |
| `MAX_ACTIVE_BOOKINGS` | `3` | Upcoming bookings a student may hold |
| `BOOKING_WINDOW_DAYS` | `14` | How far ahead students can book |
| `DB_PATH` | `data/roombook.db` | SQLite file |
| `TZ` | system | Time zone for opening hours, e.g. `Europe/Berlin` |
| `SECURE_COOKIES` | off | Set to `1` when serving over HTTPS |

**Rooms** come from `rooms.json`, which is loaded into the database the first time the app starts.
To change the rooms later, edit the file and delete `data/roombook.db`. This also deletes all accounts and bookings.

## Known limits

To keep the app simple, it leaves out:

- an admin screen
- email verification
- password reset
- login rate limiting

It is designed to run as a single Node process.
