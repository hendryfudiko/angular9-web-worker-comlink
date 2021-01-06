import { Injectable } from '@angular/core';
import { proxy as proxyValue, releaseProxy, Remote, wrap } from 'comlink';
import { Subject } from 'rxjs';
import { generateUUID, HandlerType } from './utility';

@Injectable({ providedIn: 'root' })
export class ApiService {
  async get(url) {
    const response = await fetch(url);
    return response.json();
  }

  async post(url, payload) {
    const response = await fetch(url, { method: 'POST', body: payload });
    return response.json();
  }
}

export abstract class BaseExtension {
  protected readonly handleType: HandlerType;
  protected readonly changed = new Subject();

  constructor(handlerType: HandlerType) {
    this.handleType = handlerType;
  }

  emit(value: any) {
    this.changed.next(value);
  }

  valueChanged() {
    return this.changed.asObservable();
  }

  errorReport(error: any) {
    const reportId = generateUUID();
    console.warn(`error ${reportId} => ${error}`);
  }
}

@Injectable({ providedIn: 'root' })
export class ApiServiceExtension extends BaseExtension {
  constructor(private apiService: ApiService) {
    super(HandlerType.API);
  }

  async init(proxy: Remote<any>) {
    const proxyHandler = await proxy.handler(HandlerType.API);
    await proxyHandler.broadcast('hello', 'broadcast: Hello World !');

    proxyHandler.subscribe(
      'invoke',
      proxyValue(async (payload) => {
        console.log('> ApiService Extension => ', payload);
        try {
          const [url] = payload.data;
          const property = payload.property;
          const result = await this.apiService[property](url);

          // publish back to worker
          proxyHandler.publish('invo', result);
        } catch (error) {
          this.errorReport(error);
        }
      })
    );
  }
}

@Injectable({ providedIn: 'root' })
export class EventServiceExtension extends BaseExtension {
  constructor() {
    super(HandlerType.EVENT);
  }

  register(payload: {
    id: string;
    element: Element;
    proxyHandler: Remote<any>;
    proxy: Remote<any>;
  }) {
    const { id, element, proxyHandler, proxy } = payload;

    element.querySelectorAll('*').forEach((el: HTMLElement) => {
      const attributes: Array<string> = el.getAttributeNames();
      attributes
        .map((attr: string) => attr.match(/\((.*)\)/))
        .filter((match: RegExpMatchArray) => match !== null && match.length > 1)
        .map((match: RegExpMatchArray) => match[1])
        .forEach(async (attribute: string) => {
          el.addEventListener(attribute, (event: any) => {
            const funcName = el.getAttribute(`(${attribute})`);
            console.log('funcName => ', funcName, proxyHandler);
            console.log('aaa => ', event.target.id);
            proxyHandler.publish(`event-${id}`, {
              elementId: event.target.id,
              event: attribute,
            });
          });
        });
    });
  }
}

@Injectable({ providedIn: 'root' })
export class FrameServiceExtension extends BaseExtension {
  protected frames: any[];
  private readonly domParser: DOMParser = new DOMParser();

  constructor(private eventServiceExtension: EventServiceExtension) {
    super(HandlerType.FRAME);
  }

  generateHTMLContent(id: string, body: string) {
    const html = `<section id="container-${id}">${body}</section>`;
    const dom: Document = this.domParser.parseFromString(html, 'text/html');
    const root: Element = dom.body.firstElementChild;

    return root;
  }

  async init(proxy: Remote<any>, container: HTMLElement) {
    const proxyHandler = await proxy.handler(HandlerType.FRAME);
    // await proxyHandler.broadcast('hello', 'broadcast: Hello World !');

    proxyHandler.subscribe(
      'init',
      proxyValue(() => {
        container.innerHTML = '';
      })
    );

    proxyHandler.subscribe(
      'render',
      proxyValue((payload: { id: string; title: string; body: string }) => {
        console.log('> FrameService Extension => ');

        const frame = this.generateHTMLContent(payload.id, payload.body);
        this.eventServiceExtension.register({
          id: payload.id,
          element: frame,
          proxyHandler,
          proxy,
        });

        container.appendChild(frame);
      })
    );
  }
}

@Injectable({ providedIn: 'root' })
export class MessageBusService {
  protected proxies: { [key: string]: Remote<any> } = {};
  protected currentProxyKey: string;

  async init(proxy: Remote<any>, payload: string) {
    await proxy.init(payload);
  }

  // worker stuff | possibly extract into separate class for futher improvement
  async createProxy(worker?: Worker) {
    this.currentProxyKey = generateUUID();
    worker =
      worker ??
      new Worker('./sandbox.worker', {
        type: 'module',
        name: this.currentProxyKey,
      });
    this.proxies[this.currentProxyKey] = wrap(worker);

    return this.proxies[this.currentProxyKey];
  }

  getProxyKeys(): string[] {
    return Object.keys(this.proxies);
  }

  getProxy(proxyKey: string): Remote<any> {
    return this.proxies[proxyKey];
  }

  releaseProxy(proxyKey: string) {
    this.proxies[proxyKey][releaseProxy]();
  }

  releaseAllProxies() {
    const proxyKeys = this.getProxyKeys();
    proxyKeys.forEach((proxyKey: string) => {
      this.proxies[proxyKey][releaseProxy]();
    });
  }
}
