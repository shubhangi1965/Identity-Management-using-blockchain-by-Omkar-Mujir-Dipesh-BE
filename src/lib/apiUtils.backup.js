//import {ipcRenderer} from 'electron';
import store from '../store/index.js';
import {getKey} from './SecureRemote.js';

/*
 * @param {String} method
 * @param {String} id
 * @param {Object||Null} error
 * @param {promise} reject
 * @returns Error
 */
function _promptFail(method, id, error, reject) {
    console.log(error);
    return reject({
        id: id,
        result: {
            isError: true,
            method: method,
            error: error
        }
    });
}

/*
 * App requesting link to Beet wallet. Create window, wait for response.
 * @param {Object} request
 * @returns {Object}
 */
export async function linkRequest(request) {
    return new Promise(async (resolve, reject) => {
        let linkReq = {appName: request.appName, origin: request.origin, chain: request.chain};

        store.dispatch(
          "WalletStore/notifyUser",
          {notify: "request", message: window.t("common.link_alert", linkReq)}
        );

        let accounts =  store.getters['AccountStore/getSafeAccountList'];
        if (!accounts) {
          return _promptFail("REQUEST_LINK", request.id, 'No accounts', reject);
        }

        let existingLinks = [];
        try {
          existingLinks = store.getters['OriginStore/getExistingLinks'](linkReq);
        } catch (error) {
          return _promptFail("REQUEST_LINK", request.id, error, reject);
        }

        window.electron.createPopup({
            request: request,
            accounts: accounts,
            existingLinks: existingLinks
        });

        window.electron.approvedPopup({
            id: request.id,
            callback: (result) => {
                store.dispatch("AccountStore/selectAccount", result.result);
                return resolve(result);
            }
        });
        
        window.electron.rejectedPopup({
            id: request.id,
            callback: (result) => {
                return _promptFail("REQUEST_LINK", request.id, result, reject);
            }
        });

        /*
        ipcRenderer.once(`popupApproved_${request.id}`, (event, result) => {
            store.dispatch("AccountStore/selectAccount", result.result);
            return resolve(result);
        })

        ipcRenderer.once(`popupRejected_${request.id}`, (event, result) => {
          return _promptFail("REQUEST_LINK", request.id, result, reject);
        })
        */
    });
}

/*
 * Relinking app to Beet wallet.
 * @param {Object} request
 * @returns {Object}
 */
export async function relinkRequest(request) {
  return new Promise(async (resolve, reject) => {
    let shownBeetApp = store.getters['OriginStore/getBeetApp'](request);
    if (!shownBeetApp) {
      return _promptFail("REQUEST_RELINK", request.id, 'No beetApp', reject);
    }

    let linkReq = {appName: request.appName, origin: request.origin, chain: request.chain};

    store.dispatch(
      "WalletStore/notifyUser",
      {notify: "request", message: window.t("common.relink_alert", linkReq)}
    );

    let account = store.getters['AccountStore/getSafeAccount'](JSON.parse(JSON.stringify(shownBeetApp)));

    window.electron.createPopup({
        request: request,
        accounts: [account]
    });

    window.electron.approvedPopup({
        id: request.id,
        callback: (result) => {
            return resolve(result);
        }
    });

    window.electron.rejectedPopup({
        id: request.id,
        callback: (result) => {
            return _promptFail("REQUEST_RELINK", request.id, result, reject);
        }
    });
  });
}

/*
 * Get the user's blockchain account details.
 * @param {Object} request
 * @returns {Object}
 */
export async function getAccount(request) {
  // identify request popup
  return new Promise(async (resolve, reject) => {
    let shownBeetApp = store.getters['OriginStore/getBeetApp'](request);
    if (!shownBeetApp) {
      return _promptFail("getAccount", request.id, 'No beetApp', reject);
    }

    let account = store.getters['AccountStore/getSafeAccount'](JSON.parse(JSON.stringify(shownBeetApp)));
    store.dispatch("WalletStore/notifyUser", {notify: "request", message: window.t('common.apiUtils.getAccount')});

    window.electron.createPopup({
        request: request,
        accounts: [account]
    });

    window.electron.approvedPopup({
        id: request.id,
        callback: (result) => {
            return resolve(result);
        }
    });

    window.electron.rejectedPopup({
        id: request.id,
        callback: (result) => {
            return _promptFail("getAccount", request.id, result, reject);
        }
    });
  });
}

/*
 * sign or broadcast (REQUEST_SIGNATURE || INJECTED_CALL)
 *
 * @param {API} blockchain
 * @param {Object} request
 * @param {Promise} resolve
 * @param {Promise} reject
 * @param {Object} receipt
 * @returns {Object}
 */
async function _signOrBroadcast(
  blockchain,
  request,
  resolve,
  reject,
  receipt = null
) {
    let finalResult;
    let notifyTXT = "";

    let txType = request.payload.params[0] ?? "signAndBroadcast";
    if (txType == "broadcast") {
        try {
            finalResult = await blockchain.broadcast(request.payload.params);
        } catch (error) {
            console.log(error)
            return _promptFail(txType, request.id, error, reject);
        }
        notifyTXT = window.t('common.apiUtils.broadcast');
        return resolve({result: finalResult});
    }

    let activeKey;
    if (["BTS", "BTS_TEST", "TUSC"].includes(blockchain._config.identifier)) {
        try {
            activeKey = request.payload.account_id
                            ? store.getters['AccountStore/getActiveKey'](request)
                            : store.getters['AccountStore/getCurrentActiveKey']();
        } catch (error) {
            console.log(error)
            return _promptFail(txType + '.getActiveKey', request.id, error, reject);
        }
    } else if (["EOS", "BEOS", "TLOS"].includes(blockchain._config.identifier)) {
        activeKey = store.getters['AccountStore/getEOSKey']();
    }

    let signingKey;
    try {
        signingKey = await getKey(activeKey);
    } catch (error) {
        console.log(error)
        return _promptFail(txType + '.getKey', request.id, {error: error, key: activeKey, req: request}, reject);
    }

    let transaction;
    try {
        if (["BTS", "BTS_TEST", "TUSC"].includes(blockchain._config.identifier)) {
            transaction = await blockchain.sign(request.payload.params, signingKey);
        } else if (["EOS", "BEOS", "TLOS"].includes(blockchain._config.identifier)) {
            transaction = await blockchain.sign(JSON.parse(request.payload.params[1]), signingKey);
        }   
    } catch (error) {
        console.log(error)
        return _promptFail(txType + '.blockchain.sign', request.id, error, reject);
    }

    if (txType == "sign" && blockchain._config.identifier === "BTS") {
        finalResult = transaction.toObject();
        notifyTXT = window.t('common.apiUtils.sign');
    } else if (txType == "signAndBroadcast") {
        try {
            finalResult = await blockchain.broadcast(transaction);
        } catch (error) {
            console.log(error)
            return _promptFail(txType + ".broadcast", request.id, error, reject);
        }
        notifyTXT = window.t('common.apiUtils.signAndBroadcast');
    }

    if (!finalResult) {
        reject("Failed to process approved prompt");
    }

    store.dispatch("WalletStore/notifyUser", {notify: "request", message: notifyTXT});

  if (receipt) {
    try {
        window.electron.createReceipt({
            request: request,
            result: finalResult,
            notifyTXT: notifyTXT,
            receipt: receipt
        });
    } catch (error) {
        console.log(error)
    }
  }

  return resolve({result: finalResult});
}

/*
 * Prompt the user to provide their signature.
 * @param {Object} request
 * @param {Object} blockchain
 * @returns {Object}
 */
export async function requestSignature(request, blockchain) {
  // transaction request popup
  return new Promise(async (resolve, reject) => {
    store.dispatch("WalletStore/notifyUser", {notify: "request", message: `Signature request type: ${request.params[0]}`});

    if (!request || !request.payload) {
      return _promptFail("requestSignature", 'requestSignature', request, reject);
    }

    let visualizedParams;
    try {
        visualizedParams = await blockchain.visualize(request.payload.params);
    } catch (error) {
        console.log(error);
        return _promptFail("requestSignature.visualizedParams", request.id, request, reject);
    }

    let visualizedAccount;
    if (["BTS", "BTS_TEST", "TUSC"].includes(blockchain._config.identifier)) {
        try {
            visualizedAccount = await blockchain.visualize(request.payload.account_id);
        } catch (error) {
            console.log(error);
            return _promptFail("requestSignature.visualizedAccount", request.id, request, reject);
        }
    } else if (["EOS", "BEOS", "TLOS"].includes(blockchain._config.identifier)) {
        visualizedAccount = request.payload.authorization && request.payload.authorization.length
            ? request.payload.authorization[0].actor
            : "";
    }

    window.electron.createPopup({
        request: request,
        visualizedAccount: visualizedAccount,
        visualizedParams: visualizedParams
    });

    window.electron.approvedPopup({
        id: request.id,
        callback: (result) => {
            return _signOrBroadcast(blockchain, request, resolve, reject);
        }
    });

    window.electron.rejectedPopup({
        id: request.id,
        callback: (result) => {
            return _promptFail("requestSignature", request.id, request, reject);
        }
    });
  });
}

/*
 * Perform a query using an injected blockchain library
 * @param {Object} request
 * @returns {Object}
 */

export async function injectedCall(request, blockchain) {
  // transaction request popup
  return new Promise(async (resolve, reject) => {
    if (!request || !request.payload) {
      return _promptFail("injectedCall", 'injectedCall', request, reject);
    }

    let regexBTS = /1.2.\d+/g
    let isBlocked = false;
    let blockedAccounts;
    let foundIDs = [];

    if (["BTS", "BTS_TEST", "TUSC"].includes(blockchain._config.identifier)) {
        // Decentralized warn list
        
        let stringifiedPayload = JSON.stringify(request.payload.params);
        let regexMatches = stringifiedPayload.matchAll(regexBTS);
        for (const match of regexMatches) {
            foundIDs.push(match[0]);
        }

        if (foundIDs.length) {
            // Won't catch account names, only account IDs
            try {
                blockedAccounts = await blockchain.getBlockedAccounts();
            } catch (error) {
                console.log(error);
            }

            if (blockedAccounts) {
                const isBadActor = (actor) => blockedAccounts.find(x => x === actor) ? true : false;
                isBlocked = foundIDs.some(isBadActor);
            }
        }
    }

    let visualizedParams;
    try {
        visualizedParams = await blockchain.visualize(request.payload.params);
    } catch (error) {
        console.log(error);
        return _promptFail("injectedCall", request.id, request, reject);
    }
    
    if (["BTS", "BTS_TEST", "TUSC"].includes(blockchain._config.identifier)) {
        if (!isBlocked && visualizedParams) {
            // account names will have 1.2.x in parenthesis now - check again
            if (!blockedAccounts) {
                try {
                    blockedAccounts = await blockchain.getBlockedAccounts();
                } catch (error) {
                    console.log(error);
                }
            }

            let strVirtParams = JSON.stringify(visualizedParams);
            let regexMatches = strVirtParams.matchAll(regexBTS);

            for (const match of regexMatches) {
                foundIDs.push(match[0]);
            }

            if (blockedAccounts) {
                const isBadActor = (actor) => blockedAccounts.find(x => x === actor) ? true : false;
                isBlocked = foundIDs.some(isBadActor);
            }
        }
    }

    let types = blockchain.getOperationTypes();

    let account = "";
    let visualizedAccount;
    if (["BTS", "BTS_TEST", "TUSC"].includes(blockchain._config.identifier)) {
        let fromField = types.find(type => type.method === request.type).from;
        if (!fromField || !fromField.length) {
            account = store.getters['AccountStore/getCurrentSafeAccount']();
        } else {
            let visualizeContents = request.payload[fromField];
            try {
                visualizedAccount = await blockchain.visualize(visualizeContents);
            } catch (error) {
                console.log(error);
                return _promptFail("injectedCall", request.id, request, reject);
            }
        }
    } else if (["EOS", "BEOS", "TLOS"].includes(blockchain._config.identifier)) {
        const _actions = JSON.parse(request.payload.params[1]).actions;
        visualizedAccount = _actions[0].authorization[0].actor; 
    }

    if (
        (["BTS", "BTS_TEST", "TUSC"].includes(blockchain._config.identifier)) &&
        ((!visualizedAccount && !account || !account.accountName) || !visualizedParams)
    ) {
        console.log("Missing required fields for injected BTS call");
        return _promptFail("injectedCall", request.id, request, reject);
    }

    if (
        (["EOS", "BEOS", "TLOS"].includes(blockchain._config.identifier)) &&
        !visualizedParams
    ) {
        console.log(`Missing required fields for injected ${blockchain._config.identifier} based call`);
        return _promptFail("injectedCall", request.id, request, reject);
    }

    const popupContents = (["EOS", "BEOS", "TLOS"].includes(blockchain._config.identifier))
                            ? {
                                request: request,
                                visualizedAccount: visualizedAccount,
                                visualizedParams: JSON.stringify(visualizedParams)
                            }
                            : {
                                request: request,
                                visualizedAccount: visualizedAccount || account.accountName,
                                visualizedParams: JSON.stringify(visualizedParams)
                            };

    if (blockchain._config.identifier === "BTS" && foundIDs.length) {
        popupContents['isBlockedAccount'] = isBlocked;
    }

    if (
        blockchain._config.identifier === "BTS" &&
        (!blockedAccounts || !blockedAccounts.length)
    ) {
        popupContents['serverError'] = true;
    }

    try {
        window.electron.createPopup(popupContents);
    } catch (error) {
        return _promptFail("injectedCall", request.id, request, reject);
    }

    store.dispatch("WalletStore/notifyUser", {notify: "request", message: window.t('common.apiUtils.inject')});

    window.electron.approvedPopup({
        id: request.id,
        callback: (args) => {
            let memoObject;
            let _request = request;
            if (["BTS", "BTS_TEST", "TUSC"].includes(blockchain._config.identifier)) {        
                if (request.payload.memo) {
                    let from;
                    let to;
                    if (request.payload.from) {
                        from = request.payload.from;
                        to = request.payload.to;
                    } else if (request.payload.withdraw_from_account) {
                        from = request.payload.withdraw_from_account;
                        to = request.payload.withdraw_to_account;
                    } else if (request.payload.issuer) {
                        from = request.payload.issuer;
                        to = request.payload.issue_to_account;
                    }
    
                    try {
                        memoObject = blockchain._createMemoObject(
                            from,
                            to,
                            request.payload.memo,
                            request.payload.params.optionalNonce ?? undefined,
                            request.payload.params.encryptMemo ?? undefined
                        );
                    } catch (error) {
                        console.log(error);
                    }
    
                    _request.payload.memo = memoObject;
                }
            }
    
            return _signOrBroadcast(
                blockchain,
                _request,
                resolve,
                reject,
                args?.result?.receipt
                    ? {
                        visualizedAccount: popupContents.visualizedAccount,
                        visualizedParams: popupContents.visualizedParams
                    }
                    : null
            );
        }
    });

    window.electron.rejectedPopup({
        id: request.id,
        callback: (result) => {
            return _promptFail("injectedCall", request.id, result, reject);
        }
    });
  });
}

/*
 * Handle vote request for specific chain.
 * @param {Object} request
 * @returns {Object}
 */
export async function voteFor(request, blockchain) {
  // generic request popup
  return new Promise(async (resolve, reject) => {
    let payload = request.payload;

    payload.action = "vote";
    let mappedData;
    try {
      mappedData = await blockchain.mapOperationData(payload);
    } catch (error) {
      return _promptFail("voteFor", request.id, error, reject);
    }

    payload.generic = {
        title: window.t("operations.vote.title"),
        message: window.t("operations.vote.request", {
            appName: payload.appName,
            origin: payload.origin,
            entity: mappedData.entity,
            chain: payload.chain,
            accountName: payload.account_id
        }),
        details: mappedData.description,
        acceptText: window.t("operations.vote.accept_btn"),
        rejectText: window.t("operations.vote.reject_btn")
    };
    payload.vote_id = mappedData.vote_id;
    store.dispatch("WalletStore/notifyUser", {notify: "request", message: window.t('common.apiUtils.vote')});

    window.electron.createPopup({
        request: request,
        payload: payload
    });

    window.electron.approvedPopup({
        id: request.id,
        callback: () => {
            let shownBeetApp = store.getters['OriginStore/getBeetApp'](request);
            if (!shownBeetApp) {
              return _promptFail("getAccount", request.id, 'No beetApp', reject);
            }
    
            let approvedAccount = store.getters['AccountStore/getSafeAccount'](JSON.parse(JSON.stringify(shownBeetApp)));
    
            let operation;
            try {
              operation = await blockchain.getOperation(payload, approvedAccount);
            } catch (error) {
              return _promptFail("voteFor.getOperation", request.id, error, reject);
            }
    
            if (operation.nothingToDo) {
              return resolve({
                  result: {
                      name: approvedAccount.accountName,
                      chain: approvedAccount.chain,
                      id: approvedAccount.accountID
                  },
                  request: {
                    id: request.id
                  }
              });
            }
    
            let activeKey = store.getters['AccountStore/getActiveKey'](request);
    
            let signingKey;
            try {
              signingKey = await getKey(activeKey);
            } catch (error) {
              return _promptFail("voteFor.getKey", request.id, error, reject);
            }
    
            let transaction;
            try {
              transaction = await blockchain.sign(operation, signingKey);
            } catch (error) {
              return _promptFail("voteFor.sign", request.id, error, reject);
            }
    
            let broadcastResult;
            try {
              broadcastResult = await blockchain.broadcast(transaction);
            } catch (error) {
              return _promptFail("voteFor.broadcast", request.id, error, reject);
            }
    
            return !broadcastResult
              ? _promptFail("voteFor.broadcast", request.id, 'no broadcast', reject)
              : resolve({result: broadcastResult});
        }
    });

    window.electron.rejectedPopup({
        id: request.id,
        callback: (result) => {
            return _promptFail("voteFor", request.id, result, reject);
        }
    });
  });
}

/*
 * Sign a Bitshares NFT
 * @param {Object} request
 * @returns {Object}
 */
export async function signNFT(request, blockchain) {
    //signed NFT popup
    return new Promise(async (resolve, reject) => { 
      let shownBeetApp = store.getters['OriginStore/getBeetApp'](request);
      if (!shownBeetApp) {
        return _promptFail("REQUEST_RELINK", request.id, 'No beetApp', reject);
      }
  
      let account = store.getters['AccountStore/getSafeAccount'](JSON.parse(JSON.stringify(shownBeetApp)));
      store.dispatch("WalletStore/notifyUser", {notify: "request", message: window.t('common.apiUtils.signNFT')});

      window.electron.createPopup({
        request: request,
        accounts: [account]
      });

      window.electron.approvedPopup({
        id: request.id,
        callback: async () => {
            let retrievedKey;
            try {
              retrievedKey = store.getters['AccountStore/getSigningKey'](request);
            } catch (error) {
              return _promptFail("signNFT.getSigningKey", request.id, error, reject);
            }
    
            let processedKey;
            try {
              processedKey = await getKey(retrievedKey)
            } catch (error) {
              return _promptFail("signNFT.getKey", request.id, error, reject);
            }
    
            let signedNFT;
            try {
                signedNFT = await blockchain.signNFT(processedKey, request.payload.params);
            } catch (error) {
              return _promptFail("blockchain.signNFT", request.id, error, reject);
            }
    
            return resolve({result: signedNFT});
        }
      });

        window.electron.rejectedPopup({
            id: request.id,
            callback: (result) => {
                return _promptFail("signNFT.reject", request.id, result, reject);
            }
        });
    });
  }

/*
 * Sign a message
 * @param {Object} request
 * @returns {Object}
 */
export async function signMessage(request, blockchain) {
  //signed message popup
  return new Promise(async (resolve, reject) => {
    let shownBeetApp = store.getters['OriginStore/getBeetApp'](request);
    if (!shownBeetApp) {
      return _promptFail("REQUEST_RELINK", request.id, 'No beetApp', reject);
    }

    let account = store.getters['AccountStore/getSafeAccount'](JSON.parse(JSON.stringify(shownBeetApp)));
    store.dispatch("WalletStore/notifyUser", {notify: "request", message: window.t('common.apiUtils.signMessage')});

    window.electron.createPopup({
        request: request,
        accounts: [account]
    });

    window.electron.approvedPopup({
        id: request.id,
        callback: async () => {
            let retrievedKey;
            try {
              retrievedKey = store.getters['AccountStore/getSigningKey'](request);
            } catch (error) {
              return _promptFail("signMessage.getSigningKey", request.id, error, reject);
            }
    
            let processedKey;
            try {
              processedKey = await getKey(retrievedKey)
            } catch (error) {
              return _promptFail("signMessage.getKey", request.id, error, reject);
            }
    
            let accountName;
            try {
              accountName = account.accountName;
            } catch (error) {
              return _promptFail("signMessage.accountName", request.id, error, reject);
            }
    
            let signedMessage;
            try {
                signedMessage = await blockchain.signMessage(
                                    processedKey,
                                    accountName,
                                    request.payload.params
                                );
            } catch (error) {
              return _promptFail("blockchain.signMessage", request.id, error, reject);
            }
    
            return resolve({result: signedMessage});
        }
    });

    window.electron.rejectedPopup({
        id: request.id,
        callback: (result) => {
            return _promptFail("signMessage.reject", request.id, result, reject);
        }
    });
  });
}

/*
 * Transfer an asset to another blockchain account
 * @param {Object} request
 * @returns {Object}
 */
export async function transfer(request, blockchain) {
  // transfer req popup
  return new Promise(async (resolve, reject) => {
    let shownBeetApp = store.getters['OriginStore/getBeetApp'](request);
    if (!shownBeetApp) {
      return _promptFail("transfer", request.id, 'No beetApp', reject);
    }

    if (!blockchain._config.identifier === "BTS") {
        // TODO: support other chains
        return;
    }

    let accountDetails;
    try {
      accountDetails = store.getters['AccountStore/getSafeAccount'](JSON.parse(JSON.stringify(shownBeetApp)));
    } catch (error) {
      return _promptFail("transfer", request.id, 'getSafeAccount', reject);
    }

    let toSend;
    try {
      toSend = await blockchain.format(request.payload.params.amount);
    } catch (error) {
      console.log(error);
      return _promptFail("transfer", request.id, 'No toSend', reject);
    }

    let targetID;
    let targetAccount = request.payload.params.to;
    if (!targetAccount.includes("1.2.")) {
        let targetAccountContents;
        try {
            targetAccountContents = await this.getAccount(targetAccount);
        } catch (error) {
            console.log(error);
            return reject();
        }

        targetID = targetAccountContents.id;
    } else {
        targetID = targetAccount;
    }

    let blockedAccounts;
    try {
        blockedAccounts = await blockchain.getBlockedAccounts();
    } catch (error) {
        console.log(error);
    }

    let isBlocked = blockedAccounts.find(x => x === targetID) ? true : false;

    store.dispatch("WalletStore/notifyUser", {notify: "request", message: window.t('common.apiUtils.transfer')});

    window.electron.createPopup({
        chain: accountDetails.chain,
        accountName: accountDetails.accountName,
        request: request,
        toSend: toSend,
        target: targetID,
        serverError: !blockedAccounts || !blockedAccounts.length ? true : false,
        isBlockedAccount: isBlocked
    });

    window.electron.approvedPopup({
        id: request.id,
        callback: async () => {
            let activeKey = store.getters['AccountStore/getActiveKey'](request);

            let liveActiveKey;
            try {
              liveActiveKey = await getKey(activeKey);
            } catch (error) {
              return _promptFail("transfer.getKey", request.id, error, reject);
            }
            
            let memoInput;
            if (request.payload.params.memo) {
              let liveMemoKey;
              try {
                  liveMemoKey = await getKey(accountDetails.memoKey);
              } catch (error) {
                  console.log(error);
              }
      
              memoInput = {
                  key: liveMemoKey,
                  memo: request.payload.params.memo
              }
            }
      
            let transferResult;
            try {
              transferResult = await blockchain.transfer(
                  liveActiveKey,
                  accountDetails.accountName,
                  request.payload.params.to,
                  {
                      amount: request.payload.params.amount.amount ||
                              request.payload.params.amount.satoshis,
                      asset_id: request.payload.params.amount.asset_id
                  },
                  memoInput ?? undefined,
                  request.payload.params.optionalNonce ?? undefined,
                  request.payload.params.encryptMemo ?? undefined
              );
            } catch (error) {
              return _promptFail("blockchain.transfer", request.id, error, reject);
            }
      
            if (!transferResult) {
              return _promptFail("blockchain.transfer", request.id, 'No blockchain transfer result', reject);
            }
      
            store.dispatch("WalletStore/notifyUser", {notify: "request", message: window.t('common.apiUtils.transferComplete')});
            return resolve({result: transferResult});
        }
    });

    window.electron.rejectedPopup({
        id: request.id,
        callback: (result) => {
            return _promptFail("transfer.reject", request.id, result, reject);
        }
    });
  });
}


/*
 * Verify a signed message
 * @param {Object} request
 * @returns {Object}
 */
export async function messageVerification(request, blockchain) {
  return new Promise(async (resolve, reject) => {
    store.dispatch("WalletStore/notifyUser", {notify: "request", message: window.t('common.apiUtils.msgVerify')});
    
    let blockchainRequest;
    try {
      blockchainRequest = await window.electron.blockchainRequest({
        methods: ["verifyMessage"],
        request
      });
    } catch (error) {
      return _promptFail("blockchain.verifyMessage", request.id, error, reject);
    }

    if (!blockchainRequest) {
      return _promptFail("blockchain.verifyMessage", request.id, 'No blockchain request', reject);
    }

    return resolve({result: blockchainRequest});
  });
}
