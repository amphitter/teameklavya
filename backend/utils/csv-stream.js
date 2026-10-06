/**
 * Streaming CSV writer (Part 5, Phase 3 — spec §40, §41, §62)
 * ────────────────────────────────────────────────────────────
 * P0 fix. The old export did:
 *     const responses = await RegistrationResponse.find({eventId})  // ALL rows
 *     const csv = new Parser().parse(jsonData)                      // ALL text
 *     res.send(csv)                                                 // one buffer
 *
 * Peak memory scaled linearly with event size — a 10,000-person event held
 * 10,000 populated documents AND the full CSV string in RAM at once, in a
 * process that also serves every other request. That is how a single export
 * takes down a free-tier container.
 *
 * This writer streams: it pulls bounded batches from an async generator and
 * writes each batch to the socket as it arrives, so peak memory is one batch
 * regardless of whether the event has 10 or 10,000 registrations.
 *
 * Also hardens two things the old export ignored:
 *   • CSV FORMULA INJECTION — a value beginning with = + - @ is executed as a
 *     formula by Excel/Sheets. We prefix a quote to neutralise it (§62).
 *   • UTF-8 BOM — so Excel renders non-ASCII names correctly.
 */

/** Escape one cell: quote when needed, and defuse spreadsheet formulas. */
function csvCell(value) {
  if (value === null || value === undefined) return "";

  let s;
  if (typeof value === "boolean") s = value ? "Yes" : "No";
  else if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);

  // §62 — a leading =, +, -, @ or tab/CR makes Excel treat the cell as code.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;

  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build one CSV line from an array of cell values. */
function csvRow(cells) {
  return `${cells.map(csvCell).join(",")}\r\n`;
}

/**
 * Stream a CSV straight to an Express response.
 *
 * @param {object} res                 Express response
 * @param {object} opts
 * @param {string} opts.filename       attachment filename
 * @param {string[]} opts.header       column titles (fixed order)
 * @param {AsyncGenerator<Array>} opts.iterate  bounded row batches
 * @param {(row:any) => any[]} opts.toRow       map a row to header-ordered cells
 * @returns {Promise<number>} rows written
 */
async function streamCsv(res, { filename, header, iterate, toRow }) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // Exports contain personal data — never let a shared cache keep them (§47).
  res.setHeader("Cache-Control", "private, no-store");

  res.write("﻿"); // UTF-8 BOM — Excel needs it to read UTF-8 correctly
  res.write(csvRow(header));

  let written = 0;
  for await (const batch of iterate) {
    let chunk = "";
    for (const row of batch) {
      chunk += csvRow(toRow(row));
      written += 1;
    }
    if (chunk) res.write(chunk);
  }

  res.end();
  return written;
}

module.exports = { csvCell, csvRow, streamCsv };
