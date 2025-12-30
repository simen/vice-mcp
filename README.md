# vice-mcp

A Model Context Protocol (MCP) server for autonomous C64 debugging via the VICE emulator.

## What is this?

vice-mcp bridges AI agents to the VICE Commodore 64 emulator, enabling autonomous debugging of 6502 assembly programs. Unlike raw protocol wrappers, it provides a **semantic layer** that interprets C64-specific data structures and returns meaningful, actionable information.

**Why this exists:**
- AI agents need more than hex dumps—they need interpreted data with context
- Debugging C64 code requires understanding VIC-II banks, PETSCII encoding, sprite pointers, and memory layouts
- Every response includes hints suggesting next steps and related tools

**Key differentiators:**
- **Semantic output**: `readScreen` returns text, not screen codes. `readVicState` explains graphics modes, not register bits.
- **Actionable hints**: Every response suggests what to do next
- **Cross-references**: Tools point to related tools for common workflows
- **Agent-friendly errors**: Clear error codes and recovery suggestions

## Prerequisites

- **Node.js** 18 or later
- **VICE emulator** with binary monitor enabled

### Starting VICE with Binary Monitor

```bash
# x64sc is the accurate C64 emulator (recommended)
x64sc -binarymonitor -binarymonitoraddress ip4://127.0.0.1:6502

# Or with x64 (faster, less accurate)
x64 -binarymonitor -binarymonitoraddress ip4://127.0.0.1:6502
```

The binary monitor listens on port 6502 by default.

## Installation

### From npm (when published)

```bash
npx @simen/vice-mcp
```

### From GitHub

```bash
npx github:simen/vice-mcp
```

### Local Development

```bash
git clone https://github.com/simen/vice-mcp.git
cd vice-mcp
npm install
npm run build
npm start
```

## Claude Code Installation

The quickest way to get started with Claude Code:

**1. Start VICE with binary monitor:**
```bash
x64sc -binarymonitor -binarymonitoraddress ip4://127.0.0.1:6502
```

**2. Add the MCP server:**
```bash
claude mcp add vice-mcp -- npx github:simen/vice-mcp
```

**3. Restart Claude Code** to load the new MCP server.

That's it! You can now ask Claude Code to debug your C64 programs.

### Manual Configuration

Alternatively, add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vice-mcp": {
      "command": "npx",
      "args": ["github:simen/vice-mcp"]
    }
  }
}
```

## Configuration

Add to your MCP client configuration (e.g., Claude Desktop, Cursor, or custom agent):

```json
{
  "mcpServers": {
    "vice": {
      "command": "npx",
      "args": ["@simen/vice-mcp"]
    }
  }
}
```

Or for local development:

```json
{
  "mcpServers": {
    "vice": {
      "command": "node",
      "args": ["/path/to/vice-mcp/dist/index.js"]
    }
  }
}
```

## Tool Reference

### Connection & Status

| Tool | Description |
|------|-------------|
| `connect` | Connect to VICE (default: 127.0.0.1:6502) |
| `disconnect` | Disconnect from VICE |
| `status` | Get connection state and emulation status |

### Memory Operations

| Tool | Description |
|------|-------------|
| `readMemory` | Read raw bytes with hex dump and ASCII |
| `writeMemory` | Write bytes to memory |

### CPU & Execution

| Tool | Description |
|------|-------------|
| `getRegisters` | Get A, X, Y, SP, PC, and flags (interpreted) |
| `step` | Single-step execution (with step-over option) |
| `continue` | Resume execution |
| `reset` | Soft or hard reset |
| `runTo` | Run until specific address (temporary breakpoint) |
| `disassemble` | Disassemble 6502 code with KERNAL labels |

### Breakpoints & Watchpoints

| Tool | Description |
|------|-------------|
| `setBreakpoint` | Set execution breakpoint |
| `deleteBreakpoint` | Remove breakpoint or watchpoint |
| `listBreakpoints` | List all breakpoints |
| `toggleBreakpoint` | Enable/disable breakpoint |
| `setWatchpoint` | Set memory read/write watchpoint |
| `listWatchpoints` | List all watchpoints |

### Semantic Layer (Interpreted C64 Data)

| Tool | Description |
|------|-------------|
| `readScreen` | Get screen as text (PETSCII decoded) with summary mode |
| `readColorRam` | Get color RAM with color names and usage stats |
| `readVicState` | Full VIC-II state: graphics mode, colors, banks, sprites |
| `readSprites` | All 8 sprites: position, visibility, colors, pointers |

### Visual Feedback

| Tool | Description |
|------|-------------|
| `screenshot` | Capture display buffer with palette |
| `renderScreen` | ASCII art rendering of display |

### State Management

| Tool | Description |
|------|-------------|
| `saveSnapshot` | Save complete machine state to file |
| `loadSnapshot` | Load machine state from file |
| `loadProgram` | Load and optionally run PRG/D64/T64 files |

## Example Usage

### Basic Debugging Session

```
1. connect()                    → Establish connection
2. loadProgram("game.prg")      → Load the program
3. setBreakpoint(0x0810)        → Break at main loop
4. continue()                   → Run until breakpoint
5. getRegisters()               → Check CPU state
6. readScreen()                 → See what's on screen
7. step(count: 5)               → Execute 5 instructions
8. disassemble()                → See code at current PC
```

### Debugging Sprite Issues

```
1. readVicState()               → Check sprite enable bits
2. readSprites(enabledOnly: true) → Get enabled sprite details
   → Response includes visibility check and position analysis
3. If sprite not visible, hint tells you why (off-screen, wrong bank, etc.)
```

### Memory Watchpoint Workflow

```
1. setWatchpoint(startAddress: 0x0400, type: "store")
   → Watch for writes to screen RAM
2. continue()
   → Execution stops when something writes to screen
3. getRegisters()
   → See PC to find the code that wrote
4. disassemble()
   → Understand what the code is doing
```

### State Checkpoint Pattern

```
1. saveSnapshot("before-test.vsf")  → Save state
2. [Make changes, test things]
3. loadSnapshot("before-test.vsf")  → Restore to known state
```

## Response Format

All responses include:
- **Structured data** with `value` and `hex` representations
- **`_meta` block** with connection state
- **`hint` field** with contextual next steps

Example `getRegisters` response:
```json
{
  "a": { "value": 65, "hex": "$41" },
  "x": { "value": 0, "hex": "$00" },
  "y": { "value": 0, "hex": "$00" },
  "sp": { "value": 243, "hex": "$f3", "stackTop": "$01f3" },
  "pc": { "value": 2049, "hex": "$0801" },
  "flags": {
    "negative": false,
    "overflow": false,
    "zero": false,
    "carry": false,
    "string": "nv-bdizc"
  },
  "hint": "CPU state looks normal",
  "_meta": {
    "connected": true,
    "running": false,
    "host": "127.0.0.1",
    "port": 6502
  }
}
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Client (Agent)                    │
└─────────────────────────────────────────────────────────┘
                            │
                            │ MCP Protocol (stdio)
                            ▼
┌─────────────────────────────────────────────────────────┐
│                     src/index.ts                         │
│                    (MCP Server)                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Tool Handlers (24 tools)            │    │
│  │  • Connection: connect, disconnect, status       │    │
│  │  • Memory: readMemory, writeMemory              │    │
│  │  • CPU: getRegisters, step, continue, reset     │    │
│  │  • Breakpoints: set, delete, list, toggle       │    │
│  │  • Watchpoints: set, list                       │    │
│  │  • Semantic: readScreen, readVicState, etc.     │    │
│  │  • Visual: screenshot, renderScreen            │    │
│  │  • State: saveSnapshot, loadSnapshot, loadPrg   │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                            │
                            │ Uses
                            ▼
┌─────────────────────────────────────────────────────────┐
│                 src/protocol/client.ts                   │
│                    (ViceClient)                          │
│  • TCP socket connection to VICE                        │
│  • Binary protocol encoding/decoding                    │
│  • Request/response correlation                         │
│  • Checkpoint (breakpoint/watchpoint) tracking          │
└─────────────────────────────────────────────────────────┘
                            │
                            │ TCP Socket
                            ▼
┌─────────────────────────────────────────────────────────┐
│                 VICE Binary Monitor                      │
│                   (Port 6502)                            │
└─────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | MCP server, tool definitions, semantic layer |
| `src/protocol/client.ts` | VICE binary monitor client |
| `src/protocol/types.ts` | Protocol constants and types |
| `src/utils/c64.ts` | C64 utilities (PETSCII, colors, VIC banks) |
| `src/utils/disasm.ts` | 6502 disassembler with all addressing modes |

### Design Principles

1. **Semantic over raw**: Return interpreted data, not just bytes
2. **Hints everywhere**: Every response suggests next actions
3. **Cross-references**: Tools reference related tools
4. **Fail informatively**: Errors explain what went wrong and how to fix it
5. **Agent-first**: Designed for autonomous operation, not human CLI use

## Protocol Reference

vice-mcp implements the [VICE Binary Monitor Protocol](https://vice-emu.sourceforge.io/vice_13.html). Key commands used:

| Code | Command | Purpose |
|------|---------|---------|
| 0x01 | MemoryGet | Read memory |
| 0x02 | MemorySet | Write memory |
| 0x12 | CheckpointSet | Create breakpoint/watchpoint |
| 0x13 | CheckpointDelete | Remove checkpoint |
| 0x15 | CheckpointToggle | Enable/disable checkpoint |
| 0x31 | RegistersGet | Read CPU registers |
| 0x41 | Dump | Save snapshot |
| 0x42 | Undump | Load snapshot |
| 0x81 | Continue | Resume execution |
| 0x82 | Step | Single-step |
| 0x84 | DisplayGet | Capture screen |
| 0x91 | PaletteGet | Get color palette |
| 0xdd | AutoStart | Load and run program |

## License

MIT
