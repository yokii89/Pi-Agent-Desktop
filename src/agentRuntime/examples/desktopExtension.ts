import type { DurableExtensionFactory } from "../../shared/durableExtension.js";

/** Minimal compiled ESM example; add its package to the existing extension package list. */
const createExtension: DurableExtensionFactory = (host) => ({
  agent: {
    name: host.id,
    tools: [
      {
        name: `${host.id}__workspace`,
        description: "Return the current desktop session's working directory.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => ({ output: [{ type: "text", text: host.cwd }] }),
      },
    ],
  },
  commands: [
    {
      name: `${host.id}:review`,
      description: "Review the requested changes in this workspace.",
      expand: (args) =>
        `Review the following work in ${host.cwd}:\n${args || "the current changes"}`,
    },
  ],
});

export default createExtension;
