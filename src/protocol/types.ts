// VICE Binary Monitor Protocol Types

// API Constants
export const STX = 0x02;
export const API_VERSION = 0x02;

// Command codes
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

  // Register operations
  RegistersGet = 0x31,
  RegistersSet = 0x32,

  // Execution control
  Dump = 0x41,
  Undump = 0x42,
  Reset = 0x43,

  // Resources
  ResourceGet = 0x51,
  ResourceSet = 0x52,

  // Advanced execution
  AdvanceInstructions = 0x71,
  KeyboardFeed = 0x72,
  Continue = 0x81,
  Step = 0x82,

  // Quit
  Quit = 0xbb,

  // Display
  DisplayGet = 0x84,
  PaletteGet = 0x91,

  // Autostart
  AutoStart = 0xdd,
}

// Response types
export enum ResponseType {
  Invalid = 0x00,
  Ok = 0x01,
  Object = 0x02,
  Stopped = 0x11,
  Resumed = 0x12,
  MemoryGet = 0x31,
  RegisterInfo = 0x62,
  CheckpointHit = 0x63,
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
