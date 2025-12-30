#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getViceClient, ViceError } from "./protocol/index.js";

const server = new McpServer({
  name: "vice-mcp",
  version: "0.1.0",
});

const client = getViceClient();

// Helper to format tool responses with _meta context
function formatResponse(data: object) {
  const state = client.getState();
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ...data,
            _meta: {
              connected: state.connected,
              running: state.running,
              ...(state.connected && { host: state.host, port: state.port }),
            },
          },
          null,
          2
        ),
      },
    ],
  };
}

// Helper to format error responses
function formatError(error: ViceError | Error) {
  const state = client.getState();
  const errorData =
    "code" in error
      ? error
      : {
          error: true,
          code: "UNKNOWN_ERROR",
          message: error.message,
        };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ...errorData,
            _meta: {
              connected: state.connected,
              running: state.running,
            },
          },
          null,
          2
        ),
      },
    ],
  };
}

// Tool: status - Get current connection and emulation state
server.registerTool(
  "status",
  {
    description: `Get current VICE connection and emulation state.

Returns connection status, whether emulation is running or paused, and host/port if connected.

Use this to:
- Check if you're connected before running other commands
- See if emulation is running or stopped (e.g., at a breakpoint)
- Verify connection details

Related tools: connect, disconnect`,
  },
  async () => {
    const state = client.getState();
    return formatResponse({
      connected: state.connected,
      running: state.running,
      ...(state.connected && {
        host: state.host,
        port: state.port,
      }),
      hint: state.connected
        ? state.running
          ? "VICE is running. Use setBreakpoint() + continue() to pause at a specific point, or step() to execute one instruction."
          : "VICE is paused. Use continue() to resume or step() to execute one instruction."
        : "Not connected. Use connect() to establish connection to VICE.",
    });
  }
);

// Tool: connect - Connect to a running VICE instance
server.registerTool(
  "connect",
  {
    description: `Connect to a running VICE emulator instance via the binary monitor protocol.

VICE must be started with the binary monitor enabled:
  x64sc -binarymonitor -binarymonitoraddress ip4://127.0.0.1:6502

Default connection: 127.0.0.1:6502

Use this first before any debugging operations. Connection persists until disconnect() is called or VICE closes.

Related tools: status, disconnect`,
    inputSchema: z.object({
      host: z
        .string()
        .optional()
        .describe("VICE host address (default: 127.0.0.1)"),
      port: z
        .number()
        .min(1)
        .max(65535)
        .optional()
        .describe("VICE binary monitor port (default: 6502)"),
    }),
  },
  async (args) => {
    const host = args.host || "127.0.0.1";
    const port = args.port || 6502;

    try {
      await client.connect(host, port);
      return formatResponse({
        connected: true,
        host,
        port,
        message: `Successfully connected to VICE at ${host}:${port}`,
        hint: "Connection established. You can now use readMemory, getRegisters, and other debugging tools.",
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: disconnect - Disconnect from VICE
server.registerTool(
  "disconnect",
  {
    description: `Disconnect from the VICE emulator instance.

Cleanly closes the connection. Safe to call even if not connected.

Related tools: connect, status`,
  },
  async () => {
    const wasConnected = client.getState().connected;

    try {
      await client.disconnect();
      return formatResponse({
        disconnected: true,
        wasConnected,
        message: wasConnected
          ? "Disconnected from VICE"
          : "Was not connected",
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: readMemory - Read memory from the C64
server.registerTool(
  "readMemory",
  {
    description: `Read memory from the C64's address space.

Returns raw bytes plus hex and ASCII representations.

C64 memory map highlights:
- $0000-$00FF: Zero page (fast access, common variables)
- $0100-$01FF: Stack
- $0400-$07FF: Default screen RAM (1000 bytes)
- $D000-$D3FF: VIC-II registers (graphics)
- $D400-$D7FF: SID registers (sound)
- $D800-$DBFF: Color RAM

For screen content, consider using readScreen instead for interpreted output.
For sprite info, use readSprites for semantic data.

Related tools: writeMemory, readScreen, readSprites, readVicState`,
    inputSchema: z.object({
      address: z
        .number()
        .min(0)
        .max(0xffff)
        .describe("Start address (0x0000-0xFFFF)"),
      length: z
        .number()
        .min(1)
        .max(65536)
        .optional()
        .describe("Number of bytes to read (default: 256, max: 65536)"),
    }),
  },
  async (args) => {
    const address = args.address;
    const length = Math.min(args.length || 256, 65536);
    const endAddress = Math.min(address + length - 1, 0xffff);

    try {
      const data = await client.readMemory(address, endAddress);

      // Format as hex dump
      const hexLines: string[] = [];
      const asciiLines: string[] = [];

      for (let i = 0; i < data.length; i += 16) {
        const chunk = data.subarray(i, Math.min(i + 16, data.length));
        const hex = Array.from(chunk)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ");
        const ascii = Array.from(chunk)
          .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
          .join("");

        hexLines.push(
          `$${(address + i).toString(16).padStart(4, "0")}: ${hex}`
        );
        asciiLines.push(ascii);
      }

      return formatResponse({
        address: {
          value: address,
          hex: `$${address.toString(16).padStart(4, "0")}`,
        },
        length: data.length,
        bytes: Array.from(data),
        hex: hexLines.join("\n"),
        ascii: asciiLines.join(""),
        hint: getMemoryHint(address, endAddress),
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Helper to provide context about memory regions
function getMemoryHint(start: number, end: number): string {
  if (start <= 0xff) return "Zero page - commonly used for variables and pointers";
  if (start >= 0x100 && start <= 0x1ff) return "Stack area";
  if (start >= 0x400 && end <= 0x7ff) return "Default screen RAM area";
  if (start >= 0xd000 && end <= 0xd3ff) return "VIC-II registers - use readVicState for interpreted data";
  if (start >= 0xd400 && end <= 0xd7ff) return "SID registers - use readSidState for interpreted data";
  if (start >= 0xd800 && end <= 0xdbff) return "Color RAM";
  if (start >= 0xa000 && end <= 0xbfff) return "BASIC ROM (or RAM if bank switched)";
  if (start >= 0xe000 && end <= 0xffff) return "KERNAL ROM (or RAM if bank switched)";
  return "";
}

// Tool: writeMemory - Write memory to the C64
server.registerTool(
  "writeMemory",
  {
    description: `Write bytes to the C64's memory.

Directly modifies memory at the specified address. Changes take effect immediately.

Common uses:
- Poke values for testing
- Patch code at runtime
- Modify screen/color RAM directly
- Change VIC/SID registers

Be careful writing to ROM areas ($A000-$BFFF, $E000-$FFFF) - you may need to bank out ROM first.

Related tools: readMemory, fillMemory`,
    inputSchema: z.object({
      address: z
        .number()
        .min(0)
        .max(0xffff)
        .describe("Start address (0x0000-0xFFFF)"),
      bytes: z
        .array(z.number().min(0).max(255))
        .min(1)
        .describe("Array of bytes to write (0-255 each)"),
    }),
  },
  async (args) => {
    try {
      await client.writeMemory(args.address, args.bytes);

      return formatResponse({
        success: true,
        address: {
          value: args.address,
          hex: `$${args.address.toString(16).padStart(4, "0")}`,
        },
        bytesWritten: args.bytes.length,
        message: `Wrote ${args.bytes.length} byte(s) to $${args.address.toString(16).padStart(4, "0")}`,
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: getRegisters - Get CPU registers
server.registerTool(
  "getRegisters",
  {
    description: `Get current 6502/6510 CPU register state.

Returns all CPU registers with interpreted flags.

Registers:
- A: Accumulator (arithmetic operations)
- X, Y: Index registers (addressing, loops)
- SP: Stack pointer ($100-$1FF range)
- PC: Program counter (current instruction address)
- Flags: N(egative), V(overflow), B(reak), D(ecimal), I(nterrupt), Z(ero), C(arry)

Use this to:
- Check CPU state at breakpoints
- Understand program flow
- Debug crashes (check PC, SP)

Related tools: setRegister, step, continue, status`,
  },
  async () => {
    try {
      const response = await client.getRegisters();

      // Parse register response
      // Format: count(2) + [id(1) + size(1) + value(size)]...
      const count = response.body.readUInt16LE(0);
      const registers: Record<string, number> = {};
      let offset = 2;

      const regNames: Record<number, string> = {
        0: "A",
        1: "X",
        2: "Y",
        3: "PC",
        4: "SP",
        5: "FL", // Flags
      };

      for (let i = 0; i < count && offset < response.body.length; i++) {
        const id = response.body[offset];
        const size = response.body[offset + 1];
        offset += 2;

        let value = 0;
        if (size === 1) {
          value = response.body[offset];
        } else if (size === 2) {
          value = response.body.readUInt16LE(offset);
        }
        offset += size;

        const name = regNames[id] || `R${id}`;
        registers[name] = value;
      }

      // Parse flags
      const flags = registers.FL || 0;
      const flagsDecoded = {
        negative: !!(flags & 0x80),
        overflow: !!(flags & 0x40),
        break: !!(flags & 0x10),
        decimal: !!(flags & 0x08),
        interrupt: !!(flags & 0x04),
        zero: !!(flags & 0x02),
        carry: !!(flags & 0x01),
        raw: flags,
        // Compact string representation: NV-BDIZC (uppercase = set)
        string: [
          flags & 0x80 ? "N" : "n",
          flags & 0x40 ? "V" : "v",
          "-",
          flags & 0x10 ? "B" : "b",
          flags & 0x08 ? "D" : "d",
          flags & 0x04 ? "I" : "i",
          flags & 0x02 ? "Z" : "z",
          flags & 0x01 ? "C" : "c",
        ].join(""),
      };

      return formatResponse({
        a: { value: registers.A, hex: `$${(registers.A || 0).toString(16).padStart(2, "0")}` },
        x: { value: registers.X, hex: `$${(registers.X || 0).toString(16).padStart(2, "0")}` },
        y: { value: registers.Y, hex: `$${(registers.Y || 0).toString(16).padStart(2, "0")}` },
        sp: {
          value: registers.SP,
          hex: `$${(registers.SP || 0).toString(16).padStart(2, "0")}`,
          stackTop: `$01${(registers.SP || 0).toString(16).padStart(2, "0")}`,
        },
        pc: {
          value: registers.PC,
          hex: `$${(registers.PC || 0).toString(16).padStart(4, "0")}`,
        },
        flags: flagsDecoded,
        hint:
          registers.SP !== undefined && registers.SP < 0x10
            ? "Warning: Stack pointer very low - possible stack overflow"
            : registers.SP !== undefined && registers.SP > 0xf0
            ? "Warning: Stack nearly empty - possible stack underflow"
            : "CPU state looks normal",
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: continue - Resume execution
server.registerTool(
  "continue",
  {
    description: `Resume C64 execution after a breakpoint or pause.

Starts the emulator running until the next breakpoint, manual stop, or error.

Related tools: step, status, setBreakpoint`,
  },
  async () => {
    try {
      await client.continue();
      return formatResponse({
        resumed: true,
        message: "Execution resumed",
        hint: "Use status() to check if execution stopped (e.g., at breakpoint)",
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: step - Single-step execution
server.registerTool(
  "step",
  {
    description: `Execute one or more instructions, then stop.

Single-stepping is essential for understanding code flow and debugging.

Options:
- count: Number of instructions to execute (default: 1)
- stepOver: If true, treat JSR as single instruction (don't step into subroutines)

After stepping, use getRegisters to see the new CPU state.

Related tools: getRegisters, continue, setBreakpoint, status`,
    inputSchema: z.object({
      count: z.number().min(1).optional().describe("Number of instructions to step (default: 1)"),
      stepOver: z.boolean().optional().describe("Step over JSR calls instead of into them (default: false)"),
    }),
  },
  async (args) => {
    try {
      await client.step(args.count || 1, args.stepOver || false);

      // Get registers after step
      const regResponse = await client.getRegisters();
      const count = regResponse.body.readUInt16LE(0);
      let offset = 2;
      let pc = 0;

      for (let i = 0; i < count && offset < regResponse.body.length; i++) {
        const id = regResponse.body[offset];
        const size = regResponse.body[offset + 1];
        offset += 2;
        if (id === 3 && size === 2) {
          // PC
          pc = regResponse.body.readUInt16LE(offset);
        }
        offset += size;
      }

      return formatResponse({
        stepped: true,
        count: args.count || 1,
        stepOver: args.stepOver || false,
        pc: {
          value: pc,
          hex: `$${pc.toString(16).padStart(4, "0")}`,
        },
        message: `Stepped ${args.count || 1} instruction(s)`,
        hint: "Use getRegisters() for full CPU state, or readMemory at PC for next instruction",
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: reset - Reset the C64
server.registerTool(
  "reset",
  {
    description: `Reset the C64 machine.

Options:
- hard: If true, performs hard reset (like power cycle). If false, soft reset (like reset button).

A soft reset preserves some memory contents, hard reset clears everything.

Related tools: connect, status`,
    inputSchema: z.object({
      hard: z.boolean().optional().describe("Hard reset (true) vs soft reset (false, default)"),
    }),
  },
  async (args) => {
    try {
      await client.reset(args.hard || false);
      return formatResponse({
        reset: true,
        type: args.hard ? "hard" : "soft",
        message: `${args.hard ? "Hard" : "Soft"} reset performed`,
        hint: "C64 is now at startup. Use status() to check state.",
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: setBreakpoint - Set execution breakpoint
server.registerTool(
  "setBreakpoint",
  {
    description: `Set an execution breakpoint at a memory address.

When the PC reaches this address, execution stops. Use to:
- Debug code at specific points
- Catch when routines are called
- Analyze code flow

Returns a breakpoint ID for later management.

Related tools: deleteBreakpoint, listBreakpoints, continue, step`,
    inputSchema: z.object({
      address: z.number().min(0).max(0xffff).describe("Address to break at (0x0000-0xFFFF)"),
      enabled: z.boolean().optional().describe("Whether breakpoint is active (default: true)"),
      temporary: z.boolean().optional().describe("Auto-delete after hit (default: false)"),
    }),
  },
  async (args) => {
    try {
      const id = await client.setBreakpoint(args.address, {
        enabled: args.enabled ?? true,
        temporary: args.temporary ?? false,
      });

      return formatResponse({
        success: true,
        breakpointId: id,
        address: {
          value: args.address,
          hex: `$${args.address.toString(16).padStart(4, "0")}`,
        },
        enabled: args.enabled ?? true,
        temporary: args.temporary ?? false,
        message: `Breakpoint ${id} set at $${args.address.toString(16).padStart(4, "0")}`,
        hint: "Use continue() to run until breakpoint is hit",
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: deleteBreakpoint - Remove a breakpoint
server.registerTool(
  "deleteBreakpoint",
  {
    description: `Delete a breakpoint by its ID.

Use listBreakpoints to see current breakpoint IDs.

Related tools: setBreakpoint, listBreakpoints`,
    inputSchema: z.object({
      breakpointId: z.number().describe("Breakpoint ID from setBreakpoint"),
    }),
  },
  async (args) => {
    try {
      await client.deleteBreakpoint(args.breakpointId);
      return formatResponse({
        success: true,
        deletedId: args.breakpointId,
        message: `Breakpoint ${args.breakpointId} deleted`,
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: listBreakpoints - List all breakpoints
server.registerTool(
  "listBreakpoints",
  {
    description: `List all active breakpoints.

Shows breakpoint IDs, addresses, and status for all breakpoints set in this session.

Note: This tracks breakpoints set through this MCP session. Breakpoints set through VICE's built-in monitor may not appear.

Related tools: setBreakpoint, deleteBreakpoint`,
  },
  async () => {
    const breakpoints = client.listBreakpoints();

    if (breakpoints.length === 0) {
      return formatResponse({
        count: 0,
        breakpoints: [],
        hint: "No breakpoints set. Use setBreakpoint() to add one.",
      });
    }

    return formatResponse({
      count: breakpoints.length,
      breakpoints: breakpoints.map((bp) => ({
        id: bp.id,
        address: {
          value: bp.address,
          hex: `$${bp.address.toString(16).padStart(4, "0")}`,
        },
        enabled: bp.enabled,
        temporary: bp.temporary,
      })),
      hint: `${breakpoints.length} breakpoint(s) active. Use deleteBreakpoint(id) to remove.`,
    });
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
