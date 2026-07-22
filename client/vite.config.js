import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// host: true → 같은 WiFi(LAN)에서 개발 서버(5173)에도 접속 가능
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
