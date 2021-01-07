/// <reference lib="webworker" />

import { expose, proxy } from 'comlink';
import { generateUUID, HandlerType } from './utility';

async function startEnvironment(sourceCode: string) {
  const injector = new Injector();
  const disabled: string[] = ['self', 'globalThis', 'postMessage'];
  const functionResult = new Function(
    'injector',
    ...disabled,
    `"use strict"; ${sourceCode}; return main(injector);`
  );

  await functionResult(injector);
}

class InvocationManager {
  static channels: Map<string, InvocationManager> = new Map();
  protected events = {};

  static register(channel: string) {
    this.channels.set(channel, new InvocationManager());
    return proxy(this.channels.get(channel));
  }

  static getAllChannels() {
    return this.channels;
  }

  static get(channel: string) {
    return this.channels.get(channel);
  }

  subscribe(event: string, fn: (...args: any) => any) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    const currentEventIndex = this.events[event].push({ callback: fn });

    return proxy({
      unsubsribe: () => {
        this.events[event].splice(currentEventIndex - 1, 1);
      },
    });
  }

  subscribeOnce(event: string, fn: (...args: any) => any) {
    this.events[event] = [{ callback: fn }];
  }

  broadcast(event: string, payload: any = {}) {
    const channels = InvocationManager.getAllChannels();

    channels.forEach((_, channelKey) => {
      const events = channels.get(channelKey).events[event];
      if (events && events.length > 0) {
        events.forEach((evt) => {
          evt.callback.call(channels.get(channelKey), payload);
        });
      }
    });
  }

  publish(event: string, payload: any = {}) {
    if (this.events[event] && this.events[event].length > 0) {
      this.events[event].forEach((evt) => {
        evt.callback.call(this, payload);
      });
    }
  }
}

class WorkerManager {
  constructor(private invocationManager: InvocationManager) {}

  handler(channel: string) {
    return InvocationManager.get(channel);
  }

  async init(payload: string) {
    // reset all event listener
    EventManager.registeredEvents = [];
    // broadcast to all channels
    this.invocationManager.broadcast('init');

    await startEnvironment(payload);
  }
}
class Injector {
  get(name: string): any {
    return PROVIDERS.get(name);
  }
}

abstract class BaseManager {
  static managerName = '';
  static actions = [];

  static invocationManager: InvocationManager;

  static publishMessage(event: string, payload: any) {
    if (!this.invocationManager) {
      throw new Error(`Please register InvocationManager !`);
    }
    this.invocationManager.publish(event, payload);
  }
}

class ApiManager extends BaseManager {
  static managerName = 'ApiManager';
  static actions = ['get', 'post', 'put', 'delete'];

  constructor() {
    super();

    ApiManager.invocationManager = InvocationManager.register(HandlerType.API);
    ApiManager.invocationManager.subscribe('hello', (payload: any) => {
      log('ApiManager `hello` subscribe => ', payload);
    });
  }
}

class Frame {
  readonly frameId = generateUUID();

  constructor(readonly title: string) {}

  event(event: string, fn: (event) => any) {
    FrameManager.handleFrameEvent(this.frameId);
    EventManager.handleEvent(this.frameId);
    EventManager.addEvent(event, fn);
  }

  render(payload: string) {
    FrameManager.invocationManager.publish('render', {
      id: this.frameId,
      body: payload,
    });
  }
}

class FrameManager extends BaseManager {
  static managerName = 'FrameManager';

  constructor() {
    super();
    FrameManager.invocationManager = InvocationManager.register(
      HandlerType.FRAME
    );
    FrameManager.invocationManager.subscribe('hello', (payload: any) => {
      log('FrameManager `hello` subscribe => ', payload);
    });
    EventManager.init();
  }

  static handleFrameEvent(frameId: string) {
    FrameManager.invocationManager.subscribeOnce(
      `event-${frameId}`,
      (payload) => {
        EventManager.publishMessage(`handle-event-${frameId}`, payload);
      }
    );
  }

  create(title: string): Frame {
    return new Frame(title);
  }
}

class EventManager extends BaseManager {
  static registeredEvents: any[] = [];

  static init() {
    EventManager.invocationManager = InvocationManager.register(
      HandlerType.EVENT
    );
  }

  static addEvent(event: string, fn: (event) => any) {
    EventManager.registeredEvents.push({
      event,
      callback: fn,
    });
  }

  static handleEvent(id: string) {
    EventManager.invocationManager.subscribeOnce(
      `handle-event-${id}`,
      async (payload: any) => {
        log(`Event Frame - ${id}`);
        log(`Event Name  - ${payload.event}`);
        const event = payload.event;

        EventManager.registeredEvents
          .filter((evt) => evt.event === event)
          .forEach((evt) => {
            evt.callback();
          });
      }
    );
  }
}

function withProxy<T extends BaseManager>(
  model: new (...args: any) => T,
  options = { deps: [] }
) {
  // need suggestion for handle static properties and methods typing
  // https://stackoverflow.com/a/58239482
  const instance = new model(...options.deps);

  return new Proxy(instance, {
    get(target: T, propertyKey: PropertyKey, receiver: any) {
      const actions: string[] = model['actions'];
      // log('target => ', target);
      // log('propertyKey => ', propertyKey);
      // log('static => ', actions);

      if (propertyKey in target) {
        return Reflect.get(target, propertyKey, receiver);
      }

      if (actions.indexOf(String(propertyKey)) > -1) {
        return (...args: any) => {
          // instance.publishMessage('hello', 'qwe');
          return new Promise((resolve, reject) => {
            (model as any).publishMessage('invoke', {
              property: String(propertyKey),
              data: args,
            });

            (model as any).invocationManager.subscribeOnce('invo', (data) => {
              resolve(data);
            });
          });
        };
      }

      // Other Approach
      // // https://stackoverflow.com/questions/31054910/get-functions-methods-of-a-class
      // const functionNames = Object.getOwnPropertyNames(Reflect.getPrototypeOf(target));

      // if (classObj.hasOwnProperty(propertyKey) || functionNames.indexOf(String(propertyKey)) > -1) {
      // log('has property or function');
      //   return Reflect.get(target, propertyKey, receiver);
      // }

      // return Reflect.get(target, propertyKey, receiver);
    },
  });
}

function log(...args: any) {
  console.log('> worker |', ...args);
}

const PROVIDERS = new Map<string, any>();
PROVIDERS.set(FrameManager.managerName, withProxy(FrameManager));
PROVIDERS.set(ApiManager.managerName, withProxy(ApiManager));

// expose({ MyClass, exposedObj });
expose(new WorkerManager(new InvocationManager()));
