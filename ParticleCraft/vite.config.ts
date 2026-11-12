import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { craftApi } from '../Shared/devserver/projectApi';

const here = __dirname;
const app = path.resolve(here, '..');

export default defineConfig({
  plugins: [
    react(),
    craftApi({
      app: 'particlecraft',
      projectsDir: path.join(here, 'projects'),
      exchangeDir: path.join(app, 'Shared', 'exchange'),
    }),
  ],
  resolve: {
    alias: {
      '@shared': path.join(app, 'Shared'),
      // 3D imports (Object nodes, Blender files) use GameCraft's three.js and .blend reader.
      three: path.join(app, 'GameCraft/node_modules/three'),
      '@gamecraft': path.join(app, 'GameCraft/src'),
      react: path.join(here, 'node_modules/react'),
      'react-dom': path.join(here, 'node_modules/react-dom'),
    },
  },
  server: { fs: { allow: [app] }, port: 5175 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as any);
