# Linko Web

Frontend Vite para salas compartilhadas. A origem do backend é definida por `VITE_API_URL`; durante `npm run dev`, o padrão é `http://localhost:3000`. Em produção, configure a variável com a origem HTTPS do servidor Socket.IO.

```powershell
npm install
npm run dev
npm run build
npm run lint
```

Câmera, microfone e tela são solicitados somente ao ativar cada controle. Para áudio/vídeo entre redes diferentes, configure STUN/TURN no backend conforme o README da raiz.
