#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getViceClient, ViceError } from "./protocol/index.js";
import {
  getColorInfo,
  screenToText,
  getVicBank,
  getVideoAddresses,
  getGraphicsMode,
  isSpriteVisible,
  validateSpriteDataAddress,
  disassemble,
  getLabelForAddress,
} from "./utils/index.js";

const VERSION = "1.0.1";

// Handle --version flag
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(`vice-mcp v${VERSION}`);
  process.exit(0);
}

const server = new McpServer({
  name: "vice-mcp",
  version: VERSION,
});

// Log version to stderr for debugging (MCP uses stdout for protocol)
console.error(`[vice-mcp] Starting v${VERSION}`);

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
          value: bp.startAddress,
          hex: `$${bp.startAddress.toString(16).padStart(4, "0")}`,
        },
        enabled: bp.enabled,
        temporary: bp.temporary,
      })),
      hint: `${breakpoints.length} breakpoint(s) active. Use deleteBreakpoint(id) to remove.`,
    });
  }
);

// Tool: enableBreakpoint / disableBreakpoint - Toggle breakpoint state
server.registerTool(
  "toggleBreakpoint",
  {
    description: `Enable or disable a breakpoint without deleting it.

Use this to temporarily disable breakpoints while keeping their configuration.

Related tools: setBreakpoint, deleteBreakpoint, listBreakpoints`,
    inputSchema: z.object({
      breakpointId: z.number().describe("Breakpoint ID from setBreakpoint"),
      enabled: z.boolean().describe("True to enable, false to disable"),
    }),
  },
  async (args) => {
    try {
      await client.toggleCheckpoint(args.breakpointId, args.enabled);
      return formatResponse({
        success: true,
        breakpointId: args.breakpointId,
        enabled: args.enabled,
        message: `Breakpoint ${args.breakpointId} ${args.enabled ? "enabled" : "disabled"}`,
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: setWatchpoint - Set memory watchpoint
server.registerTool(
  "setWatchpoint",
  {
    description: `Set a memory watchpoint to stop when memory is read or written.

Watchpoints are powerful for debugging:
- "Why is this value changing?" → Use store watchpoint
- "What's reading this address?" → Use load watchpoint
- "Track all access to this region" → Use both

Range can be single address or address range (e.g., $D800-$DBFF for color RAM).

Related tools: deleteBreakpoint, listWatchpoints, continue`,
    inputSchema: z.object({
      startAddress: z.number().min(0).max(0xffff).describe("Start address of watched range (0x0000-0xFFFF)"),
      endAddress: z
        .number()
        .min(0)
        .max(0xffff)
        .optional()
        .describe("End address of watched range (default: same as start for single address)"),
      type: z.enum(["load", "store", "both"]).describe("Watch type: 'load' (read), 'store' (write), or 'both'"),
      enabled: z.boolean().optional().describe("Whether watchpoint is active (default: true)"),
      temporary: z.boolean().optional().describe("Auto-delete after hit (default: false)"),
    }),
  },
  async (args) => {
    try {
      const endAddr = args.endAddress ?? args.startAddress;
      const id = await client.setWatchpoint(args.startAddress, endAddr, args.type, {
        enabled: args.enabled ?? true,
        temporary: args.temporary ?? false,
      });

      const isSingleAddress = args.startAddress === endAddr;

      return formatResponse({
        success: true,
        watchpointId: id,
        startAddress: {
          value: args.startAddress,
          hex: `$${args.startAddress.toString(16).padStart(4, "0")}`,
        },
        endAddress: {
          value: endAddr,
          hex: `$${endAddr.toString(16).padStart(4, "0")}`,
        },
        type: args.type,
        enabled: args.enabled ?? true,
        temporary: args.temporary ?? false,
        message: isSingleAddress
          ? `Watchpoint ${id} set at $${args.startAddress.toString(16).padStart(4, "0")} (${args.type})`
          : `Watchpoint ${id} set for $${args.startAddress.toString(16).padStart(4, "0")}-$${endAddr.toString(16).padStart(4, "0")} (${args.type})`,
        hint: "Use continue() to run until watchpoint is triggered",
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: listWatchpoints - List all watchpoints
server.registerTool(
  "listWatchpoints",
  {
    description: `List all active memory watchpoints.

Shows watchpoint IDs, address ranges, type (load/store), and status.

Related tools: setWatchpoint, deleteBreakpoint, listBreakpoints`,
  },
  async () => {
    const watchpoints = client.listWatchpoints();

    if (watchpoints.length === 0) {
      return formatResponse({
        count: 0,
        watchpoints: [],
        hint: "No watchpoints set. Use setWatchpoint() to add one.",
      });
    }

    return formatResponse({
      count: watchpoints.length,
      watchpoints: watchpoints.map((wp) => ({
        id: wp.id,
        startAddress: {
          value: wp.startAddress,
          hex: `$${wp.startAddress.toString(16).padStart(4, "0")}`,
        },
        endAddress: {
          value: wp.endAddress,
          hex: `$${wp.endAddress.toString(16).padStart(4, "0")}`,
        },
        type: wp.type,
        enabled: wp.enabled,
        temporary: wp.temporary,
      })),
      hint: `${watchpoints.length} watchpoint(s) active. Use deleteBreakpoint(id) to remove (works for both breakpoints and watchpoints).`,
    });
  }
);

// Tool: runTo - Run until specific address
server.registerTool(
  "runTo",
  {
    description: `Run execution until a specific address is reached.

Sets a temporary breakpoint at the target address and continues execution.
The breakpoint is automatically deleted when hit.

Use for:
- "Run until this function" → runTo(functionAddress)
- "Skip to the end of this loop" → runTo(addressAfterLoop)

Related tools: continue, step, setBreakpoint`,
    inputSchema: z.object({
      address: z.number().min(0).max(0xffff).describe("Address to run to (0x0000-0xFFFF)"),
    }),
  },
  async (args) => {
    try {
      // Set temporary breakpoint
      const bpId = await client.setBreakpoint(args.address, { temporary: true });

      // Continue execution
      await client.continue();

      return formatResponse({
        running: true,
        targetAddress: {
          value: args.address,
          hex: `$${args.address.toString(16).padStart(4, "0")}`,
        },
        temporaryBreakpointId: bpId,
        message: `Running to $${args.address.toString(16).padStart(4, "0")}`,
        hint: "Execution will stop when target address is reached. Use status() to check state.",
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: disassemble - Disassemble memory
server.registerTool(
  "disassemble",
  {
    description: `Disassemble 6502 machine code at a memory address.

Returns human-readable assembly instructions with:
- Address and raw bytes
- Mnemonic and operand
- Branch target addresses (for branch instructions)
- Known KERNAL/BASIC labels

Options:
- address: Start address (default: current PC)
- count: Number of instructions (default: 10)

Related tools: readMemory, getRegisters, step`,
    inputSchema: z.object({
      address: z
        .number()
        .min(0)
        .max(0xffff)
        .optional()
        .describe("Start address (default: current PC)"),
      count: z.number().min(1).max(100).optional().describe("Number of instructions to disassemble (default: 10)"),
    }),
  },
  async (args) => {
    try {
      // Get PC if no address specified
      let startAddress = args.address;
      if (startAddress === undefined) {
        const regResponse = await client.getRegisters();
        const count = regResponse.body.readUInt16LE(0);
        let offset = 2;
        for (let i = 0; i < count && offset < regResponse.body.length; i++) {
          const id = regResponse.body[offset];
          const size = regResponse.body[offset + 1];
          offset += 2;
          if (id === 3 && size === 2) {
            startAddress = regResponse.body.readUInt16LE(offset);
            break;
          }
          offset += size;
        }
        startAddress = startAddress ?? 0;
      }

      const instructionCount = args.count || 10;

      // Read enough bytes (max 3 bytes per instruction)
      const bytesToRead = Math.min(instructionCount * 3, 0x10000 - startAddress);
      const endAddress = Math.min(startAddress + bytesToRead - 1, 0xffff);
      const memData = await client.readMemory(startAddress, endAddress);

      // Disassemble
      const instructions = disassemble(memData, startAddress, instructionCount);

      // Add labels for known addresses
      const instructionsWithLabels = instructions.map((instr) => {
        const label = getLabelForAddress(instr.address);
        const targetLabel = instr.branchTarget ? getLabelForAddress(instr.branchTarget) : undefined;
        return {
          ...instr,
          label,
          targetLabel,
        };
      });

      // Format for output
      const lines = instructionsWithLabels.map((instr) => {
        let line = `${instr.addressHex}: ${instr.bytesHex.padEnd(8)} ${instr.fullInstruction}`;
        if (instr.label) line += `  ; ${instr.label}`;
        if (instr.targetLabel) line += `  ; -> ${instr.targetLabel}`;
        return line;
      });

      return formatResponse({
        startAddress: {
          value: startAddress,
          hex: `$${startAddress.toString(16).padStart(4, "0")}`,
        },
        instructionCount: instructions.length,
        instructions: instructionsWithLabels,
        listing: lines.join("\n"),
        hint:
          instructions.length > 0 && instructions[0].mnemonic === "BRK"
            ? "First instruction is BRK - this might be uninitialized memory or data"
            : `Disassembled ${instructions.length} instruction(s) from $${startAddress.toString(16).padStart(4, "0")}`,
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: saveSnapshot - Save machine state
server.registerTool(
  "saveSnapshot",
  {
    description: `Save the complete machine state to a file.

Creates a VICE snapshot file containing:
- All memory (RAM, I/O states)
- CPU registers
- VIC-II, SID, CIA states
- Disk drive state (if attached)

Use to:
- Save state before risky debugging
- Create restore points
- Share exact machine state

Related tools: loadSnapshot`,
    inputSchema: z.object({
      filename: z.string().describe("Filename for the snapshot (e.g., 'debug-state.vsf')"),
    }),
  },
  async (args) => {
    try {
      await client.saveSnapshot(args.filename);
      return formatResponse({
        success: true,
        filename: args.filename,
        message: `Snapshot saved to ${args.filename}`,
        hint: "Use loadSnapshot() to restore this state later",
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: loadSnapshot - Load machine state
server.registerTool(
  "loadSnapshot",
  {
    description: `Load a previously saved machine state from a file.

Restores complete machine state including memory, registers, and peripheral states.

Warning: This completely replaces the current state!

Related tools: saveSnapshot`,
    inputSchema: z.object({
      filename: z.string().describe("Filename of the snapshot to load"),
    }),
  },
  async (args) => {
    try {
      await client.loadSnapshot(args.filename);
      return formatResponse({
        success: true,
        filename: args.filename,
        message: `Snapshot loaded from ${args.filename}`,
        hint: "Machine state restored. Use getRegisters() to verify state.",
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: loadProgram - Autostart a program
server.registerTool(
  "loadProgram",
  {
    description: `Load and optionally run a program file.

Supports PRG, D64, T64, and other C64 file formats.
For disk images, can specify which file to run.

Options:
- run: If true (default), starts execution after loading
- fileIndex: For disk images, which file to load (0 = first)

Related tools: reset, status, setBreakpoint`,
    inputSchema: z.object({
      filename: z.string().describe("Path to the program file (PRG, D64, T64, etc.)"),
      run: z.boolean().optional().describe("Run after loading (default: true)"),
      fileIndex: z.number().optional().describe("File index in disk image (default: 0)"),
    }),
  },
  async (args) => {
    try {
      await client.autostart(args.filename, args.fileIndex ?? 0, args.run ?? true);
      return formatResponse({
        success: true,
        filename: args.filename,
        run: args.run ?? true,
        message: `Loading ${args.filename}${args.run !== false ? " and running" : ""}`,
        hint: args.run !== false
          ? "Program is loading. Set breakpoints before it reaches your code of interest."
          : "Program loaded but not started. Use continue() to run.",
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// =============================================================================
// SEMANTIC LAYER TOOLS - Interpreted output for autonomous debugging
// =============================================================================

// Tool: readScreen - Get screen contents as text
server.registerTool(
  "readScreen",
  {
    description: `Read the C64 screen memory and return it as interpreted text.

Converts PETSCII screen codes to readable ASCII. Returns 25 lines of 40 characters.

Use this instead of readMemory($0400) when you want to see what's displayed on screen.

Note: This reads from the current screen RAM location (may not be $0400 if the program moved it).
In bitmap modes, the data won't represent text.

Options:
- format: "full" (default) returns all 25 lines, "summary" returns only non-empty lines
- includeRaw: Also return raw screen codes (default: false)

Related tools: readColorRam, readVicState, readMemory`,
    inputSchema: z.object({
      format: z
        .enum(["full", "summary"])
        .optional()
        .describe("Output format: 'full' (all 25 lines) or 'summary' (non-empty lines only)"),
      includeRaw: z
        .boolean()
        .optional()
        .describe("Include raw screen codes array (default: false)"),
    }),
  },
  async (args) => {
    try {
      // First get VIC bank from CIA2
      const cia2Data = await client.readMemory(0xdd00, 0xdd00);
      const bankInfo = getVicBank(cia2Data[0]);

      // Get screen address from $D018
      const d018Data = await client.readMemory(0xd018, 0xd018);
      const videoAddrs = getVideoAddresses(d018Data[0], bankInfo.baseAddress);

      // Read screen RAM (1000 bytes)
      const screenData = await client.readMemory(
        videoAddrs.screenAddress,
        videoAddrs.screenAddress + 999
      );

      // Convert to text
      const textLines = screenToText(screenData);

      // Find non-empty lines for summary
      const nonEmptyLines = textLines
        .map((line, idx) => ({ line: idx, content: line }))
        .filter((l) => l.content.trim().length > 0);

      const useSummaryFormat = args.format === "summary";

      const response: Record<string, unknown> = {
        screenAddress: {
          value: videoAddrs.screenAddress,
          hex: `$${videoAddrs.screenAddress.toString(16).padStart(4, "0")}`,
        },
        vicBank: bankInfo.bank,
        format: useSummaryFormat ? "summary" : "full",
      };

      if (useSummaryFormat) {
        // Summary format: only non-empty lines with line numbers
        response.lines = nonEmptyLines.map((l) => ({
          lineNumber: l.line,
          content: l.content,
        }));
        response.totalLines = 25;
        response.nonEmptyCount = nonEmptyLines.length;
      } else {
        // Full format: all 25 lines
        response.lines = textLines;
        response.summary = {
          nonEmptyLines: nonEmptyLines.length,
          preview:
            nonEmptyLines.length > 0
              ? nonEmptyLines.slice(0, 3).map((l) => `Line ${l.line}: "${l.content}"`)
              : ["Screen appears empty"],
        };
      }

      if (args.includeRaw) {
        response.raw = Array.from(screenData);
      }

      // Check graphics mode and add hint
      const d011Data = await client.readMemory(0xd011, 0xd011);
      const d016Data = await client.readMemory(0xd016, 0xd016);
      const graphicsMode = getGraphicsMode(d011Data[0], d016Data[0]);

      response.graphicsMode = graphicsMode.mode;

      if (graphicsMode.bitmap) {
        response.hint =
          "Warning: VIC-II is in bitmap mode - screen RAM contains bitmap data, not text.";
      } else if (nonEmptyLines.length === 0) {
        response.hint = "Screen appears empty or contains only spaces.";
      } else {
        response.hint = `Screen has ${nonEmptyLines.length} non-empty line(s). First: "${nonEmptyLines[0]?.content || ""}"`;
      }

      return formatResponse(response);
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: readColorRam - Get color RAM state
server.registerTool(
  "readColorRam",
  {
    description: `Read color RAM ($D800-$DBE7) and return color values with names.

Color RAM determines the foreground color of each character on screen.

Returns:
- 25x40 grid of color values (0-15) with names
- Summary of colors used

Related tools: readScreen, readVicState`,
    inputSchema: z.object({
      summary: z
        .boolean()
        .optional()
        .describe("Return only color usage summary, not full grid (default: false)"),
    }),
  },
  async (args) => {
    try {
      // Color RAM is always at $D800
      const colorData = await client.readMemory(0xd800, 0xd800 + 999);

      // Count color usage
      const colorCounts = new Map<number, number>();
      for (const byte of colorData) {
        const color = byte & 0x0f;
        colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
      }

      // Sort by frequency
      const colorUsage = Array.from(colorCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([color, count]) => ({
          color: getColorInfo(color),
          count,
          percentage: Math.round((count / 1000) * 100),
        }));

      const response: Record<string, unknown> = {
        address: { value: 0xd800, hex: "$D800" },
        summary: {
          uniqueColors: colorUsage.length,
          dominantColor: colorUsage[0]?.color || null,
          usage: colorUsage,
        },
      };

      if (!args.summary) {
        // Convert to 25 lines of 40 color values
        const colorLines: Array<Array<{ value: number; name: string }>> = [];
        for (let row = 0; row < 25; row++) {
          const line: Array<{ value: number; name: string }> = [];
          for (let col = 0; col < 40; col++) {
            const offset = row * 40 + col;
            line.push(getColorInfo(colorData[offset]));
          }
          colorLines.push(line);
        }
        response.grid = colorLines;
      }

      response.hint =
        colorUsage.length === 1
          ? `Entire screen uses ${colorUsage[0].color.name} (${colorUsage[0].color.value})`
          : `${colorUsage.length} colors used. Dominant: ${colorUsage[0]?.color.name} (${colorUsage[0]?.percentage}%)`;

      return formatResponse(response);
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: readVicState - Full VIC-II chip state
server.registerTool(
  "readVicState",
  {
    description: `Read the full VIC-II state with interpreted values.

Returns all VIC-II registers with semantic meaning:
- Border and background colors (with names)
- Graphics mode (text, bitmap, multicolor, etc.)
- Screen and character memory locations
- Scroll values
- Raster position
- Sprite enable bits

This is the high-level view of the video chip. Use for understanding display configuration.

Related tools: readScreen, readSprites, readMemory (for $D000-$D02E)`,
  },
  async () => {
    try {
      // Read all VIC registers $D000-$D02E (47 bytes)
      const vicData = await client.readMemory(0xd000, 0xd02e);

      // Read CIA2 for bank info
      const cia2Data = await client.readMemory(0xdd00, 0xdd00);
      const bankInfo = getVicBank(cia2Data[0]);

      const d011 = vicData[0x11];
      const d016 = vicData[0x16];
      const d018 = vicData[0x18];

      const graphicsMode = getGraphicsMode(d011, d016);
      const videoAddrs = getVideoAddresses(d018, bankInfo.baseAddress);

      // Raster position (9-bit)
      const rasterLine = vicData[0x12] | ((d011 & 0x80) << 1);

      // Sprite enable and visibility check
      const spriteEnable = vicData[0x15];
      const spriteXMsb = vicData[0x10];
      const enabledSprites: number[] = [];
      const visibleSprites: number[] = [];

      for (let i = 0; i < 8; i++) {
        if (spriteEnable & (1 << i)) {
          enabledSprites.push(i);
          // Check visibility
          const xLow = vicData[i * 2];
          const xHigh = (spriteXMsb & (1 << i)) ? 256 : 0;
          const x = xLow + xHigh;
          const y = vicData[i * 2 + 1];
          const visibility = isSpriteVisible(x, y, true);
          if (visibility.visible) {
            visibleSprites.push(i);
          }
        }
      }

      // Display enable
      const displayEnabled = !!(d011 & 0x10);

      const response = {
        // Colors
        borderColor: getColorInfo(vicData[0x20]),
        backgroundColor: [
          getColorInfo(vicData[0x21]),
          getColorInfo(vicData[0x22]),
          getColorInfo(vicData[0x23]),
          getColorInfo(vicData[0x24]),
        ],

        // Graphics mode
        graphicsMode: graphicsMode.mode,
        displayEnabled,
        bitmap: graphicsMode.bitmap,
        multicolor: graphicsMode.multicolor,
        extendedColor: graphicsMode.extendedColor,

        // Screen geometry
        rows: d011 & 0x08 ? 25 : 24,
        columns: d016 & 0x08 ? 40 : 38,
        scrollX: d016 & 0x07,
        scrollY: d011 & 0x07,

        // Memory setup
        vicBank: {
          bank: bankInfo.bank,
          baseAddress: {
            value: bankInfo.baseAddress,
            hex: `$${bankInfo.baseAddress.toString(16).padStart(4, "0")}`,
          },
        },
        screenAddress: {
          value: videoAddrs.screenAddress,
          hex: `$${videoAddrs.screenAddress.toString(16).padStart(4, "0")}`,
        },
        charAddress: {
          value: videoAddrs.charAddress,
          hex: `$${videoAddrs.charAddress.toString(16).padStart(4, "0")}`,
        },

        // Raster
        rasterLine,

        // Sprites summary
        spriteEnable: {
          value: spriteEnable,
          binary: spriteEnable.toString(2).padStart(8, "0"),
          enabledSprites,
          enabledCount: enabledSprites.length,
          visibleSprites,
          visibleCount: visibleSprites.length,
        },

        // Sprite multicolor registers
        spriteMulticolor0: getColorInfo(vicData[0x25]),
        spriteMulticolor1: getColorInfo(vicData[0x26]),

        hint: !displayEnabled
          ? "Display is blanked (DEN=0) - screen shows border color only"
          : enabledSprites.length > 0
          ? visibleSprites.length < enabledSprites.length
            ? `${graphicsMode.mode} mode, ${enabledSprites.length} sprite(s) enabled but only ${visibleSprites.length} visible. Use readSprites() for details.`
            : `${graphicsMode.mode} mode, ${enabledSprites.length} sprite(s) enabled and visible.`
          : `${graphicsMode.mode} mode, no sprites enabled.`,
      };

      return formatResponse(response);
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: readSprites - Get detailed sprite state
server.registerTool(
  "readSprites",
  {
    description: `Read state of all 8 hardware sprites with interpreted values.

Returns for each sprite:
- Position (X, Y) with visibility check
- Color (with name)
- Enable status
- Multicolor mode
- X/Y expansion (double size)
- Priority (in front of / behind background)
- Data pointer address

Use this to debug sprite issues like:
- "Why is my sprite invisible?" → check enabled, position, pointer
- "Wrong colors?" → check multicolor mode and color registers
- "Wrong size?" → check expand flags

Options:
- enabledOnly: Only return enabled sprites (default: false)

Related tools: readVicState, readMemory (for sprite data)`,
    inputSchema: z.object({
      enabledOnly: z
        .boolean()
        .optional()
        .describe("Only return enabled sprites (default: false)"),
    }),
  },
  async (args) => {
    try {
      // Read VIC registers
      const vicData = await client.readMemory(0xd000, 0xd02e);

      // Read CIA2 for bank info (needed for sprite pointer calculation)
      const cia2Data = await client.readMemory(0xdd00, 0xdd00);
      const bankInfo = getVicBank(cia2Data[0]);

      // Get screen address for sprite pointers
      const d018 = vicData[0x18];
      const videoAddrs = getVideoAddresses(d018, bankInfo.baseAddress);

      // Sprite pointers are at screen + $3F8
      const spritePointerBase = videoAddrs.screenAddress + 0x3f8;
      const spritePointers = await client.readMemory(
        spritePointerBase,
        spritePointerBase + 7
      );

      const spriteEnable = vicData[0x15];
      const spriteXMsb = vicData[0x10];
      const spriteYExpand = vicData[0x17];
      const spriteXExpand = vicData[0x1d];
      const spriteMulticolor = vicData[0x1c];
      const spritePriority = vicData[0x1b];

      const sprites = [];

      for (let i = 0; i < 8; i++) {
        const enabled = !!(spriteEnable & (1 << i));

        // Skip disabled sprites if enabledOnly
        if (args.enabledOnly && !enabled) continue;

        // X position (9-bit)
        const xLow = vicData[i * 2];
        const xHigh = (spriteXMsb & (1 << i)) ? 256 : 0;
        const x = xLow + xHigh;

        // Y position (8-bit)
        const y = vicData[i * 2 + 1];

        const visibility = isSpriteVisible(x, y, enabled);

        // Sprite data address with region validation
        const pointer = spritePointers[i];
        const dataAddress = bankInfo.baseAddress + pointer * 64;
        const addressInfo = validateSpriteDataAddress(dataAddress);

        sprites.push({
          index: i,
          enabled,
          position: {
            x,
            y,
            visible: visibility.visible,
            visibilityReason: visibility.reason,
          },
          color: getColorInfo(vicData[0x27 + i]),
          multicolor: !!(spriteMulticolor & (1 << i)),
          expandX: !!(spriteXExpand & (1 << i)),
          expandY: !!(spriteYExpand & (1 << i)),
          priority: (spritePriority & (1 << i)) ? "behind" : "front",
          pointer: {
            value: pointer,
            hex: `$${pointer.toString(16).padStart(2, "0")}`,
          },
          dataAddress: {
            value: dataAddress,
            hex: `$${dataAddress.toString(16).padStart(4, "0")}`,
            region: addressInfo.region,
            severity: addressInfo.severity,
            warning: addressInfo.warning,
          },
        });
      }

      const enabledCount = sprites.filter((s) => s.enabled).length;
      const visibleCount = sprites.filter((s) => s.position.visible).length;

      // Collect visibility issues
      const visibilityIssues = sprites
        .filter((s) => s.enabled && !s.position.visible)
        .map((s) => `Sprite ${s.index}: ${s.position.visibilityReason}`);

      // Collect data address issues (warnings and errors)
      const addressIssues = sprites
        .filter((s) => s.enabled && s.dataAddress.warning)
        .map((s) => `Sprite ${s.index}: ${s.dataAddress.warning} (${s.dataAddress.hex})`);

      const allIssues = [...visibilityIssues, ...addressIssues];

      // Build hint based on most critical issue
      let hint: string;
      if (addressIssues.length > 0) {
        hint = `⚠️ ${addressIssues.length} sprite(s) with suspicious data address: ${addressIssues[0]}`;
      } else if (visibilityIssues.length > 0) {
        hint = `${visibilityIssues.length} enabled sprite(s) not visible: ${visibilityIssues[0]}`;
      } else if (enabledCount === 0) {
        hint = "No sprites enabled";
      } else {
        hint = `${enabledCount} sprite(s) enabled, ${visibleCount} visible`;
      }

      return formatResponse({
        count: sprites.length,
        enabledCount,
        visibleCount,
        sprites,
        spriteMulticolor0: getColorInfo(vicData[0x25]),
        spriteMulticolor1: getColorInfo(vicData[0x26]),
        issues: allIssues.length > 0 ? allIssues : undefined,
        hint,
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// =============================================================================
// VISUAL FEEDBACK TOOLS - Display capture and rendering
// =============================================================================

// Tool: screenshot - Capture display as PNG
server.registerTool(
  "screenshot",
  {
    description: `Capture the current VICE display as image data.

Returns the raw display buffer with:
- Pixel data (indexed 8-bit palette colors)
- Display dimensions and visible area
- Current palette RGB values

The data can be used to understand what's currently on screen visually.
For text mode screens, readScreen provides a simpler text representation.

Options:
- includePalette: Also return the color palette (default: true)

Related tools: readScreen, readVicState`,
    inputSchema: z.object({
      includePalette: z.boolean().optional().describe("Include palette RGB values (default: true)"),
    }),
  },
  async (args) => {
    try {
      const display = await client.getDisplay();

      const response: Record<string, unknown> = {
        width: display.width,
        height: display.height,
        bitsPerPixel: display.bitsPerPixel,
        visibleArea: {
          offsetX: display.offsetX,
          offsetY: display.offsetY,
          innerWidth: display.innerWidth,
          innerHeight: display.innerHeight,
        },
        pixelCount: display.pixels.length,
        // Return pixels as base64 for efficient transfer
        pixelsBase64: display.pixels.toString("base64"),
      };

      if (args.includePalette !== false) {
        const palette = await client.getPalette();
        response.palette = palette;
        response.paletteCount = palette.length;
      }

      response.hint = `Display is ${display.width}x${display.height} (visible: ${display.innerWidth}x${display.innerHeight}). Use readScreen() for text mode content.`;

      return formatResponse(response);
    } catch (error) {
      return formatError(error as ViceError);
    }
  }
);

// Tool: renderScreen - ASCII art screen rendering
server.registerTool(
  "renderScreen",
  {
    description: `Render the current screen as ASCII art representation.

Creates a visual representation of the screen using ASCII characters
to approximate the colors and content visible on the C64 display.

This is useful for quick visual debugging without image handling.
For actual screen text, use readScreen instead.

Options:
- width: Output width in characters (default: 80)
- height: Output height in lines (default: 50)
- charset: Character set to use for shading (default: " .:-=+*#%@")

Related tools: readScreen, screenshot, readVicState`,
    inputSchema: z.object({
      width: z.number().min(20).max(200).optional().describe("Output width in characters (default: 80)"),
      height: z.number().min(10).max(100).optional().describe("Output height in lines (default: 50)"),
      charset: z.string().optional().describe("Characters for shading from dark to light (default: ' .:-=+*#%@')"),
    }),
  },
  async (args) => {
    try {
      const display = await client.getDisplay();
      const palette = await client.getPalette();

      const outputWidth = args.width || 80;
      const outputHeight = args.height || 50;
      const charset = args.charset || " .:-=+*#%@";

      // Calculate luminance for each palette color
      const luminance = palette.map((c) => {
        // Standard luminance formula
        return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
      });

      // Sample the display and convert to ASCII
      const scaleX = display.innerWidth / outputWidth;
      const scaleY = display.innerHeight / outputHeight;

      const lines: string[] = [];

      for (let y = 0; y < outputHeight; y++) {
        let line = "";
        for (let x = 0; x < outputWidth; x++) {
          // Sample pixel from display
          const srcX = Math.floor(display.offsetX + x * scaleX);
          const srcY = Math.floor(display.offsetY + y * scaleY);
          const pixelIndex = srcY * display.width + srcX;

          if (pixelIndex < display.pixels.length) {
            const colorIndex = display.pixels[pixelIndex];
            const lum = colorIndex < luminance.length ? luminance[colorIndex] : 0;

            // Map luminance (0-255) to charset index
            const charIndex = Math.floor((lum / 256) * charset.length);
            line += charset[Math.min(charIndex, charset.length - 1)];
          } else {
            line += " ";
          }
        }
        lines.push(line);
      }

      return formatResponse({
        width: outputWidth,
        height: outputHeight,
        sourceWidth: display.innerWidth,
        sourceHeight: display.innerHeight,
        charset,
        render: lines.join("\n"),
        hint: `ASCII rendering of ${display.innerWidth}x${display.innerHeight} display scaled to ${outputWidth}x${outputHeight}`,
      });
    } catch (error) {
      return formatError(error as ViceError);
    }
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
