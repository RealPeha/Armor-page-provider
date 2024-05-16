declare class ReadyPromise {
    private _allCheck;
    private _tasks;
    constructor(count: any);
    check: (index: any) => void;
    uncheck: (index: any) => void;
    private _proceed;
    call: (fn: any) => Promise<unknown>;
}
export default ReadyPromise;
