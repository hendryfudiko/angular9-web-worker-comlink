import { Component, OnInit } from '@angular/core';

import { Remote } from 'comlink';

import {
  FrameServiceExtension,
  MessageBusService,
} from './extension/message-bus.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
  remote: Remote<any>;
  proxyKeys: string[] = [];
  sourceCode = '';
  htmlContent = '';

  constructor(
    private msgBusService: MessageBusService,
    private frameServiceExtension: FrameServiceExtension
  ) {
    this.remote = this.msgBusService.createProxy();
  }

  ngOnInit() {
    this.sourceCode = window.localStorage.getItem('t');
    this.frameServiceExtension
      .valueChanged()
      .subscribe((frame: { id: string; title: string; content: string }) => {
        this.htmlContent = frame.content;
      });
  }

  changeText(text: string) {
    window.localStorage.setItem('t', text);
  }

  async test() {
    const a = await this.msgBusService.sendMessage(this.remote, {
      command: 'a',
      data: this.sourceCode,
    });

    // this.remote.testCallbackSync(proxy(this.cb));
    // await this.remote.passClass(transfer(this.apiService, []));

    // await this.remote.increment();
    // console.log(`Counter -> ${await this.remote.counter}`);
  }
}
