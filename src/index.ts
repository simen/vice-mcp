#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "vice-mcp",
  version: "0.1.0",
});

// Connection state (will be managed by protocol layer)
let connected = false;

// Tool: status - Get current connection and emulation state
server.registerTool(
  "status",
  {
    description: "Get current connection and emulation state",
  },
  async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              connected,
              running: false,
              hint: connected
                ? "Connected to VICE"
                : "Not connected. Use connect() to establish connection to VICE.",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool: connect - Connect to a running VICE instance
server.registerTool(
  "connect",
  {
    description: "Connect to a running VICE instance with binary monitor enabled",
    inputSchema: z.object({
      host: z.string().optional().describe("VICE host address (default: 127.0.0.1)"),
      port: z.number().optional().describe("VICE binary monitor port (default: 6502)"),
    }),
  },
  async (args) => {
    const host = args.host || "127.0.0.1";
    const port = args.port || 6502;

    // Placeholder - actual connection logic will be in protocol layer
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              connected: false,
              error: true,
              code: "NOT_IMPLEMENTED",
              message: `Connection to ${host}:${port} not yet implemented`,
              suggestion:
                "Protocol layer is under development. Check back soon!",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool: disconnect - Disconnect from VICE
server.registerTool(
  "disconnect",
  {
    description: "Disconnect from the VICE instance",
  },
  async () => {
    if (!connected) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: true,
                code: "NOT_CONNECTED",
                message: "Not connected to VICE",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    connected = false;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              disconnected: true,
              message: "Disconnected from VICE",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VICE MCP server started");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
