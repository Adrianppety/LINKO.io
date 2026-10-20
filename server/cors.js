const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'https://linkoio-bice.vercel.app',
  'https://linkoio-git-main-adrian-pety.vercel.app'
];

function getAllowedOrigins(configuredOrigins = '') {
  const extras = configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...extras])];
}

module.exports = { DEFAULT_ALLOWED_ORIGINS, getAllowedOrigins };
