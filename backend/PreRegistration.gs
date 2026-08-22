// PreRegistration.gs — Google Form pre-registration: colleges submit their team details well
// in advance (the same questions as the in-person registration wizard, plus "Mode of
// Travelling of Team"), the app generates and owns the Form, and submissions land in
// PRE_REGISTRATIONS ready for the Registration Committee to pick up, verify/edit, and convert
// into a real team on opening day (Registration.gs's registerTeam_ takes the resulting
// preRegId and marks it converted — see that file).
//
// Flattened schema, not a normalized incharges table: the Form has fixed slots for up to 3
// incharges (a dynamic repeating group isn't something Google Forms supports), so there's
// nothing to normalize — getPreRegistrationDetail_ reshapes the slots into the same
// {name, designation, whatsapp, email} array shape CONTINGENT_INCHARGES already uses, so the
// wizard's prefill code never needs to know about the flattened storage.
//
// Ingestion has two paths that share one upsert function (_upsertPreRegistrationRow_): a
// real-time onFormSubmit trigger (installed by setupPreRegistrationForm_) and a manual
// "Sync now" pull (syncPreRegistrationForm_) for when the trigger needs a fallback. Both are
// safe to run repeatedly — see that function's header for the auto-replace-by-college rule
// and the PreRegistrationLastSyncedAt watermark that keeps a manual sync from ever
// reprocessing a submission that's already been folded into a (possibly since-converted) row.

function _preRegCollegeKey_(collegeName) {
  return String(collegeName || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Advances the 'PreRegistrationLastSyncedAt' watermark to `submittedAtIso` if that's newer
// than what's currently stored. ISO 8601 strings compare correctly with plain `<`/`>`.
// Called after every successful ingest (trigger or manual sync) so that a later manual sync
// only asks Google Forms for responses after the newest one already folded in — without this,
// a sync could re-walk the form's entire response history and re-append a fresh PENDING row
// for a college whose earlier submission has since been converted into a real team (the
// upsert rule below only auto-replaces a PENDING match; a CONVERTED one is deliberately left
// alone), which would wrongly resurrect it as "still pending."
function _advancePreRegWatermark_(submittedAtIso) {
  const current = getSetting_('PreRegistrationLastSyncedAt', null);
  if (!current || submittedAtIso > current) {
    setSetting_('PreRegistrationLastSyncedAt', submittedAtIso, 'system');
  }
}

// Reads a Form submission by item TITLE (not position) — robust to Google Forms reordering
// items internally, which position-based reads would silently break on.
function _parsePreRegFormResponse_(formResponse) {
  const answers = {};
  formResponse.getItemResponses().forEach(function (itemResponse) {
    answers[itemResponse.getItem().getTitle()] = itemResponse.getResponse();
  });
  function get(key) {
    const title = PRE_REG_FORM_QUESTIONS[key];
    const value = answers[title];
    return value === null || value === undefined ? '' : String(value).trim();
  }
  return {
    CollegeName: get('CollegeName'),
    DistrictName: get('DistrictName'),
    NumberOfTeamMembers: get('NumberOfTeamMembers'),
    TravelMode: get('TravelMode'),
    Incharge1Name: get('Incharge1Name'), Incharge1Designation: get('Incharge1Designation'),
    Incharge1WhatsApp: get('Incharge1WhatsApp'), Incharge1Email: get('Incharge1Email'),
    Incharge2Name: get('Incharge2Name'), Incharge2Designation: get('Incharge2Designation'),
    Incharge2WhatsApp: get('Incharge2WhatsApp'), Incharge2Email: get('Incharge2Email'),
    Incharge3Name: get('Incharge3Name'), Incharge3Designation: get('Incharge3Designation'),
    Incharge3WhatsApp: get('Incharge3WhatsApp'), Incharge3Email: get('Incharge3Email'),
    FormSubmittedAt: formResponse.getTimestamp().toISOString()
  };
}

// The one write path both ingestion routes share. Auto-replace rule (per spec): a new
// submission overwrites the existing PENDING row for the same college (trimmed/lowercased
// match) in place; if the only existing match has already been CONVERTED, it's left
// untouched and this submission becomes a fresh PENDING row instead — so a stray resubmission
// after a team has already checked in can never un-convert or hide that team's link.
function _upsertPreRegistrationRow_(parsed) {
  if (!parsed.CollegeName) throw apiError_('VALIDATION_ERROR', 'Pre-registration submission is missing a college name.');
  const key = _preRegCollegeKey_(parsed.CollegeName);
  const now = new Date().toISOString();
  const existingPending = findRowsByField_('PRE_REGISTRATIONS', 'CollegeNameKey', key)
    .filter(function (r) { return r.Status === 'PENDING'; })[0];

  const fields = {
    CollegeName: parsed.CollegeName, CollegeNameKey: key, DistrictName: parsed.DistrictName,
    NumberOfTeamMembers: parsed.NumberOfTeamMembers, TravelMode: parsed.TravelMode,
    Incharge1Name: parsed.Incharge1Name, Incharge1Designation: parsed.Incharge1Designation,
    Incharge1WhatsApp: parsed.Incharge1WhatsApp, Incharge1Email: parsed.Incharge1Email,
    Incharge2Name: parsed.Incharge2Name, Incharge2Designation: parsed.Incharge2Designation,
    Incharge2WhatsApp: parsed.Incharge2WhatsApp, Incharge2Email: parsed.Incharge2Email,
    Incharge3Name: parsed.Incharge3Name, Incharge3Designation: parsed.Incharge3Designation,
    Incharge3WhatsApp: parsed.Incharge3WhatsApp, Incharge3Email: parsed.Incharge3Email,
    FormSubmittedAt: parsed.FormSubmittedAt, UpdatedAt: now
  };

  let result;
  if (existingPending) {
    result = updateRowById_('PRE_REGISTRATIONS', 'PreRegId', existingPending.PreRegId, fields);
  } else {
    fields.PreRegId = nextId_('PREG', 4);
    fields.Status = 'PENDING';
    fields.TeamId = '';
    fields.ConvertedAt = '';
    fields.ConvertedBy = '';
    fields.CreatedAt = now;
    result = appendRow_('PRE_REGISTRATIONS', fields);
  }
  _advancePreRegWatermark_(parsed.FormSubmittedAt);
  return result;
}

// Installable trigger target (see setupPreRegistrationForm_) — fires once per real submission.
// Never lets a malformed/unexpected submission crash silently: failures are logged to
// AUDIT_LOG instead, so the committee can notice and reconcile via "Sync now" rather than a
// team's pre-registration simply never appearing with no trace of why.
function onPreRegistrationFormSubmit_(e) {
  try {
    _upsertPreRegistrationRow_(_parsePreRegFormResponse_(e.response));
  } catch (err) {
    const now = new Date().toISOString();
    appendRow_('AUDIT_LOG', {
      AuditId: nextId_('AUD', 7), Timestamp: now, UserId: 'system', Role: 'SYSTEM',
      Action: 'PRE_REG_INGEST_ERROR', Entity: 'PRE_REGISTRATION', EntityId: '',
      PreviousState: '', NewState: err.message
    });
  }
}

// ADMIN action: creates the Form (or, with force, recreates it) and installs its trigger.
// Idempotent without force — calling it again just returns the already-generated form's info
// rather than creating a duplicate.
function setupPreRegistrationForm_(actorSession, force) {
  requireRole_(actorSession, [ROLES.ADMIN]);
  const existingFormId = getSetting_('PreRegistrationFormId', null);
  if (existingFormId && !force) {
    const existing = FormApp.openById(existingFormId);
    return { formId: existingFormId, formUrl: existing.getPublishedUrl(), created: false };
  }

  const tournamentName = getSetting_('TournamentName', 'Tournament');
  const form = FormApp.create(tournamentName + ' — Team Pre-Registration');
  form.setDescription(
    'Please fill this in well in advance so your team\'s details are ready before you arrive. ' +
    'Made a mistake or need to change something? Just submit the form again — a new submission ' +
    'replaces your college\'s previous one, there\'s no need to contact anyone.'
  );
  form.setCollectEmail(false);
  // Deliberately off — see file header: Google's own "edit your response" link does not
  // re-fire onFormSubmit, so an edited-in-place response would silently go stale. Resubmission
  // (handled by the upsert rule above) is the supported way to correct a submission.
  form.setAllowResponseEdits(false);

  form.addTextItem().setTitle(PRE_REG_FORM_QUESTIONS.CollegeName).setRequired(true);
  form.addTextItem().setTitle(PRE_REG_FORM_QUESTIONS.DistrictName).setRequired(true);
  form.addTextItem().setTitle(PRE_REG_FORM_QUESTIONS.NumberOfTeamMembers).setRequired(true);

  form.addTextItem().setTitle(PRE_REG_FORM_QUESTIONS.Incharge1Name).setRequired(true);
  form.addTextItem().setTitle(PRE_REG_FORM_QUESTIONS.Incharge1Designation).setRequired(false);
  form.addTextItem().setTitle(PRE_REG_FORM_QUESTIONS.Incharge1WhatsApp).setRequired(false);
  form.addTextItem().setTitle(PRE_REG_FORM_QUESTIONS.Incharge1Email).setRequired(false);

  form.addTextItem().setTitle(PRE_REG_FORM_QUESTIONS.Incharge2Name).setRequired(false);
  form.addTextItem().setTitle(PRE_REG_FORM_QUESTIONS.Incharge2Designation).setRequired(false);
  form.addTextItem().setTitle(PRE_REG_FORM_QUESTIONS.Incharge2WhatsApp).setRequired(false);
  form.addTextItem().setTitle(PRE_REG_FORM_QUESTIONS.Incharge2Email).setRequired(false);

  form.addTextItem().setTitle(PRE_REG_FORM_QUESTIONS.Incharge3Name).setRequired(false);
  form.addTextItem().setTitle(PRE_REG_FORM_QUESTIONS.Incharge3Designation).setRequired(false);
  form.addTextItem().setTitle(PRE_REG_FORM_QUESTIONS.Incharge3WhatsApp).setRequired(false);
  form.addTextItem().setTitle(PRE_REG_FORM_QUESTIONS.Incharge3Email).setRequired(false);

  form.addListItem().setTitle(PRE_REG_FORM_QUESTIONS.TravelMode).setChoiceValues(TRAVEL_MODES).setRequired(true);

  // Remove any trigger left over from a previous form (the force-recreate case) before
  // installing the new one — never leave two triggers, or one still pointed at a form that no
  // longer exists.
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'onPreRegistrationFormSubmit_') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('onPreRegistrationFormSubmit_').forForm(form).onFormSubmit().create();

  setSetting_('PreRegistrationFormId', form.getId(), actorSession.userId);
  setSetting_('PreRegistrationFormUrl', form.getPublishedUrl(), actorSession.userId);
  // A brand-new form has zero responses — starting the watermark at "now" means a future sync
  // never has to walk further back than this form's own creation.
  setSetting_('PreRegistrationLastSyncedAt', new Date().toISOString(), actorSession.userId);

  return { formId: form.getId(), formUrl: form.getPublishedUrl(), created: true };
}

function getPreRegistrationFormInfo_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  return {
    formId: getSetting_('PreRegistrationFormId', null),
    formUrl: getSetting_('PreRegistrationFormUrl', null)
  };
}

// Manual fallback for the trigger (see file header). Only asks Google Forms for responses
// after the watermark, so it never reprocesses a submission already folded in.
function syncPreRegistrationForm_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const formId = getSetting_('PreRegistrationFormId', null);
  if (!formId) throw apiError_('NOT_FOUND', 'No pre-registration form has been generated yet — run admin.bootstrap.setupPreRegistrationForm first.');
  const form = FormApp.openById(formId);
  const watermark = getSetting_('PreRegistrationLastSyncedAt', null);
  const responses = watermark ? form.getResponses(new Date(watermark)) : form.getResponses();
  let synced = 0;
  const errors = [];
  responses.forEach(function (formResponse) {
    try {
      _upsertPreRegistrationRow_(_parsePreRegFormResponse_(formResponse));
      synced++;
    } catch (err) {
      errors.push(err.message);
    }
  });
  return { totalChecked: responses.length, synced: synced, errors: errors };
}

function listPendingPreRegistrations_(actorSession) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  return rowsToObjects_('PRE_REGISTRATIONS')
    .filter(function (r) { return r.Status === 'PENDING'; })
    .sort(function (a, b) { return a.FormSubmittedAt < b.FormSubmittedAt ? 1 : -1; })
    .map(function (r) {
      return {
        preRegId: r.PreRegId, collegeName: r.CollegeName, districtName: r.DistrictName,
        numberOfTeamMembers: r.NumberOfTeamMembers, travelMode: r.TravelMode,
        formSubmittedAt: r.FormSubmittedAt
      };
    });
}

// Reshapes the flattened Incharge1../Incharge2../Incharge3.. slots into the same
// {name, designation, whatsapp, email, isPrimary, needsAccommodation} array shape the
// registration wizard already builds from CONTINGENT_INCHARGES, so the wizard's prefill code
// doesn't need any awareness of the form's fixed-slot storage. A slot with no name filled in
// is simply omitted, not sent through as an empty incharge row.
function getPreRegistrationDetail_(actorSession, preRegId) {
  requireRole_(actorSession, [ROLES.ADMIN, ROLES.REGISTRATION]);
  const found = findRowById_('PRE_REGISTRATIONS', 'PreRegId', preRegId);
  if (!found) throw apiError_('NOT_FOUND', 'No such pre-registration: ' + preRegId);
  const r = found.values;
  if (r.Status !== 'PENDING') throw apiError_('ALREADY_CONVERTED', 'This pre-registration has already been converted to a team.');
  const incharges = [];
  [1, 2, 3].forEach(function (n) {
    const name = r['Incharge' + n + 'Name'];
    if (!name) return;
    incharges.push({
      name: name, designation: r['Incharge' + n + 'Designation'] || '',
      whatsapp: r['Incharge' + n + 'WhatsApp'] || '', email: r['Incharge' + n + 'Email'] || '',
      isPrimary: n === 1, needsAccommodation: false
    });
  });
  return {
    preRegId: r.PreRegId, collegeName: r.CollegeName, districtName: r.DistrictName,
    numberOfTeamMembers: r.NumberOfTeamMembers, travelMode: r.TravelMode, incharges: incharges
  };
}
