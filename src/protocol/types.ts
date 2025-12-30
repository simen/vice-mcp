// VICE Binary Monitor Protocol Types

// API Constants
export const STX = 0x02;
export const API_VERSION = 0x01; // VICE 3.x uses API v1

// Command codes (per KB docs)
export enum Command {
  // Memory operations
  MemoryGet = 0x01,
  MemorySet = 0x02,

  // Checkpoint (breakpoint/watchpoint) operations
  CheckpointSet = 0x11,
  CheckpointGet = 0x12,
  CheckpointDelete = 0x13,
  CheckpointList = 0x14,
  CheckpointToggle = 0x15,

  // Register operations
  RegistersGet = 0x22,
  RegistersSet = 0x23,

  // Execution control
  Continue = 0x31,
  Step = 0x32,
  Reset = 0x43,

  // Dump/Undump (snapshots)
  Dump = 0x41,
  Undump = 0x42,

  // Resources
  ResourceGet = 0x51,
  ResourceSet = 0x52,

  // Exit
  Exit = 0x71,

  // Advanced execution
  KeyboardFeed = 0x72,
  AdvanceInstructions = 0x73,

  // Display
  DisplayGet = 0x84,
  PaletteGet = 0x91,

  // Autostart
  AutoStart = 0xdd,
}

// Response types (per official VICE manual)
export enum ResponseType {
  Invalid = 0x00,
  MemoryGet = 0x01,    // Memory read response
  MemorySet = 0x02,    // Memory write response
  CheckpointResponse = 0x11, // Checkpoint set/get/delete response
  CheckpointInfo = 0x12,     // Checkpoint info
  RegisterInfo = 0x31,       // Register info (async event when stopped)
  Dump = 0x41,
  Undump = 0x42,
  ResourceGet = 0x51,
  ResourceSet = 0x52,
  Stopped = 0x62,            // Stopped event (async)
  Resumed = 0x63,            // Resumed event (async)
}

// Memory spaces
export enum MemorySpace {
  MainCPU = 0,
  Drive8 = 1,
  Drive9 = 2,
  Drive10 = 3,
  Drive11 = 4,
}

// Checkpoint (breakpoint) operation types
export enum CheckpointOp {
  Exec = 0x01,
  Load = 0x02,
  Store = 0x04,
}

// Error codes
export enum ErrorCode {
  Ok = 0x00,
  ObjectMissing = 0x01,
  InvalidMemspace = 0x02,
  InvalidCmdLength = 0x80,
  InvalidParameterLength = 0x81,
  InvalidAPI = 0x82,
  InvalidCmdType = 0x83,
  InvalidTarget = 0x84,
  InvalidParameter = 0x85,
}

export interface ViceResponse {
  responseType: ResponseType;
  errorCode: ErrorCode;
  requestId: number;
  body: Buffer;
}

export interface ConnectionState {
  connected: boolean;
  host: string;
  port: number;
  running: boolean;
}
