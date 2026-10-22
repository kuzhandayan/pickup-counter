import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, API calls go to the backend on :3000. In Docker, the backend serves this screen itself.
const api = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/products': api, '/orders': api },
  },
});
