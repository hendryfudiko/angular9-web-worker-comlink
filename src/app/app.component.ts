import { Component, OnInit, ElementRef, ViewChild, AfterViewInit } from '@angular/core';

import { Remote } from 'comlink';

import {
  FrameServiceExtension,
  MessageBusService,
  ApiServiceExtension,
} from './extension/message-bus.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit, AfterViewInit {
  remote: Remote<any>;
  proxyKeys: string[] = [];
  sourceCode = '';
  frames: any[] = [];
  editorOptions = {
    theme: 'vs-dark',
    language: 'javascript',
    tabSize: 2,
    scrollBeyondLastLine: false,
    minimap: {
      enabled: false
    }
  };

  @ViewChild('frameContainer')
  private div: ElementRef<HTMLDivElement>;

  constructor(
    private msgBusService: MessageBusService,
    private frameServiceExtension: FrameServiceExtension,
    private apiServiceExtension: ApiServiceExtension
  ) {}

  async ngOnInit() {
    this.sourceCode = window.localStorage.getItem('t');
  }

  async ngAfterViewInit() {
    this.remote = await this.msgBusService.createProxy();
    await this.apiServiceExtension.init(this.remote);
    await this.frameServiceExtension.init(this.remote, this.div.nativeElement);
  }

  changeText(text: string) {
    window.localStorage.setItem('t', text);
  }

  async test() {
    const a = await this.msgBusService.init(this.remote, this.sourceCode);

    // this.remote.testCallbackSync(proxy(this.cb));
    // await this.remote.passClass(transfer(this.apiService, []));

    // await this.remote.increment();
    // console.log(`Counter -> ${await this.remote.counter}`);
  }
}
