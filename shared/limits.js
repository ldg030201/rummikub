// 서버·클라가 함께 쓰는 상한값. 한쪽만 고치면 조용히 어긋나므로 여기 한 곳에만 둔다
// (클라가 5초로 막는데 서버가 3초면 사용자는 이유 없이 거부당하고, 반대면 서버가 거부한다).

export const NUDGE_COOLDOWN_MS = 5000; // 재촉 쿨타임
export const CHAT_MAX_LEN = 200; // 채팅 한 줄 최대 길이
export const CHAT_HISTORY = 200; // 방이 보관하는 최근 채팅 수
