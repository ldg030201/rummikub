# CLAUDE.md — 루미큐브 프로젝트 가이드

React + Vite 프론트엔드와 Node.js(`ws`) 실시간 서버로 만든 **온라인 실시간 멀티플레이 루미큐브**.
로컬 서버 하나를 켜서 링크를 공유하면 같은 방에서 함께 플레이한다.

## 커밋 규칙 (중요)

- **깃모지 + 한글, 1줄 요약**으로 간단하게. 예: `🐛 leave 데드락 수정`, `✨ 조커 회수 추가`.
- **로직 단위로 커밋** (버그 1건 / 기능 1개). 매 파일 저장마다가 아님.
- **`Co-Authored-By: Claude ...` 같은 트레일러/공동작성자 표기를 절대 넣지 않는다.** 커밋 메시지는 요약 1줄만.
- **push는 자동으로 하지 않는다.** 사용자가 "푸시해"라고 할 때만 `origin/main`으로 올린다.
- 원격: `https://github.com/ldg030201/rummikub.git` (origin), 기본 브랜치 `main`.

## 실행

```bash
npm run install:all      # server + client 의존성 설치 (최초 1회)
./run.sh                 # 클라이언트 빌드 + 서버 실행 (기본 8123) — 공유용
./run.sh 8091            # 포트 지정
npm run dev:server       # 개발용 서버(8123)
npm run dev:client       # 개발용 Vite(5173, HMR)
npm test                 # 서버 테스트 (node --test)
```

- **공유 모드**: `./run.sh` 또는 `npm run share` → Node 서버가 빌드된 프론트와 실시간을 **한 포트**에서 서빙. LAN은 `http://<내IP>:8123`, 외부는 `ngrok http 8123`.
- **개발 모드**: 서버(8123) + Vite(5173) 따로. 5173에서 접속하면 프론트가 8123 웹소켓에 자동 연결.
- 서버는 IntelliJ에서 `server/src/index.js`를 Node로 실행해도 됨.

## 구조

```
rummikub/
├─ server/src/
│  ├─ index.js   # HTTP(정적 서빙) + WebSocket(/ws), 방 수명주기·재접속·크래시 방어
│  ├─ game.js    # Room 클래스: 게임 상태·턴 진행·직렬화(내 손패만 공개)
│  ├─ rules.js   # 룰 검증: 세트/런/조커·첫 등록 30점·커밋 검증(권위 타일 재구성)
│  ├─ tiles.js   # 타일 생성/셔플 (1세트=106, 5인↑=2세트=212)
│  └─ *.test.js  # node --test
└─ client/src/
   ├─ App.jsx        # 화면 라우팅 (JoinForm / WaitingRoom / Game)
   ├─ net.js         # useRummikub 훅: WS 연결·재접속 토큰·지수 백오프 (sessionStorage)
   ├─ rules.js       # 실시간 UI 피드백용 룰 미러 (서버 rules.js와 동일해야 함)
   └─ components/     # JoinForm / WaitingRoom / Game(DnD) / Tile / Toast
```

## 아키텍처 핵심

- **서버가 권위(authoritative)**: 클라는 조작을 제안하고, 서버가 룰 검증 후 모두에게 브로드캐스트. 클라가 보낸 타일의 `color/num/joker` 값은 **신뢰하지 않고** 서버가 tile `id`로 원본을 재구성해 검증한다(치팅 방지).
- **실시간 draft**: 내 턴엔 로컬에서 타일을 옮기고(draft), 옮길 때마다 관전자에게 실시간 전송. **제출(commit)** 시 서버가 최종 검증. 형식이 깨진 board는 서버가 걸러 크래시/그리핑을 막는다.
- **재접속**: 최초 join 시 서버가 비밀 `reconnectToken` 발급 → 클라가 sessionStorage에 저장 → 새로고침/재연결 시 토큰으로 좌석 복귀. 토큰이 없으면(탭 닫고 재입장) **이름+방코드 일치 시 끊긴 좌석에 한해 복귀** 폴백. 미제출 draft와 턴은 **유예 타이머(45s)** 로 보존돼 새로고침해도 안 뺏긴다.
- **방 정리**: 로비면 즉시, 진행/종료 중 빈 방은 5분 재접속 유예 후 GC.
- **WS 메시지**: `join`(roomId,name,token) / `start` / `draw` / `draft`(board) / `commit`(board) / `chat`(text) / `newGame` / `leave`. 서버→클라: `joined`(playerId,token) / `state`(개인화) / `error` / `commitRejected` / `chat` / `chatHistory`(입장 시 최근 200개).
- **손패(rack)는 2줄 슬롯 그리드**: 배치는 클라 로컬(`rackPos`, localStorage `rk_rack_<방>_<이름>`)이라 턴/새로고침과 무관하게 유지되고 **남의 턴에도 정렬 가능**. 서버는 손패를 배열로만 앎(배치는 표현 계층). 블럭 정렬(777 숫자/789 색깔, 블럭 사이 한 칸), 모으기, Shift+드래그 블럭 이동, 붙어있는 3+장이 유효 조합이면 초록 하이라이트. draft 보드에 올린 손패 타일은 슬롯을 예약한 채 숨김 처리(회수 시 제자리 복귀).
- **채팅**: 방 단위, 오른쪽 패널. 서버가 최근 200개 보관(`Room.addChat` — 트림·200자 캡) 후 입장 시 `chatHistory`로 재전송. 게임 시작/승리는 시스템 메시지.

## 룰 요약

- 각자 14장 시작, 손패를 먼저 다 내려놓으면 승리.
- **세트**: 같은 숫자·다른 색 3~4개 / **런**: 같은 색·연속 숫자 3+ (13→1 wrap 없음).
- **첫 등록(브레이크인)**: 내 손패만으로 합 30점 이상. 조커는 대체 숫자로 계산(그룹/런 동시 유효 시 큰 값).
- 브레이크인 후엔 테이블 자유 재배열(턴 종료 시 모든 조합 유효해야 함). 낼 게 없으면 1장 뽑고 턴 종료.
- 2~4인은 1세트(106), 5~6인은 자동 2세트(212).

## 작업 시 주의

- `server/src/rules.js`와 `client/src/rules.js`의 룰 로직은 **항상 동일하게** 유지 (미러).
- 룰/게임 로직을 바꾸면 `server/src/*.test.js`를 갱신하고 `npm test` 통과 확인.
- `client/dist`는 gitignore. 프론트를 바꿨으면 `npm run build`(또는 `run.sh`)로 다시 빌드해야 서버 서빙에 반영됨.
