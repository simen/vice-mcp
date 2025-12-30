// VICE Binary Monitor Protocol Types

// API Constants
export const STX = 0x02;
export const API_VERSION = 0x02; // VICE 3.5+ uses API v2 (required for DisplayGet, KeyboardFeed)

// Command codes (per official VICE manual: https://vice-emu.sourceforge.io/vice_13.html)
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

  // Advance/step instructions
  AdvanceInstructions = 0x71,
  KeyboardFeed = 0x72,
  ExecuteUntilReturn = 0x73,

  // Info/query commands
  Ping = 0x81,
  BanksAvailable = 0x82,
  RegistersAvailable = 0x83,
  DisplayGet = 0x84,
  ViceInfo = 0x85,

  // Palette
  PaletteGet = 0x91,

  // Joyport/Userport
  JoyportSet = 0xa2,
  UserportSet = 0xb2,

  // Execution control
  Exit = 0xaa,       // Resumes execution (continue)
  Quit = 0xbb,       // Terminates VICE

  // Reset
  Reset = 0xcc,

  // Autostart
  AutoStart = 0xdd,
}

// Response types (per official VICE manual: https://vice-emu.sourceforge.io/vice_13.html)
// Note: Most commands echo back with the same response code as the command
// These are the ASYNC event response types that VICE sends unprompted:
export enum ResponseType {
  Invalid = 0x00,

  // Command response codes (echoed from command)
  MemoryGet = 0x01,
  MemorySet = 0x02,
  CheckpointInfo = 0x11,
  RegisterInfo = 0x31,
  Dump = 0x41,
  Undump = 0x42,
  ResourceGet = 0x51,
  ResourceSet = 0x52,
  DisplayGet = 0x84,

  // Async event codes (sent by VICE unprompted)
  JAM = 0x61,                // CPU jam event
  Stopped = 0x62,            // Execution stopped
  Resumed = 0x63,            // Execution resumed
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
