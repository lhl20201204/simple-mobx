// https://github.com/lhl20201204/simple-mobx.git
const initGlobalState = {
  trackingContext: null,
  trackingReaction: null,
  trackingComputed: null,
  enforceActions: false,
  penddingReaction: new Set(),
  runningReaction: new Set(),
  isSpying: false,
  spyList: new Set(),
  isInAction: false,
  isRunInAction: false,
  isInComputedAction: false,
  isInComputedMethod: false,
  isInComputedAutoRun: false,
  isUpdating: false,
  inBatch: 0,
  reactionId: 0,
  computedId: 0,
  contextId: 0,
  boxId: 0,
  updateBatchId: 0
}
let globalState = {
  ...initGlobalState,
  logger: false,
}
const $MOBX = Symbol('mobx administration');
const $ACTION = Symbol('mobx action');
const $ACTION_BOUND = Symbol('mobx action bound');
const $COMPUTED = Symbol('mobx computed');
const $REACTION = Symbol('mobx reaction');
const $COMPUTED_REACTION = Symbol('mobx computed reaction');
const $COMPUTED_ACTION = Symbol('mobx computed action');
const $COMPUTED_ATOM = Symbol('mobx computed atom');
const $COMPUTED_VALUE_IS_NULL = Symbol('mobx computed value is null');
const $ARRAY_EXTRA = Symbol('mobx arr extra');

function setUnWritableAttr(obj, attr, value) {
  Reflect.defineProperty(obj, attr, {
    value,
    writable: false,
    enumerable: false,
  })
}

const originArrProto = Array.prototype;
for (const x of Reflect.ownKeys(originArrProto)) {
  const fn = originArrProto[x];
  if (!_.isFunction(fn) || 'constructor' === x || typeof x === 'symbol') {
    continue;
  }
  originArrProto[x] = function (...args) {
    if (Reflect.has(this, $MOBX)) {
      const proxy = this[$MOBX].proxy;
      if (globalState.trackingReaction) {
        proxy[$ARRAY_EXTRA];
      }
      return runInAction(() => {
        return fn.call(proxy, ...args)
      })
    }
    return fn.call(this, ...args)
  }
}

setUnWritableAttr(originArrProto, 'replace', function (arr) {
  if (Reflect.has(this, $MOBX)) {
    runInAction(() => {
      const proxy = this[$MOBX].proxy;
      arr.forEach((v, i) => {
        proxy[i] = v;
      })
      proxy.length = arr.length;
    })
  }
})

setUnWritableAttr(originArrProto, 'spliceWithArray', function (s, d, arr = []) {
  if (Reflect.has(this, $MOBX)) {
    runInAction(() => {
      const proxy = this[$MOBX].proxy;
      proxy.splice(s, d, ...arr);
    })
  }
})

setUnWritableAttr(originArrProto, 'clear', function (s, d, arr = []) {
  if (Reflect.has(this, $MOBX)) {
    runInAction(() => {
      const proxy = this[$MOBX].proxy;
      proxy.splice(s, proxy.length);
    })
  }
})


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
    if (globalState.isUpdating) {
      return;
    }
    globalState.updateBatchId++;
    let itr = 0;
    const reactionList = [...globalState.penddingReaction].sort((a, b) => a.id - b.id)
    globalState.logger && console.log(reactionList, 'end Batch');
    reactionList.forEach(reaction => {
      reaction.prepareUpdate();
    })
    globalState.logger && console.log('第' + itr + '批量更新所有reaction', _.cloneDeep([...reactionList]));
    globalState.penddingReaction.clear()
    globalState.isUpdating = true;
    while (reactionList.length) {
      if (itr > 100) {
        console.error('reaction 里有循环依赖，死循环了')
        break;
      }
      const reaction = reactionList.shift();
      if (reaction.allowRun()) {
        globalState.logger && console.log(`----${reaction.name}---start--`)
        reaction.track()
        globalState.logger && console.log(`----${reaction.name}---end--`)
        reaction.afterUpdate();
      } else {
        globalState.logger && console.log(`----${reaction.name}---continue--`)
      }

      if (globalState.penddingReaction) {
        const rest = new Set(reactionList)
        globalState.penddingReaction.forEach(newReaction => {
          if (!rest.has(newReaction)) {
            newReaction.prepareUpdate();
            rest.add(newReaction)
          }
        })
        globalState.penddingReaction.clear()
        reactionList.splice(0, reactionList.length, ...rest)
        reactionList.sort((a, b) => a.id - b.id);
      }
      itr++
    }
    globalState.isUpdating = false;
  }
}

class Context {
  constructor(type, parent) {
    // 这里的context 的type 指的是autorun 或者 action，
    // 用来处理当action结束后，里面涉及的计算原子状态需要清空
    // 以及处理autorun，第一次不走缓存，和后续走缓存。
    this.id = globalState.contextId++;
    this.type = type;
    this.containAtom = new Set()
    this.cbList = new Set()
    this.children = [];
    this.parent = parent;
    this.isDisposed = false;
    if (parent) {
      this.level = this.parent.level + 1
      this.parent.children.push(this)
    } else {
      this.level = 1
    }
  }

  dispose() {
    this.isDisposed = true;
    this.containAtom.forEach(atom => {
      atom.removeContext(this)
    })
  }

  runOverAfter(fn) {
    this.cbList.add(fn)
  }

  isIn(type) {
    if (this.type instanceof type) {
      return true
    }

    return this.parent && this.parent.isIn(type)
  }

  addAtom(atom) {
    if (this.containAtom.has(atom)) {
      return
    }
    this.containAtom.add(atom)
    if (atom instanceof Atom) {
      atom.addContext(this)
      if (atom instanceof ComputedAtom) {
        // 如果在激活的autorun,或者computed里，设置标志符
        if ((this.type instanceof Reaction) || (this.type instanceof ComputedReaction)) {
          atom.setIsInActiveReaction(true)
        }

        if (this.type instanceof Action) {
          this.runOverAfter(() => {
            // 如果没有被autorun 监听，则当最外层action结束后 
            // this.parent 为 null 则说明是最外层
            if (!atom.isInActiveReaction && _.isNil(this.parent)) {
              atom.updateNeedComputed(true)
            }
          })
        }

      }
    }
    // if (this.parent) {
    // this.parent.addAtom(atom)
    // }
  }

  runOver() {
    this.cbList.forEach(cb => {
      cb()
    })
    this.cbList.clear()
  }
}

class Atom {
  constructor(name, value) {
    this.name = name;
    this.value = (typeof value === 'object' && !(value instanceof Atom)) ? observable(value) : value;
    this.observing = new Set();
    this.contextSet = new Set();
    this.contextCountMap = new WeakMap();
  }

  addReaction(reaction) {
    this.observing.add(reaction);
  }

  addContext(context) {
    if (!this.contextCountMap.has(context)) {
      this.contextCountMap.set(context, 0)
    }
    const count = this.contextCountMap.get(context)
    this.contextCountMap.set(context, count + 1);
    this.contextSet.add(context)
  }

  removeContext(context) {
    if (!this.contextCountMap.has(context)) {
      throw new Error('运行错误')
    }
    const count = this.contextCountMap.get(context)
    if (count === 1) {
      this.contextCountMap.delete(context)
      this.contextSet.delete(context)
    } else {
      this.contextCountMap.set(context, count - 1)
    }
  }

  setNewValue(v) {
    if (globalState.isInComputedMethod && (!(globalState.isInAction || globalState.isInComputedAction))) {
      throw new Error("computed 函数内只能在action方法里设置属性值")
    }
    if (globalState.enforceActions === 'always' && !globalState.isInAction) {
      throw new Error("enforceActions 为always，只能在action里更改")
    }
    const oldValue = this.value;
    this.value = v;
    const reactionList = (_.filter([...this.observing], item => !(item instanceof ComputedReaction) || item.allowAtomChangeCall || item.allowActionChangeComputed));
    if ((oldValue !== this.value) && _.size(reactionList) > 0) {
      globalState.logger && console.log(this.name + ', change', _.cloneDeep(reactionList));
      startBatch()
      reactionList.forEach(reaction => {
        reaction.observableAtom.add(this);
        globalState.penddingReaction.add(reaction)
      })
      endBatch()
      return true;
    }
    return false;
  }

  set(v) {
    this.setNewValue(v)
  }

  get() {
    if (globalState.trackingReaction
      && (((!globalState.isInAction
        && !globalState.isInComputedAction))
        || globalState.isInComputedAutoRun
      )
      && !this.observing.has(globalState.trackingReaction)) {
      globalState.logger && console.log(this.name, '原子被加入', globalState.trackingReaction);
      this.addReaction(globalState.trackingReaction)
    }

    // console.log(this.name, globalState.trackingReaction);

    if ((globalState.trackingContext instanceof Context)) {
      globalState.trackingContext.addAtom(this)
    }

    if ((!globalState.isInComputedAction && !globalState.isInAction) && (globalState.trackingComputed instanceof Computed)) {
      // console.log('computed 添加依赖', globalState.trackingComputed, this)
      // 这里是computed函数里的监听。
      globalState.trackingComputed.addAtom(this)
    }

    return this.value
  }
}

class ComputedAtom extends Atom {
  constructor(name, value, computed) {
    super(name, value);
    this.computed = computed
    this.type = $COMPUTED_ATOM;
    this.isInActiveReaction = false;
    this.isNeedComputed = true;
  }

  setComputedReactionAllowAtomChangeCall(val) {
    this.computed.computedReaction.setAllowAtomChangeCall(val)
  }

  contextChangeAfter() {
    this.setIsInActiveReaction(_.size(_.filter([...this.contextSet], item => (item.type instanceof Reaction || item.type instanceof ComputedReaction))) > 0)
    globalState.logger && console.log('computed autorun disposer', this.isInActiveReaction)

    // 如果不被autorun 监听了，设置需要更新值
    if (!this.isInActiveReaction) {
      this.updateNeedComputed(true)
    }
  }

  updateNeedComputed(bol) {
    this.isNeedComputed = bol
  }

  setIsInActiveReaction(bol) {
    this.isInActiveReaction = bol;
    if (this.computed instanceof Computed) {
      // 设置computed函数允许子变量变化而变更；
      // console.log('contextChangeAfter', this.isInActiveReaction);
      this.setComputedReactionAllowAtomChangeCall(this.isInActiveReaction)
    }
  }
}

class Computed {
  constructor(name, computedFn) {
    this.name = name
    this.value = new ComputedAtom(name, $COMPUTED_VALUE_IS_NULL, this)
    setUnWritableAttr(this, 'type', $COMPUTED);
    this.computedFn = computedFn;
    this.hadAutoRun = false;
    this.lastValue = this.value.value;
    this.listenerSet = new Set();
    this.changeTime = 0;
    this.allowActionChangeComputed = false;
    this.computedReaction = null;
    this.isInlistener = false;
    this.observableAtom = new Set();
    // this.needComputed = true;
  }

  addAtom(atom) {
    this.observableAtom.add(atom)
    if (atom instanceof ComputedAtom) {
      const computedReaction = atom.computed.computedReaction;
      if (computedReaction instanceof ComputedReaction &&
        globalState.trackingContext instanceof Context &&
        globalState.trackingContext.type instanceof ComputedReaction) {
        const currentComputedReaction = globalState.trackingContext.type;
        currentComputedReaction.bindComputedReaction(computedReaction)
      }
    }
  }

  update = computedAction(this.name + '@updateAction', (v) => {
    this.value.setNewValue(v);
    if (globalState.isInAction || (globalState.trackingContext?.inIn?.(Reaction))) {
      this.value.updateNeedComputed(false);
    } else {
      this.value.updateNeedComputed(true)
    }

    // this.needComputed = true
    this.dispatch()
    // console.log('dispatch end')
    this.changeTime++
  })

  dispatch() {
    if (this.listenerSet.size) {
      this.listenerSet.forEach(([cb, minCount]) => {
        if (this.changeTime >= minCount) {
          this.isInlistener = true;
          runInAction(cb)
          this.isInlistener = false;
        }
      })
    }
  }

  autorunView = (text) => () => {
    const preTrackingComputed = globalState.trackingComputed;
    globalState.trackingComputed = this;
    this.observableAtom.clear()
    const value = this.computedFn();
    globalState.trackingComputed = preTrackingComputed;
    if (!_.isEqual(this.lastValue, value)) {
      this.lastValue = value
      this.update(value)
    }
  }

  actionAutoRunView = computedAction(this.name + '@computedAction', this.autorunView('get'))

  computedRunFn = this.autorunView('autoRun');

  computed() {
    this.computedReaction = computedrun(() => {
      const preIsInComputedAutorun = globalState.isInComputedAutoRun;
      globalState.isInComputedAutoRun = true;
      this.computedRunFn()
      globalState.isInComputedAutoRun = preIsInComputedAutorun;
    }, this.name + '@computedReaction');
    this.computedReaction.setComputed(this)
    this.changeObservingAllowActionChangeComputedState()
  }

  setNewValue() {
    console.error('computed 不能主动设置值')
  }

  changeObservingAllowActionChangeComputedState() {
    this.allowActionChangeComputed = this.listenerSet.size > 0
    if (this.computedReaction instanceof ComputedReaction) {
      this.computedReaction.setAllowActionChangeComputed(this.allowActionChangeComputed)
    }
  }

  observe(cb, firstRun) {
    const arr = [cb, firstRun];
    this.listenerSet.add(arr)
    this.changeObservingAllowActionChangeComputedState()
    return () => {
      this.listenerSet.delete(arr)
      this.changeObservingAllowActionChangeComputedState()
    }
  }

  get() {
    if (this.isInlistener) {
      return this.value.get();
    }

    //////////////////////////////////////////////////////////
    if (!this.hadAutoRun && (globalState.trackingReaction || this.allowActionChangeComputed)) {
      this.hadAutoRun = true;
      this.computed()
      return this.value.get()
    }

    globalState.logger && console.log(this.name, this.value.isInActiveReaction, this.value.isNeedComputed)
    // 如果当前没有被autoRun 监听
    if (!this.value.isInActiveReaction) {
      // 如果不在action 或者autoRun ，runInaction 里获取， 则get一次，重新执行一次计算函数
      if (!globalState.trackingContext) {
        this.actionAutoRunView();
        return this.value.get();
      }

      // 如果需要重新计算，则get一次，重新执行一次计算函数
      if (this.value.isNeedComputed) {
        this.actionAutoRunView();
        this.value.updateNeedComputed(false);
        return this.value.get();
      }
    }

    if (this.computedReaction instanceof ComputedReaction) {
      if (this.computedReaction.whenCalledInComputedNeedUpdate) {
        this.computedReaction.calledInComputedReaction();
        this.actionAutoRunView();
        return this.value.get()
      }
    }

    // globalState.isUpdating && console.log(this.name,this.computedReaction.context)

    return this.value.get();
  }

}

class Reaction {
  constructor(view) {
    this.id = globalState.reactionId++;
    this.type = $REACTION
    this.isDisposed = false;
    this.view = view;
    this.observableAtom = new Set();
    this.context = null;
    this.observableComputedReaction = new Set();
    this.lastestBatchId = null;
    this.track()
  }

  prepareUpdate() {
    if (this.allowRun()) {
      this.observableAtom.forEach(atom => {
        atom.observing.delete(this)
      })
      this.observableAtom.clear()
    }
  }

  afterUpdate() {
    this.lastestBatchId = globalState.updateBatchId;
  }

  allowRun() {
    return this.lastestBatchId !== globalState.updateBatchId;
  }

  schedule() {
    // 这里后续可能会被包成异步的
    this.view();
  }

  disposeHandleComputedAtom(context, save = false) {
    if (!(context instanceof Context)) {
      return
    }
    const { containAtom, children } = context;
    if (containAtom) {
      // 当reaction, disposer, 涉及的计算属性需要重新设置为失效
      // console.log('disposer', containAtom);
      containAtom.forEach((atom) => {
        if (atom instanceof ComputedAtom) {
          if (!save) {
            atom.removeContext(context)
          }
          atom.contextChangeAfter()
        }
      })
    }
    for (const c of children) {
      // todo 
      if ((c.type instanceof Action)) {
        this.disposeHandleComputedAtom(c, true)
      }
    }
  }

  dispose = () => {
    this.isDisposed = true;
    this.disposeHandleComputedAtom(this.context)
    // console.log(this.view, observeAtom)
  }

  track() {
    if (this.isDisposed) {
      return;
    }
    const run = () => {
      const preContext = globalState.trackingContext;
      const preReaction = globalState.trackingReaction
      globalState.trackingReaction = this;
      const preIsInAction = globalState.isInAction;
      if (this.context) {
        this.context.dispose()
      }
      const newContext = new Context(this, preContext);
      this.context = newContext;
      globalState.trackingContext = newContext
      globalState.isInAction = false;
      // if (globalState.isInAction) {
      //   globalState.isTrackingReactionInAction = true;
      // }
      this.schedule()
      // globalState.isTrackingReactionInAction = false;
      globalState.trackingContext.runOver()
      globalState.isInAction = preIsInAction;
      globalState.trackingReaction = preReaction;
      globalState.trackingContext = preContext;
    }
    const preContext = globalState.trackingContext;
    if (preContext instanceof Context) {
      preContext.runOverAfter(run)
    } else {
      run()
    }
  }
}

class ComputedReaction {
  constructor(view, name) {
    this.id = globalState.reactionId++;
    this.name = name;
    this.type = $COMPUTED_REACTION
    this.isDisposed = false;
    this.view = view;
    this.observableAtom = new Set();
    this.allowActionChangeComputed = false
    this.context = null;
    this.allowAtomChangeCall = false;
    this.computed = null;
    this.children = new Set();
    this.parent = new Set();
    this.whenCalledInComputedNeedUpdate = false;
    this.lastestBatchId = null;
    this.track()
  }

  prepareUpdate() {
    if (this.allowRun()) {
      this.observableAtom.forEach(atom => {
        atom.observing.delete(this)
      })
      this.observableAtom.clear()
    }
    if (this.lastestBatchId !== globalState.updateBatchId) {
      this.whenCalledInComputedNeedUpdate = true;
    }
  }

  updateState() {
    this.whenCalledInComputedNeedUpdate = false;
    this.lastestBatchId = globalState.updateBatchId;
  }

  afterUpdate() {
    this.updateState()
  }

  allowRun() {
    return this.lastestBatchId !== globalState.updateBatchId;
  }

  calledInComputedReaction() {
    this.updateState()
  }

  bindComputedReaction(computedReaction) {
    globalState.logger && console.log(`子computed[${computedReaction.name}]和父computed[${this.name}]绑定依赖`)
    this.children.add(computedReaction)
    computedReaction.parent.add(this)
  }

  setComputed(c) {
    this.computed = c;
  }

  setAllowAtomChangeCall(v) {
    this.allowAtomChangeCall = v;
  }

  setAllowActionChangeComputed(v) {
    this.allowActionChangeComputed = v;
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

    const run = () => {
      const preContext = globalState.trackingContext;
      const preReaction = globalState.trackingReaction
      globalState.trackingReaction = this;
      if (this.context) {
        this.context.dispose()
      }
      const newContext = new Context(this, preContext);
      globalState.trackingContext = newContext;
      this.context = newContext;
      // const preIsTrackingReactionInAction = globalState.isTrackingReactionInAction;
      // if (globalState.isInAction) {
      //   globalState.isTrackingReactionInAction = true;
      // }
      this.schedule()
      // globalState.isTrackingReactionInAction = preIsTrackingReactionInAction;
      globalState.trackingContext.runOver()
      globalState.trackingReaction = preReaction;
      globalState.trackingContext = preContext;

    }

    run()
  }
}

function getProxy(obj) {
  const ret = new Map();
  if (_.isArray(obj)) {
    let len = _.size(obj);
    // ret.set('length', new Atom('observable@length', len))
    ret.set($ARRAY_EXTRA, new Atom('observableArray@extra', 0))
  }
  for (const x in obj) {
    // console.log(x, '初始化');
    // if (isComputedGet(obj, x)) {

    //   console.log('是 computed get 属性');
    //   console.log()
    //   continue;
    // }

    const v = obj[x];

    if (v instanceof Computed) {
      ret.set(x, v)
      Reflect.deleteProperty(obj, x);
      Reflect.defineProperty(obj, x, {
        get() {
          return v.get()
        },
        set(v2) {
          v.setNewValue(v2)
          console.warn('computed 属性不能设置', v2)
        }
      })
      continue;
    }

    if (isAction(v) || isActionBound(v)) {
      ret.set(x, v)
      // 代理完之后将其置为不可枚举
      Reflect.defineProperty(obj, x, {
        value: v,
        enumerable: false,
      })
      continue;
    }


    ret.set(x, new Atom(x, v))
  }
  return ret;
}

function setProxyValue(obj, decoratorConfig, attr) {
  const getFn = Reflect.getOwnPropertyDescriptor(obj, attr)?.get;
  const willBeWrapComputed = _.isFunction(getFn);
  const v = willBeWrapComputed ? undefined : obj[attr]
  if (_.isFunction(_.get(decoratorConfig, attr))) {
    //  obj[attr] = decoratorConfig[attr](attr, v);
    Reflect.defineProperty(obj, attr, {
      value: decoratorConfig[attr](attr, v),
      // enumerable: false,
    })
    return;
  }

  if (_.isFunction(getFn)) {
    Reflect.deleteProperty(obj, attr);
    // 将其this 绑定死
    // 给另一个原始obj引用
    obj[attr] = computed(attr, (...args) => getFn.call(obj[$MOBX].proxy, ...args));
    return;
  }
  obj[attr] = observable(v)
}

function observable(obj, decoratorConfig) {
  if (typeof obj !== 'object' || Reflect.has(obj, $MOBX)) {
    return obj;
  }

  if (_.isArray(obj)) {
    return observableArray(obj, decoratorConfig);
  }

  for (const x in obj) {
    setProxyValue(obj, decoratorConfig ?? {}, x)
  }

  const copyObj = { ...obj };
  const proxyObj = {
    values: getProxy(obj),
    originObj: obj,
    copyObj,
    getProxyObj: () => proxyObj,
  };

  setUnWritableAttr(obj, $MOBX, proxyObj)

  const proxyInstance = new Proxy(proxyObj.originObj, {
    set(target, p, t) {
      const observableValue = proxyObj.values.get(p)
      newValue = observable(t);
      if (observableValue instanceof Atom) {
        observableValue.setNewValue(newValue);
      }
      if (copyObj[p] instanceof Computed) {
        // Reflect.set(target, p, newValue);
        // todo 如果原来是computed,后续需要重新考虑
        copyObj[p].value = newValue;
      } else {
        Reflect.set(target, p, newValue);
        Reflect.set(copyObj, p, newValue);
      }
      globalState.logger && console.log('obj-atom-set', p, newValue);
      return true;
    },
    get(target, p) {
      const v = proxyObj.values.get(p)
      let value = Reflect.get(copyObj, p);
      if (v instanceof Atom) {
        value = v.get()
      }

      if (_.isFunction(value)) {

        function ret(...args) {

          const callObj = isActionBound(value) ? proxyInstance :
            Reflect.has(this, $MOBX) ? this[$MOBX].proxy : this;
          // console.log('value', value, this, target, this === obj,  this === target)
          // console.log((isActionBound(value)) ||  Reflect.has(this, $MOBX))
          return value.call(callObj, ...args)
        }

        [$ACTION, $COMPUTED_ACTION].forEach(attr => {
          if (value[attr]) {
            setUnWritableAttr(ret, attr, value[attr])
          }
        })
        return ret
      }

      if (value instanceof Computed) {
        return value.get()
      }

      globalState.logger && console.log('obj-atom-get', p, value)
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
  proxyObj.proxy = proxyInstance
  return proxyInstance;
}

function observableArray(arr, decoratorConfig) {
  if (!_.isArray(arr)) {
    return arr;
  }


  arr.forEach((item, i) => {
    setProxyValue(arr, {}, i)
  })

  const copyObj = [...arr];
  const proxyObj = {
    values: getProxy(arr),
    originObj: arr,
    copyObj,
    getProxyObj: () => proxyObj,
  };

  setUnWritableAttr(arr, $MOBX, proxyObj)

  let array_extra_id = 0;
  let array_len = copyObj.length;
  const proxyInstance = new Proxy(proxyObj.originObj, {
    set(target, p, newValue) {
      let oldLen = copyObj['length'];
      let len = null;
      if (copyObj[p] instanceof Computed) {
        // Reflect.set(target, p, newValue);
        // todo 如果原来是computed,后续需要重新考虑
        copyObj[p].value = newValue;
      } else {
        Reflect.set(target, p, newValue);
        Reflect.set(copyObj, p, newValue);
        if ((_.isString(p) && _.isInteger(+p)) || p === 'length') {
          len = copyObj['length']
          Reflect.set(target, 'length', len);
          Reflect.set(copyObj, 'length', len);
          if (oldLen !== len) {
            proxyObj.proxy['length'] = len;
          }
        }
      }
      const observableAtom = proxyObj.values.get(p)

      const isShouldUpdate = (!_.isNull(len) && oldLen !== len) || observableAtom?.value !== newValue;
      if (observableAtom instanceof Atom) {
        if (isShouldUpdate) {
          const extraAtom = proxyObj.values.get($ARRAY_EXTRA)
          if (extraAtom instanceof Atom) {
            runInAction(() => {
              observableAtom.setNewValue(newValue)
              extraAtom.setNewValue(array_extra_id++)
            })
          }
        } else {
          observableAtom.setNewValue(newValue)
        }
      } else if (p === 'length' && isShouldUpdate) {
        const extraAtom = proxyObj.values.get($ARRAY_EXTRA)
        extraAtom.setNewValue(array_extra_id++)
      }
      globalState.logger && console.log('arr-atom-set', p, newValue);
      return true;
    },
    get(target, p) {
      const v = proxyObj.values.get(p)
      let value = Reflect.get(copyObj, p);
      if (v instanceof Atom) {
        value = v.get()
      }

      if (_.isString(p) && _.isInteger(+p) && globalState.trackingReaction) {
        const extraAtom = proxyObj.values.get($ARRAY_EXTRA)
        extraAtom.get()
        // console.log('额外监听', p)
      }

      if (_.isFunction(value)) {

        function ret(...args) {

          const callObj = isActionBound(value) ? proxyInstance :
            Reflect.has(this, $MOBX) ? this[$MOBX].proxy : this;
          // console.log('value', value, this, target, this === obj,  this === target)
          // console.log((isActionBound(value)) ||  Reflect.has(this, $MOBX))
          return value.call(callObj, ...args)
        }

        [$ACTION, $COMPUTED_ACTION].forEach(attr => {
          if (value[attr]) {
            setUnWritableAttr(ret, attr, value[attr])
          }
        })
        return ret
      }

      if (value instanceof Computed) {
        // 二次代理
        return value.get()
      }

      globalState.logger && console.log('arr-atom-get', p, value)
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
  proxyObj.proxy = proxyInstance
  return proxyInstance;
}

setUnWritableAttr(observable, 'box', (v) => new Atom('observableValue@' + globalState.boxId++, v))

setUnWritableAttr(observable, 'array', (arr) => {
  if (!_.isArray(arr)) {
    throw new Error(`${arr}不是数组`);
  }
  return observableArray(arr)
})

function autorun(view) {
  const reaction = new Reaction(view.bind(this))
  return reaction.dispose;
}

function computedrun(view, name) {
  return new ComputedReaction(view.bind(this), name)
}

class Action {
  constructor() {
    this.context = null;
  }
  getActionWrap(name, cb) {
    this.name = name;
    this.cb = cb;
    const currentAction = this;
    function actionWrap(...args) {
      let ret
      let error = null
      const preContext = globalState.trackingContext;
      if (currentAction.context instanceof Context) {
        currentAction.context.dispose()
      }
      const newContext = new Context(currentAction, preContext);
      currentAction.context = newContext;
      globalState.trackingContext = newContext;
      const preIsInAction = globalState.isInAction
      try { // 解决测试用例 #286 exceptions in actions should not affect global state
        startBatch()
        globalState.isInAction = true
        if (globalState.isSpying) {
          globalState.spyList.forEach((spyCb) => {
            spyCb({
              type: 'action',
              name,
              arguments: [...args],
            })
          })
        }
        ret = cb.call(this, ...args)
      } catch (e) {
        error = e
      } finally {
        globalState.trackingContext.runOver()
        globalState.trackingContext = preContext;
        globalState.isInAction = preIsInAction
        endBatch()
        if (error) {
          throw error
        }
        return ret
      }
    }
    setUnWritableAttr(actionWrap, $ACTION, true)
    setUnWritableAttr(actionWrap, 'name', name)
    return actionWrap
  }
}

function action(name, view) {
  const cb = view ?? name
  name = view ? name : (getFuncName(cb) ?? '<unnamed action>')
  return new Action().getActionWrap(name, cb)
}

setUnWritableAttr(action, 'bound', function (name, view) {
  const cb = view ?? name
  name = view ? name : '<unnamed action.bound>'
  const ret = action(name, cb)
  setUnWritableAttr(ret, $ACTION_BOUND, true)
  return ret
})

function computedAction(name, view) {
  const cb = view || name
  name = view ? name : '<unnamed computedAction>'
  function fn(...args) {
    const preIsInComputedAction = globalState.isInComputedAction
    globalState.isInComputedAction = true
    const ret = cb.call(this, ...args);
    globalState.isInComputedAction = preIsInComputedAction
    return ret
  }
  setUnWritableAttr(fn, $COMPUTED_ACTION, true)
  setUnWritableAttr(fn, 'name', name)
  return fn
}

function computed(name, view) {
  const cb = view ?? name;
  name = view ? name : 'computed@' + globalState.computedId++
  return new Computed(name, () => {
    const preIsInComputedMethod = globalState.isInComputedMethod
    globalState.isInComputedMethod = true;
    const value = cb()
    globalState.isInComputedMethod = preIsInComputedMethod;
    return value
  });
}

function observe(computeable, cb, firstRun = false) {
  if (!(computeable instanceof Computed)) {
    throw new Error('非计算属性')
  }
  const disposer = computeable.observe(cb, Number(!firstRun))
  if (firstRun) {
    computeable.get();
  }
  return disposer
}

function isAction(fn) {
  return fn[$ACTION] ?? fn[$COMPUTED_ACTION] ?? false
}

function isActionBound(fn) {
  return fn[$ACTION_BOUND] ?? false
}

function extendObservable(originObj, extObj, decoratorConfig) {
  for (const x in extObj) {
    setProxyValue(extObj, decoratorConfig ?? {}, x)
  }

  let originProxyInstance = originObj;
  const hadMoxProxy = Reflect.has(originObj, $MOBX)
  if (!hadMoxProxy) {
    originProxyInstance = observable({})
    for (const attr in originObj) {
      originProxyInstance[attr] = originObj[attr]
    }
  }
  const proxyObj = Reflect.get(originProxyInstance, $MOBX);

  if (!hadMoxProxy) {
    setUnWritableAttr(originObj, $MOBX, proxyObj);
  }

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
  return originObj
}

function configure(config) {
  for (const attr in config) {
    globalState[attr] = config[attr]
  }
}

function spy(view) {
  globalState.spyList.add(view);
  globalState.isSpying = globalState.spyList.size > 0
  return () => {
    globalState.spyList.delete(view);
    globalState.isSpying = globalState.spyList.size > 0
  }
}

function runInAction(view) {
  return (() => {
    const preIsRunInAction = globalState.isRunInAction;
    globalState.isRunInAction = true
    const ret = action(view)()
    globalState.isRunInAction = preIsRunInAction
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