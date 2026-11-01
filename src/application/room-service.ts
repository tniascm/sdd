/** Rooms: FR-005 list, FR-006 availability, FR-007 create/edit, FR-008 service state, FR-016. */
import { randomUUID } from 'node:crypto';
import { computeAvailability, openingWindow, type Interval } from '../domain/availability.ts';
import { parseLocalDate } from '../domain/campus-time.ts';
import { DomainError } from '../domain/errors.ts';
import type { Equipment, Room } from '../domain/types.ts';
import type { AuditService } from './audit-service.ts';
import type { BookingRepository, Clock, RoomRepository, UnitOfWork } from './ports.ts';

export type RoomServiceDeps = {
  rooms: RoomRepository;
  bookings: BookingRepository;
  uow: UnitOfWork;
  audit: AuditService;
  clock: Clock;
  config: { timeZone: string; opensAt: string; closesAt: string };
};

export type RoomFilter = { minCapacity?: number; building?: string; equipment?: string[] };
export type RoomInput = { name: string; building: string; capacity: number; equipment: Equipment[] };

export type Availability = {
  roomId: string;
  date: string;
  timeZone: string;
  opens: string;
  closes: string;
  booked: Interval[];
  free: Interval[];
};

export const OUT_OF_SERVICE_REASON = 'Room taken out of service';

export class RoomService {
  private readonly deps: RoomServiceDeps;

  constructor(deps: RoomServiceDeps) {
    this.deps = deps;
  }

  /** FR-005: rooms in service; filters combine (equipment: the room must have all of them). */
  list(filter: RoomFilter = {}): Room[] {
    const building = filter.building?.trim().toLowerCase();
    return this.deps.rooms.list({ includeOutOfService: false }).filter(
      (room) =>
        (filter.minCapacity === undefined || room.capacity >= filter.minCapacity) &&
        (building === undefined || room.building.toLowerCase() === building) &&
        (filter.equipment ?? []).every((e) => (room.equipment as string[]).includes(e)),
    );
  }

  /** Administrators: every room, in service or not. */
  listAll(): Room[] {
    return this.deps.rooms.list({ includeOutOfService: true });
  }

  /** FR-006. Unknown rooms and rooms out of service are not found. */
  availability(roomId: string, date: string): Availability {
    const { rooms, bookings, config } = this.deps;
    const room = rooms.findById(roomId);
    if (!room || !room.inService) throw roomNotFound();
    parseLocalDate(date);
    const window = openingWindow(date, config.timeZone, config.opensAt, config.closesAt);
    const { booked, free } = computeAvailability(window, bookings.listConfirmedForRoom(roomId, window.start, window.end));
    return { roomId, date, timeZone: config.timeZone, opens: config.opensAt, closes: config.closesAt, booked, free };
  }

  /** FR-007: names are unique regardless of letter case. */
  create(actorUserId: string | null, input: RoomInput): Room {
    const { rooms, uow, audit, clock } = this.deps;
    const now = clock.now();
    const room: Room = {
      id: randomUUID(),
      name: input.name,
      building: input.building,
      capacity: input.capacity,
      equipment: [...input.equipment],
      inService: true,
      createdAt: now,
      updatedAt: now,
    };
    return uow.transaction(() => {
      if (rooms.findByName(room.name)) throw roomNameTaken();
      rooms.insert(room);
      audit.record('room.created', actorUserId, { type: 'room', id: room.id });
      return room;
    });
  }

  findOrThrow(roomId: string): Room {
    const room = this.deps.rooms.findById(roomId);
    if (!room) throw roomNotFound();
    return room;
  }
}

export const roomNotFound = () => new DomainError('NOT_FOUND', 'Room not found.');

function roomNameTaken(): DomainError {
  const message = 'A room with this name already exists.';
  return new DomainError('ROOM_NAME_TAKEN', message, [{ field: 'name', message }]);
}
