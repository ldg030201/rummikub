// 스토리지 안전 래퍼 — 프라이빗 모드 등 접근이 막힌 환경에서도 예외 없이 동작.
// 세션 격리(ss)는 재접속 토큰·탭 식별용, 로컬(ls)은 손패 배치처럼 오래 남길 것용.

function safe(fn, fallback = undefined) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// sessionStorage: 탭 단위 격리 (localStorage는 탭끼리 공유돼 세션이 꼬임)
export const ss = {
  get: (k) => safe(() => sessionStorage.getItem(k), null),
  set: (k, v) => safe(() => sessionStorage.setItem(k, v)),
  del: (k) => safe(() => sessionStorage.removeItem(k)),
};

// localStorage: 브라우저에 오래 남는 값 (손패 배치 등)
export const ls = {
  get: (k) => safe(() => localStorage.getItem(k), null),
  set: (k, v) => safe(() => localStorage.setItem(k, v)),
  del: (k) => safe(() => localStorage.removeItem(k)),
};

// 재접속 토큰의 '내구' 사본 키. sessionStorage는 탭을 닫으면 사라져서, 다시 들어올 때
// 토큰이 없어 이름 폴백에 의존하게 된다(= 방 코드와 이름만 알면 좌석을 뺏을 수 있는 경로).
// 방+이름으로 키를 나눠 두면 같은 브라우저의 두 탭이 서로 다른 이름으로 앉아도 안 꼬인다.
export const tokenKey = (roomId, name) => `rk_tok_${roomId}_${name}`;
