# Linko client

The web interface lives in `client/index.html` and can be opened directly or served by Vite. Socket.IO's browser client is loaded from its CDN; when opened as a local file, signaling and reports default to `http://localhost:3000`.

```powershell
npm install
npm run dev
npm run build
```

Static images used by Vite belong in `client/public/`. Start the signaling/report API from `server/` with `npm start`; report data is stored in `server/data/linko.sqlite`. Run `npm test` there for the API/store tests. The Electron host loads the same page through `host/src/main.js`.

Settings and local profile images are stored in the current browser/device because the project has no authentication. Account/session actions remain unavailable; notification types without server events are disabled.
