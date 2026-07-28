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
├─ shared/          # 서버·클라 공용 (단일 원본, 양쪽에서 직접 import)
│  ├─ rules.js    # 룰 검증: 세트/런/조커·첫 등록 30점·커밋 검증(권위 타일 재구성)
│  ├─ tiles.js    # 타일 생성/셔플 (1세트=106, 5인↑=2세트=212)
│  └─ rules.test.js
├─ server/src/
│  ├─ index.js   # HTTP(정적 서빙) + WebSocket(/ws), 방 수명주기·재접속·크래시 방어
│  ├─ game.js    # Room 클래스: 게임 상태·턴 진행·직렬화(내 손패만 공개)
│  └─ *.test.js  # node --test
└─ client/src/
   ├─ App.jsx        # 화면 라우팅 (JoinForm / WaitingRoom / Game)
   ├─ net.js         # useRummikub 훅: WS 연결·재접속 토큰·지수 백오프 (sessionStorage)
   └─ components/     # JoinForm / WaitingRoom / Game(DnD) / Tile / Toast
```

## 아키텍처 핵심

- **서버가 권위(authoritative)**: 클라는 조작을 제안하고, 서버가 룰 검증 후 모두에게 브로드캐스트. 클라가 보낸 타일의 `color/num/joker` 값은 **신뢰하지 않고** 서버가 tile `id`로 원본을 재구성해 검증한다(치팅 방지).
- **실시간 draft**: 내 턴엔 로컬에서 타일을 옮기고(draft), 옮길 때마다 관전자에게 실시간 전송. **제출(commit)** 시 서버가 최종 검증. 형식이 깨진 board는 서버가 걸러 크래시/그리핑을 막는다.
- **재접속**: 최초 join 시 서버가 비밀 `reconnectToken` 발급 → 클라가 sessionStorage에 저장 → 새로고침/재연결 시 토큰으로 좌석 복귀. 토큰이 없으면(탭 닫고 재입장) **이름+방코드 일치 시 끊긴 좌석에 한해 복귀** 폴백. 미제출 draft와 턴은 **유예 타이머(45s)** 로 보존돼 새로고침해도 안 뺏긴다.
- **관전자**(`Room.spectators`, 최대 10명): 진행 중이거나 정원이 찬 방에 들어오면 좌석 대신 관전자가 된다. 보드·좌석·채팅은 보이고 손패는 없음(`state.spectator: true`, `myHand: []`). 서버는 `PLAYER_ONLY` 화이트리스트로 `start/draw/draft/commit/settings/nudge/newGame`을 차단하고 채팅만 허용. 새 게임으로 로비에 돌아올 때 `Room.seatSpectators()`가 빈 좌석으로 승격시키는데, **id와 reconnectToken을 그대로 물려받아** 재접속이 안 깨진다. 관전자는 끊기면 좌석과 달리 즉시 제거.
- **방 정리**: 로비면 즉시, 진행/종료 중 빈 방은 5분 재접속 유예 후 GC. `isEmpty()`는 좌석 기준이라 관전자만 남은 방은 GC 대상이다.
- **WS 메시지**: `join`(roomId,name,token) / `start` / `draw` / `draft`(board) / `commit`(board) / `chat`(text) / `nudge` / `settings`(방장·로비 한정) / `newGame` / `leave`. 서버→클라: `joined`(playerId,token) / `state`(개인화 — `spectator` 플래그·`spectators` 목록 포함) / `error` / `commitRejected` / `chat` / `chatHistory`(입장 시 최근 200개) / `nudged`(재촉받은 턴 플레이어에게만).
- **방 설정**(`Room.settings`, 대기실에서 방장만 변경): 턴 시간(30초~3분·무제한, 기본 90초 `TURN_TIME_MS`), 최대 인원(2~6, join 시 정원 검사), 타일 세트(자동/1/2세트 — 5인↑는 항상 2세트 강제). 서버는 화이트리스트(`TURN_TIME_OPTIONS`/`SET_COUNT_OPTIONS`)로 검증.
- **턴 제한시간**: 서버가 `turnDeadline`(+`serverNow`)을 state로 내려 클라가 시계 오차 보정 후 카운트다운(무제한이면 null·표시 없음). 만료 시 서버가 draft 폐기·자동 한 장 뽑기·턴 넘김(`Room.timeoutTurn`). 타이머는 deadline 기반이라 draft 갱신엔 리셋 안 되고, 빈 방에선 멈췄다 재접속 시 이어감.
- **타일 이동 애니메이션(FLIP)**: `Game.jsx`가 렌더마다 타일 위치를 앵커 상대좌표로 기억해 이동 시 이전→새 위치로 비행(body 위 fixed 클론 — overflow 클리핑 회피). 새 타일은 출처 추정(손패=뽑기 더미, 보드=현재 턴 좌석). 상대가 뽑으면(handCount 증가 감지) 더미→그 좌석으로 타일 뒷면 비행. 테이블 오른쪽 아래 **뽑기 더미**는 내 턴에 클릭하면 `draw`.
- **재촉하기**: 턴이 아닌 플레이어가 채팅 패널의 버튼으로 재촉 → 시스템 챗 + 턴 플레이어 화면 테두리 펄스(`nudge-flash`). 쿨타임 5초는 서버(좌석별 `_nudgeTs`)·클라 양쪽에서 검증.
- **손패(rack)는 슬롯 그리드**: 열 수는 화면 폭에 맞춰 자동(ResizeObserver), 넘치면 아랫줄로 이어짐(가로 스크롤 없음, 3줄 초과 시 세로 스크롤). 그리드는 행 우선 1차원 인덱스로 다뤄 밀림이 줄 끝에서 다음 줄로 넘어간다. 배치는 클라 로컬(`rackPos`, localStorage `rk_rack_<방>_<이름>`)이라 턴/새로고침과 무관하게 유지되고 **남의 턴에도 정렬 가능**. 서버는 손패를 배열로만 앎(배치는 표현 계층). 블럭 정렬(777 숫자/789 색깔, 블럭 사이 한 칸), 모으기, Shift+드래그 블럭 이동(드래그 이미지도 블럭 전체), 붙어있는 3+장이 유효 조합이면 초록 하이라이트. draft 보드에 올린 손패 타일은 슬롯을 예약한 채 숨김 처리(회수 시 제자리 복귀).
- **채팅**: 방 단위, 오른쪽 패널. 서버가 최근 200개 보관(`Room.addChat` — 트림·200자 캡) 후 입장 시 `chatHistory`로 재전송. 게임 시작/승리는 시스템 메시지.

## 룰 요약

- 각자 14장 시작, 손패를 먼저 다 내려놓으면 승리.
- **세트**: 같은 숫자·다른 색 3~4개 / **런**: 같은 색·연속 숫자 3+ (13→1 wrap 없음).
- **첫 등록(브레이크인)**: 내 손패만으로 합 30점 이상. 조커는 대체 숫자로 계산(그룹/런 동시 유효 시 큰 값).
- 브레이크인 후엔 테이블 자유 재배열(턴 종료 시 모든 조합 유효해야 함). 낼 게 없으면 1장 뽑고 턴 종료.
- 2~4인은 1세트(106), 5~6인은 자동 2세트(212). 방 설정으로 1/2세트 강제 가능(단 5인↑는 항상 2세트).

## 작업 시 주의

- 룰 로직은 `shared/rules.js` **한 곳**에만 있다. 서버(`server/src/game.js`)와 클라(`client/src/components/Game.jsx`)가 같은 파일을 import하므로 미러를 따로 맞출 필요 없음. `shared/`는 Node·브라우저 양쪽에서 도는 순수 모듈이라 node 전용 API를 넣으면 안 된다.
- 룰/게임 로직을 바꾸면 `server/src/*.test.js`를 갱신하고 `npm test` 통과 확인.
- `client/dist`는 gitignore. 프론트를 바꿨으면 `npm run build`(또는 `run.sh`)로 다시 빌드해야 서버 서빙에 반영됨.
