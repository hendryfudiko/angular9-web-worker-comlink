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

  // add function for get worker unique id?

  abstract handle(key: string, data: any);
}

@Injectable({ providedIn: 'root' })
export class ApiServiceExtension extends BaseExtension {
  constructor(private apiService: ApiService) {
    super(HandlerType.API);
  }

  async handle(key: string, data: any) {
    try {
      // const payloadData = await payload.worker.send(this.apiService);
      const [url] = data;
      return await this.apiService[key](url);
    } catch (error) {
      this.errorReport(error);
    }
  }
}

@Injectable({ providedIn: 'root' })
export class FrameServiceExtension extends BaseExtension {
  constructor() {
    super(HandlerType.FRAME);
  }

  handle(key: string, data: any) {
    // manipulate the DOM, possibly send to lambda for formating template?
    // we can use handlerbar convention for templating

    this.emit({
      id: data.id,
      title: data.title,
      content: data.body,
    });
  }
}

@Injectable({ providedIn: 'root' })
export class MessageBusService {
  protected proxies: { [key: string]: Remote<any> } = {};
  protected currentProxyKey: string;
  // private handlers: BaseExtension[];

  constructor(
    private apiServiceExtension: ApiServiceExtension,
    private frameServiceExtension: FrameServiceExtension
  ) {
    // this.handlers = [this.apiServiceExtension];
  }

  async sendMessage(proxy: Remote<any>, payload: any) {
    await proxy.handle({
      command: payload.command,
      data: payload.data,
    });
  }

  async subscribe(
    payload: { handler: HandlerType; key: string; data: any },
    proxy?: Remote<any>
  ) {
    if (payload.handler === HandlerType.API) {
      return await this.apiServiceExtension.handle(payload.key, payload.data);
    }

    if (payload.handler === HandlerType.FRAME) {
      this.frameServiceExtension.handle(payload.key, payload.data);
    }
  }

  // worker stuff | possibly extract into separate class for futher improvement
  createProxy(worker?: Worker) {
    this.currentProxyKey = generateUUID();
    worker =
      worker ??
      new Worker('./sandbox.worker', {
        type: 'module',
        name: this.currentProxyKey,
      });
    this.proxies[this.currentProxyKey] = wrap(worker);
    this.proxies[this.currentProxyKey].subscribe(
      proxyValue(async (payload: any) => await this.subscribe(payload))
    );

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
