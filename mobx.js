// https://github.com/lhl20201204/simple-mobx.git
const initGlobalState = {
  trackingContext: null,
  trackingReaction: null,
  // isTrackingReactionInAction: false,
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
  contextId: 0,
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
const $COMPUTED_ATOM = Symbol('mobx computed atom');

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
    const reactionList = [...globalState.penddingReaction]
    reactionList.forEach(reaction => {
      reaction.observableAtom.forEach(atom => {
        atom.observing.delete(reaction)
      })
    })
    // console.log('批量更新所有reaction', _.cloneDeep([...reactionList]));
    globalState.penddingReaction.clear()
    reactionList.forEach(reaction => {
      reaction.track()
    })

  }
}

function setUnWritableAttr(obj, attr, value) {
  Reflect.defineProperty(obj, attr, {
    value,
    writable: false,
    enumerable: false,
  })
}

class Context {
  constructor(type, parent) {
    // 这里的context 的type 指的是autorun 或者 action，
    // 用来处理当action结束后，里面涉及的计算原子状态需要清空
    // 以及处理autorun，第一次不走缓存，和后续走缓存。
    this.id = globalState.contextId++;
    this.type = type;
    this.containAtom = new Set()
    this.selfAtom = new Set()
    this.cbList = new Set()
    this.children = [];
    this.parent = parent;
    if (parent) {
      this.parent.children.push(this)
    }
  }

  runOverAfter(fn) {
    this.cbList.add(fn)
  }

  addAtom(atom) {
    this.containAtom.add(atom)
    this.selfAtom.add(atom)
    if (atom instanceof Atom) {
      atom.addContext(this)
      if (atom instanceof ComputedAtom) {
        // 如果在激活的autorun里，设置标志符
        if (this.type instanceof Reaction) {
          atom.setIsInActiveReaction(true)
        }
       
        if (this.type instanceof Action) {
          this.runOverAfter(() => {
            // 如果没有被autorun 监听，则当最外层action结束后 
            // this.parent 为 null 则说明是最外层
            if (!atom.isInActiveReaction  && _.isNil(this.parent)) {
              atom.updateNeedComputed(true)
            }
          })
        }
    
      }
    }
    if (this.parent) {
      this.parent.addAtom(atom)
    }
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
  }

  addContext(context) {
    this.contextSet.add(context);
  }

  removeContext(context) {
    this.contextSet.delete(context);
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
    const reactionList = _.filter([...this.observing], item => (!globalState.isInAction || !(item instanceof ComputedReaction) || item.allowActionChangeComputed));
    if ((!_.isEqual(oldValue, this.value)) && _.size(reactionList) > 0) {
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
        && !globalState.isInComputedAction)) 
        // || globalState.isTrackingReactionInAction
        )
      && !this.observing.has(globalState.trackingReaction)) {
      this.observing.add(globalState.trackingReaction)
    }

    // console.log(this.name, globalState.trackingReaction);

    if (globalState.trackingContext instanceof Context) {
      globalState.trackingContext.addAtom(this)
    }
    return this.value
  }
}

class ComputedAtom extends Atom{
  constructor(name, value) {
    super(name, value);
    this.type = $COMPUTED_ATOM;
    this.isInActiveReaction = false;
    this.isNeedComputed = false;
  }

  contextChangeAfter() {
    this.isInActiveReaction = _.size(_.filter([...this.contextSet], item => item.type instanceof Reaction)) > 0;
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
  }
}

class Computed {
  constructor(name, computedFn) {
    this.name = name
    this.value = new ComputedAtom(name, undefined)
    setUnWritableAttr(this, 'type', $COMPUTED);
    this.computedFn = computedFn;
    this.hadAutoRun = false;
    this.lastValue = this.value.value;
    this.listenerSet = new Set();
    this.changeTime = 0;
    this.allowActionChangeComputed = false;
    this.computedReaction = null;
    this.isInlistener = false;
    // this.needComputed = true;
  }

  update = computedAction(this.name + '@updateAction', (v) => {
    this.value.setNewValue(v);
    this.value.updateNeedComputed(true);
    // this.needComputed = true
    // console.log('update__', v)
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

  autorunView = (text) => function computedWrap() {
    const value = this.computedFn();
    // console.log(this.lastValue, value, text)
    if (!_.isEqual(this.lastValue, value)) {
      this.lastValue = value
      this.update(value)
    }
  }.bind(this)

  actionAutoRunView = computedAction(this.name, this.autorunView('get'))

  computed() {
    this.computedReaction = computedrun(this.autorunView('autoRun'))
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

    if (!this.hadAutoRun) {
      this.hadAutoRun = true;
      this.computed()
      return this.value.get()
    }

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
    this.track()
  }

  schedule() {
    this.view();
  }

  dispose = () => {
    this.isDisposed = true;
    const { containAtom } = this.context || {};
    if (containAtom) {
      // 当reaction, disposer, 涉及的计算属性需要重新设置为失效
      containAtom.forEach((atom) => {
        if (atom instanceof ComputedAtom) {
          atom.removeContext(this.context)
          atom.contextChangeAfter()
        }
      })
    }
    // console.log(this.view, observeAtom)
  }

  track() {
    if (this.isDisposed) {
      return;
    }
    const preContext = globalState.trackingContext;
    const run = () => {
      const preReaction = globalState.trackingReaction
      globalState.trackingReaction = this;
      const preIsInAction = globalState.isInAction;
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

    if (preContext instanceof Context) {
      preContext.runOverAfter(run)
    } else {
      run()
    }
  }
}

class ComputedReaction {
  constructor(view) {
    this.id = globalState.reactionId++;
    this.type = $COMPUTED_REACTION
    this.isDisposed = false;
    this.view = view;
    this.observableAtom = new Set();
    this.allowActionChangeComputed = false
    this.context = null;
    this.track()
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
    const preContext = globalState.trackingContext;

    const run = () => {
      const preReaction = globalState.trackingReaction
      globalState.trackingReaction = this;
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

    if (preContext instanceof Context) {
      preContext.runOverAfter(run)
    } else {
      run()
    }
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

function computedrun(view) {
  return new ComputedReaction(view.bind(this))
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
      const newContext = new Context(currentAction, preContext);
      currentAction.context = newContext;
      globalState.trackingContext = newContext;
      const preIsInAction = globalState.isInAction
      try { // 解决测试用例 #286 exceptions in actions should not affect global state
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
        globalState.trackingContext.runOver()
        globalState.trackingContext = preContext;
        globalState.isInAction = preIsInAction
        if (!globalState.trackingReaction) {
          endBatch()
        }
        if (error) {
          throw error
        }
        return ret
      }
    }
    setUnWritableAttr(actionWrap, $ACTION, true)
    return actionWrap
  }
}

function action(name, view) {
  const cb = view ?? name
  name = view ? name : '<unnamed action>'
  return new Action().getActionWrap(name, cb)
}

function computedAction(name, view) {
  const cb = view || name
  function fn(...args) {
    startBatch()
    const preIsInComputedAction = globalState.isInComputedAction
    globalState.isInComputedAction = true
    const ret = cb(...args)
    globalState.isInComputedAction = preIsInComputedAction
    endBatch()
    return ret
  }
  setUnWritableAttr(fn, $COMPUTED_ACTION, true)
  return fn
}

function computed(view) {
  return new Computed('computed@' + globalState.computedId++, () => {
    const preIsInComputedMethod = globalState.isInComputedMethod
    globalState.isInComputedMethod = true;
    const value = view()
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
    let ret = action(view)()
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