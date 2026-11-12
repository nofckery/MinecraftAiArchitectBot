/**
 * Dedicated Viewer Bot Proxy for Prismarine-Viewer Attachment
 * Manages version spoofing, world proxy wrapping, real-time blockUpdate interception,
 * entity sanitization and symmetric event listener tracking.
 */

export function createViewerBotProxy(context) {
  const { bot, targetViewerVersion, wrappedWorld, translateBlockUpdateFn, sanitizeEntityFn } = context;

  // Symmetric listener tracking: eventName -> Map<originalCallback, wrappedCallback[]>
  const listenerMap = new Map();

  const trackWrappedListener = (eventName, listener, wrappedListener) => {
    let eventListeners = listenerMap.get(eventName);
    if (!eventListeners) {
      eventListeners = new Map();
      listenerMap.set(eventName, eventListeners);
    }
    let list = eventListeners.get(listener);
    if (!list) {
      list = [];
      eventListeners.set(listener, list);
    }
    list.push(wrappedListener);
  };

  const untrackWrappedListener = (eventName, listener, wrappedListener) => {
    const eventListeners = listenerMap.get(eventName);
    if (!eventListeners) return;
    const list = eventListeners.get(listener);
    if (!list) return;
    const idx = list.indexOf(wrappedListener);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
    if (list.length === 0) {
      eventListeners.delete(listener);
    }
    if (eventListeners.size === 0) {
      listenerMap.delete(eventName);
    }
  };

  const getAndUntrackWrapped = (eventName, listener) => {
    const eventListeners = listenerMap.get(eventName);
    if (!eventListeners) return listener;

    // Match original callback
    if (eventListeners.has(listener)) {
      const list = eventListeners.get(listener);
      if (list && list.length > 0) {
        const wrapped = list.shift();
        if (list.length === 0) {
          eventListeners.delete(listener);
        }
        if (eventListeners.size === 0) {
          listenerMap.delete(eventName);
        }
        return wrapped;
      }
    }

    // Match if already the wrapped function
    for (const [orig, list] of eventListeners.entries()) {
      const idx = list.indexOf(listener);
      if (idx !== -1) {
        list.splice(idx, 1);
        if (list.length === 0) {
          eventListeners.delete(orig);
        }
        if (eventListeners.size === 0) {
          listenerMap.delete(eventName);
        }
        return listener;
      }
    }

    return listener;
  };

  const addMethods = new Set(['on', 'addListener', 'once', 'prependListener', 'prependOnceListener']);
  const removeMethods = new Set(['removeListener', 'off']);

  return new Proxy(bot, {
    get(target, prop, receiver) {
      if (prop === 'version') {
        return targetViewerVersion;
      }
      if (prop === 'world') {
        return wrappedWorld;
      }
      if (prop === 'entities') {
        const origEntities = Reflect.get(target, prop, receiver);
        if (!origEntities || typeof origEntities !== 'object') return origEntities;
        return new Proxy(origEntities, {
          get(eTarget, eProp, eReceiver) {
            const ent = Reflect.get(eTarget, eProp, eReceiver);
            return typeof sanitizeEntityFn === 'function' ? sanitizeEntityFn(ent) : ent;
          }
        });
      }
      if (addMethods.has(prop)) {
        const origMethod = Reflect.get(target, prop, receiver);
        if (typeof origMethod !== 'function') {
          return origMethod;
        }
        const isOnce = (prop === 'once' || prop === 'prependOnceListener');
        return function(eventName, listener) {
          if (eventName === 'blockUpdate' && typeof listener === 'function') {
            const wrappedListener = function(oldBlock, newBlock) {
              if (isOnce) {
                untrackWrappedListener('blockUpdate', listener, wrappedListener);
              }
              const translatedStateId = translateBlockUpdateFn(newBlock);
              const wrappedNewBlock = (newBlock && typeof newBlock === 'object')
                ? new Proxy(newBlock, {
                    get(bTarget, bProp, bReceiver) {
                      if (bProp === 'stateId') return translatedStateId;
                      return Reflect.get(bTarget, bProp, bReceiver);
                    }
                  })
                : newBlock;
              return listener(oldBlock, wrappedNewBlock);
            };
            trackWrappedListener('blockUpdate', listener, wrappedListener);
            const res = origMethod.call(target, eventName, wrappedListener);
            return res === target ? receiver : res;
          }
          if (eventName === 'entitySpawn' && typeof listener === 'function') {
            const wrappedListener = function(spawnedEntity) {
              if (isOnce) {
                untrackWrappedListener('entitySpawn', listener, wrappedListener);
              }
              const sanitized = typeof sanitizeEntityFn === 'function'
                ? sanitizeEntityFn(spawnedEntity)
                : spawnedEntity;
              return listener(sanitized);
            };
            trackWrappedListener('entitySpawn', listener, wrappedListener);
            const res = origMethod.call(target, eventName, wrappedListener);
            return res === target ? receiver : res;
          }
          const res = origMethod.apply(target, arguments);
          return res === target ? receiver : res;
        };
      }
      if (removeMethods.has(prop)) {
        const origMethod = typeof target[prop] === 'function'
          ? target[prop]
          : (typeof target.removeListener === 'function'
            ? target.removeListener
            : (typeof target.off === 'function' ? target.off : null));
        return function(eventName, listener) {
          const fnToRemove = getAndUntrackWrapped(eventName, listener);
          if (typeof origMethod === 'function') {
            const res = origMethod.call(target, eventName, fnToRemove);
            return res === target ? receiver : res;
          }
          return receiver;
        };
      }
      if (prop === 'removeAllListeners') {
        const origMethod = target.removeAllListeners;
        return function(eventName) {
          if (eventName) {
            listenerMap.delete(eventName);
          } else {
            listenerMap.clear();
          }
          if (typeof origMethod === 'function') {
            const res = origMethod.apply(target, arguments);
            return res === target ? receiver : res;
          }
          return receiver;
        };
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    }
  });
}
