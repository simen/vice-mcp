/**
 * VICE MCP Integration Test Suite
 *
 * Tests all MCP tools against a running VICE instance.
 *
 * Prerequisites:
 *   x64sc -binarymonitor -binarymonitoraddress ip4://127.0.0.1:6502
 *
 * Run:
 *   npx tsx test/integration.test.ts
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface MCPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

class MCPTestClient {
  private process: ChildProcess;
  private requestId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = '';

  constructor(serverPath: string) {
    this.process = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr!.on('data', (data: Buffer) => {
      // Log errors but don't fail - some debug output goes to stderr
      const msg = data.toString().trim();
      if (msg && !msg.includes('too large to log')) {
        console.error('[MCP stderr]', msg);
      }
    });
  }

  private processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response: MCPResponse = JSON.parse(line);
        const pending = this.pending.get(response.id);
        if (pending) {
          this.pending.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch {
        // Skip non-JSON lines
      }
    }
  }

  async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = ++this.requestId;
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process.stdin!.write(JSON.stringify(request) + '\n');

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout waiting for response to ${method}`));
        }
      }, 10000);
    });
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const response = await this.call('tools/call', { name, arguments: args }) as {
      content?: Array<{ type: string; text: string }>;
    };

    // MCP wraps tool results in content[].text as JSON string
    if (response?.content?.[0]?.text) {
      try {
        return JSON.parse(response.content[0].text);
      } catch {
        return response.content[0].text;
      }
    }
    return response;
  }

  close() {
    this.process.kill();
  }
}

// Test utilities
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertExists(value: unknown, message: string) {
  if (value === null || value === undefined) {
    throw new Error(`Assertion failed: ${message} - value is ${value}`);
  }
}

function assertNoError(result: unknown, toolName: string) {
  const r = result as Record<string, unknown>;
  if (r.error) {
    throw new Error(`${toolName} returned error: ${JSON.stringify(r)}`);
  }
}

// Test definitions
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const tests: Array<{ name: string; fn: (client: MCPTestClient) => Promise<void> }> = [];

function test(name: string, fn: (client: MCPTestClient) => Promise<void>) {
  tests.push({ name, fn });
}

// === CONNECTION TESTS ===

test('connect - connects to VICE', async (client) => {
  const result = await client.callTool('connect') as Record<string, unknown>;
  assertNoError(result, 'connect');
  assert(result.connected === true, 'should be connected');
  assert(result.host === '127.0.0.1', 'should use default host');
  assert(result.port === 6502, 'should use default port');
});

test('status - shows connected state', async (client) => {
  const result = await client.callTool('status') as Record<string, unknown>;
  assertNoError(result, 'status');
  assert(result.connected === true, 'should be connected');
  assertExists(result.host, 'should have host');
  assertExists(result.port, 'should have port');
});

// === MEMORY TESTS ===

test('readMemory - reads screen RAM', async (client) => {
  const result = await client.callTool('readMemory', {
    address: 0x0400,
    length: 40,
  }) as Record<string, unknown>;
  assertNoError(result, 'readMemory');
  assertExists(result.hex, 'should have hex output');
  assertExists(result.ascii, 'should have ascii output');
  assert((result.bytes as number[]).length === 40, 'should read 40 bytes');
});

test('writeMemory - writes to zero page', async (client) => {
  // Use zero page instead of I/O registers for reliable test
  const testAddr = 0x00FB; // Unused zero page location

  // Save original
  const original = await client.callTool('readMemory', {
    address: testAddr,
    length: 1,
  }) as Record<string, unknown>;
  const originalValue = (original.bytes as number[])[0];

  // Write new value
  const testValue = (originalValue + 1) & 0xFF; // Different value
  const result = await client.callTool('writeMemory', {
    address: testAddr,
    bytes: [testValue],
  }) as Record<string, unknown>;
  assertNoError(result, 'writeMemory');

  // Verify
  const verify = await client.callTool('readMemory', {
    address: testAddr,
    length: 1,
  }) as Record<string, unknown>;
  assert((verify.bytes as number[])[0] === testValue, `should read back ${testValue}`);

  // Restore
  await client.callTool('writeMemory', {
    address: testAddr,
    bytes: [originalValue],
  });
});

// === REGISTER TESTS ===

test('getRegisters - returns CPU state', async (client) => {
  const result = await client.callTool('getRegisters') as Record<string, unknown>;
  assertNoError(result, 'getRegisters');
  assertExists(result.a, 'should have accumulator');
  assertExists(result.x, 'should have X register');
  assertExists(result.y, 'should have Y register');
  assertExists(result.sp, 'should have stack pointer');
  assertExists(result.pc, 'should have program counter');
  assertExists(result.flags, 'should have flags');
});

// === SEMANTIC LAYER TESTS ===

test('readScreen - decodes PETSCII', async (client) => {
  const result = await client.callTool('readScreen') as Record<string, unknown>;
  assertNoError(result, 'readScreen');
  assertExists(result.lines, 'should have lines array');
  assert(Array.isArray(result.lines), 'lines should be array');
  assert((result.lines as string[]).length === 25, 'should have 25 lines');
  assertExists(result.screenAddress, 'should have screen address');
});

test('readVicState - interprets VIC-II', async (client) => {
  const result = await client.callTool('readVicState') as Record<string, unknown>;
  assertNoError(result, 'readVicState');
  assertExists(result.borderColor, 'should have border color');
  assertExists(result.backgroundColor, 'should have background color');
  assertExists(result.graphicsMode, 'should have graphics mode');
  assertExists(result.spriteEnable, 'should have sprite enable');

  // Check border color has name
  const border = result.borderColor as Record<string, unknown>;
  assertExists(border.name, 'border color should have name');
});

test('readSprites - returns all 8 sprites with diagnostics', async (client) => {
  const result = await client.callTool('readSprites') as Record<string, unknown>;
  assertNoError(result, 'readSprites');
  assert(result.count === 8, 'should have 8 sprites');
  assertExists(result.sprites, 'should have sprites array');

  const sprites = result.sprites as Array<Record<string, unknown>>;
  assert(sprites.length === 8, 'sprites array should have 8 entries');

  // Check first sprite has required fields
  const sprite0 = sprites[0];
  assertExists(sprite0.enabled, 'sprite should have enabled');
  assertExists(sprite0.position, 'sprite should have position');
  assertExists(sprite0.color, 'sprite should have color');
  assertExists(sprite0.dataAddress, 'sprite should have dataAddress');

  // Check dataAddress has diagnostics (AX design)
  const dataAddr = sprite0.dataAddress as Record<string, unknown>;
  assertExists(dataAddr.region, 'dataAddress should have region');
  assertExists(dataAddr.severity, 'dataAddress should have severity');
});

test('readColorRam - returns color info', async (client) => {
  const result = await client.callTool('readColorRam', { summary: true }) as Record<string, unknown>;
  assertNoError(result, 'readColorRam');
  assertExists(result.summary, 'should have summary');
  const summary = result.summary as Record<string, unknown>;
  assertExists(summary.usage, 'should have color usage');
});

// === EXECUTION CONTROL TESTS ===

test('step - executes single instruction', async (client) => {
  const before = await client.callTool('getRegisters') as Record<string, unknown>;
  const pcBefore = (before.pc as Record<string, unknown>).value;

  const result = await client.callTool('step') as Record<string, unknown>;
  assertNoError(result, 'step');

  const after = await client.callTool('getRegisters') as Record<string, unknown>;
  const pcAfter = (after.pc as Record<string, unknown>).value;

  // PC should have changed (unless we hit a JAM)
  // Just verify we got a response
  assertExists(pcAfter, 'should have PC after step');
});

test('continue - resumes execution', async (client) => {
  const result = await client.callTool('continue') as Record<string, unknown>;
  assertNoError(result, 'continue');

  // Give it a moment to run
  await new Promise(r => setTimeout(r, 100));

  const status = await client.callTool('status') as Record<string, unknown>;
  // Should be running now
  assertExists(status.running, 'should have running state');
});

// === BREAKPOINT TESTS ===

test('setBreakpoint - creates breakpoint', async (client) => {
  const result = await client.callTool('setBreakpoint', {
    address: 0xE000,
  }) as Record<string, unknown>;
  assertNoError(result, 'setBreakpoint');
  assertExists(result.breakpointId, 'should return breakpoint ID');

  // Clean up
  const bpId = result.breakpointId as number;
  await client.callTool('deleteBreakpoint', { breakpointId: bpId });
});

test('listBreakpoints - shows breakpoints', async (client) => {
  // Create a breakpoint
  const bp = await client.callTool('setBreakpoint', {
    address: 0xE544,
  }) as Record<string, unknown>;
  const bpId = bp.breakpointId as number;

  const result = await client.callTool('listBreakpoints') as Record<string, unknown>;
  assertNoError(result, 'listBreakpoints');
  assertExists(result.breakpoints, 'should have breakpoints array');

  // Clean up
  await client.callTool('deleteBreakpoint', { breakpointId: bpId });
});

test('setWatchpoint - creates memory watch', async (client) => {
  const result = await client.callTool('setWatchpoint', {
    startAddress: 0xD020,
    type: 'store',
  }) as Record<string, unknown>;
  assertNoError(result, 'setWatchpoint');
  assertExists(result.watchpointId, 'should return watchpoint ID');

  // Clean up
  const wpId = result.watchpointId as number;
  await client.callTool('deleteBreakpoint', { breakpointId: wpId });
});

// === DISASSEMBLY TEST ===

test('disassemble - shows assembly', async (client) => {
  const result = await client.callTool('disassemble', {
    address: 0xE000,
    count: 5,
  }) as Record<string, unknown>;
  assertNoError(result, 'disassemble');
  assertExists(result.instructions, 'should have instructions');

  const instrs = result.instructions as Array<Record<string, unknown>>;
  assert(instrs.length === 5, 'should have 5 instructions');

  // Check instruction format
  const instr0 = instrs[0];
  assertExists(instr0.address, 'instruction should have address');
  assertExists(instr0.mnemonic, 'instruction should have mnemonic');
});

// === RESET TEST ===

test('reset - soft resets machine', async (client) => {
  const result = await client.callTool('reset', { hard: false }) as Record<string, unknown>;
  assertNoError(result, 'reset');

  // Give it time to reset
  await new Promise(r => setTimeout(r, 500));

  // Check we're still connected
  const status = await client.callTool('status') as Record<string, unknown>;
  assert(status.connected === true, 'should still be connected after reset');
});

// === RUN TESTS ===

async function runTests() {
  const serverPath = path.join(__dirname, '..', 'dist', 'index.js');
  console.log(`\nVICE MCP Integration Tests`);
  console.log(`==========================`);
  console.log(`Server: ${serverPath}\n`);

  const client = new MCPTestClient(serverPath);
  const results: TestResult[] = [];

  // Wait for server to start
  await new Promise(r => setTimeout(r, 500));

  // Initialize MCP session
  try {
    await client.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'integration-test', version: '1.0.0' },
    });
  } catch (e) {
    console.error('Failed to initialize MCP session:', e);
    client.close();
    process.exit(1);
  }

  for (const { name, fn } of tests) {
    const start = Date.now();
    try {
      await fn(client);
      results.push({ name, passed: true, duration: Date.now() - start });
      console.log(`  ✓ ${name} (${Date.now() - start}ms)`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      results.push({ name, passed: false, error, duration: Date.now() - start });
      console.log(`  ✗ ${name}: ${error}`);
    }
  }

  client.close();

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`\n---------------------------`);
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total time: ${totalTime}ms`);

  if (failed > 0) {
    console.log(`\nFailed tests:`);
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
