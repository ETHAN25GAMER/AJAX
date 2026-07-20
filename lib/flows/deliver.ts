import {
  sendWhatsApp,
  sendWhatsAppButtons,
  sendWhatsAppList
} from "@/lib/whatsapp/outbound";
import type { Send } from "./types";

// Engine Send → the right WhatsApp message type. Shared by the webhook and the
// crons that re-present MCQs (nudges, abandoned-booking recovery).
export async function deliverSends(to: string, sends: Send[]): Promise<void> {
  for (const send of sends) {
    if (send.kind === "text") {
      await sendWhatsApp(to, send.body);
    } else if (send.kind === "buttons") {
      await sendWhatsAppButtons(to, send.body, send.buttons);
    } else {
      await sendWhatsAppList(to, send.body, send.buttonLabel, send.rows);
    }
  }
}
