import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Basispfad der Oberfläche. Standard ist "/" – wird Core-Hub hinter einem
// Reverse-Proxy unter einem UNTERPFAD ausgeliefert (z. B. https://host/corehub/),
// muss der Pfad hier bekannt sein, sonst fordert der Browser die Asset-Dateien
// unter /assets/… an, landet außerhalb des Präfix und die Seite bleibt weiß.
// Setzen über die Umgebungsvariable, z. B.:  VITE_BASE=/corehub/ npm run build
const BASE = process.env.VITE_BASE || '/';

export default defineConfig({
  base: BASE,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4200',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Große Bibliotheken in eigene Chunks aufteilen → kleinere Dateien,
        // bessere Browser-Zwischenspeicherung, keine Größen-Warnung mehr.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('xterm')) return 'xterm';
            if (id.includes('lucide-react')) return 'icons';
            if (id.includes('qrcode')) return 'qr';
            if (id.includes('react')) return 'react';
            return 'vendor';
          }
        },
      },
    },
  },
});
