declare class DedupePromise {
    private _blackList;
    private _tasks;
    constructor(blackList: any);
    call(key: string, defer: () => Promise<any>): Promise<unknown>;
}
export default DedupePromise;
