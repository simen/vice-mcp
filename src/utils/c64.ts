// C64 Constants and Utilities

// Color palette names
export const C64_COLORS = [
  "black",
  "white",
  "red",
  "cyan",
  "purple",
  "green",
  "blue",
  "yellow",
  "orange",
  "brown",
  "light red",
  "dark gray",
  "gray",
  "light green",
  "light blue",
  "light gray",
] as const;

export type C64Color = (typeof C64_COLORS)[number];

export function getColorName(value: number): C64Color {
  return C64_COLORS[value & 0x0f];
}

export function getColorInfo(value: number): { value: number; name: C64Color } {
  return {
    value: value & 0x0f,
    name: getColorName(value),
  };
}

// PETSCII to ASCII conversion (screen codes, not PETSCII character codes)
// Screen codes are different from PETSCII - this handles the screen memory values
export function screenCodeToAscii(code: number): string {
  // Screen codes 0-31: @, A-Z, [, £, ], ↑, ←
  if (code <= 31) {
    if (code === 0) return "@";
    if (code <= 26) return String.fromCharCode(64 + code); // A-Z
    if (code === 27) return "[";
    if (code === 28) return "£";
    if (code === 29) return "]";
    if (code === 30) return "^"; // up arrow
    if (code === 31) return "<"; // left arrow
  }

  // 32-63: space, !, ", #, $, %, &, ', (, ), *, +, ,, -, ., /, 0-9, :, ;, <, =, >, ?
  if (code >= 32 && code <= 63) {
    return String.fromCharCode(code);
  }

  // 64-95: horizontal line, graphics chars - use placeholders
  if (code >= 64 && code <= 95) {
    return "#"; // graphics placeholder
  }

  // 96-127: more graphics
  if (code >= 96 && code <= 127) {
    return "#"; // graphics placeholder
  }

  // 128-255: reverse video versions of 0-127
  if (code >= 128) {
    // Just show the base character (non-reversed)
    return screenCodeToAscii(code - 128);
  }

  return "?";
}

// Convert screen RAM to text lines
export function screenToText(screenData: Buffer | number[]): string[] {
  const data = Buffer.isBuffer(screenData) ? screenData : Buffer.from(screenData);
  const lines: string[] = [];

  for (let row = 0; row < 25; row++) {
    const offset = row * 40;
    let line = "";
    for (let col = 0; col < 40; col++) {
      if (offset + col < data.length) {
        line += screenCodeToAscii(data[offset + col]);
      }
    }
    // Trim trailing spaces but keep the line
    lines.push(line.trimEnd());
  }

  return lines;
}

// VIC-II memory bank calculation
export function getVicBank(cia2PortA: number): { bank: number; baseAddress: number } {
  // CIA2 port A bits 0-1 (inverted) select the bank
  const bankBits = (~cia2PortA) & 0x03;
  return {
    bank: bankBits,
    baseAddress: bankBits * 0x4000,
  };
}

// Screen and character base from $D018
export function getVideoAddresses(
  d018: number,
  bankBase: number
): { screenAddress: number; charAddress: number } {
  const screenOffset = ((d018 >> 4) & 0x0f) * 0x0400;
  const charOffset = ((d018 >> 1) & 0x07) * 0x0800;

  return {
    screenAddress: bankBase + screenOffset,
    charAddress: bankBase + charOffset,
  };
}

// Graphics mode from D011 and D016
export function getGraphicsMode(d011: number, d016: number): {
  mode: string;
  bitmap: boolean;
  multicolor: boolean;
  extendedColor: boolean;
} {
  const ecm = !!(d011 & 0x40);
  const bmm = !!(d011 & 0x20);
  const mcm = !!(d016 & 0x10);

  let mode = "standard text";
  if (ecm && !bmm && !mcm) mode = "extended background color";
  else if (!ecm && !bmm && mcm) mode = "multicolor text";
  else if (!ecm && bmm && !mcm) mode = "standard bitmap";
  else if (!ecm && bmm && mcm) mode = "multicolor bitmap";
  else if (ecm) mode = "invalid (ECM + other modes)";

  return {
    mode,
    bitmap: bmm,
    multicolor: mcm,
    extendedColor: ecm,
  };
}

// Sprite position visible range helpers
export const SPRITE_VISIBLE_X_MIN = 24;
export const SPRITE_VISIBLE_X_MAX = 343;
export const SPRITE_VISIBLE_Y_MIN = 50;
export const SPRITE_VISIBLE_Y_MAX = 249;

export function isSpriteVisible(x: number, y: number, enabled: boolean): {
  visible: boolean;
  reason?: string;
} {
  if (!enabled) {
    return { visible: false, reason: "Sprite is disabled ($D015)" };
  }
  if (x < SPRITE_VISIBLE_X_MIN || x > SPRITE_VISIBLE_X_MAX) {
    return { visible: false, reason: `X position ${x} is outside visible range (${SPRITE_VISIBLE_X_MIN}-${SPRITE_VISIBLE_X_MAX})` };
  }
  if (y < SPRITE_VISIBLE_Y_MIN || y > SPRITE_VISIBLE_Y_MAX) {
    return { visible: false, reason: `Y position ${y} is outside visible range (${SPRITE_VISIBLE_Y_MIN}-${SPRITE_VISIBLE_Y_MAX})` };
  }
  return { visible: true };
}

// Memory region descriptions
export function describeAddress(address: number): string {
  if (address < 0x0100) return "Zero page";
  if (address < 0x0200) return "Stack";
  if (address >= 0x0400 && address < 0x0800) return "Default screen RAM";
  if (address >= 0x0800 && address < 0x1000) return "Default char ROM shadow";
  if (address >= 0xa000 && address < 0xc000) return "BASIC ROM / RAM";
  if (address >= 0xd000 && address < 0xd400) return "VIC-II registers";
  if (address >= 0xd400 && address < 0xd800) return "SID registers";
  if (address >= 0xd800 && address < 0xdc00) return "Color RAM";
  if (address >= 0xdc00 && address < 0xdd00) return "CIA1 registers";
  if (address >= 0xdd00 && address < 0xde00) return "CIA2 registers";
  if (address >= 0xe000) return "KERNAL ROM / RAM";
  return "";
}
