# Backend Changes Summary: Club Info & Logo Support

## Overview

Added support for club information display (payment methods, instructions, contact info) and club logos to the backend API. All changes are **backwards compatible** with the currently published mobile app.

## Database Changes

### Migration: 012_club_info_and_logo.sql

New nullable columns added to `clubs` table:

- `club_info_text` TEXT - General club information
- `credit_purchase_instructions` TEXT - How to purchase credits
- `contact_info` TEXT - Contact information
- `payment_methods` JSONB - Array of payment methods (max 5), defaults to empty array
- `club_logo_url` TEXT - URL to club logo image

**Backwards Compatibility**: All fields are nullable, existing records will have NULL values which are handled gracefully by the API.

## API Changes

### Existing Endpoint Updated

- **GET /api/clubs/:clubId**
  - Now includes optional `clubLogoUrl` field in response
  - Returns `null` for clubs without a logo
  - No breaking changes - frontend already handles optional fields

### New Endpoints Added

- **GET /api/clubs/:clubId/info** - Retrieve club information
  - Auth required (identifyUser middleware)
  - Returns: `{ clubInfoText, creditPurchaseInstructions, contactInfo, paymentMethods[], clubLogoUrl }`
  - All fields nullable, safe for existing clubs

- **PATCH /api/clubs/:clubId/info** - Update club information
  - Auth required (identifyUser middleware)
  - Owner/host only permission check
  - Accepts partial updates to any field
  - Validates max 5 payment methods
  - Creates audit log entry

## Payment Methods Schema

```typescript
type PaymentMethod = {
  id: string;
  type:
    | 'venmo'
    | 'paypal'
    | 'zelle'
    | 'cashapp'
    | 'wechat'
    | 'alipay'
    | 'other';
  label: string;
  qrImageUrl: string | null;
  paymentLink: string | null;
  note: string | null;
};
```

### Validation Rules

- Maximum 5 payment methods per club
- Payment links must be valid URLs (http:// or https://)
- Club logo URLs must be valid URLs (http:// or https://)
- Empty strings are converted to null
- All text fields are trimmed

## Recurring Sessions

Added simple recurring session support to allow clubs to create multiple weekly sessions at once.

### New Endpoint

- **POST /api/sessions/recurring** - Create multiple weekly sessions
  - Auth required (identifyUser middleware)
  - Owner/host only permission check
  - Maximum 26 weeks (26 sessions)
  - Creates independent session records (no master/series table)
  - Each session can be edited/deleted independently
  - Returns array of created sessions

### Request Body

```json
{
  "clubId": "uuid",
  "title": "string | null",
  "locationId": "uuid",
  "startTime": "ISO date string",
  "endTime": "ISO date string",
  "capacity": "number | null",
  "hostMembershipId": "uuid | null",
  "repeatCount": 4 // 1-26 weeks
}
```

### Implementation Details

- Sessions are created as normal independent rows in the `sessions` table
- No recurring master/series tables (simple approach)
- Each occurrence can be managed independently
- Weekly recurrence only (adds 7 days to each occurrence)
- Same location, capacity, and host for all occurrences

### Example Usage

```bash
curl -X POST \
  -H "x-membership-id: $MEMBERSHIP_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "clubId": "...",
    "title": "Friday Night Badminton",
    "locationId": "...",
    "startTime": "2026-05-15T19:00:00Z",
    "endTime": "2026-05-15T21:00:00Z",
    "repeatCount": 12
  }' \
  https://api.yourapp.com/api/sessions/recurring
```

### Files Modified for Recurring Sessions

- `src/services/sessionService.ts` - Added createRecurringSessions()
- `src/controllers/sessionController.ts` - Added createRecurringSessionsHandler()
- `src/routes/sessionRoutes.ts` - Added POST /api/sessions/recurring route

## Backwards Compatibility Guarantees

1. ✅ All new database columns are nullable with safe defaults
2. ✅ Existing GET /api/clubs/:clubId includes optional clubLogoUrl (null for old clubs)
3. ✅ New endpoints don't affect existing app functionality
4. ✅ Frontend types already use optional fields (clubLogoUrl?: string | null)
5. ✅ Published app will continue working without errors
6. ✅ Empty JSONB array default for payment_methods prevents null issues

## Files Modified

### Backend (club-app-backend)

- `sql/migrations/012_club_info_and_logo.sql` - New migration file
- `src/services/clubService.ts` - Added ClubInfo types, getClubInfo(), updateClubInfo()
- `src/controllers/clubController.ts` - Added getClubInfoHandler(), updateClubInfoHandler()
- `src/routes/clubRoutes.ts` - Added GET/PATCH /api/clubs/:clubId/info routes

## Migration Instructions

1. **Run the migration** (in production):

   ```bash
   # Apply migration 012
   psql $DATABASE_URL -f sql/migrations/012_club_info_and_logo.sql
   ```

2. **Deploy backend changes**:

   ```bash
   npm run build
   # Deploy to production
   ```

3. **No app update required** - Published app continues working
4. **New app version** can use club info features when ready

## Testing Backwards Compatibility

### Test existing app behavior:

```bash
# Test that GET /api/clubs/:clubId still works (now includes clubLogoUrl: null)
curl https://api.yourapp.com/api/clubs/:clubId

# Verify response includes clubLogoUrl: null for existing clubs
```

### Test new features:

```bash
# Get club info (requires auth)
curl -H "x-membership-id: $MEMBERSHIP_ID" \
  https://api.yourapp.com/api/clubs/:clubId/info

# Update club info (owner only)
curl -X PATCH \
  -H "x-membership-id: $MEMBERSHIP_ID" \
  -H "Content-Type: application/json" \
  -d '{"clubLogoUrl": "https://...", "paymentMethods": [...]}' \
  https://api.yourapp.com/api/clubs/:clubId/info
```

## Security & Permissions

- GET /api/clubs/:clubId/info - Requires authentication (any club member)
- PATCH /api/clubs/:clubId/info - Requires owner/host role
- Audit logs created for all club info updates
- Payment methods limited to 5 per club
- Input validation on all fields
