import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// host: true → 같은 WiFi(LAN)에서 개발 서버(5173)에도 접속 가능
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // 룰 단일 원본(../shared/*)을 dev 서버가 읽을 수 있게 허용. '..'로 열면 host:true와
    // 겹쳐서 같은 WiFi의 누구나 /@fs/<경로>로 server/src·run.sh·.claude 등 저장소 전체를
    // 받아갈 수 있다. 필요한 두 곳만 연다(allow를 지정하면 기본 목록이 대체되므로
    // 클라이언트 루트 '.'도 반드시 함께 넣어야 한다).
    fs: { allow: ['.', '../shared'] },
  },
});
