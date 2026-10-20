# Linko

Salas temporárias de voz, vídeo, compartilhamento de tela e YouTube, com temas claro, escuro e gamer. Não há contas, perfis ou mensagens. O apelido só é usado durante a conexão; a preferência visual fica neste navegador.

## Desenvolvimento

```powershell
npm install
npm install --prefix client
npm install --prefix server
npm run dev
```

O cliente Vite abre em `http://localhost:5173`; o servidor Socket.IO usa `http://localhost:3000`. Para testar mídia, use um navegador com permissões de câmera/microfone e uma origem segura (HTTPS ou localhost). O site pede cada permissão apenas quando o respectivo recurso é ativado.

Testes do servidor e build do cliente:

```powershell
npm test --prefix server
npm run build
npm run lint --prefix client
```

## Deploy

- Publique o diretório `client/` na Vercel. Configure `VITE_API_URL` com a origem HTTPS do servidor de sinalização.
- Publique `server/` como um serviço Node que mantenha WebSockets ativos (por exemplo, Render). Configure `ALLOWED_ORIGINS` com a origem exata do site.
- O serviço de sinalização usa estado temporário em memória. Mantenha uma instância; reinícios encerram as salas e múltiplas instâncias exigiriam um adaptador compartilhado.
- Para atravessar redes que bloqueiam conexões P2P, configure um servidor TURN compatível com credenciais REST do coturn: `TURN_URLS` e `TURN_SHARED_SECRET` somente no backend. Sem TURN, STUN é usado como alternativa e algumas redes podem impedir a chamada.

O WebRTC é P2P em malha para até 10 participantes, sem SFU. É simples de operar e não requer credenciais de provedor, mas o envio de vídeo cresce com o número de participantes. Para uso frequente de salas cheias ou qualidade consistente em redes móveis, será necessário hospedar um SFU (por exemplo, LiveKit ou mediasoup) e trocar a malha por publicação/assinatura centralizadas. O navegador ajusta a mídia conforme a conexão; compartilhamento de tela prioriza legibilidade.

Os links usam identificadores aleatórios de alta entropia, mas são convites: qualquer pessoa com o link pode entrar enquanto a sala existir. Salas vazias expiram após cinco minutos.
