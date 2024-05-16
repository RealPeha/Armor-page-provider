import { EthereumProvider } from "../index";
declare class PushEventHandlers {
    provider: EthereumProvider;
    constructor(provider: any);
    _emit(event: any, data: any): void;
    connect: (data: any) => void;
    unlock: () => void;
    lock: () => void;
    disconnect: () => void;
    accountsChanged: (accounts: any) => void;
    chainChanged: ({ chain, networkVersion }: {
        chain: any;
        networkVersion: any;
    }) => void;
    "rabby:chainChanged": (chain: any) => void;
}
export default PushEventHandlers;
