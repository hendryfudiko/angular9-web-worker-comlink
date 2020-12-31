/// <reference lib="webworker" />

import { expose } from 'comlink';
import { generateUUID, HandlerType } from './utility';


async function initEnvironment(sourceCode: string) {
  const injector = new Injector();
  const disabled: string[] = ['self', 'globalThis', 'postMessage'];
  const functionResult = new Function(
    'injector',
    ...disabled,
    `"use strict"; ${sourceCode}; return main(injector)`
  );

  await functionResult(injector);
}

const exposedObj = {
  counter: 0,
  emit: null,
  increment() {
    this.counter++;
  },
  async testCb(cb) {
    let response = await fetch('https://jsonplaceholder.typicode.com/todos/1');
    response = await response.json();
    await cb(JSON.stringify(response));
  },
  subscribe(
    cb: (payload: { handler: HandlerType; key: string; data: any }) => any
  ) {
    this.emit = cb;
  },
  send(handler: HandlerType, propertyKey: string, data: any) {
    log('send => ', propertyKey, data);
    return this.emit({ handler, key: propertyKey, data });
  },
  async handle(
    payload: { command: any; workerUniqueId: string; data: any },
    cb?: (args: any) => void
  ) {
    log(payload.command);

    await initEnvironment(payload.data);
  },
};

class Injector {
  get(name: string): any {
    return PROVIDERS.get(name);
  }
}

abstract class BaseManager {
  static actions = [];

  readonly handlerType: HandlerType;
}

class ApiManager extends BaseManager {
  static actions = ['get', 'post', 'put', 'delete'];

  readonly handlerType = HandlerType.API;

  constructor() {
    super();
    log('worker constructor - ', this.constructor.name);
  }
}

class Frame {
  readonly frameId = generateUUID();
  constructor(readonly title, readonly handlerType: HandlerType) {}

  render(payload: string) {
    log('render from => ', Frame.name);
    exposedObj.send(this.handlerType, 'render', {
      id: this.frameId,
      body: payload,
    });
  }
}

class FrameManager extends BaseManager {
  readonly handlerType = HandlerType.FRAME;

  constructor() {
    super();
    log('worker constructor - ', this.constructor.name);
  }

  create(title: string): Frame {
    return new Frame(title, this.handlerType);
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
          return exposedObj.send(
            instance.handlerType,
            String(propertyKey),
            args
          );
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
PROVIDERS.set('FrameManager', withProxy(FrameManager));
PROVIDERS.set('ApiManager', withProxy(ApiManager));

// expose({ MyClass, exposedObj });
expose(exposedObj);
