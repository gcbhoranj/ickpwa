// Constants.gs — single source of truth for sheet IDs, roles, and schema.

const SHEET_ID = '1eJpS9npNxcTQNTC9bfxnVOmJ74tv4dLiET6Xj6XcSyI';

const ROLES = {
  ADMIN: 'ADMIN',
  REGISTRATION: 'REGISTRATION',
  MESS: 'MESS',
  ACCOMMODATION: 'ACCOMMODATION'
};

// Room Master entries and their accommodation allocations both come in these two flavors:
// TEAM rooms (on-campus, for team members) and INCHARGE rooms (rest houses/hotels, for
// contingent incharges). A room only ever accepts allocations of its own type.
const ROOM_TYPES = { TEAM: 'TEAM', INCHARGE: 'INCHARGE' };

// Answer choices for both the pre-registration Google Form's "Mode of Travelling" dropdown
// and the registration wizard's own Travel Mode field — one shared list so the two can never
// drift apart (PreRegistration.gs's form-builder and Registration.gs's registerTeam_ both
// read this).
const TRAVEL_MODES = ['By Bus', 'By hired vehicle', 'By College vehicle'];

// Google Form item titles for the pre-registration form — shared between the form-builder
// (setupPreRegistrationForm_) and the response parser (_parsePreRegFormResponse_ matches
// FormResponse.getItemResponses() entries by title, not position, so the parser keeps working
// even if Forms reorders items internally). Only Incharge 1's Name is required on the form;
// Incharges 2/3 are optional slots for teams that have them (spec: fixed slots, not a dynamic
// repeating group — Google Forms can't do the latter).
const PRE_REG_FORM_QUESTIONS = {
  CollegeName: 'College Name',
  DistrictName: 'District Name',
  NumberOfTeamMembers: 'Number of Team Members',
  Incharge1Name: 'Contingent Incharge 1 — Name',
  Incharge1Designation: 'Contingent Incharge 1 — Designation',
  Incharge1WhatsApp: 'Contingent Incharge 1 — WhatsApp Number',
  Incharge1Email: 'Contingent Incharge 1 — Email Address',
  Incharge2Name: 'Contingent Incharge 2 — Name (if any)',
  Incharge2Designation: 'Contingent Incharge 2 — Designation',
  Incharge2WhatsApp: 'Contingent Incharge 2 — WhatsApp Number',
  Incharge2Email: 'Contingent Incharge 2 — Email Address',
  Incharge3Name: 'Contingent Incharge 3 — Name (if any)',
  Incharge3Designation: 'Contingent Incharge 3 — Designation',
  Incharge3WhatsApp: 'Contingent Incharge 3 — WhatsApp Number',
  Incharge3Email: 'Contingent Incharge 3 — Email Address',
  TravelMode: 'Mode of Travelling of Team'
};

// Settings keys that uploadSignature_ (Settings.gs) is allowed to write — a fixed allowlist,
// never an arbitrary Settings key, since the upload action is driven by a client-supplied key
// string. Consumed by FinalDocuments.gs's Final Receipt/Relieving Order layout and Noc.gs's
// NOC Certificate layout, each via _drawSignatureOrLine_.
const SIGNATURE_SETTING_KEYS = {
  RegistrationInchargeSignatureFileId: 'Registration Committee Convener Signature',
  AccommodationConvenerSignatureFileId: 'Accommodation Committee Convener Signature',
  PrincipalSignatureFileId: 'Principal Signature',
  PrincipalSealFileId: 'Principal\'s Seal'
};

// sheetName -> ordered header row. This IS the schema; SheetHelpers/Setup read from here.
const SHEET_SCHEMAS = {
  SETTINGS: ['Key', 'Value', 'UpdatedBy', 'UpdatedAt'],
  USERS: ['UserId', 'Name', 'Email', 'LoginId', 'Role', 'PasswordHash', 'PasswordSalt',
    'Active', 'CreatedDate', 'LastLoginAt', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  SESSIONS: ['SessionId', 'UserId', 'Role', 'IssuedAt', 'ExpiresAt', 'Status', 'LastSeenAt'],
  LOGIN_LOG: ['LogId', 'Attempted', 'Result', 'Timestamp'],
  TEAMS: ['TeamId', 'RegistrationNumber', 'CollegeName', 'DistrictName', 'NumberOfTeamMembers',
    'NumberOfContingentIncharges', 'TotalContingentPersons', 'RegistrationDateTime', 'Status',
    'DepartureLockedBy', 'DepartureLockedAt', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt',
    'TravelMode'],
  CONTINGENT_INCHARGES: ['InchargeId', 'TeamId', 'Name', 'Designation', 'WhatsAppNumber',
    'EmailAddress', 'IsPrimary', 'Active', 'NeedsAccommodation', 'CreatedBy', 'CreatedAt',
    'UpdatedBy', 'UpdatedAt'],
  PAYMENTS: ['PaymentId', 'TeamId', 'Amount', 'Mode', 'ReceivedAt', 'Purpose', 'ReversalOf',
    'CreatedBy', 'CreatedAt'],
  CHARGES: ['ChargeId', 'TeamId', 'RateBreakfastSnapshot', 'RateLunchSnapshot',
    'RateDinnerSnapshot', 'RateDariSnapshot', 'SecurityAmountSnapshot', 'DariCharges',
    'MealCharges', 'SecurityCharges', 'TotalPayable', 'CalculatedAt', 'CreatedBy'],
  FOOD_PACKAGES: ['PackageId', 'TeamId', 'PackageNumber', 'CouponId',
    'IncludeInchargesInEntitlement', 'EligiblePersons', 'PurchaseDateTime', 'Amount',
    'RateBreakfastSnapshot', 'RateLunchSnapshot', 'RateDinnerSnapshot', 'StartMeal', 'EndMeal',
    'Status', 'QrToken', 'DigitalCouponPdfFileId', 'PrintedCouponPdfFileId', 'EmailStatus',
    'ClientRequestId', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  FOOD_COUPONS: ['CouponId', 'PackageId', 'TeamId', 'QrToken', 'Status', 'IssuedAt'],
  // One row per incharge on the team, written at purchase time regardless of whether they
  // opted into any meal (a complete audit trail of who was asked and what they chose, not
  // just who's included) — never edited afterward, matching every other transactional sheet.
  PACKAGE_INCHARGE_MEALS: ['PackageInchargeMealId', 'PackageId', 'InchargeId', 'InchargeName',
    'IncludeBreakfast', 'IncludeLunch', 'IncludeDinner', 'CreatedBy', 'CreatedAt'],
  PRINTED_COUPONS: ['PrintedCouponId', 'CouponId', 'PackageId', 'SequenceNumber', 'TotalCount',
    'PrintBatchId', 'GeneratedAt', 'GeneratedBy'],
  MEAL_ENTITLEMENTS: ['EntitlementId', 'PackageId', 'TeamId', 'Date', 'Meal', 'Rate',
    'EligiblePersons', 'ServedPersons', 'RemainingPersons', 'RefundablePersons',
    'RefundableAmount', 'MealOrderStatus', 'ValidFrom', 'ValidUntil', 'Status'],
  MEAL_USAGE: ['UsageId', 'CouponId', 'PackageId', 'TeamId', 'EntitlementId', 'Date', 'Meal',
    'PreviousServedCount', 'ClaimAmount', 'NewServedTotal', 'RemainingAfter', 'MessUser',
    'Timestamp', 'ClientRequestId'],
  MEAL_ORDER_STATUS: ['StatusId', 'Date', 'Meal', 'Status', 'SetBy', 'SetAt'],
  ROOMS: ['RoomId', 'RoomNumber', 'Building', 'Floor', 'Capacity', 'Status', 'CreatedBy',
    'CreatedAt', 'UpdatedBy', 'UpdatedAt', 'RoomType'],
  ACCOMMODATION: ['AllocationId', 'TeamId', 'RoomId', 'PersonsAllocated', 'AllocatedAt',
    'VacatedAt', 'Status', 'CreatedBy', 'UpdatedBy', 'UpdatedAt', 'SubjectType', 'ClientRequestId'],
  ACCOMMODATION_NOC: ['NocId', 'TeamId', 'Status', 'IssuedBy', 'IssuedAt', 'Notes', 'PdfFileId'],
  REFUNDS: ['RefundId', 'TeamId', 'EntitlementId', 'Meal', 'Date', 'EligiblePersons',
    'ServedPersons', 'MealOrderStatusAtCalc', 'RefundablePersons', 'RefundAmount',
    'CalculatedAt', 'ProcessedAt', 'ProcessedBy'],
  SECURITY_REFUNDS: ['SecurityRefundId', 'TeamId', 'Amount', 'NocId', 'RefundedAt',
    'RefundedBy', 'Ticked'],
  SETTLEMENTS: ['SettlementId', 'TeamId', 'GrossMealCharges', 'GrossDariCharges',
    'GrossCharges', 'FoodRefund', 'OtherAdjustments', 'NetCharges', 'SecurityCollected',
    'SecurityRefunded', 'FinalBalance', 'SettledAt', 'SettledBy', 'Status'],
  RECEIPTS: ['ReceiptId', 'ReceiptNumber', 'Type', 'TeamId', 'SettlementId',
    'GrossMealCharges', 'GrossDariCharges', 'GrandTotal', 'FoodRefundTotal', 'NetAmount',
    'AmountInWords', 'GeneratedAt', 'GeneratedBy', 'PdfFileId'],
  RELIEVING: ['RelievingId', 'RelievingNumber', 'TeamId', 'Session', 'RelievingDate',
    'InchargeNamesText', 'TeamMemberCount', 'GeneratedAt', 'GeneratedBy', 'PdfFileId'],
  DOCUMENTS: ['DocumentId', 'Type', 'TeamId', 'RelatedId', 'DriveFileId', 'GeneratedAt',
    'GeneratedBy'],
  EMAIL_LOG: ['EmailId', 'DocumentId', 'Recipient', 'Subject', 'SentAt', 'User', 'Status',
    'ErrorMessage'],
  AUDIT_LOG: ['AuditId', 'Timestamp', 'UserId', 'Role', 'Action', 'Entity', 'EntityId',
    'PreviousState', 'NewState'],
  MATCHES: ['MatchId', 'MatchNumber', 'MatchDate', 'Team1Id', 'Team2Id', 'Status',
    'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  MATCH_FEE_TRANSACTIONS: ['TransactionId', 'MatchId', 'TeamId', 'OpponentTeamId', 'Amount',
    'RateSnapshot', 'PaymentMethod', 'PaidAt', 'CollectedBy', 'ReceiptNumber',
    'ReceiptPdfFileId', 'EmailStatus', 'Status', 'VoidReason', 'VoidedBy', 'VoidedAt',
    'ClientRequestId', 'CreatedBy', 'CreatedAt'],
  // Flattened (no separate incharges table) — the Google Form has fixed slots for up to 3
  // incharges, not a dynamic repeating group, so there's nothing to normalize. CollegeNameKey
  // is the trimmed/lowercased CollegeName, used only as the upsert-matching key in
  // PreRegistration.gs (display always uses the original CollegeName). Status is PENDING or
  // CONVERTED; TeamId/ConvertedAt/ConvertedBy are filled in once the committee converts the
  // entry into a real team at physical check-in.
  PRE_REGISTRATIONS: ['PreRegId', 'CollegeName', 'CollegeNameKey', 'DistrictName',
    'NumberOfTeamMembers', 'TravelMode',
    'Incharge1Name', 'Incharge1Designation', 'Incharge1WhatsApp', 'Incharge1Email',
    'Incharge2Name', 'Incharge2Designation', 'Incharge2WhatsApp', 'Incharge2Email',
    'Incharge3Name', 'Incharge3Designation', 'Incharge3WhatsApp', 'Incharge3Email',
    'FormSubmittedAt', 'Status', 'TeamId', 'ConvertedAt', 'ConvertedBy', 'CreatedAt', 'UpdatedAt']
};

// sheetName -> ID prefix. SETTINGS (keyed) and SESSIONS (opaque random) intentionally excluded.
const ID_PREFIXES = {
  TEAMS: 'TEAM', CONTINGENT_INCHARGES: 'INC', PAYMENTS: 'PAY', CHARGES: 'CHG',
  FOOD_PACKAGES: 'PKG', FOOD_COUPONS: 'CPN', PRINTED_COUPONS: 'PRC', PACKAGE_INCHARGE_MEALS: 'PIM',
  MEAL_ENTITLEMENTS: 'ENT', MEAL_USAGE: 'USG', MEAL_ORDER_STATUS: 'STA', ROOMS: 'ROOM',
  ACCOMMODATION: 'ALLOC', ACCOMMODATION_NOC: 'NOC', REFUNDS: 'REF',
  SECURITY_REFUNDS: 'SREF', SETTLEMENTS: 'SETL', RECEIPTS: 'RCT', RELIEVING: 'REL',
  DOCUMENTS: 'DOC', EMAIL_LOG: 'EML', AUDIT_LOG: 'AUD', USERS: 'USR', LOGIN_LOG: 'LOG',
  MATCHES: 'MATCH', MATCH_FEE_TRANSACTIONS: 'MFTX', PRE_REGISTRATIONS: 'PREG'
};

// Wider zero-padding for high-volume append-only logs (spec §4).
const ID_PADDING_OVERRIDES = { AUD: 7, USG: 7, LOG: 6 };
