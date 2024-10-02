import { EventEmitter } from 'events';

class SyncEvents extends EventEmitter {}

const syncEvents = new SyncEvents();

export default syncEvents;