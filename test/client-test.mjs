#!/usr/bin/env node
/**
 * Test the ViceClient directly by importing from the bundled dist
 */

import { Socket } from "net";

const HOST = "127.0.0.1";
const PORT = 6502;

const STX = 0x02;
const API_VERSION = 0x02;
const CMD_DISPLAY_GET = 0x84;

let requestId = 0;
let socket;
let responseBuffer = Buffer.alloc(0);

function nextRequestId() {
  requestId = (requestId + 1) & 0xffffffff;
  return requestId;
}

function buildPacket(command, body) {
  // Same format as MCP client: 11-byte header
  const header = Buffer.alloc(11);
  header[0] = STX;
  header[1] = API_VERSION;
  header.writeUInt32LE(body.length, 2);
  header.writeUInt32LE(nextRequestId(), 6);
  header[10] = command;
  return Buffer.concat([header, body]);
}

async function connect() {
  return new Promise((resolve, reject) => {
    socket = new Socket();
    socket.on("connect", resolve);
    socket.on("error", reject);
    socket.connect(PORT, HOST);
  });
}

async function sendDisplayGet() {
  return new Promise((resolve, reject) => {
    // Body: useVicii(1) + format(1) - exactly like MCP client.getDisplay()
    const body = Buffer.alloc(2);
    body[0] = 1; // useVicii = true
    body[1] = 0; // format = indexed 8-bit

    const packet = buildPacket(CMD_DISPLAY_GET, body);
    const reqId = requestId;

    console.log(`Sending DisplayGet, reqId=${reqId}`);
    console.log(`Packet (${packet.length} bytes): ${packet.toString("hex")}`);

    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for DisplayGet response"));
    }, 15000);

    const handleData = () => {
      while (responseBuffer.length >= 12) {
        if (responseBuffer[0] !== STX) {
          responseBuffer = responseBuffer.subarray(1);
          continue;
        }

        const bodyLength = responseBuffer.readUInt32LE(2);
        const totalLength = 12 + bodyLength;

        if (responseBuffer.length < totalLength) {
          console.log(`Waiting for more data: have ${responseBuffer.length}, need ${totalLength}`);
          break;
        }

        const responseType = responseBuffer[6];
        const errorCode = responseBuffer[7];
        const respReqId = responseBuffer.readUInt32LE(8);
        const respBody = responseBuffer.subarray(12, totalLength);

        console.log(`Got response: type=0x${responseType.toString(16)}, error=0x${errorCode.toString(16)}, reqId=${respReqId}, bodyLen=${respBody.length}`);

        responseBuffer = responseBuffer.subarray(totalLength);

        // Skip async events
        if (respReqId === 0xffffffff) {
          console.log(`  (async event, skipping)`);
          continue;
        }

        if (respReqId === reqId) {
          clearTimeout(timeout);
          socket.off("data", onData);
          resolve({ responseType, errorCode, body: respBody });
          return;
        }
      }
    };

    const onData = (data) => {
      console.log(`Received ${data.length} bytes`);
      responseBuffer = Buffer.concat([responseBuffer, data]);
      handleData();
    };

    socket.on("data", onData);
    socket.write(packet);
  });
}

async function main() {
  console.log("Testing DisplayGet with MCP client packet format...\n");

  console.log("1. Connecting...");
  await connect();
  console.log("   Connected!\n");

  console.log("2. Sending DisplayGet...");
  try {
    const resp = await sendDisplayGet();
    if (resp.errorCode !== 0) {
      console.log(`   ERROR: 0x${resp.errorCode.toString(16)}`);
    } else {
      const width = resp.body.readUInt16LE(4);
      const height = resp.body.readUInt16LE(6);
      const bufferLength = resp.body.readUInt32LE(17);
      console.log(`   SUCCESS! ${width}x${height}, ${bufferLength} bytes`);
    }
  } catch (err) {
    console.log(`   FAILED: ${err.message}`);
  }

  socket.end();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
