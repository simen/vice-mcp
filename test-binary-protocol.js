#!/usr/bin/env node
// Quick test script to verify VICE binary monitor protocol
// Run: node test-binary-protocol.js

import { Socket } from 'net';

const HOST = '127.0.0.1';
const PORT = 6502;

const sock = new Socket();
let buffer = Buffer.alloc(0);

function parsePackets() {
  while (buffer.length >= 9) {
    const stx = buffer[0];
    if (stx !== 0x02) {
      console.log(`Skipping non-STX byte: 0x${stx.toString(16)}`);
      buffer = buffer.subarray(1);
      continue;
    }

    const apiVer = buffer[1];
    const bodyLength = buffer.readUInt32LE(2);
    const totalLength = 9 + bodyLength;

    console.log(`\nPacket header: STX=0x${stx.toString(16)} API=0x${apiVer.toString(16)} bodyLen=${bodyLength} totalLen=${totalLength} bufLen=${buffer.length}`);

    if (buffer.length < totalLength) {
      console.log('  Waiting for more data...');
      break;
    }

    const respType = buffer[6];
    const errorCode = buffer[7];
    const reqId = buffer[8];
    const body = buffer.subarray(9, totalLength);

    console.log(`  RespType: 0x${respType.toString(16)}`);
    console.log(`  Error: 0x${errorCode.toString(16)}`);
    console.log(`  ReqID: ${reqId} (0x${reqId.toString(16)})`);
    console.log(`  Body (${body.length} bytes): ${body.toString('hex')}`);

    // Interpret response type
    const typeNames = {
      0x00: 'Invalid',
      0x01: 'OK',
      0x02: 'Object',
      0x11: 'Stopped',
      0x12: 'Resumed',
      0x31: 'MemoryGet',
      0x62: 'RegisterInfo',
      0x63: 'CheckpointHit',
    };
    console.log(`  Type name: ${typeNames[respType] || 'Unknown'}`);

    buffer = buffer.subarray(totalLength);
  }
}

sock.on('connect', () => {
  console.log('Connected to VICE');

  // Send a simple registers get command
  const body = Buffer.from([0x00]); // memspace = main CPU
  const header = Buffer.alloc(8);
  header[0] = 0x02; // STX
  header[1] = 0x01; // API version
  header.writeUInt32LE(body.length, 2); // body length
  header[6] = 0x01; // request ID
  header[7] = 0x22; // RegistersGet command

  const packet = Buffer.concat([header, body]);
  console.log('Sending packet:', packet.toString('hex'));

  sock.write(packet);
  console.log('Packet sent, waiting for response...');
});

sock.on('data', (data) => {
  console.log(`\n--- Received ${data.length} bytes: ${data.toString('hex')}`);
  buffer = Buffer.concat([buffer, data]);
  parsePackets();
});

sock.on('error', (err) => {
  console.error('Socket error:', err.message);
});

sock.on('close', () => {
  console.log('\nConnection closed');
  if (buffer.length > 0) {
    console.log(`Remaining buffer: ${buffer.toString('hex')}`);
  }
});

sock.on('timeout', () => {
  console.log('Socket timeout');
  sock.end();
});

sock.setTimeout(5000);
sock.connect(PORT, HOST);
