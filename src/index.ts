// this script is injected into webpage's context
import { EventEmitter } from "events";
import { ethErrors, serializeError } from "eth-rpc-errors";
import BroadcastChannelMessage from "./utils/message/broadcastChannelMessage";
import PushEventHandlers from "./pageProvider/pushEventHandlers";
import { domReadyCall, $, genUUID } from "./pageProvider/utils";
import ReadyPromise from "./pageProvider/readyPromise";
import DedupePromise from "./pageProvider/dedupePromise";
import { switchChainNotice } from "./pageProvider/interceptors/switchChain";
import { switchWalletNotice } from "./pageProvider/interceptors/switchWallet";
import { getProviderMode, patchProvider } from "./utils/metamask";

const log = (event, ...args) => {
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `%c [rabby] (${new Date().toTimeString().substr(0, 8)}) ${event}`,
      "font-weight: bold; background-color: #7d6ef9; color: white;",
      ...args
    );
  }
};

let isOpera = /Opera|OPR\//i.test(navigator.userAgent);
let uuid = genUUID();

export interface Interceptor {
  onRequest?: (data: any) => any;
  onResponse?: (res: any, data: any) => any;
}

interface StateProvider {
  accounts: string[] | null;
  isConnected: boolean;
  isUnlocked: boolean;
  initialized: boolean;
  isPermanentlyDisconnected: boolean;
}

interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}
interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EthereumProvider;
}

interface EIP6963AnnounceProviderEvent extends CustomEvent {
  type: "eip6963:announceProvider";
  detail: EIP6963ProviderDetail;
}

interface EIP6963RequestProviderEvent extends Event {
  type: "eip6963:requestProvider";
}

export class EthereumProvider extends EventEmitter {
  chainId: string | null = null;
  selectedAddress: string | null = null;
  /**
   * The network ID of the currently connected Ethereum chain.
   * @deprecated
   */
  networkVersion: string | null = null;
  isRabby = true;
  isMetaMask = true;
  _isRabby = true;

  _isReady = false;
  _isConnected = false;
  _initialized = false;
  _isUnlocked = false;

  _cacheRequestsBeforeReady: any[] = [];
  _cacheEventListenersBeforeReady: [string | symbol, () => any][] = [];

  _state: StateProvider = {
    accounts: null,
    isConnected: false,
    isUnlocked: false,
    initialized: false,
    isPermanentlyDisconnected: false,
  };

  _metamask = {
    isUnlocked: () => {
      return new Promise((resolve) => {
        resolve(this._isUnlocked);
      });
    },
  };

  private _pushEventHandlers: PushEventHandlers;
  private _requestPromise = new ReadyPromise(2);
  private _dedupePromise = new DedupePromise([]);
  private _bcm = new BroadcastChannelMessage({
    name: "rabby-page-provider",
    target: "rabby-content-script",
  });

  constructor({ maxListeners = 100 } = {}) {
    super();
    this.setMaxListeners(maxListeners);
    this.initialize();
    this.shimLegacy();
    this._pushEventHandlers = new PushEventHandlers(this);
  }

  initialize = async () => {
    document.addEventListener(
      "visibilitychange",
      this._requestPromiseCheckVisibility
    );

    this._bcm.connect().on("message", this._handleBackgroundMessage);
    domReadyCall(() => {
      const origin = location.origin;
      const icon =
        ($('head > link[rel~="icon"]') as HTMLLinkElement)?.href ||
        ($('head > meta[itemprop="image"]') as HTMLMetaElement)?.content;

      const name =
        document.title ||
        ($('head > meta[name="title"]') as HTMLMetaElement)?.content ||
        origin;

      this._bcm.request({
        method: "tabCheckin",
        params: { icon, name, origin },
      });

      this._requestPromise.check(2);
    });

    try {
      const {
        chainId,
        accounts,
        networkVersion,
        isUnlocked,
      }: any = await this.requestInternalMethods({
        method: "getProviderState",
      });
      if (isUnlocked) {
        this._isUnlocked = true;
        this._state.isUnlocked = true;
      }
      this.chainId = chainId;
      this.networkVersion = networkVersion;
      this.emit("connect", { chainId });
      this._pushEventHandlers.chainChanged({
        chain: chainId,
        networkVersion,
      });

      this._pushEventHandlers.accountsChanged(accounts);
    } catch {
      //
    } finally {
      this._initialized = true;
      this._state.initialized = true;
      this.emit("_initialized");
    }
  };

  private _requestPromiseCheckVisibility = () => {
    if (document.visibilityState === "visible") {
      this._requestPromise.check(1);
    } else {
      this._requestPromise.uncheck(1);
    }
  };

  private _handleBackgroundMessage = ({ event, data }) => {
    log("[push event]", event, data);
    if (this._pushEventHandlers[event]) {
      return this._pushEventHandlers[event](data);
    }

    this.emit(event, data);
  };

  isConnected = () => {
    return true;
  };

  // TODO: support multi request!
  request = async (data) => {
    if (!this._isReady) {
      const promise = new Promise((resolve, reject) => {
        this._cacheRequestsBeforeReady.push({
          data,
          resolve,
          reject,
        });
      });
      return promise;
    }
    return this._dedupePromise.call(data.method, () => this._request(data));
  };

  _request = async (data) => {
    if (!data) {
      throw ethErrors.rpc.invalidRequest();
    }

    this._requestPromiseCheckVisibility();

    return this._requestPromise.call(() => {
      if (data.method !== "eth_call") {
        log("[request]", JSON.stringify(data, null, 2));
      }

      return this._bcm
        .request(data)
        .then((res) => {
          if (data.method !== "eth_call") {
            log("[request: success]", data.method, res);
          }
          return res;
        })
        .catch((err) => {
          if (data.method !== "eth_call") {
            log("[request: error]", data.method, serializeError(err));
          }
          throw serializeError(err);
        });
    });
  };

  requestInternalMethods = (data) => {
    return this._dedupePromise.call(data.method, () => this._request(data));
  };

  // shim to matamask legacy api
  sendAsync = (payload, callback) => {
    if (Array.isArray(payload)) {
      return Promise.all(
        payload.map(
          (item) =>
            new Promise((resolve) => {
              this.sendAsync(item, (err, res) => {
                // ignore error
                resolve(res);
              });
            })
        )
      ).then((result) => callback(null, result));
    }
    const { method, params, ...rest } = payload;
    this.request({ method, params })
      .then((result) => callback(null, { ...rest, method, result }))
      .catch((error) => callback(error, { ...rest, method, error }));
  };

  send = (payload, callback?) => {
    if (typeof payload === "string" && (!callback || Array.isArray(callback))) {
      // send(method, params? = [])
      return this.request({
        method: payload,
        params: callback,
      }).then((result) => ({
        id: undefined,
        jsonrpc: "2.0",
        result,
      }));
    }

    if (typeof payload === "object" && typeof callback === "function") {
      return this.sendAsync(payload, callback);
    }

    let result;
    switch (payload.method) {
      case "eth_accounts":
        result = this.selectedAddress ? [this.selectedAddress] : [];
        break;

      case "eth_coinbase":
        result = this.selectedAddress || null;
        break;

      default:
        throw new Error("sync method doesnt support");
    }

    return {
      id: payload.id,
      jsonrpc: payload.jsonrpc,
      result,
    };
  };

  shimLegacy = () => {
    const legacyMethods = [
      ["enable", "eth_requestAccounts"],
      ["net_version", "net_version"],
    ];

    for (const [_method, method] of legacyMethods) {
      this[_method] = () => this.request({ method });
    }
  };

  on = (event: string | symbol, handler: (...args: any[]) => void) => {
    if (!this._isReady) {
      this._cacheEventListenersBeforeReady.push([event, handler]);
      return this;
    }
    return super.on(event, handler);
  };
}

declare global {
  interface Window {
    ethereum: EthereumProvider;
    web3: any;
    rabby: EthereumProvider;
    rabbyWalletRouter: {
      rabbyProvider: EthereumProvider;
      lastInjectedProvider?: EthereumProvider;
      currentProvider: EthereumProvider;
      providers: EthereumProvider[];
      setDefaultProvider: (rabbyAsDefault: boolean) => void;
      addProvider: (provider: EthereumProvider) => void;
    };
  }
}

const provider = new EthereumProvider();
patchProvider(provider);
const rabbyProvider = new Proxy(provider, {
  deleteProperty: (target, prop) => {
    if (
      typeof prop === "string" &&
      ["on", "isRabby", "isMetaMask", "_isRabby"].includes(prop)
    ) {
      // @ts-ignore
      delete target[prop];
    }
    return true;
  },
});

const requestHasOtherProvider = () => {
  return provider.requestInternalMethods({
    method: "hasOtherProvider",
    params: [],
  });
};

const requestIsDefaultWallet = () => {
  return provider.requestInternalMethods({
    method: "isDefaultWallet",
    params: [],
  }) as Promise<boolean>;
};

const initOperaProvider = () => {
  window.ethereum = rabbyProvider;
  rabbyProvider._isReady = true;
  window.rabby = rabbyProvider;
  patchProvider(rabbyProvider);
  rabbyProvider.on("rabby:chainChanged", switchChainNotice);
};

const initProvider = () => {
  rabbyProvider._isReady = true;
  rabbyProvider.on("defaultWalletChanged", switchWalletNotice);
  patchProvider(rabbyProvider);
  if (window.ethereum) {
    requestHasOtherProvider();
  }
  if (!window.web3) {
    window.web3 = {
      currentProvider: rabbyProvider,
    };
  }
  const descriptor = Object.getOwnPropertyDescriptor(window, "ethereum");
  const canDefine = !descriptor || descriptor.configurable;
  if (canDefine) {
    try {
      Object.defineProperties(window, {
        rabby: {
          value: rabbyProvider,
          configurable: false,
          writable: false,
        },
        ethereum: {
          get() {
            return window.rabbyWalletRouter.currentProvider;
          },
          set(newProvider) {
            window.rabbyWalletRouter.addProvider(newProvider);
          },
          configurable: false,
        },
        rabbyWalletRouter: {
          value: {
            rabbyProvider,
            lastInjectedProvider: window.ethereum,
            currentProvider: rabbyProvider,
            providers: [
              rabbyProvider,
              ...(window.ethereum ? [window.ethereum] : []),
            ],
            setDefaultProvider(rabbyAsDefault: boolean) {
              if (rabbyAsDefault) {
                window.rabbyWalletRouter.currentProvider = window.rabby;
              } else {
                const nonDefaultProvider =
                  window.rabbyWalletRouter.lastInjectedProvider ??
                  window.ethereum;
                window.rabbyWalletRouter.currentProvider = nonDefaultProvider;
              }
              if (
                rabbyAsDefault ||
                !window.rabbyWalletRouter.lastInjectedProvider
              ) {
                rabbyProvider.on("rabby:chainChanged", switchChainNotice);
              }
            },
            addProvider(provider) {
              if (!window.rabbyWalletRouter.providers.includes(provider)) {
                window.rabbyWalletRouter.providers.push(provider);
              }
              if (rabbyProvider !== provider) {
                requestHasOtherProvider();
                window.rabbyWalletRouter.lastInjectedProvider = provider;
              }
            },
          },
          configurable: false,
          writable: false,
        },
      });
    } catch (e) {
      // think that defineProperty failed means there is any other wallet
      requestHasOtherProvider();
      console.error(e);
      window.ethereum = rabbyProvider;
      window.rabby = rabbyProvider;
    }
  } else {
    window.ethereum = rabbyProvider;
    window.rabby = rabbyProvider;
  }
};

if (isOpera) {
  initOperaProvider();
} else {
  initProvider();
}

requestIsDefaultWallet().then((rabbyAsDefault) => {
  window.rabbyWalletRouter?.setDefaultProvider(rabbyAsDefault);
});

const announceEip6963Provider = (provider: EthereumProvider) => {
  const info: EIP6963ProviderInfo = {
    uuid: uuid,
    name: "Armor Wallet",
    icon:
      "data:image/svg+xml,%3c%3fxml version='1.0' encoding='utf-8'%3f%3e%3csvg width='20' height='20' viewBox='0 0 552 552' fill='none' xmlns='http://www.w3.org/2000/svg'%3e %3cdefs%3e %3clinearGradient id='paint0_linear_8_205' x1='266.721' y1='674.767' x2='8.5611' y2='-47.7785' gradientUnits='userSpaceOnUse' gradientTransform='matrix(1%2c 0%2c 0%2c 1%2c 23%2c 0)'%3e %3cstop offset='0.031' stop-color='%23848AFF'/%3e %3cstop offset='1' stop-color='%23EA8CFF'/%3e %3c/linearGradient%3e %3clinearGradient id='paint1_linear_8_205' x1='266.721' y1='674.767' x2='8.5611' y2='-47.7785' gradientUnits='userSpaceOnUse' gradientTransform='matrix(1%2c 0%2c 0%2c 1%2c 23%2c 0)'%3e %3cstop offset='0.031' stop-color='%23848AFF'/%3e %3cstop offset='1' stop-color='%23EA8CFF'/%3e %3c/linearGradient%3e %3clinearGradient id='paint2_linear_8_205' x1='266.721' y1='674.767' x2='8.5611' y2='-47.7785' gradientUnits='userSpaceOnUse' gradientTransform='matrix(1%2c 0%2c 0%2c 1%2c 23%2c 0)'%3e %3cstop offset='0.031' stop-color='%23848AFF'/%3e %3cstop offset='1' stop-color='%23EA8CFF'/%3e %3c/linearGradient%3e %3clinearGradient id='paint3_linear_8_205' x1='266.721' y1='674.767' x2='8.5611' y2='-47.7785' gradientUnits='userSpaceOnUse' gradientTransform='matrix(1%2c 0%2c 0%2c 1%2c 23%2c 0)'%3e %3cstop offset='0.031' stop-color='%23848AFF'/%3e %3cstop offset='1' stop-color='%23EA8CFF'/%3e %3c/linearGradient%3e %3clinearGradient id='paint4_linear_8_205' x1='266.721' y1='674.767' x2='8.5611' y2='-47.7785' gradientUnits='userSpaceOnUse' gradientTransform='matrix(1%2c 0%2c 0%2c 1%2c 23%2c 0)'%3e %3cstop offset='0.031' stop-color='%23848AFF'/%3e %3cstop offset='1' stop-color='%23EA8CFF'/%3e %3c/linearGradient%3e %3clinearGradient id='paint5_linear_8_205' x1='266.721' y1='674.767' x2='8.5611' y2='-47.7785' gradientUnits='userSpaceOnUse' gradientTransform='matrix(1%2c 0%2c 0%2c 1%2c 23%2c 0)'%3e %3cstop offset='0.031' stop-color='%23848AFF'/%3e %3cstop offset='1' stop-color='%23EA8CFF'/%3e %3c/linearGradient%3e %3clinearGradient id='paint6_linear_8_205' x1='266.721' y1='674.767' x2='8.5611' y2='-47.7785' gradientUnits='userSpaceOnUse' gradientTransform='matrix(1%2c 0%2c 0%2c 1%2c 23%2c 0)'%3e %3cstop offset='0.031' stop-color='%23848AFF'/%3e %3cstop offset='1' stop-color='%23EA8CFF'/%3e %3c/linearGradient%3e %3clinearGradient id='paint7_linear_8_205' x1='266.721' y1='674.767' x2='8.5611' y2='-47.7785' gradientUnits='userSpaceOnUse' gradientTransform='matrix(1%2c 0%2c 0%2c 1%2c 23%2c 0)'%3e %3cstop offset='0.031' stop-color='%23848AFF'/%3e %3cstop offset='1' stop-color='%23EA8CFF'/%3e %3c/linearGradient%3e %3clinearGradient id='paint8_linear_8_205' x1='262.063' y1='417.889' x2='169.037' y2='79.4979' gradientUnits='userSpaceOnUse' gradientTransform='matrix(1%2c 0%2c 0%2c 1%2c 23%2c 0)'%3e %3cstop offset='0.031' stop-color='%23848AFF'/%3e %3cstop offset='1' stop-color='%23EA8CFF'/%3e %3c/linearGradient%3e %3clinearGradient id='paint9_linear_8_205' x1='262.063' y1='417.889' x2='169.037' y2='79.4979' gradientUnits='userSpaceOnUse' gradientTransform='matrix(1%2c 0%2c 0%2c 1%2c 23%2c 0)'%3e %3cstop offset='0.031' stop-color='%23848AFF'/%3e %3cstop offset='1' stop-color='%23EA8CFF'/%3e %3c/linearGradient%3e %3c/defs%3e %3cpath d='M 23 0 L 168.657 0 L 241.138 82.999 L 217.727 82.999 C 180.925 82.999 147.898 98.184 125.461 122.224 L 23 122.224 L 23 0 Z' fill='url(%23paint0_linear_8_205)' transform='matrix(1%2c 0%2c 0%2c 1%2c -7.105427357601002e-15%2c 0)'/%3e %3cpath d='M 116.532 133.026 L 23 133.026 L 23 319.205 L 95.373 265.495 L 95.373 197.294 C 95.373 173.458 103.18 151.334 116.532 133.026 Z' fill='url(%23paint1_linear_8_205)' transform='matrix(1%2c 0%2c 0%2c 1%2c -7.105427357601002e-15%2c 0)'/%3e %3cpath d='M 95.373 278.479 L 23 336.26 L 23 384.297 L 152.237 469.001 L 152.237 377.931 C 118.065 357.667 95.373 322.008 95.373 281.371 L 95.373 278.479 Z' fill='url(%23paint2_linear_8_205)' transform='matrix(1%2c 0%2c 0%2c 1%2c -7.105427357601002e-15%2c 0)'/%3e %3cpath d='M 165.573 384.791 L 165.921 478.097 L 276 552 L 376.957 484.634 L 301.996 395.666 L 217.727 395.666 C 199.077 395.666 181.397 391.767 165.573 384.791 Z' fill='url(%23paint3_linear_8_205)' transform='matrix(1%2c 0%2c 0%2c 1%2c -7.105427357601002e-15%2c 0)'/%3e %3cpath d='M 317.076 395.666 L 387.296 477.528 L 529 383.728 L 529 351.324 L 420.613 351.324 C 398.225 378.307 363.192 395.666 323.843 395.666 L 317.076 395.666 Z' fill='url(%23paint4_linear_8_205)' transform='matrix(1%2c 0%2c 0%2c 1%2c -7.105427357601002e-15%2c 0)'/%3e %3cpath d='M 429.288 339.386 L 529 339.386 L 529 154.06 L 458.516 206.318 C 458.874 208.38 459.06 210.495 459.06 212.651 L 459.06 266.014 C 459.06 277.514 453.767 287.857 445.333 295.032 C 443.288 311.075 437.687 326.095 429.288 339.386 Z' fill='url(%23paint5_linear_8_205)' transform='matrix(1%2c 0%2c 0%2c 1%2c -7.105427357601002e-15%2c 0)'/%3e %3cpath d='M 454.654 195.134 L 529 137.005 L 529 0 L 398.851 0 L 398.851 106.989 C 424.029 125.263 441.368 152.524 445.333 183.633 C 449.149 186.88 452.323 190.776 454.654 195.134 Z' fill='url(%23paint6_linear_8_205)' transform='matrix(1%2c 0%2c 0%2c 1%2c -7.105427357601002e-15%2c 0)'/%3e %3cpath d='M 386.383 99.039 L 386.383 0 L 189.031 0 L 257.881 82.999 L 323.843 82.999 C 346.688 82.999 368.078 88.85 386.383 99.039 Z' fill='url(%23paint7_linear_8_205)' transform='matrix(1%2c 0%2c 0%2c 1%2c -7.105427357601002e-15%2c 0)'/%3e %3cpath d='M 323.068 239.76 C 323.068 222.3 334.423 211.669 353.072 211.669 L 423.981 211.669 L 423.981 267.85 L 353.072 267.85 C 334.423 267.85 323.068 257.219 323.068 239.76 Z' fill='url(%23paint8_linear_8_205)' transform='matrix(1%2c 0%2c 0%2c 1%2c -7.105427357601002e-15%2c 0)'/%3e %3cpath fill-rule='evenodd' clip-rule='evenodd' d='M 214.629 116.47 C 168.007 116.47 130.212 151.854 130.212 195.502 L 130.212 197.489 L 186.706 197.489 L 186.706 185.418 C 175.735 181.791 167.875 172.005 167.875 160.502 C 167.875 145.911 180.522 134.083 196.122 134.083 C 211.722 134.083 224.369 145.911 224.369 160.502 C 224.369 172.005 216.509 181.791 205.538 185.418 L 205.538 215.102 L 130.212 215.102 L 130.212 229.192 L 229.743 229.192 C 233.62 218.931 244.083 211.579 256.382 211.579 C 271.983 211.579 284.629 223.407 284.629 237.998 C 284.629 252.589 271.983 264.417 256.382 264.417 C 244.083 264.417 233.62 257.066 229.743 246.805 L 130.212 246.805 L 130.212 264.417 L 220.603 264.417 L 220.603 294.101 C 231.574 297.728 239.434 307.514 239.434 319.017 C 239.434 333.608 226.787 345.436 211.187 345.436 C 195.587 345.436 182.94 333.608 182.94 319.017 C 182.94 307.514 190.8 297.728 201.771 294.101 L 201.771 282.03 L 130.212 282.03 L 130.212 284.017 C 130.212 327.665 168.007 363.049 214.629 363.049 L 326.058 363.049 C 372.68 363.049 410.475 327.665 410.475 284.017 L 410.475 283.906 C 409.359 283.98 408.233 284.017 407.098 284.017 L 353.072 284.017 C 326.963 284.017 305.798 264.202 305.798 239.76 C 305.798 215.317 326.963 195.502 353.072 195.502 L 407.098 195.502 C 408.233 195.502 409.359 195.539 410.475 195.613 L 410.475 195.502 C 410.475 151.854 372.68 116.47 326.058 116.47 L 214.629 116.47 Z M 196.122 172.831 C 203.402 172.831 209.304 167.311 209.304 160.502 C 209.304 153.693 203.402 148.173 196.122 148.173 C 188.842 148.173 182.94 153.693 182.94 160.502 C 182.94 167.311 188.842 172.831 196.122 172.831 Z M 269.564 237.998 C 269.564 231.189 263.662 225.669 256.382 225.669 C 249.102 225.669 243.2 231.189 243.2 237.998 C 243.2 244.807 249.102 250.327 256.382 250.327 C 263.662 250.327 269.564 244.807 269.564 237.998 Z M 211.187 306.688 C 218.467 306.688 224.369 312.208 224.369 319.017 C 224.369 325.826 218.467 331.346 211.187 331.346 C 203.907 331.346 198.005 325.826 198.005 319.017 C 198.005 312.208 203.907 306.688 211.187 306.688 Z' fill='url(%23paint9_linear_8_205)' transform='matrix(1%2c 0%2c 0%2c 1%2c -7.105427357601002e-15%2c 0)'/%3e%3c/svg%3e",
    rdns: "io.rabby",
  };

  window.dispatchEvent(
    new CustomEvent("eip6963:announceProvider", {
      detail: Object.freeze({ info, provider }),
    })
  );
};

window.addEventListener<any>(
  "eip6963:requestProvider",
  (event: EIP6963RequestProviderEvent) => {
    announceEip6963Provider(rabbyProvider);
  }
);

announceEip6963Provider(rabbyProvider);

window.dispatchEvent(new Event("ethereum#initialized"));
