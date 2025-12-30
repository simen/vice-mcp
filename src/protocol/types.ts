// VICE Binary Monitor Protocol Types

// API Constants
export const STX = 0x02;
export const API_VERSION = 0x01; // VICE 3.x uses API v1

// Command codes (per official VICE manual)
export enum Command {
  // Memory operations
  MemoryGet = 0x01,
  MemorySet = 0x02,

  // Checkpoint (breakpoint/watchpoint) operations
  CheckpointGet = 0x11,
  CheckpointSet = 0x12,
  CheckpointDelete = 0x13,
  CheckpointList = 0x14,
  CheckpointToggle = 0x15,

  // Condition operations
  ConditionSet = 0x22,

  // Register operations
  RegistersGet = 0x31,
  RegistersSet = 0x32,

  // Dump/Undump (snapshots)
  Dump = 0x41,
  Undump = 0x42,

  // Resources
  ResourceGet = 0x51,
  ResourceSet = 0x52,

  // Advance instructions
  AdvanceInstructions = 0x71,
  KeyboardFeed = 0x72,

  // Execution control
  Step = 0x81,
  Continue = 0x82,  // Also called "Exit" - resumes execution
  Ping = 0x81,      // Same as step with count=0

  // Display
  DisplayGet = 0x84,

  // Banks
  BanksAvailable = 0x83,

  // Exit/Quit
  Exit = 0xaa,
  Quit = 0xbb,

  // Reset
  Reset = 0xcc,

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
