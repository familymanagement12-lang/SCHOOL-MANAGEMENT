const CODE39 = {
  '0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw','5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn',
  A:'wnnnnwnnw',B:'nnwnnwnnw',C:'wnwnnwnnn',D:'nnnnwwnnw',E:'wnnnwwnnn',F:'nnwnwwnnn',G:'nnnnnwwnw',H:'wnnnnwwnn',I:'nnwnnwwnn',J:'nnnnwwwnn',
  K:'wnnnnnnww',L:'nnwnnnnww',M:'wnwnnnnwn',N:'nnnnwnnww',O:'wnnnwnnwn',P:'nnwnwnnwn',Q:'nnnnnnwww',R:'wnnnnnwwn',S:'nnwnnnwwn',T:'nnnnwnwwn',
  U:'wwnnnnnnw',V:'nwwnnnnnw',W:'wwwnnnnnn',X:'nwnnwnnnw',Y:'wwnnwnnnn',Z:'nwwnwnnnn','-':'nwnnnnwnw','.':'wwnnnnwnn',' ':'nwwnnnwnn','$':'nwnwnwnnn','/':'nwnwnnnwn','+':'nwnnnwnwn','%':'nnnwnwnwn','*':'nwnnwnwnn'
};
export function code39Svg(rawCode) {
  const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9 .$/+%-]/g, '-').slice(0, 40);
  const full = `*${code}*`;
  let x = 10; const bars = []; const narrow = 2; const wide = 5; const gap = 2;
  for (const char of full) {
    const pattern = CODE39[char] || CODE39['-'];
    for (let i=0;i<pattern.length;i++) {
      const w = pattern[i] === 'w' ? wide : narrow;
      if (i % 2 === 0) bars.push(`<rect x="${x}" y="4" width="${w}" height="54" fill="#111827"/>`);
      x += w;
    }
    x += gap;
  }
  const width = x + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="78" viewBox="0 0 ${width} 78" role="img" aria-label="Barcode ${code}">${bars.join('')}<text x="${width/2}" y="73" font-family="Arial,sans-serif" font-size="12" text-anchor="middle" fill="#111827">${code.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</text></svg>`;
}
export async function printBarcodeLabel(book) {
  const w = window.open('', '_blank', 'width=480,height=300');
  if (!w) return;
  try {
    const { default: QRCode } = await import('qrcode');
    const qrCode = await QRCode.toDataURL(String(book.book_code || ''), {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 180,
    });
    const svg = code39Svg(book.book_code);
    const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
    w.document.write(`<!doctype html><html><head><title>Book label</title><style>body{font:14px Arial,sans-serif;text-align:center;padding:20px;color:#111827}.label{border:1px dashed #94a3b8;padding:16px;display:inline-block}h3{margin:0 0 8px}.qr{display:block;width:130px;height:130px;margin:0 auto 8px}p{margin:6px 0}@media print{button{display:none}.label{border:0}}</style></head><body><div class="label"><h3>${escapeHtml(book.title)}</h3><img class="qr" src="${qrCode}" alt="QR code for ${escapeHtml(book.book_code)}">${svg}<p>${escapeHtml(book.book_code)}</p></div><p><button onclick="window.print()">Print label</button></p></body></html>`);
    w.document.close();
  } catch (error) {
    w.close();
    throw error;
  }
}
