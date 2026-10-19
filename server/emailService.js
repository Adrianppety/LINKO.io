'use strict';

const nodemailer = require('nodemailer');

function createEmailService(env = process.env) {
  const host = env.SMTP_HOST?.trim();
  const from = env.SMTP_FROM?.trim();
  const port = Number(env.SMTP_PORT || 587);
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS;
  if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !pass) return null;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: String(env.SMTP_SECURE || port === 465).toLowerCase() === 'true',
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
  const baseUrl = (env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  return {
    async sendVerification(email, code) {
      await transporter.sendMail({
        from,
        to: email,
        subject: 'Confirme sua conta Linko',
        text: `Seu código Linko é ${code}. Ele expira em 15 minutos. Se você não solicitou este cadastro, ignore esta mensagem.`
      });
    },
    async sendPasswordReset(email, token) {
      const link = `${baseUrl}/?reset=${encodeURIComponent(token)}`;
      await transporter.sendMail({
        from,
        to: email,
        subject: 'Redefinição de senha Linko',
        text: `Use este link para redefinir sua senha em até 30 minutos: ${link}\nSe você não solicitou a redefinição, ignore esta mensagem.`
      });
    }
  };
}

module.exports = { createEmailService };
