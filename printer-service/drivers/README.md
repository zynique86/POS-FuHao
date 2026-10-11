# Printer drivers

The printer service talks to each physical printer through a **driver** — a
small object with a fixed set of methods. The service builds plain data
objects (ticket, receipt, void, refund, restock, order summary) and hands
them to the driver; the driver knows how to turn that into ESC/POS over its
transport.

Today only one transport exists (`tcp` via `node-thermal-printer`). To swap
in a USB or Bluetooth printer later, write a sibling file exporting the same
shape and register it in `index.js`.

## Factory

```js
const { createDriver } = require('./drivers');
const driver = createDriver({ transport: 'tcp', ip, station, width: 42 });
```

`createDriver(config)` picks a transport by `config.transport` and returns a
driver instance. Everything else in `config` is passed through to the chosen
driver.

## Driver contract

A driver returned by `create(config)` MUST expose these async methods:

| Method | Argument shape (plain object) |
|---|---|
| `printOrderSummary(summary)` | `{ shopName, shopNameZh, tableNumber, orderId, when, takenByName, items }` |
| `printVoid(ticket)` | `{ time, orderId, qty, name, nameZh, reason }` |
| `printRefund(ticket)` | `{ when, orderId, amount, method, reason, by }` |
| `printLayout(entries, label)` | plays an entry array (see `layouts/receipt.js`) against the printer — used for kitchen/bar/restock tickets and receipts |
| `openDrawer()` | — |
| `status()` | returns `{ ok, station, ip?, reason? }` |

A driver should swallow transient network errors and log a readable fallback
when its hardware isn't configured, so one offline station never blocks the
job queue.

## Adding a transport

1. Create `drivers/usb.js` (or `bluetooth.js`, `serial.js`, …) exporting
   `create(config)` that returns the shape above.
2. Add a `case 'usb':` branch in `drivers/index.js`.
3. The service passes `transport: 'usb'` through its own config (env var or
   per-station setting) and nothing else changes.

Keep each transport's hardware-specific dependency (serialport, usb,
node-bluetooth, …) inside its own file so the TCP build stays slim.
