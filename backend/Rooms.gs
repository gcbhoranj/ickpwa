// Rooms.gs — room master data (Admin-managed) and the shared read used by
// Registration/Accommodation. Capacity/remaining are computed live from ACCOMMODATION rows
// on every read rather than trusted from a stored counter, so they can never drift.

function createRoom_(actorSession, roomNumber, building, floor, capacity) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  if (!roomNumber) throw apiError_('VALIDATION_ERROR', 'Room number is required.');
  const cap = parseInt(capacity, 10);
  if (!cap || cap < 1) throw apiError_('VALIDATION_ERROR', 'Capacity must be at least 1.');
  const existing = findRowsByField_('ROOMS', 'RoomNumber', roomNumber);
  if (existing.length > 0) throw apiError_('DUPLICATE', 'A room with this room number already exists.');

  const roomId = nextId_('ROOM', 4);
  const now = new Date().toISOString();
  appendRow_('ROOMS', {
    RoomId: roomId, RoomNumber: roomNumber, Building: building || '', Floor: floor || '',
    Capacity: cap, Status: 'AVAILABLE',
    CreatedBy: actorSession.userId, CreatedAt: now, UpdatedBy: actorSession.userId, UpdatedAt: now
  });
  return { roomId: roomId, roomNumber: roomNumber, capacity: cap, status: 'AVAILABLE' };
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
      status: r.Status
    };
  });
}
