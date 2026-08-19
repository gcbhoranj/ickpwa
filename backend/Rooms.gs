// Rooms.gs — room master data (Admin-managed) and the shared read used by
// Registration/Accommodation. Capacity/remaining are computed live from ACCOMMODATION rows
// on every read rather than trusted from a stored counter, so they can never drift.
// Every room is one of two types (ROOM_TYPES): TEAM (on-campus, for team members) or
// INCHARGE (rest houses/hotels, for contingent incharges) — allocations only ever go into a
// room of the matching type (enforced in Accommodation.gs's allocateRoom_).

function createRoom_(actorSession, roomNumber, building, floor, capacity, roomType) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  if (!roomNumber) throw apiError_('VALIDATION_ERROR', 'Room number is required.');
  const cap = parseInt(capacity, 10);
  if (!cap || cap < 1) throw apiError_('VALIDATION_ERROR', 'Capacity must be at least 1.');
  if (roomType !== ROOM_TYPES.TEAM && roomType !== ROOM_TYPES.INCHARGE) {
    throw apiError_('VALIDATION_ERROR', 'Room type must be TEAM or INCHARGE.');
  }
  const existing = findRowsByField_('ROOMS', 'RoomNumber', roomNumber);
  if (existing.length > 0) throw apiError_('DUPLICATE', 'A room with this room number already exists.');

  const roomId = nextId_('ROOM', 4);
  const now = new Date().toISOString();
  appendRow_('ROOMS', {
    RoomId: roomId, RoomNumber: roomNumber, Building: building || '', Floor: floor || '',
    Capacity: cap, Status: 'AVAILABLE', RoomType: roomType,
    CreatedBy: actorSession.userId, CreatedAt: now, UpdatedBy: actorSession.userId, UpdatedAt: now
  });
  return { roomId: roomId, roomNumber: roomNumber, capacity: cap, status: 'AVAILABLE', roomType: roomType };
}

function listRooms_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.ACCOMMODATION]);
  const allocations = rowsToObjects_('ACCOMMODATION').filter(function (a) { return a.Status === 'ALLOCATED'; });
  return rowsToObjects_('ROOMS').map(function (r) {
    const allocated = allocations
      .filter(function (a) { return a.RoomId === r.RoomId; })
      .reduce(function (sum, a) { return sum + Number(a.PersonsAllocated); }, 0);
    return {
      roomId: r.RoomId, roomNumber: r.RoomNumber, building: r.Building, floor: r.Floor,
      capacity: Number(r.Capacity), allocated: allocated, remaining: Number(r.Capacity) - allocated,
      status: r.Status, roomType: r.RoomType || ROOM_TYPES.TEAM // pre-Phase-3.5 rows default to TEAM
    };
  });
}
