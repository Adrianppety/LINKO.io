https://linkoio-bice.vercel.app# LINKO.io

## Implantação

O cliente web é implantado na Vercel e a API/servidor de sinalização Express roda separadamente no Render. A compilação da Vercel não implanta `server/`.

### Backend no Render

Crie um Web Service no Render com o diretório raiz definido como `server/`, runtime Node.js e comando de início `npm start`. O Render fornece `PORT`, que o servidor já utiliza.

Anexe um disco persistente ao serviço Render e monte-o em `/var/data`. Configure:

```text
LINKO_DATABASE_PATH=/var/data/linko.sqlite
LINKO_FILES_PATH=/var/data/files
APP_BASE_URL=https://<seu-dominio-vercel>
ALLOWED_ORIGINS=https://<seu-dominio-vercel>
NODE_ENV=production
```

O servidor falha na inicialização no Render se essas variáveis estiverem ausentes ou se os caminhos do banco/arquivos não forem absolutos, em vez de iniciar silenciosamente usando o armazenamento efêmero do código.

O cadastro cria a conta e inicia a sessão imediatamente, sem enviar código de confirmação. Adicione as configurações SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM`) no Render para habilitar a recuperação de senha. Como o e-mail não é verificado, use um endereço válido e acessível. Mantenha o serviço Render em uma instância ao usar um único disco persistente e salas Socket.IO em memória; escalar para várias instâncias exige estado compartilhado para sockets e armazenamento.

Sem o disco persistente, o banco SQLite e as imagens de perfil enviadas podem ser perdidos ao reiniciar ou reimplantar. Use a origem exata do site Vercel em `APP_BASE_URL` e `ALLOWED_ORIGINS`. Se os deploys Preview da Vercel devem acessar o mesmo backend, adicione cada origem Preview permitida em `ALLOWED_ORIGINS`.

O banco local `server/data/linko.sqlite` é ignorado pelo Git e não será enviado ao Render. Para preservar os dados locais, será necessário importá-lo separadamente para o disco persistente do serviço; não o adicione ao repositório.

### Frontend na Vercel

Importe o repositório como projeto Vercel usando o diretório raiz. O [`vercel.json`](./vercel.json) na raiz instala e compila apenas `client/` e serve o resultado Vite como SPA.

Configure esta variável de ambiente no projeto Vercel para cada ambiente que deve funcionar:

```text
VITE_API_URL=https://<nome-do-servico>.onrender.com
```

Use somente a origem do backend (sem o sufixo `/api` ou outro caminho). O valor é incorporado à compilação estática e também é usado pelo Socket.IO. A compilação Vercel falha intencionalmente se a variável não estiver configurada ou não usar HTTPS.

Como a autenticação usa cookies, configure preferencialmente domínios próprios sob o mesmo domínio registrável para o frontend e a API (por exemplo, `app.exemplo.com` e `api.exemplo.com`). Os domínios padrão `vercel.app` e `onrender.com` são sites distintos e alguns navegadores podem bloquear cookies de terceiros mesmo com `SameSite=None`.

### Desenvolvimento local

Execute `npm run dev` na raiz do repositório. Por padrão, o cliente usa `http://localhost:3000` para a API e o servidor de sinalização; defina `VITE_API_URL` apenas ao usar outro backend.
