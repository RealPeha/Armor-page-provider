import { Runtime } from "webextension-polyfill";
import Message from "./index";
declare class PortMessage extends Message {
    port: Runtime.Port | null;
    listenCallback: any;
    constructor(port?: Runtime.Port);
    connect: (name?: string | undefined) => this;
    listen: (listenCallback: any) => this | undefined;
    send: (type: any, data: any) => void;
    dispose: () => void;
}
export default PortMessage;
