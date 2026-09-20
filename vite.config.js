import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { VitePWA } from 'vite-plugin-pwa'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('.', import.meta.url))

// ONNX Runtime Web (lo usa la IA local del navegador) se sirve desde la propia app:
// por defecto transformers.js lo descarga de una CDN y sin internet no cargaría.
const ARCHIVOS_ORT = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']
const copiarOnnxRuntime = () => ({
  name: 'copiar-onnxruntime',
  buildStart() {
    const destino = `${raiz}public/ort`
    mkdirSync(destino, { recursive: true })
    for (const archivo of ARCHIVOS_ORT) {
      const de = `${raiz}node_modules/onnxruntime-web/dist/${archivo}`
      const a = `${destino}/${archivo}`
      if (!existsSync(a) || statSync(a).size !== statSync(de).size) copyFileSync(de, a)
    }
  },
})

export default defineConfig({
  plugins: [
    copiarOnnxRuntime(),
    react(),
    // Aplicación instalable que abre sin internet: el service worker guarda la app
    // (HTML, JS, CSS y el runtime de la IA local). Los modelos los guarda transformers.js.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['icono.svg', 'icono-192.png', 'icono-512.png', 'icono-maskable-512.png'],
      manifest: {
        name: 'Diagramador UML',
        short_name: 'Diagramador',
        description: 'Diagramas de clases UML con IA, también sin internet',
        lang: 'es',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#4f46e5',
        id: '/',
        scope: '/',
        // Chrome y Edge solo ofrecen instalar si hay iconos PNG de 192 y 512 px
        icons: [
          { src: '/icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icono-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icono.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,wasm,woff2}'],
        // Vite también emite su propia copia del .wasm de ONNX; se usa la de /ort
        globIgnores: ['**/assets/ort-wasm-*'],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/apis/, /^\/socket\.io/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  worker: {
    format: 'es',
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'flow': ['@xyflow/react']
        }
      }
    }
  },
  optimizeDeps: {
    include: ['@xyflow/react'],
    // transformers.js carga ONNX Runtime y sus .wasm por su cuenta
    exclude: ['@huggingface/transformers'],
  },
  server: {
    port: 5173,  // el puerto donde corre el frontend
    host: true,
    proxy: {
      // cualquier llamada que empiece con /apis se redirige al backend
      '/apis': {
        target: 'http://localhost:8083', // puerto del backend
        changeOrigin: true,
        secure: false,
      }
    }
  }
})
