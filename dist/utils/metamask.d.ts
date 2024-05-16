export declare const calcIsGray: (host: string, ratio: number) => boolean;
declare type Mode = "metamask" | "rabby" | "default";
export declare const getProviderMode: (host: string) => Mode;
export declare const patchProvider: (provider: any) => void;
export {};
