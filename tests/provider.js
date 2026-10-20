import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';

export class FixtureProvider extends EventEmitter {
  child = {}; calls = []; replies = [];
  async request(method, params) {
    this.calls.push({method, params});
    if (method === 'account/read') return {account: {type: 'chatgpt'}};
    if (method.startsWith('thread/')) return {thread: {id: randomUUID()}};
    if (method === 'turn/start') return {turn: {id: randomUUID(), status: 'inProgress'}};
    return {};
  }
  respond(id, result) { this.replies.push({id, result}); }
  reject(id, message) { this.replies.push({id, result: {success: false, message}}); }
  stop() {}
}

