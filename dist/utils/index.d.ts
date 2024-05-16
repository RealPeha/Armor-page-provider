import BroadcastChannelMessage from "./message/broadcastChannelMessage";
import PortMessage from "./message/portMessage";
declare const Message: {
    BroadcastChannelMessage: typeof BroadcastChannelMessage;
    PortMessage: typeof PortMessage;
};
declare global {
    const langLocales: Record<string, Record<"message", string>>;
}
declare const t: (name: any) => string;
declare const format: (str: any, ...args: any[]) => any;
export { Message, t, format };
export declare const hasConnectedLedgerDevice: () => Promise<void>;
