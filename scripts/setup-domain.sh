#!/bin/bash
# 2026-08-25: Cloudflare 도메인 자동 설정 — API 토큰 기반
#
# 사용법 (사용자 1회):
#   1. https://dash.cloudflare.com/profile/api-tokens 에서 토큰 생성
#      - Zone:Zone Settings:Edit 권한 포함
#   2. export CF_API_TOKEN="<your-token>"
#   3. bash scripts/setup-domain.sh [zone-name]
#      (zone-name 기본값: yndl.dev)
#
# 동작:
#   1. Zone ID 조회 (도메인 → zone_id)
#   2. HTTP/2 to Origin: Off 설정 (WebSocket 헤더 drop 해결)
#   3. SSL/TLS 모드: Full 확인 (Strict → Full)
#   4. verify-domain.sh 자동 실행 → 도메인 ws ALL PASS 검증
#
# 환경변수:
#   CF_API_TOKEN    — 필수. Cloudflare API 토큰 (Zone Settings:Edit)
#   CF_ZONE         — 선택. 기본값 yndl.dev

set -e

ZONE="${CF_ZONE:-${1:-yndl.dev}}"

if [ -z "$CF_API_TOKEN" ]; then
  echo "오류: CF_API_TOKEN 환경변수가 설정되지 않았습니다."
  echo ""
  echo "토큰 생성: https://dash.cloudflare.com/profile/api-tokens"
  echo "  권한: Zone → Zone Settings: Edit"
  echo ""
  echo "사용법: export CF_API_TOKEN=\"<your-token>\" && bash $0"
  exit 1
fi

echo "=== Cloudflare 도메인 자동 설정 ==="
echo "Zone: $ZONE"
echo ""

# 1. Zone ID 조회
echo "--- 1. Zone ID 조회 ---"
ZONE_ID=$(curl -sS -X GET "https://api.cloudflare.com/client/v4/zones?name=$ZONE" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    if d.get('success') and d.get('result'):
        print(d['result'][0]['id'])
    else:
        print('ERROR:', d.get('errors', [{'message': 'unknown'}])[0].get('message', 'unknown'))
        sys.exit(1)
except Exception as e:
    print(f'PARSE_ERROR: {e}')
    sys.exit(1)
")

if [ -z "$ZONE_ID" ] || [[ "$ZONE_ID" == ERROR:* ]] || [[ "$ZONE_ID" == PARSE_ERROR:* ]]; then
  echo "  실패: $ZONE_ID"
  exit 1
fi
echo "  Zone ID: $ZONE_ID"

# 2. HTTP/2 to Origin: Off 설정
echo ""
echo "--- 2. HTTP/2 to Origin: Off (WebSocket 헤더 drop 해결) ---"
curl -sS -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/http2" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"value":"off"}' | python3 -c "
import json, sys
d = json.load(sys.stdin)
if d.get('success'):
    print('  HTTP/2 to Origin → Off (성공)')
else:
    print('  실패:', d.get('errors', [{'message': 'unknown'}])[0].get('message'))
    sys.exit(1)
"

# 3. SSL/TLS 모드 확인
echo ""
echo "--- 3. SSL/TLS 모드 확인 ---"
curl -sS -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings/ssl" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | python3 -c "
import json, sys
d = json.load(sys.stdin)
if d.get('success'):
    val = d['result']['value']
    print(f'  SSL 모드: {val}')
    if val == 'full':
        print('  (HTTP origin과 호환 — OK)')
    elif val == 'strict':
        print('  ⚠️ Strict — 우리 caddy는 HTTP만 제공 중이므로 cert 검증 실패 가능')
        print('     → Dashboard에서 Full로 변경 필요 (또는 SSL 설정 후 Strict)')
    elif val == 'flexible':
        print('  (Flexible — OK)')
else:
    print('  조회 실패')
"

# 4. propagation 대기 + 도메인 검증
echo ""
echo "--- 4. 도메인 검증 (30초 대기 후) ---"
echo "Cloudflare 전파 시간 ~30초..."
sleep 30
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN=$(curl -sS -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d['result']['name'])
")
echo "도메인: $DOMAIN (zone의 apex, 서브 도메인은 verify 시 직접 지정)"
echo ""
bash "$SCRIPT_DIR/verify-domain.sh" "trail.$DOMAIN" 2>&1 | tail -20 || true
