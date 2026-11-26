import { type Extension, GenerationTask, hook } from "@earendil-works/pi-durable";
import { isDegenerateGatewayResponse } from "../../shared/newApi.js";

/** Use Durable's bounded, persisted retry path without moving the conversation's context head. */
export function gatewayResponseRecovery(): Extension {
  return {
    name: "pidesk-newapi-recovery",
    hooks: [
      hook(GenerationTask, {
        afterResponse(message) {
          if (message.provider !== "pidesk-openai" || !isDegenerateGatewayResponse(message)) return;
          message.stopReason = "error";
          message.errorMessage =
            "New API gateway server error: empty length response; history preserved.";
        },
      }),
    ],
  };
}
