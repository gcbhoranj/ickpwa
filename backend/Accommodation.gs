// Accommodation.gs — room allocation for two kinds of pending need, both keyed by
// ROOM_TYPES ('TEAM' | 'INCHARGE') and always allocated into a room of the matching type
// (Rooms.gs's createRoom_/listRooms_):
//   - TEAM: every registered team's own members (TEAMS.NumberOfTeamMembers) — always
//     pending, no opt-in flag, on-campus rooms.
//   - INCHARGE: contingent incharges flagged at registration (CONTINGENT_INCHARGES.
//     NeedsAccommodation, Task 2), rest houses/hotels entered via Room Master by Admin.
// Deliberately narrow: allocate only — no reallocate/vacate/NOC here, those depend on the
// departure workflow (not built yet) and stay in the real future Phase 6.

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
