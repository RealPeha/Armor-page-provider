interface Options {
    content: string;
    closeButton: HTMLElement | string;
    container: HTMLElement;
    timeout: number;
    onHide?: () => void;
    className?: string;
    closeable: boolean;
}
declare class Notice {
    options: Options;
    el: HTMLDivElement | null;
    events: Record<string, (...args: any[]) => void>;
    closeButton?: HTMLElement;
    timer?: number | null;
    constructor(options: Options);
    insert(): void;
    registerEvents(): void;
    startTimer(timeout?: number): void;
    stopTimer(): void;
    hide(): void;
}
declare function notice(options: Partial<Options>): Notice;
export default notice;
