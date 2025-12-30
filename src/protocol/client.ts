// VICE Binary Monitor Client
import { Socket } from "net";
import {
  STX,
  API_VERSION,
  Command,
  ResponseType,
  ErrorCode,
  MemorySpace,
  CheckpointOp,
  ViceResponse,
  ConnectionState,
} from "./types.js";

export interface ViceError {
  error: true;
  code: string;
  message: string;
  suggestion?: string;
}

export type CheckpointType = "exec" | "load" | "store";

export interface CheckpointInfo {
  id: number;
  startAddress: number;
  endAddress: number;
  enabled: boolean;
  temporary: boolean;
  type: CheckpointType;
}

// Keep for backwards compatibility
export type BreakpointInfo = CheckpointInfo;

// Debug logging - set to true to see protocol traffic
const DEBUG = true;
function debugLog(msg: string, data?: Buffer | unknown): void {
  if (!DEBUG) return;
  if (data instanceof Buffer) {
    console.error(`[VICE] ${msg}: ${data.toString("hex")} (${data.length} bytes)`);
  } else if (data !== undefined) {
    console.error(`[VICE] ${msg}:`, data);
  } else {
    console.error(`[VICE] ${msg}`);
  }
}

export class ViceClient {
  private socket: Socket | null = null;
  private requestId = 0;
  private responseBuffer = Buffer.alloc(0);
  private pendingRequests = new Map<
    number,
    {
      resolve: (response: ViceResponse) => void;
      reject: (error: ViceError) => void;
      expectedResponseType?: ResponseType; // For async event matching
    }
  >();
  private state: ConnectionState = {
    connected: false,
    host: "",
    port: 0,
    running: true,
  };
  // Track checkpoints locally (VICE doesn't have a reliable list command in all versions)
  private checkpoints = new Map<number, CheckpointInfo>();

  // Event handlers for async events (breakpoints, etc.)
  public onStopped?: (response: ViceResponse) => void;
  public onResumed?: (response: ViceResponse) => void;

  getState(): ConnectionState {
    return { ...this.state };
  }

  async connect(host = "127.0.0.1", port = 6502): Promise<void> {
    if (this.socket) {
      throw this.makeError(
        "ALREADY_CONNECTED",
        "Already connected to VICE",
        "Use disconnect() first if you want to reconnect"
      );
    }

    return new Promise((resolve, reject) => {
      this.socket = new Socket();

      const timeout = setTimeout(() => {
        this.socket?.destroy();
        this.socket = null;
        reject(
          this.makeError(
            "CONNECTION_TIMEOUT",
            `Connection to ${host}:${port} timed out after 5 seconds`,
            "Ensure VICE is running with -binarymonitor flag: x64sc -binarymonitor -binarymonitoraddress ip4://127.0.0.1:6502"
          )
        );
      }, 5000);

      this.socket.on("connect", () => {
        clearTimeout(timeout);
        this.state = { connected: true, host, port, running: true };
        resolve();
      });

      this.socket.on("error", (err) => {
        clearTimeout(timeout);
        this.socket?.destroy();
        this.socket = null;
        this.state.connected = false;
        reject(
          this.makeError(
            "CONNECTION_FAILED",
            `Failed to connect to ${host}:${port}: ${err.message}`,
            "Ensure VICE is running with -binarymonitor flag: x64sc -binarymonitor -binarymonitoraddress ip4://127.0.0.1:6502"
          )
        );
      });

      this.socket.on("close", () => {
        this.state.connected = false;
        this.socket = null;
        // Reject all pending requests
        for (const [, { reject: rejectFn }] of this.pendingRequests) {
          rejectFn(
            this.makeError(
              "CONNECTION_CLOSED",
              "Connection to VICE closed unexpectedly",
              "VICE may have been closed or crashed. Try reconnecting."
            )
          );
        }
        this.pendingRequests.clear();
      });

      this.socket.on("data", (data) => this.handleData(data));

      this.socket.connect(port, host);
    });
  }

  async disconnect(): Promise<void> {
    if (!this.socket) {
      return;
    }

    return new Promise((resolve) => {
      this.socket!.once("close", () => {
        this.state.connected = false;
        resolve();
      });
      this.socket!.end();
    });
  }

  private makeError(code: string, message: string, suggestion?: string): ViceError {
    return { error: true, code, message, suggestion };
  }

  private nextRequestId(): number {
    this.requestId = (this.requestId + 1) & 0xff;
    return this.requestId;
  }

  private handleData(data: Buffer): void {
    this.responseBuffer = Buffer.concat([this.responseBuffer, data]);
    debugLog("Received data", data);

    // Process complete packets
    // Response header: STX(1) + API(1) + bodyLength(4) + responseType(1) + errorCode(1) + requestId(1) = 9 bytes
    // Then body of `bodyLength` bytes follows
    while (this.responseBuffer.length >= 9) {
      const stx = this.responseBuffer[0];
      if (stx !== STX) {
        // Protocol error, skip byte
        debugLog(`Skipping non-STX byte: 0x${stx.toString(16)}`);
        this.responseBuffer = this.responseBuffer.subarray(1);
        continue;
      }

      const bodyLength = this.responseBuffer.readUInt32LE(2);
      const totalLength = 9 + bodyLength; // Header (9) + body

      debugLog(`Packet: bodyLength=${bodyLength}, totalLength=${totalLength}, bufferLen=${this.responseBuffer.length}`);

      if (this.responseBuffer.length < totalLength) {
        // Wait for more data
        break;
      }

      // Parse complete packet
      // Response format: STX(1) + API(1) + bodyLen(4) + type(1) + error(1) + reqId(1) + body
      const responseType = this.responseBuffer[6] as ResponseType;
      const errorCode = this.responseBuffer[7] as ErrorCode;
      const requestId = this.responseBuffer[8];
      const body = this.responseBuffer.subarray(9, totalLength);

      debugLog(`Parsed response: type=0x${responseType.toString(16)}, error=0x${errorCode.toString(16)}, reqId=${requestId}`);
      debugLog("Response body", body);

      const response: ViceResponse = {
        responseType,
        errorCode,
        requestId,
        body,
      };

      // Remove processed packet from buffer
      this.responseBuffer = this.responseBuffer.subarray(totalLength);

      // Handle response
      this.handleResponse(response);
    }
  }

  private handleResponse(response: ViceResponse): void {
    debugLog(`handleResponse: type=0x${response.responseType.toString(16)}, reqId=${response.requestId}`);

    // Check for async events (state changes)
    // Stopped = 0x62, which VICE sends when emulation stops
    if (response.responseType === ResponseType.Stopped) {
      this.state.running = false;
      this.onStopped?.(response);
      // Don't return - this might also be a response to a pending request
    }

    if (response.responseType === ResponseType.Resumed) {
      this.state.running = true;
      this.onResumed?.(response);
      // Don't return - continue to check for pending requests
    }

    // VICE API v1 sends some responses as async events (ReqID=0xff)
    // For these, we match by response type to the oldest pending request expecting that type
    if (response.requestId === 0xff) {
      // Find a pending request that expects this response type
      for (const [reqId, pending] of this.pendingRequests) {
        if (pending.expectedResponseType === response.responseType) {
          debugLog(`Matched async response type 0x${response.responseType.toString(16)} to request ${reqId}`);
          this.pendingRequests.delete(reqId);
          if (response.errorCode !== ErrorCode.Ok) {
            pending.reject(
              this.makeError(
                `VICE_ERROR_${response.errorCode}`,
                `VICE returned error code ${response.errorCode}`,
                this.getErrorSuggestion(response.errorCode)
              )
            );
          } else {
            pending.resolve(response);
          }
          return;
        }
      }
      debugLog(`No pending request matched async response type 0x${response.responseType.toString(16)}`);
      return;
    }

    // Match to pending request by request ID
    const pending = this.pendingRequests.get(response.requestId);
    if (pending) {
      this.pendingRequests.delete(response.requestId);
      if (response.errorCode !== ErrorCode.Ok) {
        pending.reject(
          this.makeError(
            `VICE_ERROR_${response.errorCode}`,
            `VICE returned error code ${response.errorCode}`,
            this.getErrorSuggestion(response.errorCode)
          )
        );
      } else {
        pending.resolve(response);
      }
    }
  }

  private getErrorSuggestion(code: ErrorCode): string {
    switch (code) {
      case ErrorCode.ObjectMissing:
        return "The requested object (checkpoint, etc.) does not exist";
      case ErrorCode.InvalidMemspace:
        return "Invalid memory space specified. Use 0 for main CPU memory.";
      case ErrorCode.InvalidCmdLength:
        return "Command packet has invalid length - this is likely a protocol bug";
      case ErrorCode.InvalidParameter:
        return "Invalid parameter value - check address ranges (0x0000-0xFFFF for C64)";
      default:
        return "Check VICE console for more details";
    }
  }

  private async sendCommand(
    command: Command,
    body: Buffer = Buffer.alloc(0),
    expectedResponseType?: ResponseType
  ): Promise<ViceResponse> {
    if (!this.socket || !this.state.connected) {
      throw this.makeError(
        "NOT_CONNECTED",
        "Not connected to VICE",
        "Use connect() first to establish connection"
      );
    }

    const requestId = this.nextRequestId();

    // Build packet: STX(1) + API(1) + Length(4) + RequestID(1) + Command(1) + Body
    // Length field is ONLY the command body, NOT including ReqID or Command
    const header = Buffer.alloc(8);
    header[0] = STX;
    header[1] = API_VERSION;
    header.writeUInt32LE(body.length, 2); // Just the command body length
    header[6] = requestId;
    header[7] = command;

    const packet = Buffer.concat([header, body]);
    debugLog(`Sending command 0x${command.toString(16)}, reqId=${requestId}, expectType=${expectedResponseType?.toString(16) ?? 'any'}`, packet);

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject, expectedResponseType });

      this.socket!.write(packet, (err) => {
        if (err) {
          this.pendingRequests.delete(requestId);
          reject(
            this.makeError(
              "SEND_FAILED",
              `Failed to send command: ${err.message}`,
              "Connection may have been lost. Try reconnecting."
            )
          );
        }
      });

      // Timeout for response
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(
            this.makeError(
              "RESPONSE_TIMEOUT",
              "Timeout waiting for VICE response",
              "VICE may be busy or unresponsive. Try again or reconnect."
            )
          );
        }
      }, 10000);
    });
  }

  // High-level commands

  async readMemory(
    startAddress: number,
    endAddress: number,
    memspace: MemorySpace = MemorySpace.MainCPU
  ): Promise<Buffer> {
    // Validate addresses
    if (startAddress < 0 || startAddress > 0xffff) {
      throw this.makeError(
        "INVALID_ADDRESS",
        `Start address 0x${startAddress.toString(16)} is outside C64 memory range`,
        "C64 addresses are 16-bit (0x0000-0xFFFF)"
      );
    }
    if (endAddress < 0 || endAddress > 0xffff) {
      throw this.makeError(
        "INVALID_ADDRESS",
        `End address 0x${endAddress.toString(16)} is outside C64 memory range`,
        "C64 addresses are 16-bit (0x0000-0xFFFF)"
      );
    }
    if (startAddress > endAddress) {
      throw this.makeError(
        "INVALID_RANGE",
        `Start address (0x${startAddress.toString(16)}) is greater than end address (0x${endAddress.toString(16)})`,
        "Swap the addresses or check your range"
      );
    }

    // Build request: side_effects(1) + start(2) + memspace(1) + end(2)
    const body = Buffer.alloc(6);
    body[0] = 0; // No side effects
    body.writeUInt16LE(startAddress, 1);
    body[3] = memspace;
    body.writeUInt16LE(endAddress, 4);

    // VICE sends MemoryGet response with type 0x01
    const response = await this.sendCommand(Command.MemoryGet, body, ResponseType.MemoryGet);

    // Response body: length(2) + data(N)
    const dataLength = response.body.readUInt16LE(0);
    return response.body.subarray(2, 2 + dataLength);
  }

  async writeMemory(
    address: number,
    data: Buffer | number[],
    memspace: MemorySpace = MemorySpace.MainCPU
  ): Promise<void> {
    const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

    if (address < 0 || address > 0xffff) {
      throw this.makeError(
        "INVALID_ADDRESS",
        `Address 0x${address.toString(16)} is outside C64 memory range`,
        "C64 addresses are 16-bit (0x0000-0xFFFF)"
      );
    }

    if (dataBuffer.length === 0) {
      throw this.makeError(
        "INVALID_DATA",
        "Cannot write empty data",
        "Provide at least one byte to write"
      );
    }

    if (address + dataBuffer.length > 0x10000) {
      throw this.makeError(
        "INVALID_RANGE",
        `Write would extend past end of memory (0x${address.toString(16)} + ${dataBuffer.length} bytes)`,
        "Reduce data length or use a lower start address"
      );
    }

    // Build request: side_effects(1) + start(2) + memspace(1) + length-1(1) + data(N)
    const body = Buffer.alloc(5 + dataBuffer.length);
    body[0] = 0; // No side effects
    body.writeUInt16LE(address, 1);
    body[3] = memspace;
    body[4] = dataBuffer.length - 1;
    dataBuffer.copy(body, 5);

    await this.sendCommand(Command.MemorySet, body);
  }

  async getRegisters(memspace: MemorySpace = MemorySpace.MainCPU): Promise<ViceResponse> {
    const body = Buffer.alloc(1);
    body[0] = memspace;
    // VICE sends RegisterInfo (0x31) as async event with ReqID=0xff
    return this.sendCommand(Command.RegistersGet, body, ResponseType.RegisterInfo);
  }

  async setRegisters(
    registers: Array<{ id: number; value: number; size: 1 | 2 }>,
    memspace: MemorySpace = MemorySpace.MainCPU
  ): Promise<void> {
    // Build body: memspace(1) + count(2) + [id(1) + size(1) + value(1|2)]...
    let bodySize = 3; // memspace + count
    for (const reg of registers) {
      bodySize += 2 + reg.size; // id + size + value
    }
    const body = Buffer.alloc(bodySize);
    body[0] = memspace;
    body.writeUInt16LE(registers.length, 1);

    let offset = 3;
    for (const reg of registers) {
      body[offset] = reg.id;
      body[offset + 1] = reg.size;
      if (reg.size === 1) {
        body[offset + 2] = reg.value & 0xff;
      } else {
        body.writeUInt16LE(reg.value, offset + 2);
      }
      offset += 2 + reg.size;
    }

    await this.sendCommand(Command.RegistersSet, body);
  }

  async continue(): Promise<void> {
    await this.sendCommand(Command.Continue);
    this.state.running = true;
  }

  async step(count = 1, stepOver = false): Promise<ViceResponse> {
    const body = Buffer.alloc(3);
    body[0] = stepOver ? 1 : 0;
    body.writeUInt16LE(count, 1);
    const response = await this.sendCommand(Command.Step, body);
    this.state.running = false;
    return response;
  }

  async advanceInstructions(count: number, stepOver = false): Promise<ViceResponse> {
    const body = Buffer.alloc(3);
    body[0] = stepOver ? 1 : 0;
    body.writeUInt16LE(count, 1);
    const response = await this.sendCommand(Command.AdvanceInstructions, body);
    return response;
  }

  async reset(hard = false): Promise<void> {
    const body = Buffer.alloc(1);
    body[0] = hard ? 1 : 0;
    await this.sendCommand(Command.Reset, body);
  }

  async setBreakpoint(
    address: number,
    options: {
      enabled?: boolean;
      stop?: boolean;
      temporary?: boolean;
    } = {}
  ): Promise<number> {
    const { enabled = true, stop = true, temporary = false } = options;

    if (address < 0 || address > 0xffff) {
      throw this.makeError(
        "INVALID_ADDRESS",
        `Address 0x${address.toString(16)} is outside C64 memory range`,
        "C64 addresses are 16-bit (0x0000-0xFFFF)"
      );
    }

    // Build request: start(2) + end(2) + stop(1) + enabled(1) + op(1) + temp(1)
    const body = Buffer.alloc(8);
    body.writeUInt16LE(address, 0);
    body.writeUInt16LE(address, 2);
    body[4] = stop ? 1 : 0;
    body[5] = enabled ? 1 : 0;
    body[6] = CheckpointOp.Exec;
    body[7] = temporary ? 1 : 0;

    const response = await this.sendCommand(Command.CheckpointSet, body);
    const id = response.body.readUInt32LE(0);

    // Track locally
    this.checkpoints.set(id, {
      id,
      startAddress: address,
      endAddress: address,
      enabled,
      temporary,
      type: "exec",
    });

    return id;
  }

  async setWatchpoint(
    startAddress: number,
    endAddress: number,
    type: "load" | "store" | "both",
    options: {
      enabled?: boolean;
      stop?: boolean;
      temporary?: boolean;
    } = {}
  ): Promise<number> {
    const { enabled = true, stop = true, temporary = false } = options;

    if (startAddress < 0 || startAddress > 0xffff) {
      throw this.makeError(
        "INVALID_ADDRESS",
        `Start address 0x${startAddress.toString(16)} is outside C64 memory range`,
        "C64 addresses are 16-bit (0x0000-0xFFFF)"
      );
    }
    if (endAddress < 0 || endAddress > 0xffff) {
      throw this.makeError(
        "INVALID_ADDRESS",
        `End address 0x${endAddress.toString(16)} is outside C64 memory range`,
        "C64 addresses are 16-bit (0x0000-0xFFFF)"
      );
    }
    if (startAddress > endAddress) {
      throw this.makeError(
        "INVALID_RANGE",
        `Start address (0x${startAddress.toString(16)}) is greater than end address (0x${endAddress.toString(16)})`,
        "Swap the addresses or check your range"
      );
    }

    // Determine operation type
    let op: number;
    let checkpointType: CheckpointType;
    if (type === "load") {
      op = CheckpointOp.Load;
      checkpointType = "load";
    } else if (type === "store") {
      op = CheckpointOp.Store;
      checkpointType = "store";
    } else {
      op = CheckpointOp.Load | CheckpointOp.Store;
      checkpointType = "load"; // Will track as load for simplicity
    }

    // Build request: start(2) + end(2) + stop(1) + enabled(1) + op(1) + temp(1)
    const body = Buffer.alloc(8);
    body.writeUInt16LE(startAddress, 0);
    body.writeUInt16LE(endAddress, 2);
    body[4] = stop ? 1 : 0;
    body[5] = enabled ? 1 : 0;
    body[6] = op;
    body[7] = temporary ? 1 : 0;

    const response = await this.sendCommand(Command.CheckpointSet, body);
    const id = response.body.readUInt32LE(0);

    // Track locally
    this.checkpoints.set(id, {
      id,
      startAddress,
      endAddress,
      enabled,
      temporary,
      type: checkpointType,
    });

    return id;
  }

  async toggleCheckpoint(checkpointId: number, enabled: boolean): Promise<void> {
    const body = Buffer.alloc(5);
    body.writeUInt32LE(checkpointId, 0);
    body[4] = enabled ? 1 : 0;
    await this.sendCommand(Command.CheckpointToggle, body);

    // Update local tracking
    const cp = this.checkpoints.get(checkpointId);
    if (cp) {
      cp.enabled = enabled;
    }
  }

  async deleteBreakpoint(checkpointId: number): Promise<void> {
    const body = Buffer.alloc(4);
    body.writeUInt32LE(checkpointId, 0);
    await this.sendCommand(Command.CheckpointDelete, body);

    // Remove from local tracking
    this.checkpoints.delete(checkpointId);
  }

  listBreakpoints(): CheckpointInfo[] {
    return Array.from(this.checkpoints.values()).filter((cp) => cp.type === "exec");
  }

  listWatchpoints(): CheckpointInfo[] {
    return Array.from(this.checkpoints.values()).filter((cp) => cp.type !== "exec");
  }

  listCheckpoints(): CheckpointInfo[] {
    return Array.from(this.checkpoints.values());
  }

  // Snapshot methods
  async saveSnapshot(filename: string): Promise<void> {
    const filenameBuffer = Buffer.from(filename, "utf8");
    const body = Buffer.alloc(1 + filenameBuffer.length);
    body[0] = filenameBuffer.length;
    filenameBuffer.copy(body, 1);
    await this.sendCommand(Command.Dump, body);
  }

  async loadSnapshot(filename: string): Promise<void> {
    const filenameBuffer = Buffer.from(filename, "utf8");
    const body = Buffer.alloc(1 + filenameBuffer.length);
    body[0] = filenameBuffer.length;
    filenameBuffer.copy(body, 1);
    await this.sendCommand(Command.Undump, body);
  }

  // Autostart a program
  async autostart(filename: string, fileIndex = 0, runAfterLoad = true): Promise<void> {
    const filenameBuffer = Buffer.from(filename, "utf8");
    // Body: run(1) + index(2) + filename_length(1) + filename
    const body = Buffer.alloc(4 + filenameBuffer.length);
    body[0] = runAfterLoad ? 1 : 0;
    body.writeUInt16LE(fileIndex, 1);
    body[3] = filenameBuffer.length;
    filenameBuffer.copy(body, 4);
    await this.sendCommand(Command.AutoStart, body);
  }

  // Get display buffer (screenshot data)
  async getDisplay(useVicii = true): Promise<{
    width: number;
    height: number;
    bitsPerPixel: number;
    offsetX: number;
    offsetY: number;
    innerWidth: number;
    innerHeight: number;
    pixels: Buffer;
  }> {
    // Body: useVicii(1) + format(1)
    // Format: 0 = indexed 8-bit
    const body = Buffer.alloc(2);
    body[0] = useVicii ? 1 : 0;
    body[1] = 0; // 8-bit indexed

    const response = await this.sendCommand(Command.DisplayGet, body);

    // Parse response
    // Response: length(4) + width(4) + height(4) + bpp(1) + offsetX(4) + offsetY(4) +
    //           innerWidth(4) + innerHeight(4) + pixels...
    const dataLength = response.body.readUInt32LE(0);
    const width = response.body.readUInt32LE(4);
    const height = response.body.readUInt32LE(8);
    const bitsPerPixel = response.body[12];
    const offsetX = response.body.readUInt32LE(13);
    const offsetY = response.body.readUInt32LE(17);
    const innerWidth = response.body.readUInt32LE(21);
    const innerHeight = response.body.readUInt32LE(25);
    const pixels = response.body.subarray(29, 29 + dataLength);

    return {
      width,
      height,
      bitsPerPixel,
      offsetX,
      offsetY,
      innerWidth,
      innerHeight,
      pixels,
    };
  }

  // Get palette (color table)
  async getPalette(): Promise<Array<{ r: number; g: number; b: number }>> {
    const response = await this.sendCommand(Command.PaletteGet);

    // Parse response
    // Response: count(2) + [r(1) + g(1) + b(1)]...
    const count = response.body.readUInt16LE(0);
    const colors: Array<{ r: number; g: number; b: number }> = [];

    for (let i = 0; i < count; i++) {
      const offset = 2 + i * 3;
      colors.push({
        r: response.body[offset],
        g: response.body[offset + 1],
        b: response.body[offset + 2],
      });
    }

    return colors;
  }
}

// Singleton instance
let clientInstance: ViceClient | null = null;

export function getViceClient(): ViceClient {
  if (!clientInstance) {
    clientInstance = new ViceClient();
  }
  return clientInstance;
}
