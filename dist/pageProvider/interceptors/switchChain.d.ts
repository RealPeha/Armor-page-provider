interface Chain {
    [key: string]: any;
    id: number;
    name: string;
    logo?: string;
    isTestnet: boolean;
}
export declare const switchChainNotice: (chain: Chain & {
    prev?: Chain;
}) => void;
export {};
