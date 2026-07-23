// 테스트 공용 팩토리 (node --test는 *.test.js만 실행하므로 이 파일은 테스트로 안 잡힘)
export const T = (id, color, num) => ({ id, color, num, joker: false });
export const J = (id) => ({ id, color: null, num: null, joker: true });
export const sock = () => ({ readyState: 1, OPEN: 1, send() {} });
