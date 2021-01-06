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
    log('worker constructor - ', ApiManager.managerName);

    ApiManager.invocationManager = InvocationManager.register(HandlerType.API);
    ApiManager.invocationManager.subscribe('hello', (payload: any) => {
      log('ApiManager `hello` subscribe => ', payload);
    });
  }
}

class Frame {
  readonly frameId = generateUUID();

  constructor(readonly title: string) {}

  enableEventHandler() {
    // handle event handler with EventManager
    EventManager.handleEvent(this.frameId);

    FrameManager.invocationManager.subscribeOnce(
      `event-${this.frameId}`,
      (payload) => {
        EventManager.publishMessage(`handle-event-${this.frameId}`, payload);
      }
    );
  }

  render(payload: string) {
    log('render from => ', Frame.name);

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
    log('worker constructor - ', FrameManager.managerName);

    FrameManager.invocationManager = InvocationManager.register(
      HandlerType.FRAME
    );
    FrameManager.invocationManager.subscribe('hello', (payload: any) => {
      log('FrameManager `hello` subscribe => ', payload);
    });
  }

  create(title: string): Frame {
    return new Frame(title);
  }
}

class EventManager extends BaseManager {
  static managerName = 'EventManager';
  static registeredEvents: any[] = [];

  constructor() {
    super();
    log('worker constructor - ', EventManager.managerName);

    EventManager.invocationManager = InvocationManager.register(
      HandlerType.EVENT
    );
    EventManager.invocationManager.subscribe('hello', (payload: any) => {
      log('EventManager `hello` subscribe => ', payload);
    });
  }

  static handleEvent(id: string) {
    EventManager.invocationManager.subscribeOnce(
      `handle-event-${id}`,
      async (payload: any) => {
        log(`EventManager handle event ${id}=> `);
        const elementId = payload.elementId;
        const event = payload.event;

        EventManager.registeredEvents
          .filter((evt) => evt.elementId === elementId && evt.event === event)
          .forEach((evt) => {
            evt.callback();
          });
      }
    );
  }

  register(elementId: string, event: string, fn: (event) => any) {
    EventManager.registeredEvents.push({
      elementId,
      event,
      callback: fn,
    });
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
PROVIDERS.set(EventManager.managerName, withProxy(EventManager));

// expose({ MyClass, exposedObj });
expose(new WorkerManager(new InvocationManager()));
