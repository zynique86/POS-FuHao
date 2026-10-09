// Driver factory — pick a transport by name. The rest of the printer service
// never imports a specific driver file; it just calls createDriver({...}) and
// uses the returned methods.
//
// Adding a transport later (USB, Bluetooth, serial): drop a new file next to
// tcp.js that exports { create(config) } returning the same shape, then add a
// case below. See ./README.md for the contract.

const tcp = require('./tcp');

function createDriver(config) {
  const transport = config && config.transport;
  if (!transport) throw new Error('createDriver: config.transport is required');
  switch (transport) {
    case 'tcp':
      return tcp.create(config);
    // case 'usb':
    //   return require('./usb').create(config);
    // case 'bluetooth':
    //   return require('./bluetooth').create(config);
    default:
      throw new Error(`createDriver: unknown transport "${transport}"`);
  }
}

module.exports = { createDriver };
