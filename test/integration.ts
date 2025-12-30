#!/usr/bin/env npx ts-node
/**
 * VICE MCP Integration Tests
 *
 * Run against a VICE instance with binary monitor enabled:
 *   x64sc -binarymonitor -binarymonitoraddress ip4://127.0.0.1:6502
 *
 * Usage:
 *   npx ts-node test/integration.ts
 */

import { Socket } from "net";

const HOST = "127.0.0.1";
const PORT = 6502;

// Protocol constants
const STX = 0x02;
const API_VERSION = 0x02;

// Commands
const CMD_MEMORY_GET = 0x01;
const CMD_MEMORY_SET = 0x02;
const CMD_REGISTERS_GET = 0x31;
const CMD_DISPLAY_GET = 0x84;

// Response types
const RESP_MEMORY_GET = 0x01;
const RESP_REGISTER_INFO = 0x31;
const RESP_STOPPED = 0x62;
const RESP_DISPLAY_GET = 0x84;

let requestId = 0;
let socket: Socket;
let responseBuffer = Buffer.alloc(0);

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

const results: TestResult[] = [];

function nextRequestId(): number {
  requestId = (requestId + 1) & 0xffffffff;
  return requestId;
}

function buildPacket(command: number, body: Buffer): Buffer {
  const header = Buffer.alloc(11);
  header[0] = STX;
  header[1] = API_VERSION;
  header.writeUInt32LE(body.length, 2);
  header.writeUInt32LE(nextRequestId(), 6);
  header[10] = command;
  return Buffer.concat([header, body]);
}

async function sendCommand(command: number, body: Buffer): Promise<{ responseType: number; errorCode: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const packet = buildPacket(command, body);
    const reqId = requestId;

    console.log(`  Sending cmd 0x${command.toString(16)}, body ${body.length} bytes, reqId ${reqId}`);

    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for response"));
    }, 10000);

    const handleData = () => {
      // Response header: STX(1) + API(1) + bodyLength(4) + responseType(1) + errorCode(1) + requestId(4) = 12 bytes
      while (responseBuffer.length >= 12) {
        if (responseBuffer[0] !== STX) {
          responseBuffer = responseBuffer.subarray(1);
          continue;
        }

        const bodyLength = responseBuffer.readUInt32LE(2);
        const totalLength = 12 + bodyLength;

        if (responseBuffer.length < totalLength) {
          break; // Wait for more data
        }

        const responseType = responseBuffer[6];
        const errorCode = responseBuffer[7];
        const respReqId = responseBuffer.readUInt32LE(8);
        const respBody = responseBuffer.subarray(12, totalLength);

        responseBuffer = responseBuffer.subarray(totalLength);

        // Skip async events (Stopped, Resumed) unless they match our request
        if (respReqId === 0xffffffff) {
          console.log(`  Got async event type 0x${responseType.toString(16)}`);
          continue;
        }

        if (respReqId === reqId || responseType === RESP_REGISTER_INFO) {
          clearTimeout(timeout);
          socket.off("data", onData);
          resolve({ responseType, errorCode, body: respBody });
          return;
        }
      }
    };

    const onData = (data: Buffer) => {
      console.log(`  Received ${data.length} bytes: ${data.subarray(0, Math.min(20, data.length)).toString("hex")}...`);
      responseBuffer = Buffer.concat([responseBuffer, data]);
      handleData();
    };

    socket.on("data", onData);
    socket.write(packet);
  });
}

async function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    socket = new Socket();
    socket.on("connect", resolve);
    socket.on("error", reject);
    socket.connect(PORT, HOST);
  });
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, message: "OK", duration });
    console.log(`✅ ${name} (${duration}ms)`);
  } catch (error) {
    const duration = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, message, duration });
    console.log(`❌ ${name}: ${message} (${duration}ms)`);
  }
}

// Tests

async function testConnect(): Promise<void> {
  await connect();
  if (!socket.writable) {
    throw new Error("Socket not writable after connect");
  }
}

async function testRegistersGet(): Promise<void> {
  const body = Buffer.alloc(1);
  body[0] = 0; // MainCPU memspace

  const resp = await sendCommand(CMD_REGISTERS_GET, body);

  if (resp.errorCode !== 0) {
    throw new Error(`Error code 0x${resp.errorCode.toString(16)}`);
  }
  if (resp.body.length < 10) {
    throw new Error(`Response too short: ${resp.body.length} bytes`);
  }
  console.log(`  Got ${resp.body.length} bytes of register data`);
}

async function testMemoryGet(): Promise<void> {
  // Read $0400-$04FF (screen RAM)
  const body = Buffer.alloc(8);
  body[0] = 0; // No side effects
  body.writeUInt16LE(0x0400, 1); // Start
  body.writeUInt16LE(0x04ff, 3); // End
  body[5] = 0; // MainCPU memspace
  body.writeUInt16LE(0, 6); // Bank ID

  const resp = await sendCommand(CMD_MEMORY_GET, body);

  if (resp.errorCode !== 0) {
    throw new Error(`Error code 0x${resp.errorCode.toString(16)}`);
  }

  // Response body: length(2) + data
  const dataLength = resp.body.readUInt16LE(0);
  if (dataLength !== 256) {
    throw new Error(`Expected 256 bytes, got ${dataLength}`);
  }
  console.log(`  Got ${dataLength} bytes of memory data`);
}

async function testMemorySet(): Promise<void> {
  // Write a single byte to $D020 (border color)
  const body = Buffer.alloc(9);
  body[0] = 0; // No side effects
  body.writeUInt16LE(0xd020, 1); // Start
  body.writeUInt16LE(0xd020, 3); // End
  body[5] = 0; // MainCPU memspace
  body.writeUInt16LE(0, 6); // Bank ID
  body[8] = 0x00; // Black

  const resp = await sendCommand(CMD_MEMORY_SET, body);

  if (resp.errorCode !== 0) {
    throw new Error(`Error code 0x${resp.errorCode.toString(16)}`);
  }
  console.log(`  Successfully wrote to $D020`);
}

async function testDisplayGet(): Promise<void> {
  // DisplayGet: VC(1) + FM(1)
  const body = Buffer.alloc(2);
  body[0] = 1; // Use VIC-II
  body[1] = 0; // Indexed 8-bit format

  const resp = await sendCommand(CMD_DISPLAY_GET, body);

  if (resp.errorCode !== 0) {
    throw new Error(`Error code 0x${resp.errorCode.toString(16)} (${getErrorName(resp.errorCode)})`);
  }

  // Parse response: FL(4) + DW(2) + DH(2) + ...
  if (resp.body.length < 21) {
    throw new Error(`Response too short: ${resp.body.length} bytes`);
  }

  const fieldsLength = resp.body.readUInt32LE(0);
  const width = resp.body.readUInt16LE(4);
  const height = resp.body.readUInt16LE(6);
  const bufferLength = resp.body.readUInt32LE(17);

  console.log(`  Display: ${width}x${height}, buffer ${bufferLength} bytes, total response ${resp.body.length} bytes`);

  if (bufferLength < 100000) {
    throw new Error(`Buffer too small: ${bufferLength} bytes (expected ~157KB)`);
  }
}

function getErrorName(code: number): string {
  const names: Record<number, string> = {
    0x00: "OK",
    0x01: "ObjectMissing",
    0x02: "InvalidMemspace",
    0x80: "InvalidCmdLength",
    0x81: "InvalidParameterLength",
    0x82: "InvalidAPI",
    0x83: "InvalidCmdType",
    0x84: "InvalidTarget",
    0x85: "InvalidParameter",
  };
  return names[code] || `Unknown(0x${code.toString(16)})`;
}

async function main(): Promise<void> {
  console.log("VICE MCP Integration Tests");
  console.log("==========================\n");
  console.log(`Connecting to VICE at ${HOST}:${PORT}...\n`);

  await runTest("Connect", testConnect);
  await runTest("RegistersGet", testRegistersGet);
  await runTest("MemoryGet", testMemoryGet);
  await runTest("MemorySet", testMemorySet);
  await runTest("DisplayGet", testDisplayGet);

  // Summary
  console.log("\n==========================");
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (socket) {
    socket.end();
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
