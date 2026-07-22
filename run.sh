#!/usr/bin/env bash
# 🀄 루미큐브 실행 스크립트 (공유 모드: 클라이언트 빌드 → 서버가 프론트+실시간 모두 서빙)
#
# 사용법:
#   ./run.sh              클라이언트 빌드 + 서버 실행 (기본 포트 8123)
#   ./run.sh 8091         포트 지정
#   PORT=8091 ./run.sh    환경변수로 포트 지정
#   ./run.sh --no-build   빌드 건너뛰고 서버만 실행 (프론트 안 바뀌었을 때)

set -euo pipefail

# 스크립트가 있는 폴더(=프로젝트 루트)로 이동
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PORT="${PORT:-8123}"
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    ''|*[!0-9]*) ;;        # 숫자가 아니면 무시
    *) PORT="$arg" ;;      # 숫자면 포트로 사용
  esac
done

# Node 확인
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js가 필요해. https://nodejs.org 에서 설치한 뒤 다시 실행해줘."
  exit 1
fi

# 의존성 설치 (없을 때만)
if [ ! -d server/node_modules ]; then
  echo "📦 서버 의존성 설치 중..."
  npm --prefix server install
fi
if [ ! -d client/node_modules ]; then
  echo "📦 클라이언트 의존성 설치 중..."
  npm --prefix client install
fi

# 클라이언트 빌드
if [ "$BUILD" = "1" ]; then
  echo "🔨 클라이언트 빌드 중..."
  npm --prefix client run build
fi

# LAN IP 탐지 (macOS / Linux)
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null \
  || ipconfig getifaddr en1 2>/dev/null \
  || { hostname -I 2>/dev/null | awk '{print $1}'; } \
  || echo '')"

echo ""
echo "  🀄  루미큐브 서버 시작 (포트 $PORT)"
echo "      로컬:  http://localhost:$PORT"
if [ -n "$LAN_IP" ]; then
  echo "      LAN:   http://$LAN_IP:$PORT   (같은 WiFi 친구에게 이 주소 공유)"
fi
echo "      종료:  Ctrl + C"
echo ""

# 서버 실행 (이 프로세스로 교체)
PORT="$PORT" exec node server/src/index.js
