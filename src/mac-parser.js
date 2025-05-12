'use strict';

/**
 * This is a Node18 CommonJS port of the Python manuf MAC‑address manufacturer parser.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

class MacParser {
  constructor(opts = {}) {
    this.manufPath = opts.manufPath ?? path.join(__dirname, 'manuf.gz');
    this._ready = false;
    this._entries = new Map(); // prefixBits → Map(prefixInt → {entry})
    this._sortedLens = []; // descending prefix lengths for lookup

    if (opts.eager) void this.init();
  }

  /*─────────────────────────────── Public API ───────────────────────────────*/

  async init() {
    if (this._ready) return;
    await this._ensureManufFile();
    this._parseManuf();
    this._ready = true;
  }

  async reinitialize() {
    await this._ensureManufFile();
    this._parseManuf();
    this._ready = true;
  }

  /**
   * Lookup a MAC/OUI.
   *
   * @param  {string} mac – e.g. "44:38:39:FF:EF:57" (any separators)
   * @return {Promise<{prefix:string,vendor:string,comment:string}|null>}
   */
  async lookup(mac) {
    await this.init();

    const compact = mac.replace(/[-:.]/g, '').toUpperCase();
    if (!/^[0-9A-F]{6,12}$/.test(compact)) return null;

    const macInt = BigInt('0x' + compact);

    for (const bits of this._sortedLens) {
      const key = macInt >> BigInt(48 - bits);
      const hit = this._entries.get(bits)?.get(key);
      if (hit) return hit;
    }
    return null;
  }

  static async getVendor(mac, opts = {}) {
    if (!this._singleton) this._singleton = new MacParser(opts);
    return (await this._singleton.lookup(mac))?.vendor ?? null;
  }

  async _ensureManufFile() {
    await fs.promises.access(this.manufPath, fs.constants.R_OK);
  }

  /**
   * Build in‑memory prefix maps. Handles arbitrary netmasks.
   * Stores only the *significant* prefix bits as the key so comparisons work.
   */
  _parseManuf() {
    const gz = fs.readFileSync(this.manufPath);
    const text = zlib.gunzipSync(gz).toString('utf8');

    const byBits = new Map();

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      // Prefer TAB, fall back to any whitespace
      const parts = line.includes('\t') ? line.split('\t') : line.split(/\s+/);
      if (parts.length < 2) continue; // malformed

      const prefixToken = parts[0].trim();
      const vendor = parts[1].trim();
      const comment = parts
        .slice(2)
        .join(parts.includes('\t') ? '\t' : ' ')
        .trim();

      const [hexPart, cidrPart] = prefixToken.split('/');
      const compactHex = hexPart.replace(/[-:.]/g, '').toUpperCase();

      const prefixBits = cidrPart ? parseInt(cidrPart, 10) : compactHex.length * 4; // default if /xx omitted

      // Convert hex to int, then drop lower (48‑prefixBits) bits if present.
      const rawInt = BigInt('0x' + (compactHex || '0'));
      const bitsInHex = compactHex.length * 4;
      let prefixInt = rawInt;

      if (bitsInHex > prefixBits) {
        prefixInt >>= BigInt(bitsInHex - prefixBits);
      } else if (bitsInHex < prefixBits) {
        // Hex shorter than mask (rare) – pad left (shift left) accordingly.
        prefixInt <<= BigInt(prefixBits - bitsInHex);
      }

      const entry = { prefix: prefixToken, vendor, comment };

      if (!byBits.has(prefixBits)) byBits.set(prefixBits, new Map());
      byBits.get(prefixBits).set(prefixInt, entry);
    }

    this._entries = byBits;
    this._sortedLens = [...byBits.keys()].sort((a, b) => b - a);
  }
}

module.exports = { MacParser };
