const DEFAULT_GRAPH_VERSION = "v23.0";

export type WhatsAppConfig = {
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
  appSecret: string;
  verifyToken: string;
};

export function whatsappConfig(): WhatsAppConfig {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!accessToken || !phoneNumberId || !appSecret || !verifyToken) {
    throw new Error(
      "WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_APP_SECRET / WHATSAPP_VERIFY_TOKEN must be set"
    );
  }
  return {
    accessToken,
    phoneNumberId,
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION || DEFAULT_GRAPH_VERSION,
    appSecret,
    verifyToken
  };
}

export function graphUrl(path: string, version?: string): string {
  const v = version || process.env.WHATSAPP_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
  return `https://graph.facebook.com/${v}/${path.replace(/^\//, "")}`;
}
