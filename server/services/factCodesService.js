import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Fact codes decoding table.
 *
 * ScoreBoards[].IdResultType is the IDFactCode of the scoreboard row written by the snapshot
 * producer (IdResultType = scoreboardRow.IDFactCode). The decoding table is exported from the
 * Phoenix DB into config/fact-codes.csv:
 *
 *   IDFactCode;Description;DefaultValue;Flag1;Flag2      (no header row, ';' separated, UTF-8 BOM, CRLF)
 *
 * The file is re-read when it changes on disk, so it can be updated without restarting the app.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '../../config/fact-codes.csv');

let cache = null; // { mtimeMs, codes }

/** Split a ';' separated line, honouring "quoted" fields ("" = escaped quote) */
function splitCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ';') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseCsv(text) {
  const codes = {};
  text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (!line.trim()) return;
      const [id, description = '', defaultValue = '', flag1 = '', flag2 = ''] = splitCsvLine(line);
      const code = parseInt(id, 10);
      if (isNaN(code)) {
        console.warn(`fact-codes.csv line ${index + 1} skipped: invalid IDFactCode "${id}"`);
        return;
      }
      codes[code] = {
        description: description.trim(),
        defaultValue: defaultValue.trim(),
        flag1: flag1.trim() === '1',
        flag2: flag2.trim() === '1'
      };
    });
  return codes;
}

/**
 * @returns {Object} { [IDFactCode]: { description, defaultValue, flag1, flag2 } }
 */
export function getFactCodes() {
  const { mtimeMs } = fs.statSync(CSV_PATH);
  if (!cache || cache.mtimeMs !== mtimeMs) {
    const codes = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
    cache = { mtimeMs, codes };
    console.log(`✓ Fact codes loaded: ${Object.keys(codes).length} codes from ${CSV_PATH}`);
  }
  return cache.codes;
}
