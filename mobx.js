// https://github.com/lhl20201204/simple-mobx.git
const initGlobalState = {
  trackingReaction: null,
  isTrackingReactionInAction: false,
  enforceActions: false,
  penddingReaction: new Set(),
  isSpying: false,
  spyList: new Set(),
  isInAction: false,
  isRunInAction: false,
  isInComputedAction: false,
  isInComputedMethod: false,
  inBatch: 0,
  reactionId: 0,
  computedId: 0,
  boxId: 0,
}
let globalState = {
  ...initGlobalState,
  logger: false,
}
const $MOBX = Symbol('mobx administration');
const $ACTION = Symbol('mobx action');
const $COMPUTED = Symbol('mobx computed');
const $REACTION = Symbol('mobx reaction');
const $COMPUTED_REACTION = Symbol('mobx computed reaction');
const $COMPUTED_ACTION = Symbol('mobx computed action');

function _resetGlobalState() {
  for (const attr in initGlobalState) {
    globalState[attr] = _.cloneDeep(initGlobalState[attr])
  }
}

function startBatch() {
  globalState.inBatch++
}

function endBatch() {
  --globalState.inBatch
  if (globalState.inBatch === 0) {
    const reactionList = globalState.penddingReaction
    reactionList.forEach(reaction => {
      reaction.observableAtom.forEach(atom => {
        atom.observing.delete(reaction)
      })
    })
    reactionList.forEach(reaction => {
      reaction.track()
    })
    globalState.penddingReaction.clear()
  }
}

function setUnWritableAttr(obj, attr, value) {
  Reflect.defineProperty(obj, attr, {
    value,
    writable: false,
    enumerable: false,
  })
}
class Atom {
  constructor(name, value) {
    this.name = name;
    this.value = (typeof value === 'object' && !(value instanceof Atom)) ? observable(value) : value;
    this.observing = new Set();
  }

  setNewValue(v) {
    if (globalState.isInComputedMethod && !globalState.isInAction) {
      throw new Error("computed 函数内只能在action方法里设置属性值")
    }
    if (globalState.enforceActions === 'always' && !globalState.isInAction) {
      throw new Error("enforceActions 为always，只能在action里更改")
    }
    const oldValue = this.value;
    this.value = v;
    const reactionList = [...this.observing] || _.filter([...this.observing], item => (!globalState.isInAction || _.get(item, 'type') !== $COMPUTED_REACTION));

    if ((oldValue !== this.value) && _.size(reactionList) > 0) {
      startBatch()
      reactionList.forEach(reaction => {
        globalState.penddingReaction.add(reaction)
        reaction.observableAtom.add(this);
      })
      endBatch()
    }
  }

  set(v) {
    this.setNewValue(v)
  }

  get() {
    if (globalState.trackingReaction
      && (((!globalState.isInAction
        && !globalState.isInComputedAction)) || globalState.isTrackingReactionInAction)) {
      this.observing.add(globalState.trackingReaction)
    }
    return this.value
  }
}

class Computed extends Atom {
  constructor(name, computedFn) {
    super(name, new Atom(name, undefined))
    setUnWritableAttr(this, 'type', $COMPUTED);
    this.computedFn = computedFn;
    this.hadAutoRun = false;
    this.lastValue = this.value.value;
    this.memorizedTimes = 0;
  }

  update = computedAction(this.name, (v) => {
    this.value.setNewValue(v)
  })

  autorunView = () => {
    const value = this.computedFn();
    // console.log(this.lastValue, value, 'value change')
    if (!_.isEqual(this.lastValue, value)) {
      this.lastValue = value
      this.update(value)
    }
  }

  actionAutoRunView = computedAction(this.name, this.autorunView)

  computed() {
    this.dispose = computedAutorun(this.autorunView)
  }

  setNewValue() {
    console.error('computed 不能主动设置值')
  }

  get() {
    let noFirst = true;
    if (!this.hadAutoRun) {
      this.hadAutoRun = true;
      noFirst = false;
      this.computed()
    }

    if (!(globalState.trackingReaction || globalState.isInAction || globalState.isRunInAction )) {
      this.memorizedTimes = 0;
    } else {
      this.memorizedTimes++;
    }

    if (this.memorizedTimes <= 1 && noFirst) {
      this.actionAutoRunView()
    }

    return this.value.get();
  }

}

class Reaction {
  constructor(view, type = $REACTION) {
    this.id = globalState.reactionId++;
    this.type = type
    this.isDisposed = false;
    this.view = view;
    this.observableAtom = new Set();
    this.track()
  }

  schedule() {
    this.view();
  }

  dispose = () => {
    this.isDisposed = true;
  }

  track() {
    if (this.isDisposed) {
      return;
    }
    const preReaction = globalState.trackingReaction
    globalState.trackingReaction = this;
    if (globalState.isInAction) {
      globalState.isTrackingReactionInAction = true;
    }
    this.schedule()
    globalState.isTrackingReactionInAction = false;
    globalState.trackingReaction = preReaction;
  }
}

function getProxy(obj) {
  const ret = new Map();
  for (const x in obj) {
    ret.set(x, new Atom(x, obj[x]))
  }
  return ret;
}


function observable(obj) {
  const copyObj = { ...obj };
  const proxyObj = {
    values: getProxy(obj),
    originObj: obj,
    copyObj,
    getProxyObj: () => proxyObj,
  };

  setUnWritableAttr(obj, $MOBX, proxyObj)

  const proxyInstance = new Proxy(obj[$MOBX].originObj, {
    set(target, p, newValue) {
      const observableValue = target[$MOBX].values.get(p)
      if (observableValue instanceof Atom) {
        observableValue.setNewValue(newValue);
      }
      Reflect.set(target, p, newValue);
      Reflect.set(copyObj, p, newValue);
      globalState.logger && console.log('atom-set', p, newValue);
      return true;
    },
    get(target, p) {
      const v = target[$MOBX].values.get(p)
      let value = Reflect.get(copyObj, p);
      if (v instanceof Atom) {
        value = v.get()
      }

      if (_.isFunction(value)) {
        const ret = value.bind(proxyInstance);
        [$ACTION, $COMPUTED_ACTION].forEach(attr => {
          if (value[attr]) {
            setUnWritableAttr(ret, attr, value[attr])
          }
        })
        return ret
      }
      globalState.logger && console.log('atom-get', p, value)
      return [$MOBX].includes(p) ? proxyObj : value
    },
    has(target, p) {
      const tempAtom = target[$MOBX].values.get(p)
      if (tempAtom instanceof Atom) {
        tempAtom.get()
      }
      return true
    }
  })

  return proxyInstance;
}

setUnWritableAttr(observable, 'box', (v) => new Atom('boxId@' + globalState.boxId++, v))

function autorun(view) {
  const reaction = new Reaction(view.bind(this))
  return reaction.dispose;
}

function computedAutorun(view) {
  const reaction = new Reaction(view.bind(this), $COMPUTED_REACTION)
  return reaction.dispose;
}

function action(name, view) {
  const cb = view ?? name
  name = view ? name : '<unnamed action>'
  function fn(...args) {
    let ret
    let error = null
    try { // #286 exceptions in actions should not affect global state
      if (!globalState.trackingReaction) {
        startBatch()
      }
      globalState.isInAction = true
      if (globalState.isInAction) {
        if (globalState.isSpying) {
          globalState.spyList.forEach((spyCb) => {
            spyCb({
              type: 'action',
              name,
              arguments: [...args],
            })
          })
        }
      }
      ret = cb.call(this, ...args)
    } catch (e) {
      error = e
    } finally {
      globalState.isInAction = false
      if (!globalState.trackingReaction) {
        endBatch()
      }
      if (error) {
        throw error
      }
      return ret
    }

  }
  setUnWritableAttr(fn, $ACTION, true)
  return fn
}

function computedAction(name, view) {
  const cb = view || name
  function fn(...args) {
    startBatch()
    globalState.isInComputedAction = true
    const ret = cb(...args)
    globalState.isInComputedAction = false
    endBatch()
    return ret
  }
  setUnWritableAttr(fn, $COMPUTED_ACTION, true)
  return fn
}

function computed(view) {
  return new Computed('computed@' + globalState.computedId++, () => {
    globalState.isInComputedMethod = true;
    const value = view()
    globalState.isInComputedMethod = false;
    return value
  });
}

function observe(computeable, cb, run = false) {
  if (!(computeable instanceof Computed)) {
    throw new Error('非计算属性')
  }
  const ac = action(cb)
  return autorun(() => {
    if (run) {
      computeable.get()
      ac();
    }
    run = true;
  })
}

function isAction(fn) {
  return fn[$ACTION] ?? fn[$COMPUTED_ACTION] ?? false
}

function extendObservable(originObj, extObj) {
  let originProxyInstance = originObj;
  if (!Reflect.has(originObj, $MOBX)) {
    originProxyInstance = observable({})
    for (const attr in originObj) {
      originProxyInstance[attr] = originObj[attr]
    }
  }
  const proxyObj = Reflect.get(originProxyInstance, $MOBX);
  for (const attr in extObj) {
    const atom = new Atom(attr, extObj[attr])
    proxyObj.values.set(attr, atom)
    originProxyInstance[attr] = extObj[attr];
    Reflect.defineProperty(originObj, attr, {
      set(v) {
        if (!_.isEqual(v, originProxyInstance[attr])) {
          globalState.logger && console.log('define-set', attr, v)
          originProxyInstance[attr] = v;
        }
        return true
      },
      get() {
        globalState.logger && console.log('define-get', attr)
        return originProxyInstance[attr];
      }
    })
  }
}

function configure(config) {
  for (const attr in config) {
    globalState[attr] = config[attr]
  }
}

function spy(view) {
  globalState.isSpying = true;
  globalState.spyList.add(view);
  return () => {
    globalState.spyList.delete(view);
  }
}

function runInAction(view) {
  return (() => {
    globalState.isRunInAction = true
    let ret = action(view)()
    globalState.isRunInAction = false
    return ret;
  })()
}


const mobx = {
  observable,
  autorun,
  action,
  computed,
  observe,
  isAction,
  _resetGlobalState,
  extendObservable,
  globalState,
  configure,
  spy,
  runInAction
}