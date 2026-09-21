#!/bin/bash
# Generate "Or et Miel" via the ACE-Step UI backend.
# Requires: backend on :3001 and a reachable ACE-Step engine (ACESTEP_API_URL).
set -e
cd "$(dirname "$0")"

API="${API:-http://localhost:3001}"

echo "Checking engine..."
HEALTH=$(curl -s -m 10 "$API/api/generate/health")
echo "  $HEALTH"
if ! echo "$HEALTH" | grep -q '"healthy":true'; then
  echo "ERROR: ACE-Step engine unreachable. Point ACESTEP_API_URL at a GPU host and restart the backend."
  exit 1
fi

echo "Authenticating..."
TOKEN=$(curl -s -m 10 "$API/api/auth/auto" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')
if [ -z "$TOKEN" ]; then
  echo "ERROR: no local user yet. Open http://localhost:3000 and finish first-run setup."
  exit 1
fi

echo "Submitting generation..."
curl -s -m 60 -X POST "$API/api/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  --data-binary @or-et-miel.payload.json | tee response.json
echo
echo "Track it in the UI at http://localhost:3000, or poll:"
echo "  curl -H \"Authorization: Bearer \$TOKEN\" $API/api/generate/status/<jobId>"
