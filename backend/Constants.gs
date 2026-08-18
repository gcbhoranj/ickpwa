// Constants.gs — single source of truth for sheet IDs, roles, and schema.

const SHEET_ID = '1eJpS9npNxcTQNTC9bfxnVOmJ74tv4dLiET6Xj6XcSyI';

const ROLES = {
  ADMIN: 'ADMIN',
  REGISTRATION: 'REGISTRATION',
  MESS: 'MESS',
  ACCOMMODATION: 'ACCOMMODATION'
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
    'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  FOOD_COUPONS: ['CouponId', 'PackageId', 'TeamId', 'QrToken', 'Status', 'IssuedAt'],
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
    'CreatedAt', 'UpdatedBy', 'UpdatedAt'],
  ACCOMMODATION: ['AllocationId', 'TeamId', 'RoomId', 'PersonsAllocated', 'AllocatedAt',
    'VacatedAt', 'Status', 'CreatedBy', 'UpdatedBy', 'UpdatedAt'],
  ACCOMMODATION_NOC: ['NocId', 'TeamId', 'Status', 'IssuedBy', 'IssuedAt', 'Notes'],
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
    'PreviousState', 'NewState']
};

// sheetName -> ID prefix. SETTINGS (keyed) and SESSIONS (opaque random) intentionally excluded.
const ID_PREFIXES = {
  TEAMS: 'TEAM', CONTINGENT_INCHARGES: 'INC', PAYMENTS: 'PAY', CHARGES: 'CHG',
  FOOD_PACKAGES: 'PKG', FOOD_COUPONS: 'CPN', PRINTED_COUPONS: 'PRC',
  MEAL_ENTITLEMENTS: 'ENT', MEAL_USAGE: 'USG', MEAL_ORDER_STATUS: 'STA', ROOMS: 'ROOM',
  ACCOMMODATION: 'ALLOC', ACCOMMODATION_NOC: 'NOC', REFUNDS: 'REF',
  SECURITY_REFUNDS: 'SREF', SETTLEMENTS: 'SETL', RECEIPTS: 'RCT', RELIEVING: 'REL',
  DOCUMENTS: 'DOC', EMAIL_LOG: 'EML', AUDIT_LOG: 'AUD', USERS: 'USR', LOGIN_LOG: 'LOG'
};

// Wider zero-padding for high-volume append-only logs (spec §4).
const ID_PADDING_OVERRIDES = { AUD: 7, USG: 7, LOG: 6 };
