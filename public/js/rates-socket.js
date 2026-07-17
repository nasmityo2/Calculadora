(function initRatesSocket(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DayzoRatesSocket = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createRatesSocketModule() {
  'use strict';

  class RatesSocket {
    constructor({
      urlFactory,
      onMessage,
      onStatus = () => {},
      baseDelayMs = 1000,
      maxDelayMs = 30_000,
      heartbeatMs = 90_000,
      maxQueue = 10,
      random = Math.random,
    }) {
      this.urlFactory = urlFactory;
      this.onMessage = onMessage;
      this.onStatus = onStatus;
      this.baseDelayMs = baseDelayMs;
      this.maxDelayMs = maxDelayMs;
      this.heartbeatMs = heartbeatMs;
      this.maxQueue = maxQueue;
      this.random = random;
      this.failures = 0;
      this.queue = [];
      this.socket = null;
      this.reconnectTimer = null;
      this.heartbeatTimer = null;
      this.stopped = false;
    }

    connect() {
      if (this.stopped || this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
      this.onStatus('connecting');
      try {
        const socket = new WebSocket(this.urlFactory());
        this.socket = socket;
        socket.addEventListener('open', () => {
          this.failures = 0;
          this.onStatus('open');
          this.#touchHeartbeat();
          while (this.queue.length && socket.readyState === WebSocket.OPEN) {
            socket.send(this.queue.shift());
          }
        });
        socket.addEventListener('message', (event) => {
          this.#touchHeartbeat();
          this.onMessage(event.data);
        });
        socket.addEventListener('close', () => {
          this.#clearHeartbeat();
          this.onStatus('closed');
          if (!this.stopped) this.#scheduleReconnect();
        });
        socket.addEventListener('error', () => {
          this.onStatus('error');
          socket.close();
        });
      } catch (_) {
        this.#scheduleReconnect();
      }
    }

    send(payload) {
      const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(serialized);
        return true;
      }
      if (this.queue.length >= this.maxQueue) this.queue.shift();
      this.queue.push(serialized);
      return false;
    }

    stop() {
      this.stopped = true;
      clearTimeout(this.reconnectTimer);
      this.#clearHeartbeat();
      this.queue.length = 0;
      this.socket?.close();
    }

    #scheduleReconnect() {
      clearTimeout(this.reconnectTimer);
      const exponential = Math.min(this.maxDelayMs, this.baseDelayMs * (2 ** this.failures));
      const jitter = exponential * 0.25 * this.random();
      this.failures += 1;
      this.reconnectTimer = setTimeout(() => this.connect(), Math.round(exponential + jitter));
    }

    #touchHeartbeat() {
      this.#clearHeartbeat();
      this.heartbeatTimer = setTimeout(() => {
        this.onStatus('stale');
        this.socket?.close();
      }, this.heartbeatMs);
    }

    #clearHeartbeat() {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  return { RatesSocket };
}));
