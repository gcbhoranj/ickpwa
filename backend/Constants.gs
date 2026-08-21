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
    'DepartureLockedBy', 'DepartureLockedAt', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
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
    'ClientRequestId', 'CreatedBy', 'CreatedAt']
};

// sheetName -> ID prefix. SETTINGS (keyed) and SESSIONS (opaque random) intentionally excluded.
const ID_PREFIXES = {
  TEAMS: 'TEAM', CONTINGENT_INCHARGES: 'INC', PAYMENTS: 'PAY', CHARGES: 'CHG',
  FOOD_PACKAGES: 'PKG', FOOD_COUPONS: 'CPN', PRINTED_COUPONS: 'PRC', PACKAGE_INCHARGE_MEALS: 'PIM',
  MEAL_ENTITLEMENTS: 'ENT', MEAL_USAGE: 'USG', MEAL_ORDER_STATUS: 'STA', ROOMS: 'ROOM',
  ACCOMMODATION: 'ALLOC', ACCOMMODATION_NOC: 'NOC', REFUNDS: 'REF',
  SECURITY_REFUNDS: 'SREF', SETTLEMENTS: 'SETL', RECEIPTS: 'RCT', RELIEVING: 'REL',
  DOCUMENTS: 'DOC', EMAIL_LOG: 'EML', AUDIT_LOG: 'AUD', USERS: 'USR', LOGIN_LOG: 'LOG',
  MATCHES: 'MATCH', MATCH_FEE_TRANSACTIONS: 'MFTX'
};

// Wider zero-padding for high-volume append-only logs (spec §4).
const ID_PADDING_OVERRIDES = { AUD: 7, USG: 7, LOG: 6 };
