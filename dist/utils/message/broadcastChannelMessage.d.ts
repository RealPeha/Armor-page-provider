import Message from './index';
export default class BroadcastChannelMessage extends Message {
    private _channel;
    constructor(name?: string);
    connect: () => this;
    listen: (listenCallback: any) => this;
    send: (type: any, data: any) => void;
    dispose: () => void;
}
