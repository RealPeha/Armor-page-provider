/**
 * this script is live in content-script / dapp's page
 */
/// <reference types="node" />
import { EventEmitter } from 'events';
declare abstract class Message extends EventEmitter {
    private _requestIdPool;
    protected _EVENT_PRE: string;
    protected listenCallback: any;
    private _waitingMap;
    abstract send(type: string, data: any): void;
    request: (data: any) => Promise<unknown>;
    onResponse: ({ ident, res, err }?: any) => Promise<void>;
    onRequest: ({ ident, data }: {
        ident: any;
        data: any;
    }) => Promise<void>;
    _dispose: () => void;
}
export default Message;
