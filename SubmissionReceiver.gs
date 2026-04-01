// ═══════════════════════════════════════════════════════════════
//  Dallas ISD — Math Worksheet Submission Receiver
//  Paste this entire script into Google Apps Script
//  (Extensions → Apps Script inside your Google Sheet)
//  Then click Deploy → New Deployment → Web App
//    - Execute as: Me
//    - Who has access: Anyone
//  Copy the Web App URL and paste it into both HTML files
// ═══════════════════════════════════════════════════════════════

const SHEET_NAME = "Submissions";

function doPost(e) {
  try {
    const ss     = SpreadsheetApp.getActiveSpreadsheet();
    let   sheet  = ss.getSheetByName(SHEET_NAME);

    // Create the sheet and header row if it doesn't exist yet
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(buildHeaders());
      formatHeaders(sheet);
    }

    // Parse the incoming JSON from the HTML page
    const data = JSON.parse(e.postData.contents);

    // Build and append the row
    sheet.appendRow(buildRow(data));

    // Return success so the student sees a confirmation
    return ContentService
      .createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Allow preflight CORS requests from the browser
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Column headers ──────────────────────────────────────────────
function buildHeaders() {
  return [
    "Timestamp",
    "Worksheet",
    "Student Name",
    "Student ID",
    "Period",
    "Seed Code",

    // Unit 8 Exam Review answers (Q1–Q13)
    "Q1 — Domain",
    "Q2 — Graph description",
    "Q3 — Transformation description",
    "Q4 — Graph description",
    "Q5 — Range",
    "Q6 — Domain",
    "Q6 — Range",
    "Q7 — Simplify",
    "Q8 — Simplify",
    "Q9 — Simplify",
    "Q10 — Simplify",
    "Q11 — Vertical asymptote(s)",
    "Q11 — Horizontal asymptote",
    "Q12 — Vertical asymptote",
    "Q12 — Horizontal asymptote",
    "Q13 — Zeros",

    // Chapter 8 Exam Review answers
    "Ch8 Q1a — Simplify",
    "Ch8 Q1b — Simplify",
    "Ch8 Q1c — Simplify",
    "Ch8 Q2a — Simplify",
    "Ch8 Q2b — Simplify",
    "Ch8 Q3a — Domain",
    "Ch8 Q3b — Range",
    "Ch8 Q3c — Asymptotes",
    "Ch8 Q3d — a value",
    "Ch8 Q3e — b value",
    "Ch8 Q3f — h value",
    "Ch8 Q3g — k value",
    "Ch8 Q3 — Transformations",
    "Ch8 Q4a — Domain",
    "Ch8 Q4b — Range",
    "Ch8 Q4c — Asymptotes",
    "Ch8 Q5a — Asymptotes/Holes",
    "Ch8 Q5b — Asymptotes/Holes",
    "Ch8 Q5c — Asymptotes/Holes",
    "Ch8 Q6 — Direct Variation",
    "Ch8 Bonus — Solve",
  ];
}

// ── Map incoming data to row ────────────────────────────────────
function buildRow(d) {
  const ts = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
  const a  = d.answers || {};

  return [
    ts,
    d.worksheet     || "",
    d.studentName   || "",
    d.studentId     || "",
    d.period        || "",
    d.seedCode      || "N/A",

    // Unit 8
    a.q1            || "",
    a.q2            || "",
    a.q3            || "",
    a.q4            || "",
    a.q5            || "",
    a.q6domain      || "",
    a.q6range       || "",
    a.q7            || "",
    a.q8            || "",
    a.q9            || "",
    a.q10           || "",
    a.q11va         || "",
    a.q11ha         || "",
    a.q12va         || "",
    a.q12ha         || "",
    a.q13           || "",

    // Chapter 8
    a.ch8_q1a       || "",
    a.ch8_q1b       || "",
    a.ch8_q1c       || "",
    a.ch8_q2a       || "",
    a.ch8_q2b       || "",
    a.ch8_q3domain  || "",
    a.ch8_q3range   || "",
    a.ch8_q3asymp   || "",
    a.ch8_q3a_val   || "",
    a.ch8_q3b_val   || "",
    a.ch8_q3h_val   || "",
    a.ch8_q3k_val   || "",
    a.ch8_q3trans   || "",
    a.ch8_q4domain  || "",
    a.ch8_q4range   || "",
    a.ch8_q4asymp   || "",
    a.ch8_q5a       || "",
    a.ch8_q5b       || "",
    a.ch8_q5c       || "",
    a.ch8_q6        || "",
    a.ch8_bonus     || "",
  ];
}

// ── Format the header row ───────────────────────────────────────
function formatHeaders(sheet) {
  const header = sheet.getRange(1, 1, 1, buildHeaders().length);
  header.setBackground("#1a4a8a");
  header.setFontColor("#ffffff");
  header.setFontWeight("bold");
  header.setFontSize(10);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(4);

  // Auto-resize all columns
  sheet.autoResizeColumns(1, buildHeaders().length);
}
