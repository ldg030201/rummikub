import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// host: true → 같은 WiFi(LAN)에서 개발 서버(5173)에도 접속 가능
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // 룰 단일 원본(../shared/rules.js)을 dev 서버가 읽을 수 있게 상위 폴더 허용
    fs: { allow: ['..'] },
  },
});
