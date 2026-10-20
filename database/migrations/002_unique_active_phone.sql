-- Local and international Ecuadorian formats identify the same phone.
-- Closed requests retain their history and do not prevent a new request.
CREATE UNIQUE INDEX leads_active_phone_unique
ON leads ((CASE WHEN phone LIKE '+593%' THEN '0' || substring(phone FROM 5) ELSE phone END))
WHERE status IN ('NEW', 'IN_PROGRESS');
