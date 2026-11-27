// Printer test slip — printed when staff press "Test printers" in the POS.
// Short on purpose: it proves the printer is reachable, has paper and cuts,
// and says which station/IP it came from so a slip that lands on the wrong
// printer is obvious.
//
// Entry shapes: see receipt.js.

const { WIDTH, DEFAULT_TZ, twoCol, centre, fmtDate, fmtTime } = require('./format');

function build(data) {
  const {
    stationLabel = 'PRINTER',
    ip = '',
    by,
    tz = DEFAULT_TZ,
    now = new Date(),
  } = data || {};

  return [
    { rule: '=' },
    { text: centre('*** PRINTER TEST ***', WIDTH), bold: true },
    { rule: '=' },
    twoCol(`STATION: ${String(stationLabel).toUpperCase()}`, `IP: ${ip || '-'}`, WIDTH),
    twoCol(`DATE: ${fmtDate(now, tz)}`, `TIME: ${fmtTime(now, tz)}`, WIDTH),
    ...(by ? [`BY: ${by}`] : []),
    { rule: '-' },
    centre('If you can read this,', WIDTH),
    centre('this printer is working.', WIDTH),
    { rule: '=' },
    { feed: 3 },
    { cut: true },
  ];
}

module.exports = { build };
