import { getConfig } from "./config.js";

export async function sendEmail(env, subject, html, text) {
  const cfg = await getConfig(env.DB);
  const { from, recipient } = cfg.notifications;
  if (!env.EMAIL || !recipient || !from) return false;
  try {
    await env.EMAIL.send({
      to: recipient,
      from: { email: from, name: "Market Intel" },
      subject,
      html,
      text,
    });
    return true;
  } catch {
    return false;
  }
}
