import { defineConfig } from 'vite'

const backendUrl = process.env.VITE_API_URL?.trim().replace(/\/+$/, '') || ''

if (backendUrl) {
  const url = new URL(backendUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VITE_API_URL deve ser a origem do servidor, sem caminho, query ou fragmento.')
  }
  if (process.env.VERCEL === '1' && url.protocol !== 'https:') {
    throw new Error('VITE_API_URL deve usar HTTPS no deploy da Vercel.')
  }
}

if (process.env.VERCEL === '1' && !backendUrl) {
  throw new Error('Configure VITE_API_URL com a URL HTTPS do backend Render antes de compilar na Vercel.')
}

export default defineConfig({
  define: {
    global: 'globalThis'
  },
  resolve: {
    alias: { events: 'events/' }
  },
  server: {
    host: '0.0.0.0'
  }
})
