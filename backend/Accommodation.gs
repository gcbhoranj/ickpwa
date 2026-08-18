// Accommodation.gs — incharge accommodation needs (flagged at registration, Task 2) and
// room allocation. Deliberately narrow: allocate only — no reallocate/vacate/NOC here, those
// depend on the departure workflow (not built yet) and stay in the real future Phase 6.

function listPendingAccommodation_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION, ROLES.ACCOMMODATION]);
  const allIncharges = rowsToObjects_('CONTINGENT_INCHARGES').filter(function (i) { return i.NeedsAccommodation === 'true' && i.Active === 'true'; });
  const allocations = rowsToObjects_('ACCOMMODATION').filter(function (a) { return a.Status === 'ALLOCATED'; });
  const teams = rowsToObjects_('TEAMS');

  const neededByTeam = {};
  allIncharges.forEach(function (i) {
    neededByTeam[i.TeamId] = (neededByTeam[i.TeamId] || 0) + 1;
  });
  const allocatedByTeam = {};
  allocations.forEach(function (a) {
    allocatedByTeam[a.TeamId] = (allocatedByTeam[a.TeamId] || 0) + Number(a.PersonsAllocated);
  });

  return Object.keys(neededByTeam).map(function (teamId) {
    const team = teams.filter(function (t) { return t.TeamId === teamId; })[0];
    const needed = neededByTeam[teamId];
    const allocated = allocatedByTeam[teamId] || 0;
    return {
      teamId: teamId, registrationNumber: team ? team.RegistrationNumber : '', collegeName: team ? team.CollegeName : '',
      neededCount: needed, allocatedCount: allocated, remainingCount: needed - allocated
    };
  }).filter(function (row) { return row.remainingCount > 0; });
}

function allocateRoom_(actorSession, teamId, roomId, personsAllocated) {
  requireRole_(actorSession, [ROLES.ACCOMMODATION]);
  const persons = parseInt(personsAllocated, 10);
  if (!persons || persons < 1) throw apiError_('VALIDATION_ERROR', 'Persons allocated must be at least 1.');

  const room = findRowById_('ROOMS', 'RoomId', roomId);
  if (!room) throw apiError_('NOT_FOUND', 'No such room: ' + roomId);
  const roomAllocations = findRowsByField_('ACCOMMODATION', 'RoomId', roomId).filter(function (a) { return a.Status === 'ALLOCATED'; });
  const roomAllocated = roomAllocations.reduce(function (sum, a) { return sum + Number(a.PersonsAllocated); }, 0);
  const roomRemaining = Number(room.values.Capacity) - roomAllocated;
  if (persons > roomRemaining) {
    throw apiError_('ROOM_FULL', 'Room only has ' + roomRemaining + ' space(s) remaining.');
  }

  const neededIncharges = findRowsByField_('CONTINGENT_INCHARGES', 'TeamId', teamId)
    .filter(function (i) { return i.NeedsAccommodation === 'true' && i.Active === 'true'; });
  const teamAllocations = findRowsByField_('ACCOMMODATION', 'TeamId', teamId).filter(function (a) { return a.Status === 'ALLOCATED'; });
  const teamAllocated = teamAllocations.reduce(function (sum, a) { return sum + Number(a.PersonsAllocated); }, 0);
  const teamRemaining = neededIncharges.length - teamAllocated;
  if (teamRemaining <= 0) {
    throw apiError_('NOTHING_PENDING', 'This team has no remaining incharges needing accommodation.');
  }
  if (persons > teamRemaining) {
    throw apiError_('OVER_ALLOCATION', 'This team only has ' + teamRemaining + ' incharge(s) still needing a room.');
  }

  const allocationId = nextId_('ALLOC', 4);
  const now = new Date().toISOString();
  appendRow_('ACCOMMODATION', {
    AllocationId: allocationId, TeamId: teamId, RoomId: roomId, PersonsAllocated: persons,
    AllocatedAt: now, VacatedAt: '', Status: 'ALLOCATED',
    CreatedBy: actorSession.userId, UpdatedBy: actorSession.userId, UpdatedAt: now
  });

  if (persons === roomRemaining) {
    updateRowById_('ROOMS', 'RoomId', roomId, { Status: 'FULL', UpdatedBy: actorSession.userId, UpdatedAt: now });
  }

  appendRow_('AUDIT_LOG', {
    AuditId: nextId_('AUD', 7), Timestamp: now, UserId: actorSession.userId, Role: actorSession.role,
    Action: 'ALLOCATE_ROOM', Entity: 'TEAM', EntityId: teamId, PreviousState: '', NewState: roomId
  });

  return { allocationId: allocationId, teamId: teamId, roomId: roomId, personsAllocated: persons };
}
