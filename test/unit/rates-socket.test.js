'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { RatesSocket } = require('../../public/js/rates-socket');

test('RatesSocket limita la cola saliente y conserva los mensajes más recientes', () => {
  const previous = global.WebSocket;
  global.WebSocket = { OPEN: 1, CONNECTING: 0 };
  try {
    const client = new RatesSocket({
      urlFactory: () => 'ws://localhost/tasas-ws',
      onMessage: () => {},
      maxQueue: 2,
    });
    assert.equal(client.send({ sequence: 1 }), false);
    client.send({ sequence: 2 });
    client.send({ sequence: 3 });
    assert.deepEqual(client.queue.map(JSON.parse), [{ sequence: 2 }, { sequence: 3 }]);
    client.stop();
    assert.equal(client.queue.length, 0);
    assert.equal(client.stopped, true);
  } finally {
    global.WebSocket = previous;
  }
});
