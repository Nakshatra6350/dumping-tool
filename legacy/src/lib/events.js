const { EventEmitter } = require("events");

// In-process bus used to push live dump status changes to the dashboard (SSE).
const bus = new EventEmitter();
bus.setMaxListeners(0);

module.exports = bus;
