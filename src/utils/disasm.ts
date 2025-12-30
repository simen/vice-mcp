// 6502 Disassembler

// Opcode table: [mnemonic, addressing mode, bytes]
type AddressingMode =
  | "impl" // Implied
  | "acc" // Accumulator
  | "imm" // Immediate #$xx
  | "zp" // Zero Page $xx
  | "zpx" // Zero Page,X $xx,X
  | "zpy" // Zero Page,Y $xx,Y
  | "abs" // Absolute $xxxx
  | "abx" // Absolute,X $xxxx,X
  | "aby" // Absolute,Y $xxxx,Y
  | "ind" // Indirect ($xxxx)
  | "izx" // Indexed Indirect ($xx,X)
  | "izy" // Indirect Indexed ($xx),Y
  | "rel"; // Relative (branches)

type OpcodeEntry = [string, AddressingMode, number];

// 6502 instruction table
const OPCODES: Record<number, OpcodeEntry> = {
  // ADC
  0x69: ["ADC", "imm", 2],
  0x65: ["ADC", "zp", 2],
  0x75: ["ADC", "zpx", 2],
  0x6d: ["ADC", "abs", 3],
  0x7d: ["ADC", "abx", 3],
  0x79: ["ADC", "aby", 3],
  0x61: ["ADC", "izx", 2],
  0x71: ["ADC", "izy", 2],

  // AND
  0x29: ["AND", "imm", 2],
  0x25: ["AND", "zp", 2],
  0x35: ["AND", "zpx", 2],
  0x2d: ["AND", "abs", 3],
  0x3d: ["AND", "abx", 3],
  0x39: ["AND", "aby", 3],
  0x21: ["AND", "izx", 2],
  0x31: ["AND", "izy", 2],

  // ASL
  0x0a: ["ASL", "acc", 1],
  0x06: ["ASL", "zp", 2],
  0x16: ["ASL", "zpx", 2],
  0x0e: ["ASL", "abs", 3],
  0x1e: ["ASL", "abx", 3],

  // Branches
  0x90: ["BCC", "rel", 2],
  0xb0: ["BCS", "rel", 2],
  0xf0: ["BEQ", "rel", 2],
  0x30: ["BMI", "rel", 2],
  0xd0: ["BNE", "rel", 2],
  0x10: ["BPL", "rel", 2],
  0x50: ["BVC", "rel", 2],
  0x70: ["BVS", "rel", 2],

  // BIT
  0x24: ["BIT", "zp", 2],
  0x2c: ["BIT", "abs", 3],

  // BRK
  0x00: ["BRK", "impl", 1],

  // Clear flags
  0x18: ["CLC", "impl", 1],
  0xd8: ["CLD", "impl", 1],
  0x58: ["CLI", "impl", 1],
  0xb8: ["CLV", "impl", 1],

  // CMP
  0xc9: ["CMP", "imm", 2],
  0xc5: ["CMP", "zp", 2],
  0xd5: ["CMP", "zpx", 2],
  0xcd: ["CMP", "abs", 3],
  0xdd: ["CMP", "abx", 3],
  0xd9: ["CMP", "aby", 3],
  0xc1: ["CMP", "izx", 2],
  0xd1: ["CMP", "izy", 2],

  // CPX
  0xe0: ["CPX", "imm", 2],
  0xe4: ["CPX", "zp", 2],
  0xec: ["CPX", "abs", 3],

  // CPY
  0xc0: ["CPY", "imm", 2],
  0xc4: ["CPY", "zp", 2],
  0xcc: ["CPY", "abs", 3],

  // DEC
  0xc6: ["DEC", "zp", 2],
  0xd6: ["DEC", "zpx", 2],
  0xce: ["DEC", "abs", 3],
  0xde: ["DEC", "abx", 3],

  // DEX, DEY
  0xca: ["DEX", "impl", 1],
  0x88: ["DEY", "impl", 1],

  // EOR
  0x49: ["EOR", "imm", 2],
  0x45: ["EOR", "zp", 2],
  0x55: ["EOR", "zpx", 2],
  0x4d: ["EOR", "abs", 3],
  0x5d: ["EOR", "abx", 3],
  0x59: ["EOR", "aby", 3],
  0x41: ["EOR", "izx", 2],
  0x51: ["EOR", "izy", 2],

  // INC
  0xe6: ["INC", "zp", 2],
  0xf6: ["INC", "zpx", 2],
  0xee: ["INC", "abs", 3],
  0xfe: ["INC", "abx", 3],

  // INX, INY
  0xe8: ["INX", "impl", 1],
  0xc8: ["INY", "impl", 1],

  // JMP
  0x4c: ["JMP", "abs", 3],
  0x6c: ["JMP", "ind", 3],

  // JSR
  0x20: ["JSR", "abs", 3],

  // LDA
  0xa9: ["LDA", "imm", 2],
  0xa5: ["LDA", "zp", 2],
  0xb5: ["LDA", "zpx", 2],
  0xad: ["LDA", "abs", 3],
  0xbd: ["LDA", "abx", 3],
  0xb9: ["LDA", "aby", 3],
  0xa1: ["LDA", "izx", 2],
  0xb1: ["LDA", "izy", 2],

  // LDX
  0xa2: ["LDX", "imm", 2],
  0xa6: ["LDX", "zp", 2],
  0xb6: ["LDX", "zpy", 2],
  0xae: ["LDX", "abs", 3],
  0xbe: ["LDX", "aby", 3],

  // LDY
  0xa0: ["LDY", "imm", 2],
  0xa4: ["LDY", "zp", 2],
  0xb4: ["LDY", "zpx", 2],
  0xac: ["LDY", "abs", 3],
  0xbc: ["LDY", "abx", 3],

  // LSR
  0x4a: ["LSR", "acc", 1],
  0x46: ["LSR", "zp", 2],
  0x56: ["LSR", "zpx", 2],
  0x4e: ["LSR", "abs", 3],
  0x5e: ["LSR", "abx", 3],

  // NOP
  0xea: ["NOP", "impl", 1],

  // ORA
  0x09: ["ORA", "imm", 2],
  0x05: ["ORA", "zp", 2],
  0x15: ["ORA", "zpx", 2],
  0x0d: ["ORA", "abs", 3],
  0x1d: ["ORA", "abx", 3],
  0x19: ["ORA", "aby", 3],
  0x01: ["ORA", "izx", 2],
  0x11: ["ORA", "izy", 2],

  // Stack
  0x48: ["PHA", "impl", 1],
  0x08: ["PHP", "impl", 1],
  0x68: ["PLA", "impl", 1],
  0x28: ["PLP", "impl", 1],

  // ROL
  0x2a: ["ROL", "acc", 1],
  0x26: ["ROL", "zp", 2],
  0x36: ["ROL", "zpx", 2],
  0x2e: ["ROL", "abs", 3],
  0x3e: ["ROL", "abx", 3],

  // ROR
  0x6a: ["ROR", "acc", 1],
  0x66: ["ROR", "zp", 2],
  0x76: ["ROR", "zpx", 2],
  0x6e: ["ROR", "abs", 3],
  0x7e: ["ROR", "abx", 3],

  // RTI, RTS
  0x40: ["RTI", "impl", 1],
  0x60: ["RTS", "impl", 1],

  // SBC
  0xe9: ["SBC", "imm", 2],
  0xe5: ["SBC", "zp", 2],
  0xf5: ["SBC", "zpx", 2],
  0xed: ["SBC", "abs", 3],
  0xfd: ["SBC", "abx", 3],
  0xf9: ["SBC", "aby", 3],
  0xe1: ["SBC", "izx", 2],
  0xf1: ["SBC", "izy", 2],

  // Set flags
  0x38: ["SEC", "impl", 1],
  0xf8: ["SED", "impl", 1],
  0x78: ["SEI", "impl", 1],

  // STA
  0x85: ["STA", "zp", 2],
  0x95: ["STA", "zpx", 2],
  0x8d: ["STA", "abs", 3],
  0x9d: ["STA", "abx", 3],
  0x99: ["STA", "aby", 3],
  0x81: ["STA", "izx", 2],
  0x91: ["STA", "izy", 2],

  // STX
  0x86: ["STX", "zp", 2],
  0x96: ["STX", "zpy", 2],
  0x8e: ["STX", "abs", 3],

  // STY
  0x84: ["STY", "zp", 2],
  0x94: ["STY", "zpx", 2],
  0x8c: ["STY", "abs", 3],

  // Transfers
  0xaa: ["TAX", "impl", 1],
  0xa8: ["TAY", "impl", 1],
  0xba: ["TSX", "impl", 1],
  0x8a: ["TXA", "impl", 1],
  0x9a: ["TXS", "impl", 1],
  0x98: ["TYA", "impl", 1],
};

export interface DisassembledInstruction {
  address: number;
  addressHex: string;
  bytes: number[];
  bytesHex: string;
  mnemonic: string;
  operand: string;
  fullInstruction: string;
  size: number;
  // For branches: the target address
  branchTarget?: number;
  branchTargetHex?: string;
}

export function disassemble(
  data: Buffer | number[],
  startAddress: number,
  count?: number
): DisassembledInstruction[] {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const result: DisassembledInstruction[] = [];
  let offset = 0;
  let instructionCount = 0;

  while (offset < bytes.length) {
    if (count !== undefined && instructionCount >= count) break;

    const address = startAddress + offset;
    const opcode = bytes[offset];
    const entry = OPCODES[opcode];

    if (!entry) {
      // Unknown opcode - treat as single byte data
      result.push({
        address,
        addressHex: `$${address.toString(16).padStart(4, "0")}`,
        bytes: [opcode],
        bytesHex: opcode.toString(16).padStart(2, "0"),
        mnemonic: "???",
        operand: `$${opcode.toString(16).padStart(2, "0")}`,
        fullInstruction: `??? $${opcode.toString(16).padStart(2, "0")}`,
        size: 1,
      });
      offset++;
      instructionCount++;
      continue;
    }

    const [mnemonic, mode, size] = entry;

    // Check if we have enough bytes
    if (offset + size > bytes.length) break;

    const instrBytes: number[] = [];
    for (let i = 0; i < size; i++) {
      instrBytes.push(bytes[offset + i]);
    }

    const bytesHex = instrBytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
    let operand = "";
    let branchTarget: number | undefined;
    let branchTargetHex: string | undefined;

    switch (mode) {
      case "impl":
        operand = "";
        break;
      case "acc":
        operand = "A";
        break;
      case "imm":
        operand = `#$${bytes[offset + 1].toString(16).padStart(2, "0")}`;
        break;
      case "zp":
        operand = `$${bytes[offset + 1].toString(16).padStart(2, "0")}`;
        break;
      case "zpx":
        operand = `$${bytes[offset + 1].toString(16).padStart(2, "0")},X`;
        break;
      case "zpy":
        operand = `$${bytes[offset + 1].toString(16).padStart(2, "0")},Y`;
        break;
      case "abs":
        operand = `$${(bytes[offset + 1] | (bytes[offset + 2] << 8)).toString(16).padStart(4, "0")}`;
        break;
      case "abx":
        operand = `$${(bytes[offset + 1] | (bytes[offset + 2] << 8)).toString(16).padStart(4, "0")},X`;
        break;
      case "aby":
        operand = `$${(bytes[offset + 1] | (bytes[offset + 2] << 8)).toString(16).padStart(4, "0")},Y`;
        break;
      case "ind":
        operand = `($${(bytes[offset + 1] | (bytes[offset + 2] << 8)).toString(16).padStart(4, "0")})`;
        break;
      case "izx":
        operand = `($${bytes[offset + 1].toString(16).padStart(2, "0")},X)`;
        break;
      case "izy":
        operand = `($${bytes[offset + 1].toString(16).padStart(2, "0")}),Y`;
        break;
      case "rel": {
        // Relative branch - calculate target address
        const displacement = bytes[offset + 1];
        // Convert to signed
        const signed = displacement > 127 ? displacement - 256 : displacement;
        branchTarget = (address + 2 + signed) & 0xffff;
        branchTargetHex = `$${branchTarget.toString(16).padStart(4, "0")}`;
        operand = branchTargetHex;
        break;
      }
    }

    const fullInstruction = operand ? `${mnemonic} ${operand}` : mnemonic;

    result.push({
      address,
      addressHex: `$${address.toString(16).padStart(4, "0")}`,
      bytes: instrBytes,
      bytesHex,
      mnemonic,
      operand,
      fullInstruction,
      size,
      branchTarget,
      branchTargetHex,
    });

    offset += size;
    instructionCount++;
  }

  return result;
}

// Common C64 KERNAL/BASIC entry points for label hints
export const KERNAL_LABELS: Record<number, string> = {
  0xffd2: "CHROUT",
  0xffe4: "GETIN",
  0xffcf: "CHRIN",
  0xffc0: "OPEN",
  0xffc3: "CLOSE",
  0xffc6: "CHKIN",
  0xffc9: "CHKOUT",
  0xffcc: "CLRCHN",
  0xffd5: "LOAD",
  0xffd8: "SAVE",
  0xe544: "CLRSCR",
  0xa871: "CHRGET",
  0xbdcd: "FLTASC",
  0xb7f7: "FMULT",
  0xb850: "FDIV",
  0xb867: "MOVFM",
  0xbba2: "GIVAYF",
};

export function getLabelForAddress(address: number): string | undefined {
  return KERNAL_LABELS[address];
}
