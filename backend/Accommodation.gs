// Accommodation.gs — room allocation for two kinds of pending need, both keyed by
// ROOM_TYPES ('TEAM' | 'INCHARGE') and always allocated into a room of the matching type
// (Rooms.gs's createRoom_/listRooms_):
//   - TEAM: every registered team's own members (TEAMS.NumberOfTeamMembers) — always
//     pending, no opt-in flag, on-campus rooms.
//   - INCHARGE: contingent incharges flagged at registration (CONTINGENT_INCHARGES.
//     NeedsAccommodation, Task 2), rest houses/hotels entered via Room Master by Admin.
// Phase 6 (spec §21) adds reallocate/vacate here; NOC issuance lives in Noc.gs.

function _accommodationNeededCount_(kind, teamId, team) {
  if (kind === ROOM_TYPES.TEAM) {
    return team ? Number(team.NumberOfTeamMembers) : 0;
  }
  return findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId)
    .filter(function (i) { return i.NeedsAccommodation === 'true' && i.Active === 'true'; }).length;
}

function listPendingAccommodation_(actorSession, kind) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.ACCOMMODATION]);
  if (kind !== ROOM_TYPES.TEAM && kind !== ROOM_TYPES.INCHARGE) {
    throw apiError_('VALIDATION_ERROR', 'kind must be TEAM or INCHARGE.');
  }
  const teams = rowsToObjects_('TEAMS');
  const allocations = rowsToObjects_('ACCOMMODATION')
    .filter(function (a) { return a.Status === 'ALLOCATED' && a.SubjectType === kind; });
  const allocatedByTeam = {};
  allocations.forEach(function (a) {
    allocatedByTeam[a.TeamId] = (allocatedByTeam[a.TeamId] || 0) + Number(a.PersonsAllocated);
  });

  const candidateTeamIds = kind === ROOM_TYPES.TEAM
    ? teams.map(function (t) { return t.TeamId; })
    : Object.keys(rowsToObjects_('CONTINGENT_INCHARGES')
        .filter(function (i) { return i.NeedsAccommodation === 'true' && i.Active === 'true'; })
        .reduce(function (acc, i) { acc[i.TeamId] = true; return acc; }, {}));

  return candidateTeamIds.map(function (teamId) {
    const team = teams.filter(function (t) { return t.TeamId === teamId; })[0];
    const needed = _accommodationNeededCount_(kind, teamId, team);
    const allocated = allocatedByTeam[teamId] || 0;
    return {
      teamId: teamId, registrationNumber: team ? team.RegistrationNumber : '', collegeName: team ? team.CollegeName : '',
      neededCount: needed, allocatedCount: allocated, remainingCount: needed - allocated
    };
  }).filter(function (row) { return row.remainingCount > 0; });
}

function allocateRoom_(actorSession, teamId, roomId, personsAllocated, kind) {
  requireRole_(actorSession, [ROLES.ACCOMMODATION]);
  if (kind !== ROOM_TYPES.TEAM && kind !== ROOM_TYPES.INCHARGE) {
    throw apiError_('VALIDATION_ERROR', 'kind must be TEAM or INCHARGE.');
  }
  const persons = parseInt(personsAllocated, 10);
  if (!persons || persons < 1) throw apiError_('VALIDATION_ERROR', 'Persons allocated must be at least 1.');

  const room = findRowById_('ROOMS', 'RoomId', roomId);
  if (!room) throw apiError_('NOT_FOUND', 'No such room: ' + roomId);
  if ((room.values.RoomType || ROOM_TYPES.TEAM) !== kind) {
    throw apiError_('ROOM_TYPE_MISMATCH', 'This room is a ' + room.values.RoomType + ' room, not ' + kind + '.');
  }
  const roomAllocations = findRowsByField_('ACCOMMODATION', 'RoomId', roomId).filter(function (a) { return a.Status === 'ALLOCATED'; });
  const roomAllocated = roomAllocations.reduce(function (sum, a) { return sum + Number(a.PersonsAllocated); }, 0);
  const roomRemaining = Number(room.values.Capacity) - roomAllocated;
  if (persons > roomRemaining) {
    throw apiError_('ROOM_FULL', 'Room only has ' + roomRemaining + ' space(s) remaining.');
  }

  const team = findRowById_('TEAMS', 'TeamId', teamId);
  const needed = _accommodationNeededCount_(kind, teamId, team ? team.values : null);
  const teamAllocations = findRowsByField_('ACCOMMODATION', 'TeamId', teamId)
    .filter(function (a) { return a.Status === 'ALLOCATED' && a.SubjectType === kind; });
  const teamAllocated = teamAllocations.reduce(function (sum, a) { return sum + Number(a.PersonsAllocated); }, 0);
  const teamRemaining = needed - teamAllocated;
  if (teamRemaining <= 0) {
    throw apiError_('NOTHING_PENDING', 'This team has no remaining ' + kind.toLowerCase() + ' persons needing accommodation.');
  }
  if (persons > teamRemaining) {
    throw apiError_('OVER_ALLOCATION', 'This team only has ' + teamRemaining + ' ' + kind.toLowerCase() + ' person(s) still needing a room.');
  }

  const allocationId = nextId_('ALLOC', 4);
  const now = new Date().toISOString();
  appendRow_('ACCOMMODATION', {
    AllocationId: allocationId, TeamId: teamId, RoomId: roomId, PersonsAllocated: persons,
    AllocatedAt: now, VacatedAt: '', Status: 'ALLOCATED', SubjectType: kind,
    CreatedBy: actorSession.userId, UpdatedBy: actorSession.userId, UpdatedAt: now
  });

  if (persons === roomRemaining) {
    updateRowById_('ROOMS', 'RoomId', roomId, { Status: 'FULL', UpdatedBy: actorSession.userId, UpdatedAt: now });
  }

  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'ALLOCATE_ROOM', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: roomId
  });

  return { allocationId: allocationId, teamId: teamId, roomId: roomId, personsAllocated: persons, kind: kind };
}

function listActiveAccommodation_(actorSession, kind) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.ACCOMMODATION]);
  if (kind !== ROOM_TYPES.TEAM && kind !== ROOM_TYPES.INCHARGE) {
    throw apiError_('VALIDATION_ERROR', 'kind must be TEAM or INCHARGE.');
  }
  const teams = rowsToObjects_('TEAMS');
  const rooms = rowsToObjects_('ROOMS');
  return rowsToObjects_('ACCOMMODATION')
    .filter(function (a) { return a.Status === 'ALLOCATED' && a.SubjectType === kind; })
    .map(function (a) {
      const team = teams.filter(function (t) { return t.TeamId === a.TeamId; })[0];
      const room = rooms.filter(function (r) { return r.RoomId === a.RoomId; })[0];
      return {
        allocationId: a.AllocationId, teamId: a.TeamId,
        registrationNumber: team ? team.RegistrationNumber : '', collegeName: team ? team.CollegeName : '',
        roomId: a.RoomId, roomNumber: room ? room.RoomNumber : '', building: room ? room.Building : '',
        personsAllocated: Number(a.PersonsAllocated), allocatedAt: a.AllocatedAt
      };
    });
}

// Idempotent by construction: capacity is always summed live from currently-ALLOCATED rows
// (Rooms.gs's listRooms_), so flipping an already-VACATED row again changes nothing and is a
// safe no-op — unlike a financial action, vacating twice has no different effect than once.
function vacateRoom_(actorSession, allocationId) {
  requireRole_(actorSession, [ROLES.ACCOMMODATION]);
  const alloc = findRowById_('ACCOMMODATION', 'AllocationId', allocationId);
  if (!alloc) throw apiError_('NOT_FOUND', 'No such allocation: ' + allocationId);
  if (alloc.values.Status === 'VACATED') {
    return { allocationId: allocationId, roomId: alloc.values.RoomId, status: 'VACATED' };
  }

  const now = new Date().toISOString();
  updateRowById_('ACCOMMODATION', 'AllocationId', allocationId, {
    Status: 'VACATED', VacatedAt: now, UpdatedBy: actorSession.userId, UpdatedAt: now
  });

  const room = findRowById_('ROOMS', 'RoomId', alloc.values.RoomId);
  if (room && room.values.Status === 'FULL') {
    updateRowById_('ROOMS', 'RoomId', alloc.values.RoomId, { Status: 'AVAILABLE', UpdatedBy: actorSession.userId, UpdatedAt: now });
  }

  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'VACATE_ROOM', Entity: 'ACCOMMODATION', EntityId: allocationId, PreviousState: 'ALLOCATED', NewState: 'VACATED'
  });

  return { allocationId: allocationId, roomId: alloc.values.RoomId, status: 'VACATED' };
}

// Vacate + allocate composed under one lock (not two independent calls) — a retry carrying the
// same clientRequestId short-circuits to the ORIGINAL new allocation instead of creating a
// second one, the same class of protection FOOD_PACKAGES' purchasePackage_ needed after the
// 2026-08-20 duplicate-purchase bug (dev-log). Reuses allocateRoom_'s own capacity/room-type
// checks rather than duplicating them.
function reallocateRoom_(actorSession, allocationId, newRoomId, clientRequestId) {
  requireRole_(actorSession, [ROLES.ACCOMMODATION]);
  if (clientRequestId) {
    const dup = findRowsByField_('ACCOMMODATION', 'ClientRequestId', clientRequestId)[0];
    if (dup) {
      return { allocationId: dup.AllocationId, teamId: dup.TeamId, roomId: dup.RoomId, personsAllocated: Number(dup.PersonsAllocated), kind: dup.SubjectType };
    }
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const alloc = findRowById_('ACCOMMODATION', 'AllocationId', allocationId);
    if (!alloc) throw apiError_('NOT_FOUND', 'No such allocation: ' + allocationId);
    if (alloc.values.Status !== 'ALLOCATED') {
      throw apiError_('ALREADY_VACATED', 'This allocation has already been vacated — nothing to reallocate.');
    }
    if (newRoomId === alloc.values.RoomId) {
      throw apiError_('VALIDATION_ERROR', 'New room must be different from the current room.');
    }

    vacateRoom_(actorSession, allocationId);
    const fresh = allocateRoom_(actorSession, alloc.values.TeamId, newRoomId, Number(alloc.values.PersonsAllocated), alloc.values.SubjectType);
    if (clientRequestId) {
      updateRowById_('ACCOMMODATION', 'AllocationId', fresh.allocationId, { ClientRequestId: clientRequestId });
    }
    return fresh;
  } finally {
    lock.releaseLock();
  }
}
