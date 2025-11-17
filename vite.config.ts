import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 配信パスをデフォルトでリポジトリ名に合わせる
const base = process.env.BASE_PATH ?? '/volume_change/';

// https://vitejs.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
});
