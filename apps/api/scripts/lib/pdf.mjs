/**
 * Minimal single-page PDF writer used only to generate demonstration
 * receipts for the seed dataset. Real receipts come from the employee's
 * camera and are stored through the normal upload pipeline.
 */
const esc = (s) => String(s).replace(/([\\()])/g, '\\$1');

export function receiptPdf({ vendor, lines, total, date, invoiceNo, footer }) {
  const body = [];
  let y = 780;
  const text = (t, size, bold) => {
    body.push(`BT /F${bold ? 2 : 1} ${size} Tf 60 ${y} Td (${esc(t)}) Tj ET`);
    y -= size + 8;
  };
  text(vendor, 18, true);
  text(`Invoice: ${invoiceNo}          Date: ${date}`, 11, false);
  y -= 6;
  body.push(`60 ${y} m 535 ${y} l S`); y -= 18;
  for (const l of lines) text(l, 11, false);
  y -= 6;
  body.push(`60 ${y} m 535 ${y} l S`); y -= 20;
  text(`TOTAL   INR ${Number(total).toFixed(2)}`, 14, true);
  y -= 10;
  if (footer) text(footer, 9, false);

  const content = body.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
